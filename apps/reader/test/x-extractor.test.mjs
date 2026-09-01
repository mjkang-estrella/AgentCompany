import test from "node:test";
import assert from "node:assert/strict";

import {
  extractXPostFromOEmbedPayload,
  isLikelyLongFormXArticle,
  isPotentialXContentUrl,
  recoverXArticleAuthor,
  recoverXArticleTitle,
  isXStatusUrl
} from "../lib/x-extractor.mjs";

test("isXStatusUrl recognizes x and twitter status URLs", () => {
  assert.equal(isXStatusUrl("https://x.com/mitchellh/status/2041566958681014418?s=20"), true);
  assert.equal(isXStatusUrl("https://twitter.com/mitchellh/status/2041566958681014418"), true);
  assert.equal(isXStatusUrl("https://x.com/mitchellh"), false);
});

test("isPotentialXContentUrl recognizes direct statuses and t.co redirects", () => {
  assert.equal(isPotentialXContentUrl("https://x.com/mitchellh/status/2041566958681014418"), true);
  assert.equal(isPotentialXContentUrl("https://t.co/yaevaqn3So"), true);
  assert.equal(isPotentialXContentUrl("https://example.com/article"), false);
});

test("recoverXArticleTitle replaces redirect titles with a distinct short summary", () => {
  assert.equal(recoverXArticleTitle({
    bodyHtml: "<p>Every day, you're learning something new through practice.</p>",
    summaryHtml: "<p>The Principles of Learning Faster.</p>",
    title: "https://t.co/yaevaqn3So"
  }), "The Principles of Learning Faster");

  assert.equal(recoverXArticleTitle({
    bodyHtml: "<p>Ship the boring thing first.</p>",
    summaryHtml: "<p>Ship the boring thing first.</p>",
    title: "https://t.co/example"
  }), "https://t.co/example");
});

test("recoverXArticleAuthor uses the canonical status handle for generic X attribution", () => {
  assert.equal(recoverXArticleAuthor({
    author: "X (formerly Twitter)",
    canonicalUrl: "https://x.com/0xHvdes/status/2094075106096009695"
  }), "@0xHvdes");
  assert.equal(recoverXArticleAuthor({
    author: "Mitchell Hashimoto",
    canonicalUrl: "https://x.com/mitchellh/status/2041566958681014418"
  }), "Mitchell Hashimoto");
});

test("isLikelyLongFormXArticle separates articles from ordinary posts", () => {
  assert.equal(isLikelyLongFormXArticle({
    bodyHtml: `<h2>First principle</h2><p>${"Long-form explanation. ".repeat(40)}</p>`,
    readTimeMinutes: 4
  }), true);
  assert.equal(isLikelyLongFormXArticle({
    bodyHtml: "<p>Ship the boring thing first.</p>",
    readTimeMinutes: 1
  }), false);
});

test("extractXPostFromOEmbedPayload builds article content from oembed html", () => {
  const extracted = extractXPostFromOEmbedPayload({
    author_name: "Mitchell Hashimoto",
    html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Ship the boring thing first.</p>&mdash; Mitchell Hashimoto (@mitchellh) <a href="https://twitter.com/mitchellh/status/2041566958681014418?ref_src=twsrc%5Etfw">April 7, 2026</a></blockquote>`,
    url: "https://twitter.com/mitchellh/status/2041566958681014418"
  }, "https://x.com/mitchellh/status/2041566958681014418?s=20");

  assert.equal(extracted.author, "Mitchell Hashimoto");
  assert.equal(extracted.canonicalUrl, "https://twitter.com/mitchellh/status/2041566958681014418");
  assert.equal(extracted.quality, "usable");
  assert.match(extracted.bodyHtml, /Ship the boring thing first/i);
  assert.equal(extracted.title, "Ship the boring thing first.");
});
