const SPEC_SECTIONS = [
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

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^_?no description provided yet\._?$/i,
  /^_?to be defined through clarification\._?$/i,
  /^_?clarification in progress\._?$/i,
  /^_?tbd\._?$/i,
  /^_?todo\._?$/i,
  /^_?pending\._?$/i,
];

export type SpecSection = (typeof SPEC_SECTIONS)[number];
export type SectionMap = Record<SpecSection, string>;

export const CANONICAL_SECTIONS = [...SPEC_SECTIONS];

export function buildInitialSpec(title: string, initialIdea = ""): string {
  const sections: SectionMap = {
    Overview: initialIdea.trim() || "_No description provided yet._",
    Problem: "_To be defined through clarification._",
    Users: "_To be defined through clarification._",
    Goals: "_To be defined through clarification._",
    "Non-Goals": "_To be defined through clarification._",
    Constraints: "_To be defined through clarification._",
    "Success Criteria": "_To be defined through clarification._",
    "Open Questions": "_Clarification in progress._",
    Decisions: "_To be defined through clarification._",
  };

  return serializeSpec(title, sections);
}

export function serializeSpec(title: string, sections: SectionMap): string {
  const parts = [`# ${title.trim()}`];

  for (const section of CANONICAL_SECTIONS) {
    parts.push(`\n## ${section}\n`);
    parts.push((sections[section] || "").trim() || "_To be defined through clarification._");
  }

  return `${parts.join("\n").trim()}\n`;
}

export function extractSections(specContent: string): SectionMap {
  const sections: Partial<SectionMap> = {};
  const matches = [...specContent.matchAll(/^##\s+(.+)$/gm)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = normalizeSectionName(match[1]);

    if (!title) {
      continue;
    }

    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? specContent.length : specContent.length;
    const body = specContent.slice(start, end).trim();
    sections[title] = body;
  }

  return CANONICAL_SECTIONS.reduce((acc, section) => {
    acc[section] = sections[section] || "";
    return acc;
  }, {} as SectionMap);
}

export function normalizeSectionName(value: string): SpecSection | null {
  const normalized = value.trim().toLowerCase();
  return (
    CANONICAL_SECTIONS.find((section) => section.toLowerCase() === normalized) ?? null
  );
}

export function isPlaceholderContent(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return true;
  }

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMeaningfulContent(value: string): boolean {
  const normalized = value.trim();
  return !isPlaceholderContent(normalized) && /[A-Za-z0-9]/.test(normalized);
}

export function computeStructureScore(specContent: string): number {
  const sections = extractSections(specContent);
  const filled = CANONICAL_SECTIONS.filter((section) => isMeaningfulContent(sections[section])).length;
  return Math.round((filled / CANONICAL_SECTIONS.length) * 100);
}

export function collectPlaceholderWarnings(specContent: string): string[] {
  const sections = extractSections(specContent);
  return CANONICAL_SECTIONS.filter((section) => !isMeaningfulContent(sections[section])).map(
    (section) => `${section} is still unresolved.`
  );
}

export function extractOpenQuestionItems(specContent: string): string[] {
  const sections = extractSections(specContent);
  const openQuestions = sections["Open Questions"];

  if (!isMeaningfulContent(openQuestions)) {
    return [];
  }

  const items = openQuestions
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(
      (line) =>
        line &&
        !isPlaceholderContent(line) &&
        !/no critical open questions remain/i.test(line) &&
        !/no open questions remain/i.test(line)
    );

  return items.length > 0 ? items : [openQuestions.trim()];
}

export function updateSection(specContent: string, section: SpecSection, nextBody: string): string {
  const title = extractTitle(specContent);
  const sections = extractSections(specContent);
  sections[section] = nextBody.trim();
  return serializeSpec(title, sections);
}

export function extractTitle(specContent: string): string {
  const match = specContent.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || "Untitled Session";
}

export function appendBullet(existing: string, bullet: string): string {
  const normalizedBullet = bullet.trim().replace(/\.$/, "");
  const lines = existing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isPlaceholderContent(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());

  if (!lines.includes(normalizedBullet)) {
    lines.push(normalizedBullet);
  }

  return lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "_To be defined through clarification._";
}
