import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  createSessionWorkspace,
  getSessionSummaries,
  getSessionWorkspace,
  kickSessionReconciliation,
  submitSessionAnswer,
  updateSessionDraft,
  waitForSessionReconciliation,
} from "@/lib/clarification";
import { resetDbForTests } from "@/lib/db";
import { saveSessionSnapshot } from "@/lib/store";
import { GET as exportRoute } from "@/app/api/sessions/[id]/export/route";

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
    delete process.env.PRISM_CODEX_DB_PATH;
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

  it("keeps export disabled until the session is ready", async () => {
    const workspace = await createSessionWorkspace({
      title: "Export gate",
      initialIdea: "A planning assistant.",
    });

    const response = await exportRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });

    expect(response.status).toBe(409);
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
        readiness: 93,
        structure: 100,
        ambiguity: "Low",
        warnings: 0,
        open_questions: 0,
        overall_score: 93,
        ambiguity_score: 0.07,
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
});
