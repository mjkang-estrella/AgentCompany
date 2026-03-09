import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClarificationPanel from "@/components/ClarificationPanel";
import type { AnswerPayload, WorkspacePayload } from "@/types/workspace";

function buildWorkspace(): WorkspacePayload {
  return {
    session: {
      id: "session-1",
      title: "Prism",
      initial_idea: "A clarification tool",
      spec_content: "# Prism",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      clarification_round: 0,
      is_ready: false,
      reconciliation_status: "idle",
      reconciled_round: 0,
      metrics: {
        readiness: 20,
        structure: 20,
        ambiguity: "High",
        warnings: 2,
        open_questions: 1,
        overall_score: 20,
        ambiguity_score: 0.8,
        goal_clarity: 0.3,
        constraint_clarity: 0.2,
        success_criteria_clarity: 0.1,
        goal_justification: "",
        constraint_justification: "",
        success_criteria_justification: "",
      },
      pending_question: {
        question: "What should this app produce first?",
        target_dimension: "goal",
        round_number: 1,
        suggested_choices: [
          { key: "spec", label: "A markdown spec" },
          { key: "prototype", label: "A clickable prototype" },
        ],
      },
    },
    transcript: [
      {
        id: "q1",
        role: "assistant",
        entry_type: "question",
        content: "What should this app produce first?",
        choices: [
          { key: "spec", label: "A markdown spec" },
          { key: "prototype", label: "A clickable prototype" },
        ],
        selected_choice_key: null,
        selected_choice_label: null,
        target_dimension: "goal",
        round_number: 1,
        created_at: new Date().toISOString(),
      },
    ],
    pendingQuestion: {
      question: "What should this app produce first?",
      target_dimension: "goal",
      round_number: 1,
      suggested_choices: [
        { key: "spec", label: "A markdown spec" },
        { key: "prototype", label: "A clickable prototype" },
      ],
    },
    metrics: {
      readiness: 20,
      structure: 20,
      ambiguity: "High",
      warnings: 2,
      open_questions: 1,
      overall_score: 20,
      ambiguity_score: 0.8,
      goal_clarity: 0.3,
      constraint_clarity: 0.2,
      success_criteria_clarity: 0.1,
      goal_justification: "",
      constraint_justification: "",
      success_criteria_justification: "",
    },
    marketReport: null,
    researchConfigured: false,
  };
}

describe("ClarificationPanel", () => {
  it("submits both suggested choices and free-text answers", async () => {
    const user = userEvent.setup();
    const submissions: AnswerPayload[] = [];

    render(
      <ClarificationPanel
        workspace={buildWorkspace()}
        isLocked={false}
        isThinking={false}
        optimisticAnswer={null}
        errorMessage=""
        onSubmitAnswer={async (payload) => {
          submissions.push(payload);
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: /A markdown spec/i }));
    await user.type(screen.getByPlaceholderText("Type your own answer"), "A concise exportable project brief");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(submissions[0]).toMatchObject({
      answer: "A markdown spec",
      selectedChoiceKey: "spec",
    });
    expect(submissions[1]).toMatchObject({
      answer: "A concise exportable project brief",
    });
  });
});
