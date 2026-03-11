import { buildClarificationMetrics, calculateOverallAmbiguity, computeOverallScore, getAmbiguityLabel } from "@/lib/metrics";
import { buildInitialSpec, computeStructureScore } from "@/lib/spec";

describe("metrics", () => {
  it("preserves the Ouroboros ambiguity formula", () => {
    const score = calculateOverallAmbiguity({
      goalClarity: 0.9,
      constraintClarity: 0.5,
      successCriteriaClarity: 0.8,
    });

    expect(score).toBe(0.25);
  });

  it("maps ambiguity labels using the configured thresholds", () => {
    expect(getAmbiguityLabel(0.19)).toBe("Low");
    expect(getAmbiguityLabel(0.2)).toBe("Low");
    expect(getAmbiguityLabel(0.3)).toBe("Medium");
    expect(getAmbiguityLabel(0.5)).toBe("High");
  });

  it("caps the overall score below readiness while ambiguity remains", () => {
    expect(computeOverallScore(0.08, "Low", 1)).toBe(89);
    expect(computeOverallScore(0.08, "Medium", 0)).toBe(89);
    expect(computeOverallScore(0.08, "Low", 0)).toBe(92);
  });

  it("computes structure deterministically from the canonical sections", () => {
    const spec = buildInitialSpec("Prism", "Clarify product ideas");
    expect(computeStructureScore(spec)).toBe(11);
  });

  it("derives UI metrics from ambiguity and unresolved state", () => {
    const metrics = buildClarificationMetrics({
      specContent: buildInitialSpec("Prism", "Clarify product ideas"),
      ambiguityScore: 0.16,
      goalClarity: 0.84,
      constraintClarity: 0.85,
      successCriteriaClarity: 0.83,
      goalJustification: "Clear goal.",
      constraintJustification: "Clear constraints.",
      successCriteriaJustification: "Clear success criteria.",
      modelWarnings: [],
      modelOpenQuestions: [],
      hasPendingQuestion: false,
    });

    expect(metrics.ambiguity).toBe("Low");
    expect(metrics.readiness).toBe(84);
    expect(metrics.open_questions).toBe(0);
  });
});
