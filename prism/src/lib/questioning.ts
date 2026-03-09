import { extractSections, isMeaningfulContent } from "@/lib/spec";

const SUPPORTING_SECTION_ORDER = [
  "Overview",
  "Problem",
  "Users",
  "Goals",
  "Non-Goals",
  "Constraints",
  "Success Criteria",
  "Open Questions",
  "Decisions",
] as const;

export function buildSupportingSpecContext(specContent: string): string {
  const sections = extractSections(specContent);
  const excerpts = SUPPORTING_SECTION_ORDER.flatMap((sectionName) => {
    const content = sections[sectionName];

    if (!content) {
      return [];
    }

    if (sectionName !== "Open Questions" && !isMeaningfulContent(content)) {
      return [];
    }

    return [`## ${sectionName}\n${truncateSection(content.trim(), 320)}`];
  });

  return excerpts.length > 0 ? excerpts.join("\n\n") : "No reliable spec sections are populated yet.";
}

export function isQuestionTooSimilar(candidate: string, recentQuestions: string[]): boolean {
  const candidateNormalized = normalizeQuestionText(candidate);

  if (!candidateNormalized) {
    return false;
  }

  return recentQuestions.some((question) => {
    const recentNormalized = normalizeQuestionText(question);

    if (!recentNormalized) {
      return false;
    }

    if (candidateNormalized === recentNormalized) {
      return true;
    }

    if (
      candidateNormalized.includes(recentNormalized) ||
      recentNormalized.includes(candidateNormalized)
    ) {
      return true;
    }

    return tokenSimilarity(candidateNormalized, recentNormalized) >= 0.72;
  });
}

function truncateSection(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit).trimEnd()}…`;
}

function normalizeQuestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);

  if (union.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersectionCount += 1;
    }
  }

  return intersectionCount / union.size;
}
