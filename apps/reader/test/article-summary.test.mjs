import test from "node:test";
import assert from "node:assert/strict";

import {
  SUMMARY_BODY_CHAR_LIMIT,
  SUMMARY_MAX_KEY_POINTS,
  buildSummaryPrompt,
  buildSummarySource,
  buildSummarySourceHash,
  getSummaryModel,
  parseSummaryOutput
} from "../lib/article-summary.mjs";

test("getSummaryModel prefers READER_SUMMARY_MODEL, then the digest model, then the default", () => {
  const previousSummary = process.env.READER_SUMMARY_MODEL;
  const previousDigest = process.env.READER_DIGEST_MODEL;

  try {
    delete process.env.READER_SUMMARY_MODEL;
    delete process.env.READER_DIGEST_MODEL;
    assert.equal(getSummaryModel(), "gpt-4.1-mini");

    process.env.READER_DIGEST_MODEL = "digest-model";
    assert.equal(getSummaryModel(), "digest-model");

    process.env.READER_SUMMARY_MODEL = "summary-model";
    assert.equal(getSummaryModel(), "summary-model");
  } finally {
    if (previousSummary === undefined) delete process.env.READER_SUMMARY_MODEL;
    else process.env.READER_SUMMARY_MODEL = previousSummary;
    if (previousDigest === undefined) delete process.env.READER_DIGEST_MODEL;
    else process.env.READER_DIGEST_MODEL = previousDigest;
  }
});

test("buildSummarySource normalizes whitespace and caps the body with a truncation marker", () => {
  const short = buildSummarySource({
    author: "  Jane   Doe ",
    bodyText: "First   line.\n\nSecond line.",
    title: " Title "
  });
  assert.equal(short.bodyText, "First line. Second line.");
  assert.equal(short.author, "Jane Doe");
  assert.equal(short.title, "Title");
  assert.equal(short.truncated, false);

  const long = buildSummarySource({
    bodyText: "x".repeat(SUMMARY_BODY_CHAR_LIMIT + 500),
    title: "Long"
  });
  assert.equal(long.truncated, true);
  assert.ok(long.bodyText.startsWith("x".repeat(SUMMARY_BODY_CHAR_LIMIT)));
  assert.match(long.bodyText, /truncated for length/u);
  assert.ok(long.bodyText.length < SUMMARY_BODY_CHAR_LIMIT + 100);
});

test("buildSummaryPrompt asks for the JSON shape and embeds the source text", () => {
  const prompt = buildSummaryPrompt(buildSummarySource({
    bodyText: "Convex actions can call OpenAI.",
    feedTitle: "Engineering Blog",
    title: "Summaries at sync time"
  }));

  assert.match(prompt, /"gist":"string","keyPoints":\["string"\],"takeaway":"string"/u);
  assert.match(prompt, /follow the article's own order/u);
  assert.match(prompt, /takeaway: one sentence/u);
  assert.match(prompt, /Do not mention that this is AI-generated/u);

  const payload = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  assert.equal(payload.title, "Summaries at sync time");
  assert.equal(payload.feedTitle, "Engineering Blog");
  assert.equal(payload.text, "Convex actions can call OpenAI.");
  assert.equal(payload.truncated, undefined);
  assert.equal(payload.author, undefined);
});

test("parseSummaryOutput strips code fences, list prefixes, and caps key points", () => {
  const raw = [
    "```json",
    JSON.stringify({
      extra: "ignored",
      gist: "  The core claim.  ",
      keyPoints: [
        "- first point",
        "2. second point",
        "",
        "   ",
        "• third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth"
      ],
      takeaway: " Read it if you run Convex. "
    }),
    "```"
  ].join("\n");

  const parsed = parseSummaryOutput(raw);
  assert.equal(parsed.gist, "The core claim.");
  assert.deepEqual(parsed.keyPoints, ["first point", "second point", "third", "fourth", "fifth", "sixth"]);
  assert.equal(parsed.keyPoints.length, SUMMARY_MAX_KEY_POINTS);
  assert.equal(parsed.takeaway, "Read it if you run Convex.");
});

test("parseSummaryOutput tolerates a missing takeaway and a string keyPoints value", () => {
  const parsed = parseSummaryOutput(JSON.stringify({ gist: "Gist.", keyPoints: "Only one point." }));
  assert.equal(parsed.gist, "Gist.");
  assert.deepEqual(parsed.keyPoints, ["Only one point."]);
  assert.equal(parsed.takeaway, "");
});

test("parseSummaryOutput rejects an empty gist", () => {
  assert.throws(() => parseSummaryOutput(JSON.stringify({ gist: "  ", keyPoints: ["x"] })), /gist/u);
  assert.throws(() => parseSummaryOutput("not json"));
});

test("buildSummarySourceHash is stable for identical input and changes with the body", () => {
  const a = buildSummarySourceHash({ bodyHtml: "<p>Hello</p>", title: "T" });
  const b = buildSummarySourceHash({ bodyHtml: "<p>Hello</p>", title: "T" });
  const c = buildSummarySourceHash({ bodyHtml: "<p>Hello world</p>", title: "T" });
  const d = buildSummarySourceHash({ bodyHtml: "<p>Hello</p>", title: "Other" });

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^[0-9a-f]{8}$/u);
});
