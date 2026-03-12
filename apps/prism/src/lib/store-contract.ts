import type {
  ClarificationMetrics,
  MarketReportCitation,
  MarketReportPayload,
  MarketResearchQuery,
  PendingQuestion,
  PendingQuestionDimension,
  ReconciliationStatus,
  SessionRecord,
  SessionSummary,
  SuggestedChoice,
  TranscriptEntry,
  WorkspacePayload,
  MarketReportStatus,
} from "@/types/workspace";

export interface SessionSnapshotInput {
  specContent: string;
  clarificationRound: number;
  metrics: ClarificationMetrics;
  pendingQuestion: PendingQuestion | null;
  reconciliationStatus?: ReconciliationStatus;
  reconciledRound?: number;
  updatedAt?: string;
}

export interface InsertTranscriptInput {
  sessionId: string;
  role: TranscriptEntry["role"];
  entryType: TranscriptEntry["entry_type"];
  content: string;
  choices?: TranscriptEntry["choices"];
  selectedChoiceKey?: string | null;
  selectedChoiceLabel?: string | null;
  targetDimension?: TranscriptEntry["target_dimension"];
  roundNumber: number;
}

export interface MarketReportSnapshotInput {
  status: MarketReportStatus;
  markdownContent: string;
  citations: MarketReportCitation[];
  queryPlan: MarketResearchQuery[];
  specSnapshot: string;
  generatedAt?: string | null;
  updatedAt?: string;
  errorMessage?: string | null;
}

export interface SessionStoreRow {
  id: string;
  title: string;
  initial_idea: string;
  spec_content: string;
  created_at: string;
  updated_at: string;
  clarification_round: number;
  readiness: number;
  structure_score: number;
  ambiguity_label: "Low" | "Medium" | "High";
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
  is_ready: boolean;
  pending_question_text: string | null;
  pending_question_choices: SuggestedChoice[] | null;
  pending_question_dimension: PendingQuestionDimension | null;
  pending_question_round: number | null;
  reconciliation_status: ReconciliationStatus;
  reconciled_round: number;
}

export interface TranscriptStoreRow {
  id: string;
  session_id: string;
  role: TranscriptEntry["role"];
  entry_type: TranscriptEntry["entry_type"];
  content: string;
  choices: SuggestedChoice[] | null;
  selected_choice_key: string | null;
  selected_choice_label: string | null;
  target_dimension: PendingQuestionDimension | null;
  round_number: number;
  created_at: string;
}

export interface MarketReportStoreRow {
  session_id: string;
  status: MarketReportStatus;
  markdown_content: string;
  citations_json: MarketReportCitation[];
  query_plan_json: MarketResearchQuery[];
  spec_snapshot: string;
  generated_at: string | null;
  updated_at: string;
  error_message: string | null;
}

export interface PrismStoreAdapter {
  listSessionSummaries(): Promise<SessionSummary[]>;
  getWorkspace(sessionId: string): Promise<WorkspacePayload | null>;
  createSessionSeed(input: {
    title: string;
    initialIdea: string;
    specContent: string;
  }): Promise<SessionRecord>;
  saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshotInput): Promise<void>;
  insertTranscriptEntry(input: InsertTranscriptInput): Promise<TranscriptEntry>;
  saveMarketReport(sessionId: string, snapshot: MarketReportSnapshotInput): Promise<void>;
  deleteSessionRecord(sessionId: string): Promise<boolean>;
}

export function buildSessionSummary(row: SessionStoreRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    overall_score: row.overall_score,
    ambiguity: row.ambiguity_label,
    is_ready: row.is_ready,
    reconciliation_status: row.reconciliation_status,
  };
}

export function buildWorkspace(input: {
  sessionRow: SessionStoreRow;
  transcriptRows: TranscriptStoreRow[];
  marketReportRow: MarketReportStoreRow | null;
  researchConfigured: boolean;
}): WorkspacePayload {
  const session = mapSessionRow(input.sessionRow);

  return {
    session,
    transcript: input.transcriptRows.map(mapTranscriptRow),
    pendingQuestion: session.pending_question,
    metrics: session.metrics,
    marketReport: input.marketReportRow ? mapMarketReportRow(input.marketReportRow) : null,
    researchConfigured: input.researchConfigured,
  };
}

export function mapSessionRow(row: SessionStoreRow): SessionRecord {
  const metrics: ClarificationMetrics = {
    readiness: row.readiness,
    structure: row.structure_score,
    ambiguity: row.ambiguity_label,
    warnings: row.warnings_count,
    open_questions: row.open_questions_count,
    overall_score: row.overall_score,
    ambiguity_score: row.ambiguity_score,
    goal_clarity: row.goal_clarity,
    constraint_clarity: row.constraint_clarity,
    success_criteria_clarity: row.success_criteria_clarity,
    goal_justification: row.goal_justification,
    constraint_justification: row.constraint_justification,
    success_criteria_justification: row.success_criteria_justification,
  };

  return {
    id: row.id,
    title: row.title,
    initial_idea: row.initial_idea,
    spec_content: row.spec_content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    clarification_round: row.clarification_round,
    is_ready: row.is_ready,
    reconciliation_status: row.reconciliation_status,
    reconciled_round: row.reconciled_round,
    metrics,
    pending_question: row.pending_question_text
      ? {
          question: row.pending_question_text,
          suggested_choices: row.pending_question_choices ?? [],
          target_dimension: row.pending_question_dimension ?? "context",
          round_number: row.pending_question_round ?? row.clarification_round + 1,
        }
      : null,
  };
}

export function mapTranscriptRow(row: TranscriptStoreRow): TranscriptEntry {
  return {
    id: row.id,
    role: row.role,
    entry_type: row.entry_type,
    content: row.content,
    choices: row.choices ?? [],
    selected_choice_key: row.selected_choice_key,
    selected_choice_label: row.selected_choice_label,
    target_dimension: row.target_dimension,
    round_number: row.round_number,
    created_at: row.created_at,
  };
}

export function mapMarketReportRow(row: MarketReportStoreRow): MarketReportPayload {
  return {
    status: row.status,
    markdown_content: row.markdown_content,
    citations: row.citations_json ?? [],
    query_plan: row.query_plan_json ?? [],
    spec_snapshot: row.spec_snapshot,
    generated_at: row.generated_at,
    updated_at: row.updated_at,
    error_message: row.error_message,
  };
}
