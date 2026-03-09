import { dedupeCitations, hasExaKey, searchExa, type ExaSearchHit } from "@/lib/exa";
import { requestStructuredJson, hasStructuredJsonProvider } from "@/lib/openai";
import {
  buildResearchQueryPlanSystemPrompt,
  buildResearchQueryPlanUserPrompt,
  buildResearchSynthesisSystemPrompt,
  buildResearchSynthesisUserPrompt,
  marketResearchSynthesisSchema,
  researchQueryPlanSchema,
} from "@/lib/prompts";
import { extractOpenQuestionItems, extractSections, isMeaningfulContent } from "@/lib/spec";
import { getWorkspace, saveMarketReport } from "@/lib/store";
import type {
  MarketReportPayload,
  MarketResearchQuery,
  WorkspacePayload,
} from "@/types/workspace";

const MARKET_RESEARCH_THRESHOLD = 80;
const activeResearchTasks = new Map<string, Promise<void>>();

interface QueryPlanResponse {
  queries: MarketResearchQuery[];
}

interface ResearchSynthesisResponse {
  report_markdown: string;
}

export function marketResearchThresholdMet(workspace: WorkspacePayload): boolean {
  return workspace.metrics.overall_score >= MARKET_RESEARCH_THRESHOLD;
}

export function kickSessionMarketResearch(sessionId: string): void {
  if (activeResearchTasks.has(sessionId)) {
    return;
  }

  const task = runSessionMarketResearch(sessionId)
    .catch((error) => {
      console.error("[Prism] market research failed.", error);
    })
    .finally(() => {
      activeResearchTasks.delete(sessionId);
    });

  activeResearchTasks.set(sessionId, task);
}

export async function waitForSessionMarketResearch(sessionId: string): Promise<void> {
  await activeResearchTasks.get(sessionId);
}

export function startSessionMarketResearch(sessionId: string): WorkspacePayload {
  const workspace = getWorkspace(sessionId);
  if (!workspace) {
    throw new Error("Session not found.");
  }

  if (!marketResearchThresholdMet(workspace)) {
    throw new Error("Market research unlocks at 80% clarification score.");
  }

  if (!hasExaKey()) {
    throw new Error("EXA_API_KEY is not configured.");
  }

  if (workspace.marketReport && ["pending", "running"].includes(workspace.marketReport.status)) {
    return workspace;
  }

  saveMarketReport(sessionId, {
    status: "pending",
    markdownContent: "",
    citations: [],
    queryPlan: [],
    specSnapshot: workspace.session.spec_content,
    generatedAt: null,
    errorMessage: null,
  });

  kickSessionMarketResearch(sessionId);

  const updated = getWorkspace(sessionId);
  if (!updated) {
    throw new Error("Failed to load updated workspace.");
  }

  return updated;
}

async function runSessionMarketResearch(sessionId: string): Promise<void> {
  const workspace = getWorkspace(sessionId);
  if (!workspace || !workspace.marketReport) {
    return;
  }

  const currentReport = workspace.marketReport;
  if (!["pending", "running"].includes(currentReport.status)) {
    return;
  }

  const specSnapshot = currentReport.spec_snapshot || workspace.session.spec_content;

  saveMarketReport(sessionId, {
    status: "running",
    markdownContent: "",
    citations: [],
    queryPlan: currentReport.query_plan,
    specSnapshot,
    generatedAt: currentReport.generated_at,
    errorMessage: null,
  });

  let queryPlan: MarketResearchQuery[] = [];

  try {
    queryPlan = await buildResearchQueryPlan(workspace, specSnapshot);
    const hits = await executeResearchPlan(queryPlan);
    const citations = dedupeCitations(hits);
    const reportMarkdown = await synthesizeMarketReport(workspace, specSnapshot, queryPlan, hits, citations);
    const generatedAt = new Date().toISOString();

    saveMarketReport(sessionId, {
      status: "completed",
      markdownContent: reportMarkdown,
      citations,
      queryPlan,
      specSnapshot,
      generatedAt,
      errorMessage: null,
    });
  } catch (error) {
    saveMarketReport(sessionId, {
      status: "failed",
      markdownContent: "",
      citations: [],
      queryPlan,
      specSnapshot,
      generatedAt: null,
      errorMessage: error instanceof Error ? error.message : "Market research failed.",
    });
  }
}

async function buildResearchQueryPlan(
  workspace: WorkspacePayload,
  specSnapshot: string
): Promise<MarketResearchQuery[]> {
  const transcriptSummary = workspace.transcript
    .slice(-8)
    .map((entry) => `${entry.role === "assistant" ? "Q" : "A"}: ${entry.content}`)
    .join("\n");

  if (hasStructuredJsonProvider()) {
    try {
      const response = await requestStructuredJson<QueryPlanResponse>({
        task: "question_generation",
        schemaName: "market_research_query_plan",
        schema: researchQueryPlanSchema as Record<string, unknown>,
        systemPrompt: buildResearchQueryPlanSystemPrompt(),
        messages: [
          {
            role: "user",
            content: buildResearchQueryPlanUserPrompt({
              title: workspace.session.title,
              specContent: specSnapshot,
              transcriptSummary,
            }),
          },
        ],
      });

      const normalized = normalizeQueryPlan(response.queries);
      if (normalized.length === 4) {
        return normalized;
      }
    } catch (error) {
      console.error("[Prism] market research query planning failed, using fallback plan.", error);
    }
  }

  return fallbackResearchQueryPlan(workspace.session.title, specSnapshot);
}

async function executeResearchPlan(queryPlan: MarketResearchQuery[]): Promise<ExaSearchHit[]> {
  const resultSets = await Promise.all(queryPlan.map((item) => searchExa(item.query, 5)));
  const seen = new Set<string>();

  return resultSets
    .flat()
    .filter((hit) => {
      if (seen.has(hit.url)) {
        return false;
      }
      seen.add(hit.url);
      return true;
    })
    .slice(0, 12);
}

async function synthesizeMarketReport(
  workspace: WorkspacePayload,
  specSnapshot: string,
  queryPlan: MarketResearchQuery[],
  hits: ExaSearchHit[],
  citations: MarketReportPayload["citations"]
): Promise<string> {
  if (hits.length === 0) {
    throw new Error("No market research results were returned from Exa.");
  }

  if (hasStructuredJsonProvider()) {
    try {
      const response = await requestStructuredJson<ResearchSynthesisResponse>({
        task: "spec_rewrite",
        schemaName: "market_research_report",
        schema: marketResearchSynthesisSchema as Record<string, unknown>,
        systemPrompt: buildResearchSynthesisSystemPrompt(),
        messages: [
          {
            role: "user",
            content: buildResearchSynthesisUserPrompt({
              title: workspace.session.title,
              specContent: specSnapshot,
              queryPlan,
              searchResults: hits,
            }),
          },
        ],
      });

      return appendSourcesSection(response.report_markdown.trim(), citations);
    } catch (error) {
      console.error("[Prism] market research synthesis failed, using fallback report.", error);
    }
  }

  return appendSourcesSection(fallbackMarketResearchReport(workspace.session.title, specSnapshot, hits), citations);
}

function fallbackResearchQueryPlan(title: string, specSnapshot: string): MarketResearchQuery[] {
  const sections = extractSections(specSnapshot);
  const overview = firstMeaningfulLine(sections.Overview) || title;
  const problem = firstMeaningfulLine(sections.Problem) || overview;
  const users = firstMeaningfulLine(sections.Users) || "target users";

  return [
    { label: "category", query: `${overview} software market competitors` },
    { label: "user-pain", query: `${users} workflow pain ${problem}` },
    { label: "competitors", query: `${overview} alternatives competitors` },
    { label: "patterns", query: `${overview} product patterns positioning` },
  ];
}

function fallbackMarketResearchReport(title: string, specSnapshot: string, hits: ExaSearchHit[]): string {
  const sections = extractSections(specSnapshot);
  const topDomains = Array.from(new Set(hits.map((hit) => hit.domain))).slice(0, 6);
  const topFindings = hits.slice(0, 5).map((hit) => `- ${hit.title} (${hit.domain}): ${hit.excerpt || "Relevant market signal."}`);
  const openQuestions = extractOpenQuestionItems(specSnapshot);

  return [
    "# Market Research",
    "",
    "## Session Snapshot",
    `- Project: ${title}`,
    `- Overview: ${firstMeaningfulLine(sections.Overview) || "Not yet specified."}`,
    `- Users: ${firstMeaningfulLine(sections.Users) || "Not yet specified."}`,
    "",
    "## Market Thesis",
    `The current idea appears to sit in a market adjacent to ${topDomains.join(", ") || "existing workflow and productivity"} patterns. Use the evidence below to validate whether the differentiation is workflow-specific, audience-specific, or distribution-specific.`,
    "",
    "## User Pain Patterns",
    ensureBulletList(topFindings.slice(0, 3)),
    "",
    "## Competitor Landscape",
    ensureBulletList(hits.slice(0, 6).map((hit) => `${hit.title} (${hit.domain})`)),
    "",
    "## Common Product Patterns",
    ensureBulletList([
      "Tools in this category often package workflow automation, summaries, and collaboration into a single loop.",
      "Positioning tends to win when the product is specific about audience and problem moment rather than broad platform claims.",
    ]),
    "",
    "## Positioning Opportunities",
    ensureBulletList([
      "Sharpen the audience and job-to-be-done more than the category incumbents.",
      "Make the output artifact or workflow outcome explicit instead of leading with generic AI language.",
    ]),
    "",
    "## Product Suggestions For This Idea",
    ensureBulletList([
      "Turn repeated open questions into explicit product decisions before broadening scope.",
      "Use the strongest external pattern only as evidence, not as default product direction.",
    ]),
    "",
    "## Risks / Unknowns",
    ensureBulletList(
      openQuestions.length > 0
        ? openQuestions
        : ["Differentiation may still be too broad without a sharper workflow or audience wedge."]
    ),
  ].join("\n");
}

function appendSourcesSection(
  reportMarkdown: string,
  citations: MarketReportPayload["citations"]
): string {
  const sourceLines =
    citations.length > 0
      ? citations.map(
          (citation) =>
            `- [${citation.title}](${citation.url})${citation.domain ? ` — ${citation.domain}` : ""}${citation.published_date ? ` (${citation.published_date})` : ""}`
        )
      : ["- No sources captured."];

  return `${reportMarkdown.trim()}\n\n## Sources\n${sourceLines.join("\n")}\n`;
}

function normalizeQueryPlan(raw: MarketResearchQuery[] | undefined): MarketResearchQuery[] {
  const seen = new Set<string>();

  return (Array.isArray(raw) ? raw : [])
    .map((item, index) => ({
      label: item?.label?.trim() || `query-${index + 1}`,
      query: item?.query?.trim() || "",
    }))
    .filter((item) => {
      if (!item.query || seen.has(item.query)) {
        return false;
      }
      seen.add(item.query);
      return true;
    })
    .slice(0, 4);
}

function ensureBulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function firstMeaningfulLine(value: string): string {
  if (!isMeaningfulContent(value)) {
    return "";
  }

  return value
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .find(Boolean) || "";
}
