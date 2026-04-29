import test from "node:test";
import assert from "node:assert/strict";

import configHandler from "../api/config.js";
import { buildPublicConfig } from "../lib/public-config.mjs";

const withEnv = async (env, run) => {
  const previous = {
    CONVEX_URL: process.env.CONVEX_URL,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    READER_NEWSLETTER_INBOX_EMAIL: process.env.READER_NEWSLETTER_INBOX_EMAIL
  };

  for (const key of Object.keys(previous)) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test("buildPublicConfig exposes the browser config shape", async () => {
  await withEnv({
    CONVEX_URL: "https://reader.example.convex.cloud",
    READER_NEWSLETTER_INBOX_EMAIL: "news@example.com"
  }, () => {
    assert.deepEqual(buildPublicConfig(), {
      convexUrl: "https://reader.example.convex.cloud",
      newsletterInboxEmail: "news@example.com"
    });
  });
});

test("Vercel config handler returns the shared public config", async () => {
  await withEnv({
    CONVEX_URL: "https://reader.example.convex.cloud"
  }, async () => {
    const response = await configHandler.fetch(new Request("https://reader.example.com/api/config"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      convexUrl: "https://reader.example.convex.cloud",
      newsletterInboxEmail: "news@mj-kang.com"
    });
  });
});

test("Vercel config handler rejects unsupported methods", async () => {
  await withEnv({
    CONVEX_URL: "https://reader.example.convex.cloud"
  }, async () => {
    const response = await configHandler.fetch(new Request("https://reader.example.com/api/config", {
      method: "POST"
    }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
  });
});
