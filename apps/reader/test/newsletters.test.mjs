import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNewsletterImport,
  buildNewsletterInboxCreateArgs,
  parseMailbox
} from "../lib/newsletters.mjs";

test("parseMailbox extracts display name and address", () => {
  assert.deepEqual(parseMailbox("Every <updates@every.to>"), {
    address: "updates@every.to",
    name: "Every"
  });
});

test("buildNewsletterInboxCreateArgs derives username and domain", () => {
  assert.deepEqual(buildNewsletterInboxCreateArgs("news@mj-kang.com"), {
    display_name: "Reader Newsletters",
    domain: "mj-kang.com",
    username: "news"
  });
});

test("buildNewsletterImport prefers the browser-view link over unsubscribe links", () => {
  const result = buildNewsletterImport({
    created_at: "2026-04-03T12:00:00.000Z",
    extracted_html: `
      <html>
        <body>
          <p>Here is this week's edition.</p>
          <p><a href="https://example.com/unsubscribe">Unsubscribe</a></p>
          <p><a href="https://example.com/issues/123?utm_source=email">View in browser</a></p>
        </body>
      </html>
    `,
    extracted_text: "Here is this week's edition.",
    from: "Every <updates@every.to>",
    headers: {
      sender: "updates@every.to"
    },
    message_id: "msg_123",
    subject: "A better newsletter"
  });

  assert.ok(result);
  assert.equal(result.feed.title, "Every");
  assert.equal(result.article.url, "https://example.com/issues/123?utm_source=email");
  assert.equal(result.article.feedGroup, "Newsletters");
  assert.equal(result.article.subtitle, "updates@every.to");
});

test("buildNewsletterImport falls back to an AgentMail URL when no browser link exists", () => {
  const result = buildNewsletterImport({
    extracted_text: "A plain text issue with no browser link.",
    from: "Signals <signals@example.com>",
    message_id: "msg_plain",
    subject: "Signals Weekly",
    timestamp: "2026-04-03T14:30:00.000Z"
  });

  assert.ok(result);
  assert.equal(result.article.url, "agentmail://messages/msg_plain");
  assert.match(result.article.bodyHtml, /plain text issue/i);
  assert.equal(result.feed.key, "signals-example-com");
});
