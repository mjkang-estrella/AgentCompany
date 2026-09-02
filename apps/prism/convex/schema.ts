import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  ambiguityLabel,
  marketReportCitation,
  marketReportStatus,
  marketResearchQuery,
  pendingQuestionDimension,
  reconciliationStatus,
  suggestedChoice,
  transcriptEntryType,
  transcriptRole,
} from "./validators";

export default defineSchema({
  prismSessions: defineTable({
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
  })
    .index("by_external_id", ["id"])
    .index("by_updated_at_and_created_at", ["updated_at", "created_at"]),

  prismTranscriptEntries: defineTable({
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
  })
    .index("by_external_id", ["id"])
    .index("by_session_id_and_round_number_and_created_at", [
      "session_id",
      "round_number",
      "created_at",
    ]),

  prismMarketReports: defineTable({
    session_id: v.string(),
    status: marketReportStatus,
    markdown_content: v.string(),
    citations_json: v.array(marketReportCitation),
    query_plan_json: v.array(marketResearchQuery),
    spec_snapshot: v.string(),
    generated_at: v.union(v.string(), v.null()),
    updated_at: v.string(),
    error_message: v.union(v.string(), v.null()),
  })
    .index("by_session_id", ["session_id"])
    .index("by_updated_at", ["updated_at"]),
});
