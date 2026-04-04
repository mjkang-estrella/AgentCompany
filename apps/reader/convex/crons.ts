import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reader-sync-feeds-hourly",
  { hours: 1 },
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
  "reader-newsletters-hourly",
  { hours: 1 },
  internal.newslettersNode.syncInbox,
  {
    createIfMissing: true
  }
);

export default crons;
