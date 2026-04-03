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
