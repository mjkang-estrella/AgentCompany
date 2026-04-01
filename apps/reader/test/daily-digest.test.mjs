import test from "node:test";
import assert from "node:assert/strict";

import {
  getTimeZoneDateKey,
  getTimeZoneHour,
  groupDigestInputs,
  mergeDigestOutput,
  shiftLocalDate
} from "../lib/daily-digest.mjs";

test("getTimeZoneDateKey and getTimeZoneHour respect named timezone", () => {
  const date = new Date("2026-03-31T14:30:00.000Z");

  assert.equal(getTimeZoneDateKey("America/Los_Angeles", date), "2026-03-31");
  assert.equal(getTimeZoneHour("America/Los_Angeles", date), 7);
});

test("groupDigestInputs keeps feed grouping and article order", () => {
  const grouped = groupDigestInputs([
    {
      author: "A",
      feedGroup: "Feed One",
      feedIconUrl: "",
      feedId: "feed-1",
      feedTitle: "Feed One",
      id: "article-1",
      previewText: "First preview",
      publishedAt: "2026-03-31T12:00:00.000Z",
      subtitle: "",
      title: "First",
      url: "https://example.com/1"
    },
    {
      author: "B",
      feedGroup: "Feed One",
      feedIconUrl: "",
      feedId: "feed-1",
      feedTitle: "Feed One",
      id: "article-2",
      previewText: "Second preview",
      publishedAt: "2026-03-31T10:00:00.000Z",
      subtitle: "",
      title: "Second",
      url: "https://example.com/2"
    },
    {
      author: "C",
      feedGroup: "Feed Two",
      feedIconUrl: "",
      feedId: "feed-2",
      feedTitle: "Feed Two",
      id: "article-3",
      previewText: "Third preview",
      publishedAt: "2026-03-31T09:00:00.000Z",
      subtitle: "",
      title: "Third",
      url: "https://example.com/3"
    }
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].feedTitle, "Feed One");
  assert.deepEqual(grouped[0].articles.map((article) => article.id), ["article-1", "article-2"]);
  assert.equal(grouped[1].feedTitle, "Feed Two");
});

test("mergeDigestOutput applies returned summaries by feed key", () => {
  const merged = mergeDigestOutput({
    rawText: JSON.stringify({
      intro: "Today focused on product building and AI workflows.",
      sections: [
        { key: "feed-1", summary: "Feed One emphasized practical shipping advice." }
      ]
    }),
    sections: [
      {
        articles: [{ id: "article-1", title: "First" }],
        feedGroup: "Feed One",
        feedIconUrl: "",
        feedKey: "feed-1",
        feedTitle: "Feed One"
      },
      {
        articles: [{ id: "article-2", title: "Second" }],
        feedGroup: "Feed Two",
        feedIconUrl: "",
        feedKey: "feed-2",
        feedTitle: "Feed Two"
      }
    ]
  });

  assert.equal(merged.intro, "Today focused on product building and AI workflows.");
  assert.equal(merged.sections[0].summary, "Feed One emphasized practical shipping advice.");
  assert.match(merged.sections[1].summary, /Feed Two published Second/i);
});

test("shiftLocalDate moves backward and forward across month boundaries", () => {
  assert.equal(shiftLocalDate("2026-03-31", -1), "2026-03-30");
  assert.equal(shiftLocalDate("2026-03-31", 1), "2026-04-01");
});
