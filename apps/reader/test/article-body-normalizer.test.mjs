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

test("normalizeArticleContent removes useful lead takeaways from body but preserves them in summary", () => {
  const html = `
    <p>My biggest takeaways from this conversation:</p>
    <ul>
      <li>Ship smaller, faster.</li>
      <li>Measure the thing users actually feel.</li>
    </ul>
    <p>This is where the real article begins with a proper introduction and enough narrative detail to count as body copy.</p>
    <p>The second paragraph continues the article with deeper explanation and examples.</p>
  `;

  const normalized = normalizeArticleContent({
    bodyHtml: html,
    title: "How teams learn faster"
  });

  assert.doesNotMatch(normalized.bodyHtml, /biggest takeaways/i);
  assert.doesNotMatch(normalized.bodyHtml, /Ship smaller, faster/i);
  assert.match(normalized.bodyHtml, /real article begins/i);
  assert.match(normalized.summaryHtml, /biggest takeaways/i);
  assert.match(normalized.summaryHtml, /Measure the thing users actually feel/i);
});

test("normalizeArticleContent removes a lead podcast promo run before takeaways", () => {
  const html = `
    <a href="/podcast">Lenny's Podcast: Product | Claude growth run</a>
    <h3>Anthropic’s Head of Growth on scaling in 14 months through big bets.</h3>
    <p>Lenny Rachitsky</p>
    <p>Apr 5</p>
    <p>Paid</p>
    <p>READ IN APP</p>
    <p>Amol Avasare is Head of Growth at Anthropic and previously worked at Mercury and MasterClass.</p>
    <p>Listen on YouTube, Spotify, and Apple Podcasts</p>
    <h3>In our in-depth discussion, Amol shares:</h3>
    <ol>
      <li>How Anthropic automates growth experiments.</li>
      <li>Why activation is the highest-leverage growth problem in AI.</li>
    </ol>
    <h3>Brought to you by:</h3>
    <p>Sponsor copy.</p>
    <h3>Referenced:</h3>
    <p>Some links.</p>
    <p>My biggest takeaways from this conversation:</p>
    <p>Anthropic is on a legendary run and the company’s growth is still accelerating.</p>
    <p>Engineering is getting the most AI leverage, and PM ratios are changing fast.</p>
  `;

  const normalized = normalizeArticleContent({
    author: "Lenny Rachitsky",
    bodyHtml: html,
    title: "Anthropic growth run"
  });

  assert.doesNotMatch(normalized.bodyHtml, /Lenny's Podcast/i);
  assert.doesNotMatch(normalized.bodyHtml, /Listen on YouTube/i);
  assert.doesNotMatch(normalized.bodyHtml, /Brought to you by/i);
  assert.doesNotMatch(normalized.bodyHtml, /Referenced/i);
  assert.match(normalized.bodyHtml, /My biggest takeaways from this conversation/i);
  assert.match(normalized.bodyHtml, /Anthropic is on a legendary run/i);
});

test("normalizeArticleContent removes community newsletter lead promo before top threads", () => {
  const html = `
    <h1>Community Wisdom: Evaluating startup equity</h1>
    <h3>Community Wisdom 180</h3>
    <p>Kiyani</p>
    <p>Apr 4</p>
    <p>Paid</p>
    <p>READ IN APP</p>
    <p>Hello and welcome to this week's edition of Community Wisdom.</p>
    <p>A big thank-you to this month's community sponsor, Clerk.</p>
    <h2>Upcoming meetups</h2>
    <ul><li>Asheville</li><li>Atlanta</li></ul>
    <h2>New podcast episodes this week</h2>
    <p>Podcast links here.</p>
    <h1>Top threads this week</h1>
    <h2>1. Evaluating equity at a bootstrapped startup</h2>
    <blockquote>I have a time-sensitive question for a call later today.</blockquote>
    <p>First useful response.</p>
  `;

  const normalized = normalizeArticleContent({
    author: "Kiyani",
    bodyHtml: html,
    title: "Community Wisdom"
  });

  assert.doesNotMatch(normalized.bodyHtml, /Hello and welcome to this week's edition/i);
  assert.doesNotMatch(normalized.bodyHtml, /community sponsor/i);
  assert.doesNotMatch(normalized.bodyHtml, /Upcoming meetups/i);
  assert.doesNotMatch(normalized.bodyHtml, /New podcast episodes this week/i);
  assert.match(normalized.bodyHtml, /Top threads this week/i);
  assert.match(normalized.bodyHtml, /Evaluating equity at a bootstrapped startup/i);
});
