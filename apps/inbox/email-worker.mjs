import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  claimNextEmailProcessingJob,
  listEmailProcessingJobs,
  updateEmailProcessingJobState,
} from "./database.mjs";
import { processEmailToNotes } from "./note-pipeline.mjs";

function normalizePollIntervalMs(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 250;
}

export function createEmailProcessingWorker(options) {
  const {
    database,
    logger = console,
    noteProcessor = processEmailToNotes,
    pollIntervalMs = 250,
    workerId = `email-worker-${randomUUID()}`,
  } = options;

  const intervalMs = normalizePollIntervalMs(pollIntervalMs);
  let stopping = false;
  let loopPromise = null;
  let wakePromise = null;
  let wakeResolver = null;

  function clearWakeSignal(targetPromise = wakePromise) {
    if (wakePromise === targetPromise) {
      wakePromise = null;
      wakeResolver = null;
    }
  }

  function getWakePromise() {
    if (!wakePromise) {
      wakePromise = new Promise((resolve) => {
        wakeResolver = resolve;
      });
    }

    return wakePromise;
  }

  function signal() {
    if (wakeResolver) {
      const resolve = wakeResolver;
      clearWakeSignal();
      resolve();
    }
  }

  async function waitForMoreWork() {
    const pendingWake = getWakePromise();

    await Promise.race([delay(intervalMs), pendingWake]);
    clearWakeSignal(pendingWake);
  }

  function resetInFlightJobs() {
    const processingJobs = listEmailProcessingJobs(database).filter(
      (job) => job.status === "processing"
    );

    for (const job of processingJobs) {
      updateEmailProcessingJobState(database, job.id, {
        status: "queued",
        errorMessage: null,
      });
    }

    if (processingJobs.length > 0) {
      logger.warn?.(
        `[email-worker] Reset ${processingJobs.length} in-flight job(s) back to queued for ${workerId}`
      );
    }
  }

  async function runClaimedJob(job) {
    try {
      await noteProcessor(database, job.email_id, {
        logger,
        jobAlreadyClaimed: true,
        processingJobId: job.id,
      });
    } catch (error) {
      logger.error?.(
        `[email-worker] Failed job ${job.id} for email ${job.email_id}:`,
        error
      );
    }
  }

  async function drainOnce() {
    let processedCount = 0;

    while (!stopping) {
      const job = claimNextEmailProcessingJob(database);

      if (!job) {
        break;
      }

      processedCount += 1;
      await runClaimedJob(job);
    }

    return processedCount;
  }

  async function runLoop() {
    resetInFlightJobs();

    while (!stopping) {
      try {
        const processedCount = await drainOnce();

        if (stopping) {
          break;
        }

        if (processedCount === 0) {
          await waitForMoreWork();
        }
      } catch (error) {
        logger.error?.(`[email-worker] Worker loop failed for ${workerId}:`, error);

        if (!stopping) {
          await delay(intervalMs);
        }
      }
    }
  }

  return {
    workerId,
    start() {
      if (loopPromise) {
        return;
      }

      stopping = false;
      loopPromise = runLoop().finally(() => {
        clearWakeSignal();
        loopPromise = null;
      });
    },
    signal,
    drainOnce,
    async stop() {
      if (!loopPromise) {
        return;
      }

      stopping = true;
      signal();
      await loopPromise;
    },
  };
}
