import { v } from "convex/values";

export const ambiguityLabel = v.union(
  v.literal("Low"),
  v.literal("Medium"),
  v.literal("High"),
);

export const reconciliationStatus = v.union(
  v.literal("idle"),
  v.literal("pending"),
  v.literal("running"),
);

export const transcriptRole = v.union(
  v.literal("assistant"),
  v.literal("user"),
);

export const transcriptEntryType = v.union(
  v.literal("question"),
  v.literal("answer"),
);

export const pendingQuestionDimension = v.union(
  v.literal("goal"),
  v.literal("constraints"),
  v.literal("success_criteria"),
  v.literal("context"),
);

export const marketReportStatus = v.union(
  v.literal("idle"),
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

export const suggestedChoice = v.object({
  key: v.string(),
  label: v.string(),
});

export const marketReportCitation = v.object({
  title: v.string(),
  url: v.string(),
  domain: v.string(),
  published_date: v.union(v.string(), v.null()),
});

export const marketResearchQuery = v.object({
  label: v.string(),
  query: v.string(),
});

export const clarificationMetrics = v.object({
  readiness: v.number(),
  structure: v.number(),
  ambiguity: ambiguityLabel,
  warnings: v.number(),
  open_questions: v.number(),
  overall_score: v.number(),
  ambiguity_score: v.number(),
  goal_clarity: v.number(),
  constraint_clarity: v.number(),
  success_criteria_clarity: v.number(),
  goal_justification: v.string(),
  constraint_justification: v.string(),
  success_criteria_justification: v.string(),
});

export const pendingQuestion = v.object({
  question: v.string(),
  suggested_choices: v.array(suggestedChoice),
  target_dimension: pendingQuestionDimension,
  round_number: v.number(),
});

export const sessionRow = v.object({
  id: v.string(),
  title: v.string(),
  initial_idea: v.string(),
  spec_content: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
  clarification_round: v.number(),
  readiness: v.number(),
  structure_score: v.number(),
  ambiguity_label: ambiguityLabel,
  warnings_count: v.number(),
  open_questions_count: v.number(),
  overall_score: v.number(),
  ambiguity_score: v.number(),
  goal_clarity: v.number(),
  constraint_clarity: v.number(),
  success_criteria_clarity: v.number(),
  goal_justification: v.string(),
  constraint_justification: v.string(),
  success_criteria_justification: v.string(),
  is_ready: v.boolean(),
  pending_question_text: v.union(v.string(), v.null()),
  pending_question_choices: v.union(v.array(suggestedChoice), v.null()),
  pending_question_dimension: v.union(pendingQuestionDimension, v.null()),
  pending_question_round: v.union(v.number(), v.null()),
  reconciliation_status: reconciliationStatus,
  reconciled_round: v.number(),
});

export const sessionSummary = v.object({
  id: v.string(),
  title: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
  overall_score: v.number(),
  ambiguity: ambiguityLabel,
  is_ready: v.boolean(),
  reconciliation_status: reconciliationStatus,
});

export const transcriptRow = v.object({
  id: v.string(),
  session_id: v.string(),
  role: transcriptRole,
  entry_type: transcriptEntryType,
  content: v.string(),
  choices: v.union(v.array(suggestedChoice), v.null()),
  selected_choice_key: v.union(v.string(), v.null()),
  selected_choice_label: v.union(v.string(), v.null()),
  target_dimension: v.union(pendingQuestionDimension, v.null()),
  round_number: v.number(),
  created_at: v.string(),
});

export const marketReportRow = v.object({
  session_id: v.string(),
  status: marketReportStatus,
  markdown_content: v.string(),
  citations_json: v.array(marketReportCitation),
  query_plan_json: v.array(marketResearchQuery),
  spec_snapshot: v.string(),
  generated_at: v.union(v.string(), v.null()),
  updated_at: v.string(),
  error_message: v.union(v.string(), v.null()),
});
