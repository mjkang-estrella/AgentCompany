import test from "node:test";
import assert from "node:assert/strict";

import { extractPageWithDefuddle } from "../lib/page-extractor.mjs";

test("extractPageWithDefuddle handles legacy table-based article layouts", async () => {
  const html = `
    <html>
      <head>
        <title>Superlinear Returns</title>
        <meta name="author" content="Paul Graham">
      </head>
      <body>
        <table>
          <tr valign="top">
            <td>
              <a href="index.html">Home</a><br>
              <a href="articles.html">Articles</a><br>
              <a href="rss.html">RSS</a>
            </td>
            <td width="24"></td>
            <td>
              <font size="6">Superlinear Returns</font><br><br>
              <font size="2" face="verdana">
                One of the most important things I didn't understand about the world when I was a child
                is the degree to which the returns for performance are superlinear.<br><br>
                Teachers and coaches implicitly told us the returns were linear.
              </font>
            </td>
          </tr>
        </table>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://paulgraham.com/superlinear.html");

  assert.equal(extracted.title, "Superlinear Returns");
  assert.equal(extracted.author, "Paul Graham");
  assert.match(extracted.bodyHtml, /returns for performance are superlinear/i);
  assert.doesNotMatch(extracted.bodyHtml, /Home<\/a>/);
});

test("extractPageWithDefuddle keeps real article media and metadata", async () => {
  const html = `
    <html>
      <head>
        <title>Ignored title</title>
        <meta property="og:title" content="Introducing Proof">
        <meta property="og:site_name" content="Every">
        <meta property="article:published_time" content="2026-03-11T04:30:00Z">
        <meta name="author" content="Dan Shipper">
        <meta name="description" content="A new approach to collaborative writing.">
        <meta property="og:image" content="https://cdn.every.to/logo.png">
      </head>
      <body>
        <article>
          <table>
            <tr>
              <td><img src="https://cdn.every.to/logo.png" alt="Every logo"></td>
              <td>by <a href="/authors/dan">Dan Shipper</a></td>
              <td>in <a href="/publication/every">On Every</a></td>
            </tr>
          </table>
          <figure>
            <img src="https://cdn.every.to/proof-hero.jpg" alt="Proof illustration">
            <figcaption>Midjourney/Every illustration.</figcaption>
          </figure>
          <p>Most of us at Every are using AI to generate plan documents and research reports.</p>
        </article>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://every.to/p/introducing-proof");

  assert.equal(extracted.title, "Introducing Proof");
  assert.equal(extracted.author, "Dan Shipper");
  assert.equal(extracted.siteName, "Every");
  assert.equal(extracted.thumbnailUrl, "https://cdn.every.to/proof-hero.jpg");
  assert.match(extracted.bodyHtml, /Midjourney\/Every illustration/);
  assert.match(extracted.bodyHtml, /Most of us at Every are using AI/);
});

test("extractPageWithDefuddle resolves relative article image URLs", async () => {
  const html = `
    <html>
      <head>
        <title>What I learned building an opinionated and minimal coding agent</title>
        <meta property="og:image" content="/posts/2025-11-30-pi-coding-agent/media/header.png">
      </head>
      <body>
        <article>
          <p>Lessons I learned while building my own coding agent from scratch.</p>
          <figure><img src="media/subagent.jpeg" alt="Subagent diagram"></figure>
          <p>The second paragraph has enough real article text to keep this extraction usable.</p>
        </article>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(
    html,
    "https://mariozechner.at/posts/2025-11-30-pi-coding-agent/"
  );

  assert.equal(extracted.quality, "usable");
  assert.match(
    extracted.bodyHtml,
    /src="https:\/\/mariozechner\.at\/posts\/2025-11-30-pi-coding-agent\/media\/subagent\.jpeg"/
  );
  assert.equal(
    extracted.thumbnailUrl,
    "https://mariozechner.at/posts/2025-11-30-pi-coding-agent/media/header.png"
  );
});

test("extractPageWithDefuddle sanitizes dangerous markup from extracted content", async () => {
  const html = `
    <html>
      <head>
        <title>Unsafe article</title>
      </head>
      <body>
        <article>
          <h1>Unsafe article</h1>
          <p>Hello</p>
          <script>alert("xss")</script>
          <p><a href="https://example.com" onclick="evil()">safe link</a></p>
        </article>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://example.com/post");

  assert.match(extracted.bodyHtml, /Hello/);
  assert.doesNotMatch(extracted.bodyHtml, /script/);
  assert.doesNotMatch(extracted.bodyHtml, /onclick/);
});

test("extractPageWithDefuddle rejects 404 pages dominated by newsletter chrome", async () => {
  const html = `
    <html>
      <head>
        <title>404 - Every</title>
        <meta property="og:title" content="Every">
        <meta property="og:site_name" content="Every">
      </head>
      <body>
        <main>
          <section>
            <h1>404</h1>
            <p>Return home</p>
          </section>
        </main>
        <footer>
          <img src="https://every.to/logo.svg" alt="Every">
          <h2>What Comes Next</h2>
          <p>New ideas to help you build the future—in your inbox, every day.</p>
          <label>Email address</label>
          <button>Subscribe</button>
          <p>Already have an account? Sign in</p>
          <p>Privacy Policy</p>
          <p>Terms of Service</p>
        </footer>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://every.to/missing-post");

  assert.equal(extracted.quality, "reject");
  assert.equal(extracted.rejectionReason, "not-an-article");
});

test("extractPageWithDefuddle trims trailing bio and subscription chrome", async () => {
  const html = `
    <html>
      <head>
        <title>Teach a language model to write like you</title>
        <meta property="og:title" content="Teach a language model to write like you">
        <meta property="og:site_name" content="Every">
        <meta name="author" content="Katie Parrott">
      </head>
      <body>
        <article>
          <figure>
            <img src="https://cdn.every.to/hero.jpg" alt="Hero image">
            <figcaption>Midjourney/Every illustration.</figcaption>
          </figure>
          <p>A step-by-step guide to teaching a language model to write like you.</p>
          <p>This is the actual article body with enough meaningful content to count as an article.</p>
          <div>
            <p>Katie Parrott is a staff writer and AI editorial lead at Every.</p>
            <p>Read more in her newsletter.</p>
          </div>
          <section>
            <h2>Subscribe</h2>
            <p>The Only Subscription You Need to Stay at the Edge of AI</p>
            <label>Email address</label>
            <button>Subscribe</button>
            <p>Already have an account? Sign in</p>
            <p>Privacy Policy</p>
          </section>
        </article>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://every.to/ai-and-i/teach-a-language-model-to-write-like-you");

  assert.equal(extracted.quality, "usable");
  assert.match(extracted.bodyHtml, /actual article body/i);
  assert.doesNotMatch(extracted.bodyHtml, /Only Subscription You Need/i);
  assert.doesNotMatch(extracted.bodyHtml, /Already have an account/i);
});

test("extractPageWithDefuddle prefers metadata title when document title contains site prefix", async () => {
  const html = `
    <html>
      <head>
        <title>Kagi Blog - Orion 1.0 ✴︎ Browse Beyond</title>
        <meta name="description" content="After six years of relentless development, Orion for MacOS 1.0 is here.">
      </head>
      <body>
        <article>
          <p>After six years of relentless development, Orion for MacOS 1.0 is here.</p>
          <p>Today, Orion for macOS officially leaves its beta phase behind.</p>
          <p>We built Orion for people who feel that modern browsing has drifted too far from serving the user, and this release expands that vision across Mac, iPhone, and iPad.</p>
          <p>In a market dominated by surveillance-driven browsing models, we believe privacy-respecting browsing should be treated as a product feature, not a premium add-on or hidden setting.</p>
          <p>This launch also reflects our broader effort to create a coherent ecosystem of user-first tools across search, browser, translation, and news.</p>
        </article>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://blog.kagi.com/orion");

  assert.equal(extracted.quality, "usable");
  assert.match(extracted.bodyHtml, /After six years of relentless development/i);
});

test("extractPageWithDefuddle restores anchored headings and deduplicates lead media", async () => {
  const html = `
    <html>
      <head>
        <title>Rebuilding a read path</title>
        <meta name="description" content="A detailed engineering article.">
      </head>
      <body>
        <main>
          <article>
            <a href="#skip-nav">Skip to content →</a>
            <img src="https://cdn.example.com/hero-wide.png" alt="Read path diagram">
            <img src="https://cdn.example.com/hero-narrow.png" alt="Read path diagram">
            ·
            <p>${"The opening explains the local-first synchronization problem. ".repeat(8)}</p>
            <h3>
              <span id="query-shape">
                What a delta sync query actually does
                <a href="#query-shape" aria-label="Link to this section"><span>⁠<svg></svg></span></a>
              </span>
            </h3>
            <p>${"The implementation intersects ordered action sets before enrichment. ".repeat(8)}</p>
          </article>
        </main>
      </body>
    </html>`;

  const extracted = await extractPageWithDefuddle(html, "https://linear.app/now/read-path");

  assert.match(extracted.bodyHtml, /<h3>What a delta sync query actually does<\/h3>/i);
  assert.doesNotMatch(extracted.bodyHtml, /Skip to content/i);
  assert.equal((extracted.bodyHtml.match(/Read path diagram/giu) || []).length, 1);
});

test("Every publication metadata yields to article figures and post covers", async () => {
  const publication = "https://d24ovhgu8s7341.cloudfront.net/uploads/publication/logo/120/small_every.png";
  const cover = "https://d24ovhgu8s7341.cloudfront.net/uploads/post/cover/123/thesis_live.jpg";
  const hero = "https://cdn.every.to/proof-hero.jpg";
  const html = `<meta property="og:image" content="${publication}">
    <meta name="twitter:image" content="${publication}">
    <article><div class="byline"><img src="${publication}">By Dan Shipper</div>
    <figure><img src="${hero}" width="1100" height="600"></figure>
    <p>The article text starts here and explains the product in enough detail for extraction.</p></article>`;
  assert.equal((await extractPageWithDefuddle(html, "https://every.to/chain-of-thought/proof")).thumbnailUrl, hero);
  assert.equal((await extractPageWithDefuddle(html.replace(publication, cover), "https://every.to/thesis")).thumbnailUrl, cover);
});

test("Kagi default OG card, byline photos and tiny images leave the thumbnail empty", async () => {
  const html = `<meta property="og:image" content="/og-image.png">
    <meta name="twitter:image" content="/photo.jpg">
    <article><div class="byline"><img src="/author.jpg">By Kagi</div>
    <img src="/photo.jpg" width="55" height="23">
    <img src="/beacon.gif" width="1" height="1">
    <p>Education shouldn't be held for ransom. This paragraph contains the beginning of the article.</p></article>`;
  const extracted = await extractPageWithDefuddle(html, "https://blog.kagi.com/education");
  assert.equal(extracted.thumbnailUrl, "");
});

test("article-specific social media and full-size screenshots remain eligible", async () => {
  for (const [page, photo] of [
    ["https://stratechery.com/2026/falling-leaves-and-stocks/", "https://stratechery.com/wp-content/uploads/GettyImages-2302583549.jpg"],
    ["https://linear.app/changelog/mobile-diffs", "https://webassets.linear.app/images/mobile-diffs.png"],
    ["https://x.com/BlueMinutes/status/123", "https://pbs.twimg.com/media/example?format=jpg&name=large"]
  ]) {
    const html = `<meta property="og:image" content="${photo}">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="675"><article><p>Article content.</p></article>`;
    assert.equal((await extractPageWithDefuddle(html, page)).thumbnailUrl, photo);
  }
});

test("a social card generated from a site icon is ineligible", async () => {
  const payload = Buffer.from(JSON.stringify({
    img: "https://i0.wp.com/stratechery.com/images/cropped-android-chrome-512x512-1.png"
  })).toString("base64url");
  const html = `<meta property="og:image" content="https://s0.wp.com/_si/?t=${payload}.signature">
    <article><p>An interview about agentic commerce.</p></article>`;
  assert.equal((await extractPageWithDefuddle(html, "https://stratechery.com/2026/interview/")).thumbnailUrl, "");
});
