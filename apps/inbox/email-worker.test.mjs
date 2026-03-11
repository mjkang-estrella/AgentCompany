import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import {
  getEmailById,
  getEmailProcessingJobById,
  initializeDatabase,
  listEmailProcessingEvents,
  listNotesByEmailId,
  openDatabaseConnection,
} from "./database.mjs";
import { createEmailProcessingWorker } from "./email-worker.mjs";
import { processEmailToNotes } from "./note-pipeline.mjs";
import { createInboxHandler } from "./server.mjs";

const silentLogger = {
  error() {},
  warn() {},
};

function buildAgentMailPayload(messageId = "msg_email_worker_1") {
  return {
    event_id: `evt_${messageId}`,
    event_type: "message.received",
    message: {
      message_id: messageId,
      inbox_id: "inbox_news",
      subject: "Newsletter signals for March",
      from: "Signals Weekly <editor@example.com>",
      timestamp: "2026-03-09T17:00:00Z",
      extracted_text: [
        "Teams running agent workflows should review prompts weekly.",
        "AI copilots grew 42% year over year.",
      ].join("\n\n"),
      headers: {
        "message-id": `<${messageId}@example.com>`,
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

async function requestWebhook(handler, payload, headers = {}) {
  const body = JSON.stringify(payload);
  const req = Readable.from([body]);
  req.method = "POST";
  req.url = "/webhooks/agentmail";
  req.headers = {
    host: "localhost",
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
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

async function waitFor(assertion, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 20;
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
    }
  }

  throw lastError ?? new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function withDatabases(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-email-worker-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await initializeDatabase({ databasePath });
    const { db: requestDatabase } = await openDatabaseConnection({ databasePath });
    const { db: workerDatabase } = await openDatabaseConnection({ databasePath });

    try {
      await run({ requestDatabase, workerDatabase });
    } finally {
      requestDatabase.close();
      workerDatabase.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("email worker drains queued jobs outside the webhook request lifecycle", async () => {
  await withDatabases(async ({ requestDatabase, workerDatabase }) => {
    const releaseGeneration = createDeferred();
    let generationStarted = false;
    const worker = createEmailProcessingWorker({
      database: workerDatabase,
      logger: silentLogger,
      pollIntervalMs: 10,
      noteProcessor(database, emailId, options = {}) {
        return processEmailToNotes(database, emailId, {
          ...options,
          logger: silentLogger,
          generateAtomicNotes: async () => {
            generationStarted = true;
            await releaseGeneration.promise;

            return [
              {
                type: "idea",
                content: "Teams should review prompts weekly to keep agent workflows healthy.",
              },
            ];
          },
        });
      },
    });

    worker.start();

    try {
      const handler = createInboxHandler({
        database: requestDatabase,
        logger: silentLogger,
        jobWorker: worker,
      });
      const response = await requestWebhook(handler, buildAgentMailPayload("msg_worker_success"), {
        "svix-id": "svix-worker-success",
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.payload.status, "stored");
      assert.equal(response.payload.jobStatus, "queued");
      assert.equal(generationStarted, false);
      assert.equal(listNotesByEmailId(requestDatabase, response.payload.emailId).length, 0);
      assert.ok(getEmailProcessingJobById(requestDatabase, response.payload.processingJobId));

      await waitFor(() => {
        assert.equal(generationStarted, true);
        assert.equal(
          getEmailProcessingJobById(requestDatabase, response.payload.processingJobId)?.status,
          "processing"
        );
      });

      assert.equal(listNotesByEmailId(requestDatabase, response.payload.emailId).length, 0);

      releaseGeneration.resolve();

      await waitFor(() => {
        const completedJob = getEmailProcessingJobById(
          requestDatabase,
          response.payload.processingJobId
        );
        const email = getEmailById(requestDatabase, response.payload.emailId);
        const notes = listNotesByEmailId(requestDatabase, response.payload.emailId);

        assert.equal(completedJob?.status, "completed");
        assert.equal(email?.ingestion_status, "processed");
        assert.equal(email?.relevance_status, "relevant");
        assert.equal(notes.length, 1);
        assert.equal(notes[0].taxonomy_key, "idea");
      });

      const events = listEmailProcessingEvents(requestDatabase, {
        processingJobId: response.payload.processingJobId,
      }).map((event) => ({
        event_type: event.event_type,
        job_status: event.job_status,
        error_message: event.error_message,
      }));

      assert.deepEqual(events, [
        {
          event_type: "queued",
          job_status: "queued",
          error_message: null,
        },
        {
          event_type: "processing_started",
          job_status: "processing",
          error_message: null,
        },
        {
          event_type: "processing_completed",
          job_status: "completed",
          error_message: null,
        },
      ]);
    } finally {
      releaseGeneration.resolve();
      await worker.stop();
    }
  });
});

test("email worker drains jobs that were queued before the worker started", async () => {
  await withDatabases(async ({ requestDatabase, workerDatabase }) => {
    const handler = createInboxHandler({
      database: requestDatabase,
      logger: silentLogger,
    });
    const response = await requestWebhook(handler, buildAgentMailPayload("msg_worker_boot_queue"), {
      "svix-id": "svix-worker-boot-queue",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.equal(response.payload.jobStatus, "queued");
    assert.equal(
      getEmailProcessingJobById(requestDatabase, response.payload.processingJobId)?.status,
      "queued"
    );
    assert.equal(listNotesByEmailId(requestDatabase, response.payload.emailId).length, 0);

    const worker = createEmailProcessingWorker({
      database: workerDatabase,
      logger: silentLogger,
      pollIntervalMs: 10,
      noteProcessor(database, emailId, options = {}) {
        return processEmailToNotes(database, emailId, {
          ...options,
          logger: silentLogger,
          generateAtomicNotes: async () => [
            {
              type: "idea",
              content:
                "Teams should run a weekly prompt audit to keep agent workflows healthy.",
            },
          ],
        });
      },
    });

    worker.start();

    try {
      await waitFor(() => {
        const completedJob = getEmailProcessingJobById(
          requestDatabase,
          response.payload.processingJobId
        );
        const email = getEmailById(requestDatabase, response.payload.emailId);
        const notes = listNotesByEmailId(requestDatabase, response.payload.emailId);

        assert.equal(completedJob?.status, "completed");
        assert.equal(email?.ingestion_status, "processed");
        assert.equal(email?.relevance_status, "relevant");
        assert.equal(notes.length, 1);
        assert.equal(notes[0].taxonomy_key, "idea");
      });
    } finally {
      await worker.stop();
    }
  });
});

test("email worker skips irrelevant promotional emails and completes the queued job", async () => {
  await withDatabases(async ({ requestDatabase, workerDatabase }) => {
    const worker = createEmailProcessingWorker({
      database: workerDatabase,
      logger: silentLogger,
      pollIntervalMs: 10,
      noteProcessor(database, emailId, options = {}) {
        return processEmailToNotes(database, emailId, {
          ...options,
          logger: silentLogger,
          generateAtomicNotes: async () => {
            throw new Error("promotional emails should not reach note generation");
          },
        });
      },
    });

    worker.start();

    try {
      const handler = createInboxHandler({
        database: requestDatabase,
        logger: silentLogger,
        jobWorker: worker,
      });
      const payload = buildAgentMailPayload("msg_worker_promo_skip");
      payload.message.subject = "Flash sale: save 50% on agent templates today";
      payload.message.from = "Offers Team <promo@example.com>";
      payload.message.extracted_text =
        "Limited time offer. Use promo code SAVE50. Buy now and start your free trial today.";

      const response = await requestWebhook(handler, payload, {
        "svix-id": "svix-worker-promo-skip",
      });

      await waitFor(() => {
        const completedJob = getEmailProcessingJobById(
          requestDatabase,
          response.payload.processingJobId
        );
        const email = getEmailById(requestDatabase, response.payload.emailId);
        const notes = listNotesByEmailId(requestDatabase, response.payload.emailId);

        assert.equal(completedJob?.status, "completed");
        assert.equal(email?.ingestion_status, "skipped");
        assert.equal(email?.relevance_status, "promotion");
        assert.equal(notes.length, 0);
      });
    } finally {
      await worker.stop();
    }
  });
});

test("webhook returns 200 before the deferred worker signal resolves", async () => {
  await withDatabases(async ({ requestDatabase }) => {
    const releaseSignal = createDeferred();
    let signalStarted = false;
    let signalFinished = false;
    const handler = createInboxHandler({
      database: requestDatabase,
      logger: silentLogger,
      jobWorker: {
        signal() {
          signalStarted = true;

          return releaseSignal.promise.finally(() => {
            signalFinished = true;
          });
        },
      },
    });

    const response = await requestWebhook(
      handler,
      buildAgentMailPayload("msg_worker_signal_async"),
      {
        "svix-id": "svix-worker-signal-async",
      }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, "stored");
    assert.equal(response.payload.jobStatus, "queued");
    assert.equal(signalStarted, false);
    assert.equal(signalFinished, false);
    assert.equal(listNotesByEmailId(requestDatabase, response.payload.emailId).length, 0);
    assert.equal(
      getEmailProcessingJobById(requestDatabase, response.payload.processingJobId)?.status,
      "queued"
    );

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(signalStarted, true);
    assert.equal(signalFinished, false);

    releaseSignal.resolve();

    await waitFor(() => {
      assert.equal(signalFinished, true);
    });
  });
});

test("email worker marks failed jobs and logs async pipeline errors", async () => {
  await withDatabases(async ({ requestDatabase, workerDatabase }) => {
    const errorLogs = [];
    const logger = {
      warn() {},
      error(...args) {
        errorLogs.push(args.map((value) => String(value)).join(" "));
      },
    };
    const worker = createEmailProcessingWorker({
      database: workerDatabase,
      logger,
      pollIntervalMs: 10,
      noteProcessor(database, emailId, options = {}) {
        return processEmailToNotes(database, emailId, {
          ...options,
          logger,
          generateAtomicNotes: async () => {
            throw new Error("simulated worker failure");
          },
        });
      },
    });

    worker.start();

    try {
      const handler = createInboxHandler({
        database: requestDatabase,
        logger,
        jobWorker: worker,
      });
      const response = await requestWebhook(handler, buildAgentMailPayload("msg_worker_failure"), {
        "svix-id": "svix-worker-failure",
      });

      await waitFor(() => {
        const failedJob = getEmailProcessingJobById(
          requestDatabase,
          response.payload.processingJobId
        );
        const email = getEmailById(requestDatabase, response.payload.emailId);

        assert.equal(failedJob?.status, "failed");
        assert.match(failedJob?.error_message ?? "", /simulated worker failure/);
        assert.equal(email?.ingestion_status, "failed");
        assert.equal(email?.relevance_status, "relevant");
        assert.match(email?.processing_error ?? "", /simulated worker failure/);
      });

      assert.ok(
        errorLogs.some((entry) => entry.includes("simulated worker failure")),
        "expected the worker failure to be logged"
      );

      const events = listEmailProcessingEvents(requestDatabase, {
        processingJobId: response.payload.processingJobId,
      }).map((event) => ({
        event_type: event.event_type,
        job_status: event.job_status,
        error_message: event.error_message,
      }));

      assert.deepEqual(events, [
        {
          event_type: "queued",
          job_status: "queued",
          error_message: null,
        },
        {
          event_type: "processing_started",
          job_status: "processing",
          error_message: null,
        },
        {
          event_type: "processing_failed",
          job_status: "failed",
          error_message: "simulated worker failure",
        },
      ]);
    } finally {
      await worker.stop();
    }
  });
});
