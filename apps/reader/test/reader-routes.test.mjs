import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReaderPath,
  parseReaderPath,
  slugifySegment
} from "../lib/reader-routes.mjs";

test("slugifySegment creates stable slugs", () => {
  assert.equal(
    slugifySegment("How to Design for Human-agent Interaction"),
    "how-to-design-for-human-agent-interaction"
  );
  assert.equal(slugifySegment("Every"), "every");
});

test("parseReaderPath handles feed article routes", () => {
  assert.deepEqual(
    parseReaderPath("/feed/every/how-to-design-for-human-agent-interaction"),
    {
      articleSlug: "how-to-design-for-human-agent-interaction",
      browseFeedGroups: false,
      feedGroupSlug: "every",
      localDate: "",
      route: "feed",
      scope: "all"
    }
  );
});

test("buildReaderPath creates feed article routes", () => {
  assert.equal(
    buildReaderPath({
      articleTitle: "How to Design for Human-agent Interaction",
      explicitArticleSelection: true,
      feedGroup: "Every",
      scope: "all"
    }),
    "/feed/every/how-to-design-for-human-agent-interaction"
  );
});
