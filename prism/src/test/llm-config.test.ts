import { getStructuredJsonProviderPlan } from "@/lib/openai";

describe("llm provider plan", () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it("prefers Claude Opus with GPT-5.4 fallback when both keys exist", () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";

    const plan = getStructuredJsonProviderPlan("question_generation");

    expect(plan).toEqual([
      {
        provider: "anthropic",
        model: "claude-opus-4-6",
        temperature: 0.7,
        maxTokens: 2048,
      },
      {
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
      },
    ]);
  });

  it("uses Claude Sonnet for scoring and spec rewrite when Anthropic is available", () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";

    const scoringPlan = getStructuredJsonProviderPlan("ambiguity_scoring");
    const rewritePlan = getStructuredJsonProviderPlan("spec_rewrite");

    expect(scoringPlan[0]).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      temperature: 0.1,
      maxTokens: 2048,
    });

    expect(rewritePlan[0]).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      temperature: 0.2,
      maxTokens: 2048,
    });
  });

  it("uses GPT-5.4 only as fallback when Claude is unavailable", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "openai-test-key";

    const plan = getStructuredJsonProviderPlan("ambiguity_scoring");

    expect(plan).toEqual([
      {
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "low",
      },
    ]);
  });
});
