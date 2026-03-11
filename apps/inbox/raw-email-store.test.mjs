import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { initializeDatabase, openDatabaseConnection } from "./database.mjs";
import {
  getRawEmailById,
  getRawEmailByMessageId,
  insertRawEmail,
} from "./raw-email-store.mjs";

function buildAgentMailPayload(overrides = {}) {
  const messageOverrides = overrides.message ?? {};
  const threadOverrides = overrides.thread ?? {};

  return {
    event_id: overrides.event_id ?? "evt_raw_email_1",
    event_type: overrides.event_type ?? "message.received",
    message: {
      message_id: "msg_raw_email_1",
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      from: "Signals Weekly <editor@example.com>",
      timestamp: "2026-03-09T17:00:00Z",
      extracted_text: "Teams running agent workflows should review prompts weekly.",
      extracted_html: "<p>Teams running agent workflows should review prompts weekly.</p>",
      headers: {
        "message-id": "<msg_raw_email_1@example.com>",
        sender: "Dispatch Desk <sender@example.com>",
      },
      ...messageOverrides,
    },
    thread: {
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      received_timestamp: "2026-03-09T17:00:05Z",
      ...threadOverrides,
    },
  };
}

async function withTestDatabase(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-raw-email-store-"));
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

test("insertRawEmail persists one AgentMail message.received payload in raw_emails", async () => {
  await withTestDatabase(async (db) => {
    const payload = buildAgentMailPayload();
    const rawPayload = JSON.stringify(payload);
    const inserted = insertRawEmail(db, {
      deliveryId: "svix-raw-email-1",
      eventType: payload.event_type,
      rawPayload,
      payload,
    });

    assert.ok(inserted?.id);
    assert.equal(inserted.webhook_delivery_id, null);
    assert.equal(inserted.delivery_id, "svix-raw-email-1");
    assert.equal(inserted.provider, "agentmail");
    assert.equal(inserted.event_type, "message.received");
    assert.equal(inserted.agentmail_message_id, "msg_raw_email_1");
    assert.equal(inserted.agentmail_inbox_id, "inbox_news");
    assert.equal(inserted.message_id_header, "<msg_raw_email_1@example.com>");
    assert.equal(inserted.subject, "Newsletter signals for March");
    assert.equal(inserted.from_name, "Signals Weekly");
    assert.equal(inserted.from_address, "editor@example.com");
    assert.equal(inserted.sender_address, "sender@example.com");
    assert.equal(inserted.sent_at, "2026-03-09T17:00:00Z");
    assert.equal(inserted.received_at, "2026-03-09T17:00:05Z");
    assert.match(inserted.text_content, /review prompts weekly/i);
    assert.match(inserted.html_content, /<p>/i);
    assert.equal(inserted.raw_payload, rawPayload);
    assert.match(inserted.created_at, /^\d{4}-\d{2}-\d{2} /);
    assert.match(inserted.updated_at, /^\d{4}-\d{2}-\d{2} /);
    assert.deepEqual(getRawEmailById(db, inserted.id), inserted);
  });
});

test("insertRawEmail updates the existing raw_emails row for duplicate AgentMail message ids", async () => {
  await withTestDatabase(async (db) => {
    const firstPayload = buildAgentMailPayload();
    const firstRawEmail = insertRawEmail(db, {
      deliveryId: "svix-raw-email-dup-1",
      eventType: firstPayload.event_type,
      rawPayload: JSON.stringify(firstPayload),
      payload: firstPayload,
    });

    const secondPayload = buildAgentMailPayload({
      message: {
        subject: "Newsletter signals for April",
        extracted_text: "Updated newsletter content for the same message id.",
      },
    });
    const secondRawPayload = JSON.stringify(secondPayload);
    const secondRawEmail = insertRawEmail(db, {
      deliveryId: "svix-raw-email-dup-2",
      eventType: secondPayload.event_type,
      rawPayload: secondRawPayload,
      payload: secondPayload,
    });

    assert.equal(secondRawEmail.id, firstRawEmail.id);
    assert.equal(secondRawEmail.webhook_delivery_id, null);
    assert.equal(secondRawEmail.delivery_id, "svix-raw-email-dup-2");
    assert.equal(secondRawEmail.subject, "Newsletter signals for April");
    assert.match(secondRawEmail.text_content, /updated newsletter content/i);
    assert.equal(secondRawEmail.raw_payload, secondRawPayload);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM raw_emails WHERE agentmail_message_id = ?")
        .get("msg_raw_email_1").count,
      1
    );
    assert.deepEqual(
      getRawEmailByMessageId(db, "msg_raw_email_1"),
      secondRawEmail
    );
  });
});
