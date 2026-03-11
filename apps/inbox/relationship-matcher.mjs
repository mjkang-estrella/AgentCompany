const MAX_NOTE_KEYWORDS = 20;
const MAX_DUPLICATE_TERMS = 64;
const SHORT_KEYWORD_ALLOWLIST = new Set(["ai", "ml", "llm", "ui", "ux", "api", "sdk"]);
const KEYWORD_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "will",
  "with",
  "year",
  "years",
  "month",
  "months",
  "week",
  "weekly",
  "today",
  "yesterday",
  "tomorrow",
  "email",
  "emails",
  "newsletter",
  "newsletters",
  "signal",
  "signals",
  "roundup",
  "update",
  "updates",
  "team",
  "teams",
  "company",
  "companies",
  "people",
  "person",
  "user",
  "users",
  "customer",
  "customers",
]);
export const DUPLICATE_MATCH_THRESHOLDS = Object.freeze({
  minimumTokenCount: 5,
  minimumSharedTokens: 5,
  nearDuplicateTokenJaccard: 0.72,
  nearDuplicateTokenOverlap: 0.85,
  nearDuplicateBigramDice: 0.55,
  nearDuplicateContainment: 0.9,
  minimumSemanticSharedTokens: 4,
  minimumSemanticSharedConcepts: 3,
  minimumSemanticSharedPhrases: 1,
  nearDuplicateSemanticTokenOverlap: 0.8,
  nearDuplicateSemanticConceptOverlap: 0.55,
  nearDuplicateSemanticConceptJaccard: 0.35,
});
export const DUPLICATE_MATCH_RULES = Object.freeze({
  sourceIndependentExact: "source_independent_exact",
  normalizedBodyExact: "normalized_body_exact",
  normalizedTitleAndBodyExact: "normalized_title_and_body_exact",
  highTokenOverlap: "high_token_overlap",
  bodyContainment: "body_containment",
  semanticConceptOverlap: "semantic_concept_overlap",
});

function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function singularizeToken(token) {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("s") && token.length > 4 && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function normalizeKeywordToken(token) {
  if (typeof token !== "string") {
    return null;
  }

  const normalized = singularizeToken(token.toLowerCase().replace(/['’]/g, "").trim());

  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return null;
  }

  if (KEYWORD_STOP_WORDS.has(normalized)) {
    return null;
  }

  if (normalized.length < 3 && !SHORT_KEYWORD_ALLOWLIST.has(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeDuplicateToken(token) {
  if (typeof token !== "string") {
    return null;
  }

  const normalized = singularizeToken(token.toLowerCase().replace(/['’]/g, "").trim());

  if (!normalized) {
    return null;
  }

  if (!/^\d+$/.test(normalized) && KEYWORD_STOP_WORDS.has(normalized)) {
    return null;
  }

  if (
    normalized.length < 2 &&
    !SHORT_KEYWORD_ALLOWLIST.has(normalized) &&
    !/^\d+$/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeDuplicateNoteType(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

function collectNoteKeywordFragments(note) {
  return [
    note?.title,
    note?.content,
    note?.body,
    note?.summary,
    note?.sourceExcerpt,
    note?.source_excerpt,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function normalizeDuplicateText(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  return normalized
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractDuplicateTokens(value) {
  const normalized = normalizeDuplicateText(value);

  if (!normalized) {
    return [];
  }

  return buildOrderedUniqueValues(
    normalized.split(/\s+/g).map(normalizeDuplicateToken).filter(Boolean),
    MAX_DUPLICATE_TERMS
  );
}

function buildTokenBigrams(tokens) {
  return buildOrderedUniqueValues(
    tokens
      .slice(0, -1)
      .map((token, index) => `${token} ${tokens[index + 1]}`)
      .filter(Boolean),
    MAX_DUPLICATE_TERMS
  );
}

function selectPrimaryNoteBody(note) {
  return (
    trimToNull(note?.content) ??
    trimToNull(note?.body) ??
    trimToNull(note?.summary) ??
    trimToNull(note?.sourceExcerpt) ??
    trimToNull(note?.source_excerpt) ??
    trimToNull(note?.title) ??
    ""
  );
}

function buildSourceIndependentDuplicateSignature({
  typeNormalized,
  titleNormalized,
  bodyNormalized,
  summaryNormalized,
}) {
  if (!typeNormalized || !bodyNormalized) {
    return null;
  }

  return JSON.stringify({
    type: typeNormalized,
    title: titleNormalized ?? null,
    body: bodyNormalized,
    summary: summaryNormalized ?? null,
  });
}

function buildDuplicateNoteIndex(note) {
  const typeNormalized = normalizeDuplicateNoteType(note?.type ?? note?.taxonomy_key);
  const title = trimToNull(note?.title) ?? "";
  const body = selectPrimaryNoteBody(note);
  const summary = trimToNull(note?.summary) ?? "";
  const combined = [title, body].filter(Boolean).join(" ").trim();
  const titleNormalized = normalizeDuplicateText(title);
  const bodyNormalized = normalizeDuplicateText(body);
  const summaryNormalized = normalizeDuplicateText(summary);
  const combinedNormalized = normalizeDuplicateText(combined);
  const titleTokens = extractDuplicateTokens(title);
  const bodyTokens = extractDuplicateTokens(body);
  const combinedTokens = extractDuplicateTokens(combined);

  return {
    typeNormalized,
    titleNormalized,
    bodyNormalized,
    summaryNormalized,
    combinedNormalized,
    sourceIndependentSignature: buildSourceIndependentDuplicateSignature({
      typeNormalized,
      titleNormalized,
      bodyNormalized,
      summaryNormalized,
    }),
    titleTokens,
    bodyTokens,
    combinedTokens,
    bodyBigrams: buildTokenBigrams(bodyTokens),
  };
}

function toRoundedSimilarity(value) {
  return Number(value.toFixed(3));
}

function calculateJaccard(intersectionCount, leftCount, rightCount) {
  const unionCount = leftCount + rightCount - intersectionCount;
  return unionCount > 0 ? intersectionCount / unionCount : 0;
}

function calculateOverlap(intersectionCount, leftCount, rightCount) {
  const shorterCount = Math.min(leftCount, rightCount);
  return shorterCount > 0 ? intersectionCount / shorterCount : 0;
}

function calculateDice(intersectionCount, leftCount, rightCount) {
  const totalCount = leftCount + rightCount;
  return totalCount > 0 ? (intersectionCount * 2) / totalCount : 0;
}

function calculateContainmentRatio(leftNormalized, rightNormalized) {
  if (!leftNormalized || !rightNormalized) {
    return 0;
  }

  const [shorterText, longerText] =
    leftNormalized.length <= rightNormalized.length
      ? [leftNormalized, rightNormalized]
      : [rightNormalized, leftNormalized];

  return longerText.includes(shorterText) ? shorterText.length / longerText.length : 0;
}

export function buildOrderedUniqueValues(values, limit = MAX_NOTE_KEYWORDS) {
  const uniqueValues = [];
  const seen = new Set();

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    uniqueValues.push(value);

    if (uniqueValues.length >= limit) {
      break;
    }
  }

  return uniqueValues;
}

function intersectOrderedValues(values, comparisonValues) {
  const comparisonSet = new Set(comparisonValues);
  return buildOrderedUniqueValues(values.filter((value) => comparisonSet.has(value)));
}

export function extractNoteKeywords(note) {
  const orderedTokens = [];
  const orderedPhrases = [];

  for (const fragment of collectNoteKeywordFragments(note)) {
    const fragmentTokens = fragment
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map(normalizeKeywordToken)
      .filter(Boolean);

    orderedTokens.push(...fragmentTokens);
    orderedPhrases.push(
      ...fragmentTokens
        .slice(0, -1)
        .map((token, index) => `${token} ${fragmentTokens[index + 1]}`)
        .filter(Boolean)
    );
  }

  const tokens = buildOrderedUniqueValues(orderedTokens);
  const phrases = buildOrderedUniqueValues(
    orderedPhrases,
    Math.max(1, Math.floor(MAX_NOTE_KEYWORDS / 2))
  );

  return {
    tokens,
    phrases,
    keywords: buildOrderedUniqueValues([...phrases, ...tokens]),
  };
}

function normalizeComparableTerm(value) {
  if (typeof value !== "string") {
    return null;
  }

  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeKeywordToken)
    .filter(Boolean);

  return tokens.length > 0 ? tokens.join(" ") : null;
}

function extractExplicitNoteTerms(values) {
  return buildOrderedUniqueValues(
    (Array.isArray(values) ? values : []).map(normalizeComparableTerm).filter(Boolean)
  );
}

function buildNoteKeywordIndex(note) {
  const derivedKeywords = extractNoteKeywords(note);
  const topicTerms = extractExplicitNoteTerms(note?.topics);
  const explicitKeywordTerms = extractExplicitNoteTerms(note?.keywords);
  const explicitKeywordPhraseTerms = explicitKeywordTerms.filter((term) => term.includes(" "));

  return {
    topics: topicTerms,
    explicitKeywords: explicitKeywordTerms,
    explicitKeywordPhrases: explicitKeywordPhraseTerms,
    derivedKeywordTokens: derivedKeywords.tokens,
    keywordPhrases: buildOrderedUniqueValues([
      ...explicitKeywordPhraseTerms,
      ...derivedKeywords.phrases,
    ]),
  };
}

function buildSemanticDuplicateConceptTerms(noteKeywordIndex) {
  return buildOrderedUniqueValues(
    [
      ...noteKeywordIndex.topics,
      ...noteKeywordIndex.keywordPhrases,
      ...noteKeywordIndex.derivedKeywordTokens.filter(
        (token) => token.length >= 5 || SHORT_KEYWORD_ALLOWLIST.has(token)
      ),
    ],
    MAX_DUPLICATE_TERMS
  );
}

export function compareNotesByKeywords(note, existingNote) {
  const newNoteKeywords = buildNoteKeywordIndex(note);
  const existingNoteKeywords = buildNoteKeywordIndex(existingNote);
  const sharedTopics = intersectOrderedValues(newNoteKeywords.topics, existingNoteKeywords.topics);
  const sharedExplicitKeywords = intersectOrderedValues(
    newNoteKeywords.explicitKeywords,
    existingNoteKeywords.explicitKeywords
  );
  const sharedPhrases = intersectOrderedValues(
    newNoteKeywords.keywordPhrases,
    existingNoteKeywords.keywordPhrases
  );
  const sharedTokens = intersectOrderedValues(
    newNoteKeywords.derivedKeywordTokens,
    existingNoteKeywords.derivedKeywordTokens
  );
  const sharedStrongTokens = sharedTokens.filter(
    (token) => token.length >= 6 && !SHORT_KEYWORD_ALLOWLIST.has(token)
  );
  const coveredPhraseTokens = new Set(
    sharedPhrases.flatMap((phrase) => phrase.split(/\s+/g).filter(Boolean))
  );
  const standaloneStrongTokens = sharedStrongTokens.filter(
    (token) => !coveredPhraseTokens.has(token)
  );
  const sharedKeywords = buildOrderedUniqueValues(
    sharedPhrases.length > 0 || sharedExplicitKeywords.length > 0
      ? [...sharedExplicitKeywords, ...sharedPhrases, ...standaloneStrongTokens]
      : sharedTokens
  );
  const explicitOnlyKeywords = sharedExplicitKeywords.filter(
    (keyword) => !sharedPhrases.includes(keyword)
  );
  const isRelated =
    sharedTopics.length > 0 ||
    sharedExplicitKeywords.length > 0 ||
    sharedPhrases.length > 0 ||
    sharedStrongTokens.length > 0 ||
    sharedTokens.length >= 2;

  return {
    isRelated,
    score:
      sharedTopics.length * 3 +
      sharedPhrases.length * 2 +
      explicitOnlyKeywords.length +
      sharedTokens.length,
    sharedTopics,
    sharedKeywords,
    sharedPhrases,
    sharedTokens,
  };
}

export function compareNotesForDuplicateCandidate(note, existingNote) {
  const newNoteIndex = buildDuplicateNoteIndex(note);
  const existingNoteIndex = buildDuplicateNoteIndex(existingNote);
  const newNoteKeywordIndex = buildNoteKeywordIndex(note);
  const existingNoteKeywordIndex = buildNoteKeywordIndex(existingNote);
  const newSemanticConceptTerms = buildSemanticDuplicateConceptTerms(newNoteKeywordIndex);
  const existingSemanticConceptTerms = buildSemanticDuplicateConceptTerms(existingNoteKeywordIndex);
  const exactTypeMatch =
    Boolean(newNoteIndex.typeNormalized) &&
    newNoteIndex.typeNormalized === existingNoteIndex.typeNormalized;
  const sharedTitleTokens = intersectOrderedValues(
    newNoteIndex.titleTokens,
    existingNoteIndex.titleTokens
  );
  const sharedBodyTokens = intersectOrderedValues(
    newNoteIndex.bodyTokens,
    existingNoteIndex.bodyTokens
  );
  const sharedBodyBigrams = intersectOrderedValues(
    newNoteIndex.bodyBigrams,
    existingNoteIndex.bodyBigrams
  );
  const sharedTopicTerms = intersectOrderedValues(
    newNoteKeywordIndex.topics,
    existingNoteKeywordIndex.topics
  );
  const sharedExplicitKeywordTerms = intersectOrderedValues(
    newNoteKeywordIndex.explicitKeywords,
    existingNoteKeywordIndex.explicitKeywords
  );
  const sharedKeywordPhrases = intersectOrderedValues(
    newNoteKeywordIndex.keywordPhrases,
    existingNoteKeywordIndex.keywordPhrases
  );
  const sharedSemanticConceptTerms = intersectOrderedValues(
    newSemanticConceptTerms,
    existingSemanticConceptTerms
  );
  const exactBodyMatch =
    Boolean(newNoteIndex.bodyNormalized) &&
    newNoteIndex.bodyNormalized === existingNoteIndex.bodyNormalized;
  const exactCombinedMatch =
    Boolean(newNoteIndex.combinedNormalized) &&
    newNoteIndex.combinedNormalized === existingNoteIndex.combinedNormalized;
  const exactSourceIndependentMatch =
    exactTypeMatch &&
    Boolean(newNoteIndex.sourceIndependentSignature) &&
    newNoteIndex.sourceIndependentSignature === existingNoteIndex.sourceIndependentSignature;
  const exactTitleMatch =
    Boolean(newNoteIndex.titleNormalized) &&
    newNoteIndex.titleNormalized === existingNoteIndex.titleNormalized;
  const tokenJaccard = calculateJaccard(
    sharedBodyTokens.length,
    newNoteIndex.bodyTokens.length,
    existingNoteIndex.bodyTokens.length
  );
  const tokenOverlap = calculateOverlap(
    sharedBodyTokens.length,
    newNoteIndex.bodyTokens.length,
    existingNoteIndex.bodyTokens.length
  );
  const bigramDice = calculateDice(
    sharedBodyBigrams.length,
    newNoteIndex.bodyBigrams.length,
    existingNoteIndex.bodyBigrams.length
  );
  const containmentRatio = calculateContainmentRatio(
    newNoteIndex.bodyNormalized,
    existingNoteIndex.bodyNormalized
  );
  const semanticConceptJaccard = calculateJaccard(
    sharedSemanticConceptTerms.length,
    newSemanticConceptTerms.length,
    existingSemanticConceptTerms.length
  );
  const semanticConceptOverlap = calculateOverlap(
    sharedSemanticConceptTerms.length,
    newSemanticConceptTerms.length,
    existingSemanticConceptTerms.length
  );
  const matchedRules = [];
  const meetsMinimumTokenThreshold =
    Math.min(newNoteIndex.bodyTokens.length, existingNoteIndex.bodyTokens.length) >=
    DUPLICATE_MATCH_THRESHOLDS.minimumTokenCount;
  const meetsMinimumSharedTokenThreshold =
    sharedBodyTokens.length >= DUPLICATE_MATCH_THRESHOLDS.minimumSharedTokens;
  const meetsMinimumSemanticSharedTokenThreshold =
    sharedBodyTokens.length >= DUPLICATE_MATCH_THRESHOLDS.minimumSemanticSharedTokens;
  const meetsMinimumSemanticConceptThreshold =
    sharedSemanticConceptTerms.length >= DUPLICATE_MATCH_THRESHOLDS.minimumSemanticSharedConcepts;
  const highTokenOverlapMatch =
    exactTypeMatch &&
    meetsMinimumTokenThreshold &&
    meetsMinimumSharedTokenThreshold &&
    tokenJaccard >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateTokenJaccard &&
    tokenOverlap >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateTokenOverlap &&
    bigramDice >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateBigramDice;
  const containmentMatch =
    exactTypeMatch &&
    meetsMinimumTokenThreshold &&
    meetsMinimumSharedTokenThreshold &&
    containmentRatio >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateContainment &&
    tokenOverlap >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateTokenOverlap;
  const semanticConceptOverlapMatch =
    exactTypeMatch &&
    meetsMinimumTokenThreshold &&
    meetsMinimumSemanticSharedTokenThreshold &&
    meetsMinimumSemanticConceptThreshold &&
    tokenOverlap >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateSemanticTokenOverlap &&
    semanticConceptOverlap >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateSemanticConceptOverlap &&
    semanticConceptJaccard >= DUPLICATE_MATCH_THRESHOLDS.nearDuplicateSemanticConceptJaccard &&
    (sharedKeywordPhrases.length >= DUPLICATE_MATCH_THRESHOLDS.minimumSemanticSharedPhrases ||
      sharedTopicTerms.length > 0);

  if (exactSourceIndependentMatch) {
    matchedRules.push(DUPLICATE_MATCH_RULES.sourceIndependentExact);
  }

  if (exactBodyMatch) {
    matchedRules.push(DUPLICATE_MATCH_RULES.normalizedBodyExact);
  }

  if (exactCombinedMatch) {
    matchedRules.push(DUPLICATE_MATCH_RULES.normalizedTitleAndBodyExact);
  }

  if (!exactSourceIndependentMatch && highTokenOverlapMatch) {
    matchedRules.push(DUPLICATE_MATCH_RULES.highTokenOverlap);
  }

  if (!exactSourceIndependentMatch && containmentMatch) {
    matchedRules.push(DUPLICATE_MATCH_RULES.bodyContainment);
  }

  if (!exactSourceIndependentMatch && semanticConceptOverlapMatch) {
    matchedRules.push(DUPLICATE_MATCH_RULES.semanticConceptOverlap);
  }

  const duplicateKind = exactBodyMatch
    ? "exact"
    : matchedRules.length > 0
      ? "near"
      : null;

  return {
    isDuplicate: duplicateKind !== null,
    duplicateKind,
    exactTypeMatch,
    exactTitleMatch,
    exactBodyMatch,
    exactSourceIndependentMatch,
    similarityScore:
      duplicateKind === "exact"
        ? 1
        : toRoundedSimilarity(
            Math.max(
              tokenJaccard,
              tokenOverlap,
              bigramDice,
              containmentRatio,
              semanticConceptOverlap,
              semanticConceptJaccard,
              0
            )
          ),
    matchedRules,
    sharedTitleTokens,
    sharedBodyTokens,
    sharedTopicTerms,
    sharedExplicitKeywordTerms,
    sharedKeywordPhrases,
    sharedSemanticConceptTerms,
    sharedTerms: buildOrderedUniqueValues([
      ...sharedBodyTokens,
      ...sharedTitleTokens,
      ...sharedSemanticConceptTerms,
    ], MAX_DUPLICATE_TERMS),
    tokenJaccard: toRoundedSimilarity(tokenJaccard),
    tokenOverlap: toRoundedSimilarity(tokenOverlap),
    bigramDice: toRoundedSimilarity(bigramDice),
    containmentRatio: toRoundedSimilarity(containmentRatio),
    semanticConceptJaccard: toRoundedSimilarity(semanticConceptJaccard),
    semanticConceptOverlap: toRoundedSimilarity(semanticConceptOverlap),
  };
}

function buildDuplicateCandidateResult(existingNote, comparison) {
  return {
    relatedNoteId: existingNote.id,
    relatedEmailId: existingNote.email_id,
    relatedNoteType: existingNote.taxonomy_key,
    relatedNoteTitle: existingNote.title,
    existingNoteId: existingNote.id,
    existingEmailId: existingNote.email_id,
    existingNoteType: existingNote.taxonomy_key,
    existingNoteTitle: existingNote.title,
    duplicateKind: comparison.duplicateKind,
    similarityScore: comparison.similarityScore,
    matchedRules: comparison.matchedRules,
    score: comparison.similarityScore,
    sharedTitleTokens: comparison.sharedTitleTokens,
    sharedBodyTokens: comparison.sharedBodyTokens,
    sharedTopicTerms: comparison.sharedTopicTerms,
    sharedExplicitKeywordTerms: comparison.sharedExplicitKeywordTerms,
    sharedKeywordPhrases: comparison.sharedKeywordPhrases,
    sharedSemanticConceptTerms: comparison.sharedSemanticConceptTerms,
    sharedTerms: comparison.sharedTerms,
    justificationTerms: comparison.sharedTerms,
    similarity: {
      tokenJaccard: comparison.tokenJaccard,
      tokenOverlap: comparison.tokenOverlap,
      bigramDice: comparison.bigramDice,
      containmentRatio: comparison.containmentRatio,
      semanticConceptJaccard: comparison.semanticConceptJaccard,
      semanticConceptOverlap: comparison.semanticConceptOverlap,
      exactTypeMatch: comparison.exactTypeMatch,
      exactTitleMatch: comparison.exactTitleMatch,
      exactBodyMatch: comparison.exactBodyMatch,
      exactSourceIndependentMatch: comparison.exactSourceIndependentMatch,
    },
  };
}

function compareDuplicateCandidates(left, right) {
  if (left.duplicateKind !== right.duplicateKind) {
    return left.duplicateKind === "exact" ? -1 : 1;
  }

  return right.similarityScore - left.similarityScore || left.relatedNoteId - right.relatedNoteId;
}

export function findDuplicateExistingNotes(note, existingNotes) {
  return existingNotes
    .flatMap((existingNote) => {
      const comparison = compareNotesForDuplicateCandidate(note, existingNote);

      if (!comparison.isDuplicate) {
        return [];
      }

      return [buildDuplicateCandidateResult(existingNote, comparison)];
    })
    .sort(compareDuplicateCandidates);
}

function buildRelatedNoteOverlapResult(existingNote, comparison) {
  const sharedTerms = buildOrderedUniqueValues([
    ...comparison.sharedTopics,
    ...comparison.sharedKeywords,
  ]);

  return {
    relatedNoteId: existingNote.id,
    relatedEmailId: existingNote.email_id,
    relatedNoteType: existingNote.taxonomy_key,
    relatedNoteTitle: existingNote.title,
    existingNoteId: existingNote.id,
    existingEmailId: existingNote.email_id,
    existingNoteType: existingNote.taxonomy_key,
    existingNoteTitle: existingNote.title,
    score: comparison.score,
    sharedTopics: comparison.sharedTopics,
    sharedKeywords: comparison.sharedKeywords,
    sharedTerms,
    justificationTerms: sharedTerms,
  };
}

function compareRelatedNoteOverlapResults(left, right) {
  return right.score - left.score || left.relatedNoteId - right.relatedNoteId;
}

export function findRelatedNoteOverlaps(note, existingNotes) {
  return existingNotes
    .flatMap((existingNote) => {
      const comparison = compareNotesByKeywords(note, existingNote);

      if (!comparison.isRelated) {
        return [];
      }

      return [buildRelatedNoteOverlapResult(existingNote, comparison)];
    })
    .sort(compareRelatedNoteOverlapResults);
}

export function findRelatedExistingNotes(note, existingNotes) {
  return findRelatedNoteOverlaps(note, existingNotes)
    .flatMap((relatedNote) => {
      const overlaps = [];

      if (relatedNote.sharedTopics.length > 0) {
        overlaps.push({
          ...relatedNote,
          overlapBasis: "topic",
          matchedValues: relatedNote.sharedTopics,
        });
      }

      if (relatedNote.sharedKeywords.length > 0) {
        overlaps.push({
          ...relatedNote,
          overlapBasis: "keyword",
          matchedValues: relatedNote.sharedKeywords,
        });
      }

      return overlaps;
    })
    .sort(
      (left, right) =>
        compareRelatedNoteOverlapResults(left, right) ||
        left.overlapBasis.localeCompare(right.overlapBasis)
    );
}

export function compareNewNotesToExistingNotes(newNotes, existingNotes) {
  return newNotes.flatMap((note, newNoteIndex) =>
    findRelatedExistingNotes(note, existingNotes).map((relatedNote) => ({
      newNoteIndex,
      newNoteType: note.type,
      newNoteTitle: note.title,
      ...relatedNote,
    }))
  );
}

export function compareNewNotesToDuplicateCandidates(newNotes, existingNotes) {
  return newNotes.flatMap((note, newNoteIndex) =>
    findDuplicateExistingNotes(note, existingNotes).map((duplicateCandidate) => ({
      newNoteIndex,
      newNoteType: note.type,
      newNoteTitle: note.title,
      ...duplicateCandidate,
    }))
  );
}
