// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import SpecEditor from "@/components/SpecEditor";
import type { WorkspacePayload } from "@/types/workspace";

function buildWorkspace(overrides: Partial<WorkspacePayload> = {}): WorkspacePayload {
  return {
    session: {
      id: "session-1",
      title: "Prism",
      initial_idea: "A clarification tool",
      spec_content: "# Prism\n\n## Overview\n\nA clarification tool",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      clarification_round: 4,
      is_ready: false,
      reconciliation_status: "idle",
      reconciled_round: 4,
      metrics: {
        readiness: 84,
        structure: 80,
        ambiguity: "Low",
        warnings: 0,
        open_questions: 1,
        overall_score: 84,
        ambiguity_score: 0.16,
        goal_clarity: 0.8,
        constraint_clarity: 0.78,
        success_criteria_clarity: 0.75,
        goal_justification: "",
        constraint_justification: "",
        success_criteria_justification: "",
      },
      pending_question: null,
    },
    transcript: [],
    pendingQuestion: null,
    metrics: {
      readiness: 84,
      structure: 80,
      ambiguity: "Low",
      warnings: 0,
      open_questions: 1,
      overall_score: 84,
      ambiguity_score: 0.16,
      goal_clarity: 0.8,
      constraint_clarity: 0.78,
      success_criteria_clarity: 0.75,
      goal_justification: "",
      constraint_justification: "",
      success_criteria_justification: "",
    },
    marketReport: null,
    researchConfigured: true,
    ...overrides,
  };
}

describe("SpecEditor", () => {
  it("gates and displays market research separately from the spec", async () => {
    const user = userEvent.setup();
    const workspace = buildWorkspace({
      marketReport: {
        status: "completed",
        markdown_content: "# Market Research\n\n## Market Thesis\n\nFounders use these tools for accountability.",
        citations: [],
        query_plan: [],
        spec_snapshot: "# Prism",
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: null,
      },
    });
    const onRunResearch = vi.fn();
    const onDownloadResearch = vi.fn();

    render(
      <SpecEditor
        workspace={workspace}
        isSaving={false}
        isLocked={false}
        isResearchStarting={false}
        onSaveDraft={async () => {}}
        onExport={async () => {}}
        onRunResearch={onRunResearch}
        onDownloadResearch={onDownloadResearch}
      />
    );

    expect(screen.getByRole("button", { name: "Refresh Research" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Market Research" }));
    expect(screen.getByText("Research report is read-only.")).toBeInTheDocument();
    expect(screen.getByText("Founders use these tools for accountability.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download Research" }));
    expect(onDownloadResearch).toHaveBeenCalledTimes(1);
  });

  it("keeps market research disabled below the threshold", () => {
    const base = buildWorkspace();
    const workspace = buildWorkspace({
      metrics: {
        ...base.metrics,
        overall_score: 79,
      },
      session: {
        ...base.session,
        metrics: {
          ...base.session.metrics,
          overall_score: 79,
        },
      },
      researchConfigured: true,
    });

    render(
      <SpecEditor
        workspace={workspace}
        isSaving={false}
        isLocked={false}
        isResearchStarting={false}
        onSaveDraft={async () => {}}
        onExport={async () => {}}
        onRunResearch={async () => {}}
        onDownloadResearch={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Research Market" })).toBeDisabled();
  });
});
