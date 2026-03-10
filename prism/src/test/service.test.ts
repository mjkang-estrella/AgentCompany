import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { vi } from "vitest";
import {
  createSessionWorkspace,
  getSessionSummaries,
  getSessionWorkspace,
  kickSessionReconciliation,
  submitSessionAnswer,
  updateSessionDraft,
  waitForSessionReconciliation,
} from "@/lib/clarification";
import { getDb, resetDbForTests } from "@/lib/db";
import { saveMarketReport, saveSessionSnapshot } from "@/lib/store";
import { DELETE as sessionDeleteRoute } from "@/app/api/sessions/[id]/route";
import { GET as exportRoute } from "@/app/api/sessions/[id]/export/route";
import { POST as researchRoute } from "@/app/api/sessions/[id]/research-market/route";
import { waitForSessionMarketResearch } from "@/lib/research";

describe("clarification service", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.PRISM_CODEX_DB_PATH = path.join(os.tmpdir(), `prism-codex-${randomUUID()}.db`);
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.EXA_API_KEY;
    delete process.env.PRISM_CODEX_DB_PATH;
    vi.restoreAllMocks();
  });

  it("creates a persisted session with a pending question", async () => {
    const workspace = await createSessionWorkspace({
      title: "New idea",
      initialIdea: "A tool that clarifies vague software concepts.",
    });

    expect(workspace.session.title).toBe("New idea");
    expect(workspace.pendingQuestion).not.toBeNull();
    expect(getSessionSummaries()).toHaveLength(1);
    expect(getSessionWorkspace(workspace.session.id)?.transcript[0]?.role).toBe("assistant");
  });

  it("updates the spec and transcript after an answer", async () => {
    const workspace = await createSessionWorkspace({
      title: "New idea",
      initialIdea: "A tool that clarifies vague software concepts.",
    });

    const immediate = await submitSessionAnswer(workspace.session.id, {
      answer: "The first outcome is a markdown spec ready for engineering handoff.",
    });
    kickSessionReconciliation(workspace.session.id);
    await waitForSessionReconciliation(workspace.session.id);
    const updated = getSessionWorkspace(workspace.session.id);

    expect(immediate.transcript.some((entry) => entry.role === "user")).toBe(true);
    expect(immediate.session.reconciliation_status).toBe("pending");
    expect(updated?.session.spec_content).toContain("markdown spec ready for engineering handoff");
    expect(updated?.session.clarification_round).toBe(1);
    expect(updated?.session.reconciliation_status).toBe("idle");
  });

  it("supports manual draft updates with last-write-wins persistence", async () => {
    const workspace = await createSessionWorkspace({
      title: "Manual edit",
      initialIdea: "A planning assistant.",
    });

    const edited = updateSessionDraft(workspace.session.id, "# Manual edit\n\n## Overview\n\nEdited by user\n");

    expect(edited?.session.spec_content).toContain("Edited by user");
    expect(getSessionWorkspace(workspace.session.id)?.session.spec_content).toContain("Edited by user");
  });

  it("deletes a session and cascades related records", async () => {
    const workspace = await createSessionWorkspace({
      title: "Delete me",
      initialIdea: "A planning assistant.",
    });

    saveMarketReport(workspace.session.id, {
      status: "completed",
      markdownContent: "# Market Research",
      citations: [],
      queryPlan: [],
      specSnapshot: workspace.session.spec_content,
      generatedAt: new Date().toISOString(),
    });

    const response = await sessionDeleteRoute(new Request("http://localhost", { method: "DELETE" }), {
      params: { id: workspace.session.id },
    });
    const db = getDb();
    const transcriptCount = (
      db.prepare("SELECT COUNT(*) AS count FROM transcript_entries WHERE session_id = ?").get(workspace.session.id) as {
        count: number;
      }
    ).count;
    const marketReportCount = (
      db.prepare("SELECT COUNT(*) AS count FROM market_reports WHERE session_id = ?").get(workspace.session.id) as {
        count: number;
      }
    ).count;

    expect(response.status).toBe(200);
    expect(getSessionWorkspace(workspace.session.id)).toBeNull();
    expect(getSessionSummaries()).toHaveLength(0);
    expect(transcriptCount).toBe(0);
    expect(marketReportCount).toBe(0);
  });

  it("keeps export disabled until score and ambiguity meet the readiness threshold", async () => {
    const workspace = await createSessionWorkspace({
      title: "Export gate",
      initialIdea: "A planning assistant.",
    });

    const response = await exportRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });

    expect(response.status).toBe(409);
  });

  it("rejects market research below the clarity threshold", async () => {
    const workspace = await createSessionWorkspace({
      title: "Research gate",
      initialIdea: "A planning assistant.",
    });

    const response = await researchRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });

    expect(response.status).toBe(409);
  });

  it("rejects market research when EXA is not configured", async () => {
    const workspace = await createSessionWorkspace({
      title: "Research missing key",
      initialIdea: "A planning assistant.",
    });

    saveSessionSnapshot(workspace.session.id, {
      specContent: workspace.session.spec_content,
      clarificationRound: workspace.session.clarification_round,
      metrics: {
        ...workspace.metrics,
        readiness: 82,
        structure: 80,
        overall_score: 82,
      },
      pendingQuestion: workspace.pendingQuestion,
    });

    const response = await researchRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });

    expect(response.status).toBe(503);
  });

  it("exports the source spec, agent handoff, and execution prompt in one markdown bundle", async () => {
    const workspace = await createSessionWorkspace({
      title: "Export pack",
      initialIdea: "A planning assistant for engineering teams.",
    });

    saveSessionSnapshot(workspace.session.id, {
      specContent: `# Export pack

## Overview

A planning assistant for engineering teams.

## Problem

Teams lose momentum when project requirements stay vague.

## Users

Engineering managers and ICs.

## Goals

- Turn vague requests into implementation-ready tasks
- Keep the handoff short and actionable

## Non-Goals

- Full project management

## Constraints

- Keep the workflow lightweight
- Preserve existing team processes

## Success Criteria

- A team can export a task brief that is implementation-ready
- The output is clear enough for engineering handoff

## Open Questions

- None.

## Decisions

- Export should include both a human-readable handoff and an execution prompt
`,
      clarificationRound: 3,
      metrics: {
        ...workspace.metrics,
        readiness: 84,
        structure: 100,
        ambiguity: "Low",
        warnings: 2,
        open_questions: 4,
        overall_score: 84,
        ambiguity_score: 0.16,
      },
      pendingQuestion: null,
    });

    const response = await exportRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="export-pack.md"');
    expect(body).toContain("# Export pack");
    expect(body).toContain("# Agent Handoff");
    expect(body).toContain("## Acceptance Criteria");
    expect(body).toContain("# Codex / Claude Code Prompt");
    expect(body).toContain("Implement the project described below.");
    expect(body).toContain("Execution requirements:");
  });

  it("stores a single latest market research report without mutating the spec", async () => {
    process.env.EXA_API_KEY = "exa-test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Reflective voice journaling startups",
                url: "https://example.com/voice-journaling",
                publishedDate: "2026-02-01",
                text: "Founders use voice journaling tools to capture reflections, extract actions, and build accountability loops.",
              },
              {
                title: "Audio note apps for founders",
                url: "https://example.com/audio-notes-founders",
                publishedDate: "2026-01-15",
                text: "Competing products emphasize searchable transcripts, action extraction, and lightweight mobile capture.",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    const workspace = await createSessionWorkspace({
      title: "Voice research",
      initialIdea: "Voice journaling app for founders.",
    });

    saveSessionSnapshot(workspace.session.id, {
      specContent: workspace.session.spec_content,
      clarificationRound: workspace.session.clarification_round,
      metrics: {
        ...workspace.metrics,
        readiness: 84,
        structure: 80,
        overall_score: 84,
      },
      pendingQuestion: workspace.pendingQuestion,
    });

    const response = await researchRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });
    await waitForSessionMarketResearch(workspace.session.id);
    const updated = getSessionWorkspace(workspace.session.id);

    expect(response.status).toBe(200);
    expect(updated?.marketReport?.status).toBe("completed");
    expect(updated?.marketReport?.markdown_content).toContain("# Market Research");
    expect(updated?.marketReport?.markdown_content).toContain("## Sources");
    expect(updated?.session.spec_content).toBe(workspace.session.spec_content);
  });
});
