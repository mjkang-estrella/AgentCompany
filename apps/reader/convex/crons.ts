import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reader-sync-feeds-every-30-minutes",
  { minutes: 30 },
  internal.sync.runActiveFeeds,
  {}
);

crons.interval(
  "reader-daily-digest-hourly-check",
  { hours: 1 },
  internal.digestNode.ensureScheduledDigest,
  {}
);

crons.interval(
  "reader-newsletters-every-15-minutes",
  { minutes: 15 },
  internal.newslettersNode.syncInbox,
  {
    createIfMissing: true
  }
);

export default crons;
