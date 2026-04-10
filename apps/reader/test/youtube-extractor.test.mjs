import test from "node:test";
import assert from "node:assert/strict";

import { extractYouTubeArticleFromHtml, isYouTubeUrl } from "../lib/youtube-extractor.mjs";

const buildWatchPageHtml = (playerResponse) => `<!doctype html>
<html lang="en">
  <head>
    <title>${playerResponse.videoDetails.title}</title>
    <meta property="og:title" content="${playerResponse.videoDetails.title}">
    <meta property="og:image" content="https://i.ytimg.com/vi/${playerResponse.videoDetails.videoId}/maxresdefault.jpg">
    <script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>
  </head>
  <body></body>
</html>`;

const buildWatchPageHtmlWithApiKey = (playerResponse) => `<!doctype html>
<html lang="en">
  <head>
    <title>${playerResponse.videoDetails.title}</title>
    <meta property="og:title" content="${playerResponse.videoDetails.title}">
    <meta property="og:image" content="https://i.ytimg.com/vi/${playerResponse.videoDetails.videoId}/maxresdefault.jpg">
    <script>var ytcfg = { INNERTUBE_API_KEY: "test-api-key" };</script>
    <script>window["INNERTUBE_API_KEY"]="test-api-key";</script>
    <script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>
  </head>
  <body></body>
</html>`;

test("isYouTubeUrl recognizes watch and short links", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=abc123"), true);
  assert.equal(isYouTubeUrl("https://youtu.be/abc123"), true);
  assert.equal(isYouTubeUrl("https://example.com/post"), false);
});

test("extractYouTubeArticleFromHtml builds a transcript-backed article when captions exist", async () => {
  const playerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
            languageCode: "en",
            name: { simpleText: "English" },
            vssId: ".en"
          }
        ]
      }
    },
    microformat: {
      playerMicroformatRenderer: {
        ownerChannelName: "Agent Channel",
        publishDate: "2026-04-01",
        thumbnail: {
          thumbnails: [
            { url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg", width: 480, height: 360 }
          ]
        },
        urlCanonical: "https://www.youtube.com/watch?v=abc123"
      }
    },
    videoDetails: {
      author: "Agent Channel",
      shortDescription: "A short video description.\n\nSecond paragraph.",
      thumbnail: {
        thumbnails: [
          { url: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg", width: 1280, height: 720 }
        ]
      },
      title: "How to ship fast",
      videoId: "abc123"
    }
  };

  const article = await extractYouTubeArticleFromHtml(
    buildWatchPageHtml(playerResponse),
    "https://www.youtube.com/watch?v=abc123",
    {
      fetchText: async () => `
        <transcript>
          <text start="0.0" dur="4.1">First transcript sentence.</text>
          <text start="4.2" dur="4.0">Second transcript sentence.</text>
          <text start="8.5" dur="4.0">Third transcript sentence.</text>
          <text start="12.7" dur="4.0">Fourth transcript sentence.</text>
        </transcript>
      `
    }
  );

  assert.equal(article.title, "How to ship fast");
  assert.equal(article.author, "Agent Channel");
  assert.equal(article.canonicalUrl, "https://www.youtube.com/watch?v=abc123");
  assert.equal(article.quality, "usable");
  assert.match(article.bodyHtml, /<h2>Transcript<\/h2>/);
  assert.match(article.bodyHtml, /First transcript sentence/);
  assert.equal(article.subtitle, "");
});

test("extractYouTubeArticleFromHtml falls back to the description when captions are unavailable", async () => {
  const playerResponse = {
    microformat: {
      playerMicroformatRenderer: {
        ownerChannelName: "Agent Channel",
        publishDate: "2026-04-01",
        urlCanonical: "https://www.youtube.com/watch?v=xyz987"
      }
    },
    videoDetails: {
      author: "Agent Channel",
      shortDescription: "This video has no captions yet, but the description still explains the main points.",
      title: "Description fallback",
      videoId: "xyz987"
    }
  };

  const article = await extractYouTubeArticleFromHtml(
    buildWatchPageHtml(playerResponse),
    "https://www.youtube.com/watch?v=xyz987",
    {
      fetchText: async () => {
        throw new Error("captions unavailable");
      }
    }
  );

  assert.equal(article.title, "Description fallback");
  assert.match(article.bodyHtml, /Transcript unavailable for this video/);
  assert.match(article.bodyHtml, /description still explains the main points/);
  assert.equal(
    article.subtitle,
    "Transcript unavailable. Showing the video description instead."
  );
});

test("extractYouTubeArticleFromHtml prefers fresh Innertube caption tracks when page tracks are unusable", async () => {
  const pagePlayerResponse = {
    microformat: {
      playerMicroformatRenderer: {
        ownerChannelName: "Agent Channel",
        publishDate: "2026-04-01",
        urlCanonical: "https://www.youtube.com/watch?v=fresh123"
      }
    },
    videoDetails: {
      author: "Agent Channel",
      shortDescription: "Description fallback text.",
      title: "Fresh transcript fallback",
      videoId: "fresh123"
    }
  };

  const freshPlayerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?v=fresh123&lang=en&fmt=srv3",
            languageCode: "en",
            name: { simpleText: "English" },
            vssId: ".en"
          }
        ]
      }
    },
    microformat: {
      playerMicroformatRenderer: {
        ownerChannelName: "Agent Channel",
        publishDate: "2026-04-01",
        urlCanonical: "https://www.youtube.com/watch?v=fresh123"
      }
    },
    videoDetails: {
      author: "Agent Channel",
      shortDescription: "Description fallback text.",
      title: "Fresh transcript fallback",
      videoId: "fresh123"
    }
  };

  const article = await extractYouTubeArticleFromHtml(
    buildWatchPageHtmlWithApiKey(pagePlayerResponse),
    "https://www.youtube.com/watch?v=fresh123",
    {
      fetchJson: async () => freshPlayerResponse,
      fetchText: async (url) => {
        if (!url.includes("timedtext")) {
          throw new Error("unexpected transcript url");
        }

        return `
          <timedtext format="3">
            <body>
              <p t="0" d="4000">Fresh transcript sentence one.</p>
              <p t="4000" d="4000">Fresh transcript sentence two.</p>
            </body>
          </timedtext>
        `;
      }
    }
  );

  assert.equal(article.subtitle, "");
  assert.match(article.bodyHtml, /Fresh transcript sentence one/);
  assert.match(article.bodyHtml, /<h2>Transcript<\/h2>/);
});

test("extractYouTubeArticleFromHtml falls back to oEmbed metadata when the watch page is shell-like", async () => {
  const shellHtml = `<!doctype html>
  <html lang="en">
    <head>
      <title>- YouTube</title>
      <meta property="og:title" content="- YouTube">
      <meta property="og:description" content="Shell page description.">
    </head>
    <body></body>
  </html>`;

  const article = await extractYouTubeArticleFromHtml(
    shellHtml,
    "https://www.youtube.com/watch?v=oembed123",
    {
      fetchJson: async (url) => {
        if (url.includes("/oembed")) {
          return {
            author_name: "Recovered Channel",
            thumbnail_url: "https://i.ytimg.com/vi/oembed123/hqdefault.jpg",
            title: "Recovered Title"
          };
        }

        throw new Error("unexpected fetchJson call");
      },
      fetchText: async () => {
        throw new Error("captions unavailable");
      }
    }
  );

  assert.equal(article.title, "Recovered Title");
  assert.equal(article.author, "Recovered Channel");
  assert.equal(article.thumbnailUrl, "https://i.ytimg.com/vi/oembed123/hqdefault.jpg");
});
