import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  getEmailById,
  getEmailProcessingJobById,
  initializeDatabase,
  listNotesByEmailId,
  listRelationships,
  openDatabaseConnection,
  replaceNotesForEmail,
  storeAgentMailWebhookDelivery,
  TAXONOMY_TYPES,
} from "./database.mjs";
import {
  classifyEmailRelevance,
  generateAtomicNotes,
  processEmailToNotes,
} from "./note-pipeline.mjs";

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

function buildAgentMailPayload() {
  return {
    event_id: "evt_news_1",
    event_type: "message.received",
    message: {
      message_id: "msg_news_1",
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      from: "Signals Weekly <editor@example.com>",
      timestamp: "2026-03-09T17:00:00Z",
      extracted_text: [
        "Revenue from AI copilots grew 42% year over year across mid-market teams.",
        "Founders should review every workflow prompt weekly and delete low-signal automations.",
      ].join("\n\n"),
      headers: {
        "message-id": "<msg_news_1@example.com>",
      },
    },
    thread: {
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      received_timestamp: "2026-03-09T17:00:05Z",
    },
  };
}

test("classifyEmailRelevance distinguishes newsletters from spam, promotions, and non-newsletters", () => {
  assert.equal(
    classifyEmailRelevance({
      subject: "Newsletter signals for March",
      from_name: "Signals Weekly",
      from_address: "editor@example.com",
      text_content:
        "Revenue from AI copilots grew 42% year over year across mid-market teams.\n\nWhy it matters: teams are standardizing weekly prompt reviews.",
    }).relevanceStatus,
    "relevant"
  );

  assert.equal(
    classifyEmailRelevance({
      subject: "Flash sale: save 50% on agent templates today",
      from_name: "Offers Team",
      from_address: "promo@example.com",
      text_content:
        "Limited time offer. Use promo code SAVE50. Buy now and start your free trial today.",
    }).relevanceStatus,
    "promotion"
  );

  assert.equal(
    classifyEmailRelevance({
      subject: "Password reset verification code",
      from_name: "Security",
      from_address: "security@example.com",
      text_content: "Use verification code 123456 to finish signing in.",
    }).relevanceStatus,
    "non_newsletter"
  );

  assert.equal(
    classifyEmailRelevance({
      subject: "URGENT ACTION REQUIRED: claim your crypto reward",
      from_name: "Prize Desk",
      from_address: "winner@example.com",
      text_content: "You've been selected to claim your crypto reward via wire transfer.",
    }).relevanceStatus,
    "spam"
  );
});

test("processEmailToNotes persists multiple atomic notes with source timestamp", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const taxonomyKeys = db
        .prepare(`
          SELECT key
          FROM taxonomy_types
          ORDER BY key ASC
        `)
        .all()
        .map((row) => row.key);

      assert.deepEqual(
        taxonomyKeys,
        TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.key).sort()
      );

      const payload = buildAgentMailPayload();
      const rawPayload = JSON.stringify(payload);
      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-1",
        eventType: payload.event_type,
        rawPayload,
        payload,
      });

      assert.equal(deliveryResult.status, "stored");
      assert.ok(deliveryResult.emailId);
      assert.ok(Number.isInteger(deliveryResult.processingJobId));

      const queuedJob = getEmailProcessingJobById(db, deliveryResult.processingJobId);
      assert.equal(queuedJob.status, "queued");
      assert.equal(queuedJob.attempts, 0);
      assert.equal(queuedJob.raw_email_id, deliveryResult.rawEmailId);
      assert.equal(queuedJob.raw_email_agentmail_message_id, payload.message.message_id);
      assert.equal(queuedJob.raw_email_payload, rawPayload);
      assert.equal(queuedJob.started_at, null);
      assert.equal(queuedJob.completed_at, null);
      assert.equal(queuedJob.failed_at, null);

      const processed = await processEmailToNotes(db, deliveryResult.emailId, {
        logger: silentLogger,
        processingJobId: deliveryResult.processingJobId,
        generateAtomicNotes: async () => {
          const inFlightJob = getEmailProcessingJobById(db, deliveryResult.processingJobId);
          assert.equal(inFlightJob.status, "processing");
          assert.equal(inFlightJob.attempts, 1);
          assert.match(inFlightJob.started_at, /^\d{4}-\d{2}-\d{2} /);
          assert.equal(inFlightJob.completed_at, null);
          assert.equal(inFlightJob.failed_at, null);

          return [
            {
              type: "fact",
              content: "Revenue from AI copilots grew 42% year over year across mid-market teams.",
              sourceExcerpt:
                "Revenue from AI copilots grew 42% year over year across mid-market teams.",
              confidence: 0.93,
            },
            {
              type: "task",
              content:
                "Founders should review every workflow prompt weekly and delete low-signal automations.",
              sourceExcerpt:
                "Founders should review every workflow prompt weekly and delete low-signal automations.",
              confidence: 0.89,
            },
          ];
        },
      });

      assert.deepEqual(processed, {
        emailId: deliveryResult.emailId,
        noteCount: 2,
      });

      const email = getEmailById(db, deliveryResult.emailId);
      const notes = listNotesByEmailId(db, deliveryResult.emailId);

      assert.equal(email.ingestion_status, "processed");
      assert.equal(email.relevance_status, "relevant");
      assert.equal(email.processing_error, null);
      assert.equal(notes.length, 2);
      assert.equal(notes[0].taxonomy_key, "fact");
      assert.equal(notes[1].taxonomy_key, "task");
      assert.equal(notes[0].confidence, 0.93);
      assert.equal(notes[1].confidence, 0.89);
      assert.equal(
        notes[0].source_timestamp,
        "2026-03-09T17:00:00Z"
      );
      assert.match(notes[0].body, /42% year over year/);
      assert.match(notes[1].body, /review every workflow prompt weekly/);

      const completedJob = getEmailProcessingJobById(db, deliveryResult.processingJobId);
      assert.equal(completedJob.status, "completed");
      assert.equal(completedJob.attempts, 1);
      assert.equal(completedJob.error_message, null);
      assert.match(completedJob.completed_at, /^\d{4}-\d{2}-\d{2} /);
      assert.equal(completedJob.failed_at, null);

      await processEmailToNotes(db, deliveryResult.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "pattern_trend",
            content: "Prompt review cadence is becoming operating hygiene for AI-native teams.",
          },
        ],
      });

      const replacedNotes = listNotesByEmailId(db, deliveryResult.emailId);
      assert.equal(replacedNotes.length, 1);
      assert.equal(replacedNotes[0].taxonomy_key, "pattern_trend");
      assert.equal(replacedNotes[0].confidence, 0.75);
      assert.equal(
        replacedNotes[0].source_timestamp,
        "2026-03-09T17:00:00Z"
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes persists Claude note confidence scores end to end", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = buildAgentMailPayload();
      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-claude-confidence",
        eventType: payload.event_type,
        rawPayload: JSON.stringify(payload),
        payload,
      });

      const processed = await processEmailToNotes(db, deliveryResult.emailId, {
        env: {
          ANTHROPIC_API_KEY: "test-key",
          CLAUDE_MODEL: "claude-test-model",
        },
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return {
              content: [
                {
                  type: "text",
                  text: `\`\`\`json
{"notes":[
  {"type":"Fact","title":"Copilot revenue growth","content":"Revenue from AI copilots grew 42% year over year across mid-market teams.","summary":"AI copilot revenue is growing.","sourceExcerpt":"Revenue from AI copilots grew 42% year over year across mid-market teams.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.91},
  {"type":"Task","title":"Review prompt cadence","content":"Founders should review every workflow prompt weekly and delete low-signal automations.","summary":"Teams should review workflow prompts weekly.","sourceExcerpt":"Founders should review every workflow prompt weekly and delete low-signal automations.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.87}
]}
\`\`\``,
                },
              ],
            };
          },
        }),
        logger: silentLogger,
      });

      const notes = listNotesByEmailId(db, deliveryResult.emailId);
      const persistedNotes = db.prepare(`
        SELECT classification_confidence
        FROM notes
        WHERE email_id = ?
        ORDER BY id ASC
      `).all(deliveryResult.emailId);

      assert.deepEqual(processed, {
        emailId: deliveryResult.emailId,
        noteCount: 2,
      });
      assert.equal(notes.length, 2);
      assert.equal(notes[0].taxonomy_key, "fact");
      assert.equal(notes[0].confidence, 0.91);
      assert.equal(notes[1].taxonomy_key, "task");
      assert.equal(notes[1].confidence, 0.87);
      assert.deepEqual(
        persistedNotes.map((note) => note.classification_confidence),
        [0.91, 0.87]
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes default fallback turns one email into multiple persisted atomic notes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = buildAgentMailPayload();
      payload.message.extracted_text = [
        "AI copilots grew 42% year over year across mid-market teams.",
        "Founders should review every workflow prompt weekly before expanding automations.",
      ].join(" ");

      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-default-fallback",
        eventType: payload.event_type,
        rawPayload: JSON.stringify(payload),
        payload,
      });

      const processed = await processEmailToNotes(db, deliveryResult.emailId, {
        env: {},
        fetchImpl: null,
        logger: silentLogger,
      });

      const notes = listNotesByEmailId(db, deliveryResult.emailId);

      assert.deepEqual(processed, {
        emailId: deliveryResult.emailId,
        noteCount: 2,
      });
      assert.equal(notes.length, 2);
      assert.equal(notes[0].taxonomy_key, "fact");
      assert.equal(notes[0].source_excerpt, notes[0].body);
      assert.equal(notes[0].source_timestamp, "2026-03-09T17:00:00Z");
      assert.match(notes[0].body, /42% year over year/);
      assert.equal(notes[1].taxonomy_key, "task");
      assert.equal(notes[1].source_excerpt, notes[1].body);
      assert.equal(notes[1].source_timestamp, "2026-03-09T17:00:00Z");
      assert.match(notes[1].body, /review every workflow prompt weekly/);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes canonicalizes taxonomy labels to canonical keys", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = buildAgentMailPayload();
      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-2",
        eventType: payload.event_type,
        rawPayload: JSON.stringify(payload),
        payload,
      });

      await processEmailToNotes(db, deliveryResult.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "Warning/Risk",
            content: "Unchecked prompt drift can silently degrade output quality across an agent fleet.",
          },
          {
            type: "Playbook Candidate",
            content: "A weekly prompt audit checklist could become a reusable operating routine.",
          },
          {
            type: "preference candidate",
            content: "Teams increasingly prefer narrow single-purpose agents over bloated generalist bots.",
          },
        ],
      });

      const notes = listNotesByEmailId(db, deliveryResult.emailId);

      assert.deepEqual(
        notes.map((note) => note.taxonomy_key),
        ["warning_risk", "playbook_candidate", "preference_candidate"]
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("generateAtomicNotes sends the 13-type taxonomy to Claude and canonicalizes returned labels", async () => {
  let capturedRequest = null;

  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 73,
      subject: "Claude taxonomy sample",
      from_name: "Signals Weekly",
      text_content: "Anthropic released a new API for tool use. Operators prefer narrow agents.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {
      ANTHROPIC_API_KEY: "test-key",
      CLAUDE_MODEL: "claude-test-model",
    },
    fetchImpl: async (url, options) => {
      capturedRequest = {
        url,
        options,
        body: JSON.parse(options.body),
      };

      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "text",
                text: `\`\`\`json
{"notes":[
  {"type":"Tool Update","title":"Anthropic ships API update","content":"Anthropic released a new API for tool use in multi-step agents.","summary":"Anthropic shipped a tool-use API update.","sourceExcerpt":"Anthropic released a new API for tool use in multi-step agents.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.91},
  {"type":"Preference Candidate","title":"Operators prefer narrow agents","content":"Operators prefer narrow single-purpose agents over bloated generalist bots.","summary":"Operators prefer narrow agents.","sourceExcerpt":"Operators prefer narrow single-purpose agents over bloated generalist bots.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.87}
]}
\`\`\``,
              },
            ],
          };
        },
      };
    },
    logger: silentLogger,
  });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.url, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedRequest.body.model, "claude-test-model");
  assert.match(
    capturedRequest.body.system,
    /Choose exactly one taxonomy key per note from the 13 allowed keys\./
  );
  assert.match(
    capturedRequest.body.system,
    /prefer `playbook_candidate` over `pattern_trend`/
  );
  assert.match(
    capturedRequest.body.system,
    /prefer `preference_candidate` over `opinion`/
  );
  assert.match(
    capturedRequest.body.system,
    /`tool_update` vs `fact`: launches, releases, integrations, and version changes should be `tool_update`/
  );
  assert.match(
    capturedRequest.body.system,
    /Example: `Anthropic released a new API for tool use in multi-step agents last week\.` -> `tool_update`/
  );
  assert.match(
    capturedRequest.body.messages[0].content[0].text,
    /`confidence` must be a numeric value between 0 and 1 inclusive/
  );

  for (const taxonomyType of TAXONOMY_TYPES) {
    assert.match(
      capturedRequest.body.system,
      new RegExp(`\\b${taxonomyType.key}\\b`),
      `Missing taxonomy key in Claude prompt: ${taxonomyType.key}`
    );
  }

  assert.deepEqual(
    generatedNotes.map((note) => note.type),
    ["tool_update", "preference_candidate"]
  );
});

test("generateAtomicNotes canonicalizes compact and camelCase taxonomy labels without fallback warnings", async () => {
  const warnings = [];

  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 74,
      subject: "Claude taxonomy variant sample",
      from_name: "Signals Weekly",
      text_content: [
        "Anthropic released a new API for tool use in multi-step agents.",
        "Unchecked prompt drift can silently degrade output quality across an agent fleet.",
        "Operators prefer narrow single-purpose agents over bloated generalist bots.",
        "A weekly prompt audit checklist could become a reusable operating routine.",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {
      ANTHROPIC_API_KEY: "test-key",
      CLAUDE_MODEL: "claude-test-model",
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "text",
              text: `\`\`\`json
{"notes":[
  {"type":"ToolUpdate","title":"Anthropic ships API update","content":"Anthropic released a new API for tool use in multi-step agents.","summary":"Anthropic shipped a tool-use API update.","sourceExcerpt":"Anthropic released a new API for tool use in multi-step agents.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.91},
  {"type":"WarningRisk","title":"Prompt drift risk","content":"Unchecked prompt drift can silently degrade output quality across an agent fleet.","summary":"Prompt drift is risky.","sourceExcerpt":"Unchecked prompt drift can silently degrade output quality across an agent fleet.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.83},
  {"type":"PreferenceCandidate","title":"Operators prefer narrow agents","content":"Operators prefer narrow single-purpose agents over bloated generalist bots.","summary":"Operators prefer narrow agents.","sourceExcerpt":"Operators prefer narrow single-purpose agents over bloated generalist bots.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.87},
  {"type":"playbookcandidate","title":"Weekly audit checklist","content":"A weekly prompt audit checklist could become a reusable operating routine.","summary":"A weekly prompt audit checklist could be reused.","sourceExcerpt":"A weekly prompt audit checklist could become a reusable operating routine.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.81}
]}
\`\`\``,
            },
          ],
        };
      },
    }),
    logger: {
      warn(message) {
        warnings.push(message);
      },
      error() {},
    },
  });

  assert.deepEqual(
    generatedNotes.map((note) => note.type),
    ["tool_update", "warning_risk", "preference_candidate", "playbook_candidate"]
  );
  assert.equal(warnings.length, 0);
});

test("generateAtomicNotes normalizes Claude confidence scores into the 0-1 range", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 74,
      subject: "Claude confidence normalization sample",
      from_name: "Signals Weekly",
      text_content: [
        "Revenue from AI copilots grew 42% year over year across mid-market teams.",
        "Operators prefer narrow single-purpose agents over bloated generalist bots.",
        "Unchecked prompt drift can silently degrade output quality across an agent fleet.",
        "What operating cadence should teams use for prompt reviews across each agent?",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {
      ANTHROPIC_API_KEY: "test-key",
      CLAUDE_MODEL: "claude-test-model",
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "text",
              text: `\`\`\`json
{"notes":[
  {"type":"Fact","title":"Copilot revenue growth","content":"Revenue from AI copilots grew 42% year over year across mid-market teams.","summary":"AI copilot revenue is growing.","sourceExcerpt":"Revenue from AI copilots grew 42% year over year across mid-market teams.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":"0.91"},
  {"type":"Preference Candidate","title":"Operators prefer narrow agents","content":"Operators prefer narrow single-purpose agents over bloated generalist bots.","summary":"Operators prefer narrow agents.","sourceExcerpt":"Operators prefer narrow single-purpose agents over bloated generalist bots.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":91},
  {"type":"Warning/Risk","title":"Prompt drift risk","content":"Unchecked prompt drift can silently degrade output quality across an agent fleet.","summary":"Prompt drift is risky.","sourceExcerpt":"Unchecked prompt drift can silently degrade output quality across an agent fleet.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":1.7},
  {"type":"Question","title":"Prompt review cadence","content":"What operating cadence should teams use for prompt reviews across each agent?","summary":"Teams need a prompt review cadence.","sourceExcerpt":"What operating cadence should teams use for prompt reviews across each agent?","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":-0.2}
]}
\`\`\``,
            },
          ],
        };
      },
    }),
    logger: silentLogger,
  });

  assert.deepEqual(
    generatedNotes.map((note) => note.confidence),
    [0.91, 0.91, 1, 0]
  );
});

test("generateAtomicNotes reclassifies unsupported Claude taxonomy labels per note", async () => {
  const warnings = [];
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 75,
      subject: "Claude invalid taxonomy sample",
      from_name: "Signals Weekly",
      text_content: [
        "According to the vendor, smaller models now outperform larger ones on support queues.",
        "A weekly prompt audit checklist could become a reusable operating routine.",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {
      ANTHROPIC_API_KEY: "test-key",
      CLAUDE_MODEL: "claude-test-model",
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "text",
              text: `\`\`\`json
{"notes":[
  {"type":"Strategy","title":"Vendor performance argument","content":"According to the vendor, smaller models now outperform larger ones on support queues.","summary":"The vendor claims smaller models perform better.","sourceExcerpt":"According to the vendor, smaller models now outperform larger ones on support queues.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.83},
  {"type":"Playbook Candidate","title":"Weekly audit checklist","content":"A weekly prompt audit checklist could become a reusable operating routine.","summary":"A weekly prompt audit checklist could be reused.","sourceExcerpt":"A weekly prompt audit checklist could become a reusable operating routine.","sourceTimestamp":"2026-03-09T17:00:00Z","confidence":0.81}
]}
\`\`\``,
            },
          ],
        };
      },
    }),
    logger: {
      warn(message) {
        warnings.push(message);
      },
      error() {},
    },
  });

  assert.deepEqual(
    generatedNotes.map((note) => note.type),
    ["claim", "playbook_candidate"]
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unsupported type "Strategy" as "claim"/);
});

test("processEmailToNotes flags irrelevant promotions and skips note extraction", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = buildAgentMailPayload();
      payload.message.subject = "Flash sale: save 50% on agent templates today";
      payload.message.from = "Offers Team <promo@example.com>";
      payload.message.extracted_text =
        "Limited time offer. Use promo code SAVE50. Buy now and start your free trial today.";

      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-promotion-skip",
        eventType: payload.event_type,
        rawPayload: JSON.stringify(payload),
        payload,
      });

      let generateCalled = false;

      const processed = await processEmailToNotes(db, deliveryResult.emailId, {
        logger: silentLogger,
        processingJobId: deliveryResult.processingJobId,
        generateAtomicNotes: async () => {
          generateCalled = true;
          return [
            {
              type: "idea",
              content: "This should never be persisted for a promotional email.",
            },
          ];
        },
      });

      const email = getEmailById(db, deliveryResult.emailId);
      const completedJob = getEmailProcessingJobById(db, deliveryResult.processingJobId);

      assert.deepEqual(processed, {
        emailId: deliveryResult.emailId,
        noteCount: 0,
        skipped: true,
        relevanceStatus: "promotion",
      });
      assert.equal(generateCalled, false);
      assert.equal(email.ingestion_status, "skipped");
      assert.equal(email.relevance_status, "promotion");
      assert.equal(email.processing_error, null);
      assert.equal(completedJob.status, "completed");
      assert.equal(listNotesByEmailId(db, deliveryResult.emailId).length, 0);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes records failed async job executions in SQLite", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = buildAgentMailPayload();
      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-failed",
        eventType: payload.event_type,
        rawPayload: JSON.stringify(payload),
        payload,
      });

      await assert.rejects(
        processEmailToNotes(db, deliveryResult.emailId, {
          logger: silentLogger,
          processingJobId: deliveryResult.processingJobId,
          generateAtomicNotes: async () => {
            const inFlightJob = getEmailProcessingJobById(db, deliveryResult.processingJobId);
            assert.equal(inFlightJob.status, "processing");
            assert.equal(inFlightJob.attempts, 1);
            throw new Error("Claude extraction timed out");
          },
        }),
        /Claude extraction timed out/
      );

      const email = getEmailById(db, deliveryResult.emailId);
      const failedJob = getEmailProcessingJobById(db, deliveryResult.processingJobId);

      assert.equal(email.ingestion_status, "failed");
      assert.equal(email.relevance_status, "relevant");
      assert.equal(email.processing_error, "Claude extraction timed out");
      assert.equal(failedJob.status, "failed");
      assert.equal(failedJob.attempts, 1);
      assert.equal(failedJob.error_message, "Claude extraction timed out");
      assert.equal(failedJob.completed_at, null);
      assert.match(failedJob.failed_at, /^\d{4}-\d{2}-\d{2} /);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("generateAtomicNotes fallback emits only supported taxonomy keys", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 42,
      subject: "Fallback classification sample",
      text_content: [
        "A new agent platform released an SDK update for multi-step tool execution.",
        "Unchecked automation drift is a serious risk for customer-facing workflows.",
        "What operating cadence should teams use for prompt reviews?",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });
  const supportedTypes = new Set(TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.key));

  assert.ok(generatedNotes.length > 0);

  for (const note of generatedNotes) {
    assert.ok(
      supportedTypes.has(note.type),
      `Unexpected fallback taxonomy key: ${note.type}`
    );
  }
});

test("generateAtomicNotes fallback prefers attributed claims over facts", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 43,
      subject: "Attributed claim sample",
      text_content:
        "According to the vendor, smaller models now outperform larger ones on support queues.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 1);
  assert.equal(generatedNotes[0].type, "claim");
});

test("generateAtomicNotes fallback prefers playbook candidates over broader trends", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 44,
      subject: "Playbook specificity sample",
      text_content:
        "More teams are standardizing on a weekly prompt audit checklist for support agents.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 1);
  assert.equal(generatedNotes[0].type, "playbook_candidate");
});

test("generateAtomicNotes fallback prefers tool updates over generic facts", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 45,
      subject: "Tool update specificity sample",
      text_content:
        "OpenAI introduced a v2 SDK for browser agents on March 3.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 1);
  assert.equal(generatedNotes[0].type, "tool_update");
});

test("generateAtomicNotes fallback prefers preference candidates over generic opinions", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 46,
      subject: "Preference specificity sample",
      text_content:
        "Operators default to narrow single-purpose agents instead of bloated generalist bots.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 1);
  assert.equal(generatedNotes[0].type, "preference_candidate");
});

test("generateAtomicNotes fallback classifies representative notes into all 13 taxonomy types", async () => {
  const firstBatch = await generateAtomicNotes({
    email: {
      id: 85,
      subject: "Fallback taxonomy coverage batch one",
      text_content: [
        "The vendor argues that smaller models now outperform larger ones on support queues.",
        "Revenue from AI copilots grew 42% year over year across mid-market teams.",
        "One implication is to bundle prompt reviews into the weekly sprint retro.",
        "In my view, most teams are overusing general-purpose agents for narrow workflows.",
        "Schedule a weekly prompt audit for every customer-facing agent before Friday.",
        "What operating cadence should teams use for prompt reviews across each agent?",
        "There is white space to build compliance tooling for agent handoffs in finance.",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });
  const secondBatch = await generateAtomicNotes({
    email: {
      id: 86,
      subject: "Fallback taxonomy coverage batch two",
      text_content: [
        "Unchecked automation drift is a serious risk for customer-facing workflows.",
        "Anthropic released a new API for tool use in multi-step agents last week.",
        "More teams are moving from single bots to multi-agent workflows this quarter.",
        "Open rates are rising, but conversions are falling for the same campaigns.",
        "A weekly prompt audit checklist could become a reusable operating routine.",
        "Operators prefer narrow single-purpose agents over bloated generalist bots.",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });
  const generatedNotes = [...firstBatch, ...secondBatch];

  assert.deepEqual(
    generatedNotes.map((note) => note.type),
    [
      "claim",
      "fact",
      "idea",
      "opinion",
      "task",
      "question",
      "opportunity",
      "warning_risk",
      "tool_update",
      "pattern_trend",
      "contradiction",
      "playbook_candidate",
      "preference_candidate",
    ]
  );
});

test("generateAtomicNotes fallback classifies alternate newsletter phrasings into all 13 taxonomy types", async () => {
  const firstBatch = await generateAtomicNotes({
    email: {
      id: 91,
      subject: "Fallback alternate taxonomy coverage batch one",
      text_content: [
        "Executives contend that copilots will replace tier-one support queues by year-end.",
        "A benchmark of 1,240 support tickets found copilots resolved 37% without escalation.",
        "A better approach would be to bundle prompt reviews into every sprint retro.",
        "My take is that most teams are probably adding general-purpose agents too early.",
        "Audit every customer-facing agent before Friday and document rollback owners.",
        "Which agent handoffs fail most often during finance onboarding?",
        "There is a gap to build agent QA tooling for regulated support teams.",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });
  const secondBatch = await generateAtomicNotes({
    email: {
      id: 92,
      subject: "Fallback alternate taxonomy coverage batch two",
      text_content: [
        "Unchecked prompt drift can backfire in regulated support workflows.",
        "Linear added an AI triage feature to its issue workflow this week.",
        "Enterprise teams are increasingly shifting from single bots to coordinated agent systems.",
        "Resolution times are falling even as human escalations keep rising.",
        "A step-by-step incident review workflow could become the standard operating routine for agent rollouts.",
        "Operators favor narrow agents over all-purpose copilots for support work.",
      ].join("\n\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });
  const generatedNotes = [...firstBatch, ...secondBatch];

  assert.deepEqual(
    generatedNotes.map((note) => note.type),
    [
      "claim",
      "fact",
      "idea",
      "opinion",
      "task",
      "question",
      "opportunity",
      "warning_risk",
      "tool_update",
      "pattern_trend",
      "contradiction",
      "playbook_candidate",
      "preference_candidate",
    ]
  );
});

test("generateAtomicNotes fallback splits short multi-sentence paragraphs into atomic notes", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 84,
      subject: "Atomic fallback sample",
      text_content:
        "AI copilots grew 42% year over year. Teams should review prompts weekly.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 2);
  assert.match(generatedNotes[0].content, /AI copilots grew 42% year over year\./);
  assert.match(generatedNotes[1].content, /Teams should review prompts weekly\./);
  assert.equal(
    generatedNotes[0].source,
    "AI copilots grew 42% year over year."
  );
  assert.equal(generatedNotes[1].timestamp, "2026-03-09T17:00:00Z");
});

test("generateAtomicNotes fallback preserves atomic list items from html newsletters", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 87,
      subject: "HTML list fallback sample",
      html_content: [
        "<ul>",
        "<li>AI copilots grew 42% year over year across mid-market teams.</li>",
        "<li>Review every workflow prompt weekly before expanding automations.</li>",
        "</ul>",
      ].join(""),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 2);
  assert.equal(generatedNotes[0].type, "fact");
  assert.match(generatedNotes[0].content, /42% year over year/);
  assert.equal(
    generatedNotes[0].sourceExcerpt,
    "AI copilots grew 42% year over year across mid-market teams."
  );
  assert.equal(generatedNotes[1].type, "task");
  assert.match(generatedNotes[1].content, /Review every workflow prompt weekly/);
});

test("generateAtomicNotes fallback keeps short explicit list items as separate notes", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 88,
      subject: "Short list fallback sample",
      text_content: ["- Review prompts.", "- Fix drift."].join("\n"),
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 2);
  assert.deepEqual(
    generatedNotes.map((note) => note.content),
    ["Review prompts.", "Fix drift."]
  );
  assert.ok(generatedNotes.every((note) => note.type === "task"));
});

test("generateAtomicNotes fallback still returns a note for short single-sentence emails", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 89,
      subject: "",
      text_content: "Review prompts.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 1);
  assert.equal(generatedNotes[0].content, "Review prompts.");
  assert.equal(generatedNotes[0].sourceTimestamp, "2026-03-09T17:00:00Z");
});

test("generateAtomicNotes fallback preserves leading numeric facts in note content", async () => {
  const generatedNotes = await generateAtomicNotes({
    email: {
      id: 90,
      subject: "Numeric fact sample",
      text_content: "42% of teams now run prompt reviews before shipping agent changes.",
      sent_at: "2026-03-09T17:00:00Z",
    },
    env: {},
    fetchImpl: null,
    logger: silentLogger,
  });

  assert.equal(generatedNotes.length, 1);
  assert.equal(
    generatedNotes[0].content,
    "42% of teams now run prompt reviews before shipping agent changes."
  );
  assert.equal(generatedNotes[0].type, "fact");
});

test("processEmailToNotes persists notes when the generator uses source and timestamp aliases", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-pipeline-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = buildAgentMailPayload();
      const deliveryResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-test-source-alias",
        eventType: payload.event_type,
        rawPayload: JSON.stringify(payload),
        payload,
      });

      await processEmailToNotes(db, deliveryResult.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            content: "Revenue from AI copilots grew 42% year over year across mid-market teams.",
            source:
              "Revenue from AI copilots grew 42% year over year across mid-market teams.",
            timestamp: "2026-03-09T17:00:00Z",
            confidence: 0.93,
          },
        ],
      });

      const [note] = listNotesByEmailId(db, deliveryResult.emailId);

      assert.equal(note.taxonomy_key, "fact");
      assert.equal(
        note.source_excerpt,
        "Revenue from AI copilots grew 42% year over year across mid-market teams."
      );
      assert.equal(note.source_timestamp, "2026-03-09T17:00:00Z");
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes compares new notes against previously stored notes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-comparison-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-link-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      await processEmailToNotes(db, firstDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "pattern_trend",
            content: "Mid-market finance teams are standardizing on AI copilots to improve renewals.",
          },
        ],
      });

      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_2",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_2",
          subject: "Expansion signals for operators",
          extracted_text:
            "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Expansion signals for operators",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-link-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      const firstStoredNote = listNotesByEmailId(db, firstDelivery.emailId)[0];
      let comparisonsFromPipeline = null;

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "idea",
            content:
              "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
          },
        ],
        onComparedNotes(comparisons) {
          comparisonsFromPipeline = comparisons;
        },
      });

      assert.ok(Array.isArray(comparisonsFromPipeline));
      assert.equal(comparisonsFromPipeline.length, 1);
      assert.equal(comparisonsFromPipeline[0].existingNoteId, firstStoredNote.id);
      assert.equal(comparisonsFromPipeline[0].existingEmailId, firstDelivery.emailId);
      assert.ok(comparisonsFromPipeline[0].sharedKeywords.includes("ai copilot"));

      const firstRelationship = listRelationships(db);
      const secondStoredNote = listNotesByEmailId(db, secondDelivery.emailId)[0];

      assert.equal(firstRelationship.length, 1);
      assert.equal(firstRelationship[0].note_id, firstStoredNote.id);
      assert.equal(firstRelationship[0].related_note_id, secondStoredNote.id);
      assert.equal(firstRelationship[0].relationship_type, "shared_keyword");
      assert.deepEqual(firstRelationship[0].overlap_terms, comparisonsFromPipeline[0].sharedKeywords);

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "idea",
            content:
              "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
          },
        ],
      });

      const relationshipsAfterReprocess = listRelationships(db);
      const reprocessedSecondNote = listNotesByEmailId(db, secondDelivery.emailId)[0];

      assert.equal(relationshipsAfterReprocess.length, 1);
      assert.equal(relationshipsAfterReprocess[0].note_id, firstStoredNote.id);
      assert.equal(relationshipsAfterReprocess[0].related_note_id, reprocessedSecondNote.id);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes inserts topic and keyword relationship rows from explicit overlap terms", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-topics-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-topic-link-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      await processEmailToNotes(db, firstDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "idea",
            content: "Founders are tightening planning loops across their portfolios.",
            topics: ["workflow automation"],
            keywords: ["prompt review cadence"],
          },
        ],
      });

      const firstStoredNote = listNotesByEmailId(db, firstDelivery.emailId)[0];
      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_topic_overlap",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_topic_overlap",
          subject: "Operating cadence signals",
          extracted_text: "Leaders delegated more decisions to frontline operators this week.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Operating cadence signals",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-topic-link-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      let comparisonsFromPipeline = null;

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "task",
            content: "Operators are clarifying who owns each weekly review decision.",
            topics: ["workflow automation"],
            keywords: ["prompt review cadence"],
          },
        ],
        onComparedNotes(comparisons) {
          comparisonsFromPipeline = comparisons;
        },
      });

      const topicComparison = comparisonsFromPipeline.find(
        (comparison) => comparison.overlapBasis === "topic"
      );
      const keywordComparison = comparisonsFromPipeline.find(
        (comparison) => comparison.overlapBasis === "keyword"
      );
      const storedRelationships = listRelationships(db);
      const secondStoredNote = listNotesByEmailId(db, secondDelivery.emailId)[0];
      const topicRelationship = storedRelationships.find(
        (relationship) => relationship.overlap_basis === "topic"
      );
      const keywordRelationship = storedRelationships.find(
        (relationship) => relationship.overlap_basis === "keyword"
      );

      assert.equal(comparisonsFromPipeline.length, 2);
      assert.ok(topicComparison);
      assert.ok(keywordComparison);
      assert.equal(topicComparison.existingNoteId, firstStoredNote.id);
      assert.deepEqual(topicComparison.matchedValues, ["workflow automation"]);
      assert.equal(keywordComparison.existingNoteId, firstStoredNote.id);
      assert.ok(keywordComparison.sharedKeywords.includes("prompt review cadence"));

      assert.equal(storedRelationships.length, 2);
      assert.ok(topicRelationship);
      assert.ok(keywordRelationship);
      assert.equal(topicRelationship.note_id, firstStoredNote.id);
      assert.equal(topicRelationship.related_note_id, secondStoredNote.id);
      assert.equal(topicRelationship.overlap_source, "topic_overlap");
      assert.deepEqual(topicRelationship.overlap_terms, ["workflow automation"]);
      assert.equal(keywordRelationship.note_id, firstStoredNote.id);
      assert.equal(keywordRelationship.related_note_id, secondStoredNote.id);
      assert.equal(keywordRelationship.overlap_source, "keyword_overlap");
      assert.ok(keywordRelationship.overlap_terms.includes("prompt review cadence"));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes surfaces duplicate candidates before persisting and stores duplicate_of from the new note to the canonical note", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-duplicates-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-duplicate-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      await processEmailToNotes(db, firstDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            content: "AI copilots grew 42% year over year across mid-market teams.",
          },
        ],
      });

      const firstStoredNote = listNotesByEmailId(db, firstDelivery.emailId)[0];
      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_duplicate_match",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_duplicate_match",
          subject: "Duplicate signal phrased differently",
          extracted_text:
            "Across mid market teams, AI copilots grew 42 percent year over year.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Duplicate signal phrased differently",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-duplicate-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      let duplicateCandidatesFromPipeline = null;

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            content: "Across mid market teams, AI copilots grew 42 percent year over year.",
          },
        ],
        onDuplicateCandidates(duplicateCandidates) {
          duplicateCandidatesFromPipeline = duplicateCandidates;
          assert.equal(listNotesByEmailId(db, secondDelivery.emailId).length, 0);
        },
      });

      assert.ok(Array.isArray(duplicateCandidatesFromPipeline));
      assert.equal(duplicateCandidatesFromPipeline.length, 1);
      assert.equal(duplicateCandidatesFromPipeline[0].existingNoteId, firstStoredNote.id);
      assert.equal(duplicateCandidatesFromPipeline[0].existingEmailId, firstDelivery.emailId);
      assert.equal(duplicateCandidatesFromPipeline[0].duplicateKind, "near");
      assert.ok(duplicateCandidatesFromPipeline[0].similarity.tokenOverlap >= 0.85);
      assert.ok(duplicateCandidatesFromPipeline[0].sharedTerms.includes("42"));
      const [secondStoredNote] = listNotesByEmailId(db, secondDelivery.emailId);
      const duplicateRelationships = listRelationships(db).filter(
        (relationship) => relationship.relationship_type === "duplicate_of"
      );

      assert.equal(duplicateRelationships.length, 1);
      assert.equal(duplicateRelationships[0].note_id, secondStoredNote.id);
      assert.equal(duplicateRelationships[0].related_note_id, firstStoredNote.id);
      assert.ok(duplicateRelationships[0].overlap_terms.includes("42"));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes flags semantic near duplicates from different emails when concept overlap clears the threshold", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-semantic-duplicates-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-semantic-duplicate-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      await processEmailToNotes(db, firstDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            title: "AI copilots reduced support wait times for enterprise teams",
            content: "AI copilots reduced support wait times for enterprise teams.",
          },
        ],
      });

      const [firstStoredNote] = listNotesByEmailId(db, firstDelivery.emailId);
      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_semantic_duplicate_match",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_semantic_duplicate_match",
          subject: "Same support latency signal from another newsletter",
          extracted_text:
            "Enterprise teams saw support wait times fall after adopting AI copilots.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Same support latency signal from another newsletter",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-semantic-duplicate-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      let duplicateCandidatesFromPipeline = null;

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            title: "Enterprise teams saw support wait times fall after adopting AI copilots",
            content: "Enterprise teams saw support wait times fall after adopting AI copilots.",
          },
        ],
        onDuplicateCandidates(duplicateCandidates) {
          duplicateCandidatesFromPipeline = duplicateCandidates;
          assert.equal(listNotesByEmailId(db, secondDelivery.emailId).length, 0);
        },
      });

      assert.ok(Array.isArray(duplicateCandidatesFromPipeline));
      assert.equal(duplicateCandidatesFromPipeline.length, 1);
      assert.equal(duplicateCandidatesFromPipeline[0].existingNoteId, firstStoredNote.id);
      assert.equal(duplicateCandidatesFromPipeline[0].existingEmailId, firstDelivery.emailId);
      assert.equal(duplicateCandidatesFromPipeline[0].duplicateKind, "near");
      assert.ok(
        duplicateCandidatesFromPipeline[0].matchedRules.includes("semantic_concept_overlap")
      );
      assert.ok(duplicateCandidatesFromPipeline[0].similarity.tokenOverlap >= 0.8);
      assert.ok(
        duplicateCandidatesFromPipeline[0].similarity.semanticConceptOverlap >= 0.55
      );
      assert.ok(duplicateCandidatesFromPipeline[0].sharedTerms.includes("ai copilot"));
      assert.ok(duplicateCandidatesFromPipeline[0].sharedTerms.includes("support wait"));
      const [secondStoredNote] = listNotesByEmailId(db, secondDelivery.emailId);
      const duplicateRelationships = listRelationships(db).filter(
        (relationship) => relationship.relationship_type === "duplicate_of"
      );

      assert.equal(duplicateRelationships.length, 1);
      assert.equal(duplicateRelationships[0].note_id, secondStoredNote.id);
      assert.equal(duplicateRelationships[0].related_note_id, firstStoredNote.id);
      assert.ok(duplicateRelationships[0].overlap_terms.includes("ai copilot"));
      assert.ok(duplicateRelationships[0].overlap_terms.includes("support wait"));
      assert.equal(
        duplicateRelationships[0].overlap_source_metadata.duplicateKind,
        "near"
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes persists exact duplicates as duplicate_of links while ignoring source-specific fields", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-exact-duplicates-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-exact-duplicate-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      await processEmailToNotes(db, firstDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            title: "Copilot revenue growth",
            content: "AI copilots grew 42% year over year across mid-market teams.",
            summary: "AI copilot revenue is growing quickly.",
            sourceExcerpt:
              "The first newsletter reported the 42% year-over-year growth number.",
            sourceTimestamp: "2026-03-09T17:00:00Z",
          },
        ],
      });

      const [firstStoredNote] = listNotesByEmailId(db, firstDelivery.emailId);
      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_exact_duplicate_match",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_exact_duplicate_match",
          subject: "Same signal from another source",
          extracted_text:
            "Another newsletter repeated the same 42% AI copilot growth statistic.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Same signal from another source",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-exact-duplicate-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      let duplicateCandidatesFromPipeline = null;

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            title: "Copilot revenue growth",
            content: "AI copilots grew 42% year over year across mid-market teams.",
            summary: "AI copilot revenue is growing quickly.",
            sourceExcerpt:
              "The second newsletter phrased the surrounding paragraph differently.",
            sourceTimestamp: "2026-03-09T17:05:00Z",
            confidence: 0.58,
          },
        ],
        onDuplicateCandidates(duplicateCandidates) {
          duplicateCandidatesFromPipeline = duplicateCandidates;
          assert.equal(listNotesByEmailId(db, secondDelivery.emailId).length, 0);
        },
      });

      const [secondStoredNote] = listNotesByEmailId(db, secondDelivery.emailId);
      const duplicateRelationships = listRelationships(db).filter(
        (relationship) => relationship.relationship_type === "duplicate_of"
      );

      assert.ok(Array.isArray(duplicateCandidatesFromPipeline));
      assert.equal(duplicateCandidatesFromPipeline.length, 1);
      assert.equal(duplicateCandidatesFromPipeline[0].duplicateKind, "exact");
      assert.equal(duplicateCandidatesFromPipeline[0].existingNoteId, firstStoredNote.id);
      assert.equal(duplicateRelationships.length, 1);
      assert.equal(duplicateRelationships[0].note_id, secondStoredNote.id);
      assert.equal(duplicateRelationships[0].related_note_id, firstStoredNote.id);
      assert.equal(duplicateRelationships[0].overlap_source, "duplicate_of");
      assert.equal(duplicateRelationships[0].overlap_source_metadata.duplicateKind, "exact");
      assert.equal(duplicateRelationships[0].overlap_source_metadata.similarityScore, 1);
      assert.ok(duplicateRelationships[0].overlap_terms.includes("copilot"));
      assert.ok(duplicateRelationships[0].overlap_terms.includes("42"));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("processEmailToNotes treats normalized note body matches as exact duplicates even when titles differ", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-content-duplicates-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-content-duplicate-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      await processEmailToNotes(db, firstDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            title: "Copilot revenue growth",
            content: "AI copilots grew 42% year over year across mid-market teams.",
            summary: "The first source framed the metric as revenue expansion.",
          },
        ],
      });

      const [firstStoredNote] = listNotesByEmailId(db, firstDelivery.emailId);
      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_content_duplicate_match",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_content_duplicate_match",
          subject: "Same fact with different headline wording",
          extracted_text:
            "Another newsletter repeated the same AI copilot growth metric with different framing.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Same fact with different headline wording",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-content-duplicate-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      let duplicateCandidatesFromPipeline = null;

      await processEmailToNotes(db, secondDelivery.emailId, {
        logger: silentLogger,
        generateAtomicNotes: async () => [
          {
            type: "fact",
            title: "Same growth signal from another source",
            content: "AI copilots grew 42 percent year over year across mid market teams.",
            summary: "The second source used a different summary.",
          },
        ],
        onDuplicateCandidates(duplicateCandidates) {
          duplicateCandidatesFromPipeline = duplicateCandidates;
          assert.equal(listNotesByEmailId(db, secondDelivery.emailId).length, 0);
        },
      });

      const [secondStoredNote] = listNotesByEmailId(db, secondDelivery.emailId);
      const duplicateRelationships = listRelationships(db).filter(
        (relationship) => relationship.relationship_type === "duplicate_of"
      );

      assert.ok(Array.isArray(duplicateCandidatesFromPipeline));
      assert.equal(duplicateCandidatesFromPipeline.length, 1);
      assert.equal(duplicateCandidatesFromPipeline[0].duplicateKind, "exact");
      assert.equal(duplicateCandidatesFromPipeline[0].existingNoteId, firstStoredNote.id);
      assert.equal(duplicateCandidatesFromPipeline[0].similarity.exactBodyMatch, true);
      assert.equal(duplicateCandidatesFromPipeline[0].similarity.exactTitleMatch, false);
      assert.equal(
        duplicateCandidatesFromPipeline[0].similarity.exactSourceIndependentMatch,
        false
      );
      assert.equal(duplicateRelationships.length, 1);
      assert.equal(duplicateRelationships[0].note_id, secondStoredNote.id);
      assert.equal(duplicateRelationships[0].related_note_id, firstStoredNote.id);
      assert.equal(duplicateRelationships[0].overlap_source_metadata.duplicateKind, "exact");
      assert.ok(duplicateRelationships[0].overlap_terms.includes("copilot"));
      assert.ok(duplicateRelationships[0].overlap_terms.includes("42"));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("replaceNotesForEmail persists aggregated overlap results keyed by related note id", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-note-aggregate-links-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstPayload = buildAgentMailPayload();
      const firstDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-aggregate-link-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });

      replaceNotesForEmail(db, firstDelivery.emailId, [
        {
          type: "idea",
          title: "Workflow reviews are tightening",
          content: "Operators are tightening AI workflow reviews across finance teams.",
          topics: ["workflow automation"],
          keywords: ["prompt review cadence"],
        },
      ]);

      const firstStoredNote = listNotesByEmailId(db, firstDelivery.emailId)[0];
      const secondPayload = {
        ...buildAgentMailPayload(),
        event_id: "evt_news_aggregate_overlap",
        message: {
          ...buildAgentMailPayload().message,
          message_id: "msg_news_aggregate_overlap",
          subject: "Operator cadence update",
          extracted_text:
            "Operators are assigning owners to each weekly prompt review step.",
        },
        thread: {
          ...buildAgentMailPayload().thread,
          subject: "Operator cadence update",
        },
      };
      const secondDelivery = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-note-aggregate-link-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });

      replaceNotesForEmail(db, secondDelivery.emailId, [
        {
          type: "task",
          title: "Assign weekly review owners",
          content: "Operators should assign owners to each weekly prompt review step.",
          topics: ["workflow automation"],
          keywords: ["prompt review cadence"],
        },
      ]);

      const relationships = listRelationships(db);

      assert.equal(relationships.length, 2);
      assert.deepEqual(
        relationships.map((relationship) => relationship.overlap_basis),
        ["keyword", "topic"]
      );
      assert.ok(relationships[0].overlap_terms.includes("prompt review cadence"));
      assert.deepEqual(relationships[1].overlap_terms, ["workflow automation"]);
      assert.deepEqual(
        relationships.map((relationship) => relationship.overlap_source_metadata),
        [
          {
            matchedBy: "keyword_overlap",
            newNoteIndex: 0,
            newNoteType: "task",
            newNoteTitle: "Assign weekly review owners",
            existingEmailId: firstDelivery.emailId,
            existingNoteType: "idea",
            existingNoteTitle: firstStoredNote.title,
          },
          {
            matchedBy: "topic_overlap",
            newNoteIndex: 0,
            newNoteType: "task",
            newNoteTitle: "Assign weekly review owners",
            existingEmailId: firstDelivery.emailId,
            existingNoteType: "idea",
            existingNoteTitle: firstStoredNote.title,
          },
        ]
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
