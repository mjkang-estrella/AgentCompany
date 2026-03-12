import { waitUntil } from "@vercel/functions";

export function runInBackground(task: Promise<unknown>): void {
  const trackedTask = task.catch((error) => {
    console.error("[Prism] background task failed.", error);
  });

  try {
    waitUntil(trackedTask);
  } catch {
    void trackedTask;
  }
}
