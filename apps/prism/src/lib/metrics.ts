import type { AmbiguityLabel, ClarificationMetrics } from "@/types/workspace";
import {
  collectPlaceholderWarnings,
  computeStructureScore,
  extractOpenQuestionItems,
} from "@/lib/spec";

export const AMBIGUITY_THRESHOLD = 0.2;
export const GOAL_CLARITY_WEIGHT = 0.4;
export const CONSTRAINT_CLARITY_WEIGHT = 0.3;
export const SUCCESS_CRITERIA_CLARITY_WEIGHT = 0.3;
export const BROWNFIELD_GOAL_CLARITY_WEIGHT = 0.35;
export const BROWNFIELD_CONSTRAINT_CLARITY_WEIGHT = 0.25;
export const BROWNFIELD_SUCCESS_CRITERIA_CLARITY_WEIGHT = 0.25;
export const BROWNFIELD_CONTEXT_CLARITY_WEIGHT = 0.15;

interface MetricsInput {
  specContent: string;
  ambiguityScore: number;
  goalClarity: number;
  constraintClarity: number;
  successCriteriaClarity: number;
  goalJustification: string;
  constraintJustification: string;
  successCriteriaJustification: string;
  modelWarnings?: string[];
  modelOpenQuestions?: string[];
  hasPendingQuestion: boolean;
}

export function calculateOverallAmbiguity(input: {
  goalClarity: number;
  constraintClarity: number;
  successCriteriaClarity: number;
  contextClarity?: number;
  isBrownfield?: boolean;
}): number {
  const weightedClarity = input.isBrownfield
    ? input.goalClarity * BROWNFIELD_GOAL_CLARITY_WEIGHT +
      input.constraintClarity * BROWNFIELD_CONSTRAINT_CLARITY_WEIGHT +
      input.successCriteriaClarity * BROWNFIELD_SUCCESS_CRITERIA_CLARITY_WEIGHT +
      (input.contextClarity ?? 0) * BROWNFIELD_CONTEXT_CLARITY_WEIGHT
    : input.goalClarity * GOAL_CLARITY_WEIGHT +
      input.constraintClarity * CONSTRAINT_CLARITY_WEIGHT +
      input.successCriteriaClarity * SUCCESS_CRITERIA_CLARITY_WEIGHT;

  return Number((1 - weightedClarity).toFixed(4));
}

export function getAmbiguityLabel(ambiguityScore: number): AmbiguityLabel {
  if (ambiguityScore <= AMBIGUITY_THRESHOLD) {
    return "Low";
  }

  if (ambiguityScore <= 0.45) {
    return "Medium";
  }

  return "High";
}

export function computeOverallScore(ambiguityScore: number, ambiguityLabel: AmbiguityLabel, openQuestions: number): number {
  const rawScore = Math.round((1 - ambiguityScore) * 100);
  if (openQuestions > 0 || ambiguityLabel !== "Low") {
    return Math.min(rawScore, 89);
  }
  return rawScore;
}

export function buildClarificationMetrics(input: MetricsInput): ClarificationMetrics {
  const structure = computeStructureScore(input.specContent);
  const ambiguity = getAmbiguityLabel(input.ambiguityScore);
  const placeholderWarnings = collectPlaceholderWarnings(input.specContent);
  const specOpenQuestions = extractOpenQuestionItems(input.specContent);
  const modelWarnings = input.modelWarnings ?? [];
  const modelOpenQuestions = input.modelOpenQuestions ?? [];
  const openQuestions = Math.max(
    specOpenQuestions.length,
    modelOpenQuestions.length,
    input.hasPendingQuestion ? 1 : 0
  );
  const overallScore = computeOverallScore(input.ambiguityScore, ambiguity, openQuestions);

  return {
    readiness: overallScore,
    structure,
    ambiguity,
    warnings: placeholderWarnings.length + modelWarnings.length,
    open_questions: openQuestions,
    overall_score: overallScore,
    ambiguity_score: input.ambiguityScore,
    goal_clarity: input.goalClarity,
    constraint_clarity: input.constraintClarity,
    success_criteria_clarity: input.successCriteriaClarity,
    goal_justification: input.goalJustification,
    constraint_justification: input.constraintJustification,
    success_criteria_justification: input.successCriteriaJustification,
  };
}
