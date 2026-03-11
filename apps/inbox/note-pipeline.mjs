import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getEmailById,
  getEmailProcessingJobByEmailId,
  listNotesForComparison,
  queueEmailProcessingJob,
  replaceNotesForEmail,
  TAXONOMY_TYPES,
  updateEmailRelevanceStatus,
  updateEmailProcessingJobState,
  updateEmailProcessingState,
} from "./database.mjs";
import {
  buildOrderedUniqueValues,
  compareNewNotesToDuplicateCandidates,
  compareNewNotesToExistingNotes,
} from "./relationship-matcher.mjs";

export {
  buildOrderedUniqueValues,
  compareNewNotesToDuplicateCandidates,
  compareNewNotesToExistingNotes,
  compareNotesForDuplicateCandidate,
  compareNotesByKeywords,
  DUPLICATE_MATCH_RULES,
  DUPLICATE_MATCH_THRESHOLDS,
  extractNoteKeywords,
  findDuplicateExistingNotes,
  findRelatedExistingNotes,
  findRelatedNoteOverlaps,
} from "./relationship-matcher.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CLAUDE_MODEL = "claude-3-5-haiku-latest";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_EMAIL_CONTENT_CHARS = 12000;
const MAX_NOTES_PER_EMAIL = 12;
const MIN_ATOMIC_CANDIDATE_LENGTH = 24;
const MIN_EXPLICIT_LIST_ITEM_LENGTH = 8;
const TAXONOMY_KEYS = new Set(TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.key));
const RELEVANCE_STATUS_PENDING = "pending";
const RELEVANCE_STATUS_RELEVANT = "relevant";
const IRRELEVANT_RELEVANCE_STATUSES = new Set([
  "spam",
  "promotion",
  "non_newsletter",
]);
const HTML_HARD_BREAK_RE = /<\s*br\s*\/?\s*>/gi;
const HTML_BLOCK_CLOSE_RE =
  /<\s*\/\s*(?:p|div|li|tr|h[1-6]|ul|ol|table|section|article|blockquote)\s*>/gi;
const HTML_LIST_ITEM_OPEN_RE = /<\s*li\b[^>]*>/gi;
const EXPLICIT_LIST_ITEM_RE = /^(?:[-*•]+|\d+[.)]|[A-Za-z][.)]|\[[ xX]\])\s+(.*)$/;
const NEWSLETTER_SIGNAL_PATTERNS = Object.freeze([
  /\bnewsletter\b/i,
  /\bdigest\b/i,
  /\bbriefing\b/i,
  /\broundup\b/i,
  /\bweekly\b/i,
  /\bdaily\b/i,
  /\bedition\b/i,
  /\bissue\s+#?\d+\b/i,
  /\bdispatch\b/i,
  /\bwhat we're reading\b/i,
  /\btop stories\b/i,
  /\bwhy it matters\b/i,
  /\bkey takeaway\b/i,
]);
const PROMOTION_SIGNAL_PATTERNS = Object.freeze([
  /\bflash sale\b/i,
  /\blimited time\b/i,
  /\bsave\s+\d+%/i,
  /\bdiscount\b/i,
  /\bcoupon\b/i,
  /\bpromo code\b/i,
  /\bbuy now\b/i,
  /\bshop now\b/i,
  /\bstart your free trial\b/i,
  /\bbook a demo\b/i,
  /\bupgrade (?:today|now)\b/i,
  /\boffer ends\b/i,
  /\bfree shipping\b/i,
]);
const SPAM_SIGNAL_PATTERNS = Object.freeze([
  /\burgent action required\b/i,
  /\bclaim your (?:reward|prize)\b/i,
  /\bguaranteed income\b/i,
  /\bwire transfer\b/i,
  /\bcrypto (?:reward|giveaway)\b/i,
  /\byou(?:'ve| have) (?:won|been selected)\b/i,
  /\bdouble your money\b/i,
]);
const NON_NEWSLETTER_SIGNAL_PATTERNS = Object.freeze([
  /\bpassword reset\b/i,
  /\bverification code\b/i,
  /\bverify your email\b/i,
  /\bsign[- ]?in link\b/i,
  /\bsecurity alert\b/i,
  /\bmagic link\b/i,
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\border (?:confirmation|#)\b/i,
  /\bshipping update\b/i,
  /\btracking number\b/i,
  /\bcalendar invite\b/i,
  /\bmeeting invitation\b/i,
  /\baccount statement\b/i,
]);
const PROMOTION_LOCAL_PARTS = new Set(["offers", "promo", "promotions", "sales", "deals"]);
const SPAM_LOCAL_PARTS = new Set(["winner", "rewards", "claim", "prize"]);
const NON_NEWSLETTER_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "support",
  "billing",
  "security",
  "alerts",
  "notification",
  "notifications",
  "account",
  "accounts",
]);
const TAXONOMY_DECISION_GUIDANCE = Object.freeze({
  claim:
    "Use for attributed assertions, forecasts, or positions that are presented as someone's claim rather than as established fact.",
  fact:
    "Use for concrete measurements, reported events, or verifiable statements grounded in evidence from the email.",
  idea:
    "Use for a synthesis, implication, concept, or proposal that captures one original idea.",
  opinion:
    "Use for subjective judgment, evaluation, or point of view.",
  task:
    "Use for a concrete action item, recommended next step, or to-do.",
  question:
    "Use for an explicit question, open unknown, or research prompt.",
  opportunity:
    "Use for upside, whitespace, arbitrage, or an underexploited opening.",
  warning_risk:
    "Use for a downside, caution, threat, fragility, or meaningful risk signal.",
  tool_update:
    "Use for a launch, release, integration, version change, or notable product/tool update.",
  pattern_trend:
    "Use for directional shifts, repeated signals, or trends across people, teams, or markets.",
  contradiction:
    "Use for tension, disagreement, reversal, or a direct contradiction between ideas.",
  playbook_candidate:
    "Use for a reusable checklist, workflow, operating routine, template, or repeatable tactic.",
  preference_candidate:
    "Use for an expressed taste, bias, or preference that could become a stored user preference.",
});
const TAXONOMY_SELECTION_RULES = Object.freeze([
  "Choose exactly one taxonomy key per note from the 13 allowed keys.",
  "Prefer the most specific type. Example: a reusable checklist is `playbook_candidate`, not `task`.",
  "If a note mentions a checklist, template, cadence, or operating routine, prefer `playbook_candidate` over `pattern_trend`.",
  "If a note states a taste or bias with words like `prefer`, `avoid`, or `rather than`, prefer `preference_candidate` over `opinion`.",
  "If a sentence mixes multiple ideas, split it into separate notes instead of inventing a hybrid type.",
  "If a statement is attributed to a speaker or source and could be disputed, prefer `claim` over `fact`.",
  "Do not invent new taxonomy labels or synonyms in the output.",
]);
const TAXONOMY_BOUNDARY_RULES = Object.freeze([
  "`claim` vs `fact`: attributed assertions, forecasts, or disputed positions stay `claim` even when the sentence includes numbers.",
  "`task` vs `playbook_candidate`: one-off next steps are `task`; reusable routines, checklists, and operating cadences are `playbook_candidate`.",
  "`opinion` vs `preference_candidate`: explicit tastes, biases, or defaults belong in `preference_candidate`, while broad evaluations stay `opinion`.",
  "`tool_update` vs `fact`: launches, releases, integrations, and version changes should be `tool_update`, not a generic `fact`.",
  "`pattern_trend` vs `fact`: repeated directional movement across teams, markets, or time belongs in `pattern_trend`.",
]);
const TAXONOMY_PROMPT_LINES = Object.freeze(
  TAXONOMY_TYPES.flatMap((taxonomyType) => [
    `- ${taxonomyType.key} (${taxonomyType.label}): ${taxonomyType.description}`,
    `  Use when: ${TAXONOMY_DECISION_GUIDANCE[taxonomyType.key]}`,
  ])
);
const TAXONOMY_EXAMPLE_LINES = Object.freeze([
  "- Example: `The vendor argues that smaller models now outperform larger ones on support queues.` -> `claim`",
  "- Example: `Revenue from AI copilots grew 42% year over year across mid-market teams.` -> `fact`",
  "- Example: `One implication is to bundle prompt reviews into the weekly sprint retro.` -> `idea`",
  "- Example: `In my view, most teams are overusing general-purpose agents for narrow workflows.` -> `opinion`",
  "- Example: `Schedule a weekly prompt audit for every customer-facing agent before Friday.` -> `task`",
  "- Example: `What operating cadence should teams use for prompt reviews across each agent?` -> `question`",
  "- Example: `There is white space to build compliance tooling for agent handoffs in finance.` -> `opportunity`",
  "- Example: `Unchecked automation drift is a serious risk for customer-facing workflows.` -> `warning_risk`",
  "- Example: `Anthropic released a new API for tool use in multi-step agents last week.` -> `tool_update`",
  "- Example: `More teams are moving from single bots to multi-agent workflows this quarter.` -> `pattern_trend`",
  "- Example: `Open rates are rising, but conversions are falling for the same campaigns.` -> `contradiction`",
  "- Example: `A weekly prompt audit checklist could become a reusable operating routine.` -> `playbook_candidate`",
  "- Example: `Operators prefer narrow single-purpose agents over bloated generalist bots.` -> `preference_candidate`",
]);
const LEGACY_TAXONOMY_MAP = Object.freeze({
  statistic: "fact",
  quote: "claim",
  insight: "idea",
  prediction: "claim",
  recommendation: "task",
  tactic: "playbook_candidate",
  framework: "playbook_candidate",
  trend: "pattern_trend",
  resource: "fact",
  event: "tool_update",
});
const TAXONOMY_ALIASES = new Map();
const TAXONOMY_FALLBACK_PRIORITY = new Map(
  [
    "question",
    "contradiction",
    "warning_risk",
    "opportunity",
    "tool_update",
    "playbook_candidate",
    "preference_candidate",
    "task",
    "opinion",
    "idea",
    "pattern_trend",
    "fact",
    "claim",
  ].map((taxonomyKey, index) => [taxonomyKey, index])
);

function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clipText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function stripHtml(html) {
  if (typeof html !== "string" || html.trim().length === 0) {
    return "";
  }

  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(HTML_HARD_BREAK_RE, "\n")
    .replace(HTML_LIST_ITEM_OPEN_RE, "\n- ")
    .replace(HTML_BLOCK_CLOSE_RE, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&(apos|#39);/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = trimToNull(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function countPatternMatches(text, patterns) {
  if (typeof text !== "string" || text.length === 0) {
    return 0;
  }

  let count = 0;

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      count += 1;
    }
  }

  return count;
}

function normalizeTaxonomyAlias(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function registerTaxonomyAlias(alias, key) {
  const normalized = normalizeTaxonomyAlias(alias);

  if (normalized) {
    TAXONOMY_ALIASES.set(normalized, key);

    const compact = normalized.replace(/\s+/g, "");

    if (compact && compact !== normalized) {
      TAXONOMY_ALIASES.set(compact, key);
    }
  }
}

for (const taxonomyType of TAXONOMY_TYPES) {
  registerTaxonomyAlias(taxonomyType.key, taxonomyType.key);
  registerTaxonomyAlias(taxonomyType.label, taxonomyType.key);
}

for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_TAXONOMY_MAP)) {
  registerTaxonomyAlias(legacyKey, canonicalKey);
}

function canonicalizeTaxonomyType(value) {
  const normalized = normalizeTaxonomyAlias(value);
  return normalized ? TAXONOMY_ALIASES.get(normalized) ?? null : null;
}

function selectEmailContent(email) {
  return pickFirstString(email.text_content, stripHtml(email.html_content), email.subject) ?? "";
}

function buildEmailRelevanceCorpus(email) {
  return [
    email?.subject,
    email?.from_name,
    email?.from_address,
    email?.sender_address,
    email?.text_content,
    stripHtml(email?.html_content),
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

function getSenderLocalPart(email) {
  const address = pickFirstString(email?.sender_address, email?.from_address);

  if (!address) {
    return null;
  }

  return trimToNull(address.toLowerCase().split("@")[0] ?? null);
}

function deriveSourceTimestamp(email) {
  return pickFirstString(email.sent_at, email.received_at, email.created_at, new Date().toISOString());
}

function deriveTitle(content) {
  const normalized = content
    .replace(/\s+/g, " ")
    .replace(/^[\W_]+|[\W_]+$/g, "")
    .trim();

  if (!normalized) {
    return "Untitled note";
  }

  const words = normalized.split(/\s+/).slice(0, 8).join(" ");
  return clipText(words, 72);
}

function normalizeSourceExcerpt(note, fallbackContent = "") {
  return (
    trimToNull(note?.sourceExcerpt ?? note?.source_excerpt ?? note?.source) ??
    clipText(fallbackContent, 280)
  );
}

function parseConfidenceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  const percentageMatch = normalized.match(/^(-?\d+(?:\.\d+)?)\s*%$/);

  if (percentageMatch) {
    return Number.parseFloat(percentageMatch[1]) / 100;
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConfidence(value, fallbackValue) {
  const parsed = parseConfidenceNumber(value);

  if (parsed !== null) {
    const normalized = parsed >= 10 && parsed <= 100 ? parsed / 100 : parsed;
    return Math.max(0, Math.min(1, normalized));
  }

  const fallbackParsed = parseConfidenceNumber(fallbackValue);

  if (fallbackParsed !== null) {
    const normalized =
      fallbackParsed >= 10 && fallbackParsed <= 100 ? fallbackParsed / 100 : fallbackParsed;
    return Math.max(0, Math.min(1, normalized));
  }

  return 0.75;
}

function addTaxonomyScore(scores, taxonomyKey, points, condition) {
  if (!condition) {
    return;
  }

  scores.set(taxonomyKey, (scores.get(taxonomyKey) ?? 0) + points);
}

function scoreToConfidence(score) {
  return Number(Math.max(0.45, Math.min(0.88, 0.4 + score * 0.035)).toFixed(2));
}

function extractExplicitListItems(block) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const items = [];
  let currentItem = null;
  let explicitItemCount = 0;

  for (const line of lines) {
    const explicitListMatch = line.match(EXPLICIT_LIST_ITEM_RE);

    if (explicitListMatch) {
      explicitItemCount += 1;

      if (currentItem) {
        items.push(currentItem.trim());
      }

      currentItem = explicitListMatch[1].trim();
      continue;
    }

    if (!currentItem) {
      return [];
    }

    currentItem = `${currentItem} ${line}`.trim();
  }

  if (currentItem) {
    items.push(currentItem.trim());
  }

  return explicitItemCount >= 2 ? items.filter(Boolean) : [];
}

function splitCandidateSentences(candidate) {
  const compactCandidate = candidate.replace(/\s+/g, " ").trim();

  if (!compactCandidate) {
    return [];
  }

  const sentences = compactCandidate
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    return sentences;
  }

  if (compactCandidate.includes(";")) {
    return compactCandidate
      .split(/;\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  return [compactCandidate];
}

function splitAtomicCandidates(text) {
  const normalized = text.replace(/\r/g, "").trim();

  if (!normalized) {
    return [];
  }

  const candidates = [];
  const shortCandidates = [];
  const seen = new Set();
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const addCandidate = (sentence, { allowShort = false } = {}) => {
    const candidate = sentence
      .replace(/^(?:[-*•]+|\d+[.)]|[A-Za-z][.)]|\[[ xX]\])\s+/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!candidate) {
      return;
    }

    const signature = candidate.toLowerCase();

    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);

    if (
      allowShort
        ? candidate.length >= MIN_EXPLICIT_LIST_ITEM_LENGTH
        : candidate.length >= MIN_ATOMIC_CANDIDATE_LENGTH
    ) {
      candidates.push(candidate);
      return;
    }

    shortCandidates.push(candidate);
  };

  for (const block of blocks) {
    const listItems = extractExplicitListItems(block);
    const atomicCandidates =
      listItems.length > 0
        ? listItems.flatMap((listItem) => splitCandidateSentences(listItem))
        : splitCandidateSentences(block);

    for (const sentence of atomicCandidates) {
      addCandidate(sentence, {
        allowShort: listItems.length > 0,
      });
    }
  }

  return (candidates.length > 0 ? candidates : shortCandidates).slice(0, MAX_NOTES_PER_EMAIL);
}

function classifyFallback(content) {
  const normalized = content.toLowerCase();
  const scores = new Map();
  const hasQuestionSignal =
    /\?$/.test(content) || /^(how|why|what|when|where|who|which|should|could|would|can)\b/.test(normalized);
  const hasOpposingDirectionSignal =
    /\b(rising|rise|growing|grow|increasing|increase|climbing|climb|improving|improve)\b/.test(
      normalized
    ) &&
    /\b(falling|fall|declining|decline|decreasing|decrease|dropping|drop|slowing|slow|worsening|worsen)\b/.test(
      normalized
    );
  const hasContradictionSignal =
    /\b(but|however|yet|although|despite|in contrast|on the other hand|while|versus|vs|even as)\b/.test(
      normalized
    ) &&
    (/[,:;]/.test(content) ||
      /\b(while|despite|even as|yet|but|however|although)\b/.test(normalized) ||
      hasOpposingDirectionSignal);
  const hasWarningSignal =
    /\b(risk|risky|warning|warn|caution|fragile|fragility|failure|failing|failure mode|backfire|degrade|degradation|erosion|regression|downside|exposed|threat|danger|breakage|liability|vulnerable|vulnerability)\b/.test(
      normalized
    );
  const hasOpportunitySignal =
    /\b(opportunity|upside|opening|white space|whitespace|arbitrage|untapped|underpriced|headroom|gap|underserved|unmet|room to build)\b/.test(
      normalized
    );

  const hasToolContext =
    /\b(tool|product|app|model|api|platform|assistant|agent|software|copilot|workspace|browser|editor|extension|service|cli|ai)\b/.test(
      normalized
    ) || /\b(integration|plugin|sdk|feature)\b/.test(normalized);
  const hasUpdateSignal =
    /\b(launch|launched|announce|announced|release|released|ship|shipped|update|updated|rollout|rolled out|rolling out|version|introduce|introduced|add|added|unveil|unveiled|deprecated|deprecate|sunset|beta|generally available|ga|supports|supporting|now supports)\b/.test(
      normalized
    );
  const hasPatternSignal =
    /\b(trend|pattern|shift|shifting|rising|growing|grew|declining|emerging|momentum|increasingly|more teams|across teams|becoming|standardizing|adopting|moving from|migrating|climbing|accelerating|cooling|slowing|plateauing|consolidating)\b/.test(
      normalized
    );
  const hasPlaybookSignal =
    /\b(playbook|checklist|template|runbook|sop|standard operating procedure|operating routine|repeatable process|repeatable workflow|reusable workflow|cadence|ritual|step by step|step-by-step)\b/.test(
      normalized
    );
  const hasPreferenceSignal =
    /\b(prefer|preferred|favorite|we like|i like|we love|i love|avoid|rather than|instead of|bias toward|bias against|default to|lean toward|leans toward|favor|favors|favour|favours|opt for)\b/.test(
      normalized
    );
  const hasTaskSignal =
    /\b(should|need to|must|todo|to-do|action item|follow up|review|audit|fix|send|write|schedule|investigate|create|document|test)\b/.test(
      normalized
    ) || /^(review|audit|fix|send|write|schedule|investigate|create|document|test)\b/.test(normalized);
  const hasOpinionSignal =
    /\b(i think|i believe|in my view|to me|seems|appears|likely|unlikely|probably|my take|i suspect|i feel|best|worst|overrated|underrated)\b/.test(
      normalized
    );
  const hasIdeaSignal =
    /\b(idea|concept|lesson|takeaway|implication|means|therefore|suggestion|approach|proposal|hypothesis|insight)\b/.test(
      normalized
    );
  const hasClaimSignal =
    /\b(according to|claims|claimed|argues|argued|suggests|suggested|said|says|expects|expected|predicts|predicted|forecasts|forecasted|projects|projected|estimates|estimated|contends|contended|maintains|maintained|believes|believed)\b/.test(
      normalized
    );
  const hasFactSignal =
    /\b(reported|measured|survey|study|benchmark|analysis|dataset|sample of|data shows|data show|found that)\b/.test(
      normalized
    ) ||
    /\b\d+([.,]\d+)?(%|x|k|m|b)\b/.test(normalized) ||
    /\b\d{2,}\b/.test(normalized);

  addTaxonomyScore(scores, "question", 10, hasQuestionSignal);
  addTaxonomyScore(scores, "contradiction", 9, hasContradictionSignal);
  addTaxonomyScore(scores, "warning_risk", 8, hasWarningSignal);
  addTaxonomyScore(scores, "opportunity", 8, hasOpportunitySignal);
  addTaxonomyScore(scores, "tool_update", 8, hasToolContext && hasUpdateSignal);
  addTaxonomyScore(scores, "tool_update", 1, hasToolContext && /\bv\d+(\.\d+)?\b/.test(normalized));
  addTaxonomyScore(scores, "playbook_candidate", 8, hasPlaybookSignal);
  addTaxonomyScore(scores, "preference_candidate", 8, hasPreferenceSignal);
  addTaxonomyScore(scores, "task", 7, hasTaskSignal);
  addTaxonomyScore(scores, "opinion", 6, hasOpinionSignal);
  addTaxonomyScore(scores, "idea", 6, hasIdeaSignal);
  addTaxonomyScore(scores, "pattern_trend", 6, hasPatternSignal);
  addTaxonomyScore(scores, "claim", 7, hasClaimSignal);
  addTaxonomyScore(scores, "fact", 7, hasFactSignal);
  addTaxonomyScore(
    scores,
    "idea",
    3,
    hasIdeaSignal && /\b(is to|would be to|could be to|suggests a path to)\b/.test(normalized)
  );
  addTaxonomyScore(scores, "playbook_candidate", 2, hasPlaybookSignal && hasPatternSignal);
  addTaxonomyScore(scores, "playbook_candidate", 2, hasPlaybookSignal && hasTaskSignal);
  addTaxonomyScore(
    scores,
    "preference_candidate",
    1,
    hasPreferenceSignal && /\b(default|single-purpose|generalist|narrow)\b/.test(normalized)
  );
  addTaxonomyScore(scores, "opportunity", 1, hasOpportunitySignal && /\b(build|launch|capture|own)\b/.test(normalized));
  addTaxonomyScore(scores, "claim", 1, hasClaimSignal && hasFactSignal);
  addTaxonomyScore(scores, "fact", 1, hasFactSignal && !hasClaimSignal);

  const rankedTypes = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort(
      (left, right) =>
        right[1] - left[1] ||
        (TAXONOMY_FALLBACK_PRIORITY.get(left[0]) ?? Number.MAX_SAFE_INTEGER) -
          (TAXONOMY_FALLBACK_PRIORITY.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
    );

  if (rankedTypes.length === 0) {
    return { type: "claim", confidence: 0.4 };
  }

  const [type, score] = rankedTypes[0];
  return { type, confidence: scoreToConfidence(score) };
}

function buildFallbackNotes(email) {
  const sourceTimestamp = deriveSourceTimestamp(email);
  const candidates = splitAtomicCandidates(selectEmailContent(email));

  if (candidates.length === 0 && trimToNull(email.subject)) {
    candidates.push(email.subject.trim());
  }

  return candidates.map((candidate) => {
    const classification = classifyFallback(candidate);

    return {
      type: classification.type,
      title: deriveTitle(candidate),
      content: candidate,
      summary: clipText(candidate, 160),
      source: normalizeSourceExcerpt({ source: candidate }, candidate),
      sourceExcerpt: normalizeSourceExcerpt({ source: candidate }, candidate),
      sourceTimestamp,
      timestamp: sourceTimestamp,
      confidence: classification.confidence,
    };
  });
}

export function classifyEmailRelevance(email) {
  const subject = pickFirstString(email?.subject, "") ?? "";
  const body = selectEmailContent(email);
  const senderLocalPart = getSenderLocalPart(email);
  const corpus = buildEmailRelevanceCorpus(email);
  const newsletterScore =
    countPatternMatches(corpus, NEWSLETTER_SIGNAL_PATTERNS) +
    (body.length >= 300 && /\n\s*\n/.test(email?.text_content ?? "") ? 1 : 0) +
    (subject.length >= 24 && /\b(weekly|daily|digest|newsletter|briefing|roundup|edition)\b/i.test(subject)
      ? 1
      : 0);
  const promotionScore =
    countPatternMatches(corpus, PROMOTION_SIGNAL_PATTERNS) +
    (senderLocalPart && PROMOTION_LOCAL_PARTS.has(senderLocalPart) ? 1 : 0);
  const spamScore =
    countPatternMatches(corpus, SPAM_SIGNAL_PATTERNS) +
    (senderLocalPart && SPAM_LOCAL_PARTS.has(senderLocalPart) ? 1 : 0);
  const nonNewsletterScore =
    countPatternMatches(corpus, NON_NEWSLETTER_SIGNAL_PATTERNS) +
    (senderLocalPart && NON_NEWSLETTER_LOCAL_PARTS.has(senderLocalPart) ? 1 : 0) +
    (/^(re:|fwd:)\s/i.test(subject) ? 1 : 0);
  const scores = {
    newsletter: newsletterScore,
    promotion: promotionScore,
    spam: spamScore,
    non_newsletter: nonNewsletterScore,
  };

  if (spamScore >= 2 && spamScore >= newsletterScore + 1) {
    return {
      relevanceStatus: "spam",
      shouldSkip: true,
      reasons: ["spam_signals_detected"],
      scores,
    };
  }

  if (nonNewsletterScore >= 2 && newsletterScore === 0 && promotionScore <= 1) {
    return {
      relevanceStatus: "non_newsletter",
      shouldSkip: true,
      reasons: ["transactional_or_personal_email_signals_detected"],
      scores,
    };
  }

  if (
    (promotionScore >= 3 && newsletterScore <= 1) ||
    (promotionScore >= 2 && body.length < 240 && newsletterScore === 0)
  ) {
    return {
      relevanceStatus: "promotion",
      shouldSkip: true,
      reasons: ["promotional_signals_outweigh_newsletter_signals"],
      scores,
    };
  }

  return {
    relevanceStatus: RELEVANCE_STATUS_RELEVANT,
    shouldSkip: false,
    reasons: newsletterScore > 0 ? ["newsletter_signals_detected"] : ["default_relevant"],
    scores,
  };
}

async function readClaudeApiKeyFromFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const match =
      content.match(/^ANTHROPIC_API_KEY=(.+)$/m) ?? content.match(/^CLAUDE_API_KEY=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function getClaudeApiKey(env = process.env) {
  if (env.ANTHROPIC_API_KEY) {
    return env.ANTHROPIC_API_KEY;
  }

  if (env.CLAUDE_API_KEY) {
    return env.CLAUDE_API_KEY;
  }

  const candidates = [
    path.join(__dirname, ".env"),
    path.join(path.resolve(__dirname, "..", ".."), ".env"),
  ];

  for (const filePath of candidates) {
    const apiKey = await readClaudeApiKeyFromFile(filePath);
    if (apiKey) {
      return apiKey;
    }
  }

  return null;
}

function extractAnthropicText(payload) {
  if (!payload || !Array.isArray(payload.content)) {
    return "";
  }

  return payload.content
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n")
    .trim();
}

function extractJsonBlock(text) {
  const fencedMatch = text.match(/```json\s*([\s\S]+?)```/i);

  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");

  if (startIndex >= 0 && endIndex > startIndex) {
    return text.slice(startIndex, endIndex + 1);
  }

  throw new Error("Claude response did not contain a JSON object");
}

function normalizeGeneratedNote(note, { sourceTimestamp, logger, noteIndex } = {}) {
  const rawType = note?.type ?? note?.taxonomy_key;
  const content = trimToNull(note?.content ?? note?.body);
  const explicitTopics = buildOrderedUniqueValues(Array.isArray(note?.topics) ? note.topics : []);
  const explicitKeywords = buildOrderedUniqueValues(
    Array.isArray(note?.keywords) ? note.keywords : []
  );

  let type = canonicalizeTaxonomyType(rawType);
  let fallbackClassification = null;

  if ((!type || !TAXONOMY_KEYS.has(type)) && content) {
    fallbackClassification = classifyFallback(content);
    type = fallbackClassification.type;
    logger?.warn?.(
      `[note-pipeline] Reclassified note ${noteIndex ?? "unknown"} with unsupported type "${trimToNull(rawType) ?? "unknown"}" as "${type}"`
    );
  }

  if (!type || !TAXONOMY_KEYS.has(type)) {
    throw new Error(`Invalid note type "${trimToNull(rawType) ?? "unknown"}"`);
  }

  if (!content) {
    throw new Error("Generated note is missing content");
  }

  return {
    type,
    title: trimToNull(note.title) ?? deriveTitle(content),
    content,
    summary: trimToNull(note.summary),
    source: normalizeSourceExcerpt(note, content),
    sourceExcerpt: normalizeSourceExcerpt(note, content),
    sourceTimestamp: trimToNull(
      note.sourceTimestamp ?? note.source_timestamp ?? note.timestamp
    ) ?? sourceTimestamp,
    timestamp:
      trimToNull(note.sourceTimestamp ?? note.source_timestamp ?? note.timestamp) ?? sourceTimestamp,
    confidence: normalizeConfidence(note.confidence, fallbackClassification?.confidence ?? 0.75),
    topics: explicitTopics,
    keywords: explicitKeywords,
  };
}

async function generateAtomicNotesWithClaude({
  email,
  apiKey,
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available for Claude note extraction");
  }

  const emailContent = clipText(selectEmailContent(email), MAX_EMAIL_CONTENT_CHARS);
  const response = await fetchImpl(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
      max_tokens: 1800,
      temperature: 0,
      system: [
        "You distill newsletter emails into typed atomic notes.",
        "Return JSON only.",
        "Each note must capture exactly one idea.",
        "Return `type` as the canonical taxonomy key, not the human label.",
        ...TAXONOMY_SELECTION_RULES,
        "Boundary rules:",
        ...TAXONOMY_BOUNDARY_RULES,
        "Valid taxonomy keys are:",
        ...TAXONOMY_PROMPT_LINES,
        "Examples:",
        ...TAXONOMY_EXAMPLE_LINES,
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Read the email and return an object with a top-level `notes` array.",
                "Each note must include: `type`, `title`, `content`, `summary`, `sourceExcerpt`, `sourceTimestamp`, `confidence`.",
                "`confidence` must be a numeric value between 0 and 1 inclusive. Do not return strings, words, or percentage symbols.",
                "Use only canonical taxonomy keys from the provided list.",
                "Prefer 1-8 notes. Skip greetings, signatures, and ads unless they contain a real idea.",
                "",
                `Subject: ${email.subject ?? "(no subject)"}`,
                `From: ${pickFirstString(email.from_name, email.from_address) ?? "(unknown sender)"}`,
                `Sent at: ${pickFirstString(email.sent_at, email.received_at) ?? "(unknown time)"}`,
                "",
                "Email content:",
                emailContent,
              ].join("\n"),
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const details = payload?.error?.message ?? payload?.error ?? response.statusText;
    throw new Error(`Claude note extraction failed (${response.status}): ${details}`);
  }

  const text = extractAnthropicText(payload);
  const jsonBlock = extractJsonBlock(text);
  const parsed = JSON.parse(jsonBlock);
  const notes = Array.isArray(parsed?.notes) ? parsed.notes : null;

  if (!notes || notes.length === 0) {
    throw new Error("Claude returned no notes");
  }

  return notes.map((note, noteIndex) =>
    normalizeGeneratedNote(note, {
      sourceTimestamp: deriveSourceTimestamp(email),
      logger,
      noteIndex,
    })
  );
}

export async function generateAtomicNotes(options) {
  const { email, env = process.env, fetchImpl = globalThis.fetch, logger = console } = options;
  const apiKey = await getClaudeApiKey(env);

  if (apiKey) {
    try {
      return await generateAtomicNotesWithClaude({
        email,
        apiKey,
        env,
        fetchImpl,
        logger,
      });
    } catch (error) {
      logger.warn?.(
        `[note-pipeline] Claude extraction failed for email ${email.id}; falling back to local heuristics: ${error.message}`
      );
    }
  } else {
    logger.warn?.(
      `[note-pipeline] No Claude API key configured for email ${email.id}; using local heuristic note extraction`
    );
  }

  return buildFallbackNotes(email);
}

export async function processEmailToNotes(db, emailId, options = {}) {
  const generateNotes = options.generateAtomicNotes ?? generateAtomicNotes;
  const classifyRelevance = options.classifyEmailRelevance ?? classifyEmailRelevance;
  const logger = options.logger ?? console;
  const email = getEmailById(db, emailId);
  const jobAlreadyClaimed = options.jobAlreadyClaimed === true;
  let processingJobId = Number.isInteger(options.processingJobId)
    ? options.processingJobId
    : null;

  if (!email) {
    throw new Error(`Email ${emailId} was not found`);
  }

  let relevanceStatus = trimToNull(email.relevance_status) ?? RELEVANCE_STATUS_PENDING;

  if (processingJobId === null) {
    processingJobId = Number(getEmailProcessingJobByEmailId(db, emailId)?.id ?? 0) || null;
  }

  if (processingJobId === null) {
    processingJobId = Number(queueEmailProcessingJob(db, { emailId })?.id ?? 0) || null;
  }

  if (processingJobId !== null && !jobAlreadyClaimed) {
    updateEmailProcessingJobState(db, processingJobId, { status: "processing" });
  }

  try {
    const relevanceDecision = await Promise.resolve(classifyRelevance(email));
    relevanceStatus =
      trimToNull(relevanceDecision?.relevanceStatus) ?? RELEVANCE_STATUS_RELEVANT;
    updateEmailRelevanceStatus(db, emailId, relevanceStatus);

    if (
      relevanceDecision?.shouldSkip === true ||
      IRRELEVANT_RELEVANCE_STATUSES.has(relevanceStatus)
    ) {
      updateEmailProcessingState(db, emailId, {
        status: "skipped",
        relevanceStatus,
      });

      if (processingJobId !== null) {
        updateEmailProcessingJobState(db, processingJobId, { status: "completed" });
      }

      logger.info?.(`[note-pipeline] Skipped email ${emailId} as ${relevanceStatus}`);

      return {
        emailId,
        noteCount: 0,
        skipped: true,
        relevanceStatus,
      };
    }

    updateEmailProcessingState(db, emailId, {
      status: "processing",
      relevanceStatus,
    });

    const generatedNotes = await generateNotes({
      email,
      env: options.env,
      fetchImpl: options.fetchImpl,
      logger,
    });

    if (!Array.isArray(generatedNotes) || generatedNotes.length === 0) {
      throw new Error("No atomic notes were generated");
    }

    const notes = generatedNotes.map((note, noteIndex) =>
      normalizeGeneratedNote(note, {
        sourceTimestamp: deriveSourceTimestamp(email),
        logger,
        noteIndex,
      })
    );
    const existingNotes = listNotesForComparison(db, { excludeEmailId: emailId });
    const noteComparisons = compareNewNotesToExistingNotes(notes, existingNotes);
    const duplicateCandidates = compareNewNotesToDuplicateCandidates(notes, existingNotes);

    if (noteComparisons.length > 0) {
      logger.info?.(
        `[note-pipeline] Found ${noteComparisons.length} related note matches for email ${emailId}`
      );
    }

    if (duplicateCandidates.length > 0) {
      logger.info?.(
        `[note-pipeline] Found ${duplicateCandidates.length} duplicate note candidates for email ${emailId}`
      );
    }

    await Promise.resolve(options.onComparedNotes?.(noteComparisons));
    await Promise.resolve(options.onDuplicateCandidates?.(duplicateCandidates));

    replaceNotesForEmail(db, emailId, notes, {
      detectedRelationships: noteComparisons,
      detectedDuplicateCandidates: duplicateCandidates,
    });
    updateEmailProcessingState(db, emailId, {
      status: "processed",
      relevanceStatus,
    });

    if (processingJobId !== null) {
      updateEmailProcessingJobState(db, processingJobId, { status: "completed" });
    }

    return {
      emailId,
      noteCount: notes.length,
    };
  } catch (error) {
    if (processingJobId !== null) {
      updateEmailProcessingJobState(db, processingJobId, {
        status: "failed",
        errorMessage: error.message,
      });
    }

    updateEmailProcessingState(db, emailId, {
      status: "failed",
      processingError: error.message,
      relevanceStatus,
    });
    logger.error?.(`[note-pipeline] Failed to process email ${emailId}:`, error);
    throw error;
  }
}
