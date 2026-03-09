export type TranscriptRole = "assistant" | "user";
export type TranscriptEntryType = "question" | "answer";
export type PendingQuestionDimension =
  | "goal"
  | "constraints"
  | "success_criteria"
  | "context";

export type AmbiguityLabel = "Low" | "Medium" | "High";
export type ReconciliationStatus = "idle" | "pending" | "running";
export type MarketReportStatus = "idle" | "pending" | "running" | "completed" | "failed";

export interface SuggestedChoice {
  key: string;
  label: string;
}

export interface PendingQuestion {
  question: string;
  suggested_choices: SuggestedChoice[];
  target_dimension: PendingQuestionDimension;
  round_number: number;
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  entry_type: TranscriptEntryType;
  content: string;
  choices: SuggestedChoice[];
  selected_choice_key: string | null;
  selected_choice_label: string | null;
  target_dimension: PendingQuestionDimension | null;
  round_number: number;
  created_at: string;
}

export interface ClarificationMetrics {
  readiness: number;
  structure: number;
  ambiguity: AmbiguityLabel;
  warnings: number;
  open_questions: number;
  overall_score: number;
  ambiguity_score: number;
  goal_clarity: number;
  constraint_clarity: number;
  success_criteria_clarity: number;
  goal_justification: string;
  constraint_justification: string;
  success_criteria_justification: string;
}

export interface MarketReportCitation {
  title: string;
  url: string;
  domain: string;
  published_date: string | null;
}

export interface MarketResearchQuery {
  label: string;
  query: string;
}

export interface MarketReportPayload {
  status: MarketReportStatus;
  markdown_content: string;
  citations: MarketReportCitation[];
  query_plan: MarketResearchQuery[];
  spec_snapshot: string;
  generated_at: string | null;
  updated_at: string | null;
  error_message: string | null;
}

export interface SessionRecord {
  id: string;
  title: string;
  initial_idea: string;
  spec_content: string;
  created_at: string;
  updated_at: string;
  clarification_round: number;
  is_ready: boolean;
  reconciliation_status: ReconciliationStatus;
  reconciled_round: number;
  metrics: ClarificationMetrics;
  pending_question: PendingQuestion | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  overall_score: number;
  ambiguity: AmbiguityLabel;
  is_ready: boolean;
  reconciliation_status: ReconciliationStatus;
}

export interface WorkspacePayload {
  session: SessionRecord;
  transcript: TranscriptEntry[];
  pendingQuestion: PendingQuestion | null;
  metrics: ClarificationMetrics;
  marketReport: MarketReportPayload | null;
  researchConfigured: boolean;
}

export interface CreateSessionPayload {
  title: string;
  initialIdea?: string;
}

export interface AnswerPayload {
  answer: string;
  selectedChoiceKey?: string;
  selectedChoiceLabel?: string;
}

export interface SessionRow {
  id: string;
  title: string;
  initial_idea: string;
  spec_content: string;
  created_at: string;
  updated_at: string;
  clarification_round: number;
  readiness: number;
  structure_score: number;
  ambiguity_label: AmbiguityLabel;
  warnings_count: number;
  open_questions_count: number;
  overall_score: number;
  ambiguity_score: number;
  goal_clarity: number;
  constraint_clarity: number;
  success_criteria_clarity: number;
  goal_justification: string;
  constraint_justification: string;
  success_criteria_justification: string;
  is_ready: number;
  pending_question_text: string | null;
  pending_question_choices: string | null;
  pending_question_dimension: PendingQuestionDimension | null;
  pending_question_round: number | null;
  reconciliation_status: ReconciliationStatus;
  reconciled_round: number;
}

export interface TranscriptRow {
  id: string;
  session_id: string;
  role: TranscriptRole;
  entry_type: TranscriptEntryType;
  content: string;
  choices: string | null;
  selected_choice_key: string | null;
  selected_choice_label: string | null;
  target_dimension: PendingQuestionDimension | null;
  round_number: number;
  created_at: string;
}

export interface MarketReportRow {
  session_id: string;
  status: MarketReportStatus;
  markdown_content: string;
  citations_json: string | null;
  query_plan_json: string | null;
  spec_snapshot: string;
  generated_at: string | null;
  updated_at: string;
  error_message: string | null;
}
