import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeHtmlEntities,
  discoverFeedLinks,
  extractReadableContent,
  sanitizeFragment
} from "../lib/html.mjs";
import { parseFeed } from "../lib/feed-utils.mjs";
import { getTodayBounds, isToday } from "../lib/time.mjs";

test("parseFeed supports RSS feeds", () => {
  const rss = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Reader Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Hello</title>
          <link>https://example.com/hello</link>
          <guid>entry-1</guid>
          <description><![CDATA[<p>Summary</p>]]></description>
          <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<p>Body</p>]]></content:encoded>
          <pubDate>Tue, 11 Mar 2026 18:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

  const parsed = parseFeed(rss, "https://example.com/feed.xml");
  assert.equal(parsed.feed.title, "Reader Feed");
  assert.equal(parsed.feed.entries[0].externalId, "entry-1");
  assert.equal(parsed.feed.entries[0].bodyHtml, "<p>Body</p>");
});

test("parseFeed supports Atom feeds", () => {
  const atom = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <link href="https://example.com" />
      <entry>
        <id>tag:example.com,2026:1</id>
        <title>Atom entry</title>
        <link href="/entry" />
        <summary><![CDATA[<p>Atom summary</p>]]></summary>
        <updated>2026-03-11T18:00:00Z</updated>
      </entry>
    </feed>`;

  const parsed = parseFeed(atom, "https://example.com/atom.xml");
  assert.equal(parsed.feed.title, "Atom Feed");
  assert.equal(parsed.feed.entries[0].url, "https://example.com/entry");
});

test("parseFeed decodes HTML entities in titles", () => {
  const rss = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Reader Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Anthropic&#39;s Integration</title>
          <link>https://example.com/post</link>
          <guid>entry-2</guid>
          <description>Copilot Cowork, Anthropic&#39;s Integration</description>
          <pubDate>Tue, 11 Mar 2026 18:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

  const parsed = parseFeed(rss, "https://example.com/feed.xml");
  assert.equal(parsed.feed.entries[0].title, "Anthropic's Integration");
});

test("parseFeed decodes escaped HTML fragments in RSS descriptions", () => {
  const rss = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Reader Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Escaped body</title>
          <link>https://example.com/post</link>
          <guid>entry-3</guid>
          <description>&lt;p&gt;Hello &amp;amp; world&lt;/p&gt;</description>
          <pubDate>Tue, 11 Mar 2026 18:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

  const parsed = parseFeed(rss, "https://example.com/feed.xml");
  assert.equal(parsed.feed.entries[0].summaryHtml, "<p>Hello &amp; world</p>");
  assert.equal(parsed.feed.entries[0].bodyHtml, "<p>Hello &amp; world</p>");
});

test("discoverFeedLinks finds alternate feeds and icon", () => {
  const html = `
    <html>
      <head>
        <title>Example</title>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS" />
        <link rel="icon" href="/favicon.ico" />
      </head>
    </html>`;

  const result = discoverFeedLinks(html, "https://example.com/blog");
  assert.deepEqual(result.feedLinks, [
    { href: "https://example.com/feed.xml", title: "RSS" }
  ]);
  assert.equal(result.faviconUrl, "https://example.com/favicon.ico");
});

test("extractReadableContent strips scripts and keeps article body", () => {
  const html = `
    <html>
      <body>
        <article>
          <h1>Title</h1>
          <p>One paragraph with enough text to be meaningful.</p>
          <script>alert('xss')</script>
        </article>
      </body>
    </html>`;

  const content = extractReadableContent(html);
  assert.match(content, /One paragraph/);
  assert.doesNotMatch(content, /script/);
});

test("sanitizeFragment removes dangerous attributes", () => {
  const sanitized = sanitizeFragment(
    `<p>Hello</p><a href="https://example.com" onclick="evil()">link</a><script>alert(1)</script>`
  );

  assert.match(sanitized, /<a href="https:\/\/example.com"/);
  assert.doesNotMatch(sanitized, /onclick/);
  assert.doesNotMatch(sanitized, /script/);
});

test("sanitizeFragment decodes escaped markup before sanitizing", () => {
  const sanitized = sanitizeFragment("&lt;p&gt;Hello&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;");

  assert.equal(sanitized, "<p>Hello</p>");
});

test("decodeHtmlEntities decodes numeric entities", () => {
  assert.equal(decodeHtmlEntities("Anthropic&#39;s"), "Anthropic's");
});

test("today bounds and today matching use client timezone offset", () => {
  const now = new Date("2026-03-11T20:00:00.000Z");
  const bounds = getTodayBounds(420, now);

  assert.equal(bounds.start.toISOString(), "2026-03-11T07:00:00.000Z");
  assert.equal(isToday("2026-03-11T08:00:00.000Z", 420, now), true);
  assert.equal(isToday("2026-03-10T20:00:00.000Z", 420, now), false);
});
