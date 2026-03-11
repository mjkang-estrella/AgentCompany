import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import {
  getEmailById,
  getEmailProcessingJobById,
  initializeDatabase,
  listEmailProcessingEvents,
  listNotesByEmailId,
  openDatabaseConnection,
  replaceNotesForEmail,
  storeNoteFeedback,
  storeAgentMailWebhookDelivery,
  TAXONOMY_TYPES,
  updateEmailProcessingState,
} from "./database.mjs";
import { createInboxHandler, openInboxDatabases } from "./server.mjs";

const silentLogger = {
  error() {},
  info() {},
  warn() {},
};

function buildAgentMailPayload() {
  return {
    event_id: "evt_server_test_1",
    event_type: "message.received",
    message: {
      message_id: "msg_server_test_1",
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      from: "Signals Weekly <editor@example.com>",
      timestamp: "2026-03-09T17:00:00Z",
      extracted_text: [
        "Teams running agent workflows should review prompts weekly.",
        "AI copilots grew 42% year over year.",
      ].join("\n\n"),
      headers: {
        "message-id": "<msg_server_test_1@example.com>",
      },
    },
    thread: {
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      received_timestamp: "2026-03-09T17:00:05Z",
    },
  };
}

function createMockResponse() {
  let statusCode = 200;
  let headers = {};
  let body = "";

  return {
    writeHead(status, nextHeaders = {}) {
      statusCode = status;
      headers = { ...nextHeaders };
      return this;
    },
    end(chunk = "") {
      if (chunk) {
        body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      }
    },
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function requestJson(handler, url) {
  const req = {
    method: "GET",
    url,
    headers: {
      host: "localhost",
    },
  };
  const res = createMockResponse();

  await handler(req, res);

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    payload: JSON.parse(res.body),
  };
}

async function requestJsonBody(
  handler,
  url,
  body,
  { method = "POST", headers = {} } = {}
) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost",
    "content-type": "application/json",
    ...headers,
  };

  const res = createMockResponse();
  await handler(req, res);

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    payload: JSON.parse(res.body),
  };
}

async function requestWebhook(
  handler,
  payload,
  { headers = {}, url = "/webhooks/agentmail" } = {}
) {
  return requestWebhookBody(handler, JSON.stringify(payload), {
    headers,
    url,
  });
}

async function requestWebhookBody(
  handler,
  body,
  { headers = {}, url = "/webhooks/agentmail" } = {}
) {
  const req = Readable.from([body]);
  req.method = "POST";
  req.url = url;
  req.headers = {
    host: "localhost",
    "content-type": "application/json",
    ...headers,
  };

  const res = createMockResponse();
  await handler(req, res);

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    payload: JSON.parse(res.body),
  };
}

async function withTestDatabase(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-server-test-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      await run(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("openInboxDatabases initializes the SQLite schema automatically on first run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-server-start-"));
  const databasePath = path.join(tempDir, "nested", "newsletter.sqlite");
  let dbResources;

  try {
    dbResources = await openInboxDatabases({
      databasePath,
    });

    assert.equal(dbResources.databaseState.databasePath, databasePath);
    assert.ok(dbResources.databaseState.schemaVersion >= 23);
    assert.equal(dbResources.databaseState.taxonomyTypeCount, 13);

    const { db, schemaVersion } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      assert.ok(schemaVersion >= 23);

      const tables = db
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'email_processing_events',
              'taxonomy_types',
              'emails',
              'notes',
              'relationships',
              'email_processing_jobs',
              'raw_emails',
              'sources',
              'digests'
            )
          ORDER BY name ASC
        `)
        .all()
        .map((row) => row.name);

      assert.deepEqual(tables, [
        "digests",
        "email_processing_events",
        "email_processing_jobs",
        "emails",
        "notes",
        "raw_emails",
        "relationships",
        "sources",
        "taxonomy_types",
      ]);
    } finally {
      db.close();
    }
  } finally {
    if (dbResources) {
      dbResources.db.close();
      dbResources.workerDatabase.close();
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("GET /notes?topic=<keyword> returns notes matching a keyword", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const deliveryResult = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-test-1",
      eventType: payload.event_type,
      rawPayload: JSON.stringify(payload),
      payload,
    });

    replaceNotesForEmail(db, deliveryResult.emailId, [
      {
        type: "idea",
        title: "Weekly agent workflow review",
        content: "Teams running agent workflows should review prompts weekly.",
        summary: "Weekly review prevents low-signal agent drift.",
        sourceExcerpt: "Teams running agent workflows should review prompts weekly.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.82,
      },
      {
        type: "fact",
        title: "Copilot revenue growth",
        content: "AI copilots grew 42% year over year.",
        summary: "Copilot revenue is compounding quickly.",
        sourceExcerpt: "AI copilots grew 42% year over year.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.91,
      },
    ]);

    const [agentNote] = listNotesByEmailId(db, deliveryResult.emailId);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/notes?topic=%20workflow%20");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.topic, "workflow");
    assert.equal(response.payload.notes.length, 1);
    assert.equal(response.payload.notes[0].id, agentNote.id);
    assert.equal(response.payload.notes[0].taxonomy_key, "idea");
    assert.equal(response.payload.notes[0].confidence, 0.82);
    assert.equal(response.payload.notes[0].classificationConfidence, 0.82);
    assert.match(response.payload.notes[0].body, /agent workflows should review prompts weekly/i);
  });
});

test("GET /notes/:id returns a single note with its relationships", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-note-detail-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });

    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "AI copilots standardize across finance teams",
        content: "Mid-market finance teams are standardizing on AI copilots to improve renewals.",
        summary: "Finance teams are adopting copilots to improve renewal outcomes.",
        sourceExcerpt:
          "Mid-market finance teams are standardizing on AI copilots to improve renewals.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.9,
        keywords: ["AI copilot", "finance", "renewal"],
      },
    ]);

    const [firstNote] = listNotesByEmailId(db, firstDelivery.emailId);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_test_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_test_2",
        subject: "Renewal expansion signals",
        extracted_text:
          "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Renewal expansion signals",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-note-detail-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });

    replaceNotesForEmail(
      db,
      secondDelivery.emailId,
      [
        {
          type: "fact",
          title: "Copilots drive renewal expansion",
          content:
            "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
          summary: "Renewal expansion is rising where copilots are deployed.",
          sourceExcerpt:
            "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
          sourceTimestamp: "2026-03-09T17:05:00Z",
          confidence: 0.94,
          keywords: ["AI copilot", "finance", "renewal"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            existingEmailId: firstDelivery.emailId,
            existingNoteType: firstNote.taxonomy_key,
            existingNoteTitle: firstNote.title,
            newNoteType: "fact",
            newNoteTitle: "Copilots drive renewal expansion",
            sharedKeywords: ["AI copilot", "finance", "renewal"],
            score: 3,
          },
        ],
      }
    );

    const [secondNote] = listNotesByEmailId(db, secondDelivery.emailId);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, `/notes/${firstNote.id}`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.note.id, firstNote.id);
    assert.equal(response.payload.note.taxonomy_key, "idea");
    assert.equal(response.payload.note.confidence, 0.9);
    assert.equal(response.payload.note.classificationConfidence, 0.9);
    assert.equal(response.payload.note.relationships.length, 1);

    const [relationship] = response.payload.note.relationships;

    assert.equal(relationship.relationship_type, "shared_keyword");
    assert.equal(relationship.strength, 3);
    assert.equal(relationship.overlap_source, "keyword_overlap");
    assert.deepEqual(relationship.overlap_terms, ["ai copilot", "finance", "renewal"]);
    assert.deepEqual(relationship.overlap_source_metadata, {
      matchedBy: "keyword_overlap",
      newNoteIndex: 0,
      newNoteType: "fact",
      newNoteTitle: "Copilots drive renewal expansion",
      existingEmailId: firstDelivery.emailId,
      existingNoteType: "idea",
      existingNoteTitle: firstNote.title,
    });
    assert.equal(relationship.related_note.id, secondNote.id);
    assert.equal(relationship.related_note.taxonomy_key, "fact");
    assert.equal(relationship.related_note.confidence, 0.94);
    assert.equal(relationship.related_note.classificationConfidence, 0.94);
    assert.match(relationship.related_note.body, /renewal expansion/i);
  });
});

test("GET /notes and GET /notes/:id expose duplicate_of only on duplicate notes", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-duplicate-link-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });

    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "Finance teams standardize on AI copilots",
        content: "Finance teams are standardizing on AI copilots for renewals.",
        sourceExcerpt: "Finance teams are standardizing on AI copilots for renewals.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.9,
        keywords: ["AI copilot", "finance"],
      },
    ]);

    const [firstNote] = listNotesByEmailId(db, firstDelivery.emailId);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_duplicate_link_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_duplicate_link_2",
        subject: "Duplicate finance copilot signal",
        extracted_text: "AI copilots are standardizing across finance renewal teams.",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Duplicate finance copilot signal",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-duplicate-link-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });

    replaceNotesForEmail(
      db,
      secondDelivery.emailId,
      [
        {
          type: "fact",
          title: "AI copilots standardize across finance renewals",
          content: "AI copilots are standardizing across finance renewal teams.",
          sourceExcerpt: "AI copilots are standardizing across finance renewal teams.",
          sourceTimestamp: "2026-03-09T17:05:00Z",
          confidence: 0.94,
          keywords: ["AI copilot", "finance"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["AI copilot", "finance"],
            score: 2,
          },
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            relationshipType: "duplicate_of",
            overlapBasis: "keyword",
            matchedValue: "normalized duplicate",
            score: 0.99,
          },
        ],
      }
    );
    const [secondNote] = listNotesByEmailId(db, secondDelivery.emailId);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const detailResponse = await requestJson(handler, `/notes/${secondNote.id}`);
    const listResponse = await requestJson(handler, "/notes");

    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.payload.note.relationships.length, 2);
    assert.deepEqual(
      detailResponse.payload.note.relationships.map((relationship) => relationship.relationship_type),
      ["shared_keyword", "duplicate_of"]
    );

    const duplicateRelationship = detailResponse.payload.note.relationships.find(
      (relationship) => relationship.relationship_type === "duplicate_of"
    );
    assert.ok(duplicateRelationship);
    assert.deepEqual(duplicateRelationship.overlap_terms, ["normalized duplicate"]);
    assert.equal(duplicateRelationship.related_note.id, firstNote.id);

    const listedDuplicateNote = listResponse.payload.notes.find((note) => note.id === secondNote.id);
    assert.ok(listedDuplicateNote);
    assert.deepEqual(
      listedDuplicateNote.relationships.map((relationship) => relationship.relationship_type),
      ["shared_keyword", "duplicate_of"]
    );

    const listedCanonicalNote = listResponse.payload.notes.find((note) => note.id === firstNote.id);
    assert.ok(listedCanonicalNote);
    assert.deepEqual(
      listedCanonicalNote.relationships.map((relationship) => relationship.relationship_type),
      ["shared_keyword"]
    );
  });
});

test("GET /notes/:id validates the note id and returns 404 for missing notes", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const invalidResponse = await requestJson(handler, "/notes/not-a-number");
    assert.equal(invalidResponse.statusCode, 400);
    assert.deepEqual(invalidResponse.payload, {
      error: "The note id path parameter must be a positive integer",
    });

    const missingResponse = await requestJson(handler, "/notes/9999");
    assert.equal(missingResponse.statusCode, 404);
    assert.deepEqual(missingResponse.payload, {
      error: "Note not found",
    });
  });
});

test("POST /notes/:id/feedback stores usefulness feedback and returns the updated note", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const deliveryResult = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-feedback-1",
      eventType: payload.event_type,
      rawPayload: JSON.stringify(payload),
      payload,
    });

    replaceNotesForEmail(db, deliveryResult.emailId, [
      {
        type: "idea",
        title: "Review newsletter prompts weekly",
        content: "Teams should review newsletter-driven prompts every Monday.",
        summary: "Weekly review keeps prompt drift under control.",
        sourceExcerpt: "Teams should review newsletter-driven prompts every Monday.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.84,
      },
    ]);

    const [note] = listNotesByEmailId(db, deliveryResult.emailId);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const response = await requestJsonBody(handler, `/notes/${note.id}/feedback`, {
      useful: true,
      comment: "Worth keeping for the weekly operating cadence.",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.note.id, note.id);
    assert.deepEqual(response.payload.note.feedback, {
      useful: true,
      comment: "Worth keeping for the weekly operating cadence.",
      updated_at: response.payload.note.feedback.updated_at,
    });
    assert.match(response.payload.note.feedback.updated_at, /^\d{4}-\d{2}-\d{2}T/);

    const detailResponse = await requestJson(handler, `/notes/${note.id}`);
    assert.equal(detailResponse.statusCode, 200);
    assert.deepEqual(detailResponse.payload.note.feedback, response.payload.note.feedback);
  });
});

test("POST /notes/:id/feedback validates the payload and returns 404 for missing notes", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const deliveryResult = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-feedback-2",
      eventType: payload.event_type,
      rawPayload: JSON.stringify(payload),
      payload,
    });

    replaceNotesForEmail(db, deliveryResult.emailId, [
      {
        type: "fact",
        title: "Copilot revenue growth",
        content: "AI copilots grew 42% year over year.",
        summary: "Copilot revenue growth remains strong.",
        sourceExcerpt: "AI copilots grew 42% year over year.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.9,
      },
    ]);

    const [note] = listNotesByEmailId(db, deliveryResult.emailId);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const invalidUsefulResponse = await requestJsonBody(handler, `/notes/${note.id}/feedback`, {
      useful: "yes",
    });
    assert.equal(invalidUsefulResponse.statusCode, 400);
    assert.deepEqual(invalidUsefulResponse.payload, {
      error: "The useful field is required and must be a boolean",
    });

    const invalidCommentResponse = await requestJsonBody(handler, `/notes/${note.id}/feedback`, {
      useful: false,
      comment: 7,
    });
    assert.equal(invalidCommentResponse.statusCode, 400);
    assert.deepEqual(invalidCommentResponse.payload, {
      error: "The comment field must be a string when provided",
    });

    const missingNoteResponse = await requestJsonBody(handler, "/notes/9999/feedback", {
      useful: true,
    });
    assert.equal(missingNoteResponse.statusCode, 404);
    assert.deepEqual(missingNoteResponse.payload, {
      error: "Note not found",
    });
  });
});

test("GET /notes?type=<type> returns notes matching a taxonomy type", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const deliveryResult = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-test-type-1",
      eventType: payload.event_type,
      rawPayload: JSON.stringify(payload),
      payload,
    });

    replaceNotesForEmail(db, deliveryResult.emailId, [
      {
        type: "tool_update",
        title: "AgentMail shipped webhook improvements",
        content: "AgentMail now includes richer webhook payload metadata.",
        summary: "Webhook payloads got more detailed.",
        sourceExcerpt: "AgentMail now includes richer webhook payload metadata.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.88,
      },
      {
        type: "fact",
        title: "Copilot revenue growth",
        content: "AI copilots grew 42% year over year.",
        summary: "Copilot revenue is compounding quickly.",
        sourceExcerpt: "AI copilots grew 42% year over year.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.91,
      },
    ]);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/notes?type=Tool%20Update");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.type, "tool_update");
    assert.equal(response.payload.notes.length, 1);
    assert.equal(response.payload.notes[0].taxonomy_key, "tool_update");
    assert.equal(response.payload.notes[0].confidence, 0.88);
    assert.equal(response.payload.notes[0].classificationConfidence, 0.88);
    assert.match(response.payload.notes[0].title, /webhook improvements/i);
  });
});

test("REST note views prefer classification_confidence over legacy confidence values", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const deliveryResult = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-confidence-precedence-1",
      eventType: payload.event_type,
      rawPayload: JSON.stringify(payload),
      payload,
    });

    replaceNotesForEmail(db, deliveryResult.emailId, [
      {
        type: "idea",
        title: "Workflow review cadence matters",
        content: "Teams should review newsletter-driven workflow changes every week.",
        summary: "Weekly review keeps workflow signals calibrated.",
        sourceExcerpt: "Teams should review newsletter-driven workflow changes every week.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.22,
        keywords: ["workflow"],
      },
    ]);

    const [note] = listNotesByEmailId(db, deliveryResult.emailId);

    db.prepare(`
      UPDATE notes
      SET confidence = ?, classification_confidence = ?
      WHERE id = ?
    `).run(0.22, 0.87, note.id);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const noteGraphResponse = await requestJson(handler, "/notes");
    const typeResponse = await requestJson(handler, "/notes?type=idea");
    const topicResponse = await requestJson(handler, "/notes?topic=workflow");
    const detailResponse = await requestJson(handler, `/notes/${note.id}`);
    const statsResponse = await requestJson(handler, "/stats");

    assert.equal(noteGraphResponse.statusCode, 200);
    assert.equal(noteGraphResponse.payload.notes[0].confidence, 0.87);
    assert.equal(noteGraphResponse.payload.notes[0].classificationConfidence, 0.87);

    assert.equal(typeResponse.statusCode, 200);
    assert.equal(typeResponse.payload.notes[0].confidence, 0.87);
    assert.equal(typeResponse.payload.notes[0].classificationConfidence, 0.87);

    assert.equal(topicResponse.statusCode, 200);
    assert.equal(topicResponse.payload.notes[0].confidence, 0.87);
    assert.equal(topicResponse.payload.notes[0].classificationConfidence, 0.87);

    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.payload.note.confidence, 0.87);
    assert.equal(detailResponse.payload.note.classificationConfidence, 0.87);

    assert.equal(statsResponse.statusCode, 200);
    assert.equal(statsResponse.payload.top_connected_notes[0].confidence, 0.87);
    assert.equal(statsResponse.payload.top_connected_notes[0].classificationConfidence, 0.87);
  });
});

test("GET /notes returns all notes with their linked relatives", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-note-list-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });

    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "AI copilots standardize across finance teams",
        content: "Mid-market finance teams are standardizing on AI copilots to improve renewals.",
        summary: "Finance teams are adopting copilots to improve renewal outcomes.",
        sourceExcerpt:
          "Mid-market finance teams are standardizing on AI copilots to improve renewals.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.9,
        keywords: ["AI copilot", "finance", "renewal"],
      },
      {
        type: "warning_risk",
        title: "Workflow debt compounds quietly",
        content: "Teams that skip prompt reviews accumulate workflow debt over time.",
        summary: "Prompt review debt grows when teams stop checking agent output quality.",
        sourceExcerpt: "Teams that skip prompt reviews accumulate workflow debt over time.",
        sourceTimestamp: "2026-03-09T16:55:00Z",
        confidence: 0.78,
        keywords: ["workflow debt", "prompt review"],
      },
    ]);

    const [firstNote, unlinkedNote] = listNotesByEmailId(db, firstDelivery.emailId);
    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_test_3",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_test_3",
        subject: "Renewal expansion signals",
        extracted_text:
          "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Renewal expansion signals",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-note-list-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });

    replaceNotesForEmail(
      db,
      secondDelivery.emailId,
      [
        {
          type: "fact",
          title: "Copilots drive renewal expansion",
          content:
            "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
          summary: "Renewal expansion is rising where copilots are deployed.",
          sourceExcerpt:
            "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
          sourceTimestamp: "2026-03-09T17:05:00Z",
          confidence: 0.94,
          keywords: ["AI copilot", "finance", "renewal"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            existingEmailId: firstDelivery.emailId,
            existingNoteType: firstNote.taxonomy_key,
            existingNoteTitle: firstNote.title,
            newNoteType: "fact",
            newNoteTitle: "Copilots drive renewal expansion",
            sharedKeywords: ["AI copilot", "finance", "renewal"],
            score: 3,
          },
        ],
      }
    );

    const [secondNote] = listNotesByEmailId(db, secondDelivery.emailId);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/notes");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.notes.length, 3);

    const notesById = new Map(response.payload.notes.map((note) => [note.id, note]));
    const firstListedNote = notesById.get(firstNote.id);
    const secondListedNote = notesById.get(secondNote.id);
    const unlinkedListedNote = notesById.get(unlinkedNote.id);

    assert.ok(firstListedNote);
    assert.ok(secondListedNote);
    assert.ok(unlinkedListedNote);

    assert.equal(firstListedNote.confidence, 0.9);
    assert.equal(firstListedNote.classificationConfidence, 0.9);
    assert.equal(secondListedNote.confidence, 0.94);
    assert.equal(secondListedNote.classificationConfidence, 0.94);
    assert.equal(unlinkedListedNote.confidence, 0.78);
    assert.equal(unlinkedListedNote.classificationConfidence, 0.78);
    assert.equal(firstListedNote.relationships.length, 1);
    assert.equal(firstListedNote.relationships[0].related_note.id, secondNote.id);
    assert.equal(firstListedNote.relationships[0].related_note.taxonomy_key, "fact");
    assert.equal(firstListedNote.relationships[0].related_note.confidence, 0.94);
    assert.equal(firstListedNote.relationships[0].related_note.classificationConfidence, 0.94);
    assert.deepEqual(firstListedNote.relationships[0].overlap_terms, [
      "ai copilot",
      "finance",
      "renewal",
    ]);

    assert.equal(secondListedNote.relationships.length, 1);
    assert.equal(secondListedNote.relationships[0].related_note.id, firstNote.id);
    assert.equal(secondListedNote.relationships[0].related_note.taxonomy_key, "idea");
    assert.equal(secondListedNote.relationships[0].related_note.confidence, 0.9);
    assert.equal(secondListedNote.relationships[0].related_note.classificationConfidence, 0.9);
    assert.equal(secondListedNote.relationships[0].relationship_type, "shared_keyword");

    assert.deepEqual(unlinkedListedNote.relationships, []);
  });
});

test("GET /sources returns tracked senders with current email counts and last-seen timestamps", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-sources-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_sources_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_sources_2",
        from: "Signals Weekly <EDITOR@example.com>",
        timestamp: "2026-03-09T18:00:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        received_timestamp: "2026-03-09T18:00:05Z",
      },
    };
    storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-sources-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });

    const thirdPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_sources_3",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_sources_3",
        from: "Research Brief <briefs@example.com>",
        timestamp: "2026-03-09T17:30:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        received_timestamp: "2026-03-09T17:30:05Z",
      },
    };
    storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-sources-3",
      eventType: thirdPayload.event_type,
      rawPayload: JSON.stringify(thirdPayload),
      payload: thirdPayload,
    });

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/sources");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.deepEqual(response.payload, {
      sources: [
        {
          sender_address: "editor@example.com",
          email_count: 2,
          last_seen_at: "2026-03-09T18:00:05Z",
        },
        {
          sender_address: "briefs@example.com",
          email_count: 1,
          last_seen_at: "2026-03-09T17:30:05Z",
        },
      ],
    });
  });
});

test("GET /stats returns a zeroed contract when no emails or notes have been processed", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/stats");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.deepEqual(response.payload, {
      note_counts_by_type: TAXONOMY_TYPES.map((taxonomyType) => ({
        taxonomy_key: taxonomyType.key,
        label: taxonomyType.label,
        count: 0,
      })),
      email_counts: {
        processed: 0,
        skipped: 0,
      },
      top_connected_notes: [],
    });
  });
});

test("GET /digests/daily validates the date query parameter", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const missingDateResponse = await requestJson(handler, "/digests/daily");
    assert.equal(missingDateResponse.statusCode, 400);
    assert.deepEqual(missingDateResponse.payload, {
      error: "The date query parameter is required",
    });

    const invalidDateResponse = await requestJson(handler, "/digests/daily?date=2026-02-30");
    assert.equal(invalidDateResponse.statusCode, 400);
    assert.deepEqual(invalidDateResponse.payload, {
      error: "The date query parameter must use YYYY-MM-DD format",
    });
  });
});

test("GET /digests/daily returns notes for the requested calendar day", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });
    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "Morning workflow insight",
        content: "Teams are auditing workflow prompts every morning.",
        summary: "Morning prompt audits are becoming routine.",
        sourceExcerpt: "Teams are auditing workflow prompts every morning.",
        sourceTimestamp: "2026-03-09T08:15:00Z",
        confidence: 0.9,
        keywords: ["workflow", "prompts"],
      },
    ]);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_digest_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_digest_2",
        subject: "Late-day automation notes",
        timestamp: "2026-03-09T21:45:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Late-day automation notes",
        received_timestamp: "2026-03-09T21:45:05Z",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });
    replaceNotesForEmail(db, secondDelivery.emailId, [
      {
        type: "fact",
        title: "Automation teams reduced manual tagging",
        content: "Automation teams reduced manual tagging in the evening batch.",
        summary: "Manual tagging fell in the latest evening batch.",
        sourceExcerpt: "Automation teams reduced manual tagging in the evening batch.",
        sourceTimestamp: "2026-03-09T21:45:00Z",
        confidence: 0.82,
        keywords: ["automation", "tagging"],
      },
    ]);

    const thirdPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_digest_3",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_digest_3",
        subject: "Next day tooling update",
        timestamp: "2026-03-10T06:30:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Next day tooling update",
        received_timestamp: "2026-03-10T06:30:05Z",
      },
    };
    const thirdDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-3",
      eventType: thirdPayload.event_type,
      rawPayload: JSON.stringify(thirdPayload),
      payload: thirdPayload,
    });
    replaceNotesForEmail(db, thirdDelivery.emailId, [
      {
        type: "tool_update",
        title: "Tooling dashboard shipped overnight",
        content: "A new tooling dashboard shipped overnight for operators.",
        summary: "Operators have a new dashboard.",
        sourceExcerpt: "A new tooling dashboard shipped overnight for operators.",
        sourceTimestamp: "2026-03-10T06:30:00Z",
        confidence: 0.87,
        keywords: ["dashboard", "operators"],
      },
    ]);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/digests/daily?date=2026-03-09");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.date, "2026-03-09");
    assert.equal(response.payload.note_count, 2);
    assert.deepEqual(
      response.payload.notes.map((note) => note.title),
      [
        "Automation teams reduced manual tagging",
        "Morning workflow insight",
      ]
    );
    assert.deepEqual(
      response.payload.notes.map((note) => note.taxonomy_key),
      ["fact", "idea"]
    );
    assert.ok(response.payload.notes.every((note) => note.relationships.length === 0));
    assert.equal(
      response.payload.summary,
      "Manual tagging fell in the latest evening batch. Morning prompt audits are becoming routine."
    );
    assert.equal(response.payload.sections.length, TAXONOMY_TYPES.length);

    const sectionsByKey = new Map(
      response.payload.sections.map((section) => [section.taxonomy_key, section])
    );

    assert.deepEqual(sectionsByKey.get("fact"), {
      taxonomy_key: "fact",
      label: "Fact",
      note_count: 1,
      summary: "Manual tagging fell in the latest evening batch.",
      notes: [response.payload.notes[0]],
    });
    assert.deepEqual(sectionsByKey.get("idea"), {
      taxonomy_key: "idea",
      label: "Idea",
      note_count: 1,
      summary: "Morning prompt audits are becoming routine.",
      notes: [response.payload.notes[1]],
    });
    assert.deepEqual(sectionsByKey.get("tool_update"), {
      taxonomy_key: "tool_update",
      label: "Tool Update",
      note_count: 0,
      summary: null,
      notes: [],
    });
  });
});

test("GET /digests/daily reuses the persisted digest text for the requested date", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-reuse-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });
    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "Morning workflow insight",
        content: "Teams are auditing workflow prompts every morning.",
        summary: "Morning prompt audits are becoming routine.",
        sourceExcerpt: "Teams are auditing workflow prompts every morning.",
        sourceTimestamp: "2026-03-09T08:15:00Z",
        confidence: 0.9,
        keywords: ["workflow", "prompts"],
      },
    ]);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_digest_reuse_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_digest_reuse_2",
        subject: "Late-day automation notes",
        timestamp: "2026-03-09T21:45:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Late-day automation notes",
        received_timestamp: "2026-03-09T21:45:05Z",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-reuse-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });
    replaceNotesForEmail(db, secondDelivery.emailId, [
      {
        type: "fact",
        title: "Automation teams reduced manual tagging",
        content: "Automation teams reduced manual tagging in the evening batch.",
        summary: "Manual tagging fell in the latest evening batch.",
        sourceExcerpt: "Automation teams reduced manual tagging in the evening batch.",
        sourceTimestamp: "2026-03-09T21:45:00Z",
        confidence: 0.82,
        keywords: ["automation", "tagging"],
      },
    ]);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const firstResponse = await requestJson(handler, "/digests/daily?date=2026-03-09");

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(
      firstResponse.payload.summary,
      "Manual tagging fell in the latest evening batch. Morning prompt audits are becoming routine."
    );

    db.prepare(`
      UPDATE digests
      SET digest_text = ?
      WHERE range_start = ?
        AND range_end = ?
    `).run(
      "Persisted digest text should be reused by the endpoint.",
      "2026-03-09",
      "2026-03-09"
    );

    const secondResponse = await requestJson(handler, "/digests/daily?date=2026-03-09");
    const digestRowCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM digests
      WHERE range_start = ?
        AND range_end = ?
    `).get("2026-03-09", "2026-03-09");

    assert.equal(secondResponse.statusCode, 200);
    assert.equal(
      secondResponse.payload.summary,
      "Persisted digest text should be reused by the endpoint."
    );
    assert.equal(digestRowCount.count, 1);
  });
});

test("GET /digests/daily highlights the day's top shared themes", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-theme-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });
    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "Workflow audits are becoming routine",
        content: "Teams are standardizing workflow audits before launch.",
        summary: "Workflow audits are becoming routine.",
        sourceExcerpt: "Teams are standardizing workflow audits before launch.",
        sourceTimestamp: "2026-03-09T08:15:00Z",
        confidence: 0.9,
        topics: ["workflow automation"],
        keywords: ["prompt audit", "ops"],
      },
    ]);
    const [firstNote] = listNotesByEmailId(db, firstDelivery.emailId);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_digest_theme_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_digest_theme_2",
        subject: "Workflow automation reviews",
        timestamp: "2026-03-09T12:30:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Workflow automation reviews",
        received_timestamp: "2026-03-09T12:30:05Z",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-theme-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });
    replaceNotesForEmail(db, secondDelivery.emailId, [
      {
        type: "fact",
        title: "Operators formalized workflow automation reviews",
        content: "Operators formalized workflow automation reviews this afternoon.",
        summary: "Workflow automation reviews were formalized.",
        sourceExcerpt: "Operators formalized workflow automation reviews this afternoon.",
        sourceTimestamp: "2026-03-09T12:30:00Z",
        confidence: 0.82,
        topics: ["workflow automation"],
        keywords: ["finance"],
      },
    ]);
    const [secondNote] = listNotesByEmailId(db, secondDelivery.emailId);

    const thirdPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_digest_theme_3",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_digest_theme_3",
        subject: "Prompt audit checklist",
        timestamp: "2026-03-09T18:45:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Prompt audit checklist",
        received_timestamp: "2026-03-09T18:45:05Z",
      },
    };
    const thirdDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-theme-3",
      eventType: thirdPayload.event_type,
      rawPayload: JSON.stringify(thirdPayload),
      payload: thirdPayload,
    });
    replaceNotesForEmail(db, thirdDelivery.emailId, [
      {
        type: "task",
        title: "Run the prompt audit checklist",
        content: "Run the prompt audit checklist before tonight's deployment.",
        summary: "Run the prompt audit checklist before deployment.",
        sourceExcerpt: "Run the prompt audit checklist before tonight's deployment.",
        sourceTimestamp: "2026-03-09T18:45:00Z",
        confidence: 0.88,
        keywords: ["prompt audit", "checklist"],
      },
    ]);
    const [thirdNote] = listNotesByEmailId(db, thirdDelivery.emailId);

    const nextDayPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_digest_theme_4",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_digest_theme_4",
        subject: "Next day workflow automation update",
        timestamp: "2026-03-10T06:30:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Next day workflow automation update",
        received_timestamp: "2026-03-10T06:30:05Z",
      },
    };
    const nextDayDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-digest-theme-4",
      eventType: nextDayPayload.event_type,
      rawPayload: JSON.stringify(nextDayPayload),
      payload: nextDayPayload,
    });
    replaceNotesForEmail(db, nextDayDelivery.emailId, [
      {
        type: "tool_update",
        title: "Next-day workflow automation update",
        content: "Workflow automation shipped a next-day dashboard update.",
        summary: "Workflow automation shipped a next-day dashboard update.",
        sourceExcerpt: "Workflow automation shipped a next-day dashboard update.",
        sourceTimestamp: "2026-03-10T06:30:00Z",
        confidence: 0.87,
        topics: ["workflow automation"],
        keywords: ["prompt audit"],
      },
    ]);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/digests/daily?date=2026-03-09");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload.top_themes, [
      {
        theme: "workflow automation",
        source: "topic",
        note_count: 2,
        count: 2,
        note_ids: [firstNote.id, secondNote.id],
      },
      {
        theme: "prompt audit",
        source: "keyword",
        note_count: 2,
        count: 2,
        note_ids: [firstNote.id, thirdNote.id],
      },
    ]);
  });
});

test("GET /digests/daily highlights the day's most important action items", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-action-digest-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });
    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "task",
        title: "Review prompt audit backlog",
        content: "Review the prompt audit backlog before the daily launch.",
        summary: "Review the prompt audit backlog before the daily launch.",
        sourceExcerpt: "Review the prompt audit backlog before the daily launch.",
        sourceTimestamp: "2026-03-09T09:00:00Z",
        confidence: 0.92,
        keywords: ["prompt audit", "ops"],
      },
    ]);
    const [taskNote] = listNotesByEmailId(db, firstDelivery.emailId);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_action_digest_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_action_digest_2",
        subject: "Weekly operator checklist",
        timestamp: "2026-03-09T10:15:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Weekly operator checklist",
        received_timestamp: "2026-03-09T10:15:05Z",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-action-digest-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });
    replaceNotesForEmail(
      db,
      secondDelivery.emailId,
      [
        {
          type: "playbook_candidate",
          title: "Codify a weekly audit checklist",
          content: "Create a reusable weekly prompt audit checklist for operators.",
          summary: "Create a reusable weekly prompt audit checklist.",
          sourceExcerpt: "Create a reusable weekly prompt audit checklist for operators.",
          sourceTimestamp: "2026-03-09T10:15:00Z",
          confidence: 0.8,
          keywords: ["prompt audit", "checklist"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: taskNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["prompt audit"],
            score: 1,
          },
        ],
      }
    );
    const [playbookNote] = listNotesByEmailId(db, secondDelivery.emailId);
    const feedbackNote = storeNoteFeedback(db, playbookNote.id, {
      useful: true,
      comment: "Worth operationalizing",
    });

    const thirdPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_action_digest_3",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_action_digest_3",
        subject: "Finance pilot idea",
        timestamp: "2026-03-09T11:30:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Finance pilot idea",
        received_timestamp: "2026-03-09T11:30:05Z",
      },
    };
    const thirdDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-action-digest-3",
      eventType: thirdPayload.event_type,
      rawPayload: JSON.stringify(thirdPayload),
      payload: thirdPayload,
    });
    replaceNotesForEmail(db, thirdDelivery.emailId, [
      {
        type: "opportunity",
        title: "Pilot the finance renewal copilot",
        content: "Pilot the finance renewal copilot with one renewals pod.",
        summary: "Pilot the finance renewal copilot with one renewals pod.",
        sourceExcerpt: "Pilot the finance renewal copilot with one renewals pod.",
        sourceTimestamp: "2026-03-09T11:30:00Z",
        confidence: 0.74,
        keywords: ["finance", "pilot"],
      },
    ]);

    const fourthPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_action_digest_4",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_action_digest_4",
        subject: "Next day tooling checklist",
        timestamp: "2026-03-10T06:30:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Next day tooling checklist",
        received_timestamp: "2026-03-10T06:30:05Z",
      },
    };
    const fourthDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-action-digest-4",
      eventType: fourthPayload.event_type,
      rawPayload: JSON.stringify(fourthPayload),
      payload: fourthPayload,
    });
    replaceNotesForEmail(db, fourthDelivery.emailId, [
      {
        type: "task",
        title: "Review the next-day tooling launch checklist",
        content: "Review the next-day tooling launch checklist before rollout.",
        summary: "Review the next-day tooling launch checklist before rollout.",
        sourceExcerpt: "Review the next-day tooling launch checklist before rollout.",
        sourceTimestamp: "2026-03-10T06:30:00Z",
        confidence: 0.88,
        keywords: ["launch", "tooling"],
      },
    ]);

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/digests/daily?date=2026-03-09");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.payload.action_items.map((item) => ({
        title: item.title,
        taxonomy_key: item.taxonomy_key,
        action: item.action,
      })),
      [
        {
          title: "Review prompt audit backlog",
          taxonomy_key: "task",
          action: "Review the prompt audit backlog before the daily launch.",
        },
        {
          title: "Codify a weekly audit checklist",
          taxonomy_key: "playbook_candidate",
          action: "Create a reusable weekly prompt audit checklist.",
        },
        {
          title: "Pilot the finance renewal copilot",
          taxonomy_key: "opportunity",
          action: "Pilot the finance renewal copilot with one renewals pod.",
        },
      ]
    );
    assert.ok(response.payload.action_items[0].connection_count >= 1);
    assert.ok(response.payload.action_items[1].connection_count >= 1);
    assert.ok(response.payload.action_items[0].keywords.includes("prompt audit"));
    assert.ok(response.payload.action_items[0].keywords.includes("ops"));
    assert.ok(response.payload.action_items[1].keywords.includes("checklist"));
    assert.ok(response.payload.action_items[2].keywords.includes("finance"));
    assert.ok(response.payload.action_items[2].keywords.includes("pilot"));
    assert.equal(response.payload.action_items[1].feedback.useful, true);
    assert.equal(response.payload.action_items[1].feedback.comment, "Worth operationalizing");
    assert.equal(
      response.payload.action_items[1].feedback.updated_at,
      feedbackNote.feedback.updated_at
    );
  });
});

test("GET /stats returns note counts, processed-vs-skipped email totals, and the top five connected notes", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-stats-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });
    replaceNotesForEmail(db, firstDelivery.emailId, [
      {
        type: "idea",
        title: "Finance teams standardize on AI copilots",
        content: "Finance teams are standardizing on AI copilots for renewals.",
        summary: "AI copilots are becoming standard in finance renewals.",
        sourceExcerpt: "Finance teams are standardizing on AI copilots for renewals.",
        sourceTimestamp: "2026-03-09T17:00:00Z",
        confidence: 0.91,
        keywords: ["finance", "ai copilot"],
      },
    ]);
    updateEmailProcessingState(db, firstDelivery.emailId, {
      status: "processed",
      relevanceStatus: "relevant",
    });
    const [firstNote] = listNotesByEmailId(db, firstDelivery.emailId);

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_stats_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_stats_2",
        subject: "Renewal efficiency jumps with copilots",
        timestamp: "2026-03-09T17:01:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Renewal efficiency jumps with copilots",
        received_timestamp: "2026-03-09T17:01:05Z",
      },
    };
    const secondDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-stats-2",
      eventType: secondPayload.event_type,
      rawPayload: JSON.stringify(secondPayload),
      payload: secondPayload,
    });
    replaceNotesForEmail(
      db,
      secondDelivery.emailId,
      [
        {
          type: "fact",
          title: "AI copilots expand renewal efficiency",
          content: "AI copilots cut manual renewal work for finance teams.",
          summary: "Finance renewal work is becoming more efficient.",
          sourceExcerpt: "AI copilots cut manual renewal work for finance teams.",
          sourceTimestamp: "2026-03-09T17:01:00Z",
          confidence: 0.84,
          keywords: ["finance", "renewal"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["finance"],
            score: 1,
          },
        ],
      }
    );
    updateEmailProcessingState(db, secondDelivery.emailId, {
      status: "processed",
      relevanceStatus: "relevant",
    });
    const [secondNote] = listNotesByEmailId(db, secondDelivery.emailId);

    const thirdPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_stats_3",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_stats_3",
        subject: "Vendor ships a finance copilot dashboard",
        timestamp: "2026-03-09T17:02:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Vendor ships a finance copilot dashboard",
        received_timestamp: "2026-03-09T17:02:05Z",
      },
    };
    const thirdDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-stats-3",
      eventType: thirdPayload.event_type,
      rawPayload: JSON.stringify(thirdPayload),
      payload: thirdPayload,
    });
    replaceNotesForEmail(
      db,
      thirdDelivery.emailId,
      [
        {
          type: "tool_update",
          title: "Vendor ships a finance copilot dashboard",
          content: "A vendor shipped a dashboard for finance copilot teams.",
          summary: "A finance-focused dashboard is now available.",
          sourceExcerpt: "A vendor shipped a dashboard for finance copilot teams.",
          sourceTimestamp: "2026-03-09T17:02:00Z",
          confidence: 0.88,
          keywords: ["finance", "dashboard"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["finance"],
            score: 1,
          },
          {
            newNoteIndex: 0,
            existingNoteId: secondNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["renewal"],
            score: 1,
          },
        ],
      }
    );
    updateEmailProcessingState(db, thirdDelivery.emailId, {
      status: "processed",
      relevanceStatus: "relevant",
    });
    const [thirdNote] = listNotesByEmailId(db, thirdDelivery.emailId);

    const fourthPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_stats_4",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_stats_4",
        subject: "Renewal workflows consolidate around copilots",
        timestamp: "2026-03-09T17:03:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Renewal workflows consolidate around copilots",
        received_timestamp: "2026-03-09T17:03:05Z",
      },
    };
    const fourthDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-stats-4",
      eventType: fourthPayload.event_type,
      rawPayload: JSON.stringify(fourthPayload),
      payload: fourthPayload,
    });
    replaceNotesForEmail(
      db,
      fourthDelivery.emailId,
      [
        {
          type: "pattern_trend",
          title: "Renewal workflows consolidate around copilots",
          content: "Renewal workflows are consolidating around copilots.",
          summary: "Copilot-led renewal workflows are consolidating.",
          sourceExcerpt: "Renewal workflows are consolidating around copilots.",
          sourceTimestamp: "2026-03-09T17:03:00Z",
          confidence: 0.77,
          keywords: ["copilot", "renewal"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["copilot"],
            score: 1,
          },
          {
            newNoteIndex: 0,
            existingNoteId: secondNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["renewal"],
            score: 1,
          },
        ],
      }
    );
    updateEmailProcessingState(db, fourthDelivery.emailId, {
      status: "processed",
      relevanceStatus: "relevant",
    });
    const [fourthNote] = listNotesByEmailId(db, fourthDelivery.emailId);

    const fifthPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_stats_5",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_stats_5",
        subject: "Compliance reviews lag behind finance copilots",
        timestamp: "2026-03-09T17:04:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Compliance reviews lag behind finance copilots",
        received_timestamp: "2026-03-09T17:04:05Z",
      },
    };
    const fifthDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-stats-5",
      eventType: fifthPayload.event_type,
      rawPayload: JSON.stringify(fifthPayload),
      payload: fifthPayload,
    });
    replaceNotesForEmail(
      db,
      fifthDelivery.emailId,
      [
        {
          type: "warning_risk",
          title: "Compliance reviews lag behind finance copilots",
          content: "Compliance reviews are lagging behind finance copilots.",
          summary: "Compliance review is trailing adoption.",
          sourceExcerpt: "Compliance reviews are lagging behind finance copilots.",
          sourceTimestamp: "2026-03-09T17:04:00Z",
          confidence: 0.73,
          keywords: ["finance", "dashboard"],
        },
      ],
      {
        detectedRelationships: [
          {
            newNoteIndex: 0,
            existingNoteId: firstNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["finance"],
            score: 1,
          },
          {
            newNoteIndex: 0,
            existingNoteId: thirdNote.id,
            relationshipType: "shared_keyword",
            sharedKeywords: ["dashboard"],
            score: 1,
          },
        ],
      }
    );
    updateEmailProcessingState(db, fifthDelivery.emailId, {
      status: "processed",
      relevanceStatus: "relevant",
    });
    const [fifthNote] = listNotesByEmailId(db, fifthDelivery.emailId);

    const skippedPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_stats_6",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_stats_6",
        subject: "Flash sale: save 50% on agent templates today",
        from: "Offers Team <promo@example.com>",
        timestamp: "2026-03-09T17:05:00Z",
        extracted_text:
          "Limited time offer. Use promo code SAVE50. Buy now and start your free trial today.",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        subject: "Flash sale: save 50% on agent templates today",
        received_timestamp: "2026-03-09T17:05:05Z",
      },
    };
    const skippedDelivery = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-server-stats-6",
      eventType: skippedPayload.event_type,
      rawPayload: JSON.stringify(skippedPayload),
      payload: skippedPayload,
    });
    updateEmailProcessingState(db, skippedDelivery.emailId, {
      status: "skipped",
      relevanceStatus: "promotion",
    });

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/stats");
    const countsByKey = new Map(
      response.payload.note_counts_by_type.map((taxonomyTypeCount) => [
        taxonomyTypeCount.taxonomy_key,
        taxonomyTypeCount,
      ])
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(response.payload.note_counts_by_type.length, TAXONOMY_TYPES.length);
    assert.deepEqual(response.payload.email_counts, {
      processed: 5,
      skipped: 1,
    });
    assert.deepEqual(countsByKey.get("idea"), {
      taxonomy_key: "idea",
      label: "Idea",
      count: 1,
    });
    assert.deepEqual(countsByKey.get("fact"), {
      taxonomy_key: "fact",
      label: "Fact",
      count: 1,
    });
    assert.deepEqual(countsByKey.get("tool_update"), {
      taxonomy_key: "tool_update",
      label: "Tool Update",
      count: 1,
    });
    assert.deepEqual(countsByKey.get("pattern_trend"), {
      taxonomy_key: "pattern_trend",
      label: "Pattern/Trend",
      count: 1,
    });
    assert.deepEqual(countsByKey.get("warning_risk"), {
      taxonomy_key: "warning_risk",
      label: "Warning/Risk",
      count: 1,
    });
    assert.deepEqual(countsByKey.get("claim"), {
      taxonomy_key: "claim",
      label: "Claim",
      count: 0,
    });
    assert.deepEqual(response.payload.top_connected_notes, [
      {
        id: firstNote.id,
        email_id: firstDelivery.emailId,
        taxonomy_key: "idea",
        title: "Finance teams standardize on AI copilots",
        summary: "AI copilots are becoming standard in finance renewals.",
        source_timestamp: "2026-03-09T17:00:00Z",
        confidence: 0.91,
        classificationConfidence: 0.91,
        created_at: firstNote.created_at,
        updated_at: firstNote.updated_at,
        connection_count: 4,
      },
      {
        id: thirdNote.id,
        email_id: thirdDelivery.emailId,
        taxonomy_key: "tool_update",
        title: "Vendor ships a finance copilot dashboard",
        summary: "A finance-focused dashboard is now available.",
        source_timestamp: "2026-03-09T17:02:00Z",
        confidence: 0.88,
        classificationConfidence: 0.88,
        created_at: thirdNote.created_at,
        updated_at: thirdNote.updated_at,
        connection_count: 3,
      },
      {
        id: secondNote.id,
        email_id: secondDelivery.emailId,
        taxonomy_key: "fact",
        title: "AI copilots expand renewal efficiency",
        summary: "Finance renewal work is becoming more efficient.",
        source_timestamp: "2026-03-09T17:01:00Z",
        confidence: 0.84,
        classificationConfidence: 0.84,
        created_at: secondNote.created_at,
        updated_at: secondNote.updated_at,
        connection_count: 3,
      },
      {
        id: fifthNote.id,
        email_id: fifthDelivery.emailId,
        taxonomy_key: "warning_risk",
        title: "Compliance reviews lag behind finance copilots",
        summary: "Compliance review is trailing adoption.",
        source_timestamp: "2026-03-09T17:04:00Z",
        confidence: 0.73,
        classificationConfidence: 0.73,
        created_at: fifthNote.created_at,
        updated_at: fifthNote.updated_at,
        connection_count: 2,
      },
      {
        id: fourthNote.id,
        email_id: fourthDelivery.emailId,
        taxonomy_key: "pattern_trend",
        title: "Renewal workflows consolidate around copilots",
        summary: "Copilot-led renewal workflows are consolidating.",
        source_timestamp: "2026-03-09T17:03:00Z",
        confidence: 0.77,
        classificationConfidence: 0.77,
        created_at: fourthNote.created_at,
        updated_at: fourthNote.updated_at,
        connection_count: 2,
      },
    ]);
  });
});

test("GET /notes rejects a blank topic query parameter", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const response = await requestJson(handler, "/notes?topic=%20");

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.payload, {
      error: "The topic query parameter is required",
    });
  });
});

test("POST /webhooks/agentmail rejects non-object JSON payloads before storing them", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const response = await requestWebhookBody(handler, "[]");

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.payload, {
      error: "AgentMail webhook payload must be a JSON object",
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM webhook_deliveries").get().count,
      0
    );
  });
});

test("POST /webhooks/agentmail requires event_type before entering the storage flow", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const payload = buildAgentMailPayload();
    delete payload.event_type;

    const response = await requestWebhook(handler, payload);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.payload, {
      error: "AgentMail webhook payload is missing event_type",
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM webhook_deliveries").get().count,
      0
    );
  });
});

test("POST /webhooks/agentmail validates message.received payload structure before storage", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const payload = buildAgentMailPayload();
    delete payload.message.message_id;

    const response = await requestWebhook(handler, payload);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.payload, {
      error: "AgentMail message.received payload is missing message.message_id",
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM webhook_deliveries").get().count,
      0
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM emails").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM raw_emails").get().count, 0);
  });
});

test("POST /webhooks/agentmail delegates accepted payload persistence to the storage layer", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const rawPayload = JSON.stringify(payload);
    let capturedInvocation = null;
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
      jobWorker: {
        signal() {},
      },
      storeWebhookDelivery(databaseArg, storeInput) {
        capturedInvocation = {
          databaseArg,
          storeInput,
        };

        return {
          webhookDeliveryId: 411,
          rawEmailId: 522,
          emailId: 633,
          storedEmail: true,
          status: "stored",
          processingJobId: 744,
          jobStatus: "queued",
        };
      },
    });

    const response = await requestWebhook(handler, payload, {
      headers: {
        "svix-id": "svix-wired-store-1",
        "svix-signature": "v1,store-wiring-signature",
        "svix-timestamp": "1710001111",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, {
      ok: true,
      eventType: "message.received",
      deliveryId: "svix-wired-store-1",
      webhookDeliveryId: 411,
      rawEmailId: 522,
      emailId: 633,
      status: "stored",
      processingJobId: 744,
      jobStatus: "queued",
    });
    assert.equal(capturedInvocation?.databaseArg, db);
    assert.equal(capturedInvocation?.storeInput.deliveryId, "svix-wired-store-1");
    assert.equal(capturedInvocation?.storeInput.eventType, "message.received");
    assert.equal(capturedInvocation?.storeInput.rawPayload, rawPayload);
    assert.deepEqual(capturedInvocation?.storeInput.payload, payload);
    assert.deepEqual(capturedInvocation?.storeInput.receipt, {
      webhookPath: "/webhooks/agentmail",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        "svix-id": "svix-wired-store-1",
        "svix-signature": "v1,store-wiring-signature",
        "svix-timestamp": "1710001111",
      },
      contentType: "application/json",
      userAgent: null,
      signature: "v1,store-wiring-signature",
      timestamp: "1710001111",
      sourceIp: null,
      bodyBytes: Buffer.byteLength(rawPayload, "utf8"),
    });
  });
});

test("POST /webhooks/agentmail returns 500 when webhook storage reports a failed insert", async () => {
  await withTestDatabase(async (db) => {
    let callCount = 0;
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
      storeWebhookDelivery() {
        callCount += 1;

        return {
          webhookDeliveryId: 901,
          rawEmailId: null,
          emailId: null,
          storedEmail: false,
          status: "failed",
          processingJobId: null,
          jobStatus: null,
        };
      },
    });

    const response = await requestWebhook(handler, buildAgentMailPayload(), {
      headers: {
        "svix-id": "svix-store-failed-1",
      },
    });

    assert.equal(callCount, 1);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.payload, {
      error: "Failed to persist AgentMail webhook payload",
    });
  });
});

test("POST /webhooks/agentmail normalizes unsupported event types and returns an ignored success response", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const payload = {
      event_id: "evt_server_ignored_1",
      event_type: " Thread.Updated ",
      thread: {
        inbox_id: "inbox_news",
      },
    };

    const response = await requestWebhook(handler, payload, {
      headers: {
        "svix-id": "  svix-ignored-event-1  ",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, {
      ok: true,
      eventType: "thread.updated",
      deliveryId: "svix-ignored-event-1",
      webhookDeliveryId: response.payload.webhookDeliveryId,
      rawEmailId: null,
      emailId: null,
      status: "ignored",
      processingJobId: null,
      jobStatus: null,
    });

    const delivery = db
      .prepare(`
        SELECT delivery_id, event_type, status
        FROM webhook_deliveries
        WHERE id = ?
      `)
      .get(response.payload.webhookDeliveryId);

    assert.deepEqual({ ...delivery }, {
      delivery_id: "svix-ignored-event-1",
      event_type: "thread.updated",
      status: "ignored",
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM emails").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM raw_emails").get().count, 0);
  });
});

test("POST /webhooks stores the raw AgentMail payload before returning success", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const rawPayload = JSON.stringify(payload);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
      jobWorker: {
        signal() {},
      },
    });

    const response = await requestWebhook(handler, payload, {
      url: "/webhooks",
      headers: {
        "svix-id": "svix-server-raw-payload-1",
        "svix-signature": "v1,server-test-signature",
        "svix-timestamp": "1710000100",
        "user-agent": "AgentMail-Webhook-Test/2.0",
        "x-forwarded-for": "198.51.100.22, 198.51.100.23",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.status, "stored");
    assert.ok(Number.isInteger(response.payload.rawEmailId));

    const delivery = db
      .prepare(`
        SELECT
          delivery_id,
          event_id,
          event_type,
          webhook_path,
          content_type,
          body_bytes,
          payload_sha256,
          headers_json,
          svix_signature,
          svix_timestamp,
          user_agent,
          source_ip,
          payload,
          status
        FROM webhook_deliveries
        WHERE id = ?
      `)
      .get(response.payload.webhookDeliveryId);
    assert.deepEqual(
      {
        delivery_id: delivery.delivery_id,
        event_id: delivery.event_id,
        event_type: delivery.event_type,
        webhook_path: delivery.webhook_path,
        content_type: delivery.content_type,
        body_bytes: delivery.body_bytes,
        headers_json: JSON.parse(delivery.headers_json),
        svix_signature: delivery.svix_signature,
        svix_timestamp: delivery.svix_timestamp,
        user_agent: delivery.user_agent,
        source_ip: delivery.source_ip,
        payload: delivery.payload,
        status: delivery.status,
      },
      {
        delivery_id: "svix-server-raw-payload-1",
        event_id: payload.event_id,
        event_type: "message.received",
        webhook_path: "/webhooks",
        content_type: "application/json",
        body_bytes: Buffer.byteLength(rawPayload, "utf8"),
        headers_json: {
          host: "localhost",
          "content-type": "application/json",
          "svix-id": "svix-server-raw-payload-1",
          "svix-signature": "v1,server-test-signature",
          "svix-timestamp": "1710000100",
          "user-agent": "AgentMail-Webhook-Test/2.0",
          "x-forwarded-for": "198.51.100.22, 198.51.100.23",
        },
        svix_signature: "v1,server-test-signature",
        svix_timestamp: "1710000100",
        user_agent: "AgentMail-Webhook-Test/2.0",
        source_ip: "198.51.100.22",
        payload: rawPayload,
        status: "stored",
      }
    );
    assert.match(delivery.payload_sha256, /^[a-f0-9]{64}$/);

    const email = db
      .prepare(`
        SELECT agentmail_message_id, raw_payload, ingestion_status, relevance_status
        FROM emails
        WHERE id = ?
      `)
      .get(response.payload.emailId);
    assert.deepEqual(
      {
        agentmail_message_id: email.agentmail_message_id,
        raw_payload: email.raw_payload,
        ingestion_status: email.ingestion_status,
        relevance_status: email.relevance_status,
      },
      {
        agentmail_message_id: payload.message.message_id,
        raw_payload: rawPayload,
        ingestion_status: "received",
        relevance_status: "pending",
      }
    );

    const rawEmail = db
      .prepare(`
        SELECT
          agentmail_message_id,
          delivery_id,
          raw_payload,
          subject
        FROM raw_emails
        WHERE id = ?
      `)
      .get(response.payload.rawEmailId);
    assert.deepEqual(
      {
        agentmail_message_id: rawEmail.agentmail_message_id,
        delivery_id: rawEmail.delivery_id,
        raw_payload: rawEmail.raw_payload,
        subject: rawEmail.subject,
      },
      {
        agentmail_message_id: payload.message.message_id,
        delivery_id: "svix-server-raw-payload-1",
        raw_payload: rawPayload,
        subject: payload.message.subject,
      }
    );
  });
});

test("POST /webhooks/agentmail persists the raw email record before returning success", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload({
      event_id: "evt_server_raw_route_1",
      message: {
        message_id: "msg_server_raw_route_1",
        subject: "AgentMail route persistence contract",
      },
    });
    const rawPayload = JSON.stringify(payload);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
      jobWorker: {
        signal() {},
      },
    });

    const response = await requestWebhook(handler, payload, {
      headers: {
        "svix-id": "svix-server-agentmail-route-1",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.ok(Number.isInteger(response.payload.webhookDeliveryId));
    assert.ok(Number.isInteger(response.payload.rawEmailId));

    const rawEmail = db
      .prepare(`
        SELECT
          id,
          webhook_delivery_id,
          delivery_id,
          agentmail_message_id,
          raw_payload
        FROM raw_emails
        WHERE id = ?
      `)
      .get(response.payload.rawEmailId);

    assert.deepEqual(
      {
        id: rawEmail.id,
        webhook_delivery_id: rawEmail.webhook_delivery_id,
        delivery_id: rawEmail.delivery_id,
        agentmail_message_id: rawEmail.agentmail_message_id,
        raw_payload: rawEmail.raw_payload,
      },
      {
        id: response.payload.rawEmailId,
        webhook_delivery_id: response.payload.webhookDeliveryId,
        delivery_id: "svix-server-agentmail-route-1",
        agentmail_message_id: payload.message.message_id,
        raw_payload: rawPayload,
      }
    );
  });
});

test("POST /webhooks/agentmail upserts sources and refreshes sender activity for received newsletters", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
      jobWorker: {
        signal() {},
      },
    });

    const firstPayload = buildAgentMailPayload();
    const firstResponse = await requestWebhook(handler, firstPayload, {
      headers: {
        "svix-id": "svix-server-source-route-1",
      },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(firstResponse.payload.status, "stored");

    const firstSource = {
      ...db.prepare(`
      SELECT
        sender_address,
        display_name,
        email_count,
        first_seen_at,
        last_seen_at
      FROM sources
      WHERE sender_address = 'editor@example.com'
    `).get(),
    };

    assert.deepEqual(firstSource, {
      sender_address: "editor@example.com",
      display_name: "Signals Weekly",
      email_count: 1,
      first_seen_at: "2026-03-09 17:00:05",
      last_seen_at: "2026-03-09 17:00:05",
    });

    const secondPayload = {
      ...buildAgentMailPayload(),
      event_id: "evt_server_source_route_2",
      message: {
        ...buildAgentMailPayload().message,
        message_id: "msg_server_source_route_2",
        from: "Signals Weekly <EDITOR@example.com>",
        timestamp: "2026-03-09T18:00:00Z",
      },
      thread: {
        ...buildAgentMailPayload().thread,
        received_timestamp: "2026-03-09T18:00:05Z",
      },
    };

    const secondResponse = await requestWebhook(handler, secondPayload, {
      headers: {
        "svix-id": "svix-server-source-route-2",
      },
    });

    assert.equal(secondResponse.statusCode, 200);
    assert.equal(secondResponse.payload.status, "stored");

    const refreshedSource = {
      ...db.prepare(`
      SELECT
        sender_address,
        display_name,
        email_count,
        first_seen_at,
        last_seen_at
      FROM sources
      WHERE sender_address = 'editor@example.com'
    `).get(),
    };

    assert.deepEqual(refreshedSource, {
      sender_address: "editor@example.com",
      display_name: "Signals Weekly",
      email_count: 2,
      first_seen_at: "2026-03-09 17:00:05",
      last_seen_at: "2026-03-09 18:00:05",
    });
  });
});

test("POST /webhooks/agentmail rejects payloads larger than the webhook body limit", async () => {
  await withTestDatabase(async (db) => {
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });
    const largePayload = buildAgentMailPayload();
    largePayload.message.extracted_text = "x".repeat(1024 * 1024 * 2 + 256);

    const response = await requestWebhook(handler, largePayload, {
      headers: {
        "svix-id": "svix-server-oversized-1",
      },
    });

    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.payload, {
      error: "Request body exceeds 2097152 bytes",
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM webhook_deliveries").get().count,
      0
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM emails").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM raw_emails").get().count, 0);
  });
});

test("POST /webhooks/agentmail persists a queued job and signals the worker without inline note extraction", async () => {
  await withTestDatabase(async (db) => {
    let signalCount = 0;
    let noteProcessorCall = null;
    const payload = buildAgentMailPayload();
    const rawPayload = JSON.stringify(payload);
    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
      jobWorker: {
        signal() {
          signalCount += 1;
        },
      },
      noteProcessor: async (_database, emailId, options = {}) => {
        noteProcessorCall = {
          emailId,
          processingJobId: options.processingJobId ?? null,
        };
      },
    });

    const response = await requestWebhook(handler, payload, {
      headers: {
        "svix-id": "svix-server-job-1",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.equal(response.payload.jobStatus, "queued");
    assert.ok(Number.isInteger(response.payload.processingJobId));
    assert.equal(noteProcessorCall, null);

    const job = getEmailProcessingJobById(db, response.payload.processingJobId);
    assert.deepEqual(
      {
        email_id: job.email_id,
        raw_email_id: job.raw_email_id,
        raw_email_agentmail_message_id: job.raw_email_agentmail_message_id,
        raw_email_payload: job.raw_email_payload,
        webhook_delivery_id: job.webhook_delivery_id,
        status: job.status,
        attempts: job.attempts,
        error_message: job.error_message,
        started_at: job.started_at,
        completed_at: job.completed_at,
      },
      {
        email_id: response.payload.emailId,
        raw_email_id: response.payload.rawEmailId,
        raw_email_agentmail_message_id: payload.message.message_id,
        raw_email_payload: rawPayload,
        webhook_delivery_id: response.payload.webhookDeliveryId,
        status: "queued",
        attempts: 0,
        error_message: null,
        started_at: null,
        completed_at: null,
      }
    );

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(signalCount, 1);
    assert.equal(noteProcessorCall, null);
  });
});

test("POST /webhooks/agentmail logs deferred worker signal failures after returning 200", async () => {
  await withTestDatabase(async (db) => {
    const errors = [];
    const logger = {
      error(...args) {
        errors.push(args.map((value) => String(value)).join(" "));
      },
      warn() {},
    };
    const handler = createInboxHandler({
      database: db,
      logger,
      jobWorker: {
        signal() {
          throw new Error("worker signal failed");
        },
      },
    });

    const response = await requestWebhook(handler, buildAgentMailPayload(), {
      headers: {
        "svix-id": "svix-server-signal-error-1",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.equal(response.payload.jobStatus, "queued");

    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(
      errors.some(
        (entry) =>
          entry.includes("failed to signal background worker") &&
          entry.includes("worker signal failed")
      ),
      "expected worker signal failures to be logged asynchronously"
    );

    const events = listEmailProcessingEvents(db, {
      processingJobId: response.payload.processingJobId,
    }).map((event) => ({
      event_type: event.event_type,
      job_status: event.job_status,
      error_message: event.error_message,
      metadata: event.metadata,
    }));

    assert.deepEqual(events, [
        {
          event_type: "queued",
          job_status: "queued",
          error_message: null,
          metadata: {
            trigger: "webhook_delivery",
          },
        },
      {
        event_type: "worker_signal_failed",
        job_status: "queued",
        error_message: "worker signal failed",
        metadata: {
          phase: "dispatch",
        },
      },
    ]);
  });
});

test("POST /webhooks/agentmail leaves queued work queued when no worker is attached", async () => {
  await withTestDatabase(async (db) => {
    const warnings = [];
    let noteProcessorCall = null;
    const logger = {
      error() {},
      warn(...args) {
        warnings.push(args.map((value) => String(value)).join(" "));
      },
    };
    const handler = createInboxHandler({
      database: db,
      logger,
      noteProcessor: async (_database, emailId, options = {}) => {
        noteProcessorCall = {
          emailId,
          processingJobId: options.processingJobId ?? null,
        };
      },
    });

    const response = await requestWebhook(handler, buildAgentMailPayload(), {
      headers: {
        "svix-id": "svix-server-job-no-worker-1",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.equal(response.payload.jobStatus, "queued");
    assert.equal(noteProcessorCall, null);
    assert.equal(listNotesByEmailId(db, response.payload.emailId).length, 0);

    const job = getEmailProcessingJobById(db, response.payload.processingJobId);
    assert.equal(job?.status, "queued");
    assert.equal(job?.attempts, 0);

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(noteProcessorCall, null);
    assert.ok(
      warnings.some((entry) => entry.includes("no background worker is attached")),
      "expected a warning when queued work has no worker"
    );
    assert.equal(listNotesByEmailId(db, response.payload.emailId).length, 0);
    assert.equal(
      getEmailProcessingJobById(db, response.payload.processingJobId)?.status,
      "queued"
    );

    const events = listEmailProcessingEvents(db, {
      processingJobId: response.payload.processingJobId,
    }).map((event) => ({
      event_type: event.event_type,
      job_status: event.job_status,
      error_message: event.error_message,
      metadata: event.metadata,
    }));

    assert.deepEqual(events, [
        {
          event_type: "queued",
          job_status: "queued",
          error_message: null,
          metadata: {
            trigger: "webhook_delivery",
          },
        },
      {
        event_type: "worker_unavailable",
        job_status: "queued",
        error_message: null,
        metadata: {
          phase: "dispatch",
        },
      },
    ]);
  });
});

test("POST /webhooks/agentmail returns without deferred note extraction when no worker is attached", async () => {
  await withTestDatabase(async (db) => {
    const warnings = [];
    let noteProcessorCall = null;
    const logger = {
      error() {},
      warn(...args) {
        warnings.push(args.map((value) => String(value)).join(" "));
      },
    };
    const handler = createInboxHandler({
      database: db,
      logger,
      noteProcessor: async (_database, emailId, options = {}) => {
        noteProcessorCall = {
          emailId,
          processingJobId: options.processingJobId ?? null,
        };
      },
    });

    const response = await requestWebhook(handler, buildAgentMailPayload(), {
      headers: {
        "svix-id": "svix-server-deferred-note-1",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.equal(response.payload.jobStatus, "queued");
    assert.ok(Number.isInteger(response.payload.processingJobId));
    assert.equal(noteProcessorCall, null);
    assert.equal(
      getEmailProcessingJobById(db, response.payload.processingJobId)?.status,
      "queued"
    );

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(noteProcessorCall, null);
    assert.ok(
      warnings.some((entry) => entry.includes("job") && entry.includes("remains queued")),
      "expected queued work without a worker to be logged"
    );
  });
});
