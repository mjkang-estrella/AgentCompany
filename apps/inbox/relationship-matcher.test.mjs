import test from "node:test";
import assert from "node:assert/strict";
import {
  compareNewNotesToDuplicateCandidates,
  compareNewNotesToExistingNotes,
  DUPLICATE_MATCH_RULES,
  findRelatedNoteOverlaps,
} from "./relationship-matcher.mjs";

test("compareNewNotesToExistingNotes detects meaningful keyword overlap", () => {
  const newNotes = [
    {
      type: "idea",
      title: "AI copilots are driving renewal expansion",
      content:
        "AI copilots are driving renewal expansion across mid-market finance teams this quarter.",
    },
    {
      type: "fact",
      title: "Hiring plans slowed",
      content: "Hiring plans slowed as budget approvals moved into April.",
    },
  ];
  const existingNotes = [
    {
      id: 41,
      email_id: 7,
      taxonomy_key: "pattern_trend",
      title: "Mid-market finance teams standardize on AI copilots",
      body: "Mid-market finance teams are standardizing on AI copilots to improve renewals.",
    },
    {
      id: 42,
      email_id: 8,
      taxonomy_key: "fact",
      title: "Community events are back",
      body: "Local operators are reviving in-person dinners and roadshows.",
    },
  ];

  const comparisons = compareNewNotesToExistingNotes(newNotes, existingNotes);

  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].newNoteIndex, 0);
  assert.equal(comparisons[0].existingNoteId, 41);
  assert.ok(comparisons[0].score >= 2);
  assert.ok(comparisons[0].sharedKeywords.includes("ai copilot"));
  assert.ok(comparisons[0].sharedKeywords.includes("market finance"));
});

test("compareNewNotesToExistingNotes uses explicit topics and keywords when bodies do not overlap", () => {
  const newNotes = [
    {
      type: "playbook_candidate",
      title: "Tighten operator handoffs",
      content: "Leadership teams simplified internal planning rituals for the quarter.",
      topics: ["Workflow automation"],
      keywords: ["Prompt review cadence"],
    },
  ];
  const existingNotes = [
    {
      id: 77,
      email_id: 12,
      taxonomy_key: "pattern_trend",
      title: "Operators are formalizing routines",
      body: "Finance leaders reorganized tooling ownership across the business.",
      topics: ["workflow automation"],
      keywords: ["prompt review cadence"],
    },
  ];

  const comparisons = compareNewNotesToExistingNotes(newNotes, existingNotes);
  const topicComparison = comparisons.find((comparison) => comparison.overlapBasis === "topic");
  const keywordComparison = comparisons.find(
    (comparison) => comparison.overlapBasis === "keyword"
  );

  assert.equal(comparisons.length, 2);
  assert.ok(topicComparison);
  assert.ok(keywordComparison);
  assert.equal(topicComparison.existingNoteId, 77);
  assert.deepEqual(topicComparison.matchedValues, ["workflow automation"]);
  assert.equal(keywordComparison.existingNoteId, 77);
  assert.ok(keywordComparison.sharedKeywords.includes("prompt review cadence"));
});

test("compareNewNotesToExistingNotes still matches derived body overlap when explicit keywords differ", () => {
  const newNotes = [
    {
      type: "idea",
      title: "AI copilots improve finance renewals",
      content: "AI copilots improve renewals for finance operators this quarter.",
      keywords: ["workflow audit"],
    },
  ];
  const existingNotes = [
    {
      id: 93,
      email_id: 16,
      taxonomy_key: "pattern_trend",
      title: "Finance teams expand AI copilot coverage",
      body: "Finance operators are expanding AI copilots to improve renewals.",
      keywords: ["staff handoff"],
    },
  ];

  const comparisons = compareNewNotesToExistingNotes(newNotes, existingNotes);

  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].existingNoteId, 93);
  assert.equal(comparisons[0].overlapBasis, "keyword");
  assert.ok(comparisons[0].sharedKeywords.includes("ai copilot"));
  assert.ok(comparisons[0].sharedKeywords.includes("finance operator"));
});

test("findRelatedNoteOverlaps groups normalized shared terms by related note", () => {
  const note = {
    type: "idea",
    title: "Tighten AI workflow reviews",
    content: "Operators are tightening AI workflow reviews across finance teams.",
    topics: ["Workflow Automation", "Finance Teams"],
    keywords: ["Prompt review cadence", "AI copilots"],
  };
  const existingNotes = [
    {
      id: 77,
      email_id: 12,
      taxonomy_key: "pattern_trend",
      title: "Finance teams operationalize prompt audits",
      body: "Finance teams are operationalizing AI copilots through tighter review loops.",
      topics: ["workflow automation"],
      keywords: ["prompt review cadence", "AI copilot"],
    },
    {
      id: 88,
      email_id: 13,
      taxonomy_key: "fact",
      title: "Warehouse leases expanded",
      body: "Landlords signed new warehouse leases in Phoenix.",
      topics: ["industrial real estate"],
      keywords: ["warehouse lease"],
    },
  ];

  const overlaps = findRelatedNoteOverlaps(note, existingNotes);

  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].relatedNoteId, 77);
  assert.equal(overlaps[0].existingNoteId, 77);
  assert.equal(overlaps[0].relatedEmailId, 12);
  assert.equal(overlaps[0].relatedNoteType, "pattern_trend");
  assert.deepEqual(overlaps[0].sharedTopics, ["workflow automation"]);
  assert.ok(overlaps[0].sharedKeywords.includes("prompt review cadence"));
  assert.ok(overlaps[0].sharedKeywords.includes("ai copilot"));
  assert.ok(overlaps[0].sharedTerms.includes("workflow automation"));
  assert.ok(overlaps[0].sharedTerms.includes("prompt review cadence"));
  assert.ok(overlaps[0].sharedTerms.includes("ai copilot"));
  assert.deepEqual(overlaps[0].justificationTerms, overlaps[0].sharedTerms);
});

test("compareNewNotesToDuplicateCandidates preserves source-independent exact matches as a stronger exact signal", () => {
  const newNotes = [
    {
      type: "fact",
      title: "Copilot revenue growth",
      content: "AI copilots grew 42% year over year across mid-market teams.",
      summary: "AI copilot revenue is growing quickly.",
      sourceExcerpt:
        "This excerpt came from the new newsletter even though the note is otherwise the same.",
      sourceTimestamp: "2026-03-09T17:05:00Z",
    },
  ];
  const existingNotes = [
    {
      id: 91,
      email_id: 14,
      taxonomy_key: "fact",
      title: "Copilot revenue growth",
      body: "AI copilots grew 42% year over year across mid-market teams.",
      summary: "AI copilot revenue is growing quickly.",
      source_excerpt:
        "A different newsletter excerpt should not prevent an exact duplicate match.",
      source_timestamp: "2026-03-09T17:00:00Z",
    },
    {
      id: 92,
      email_id: 15,
      taxonomy_key: "idea",
      title: "Copilot revenue growth",
      body: "AI copilots grew 42% year over year across mid-market teams.",
      summary: "AI copilot revenue is growing quickly.",
    },
  ];

  const duplicates = compareNewNotesToDuplicateCandidates(newNotes, existingNotes);

  assert.equal(duplicates.length, 2);

  const strongerExactMatch = duplicates.find((duplicate) => duplicate.existingNoteId === 91);
  const contentOnlyExactMatch = duplicates.find((duplicate) => duplicate.existingNoteId === 92);

  assert.ok(strongerExactMatch);
  assert.ok(contentOnlyExactMatch);
  assert.equal(strongerExactMatch.duplicateKind, "exact");
  assert.equal(strongerExactMatch.similarityScore, 1);
  assert.ok(
    strongerExactMatch.matchedRules.includes(DUPLICATE_MATCH_RULES.sourceIndependentExact)
  );
  assert.ok(
    strongerExactMatch.matchedRules.includes(DUPLICATE_MATCH_RULES.normalizedBodyExact)
  );
  assert.ok(strongerExactMatch.similarity.exactTypeMatch);
  assert.ok(strongerExactMatch.similarity.exactBodyMatch);
  assert.ok(strongerExactMatch.similarity.exactSourceIndependentMatch);
  assert.ok(strongerExactMatch.sharedTerms.includes("42"));
  assert.ok(strongerExactMatch.sharedTerms.includes("copilot"));
  assert.equal(contentOnlyExactMatch.duplicateKind, "exact");
  assert.equal(contentOnlyExactMatch.similarity.exactTypeMatch, false);
  assert.equal(contentOnlyExactMatch.similarity.exactBodyMatch, true);
  assert.equal(contentOnlyExactMatch.similarity.exactSourceIndependentMatch, false);
});

test("compareNewNotesToDuplicateCandidates treats normalized note content matches as exact even when titles differ", () => {
  const newNotes = [
    {
      type: "fact",
      title: "Same growth signal from another source",
      content: "AI copilots grew 42 percent year over year across mid market teams.",
      summary: "A second source repeated the metric with different framing.",
    },
  ];
  const existingNotes = [
    {
      id: 118,
      email_id: 21,
      taxonomy_key: "fact",
      title: "Copilot revenue growth",
      body: "AI copilots grew 42% year over year across mid-market teams.",
      summary: "The first source used a different summary.",
    },
  ];

  const duplicates = compareNewNotesToDuplicateCandidates(newNotes, existingNotes);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].existingNoteId, 118);
  assert.equal(duplicates[0].duplicateKind, "exact");
  assert.equal(duplicates[0].similarityScore, 1);
  assert.ok(
    duplicates[0].matchedRules.includes(DUPLICATE_MATCH_RULES.normalizedBodyExact)
  );
  assert.equal(duplicates[0].similarity.exactBodyMatch, true);
  assert.equal(duplicates[0].similarity.exactTitleMatch, false);
  assert.equal(duplicates[0].similarity.exactSourceIndependentMatch, false);
  assert.ok(duplicates[0].sharedTerms.includes("42"));
  assert.ok(duplicates[0].sharedTerms.includes("copilot"));
});

test("compareNewNotesToDuplicateCandidates detects near duplicates but rejects looser topical overlap", () => {
  const newNotes = [
    {
      type: "fact",
      title: "Mid-market copilot growth",
      content: "Across mid market teams, AI copilots grew 42 percent year over year.",
    },
    {
      type: "idea",
      title: "General AI growth",
      content: "AI copilots keep spreading through software teams this quarter.",
    },
  ];
  const existingNotes = [
    {
      id: 109,
      email_id: 18,
      taxonomy_key: "fact",
      title: "Copilot growth",
      body: "AI copilots grew 42% year over year across mid-market teams.",
    },
    {
      id: 110,
      email_id: 19,
      taxonomy_key: "pattern_trend",
      title: "Copilot adoption widens",
      body: "AI copilots are spreading across software teams this quarter.",
    },
  ];

  const duplicates = compareNewNotesToDuplicateCandidates(newNotes, existingNotes);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].newNoteIndex, 0);
  assert.equal(duplicates[0].existingNoteId, 109);
  assert.equal(duplicates[0].duplicateKind, "near");
  assert.ok(
    duplicates[0].matchedRules.includes(DUPLICATE_MATCH_RULES.highTokenOverlap)
  );
  assert.ok(duplicates[0].similarity.tokenJaccard >= 0.72);
  assert.ok(duplicates[0].similarity.tokenOverlap >= 0.85);
  assert.ok(duplicates[0].sharedTerms.includes("42"));
  assert.ok(duplicates[0].sharedTerms.includes("mid"));
});

test("compareNewNotesToDuplicateCandidates detects semantic near duplicates when concept overlap clears the threshold", () => {
  const newNotes = [
    {
      type: "fact",
      title: "AI copilots reduced support wait times for enterprise teams",
      content: "AI copilots reduced support wait times for enterprise teams.",
    },
  ];
  const existingNotes = [
    {
      id: 140,
      email_id: 27,
      taxonomy_key: "fact",
      title: "Enterprise teams saw support wait times fall after adopting AI copilots",
      body: "Enterprise teams saw support wait times fall after adopting AI copilots.",
    },
  ];

  const duplicates = compareNewNotesToDuplicateCandidates(newNotes, existingNotes);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].existingNoteId, 140);
  assert.equal(duplicates[0].duplicateKind, "near");
  assert.ok(
    duplicates[0].matchedRules.includes(DUPLICATE_MATCH_RULES.semanticConceptOverlap)
  );
  assert.ok(duplicates[0].similarity.tokenOverlap >= 0.8);
  assert.ok(duplicates[0].similarity.semanticConceptOverlap >= 0.55);
  assert.ok(duplicates[0].sharedTerms.includes("ai copilot"));
  assert.ok(duplicates[0].sharedTerms.includes("support wait"));
});
