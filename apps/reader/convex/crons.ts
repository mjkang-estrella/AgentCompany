import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reader-sync-feeds-every-15-minutes",
  { minutes: 15 },
  internal.sync.runActiveFeeds,
  {}
);

export default crons;
