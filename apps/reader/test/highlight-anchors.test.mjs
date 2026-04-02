import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHighlightContext,
  highlightsOverlap,
  resolveHighlightOffsets
} from "../lib/highlight-anchors.mjs";

test("buildHighlightContext trims surrounding whitespace and keeps context", () => {
  const fullText = "Hello world. Reader highlight test.";
  const context = buildHighlightContext(fullText, 5, 13);

  assert.equal(context.selectedText, "world.");
  assert.equal(context.startOffset, 6);
  assert.equal(context.endOffset, 12);
  assert.match(context.prefixText, /Hello/u);
});

test("resolveHighlightOffsets falls back by matching quote and context", () => {
  const fullText = "Intro. Key sentence here. Another key sentence here. Outro.";
  const highlight = {
    endOffset: 24,
    prefixText: "Intro. ",
    selectedText: "Key sentence here.",
    startOffset: 7,
    suffixText: " Another"
  };

  const resolved = resolveHighlightOffsets(fullText, highlight);
  assert.deepEqual(resolved, {
    endOffset: 25,
    startOffset: 7
  });
});

test("highlightsOverlap detects intersecting ranges", () => {
  assert.equal(
    highlightsOverlap({ startOffset: 10, endOffset: 20 }, { startOffset: 15, endOffset: 25 }),
    true
  );
  assert.equal(
    highlightsOverlap({ startOffset: 10, endOffset: 20 }, { startOffset: 20, endOffset: 25 }),
    false
  );
});
