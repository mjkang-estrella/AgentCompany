import test from "node:test";
import assert from "node:assert/strict";

import {
  extractArticleWithBrowserUse,
  shouldUseBrowserFallbackForStatus
} from "../lib/browser-use-extractor.mjs";

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json" },
  status
});

test("extractArticleWithBrowserUse polls for structured article content", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ id: "session-1", status: "created", output: null, isTaskSuccessful: null }),
    jsonResponse({ id: "session-1", status: "running", output: null, isTaskSuccessful: null }),
    jsonResponse({
      id: "session-1",
      status: "stopped",
      isTaskSuccessful: true,
      output: {
        author: "Isaac Tai, Daniel Kim, Mike Gao",
        bodyMarkdown: "# How We Built Our Knowledge Base\n\nEmployees ask our internal knowledge base more than 15,000 questions every day.\n\n## Meeting data where it lives\n\nThis paragraph makes the extracted article long enough to be treated as readable content. <script>alert('no')</script>",
        canonicalUrl: "https://www.cerebras.ai/blog/how-we-built-our-knowledge-base?utm_source=test",
        publishedAt: "2026-07-15",
        siteName: "Cerebras",
        thumbnailUrl: "https://cdn.sanity.io/knowledge-base.png",
        title: "How We Built Our Knowledge Base"
      }
    })
  ];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return responses.shift();
  };

  const extracted = await extractArticleWithBrowserUse(
    "https://www.cerebras.ai/blog/how-we-built-our-knowledge-base",
    {
      apiKey: "bu_test",
      fetchImpl,
      pollIntervalMs: 0,
      sleep: async () => {}
    }
  );

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://api.browser-use.com/api/v3/sessions");
  assert.equal(requests[0].options.headers["X-Browser-Use-API-Key"], "bu_test");
  const createBody = JSON.parse(requests[0].options.body);
  assert.equal(createBody.model, "bu-mini");
  assert.equal(createBody.maxCostUsd, 0.25);
  assert.match(createBody.task, /Navigate to https:\/\/www\.cerebras\.ai\/blog/);
  assert.match(createBody.task, /Do not use HTTP fetch, Python/);
  assert.match(createBody.task, /Do not summarize/);
  assert.equal(extracted.quality, "usable");
  assert.equal(extracted.title, "How We Built Our Knowledge Base");
  assert.equal(extracted.canonicalUrl, "https://www.cerebras.ai/blog/how-we-built-our-knowledge-base");
  assert.match(extracted.bodyHtml, /15,000 questions/);
  assert.doesNotMatch(extracted.bodyHtml, /<script/);
});

test("extractArticleWithBrowserUse rejects unsuccessful terminal sessions", async () => {
  const fetchImpl = async () => jsonResponse({
    id: "session-2",
    status: "error",
    isTaskSuccessful: false,
    lastStepSummary: "The target page could not be rendered"
  });

  await assert.rejects(
    extractArticleWithBrowserUse("https://example.com/article", {
      apiKey: "bu_test",
      fetchImpl,
      pollIntervalMs: 0,
      sleep: async () => {}
    }),
    /could not be rendered/
  );
});

test("extractArticleWithBrowserUse waits for output after a successful stop", async () => {
  const responses = [
    jsonResponse({ id: "session-3", status: "running", output: null, isTaskSuccessful: null }),
    jsonResponse({ id: "session-3", status: "stopped", output: null, isTaskSuccessful: true }),
    jsonResponse({
      id: "session-3",
      status: "stopped",
      isTaskSuccessful: true,
      output: {
        author: "Reader Author",
        bodyMarkdown: "# Delayed output\n\nThis complete article output arrived just after the session changed to stopped. It contains enough readable text for Reader to accept it safely.",
        canonicalUrl: "https://example.com/article",
        publishedAt: "2026-08-01",
        siteName: "Example",
        thumbnailUrl: "",
        title: "Delayed output"
      }
    })
  ];
  const fetchImpl = async () => responses.shift();

  const extracted = await extractArticleWithBrowserUse("https://example.com/article", {
    apiKey: "bu_test",
    fetchImpl,
    pollIntervalMs: 0,
    sleep: async () => {}
  });

  assert.equal(extracted.title, "Delayed output");
  assert.match(extracted.bodyHtml, /arrived just after/);
});

test("shouldUseBrowserFallbackForStatus limits fallback to transient and blocked responses", () => {
  assert.equal(shouldUseBrowserFallbackForStatus(403), true);
  assert.equal(shouldUseBrowserFallbackForStatus(429), true);
  assert.equal(shouldUseBrowserFallbackForStatus(500), true);
  assert.equal(shouldUseBrowserFallbackForStatus(404), false);
});
