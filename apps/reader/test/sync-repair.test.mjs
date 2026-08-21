import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_USABLE_ARTICLE_BODY_CHARS,
  shouldProcessFeedEntry
} from "../lib/sync-repair.mjs";

test("shouldProcessFeedEntry always repairs weak stored bodies", () => {
  assert.equal(
    shouldProcessFeedEntry({
      existing: { bodyTextLength: MIN_USABLE_ARTICLE_BODY_CHARS - 1 },
      feedLastSyncedAt: 2_000,
      index: 20,
      publishedAt: 1_000
    }),
    true
  );
});

test("shouldProcessFeedEntry skips strong old bodies outside the recent window", () => {
  assert.equal(
    shouldProcessFeedEntry({
      existing: { bodyTextLength: 2_000 },
      feedLastSyncedAt: 2_000,
      index: 20,
      publishedAt: 1_000
    }),
    false
  );
});
