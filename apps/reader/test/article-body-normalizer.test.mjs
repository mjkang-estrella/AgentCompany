import test from "node:test";
import assert from "node:assert/strict";

import { normalizeArticleContent } from "../lib/article-body-normalizer.mjs";

test("normalizeArticleContent removes A Smart Bear style lead utility blocks", () => {
  const html = `
    <p>February 22, 2026</p>
    <p><a href="/kindle">ePub (Kindle)</a> <a href="/pdf">Printable PDF</a></p>
    <p>by Jason Cohen on February 22, 2026</p>
    <p>Real strategy means choosing between two good options and accepting all the consequences.</p>
    <p>source</p>
    <p>The hard part of strategy is not choosing between a good idea and a bad one.</p>
    <p>It is choosing between two good options and living with the tradeoffs.</p>
  `;

  const normalized = normalizeArticleContent({
    author: "Jason Cohen",
    bodyHtml: html,
    publishedAt: "2026-02-22T00:00:00Z",
    title: "Strategic choices: When both options are good"
  });

  assert.doesNotMatch(normalized.bodyHtml, /Printable PDF/i);
  assert.doesNotMatch(normalized.bodyHtml, /^<p>source<\/p>/i);
  assert.doesNotMatch(normalized.bodyHtml, /by Jason Cohen/i);
  assert.match(normalized.bodyHtml, /The hard part of strategy/i);
});

test("normalizeArticleContent removes Every newsletter chrome at the top and bottom", () => {
  const html = `
    <figure>
      <img src="https://cdn.every.to/hero.jpg" alt="Hero image">
      <figcaption>Midjourney/Every illustration.</figcaption>
    </figure>
    <p>Plus: Meet Proof, where agents and humans write together</p>
    <p>March 13, 2026 · Updated March 21, 2026</p>
    <p>2</p>
    <p>Hello, and happy Sunday! Was this newsletter forwarded to you? Sign up to get it in your inbox.</p>
    <p>The actual essay begins here with a real paragraph that explains the thesis in full.</p>
    <p>Here is another paragraph with enough substance to count as the body.</p>
    <div>
      <p>Katie Parrott is a staff writer and AI editorial lead at Every.</p>
      <p>You can read more of her work in her newsletter.</p>
    </div>
    <section>
      <h2>Subscribe</h2>
      <p>The Only Subscription You Need to Stay at the Edge of AI</p>
      <label>Email address</label>
      <button>Subscribe</button>
      <p>Already have an account? Sign in</p>
    </section>
  `;

  const normalized = normalizeArticleContent({
    author: "Katie Parrott",
    bodyHtml: html,
    publishedAt: "2026-03-13T00:00:00Z",
    title: "The Never-done Machine"
  });

  assert.doesNotMatch(normalized.bodyHtml, /Was this newsletter forwarded to you/i);
  assert.doesNotMatch(normalized.bodyHtml, /Only Subscription You Need/i);
  assert.doesNotMatch(normalized.bodyHtml, /Already have an account/i);
  assert.match(normalized.bodyHtml, /The actual essay begins here/i);
});

test("normalizeArticleContent preserves normal article hero and body", () => {
  const html = `
    <figure>
      <img src="https://cdn.example.com/hero.jpg" alt="Hero image">
      <figcaption>A useful chart.</figcaption>
    </figure>
    <p>This is the opening paragraph of a normal article with enough detail to stand on its own.</p>
    <p>This is the second paragraph, which should remain intact after normalization.</p>
  `;

  const normalized = normalizeArticleContent({
    bodyHtml: html,
    title: "Normal article"
  });

  assert.match(normalized.bodyHtml, /A useful chart/i);
  assert.match(normalized.bodyHtml, /opening paragraph of a normal article/i);
  assert.match(normalized.bodyHtml, /second paragraph/i);
});

test("normalizeArticleContent extracts a lead h3 as subtitle and removes it from body", () => {
  const html = `
    <h3>A practical guide to what changed and why it matters.</h3>
    <p>The article body starts here with the actual introduction.</p>
    <p>Then it continues with the second paragraph.</p>
  `;

  const normalized = normalizeArticleContent({
    bodyHtml: html,
    title: "The New Rules of Building"
  });

  assert.equal(normalized.subtitle, "A practical guide to what changed and why it matters.");
  assert.doesNotMatch(normalized.bodyHtml, /practical guide to what changed/i);
  assert.match(normalized.bodyHtml, /The article body starts here/i);
});

test("normalizeArticleContent uses normalized body for oversized summary previews", () => {
  const html = `
    <p>Back to blog</p>
    <p>This is the actual body text that should be visible after normalization.</p>
  `;

  const normalized = normalizeArticleContent({
    bodyHtml: html,
    summaryHtml: html.repeat(4),
    title: "Summary fallback"
  });

  assert.equal(normalized.previewText.startsWith("This is the actual body text"), true);
});
