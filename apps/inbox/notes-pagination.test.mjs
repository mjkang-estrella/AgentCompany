import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  initializeDatabase,
  openDatabaseConnection,
  replaceNotesForEmail,
  storeAgentMailWebhookDelivery,
} from "./database.mjs";
import { createInboxHandler } from "./server.mjs";

const silentLogger = {
  error() {},
  info() {},
  warn() {},
};

function buildAgentMailPayload() {
  return {
    event_id: "evt_notes_pagination_1",
    event_type: "message.received",
    message: {
      message_id: "msg_notes_pagination_1",
      inbox_id: "inbox_news",
      subject: "Newsletter pagination coverage",
      from: "Signals Weekly <editor@example.com>",
      timestamp: "2026-03-09T17:00:00Z",
      extracted_text: "Pagination coverage note seed.",
      headers: {
        "message-id": "<msg_notes_pagination_1@example.com>",
      },
    },
    thread: {
      inbox_id: "inbox_news",
      subject: "Newsletter pagination coverage",
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

async function withTestDatabase(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-pagination-test-"));
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

test("GET /notes paginates note graph results and returns the total count", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const deliveryResult = storeAgentMailWebhookDelivery(db, {
      deliveryId: "svix-notes-pagination-1",
      eventType: payload.event_type,
      rawPayload: JSON.stringify(payload),
      payload,
    });

    replaceNotesForEmail(
      db,
      deliveryResult.emailId,
      Array.from({ length: 60 }, (_, index) => {
        const noteNumber = index + 1;
        const titleNumber = String(noteNumber).padStart(2, "0");
        const minute = String(index).padStart(2, "0");

        return {
          type: "idea",
          title: `Note ${titleNumber}`,
          content: `Atomic note ${titleNumber} content.`,
          summary: `Atomic note ${titleNumber} summary.`,
          sourceExcerpt: `Atomic note ${titleNumber} excerpt.`,
          sourceTimestamp: `2026-03-09T17:${minute}:00Z`,
          confidence: 0.8,
        };
      })
    );

    const handler = createInboxHandler({
      database: db,
      logger: silentLogger,
    });

    const defaultResponse = await requestJson(handler, "/notes");

    assert.equal(defaultResponse.statusCode, 200);
    assert.equal(defaultResponse.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(defaultResponse.payload.page, 1);
    assert.equal(defaultResponse.payload.limit, 50);
    assert.equal(defaultResponse.payload.total, 60);
    assert.equal(defaultResponse.payload.notes.length, 50);
    assert.equal(defaultResponse.payload.notes[0].title, "Note 60");
    assert.equal(defaultResponse.payload.notes[49].title, "Note 11");

    const secondPageResponse = await requestJson(handler, "/notes?page=2&limit=10");

    assert.equal(secondPageResponse.statusCode, 200);
    assert.equal(secondPageResponse.payload.page, 2);
    assert.equal(secondPageResponse.payload.limit, 10);
    assert.equal(secondPageResponse.payload.total, 60);
    assert.deepEqual(
      secondPageResponse.payload.notes.map((note) => note.title),
      Array.from({ length: 10 }, (_, index) => `Note ${String(50 - index).padStart(2, "0")}`)
    );
  });
});
