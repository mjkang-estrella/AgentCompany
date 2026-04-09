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
  assert.equal(result.feed.feedGroup, "Every");
  assert.equal(result.article.url, "https://example.com/issues/123?utm_source=email");
  assert.equal(result.article.feedGroup, "Every");
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
  assert.equal(result.article.feedGroup, "Signals");
  assert.equal(result.feed.key, "signals-example-com");
});

test("buildNewsletterImport normalizes table-layout email chrome and tracking pixels", () => {
  const result = buildNewsletterImport({
    extracted_html: `
      <html>
        <body>
          <img src="https://example.com/open?token=abc" width="1" height="1" alt="">
          <table>
            <tbody>
              <tr>
                <td>&nbsp;</td>
                <td>
                  <table>
                    <tbody>
                      <tr>
                        <td><p>Hello from the newsletter.</p><p>This is the main body content with enough text to count as a real article section.</p></td>
                      </tr>
                      <tr>
                        <td><p>Privacy Policy</p><p>Manage preferences</p></td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `,
    extracted_text: "Hello from the newsletter.",
    from: "Example <team@example.com>",
    message_id: "msg_html",
    subject: "Example issue"
  });

  assert.ok(result);
  assert.match(result.article.bodyHtml, /Hello from the newsletter/i);
  assert.doesNotMatch(result.article.bodyHtml, /open\\?token=abc/i);
  assert.doesNotMatch(result.article.bodyHtml, /Privacy Policy/i);
  assert.doesNotMatch(result.article.bodyHtml, /Manage preferences/i);
  assert.doesNotMatch(result.article.bodyHtml, /<table/i);
});

test("buildNewsletterImport trims newsletter lead metadata before the real article body", () => {
  const result = buildNewsletterImport({
    extracted_html: `
      <html>
        <body>
          <p>READ IN APP</p>
          <p>Subscribed</p>
          <a href="https://substack.com/@michellerial"><img src="https://cdn.example.com/avatar.png" alt=""></a>
          <figure><img src="https://cdn.example.com/chart.png" alt="Chart"></figure>
          <p>Are you feeling what I’m feeling? Blink twice with your heavy human eyelids if you are starting to feel like there is no point to creating things anymore.</p>
          <p>Or maybe you’re just in a regular creative drought.</p>
          <p>Well, it’s time to lift yourself by your Blundstone loops and climb right out of that rut.</p>
        </body>
      </html>
    `,
    extracted_text: "A visual guide to getting out of a creative slump",
    from: "Lenny's Newsletter <lenny@substack.com>",
    message_id: "msg_creative_slump",
    subject: "A visual guide to getting out of a creative slump"
  });

  assert.ok(result);
  assert.doesNotMatch(result.article.bodyHtml, /READ IN APP/i);
  assert.doesNotMatch(result.article.bodyHtml, /Subscribed/i);
  assert.match(result.article.bodyHtml, /Are you feeling what I’m feeling/i);
});

test("buildNewsletterImport prefers the substantive newsletter body over teaser and footer fragments", () => {
  const result = buildNewsletterImport({
    extracted_html: `
      <p>Claude subscriptions are 15-30x cheaper than the API. Full cost breakdown of Claude Code plans, OpenRouter setup, best API models for agentic coding, and an open-source token visibility dashboard.</p>
      <p>Forwarded this email? Subscribe here for more</p>
      <p>Paweł Huryn</p>
      <p>Apr 8</p>
      <p>READ IN APP</p>
      <p>Claude subscriptions are 15-30x cheaper than the API. But Anthropic just killed every third-party tool that used them — and you still can’t see where your tokens go.</p>
      <p>I run Claude Code on a Max plan. 440 sessions last month, 18,000 turns. I built a dashboard to track what that actually costs: $1,588 in API-equivalent tokens. Covered by a $200 subscription.</p>
      <p>Here’s the full breakdown — what April 4 killed, which API models actually work for agentic coding, and how to see exactly where your budget goes.</p>
      <h2>What You’ll Learn</h2>
      <ul>
        <li>What April 4 actually killed</li>
        <li>The full cost breakdown</li>
      </ul>
      <p>Listen on Spotify</p>
      <p>YouTube</p>
      <h2>Thanks for Reading The Product Compass</h2>
      <p>It’s amazing to learn and grow together.</p>
      <p>Invite your friends and earn rewards</p>
    `,
    extracted_text: "Claude subscriptions are 15-30x cheaper than the API.",
    from: "Paweł from The Product Compass <huryn+ai-product-management@substack.com>",
    message_id: "msg_product_compass",
    subject: "Claude Code Pricing"
  });

  assert.ok(result);
  assert.match(result.article.bodyHtml, /Anthropic just killed every third-party tool/i);
  assert.match(result.article.bodyHtml, /What You’ll Learn/i);
  assert.doesNotMatch(result.article.bodyHtml, /Thanks for Reading The Product Compass/i);
  assert.doesNotMatch(result.article.bodyHtml, /Invite your friends and earn rewards/i);
});
