import test from "node:test";
import assert from "node:assert/strict";

import {
  extractXPostFromOEmbedPayload,
  isXStatusUrl
} from "../lib/x-extractor.mjs";

test("isXStatusUrl recognizes x and twitter status URLs", () => {
  assert.equal(isXStatusUrl("https://x.com/mitchellh/status/2041566958681014418?s=20"), true);
  assert.equal(isXStatusUrl("https://twitter.com/mitchellh/status/2041566958681014418"), true);
  assert.equal(isXStatusUrl("https://x.com/mitchellh"), false);
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
