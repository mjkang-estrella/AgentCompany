import { parseJsonObject } from "@/lib/openai";
import { buildQuestionUserPrompt } from "@/lib/prompts";

describe("prompt contract parsing", () => {
  it("parses JSON wrapped in markdown fences", () => {
    const parsed = parseJsonObject<{ question: string }>(`
\`\`\`json
{"question":"What is the goal?"}
\`\`\`
`);

    expect(parsed.question).toBe("What is the goal?");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseJsonObject("{not-json}")).toThrow();
  });

  it("builds a transcript-first question prompt", () => {
    const prompt = buildQuestionUserPrompt({
      supportingSpecContext: "## Goals\n\n- Old spec goal",
      transcript: [
        {
          id: "q1",
          role: "assistant",
          entry_type: "question",
          content: "What should this app produce first?",
          choices: [],
          selected_choice_key: null,
          selected_choice_label: null,
          target_dimension: "goal",
          round_number: 1,
          created_at: new Date().toISOString(),
        },
        {
          id: "a1",
          role: "user",
          entry_type: "answer",
          content: "A markdown spec for engineering handoff",
          choices: [],
          selected_choice_key: null,
          selected_choice_label: null,
          target_dimension: "goal",
          round_number: 1,
          created_at: new Date().toISOString(),
        },
      ],
      metrics: {
        readiness: 20,
        structure: 20,
        ambiguity: "High",
        warnings: 0,
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
      roundNumber: 2,
      recentAssistantQuestions: ["What should this app produce first?"],
      rejectedQuestions: ["What should this app produce first?"],
    });

    expect(prompt).toContain("Treat the latest answered question and answer as the freshest source of truth");
    expect(prompt).toContain("If the supporting spec conflicts with the latest answer, trust the latest answer");
    expect(prompt).toContain("Recent assistant questions to avoid repeating");
  });
});
