import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { hasExaKey } from "@/lib/exa";
import type {
  ClarificationMetrics,
  MarketReportPayload,
  MarketReportRow,
  PendingQuestion,
  ReconciliationStatus,
  SessionRecord,
  SessionRow,
  SessionSummary,
  TranscriptEntry,
  TranscriptRow,
  WorkspacePayload,
  MarketReportCitation,
  MarketResearchQuery,
  MarketReportStatus,
} from "@/types/workspace";

interface SessionSnapshotInput {
  specContent: string;
  clarificationRound: number;
  metrics: ClarificationMetrics;
  pendingQuestion: PendingQuestion | null;
  reconciliationStatus?: ReconciliationStatus;
  reconciledRound?: number;
  updatedAt?: string;
}

interface InsertTranscriptInput {
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

interface MarketReportSnapshotInput {
  status: MarketReportStatus;
  markdownContent: string;
  citations: MarketReportCitation[];
  queryPlan: MarketResearchQuery[];
  specSnapshot: string;
  generatedAt?: string | null;
  updatedAt?: string;
  errorMessage?: string | null;
}

export function listSessionSummaries(): SessionSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, created_at, updated_at, overall_score, ambiguity_label, is_ready, reconciliation_status
       FROM sessions
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all() as Array<{
      id: string;
      title: string;
      created_at: string;
      updated_at: string;
      overall_score: number;
      ambiguity_label: SessionSummary["ambiguity"];
      is_ready: number;
      reconciliation_status: ReconciliationStatus;
    }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    overall_score: row.overall_score,
    ambiguity: row.ambiguity_label,
    is_ready: Boolean(row.is_ready),
    reconciliation_status: row.reconciliation_status,
  }));
}

export function getWorkspace(sessionId: string): WorkspacePayload | null {
  const db = getDb();
  const sessionRow = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as SessionRow | undefined;

  if (!sessionRow) {
    return null;
  }

  const transcriptRows = db
    .prepare(
      `SELECT *
       FROM transcript_entries
       WHERE session_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(sessionId) as TranscriptRow[];
  const marketReportRow = db
    .prepare("SELECT * FROM market_reports WHERE session_id = ?")
    .get(sessionId) as MarketReportRow | undefined;

  const transcript = transcriptRows.map(mapTranscriptRow);
  const session = mapSessionRow(sessionRow);

  return {
    session,
    transcript,
    pendingQuestion: session.pending_question,
    metrics: session.metrics,
    marketReport: marketReportRow ? mapMarketReportRow(marketReportRow) : null,
    researchConfigured: hasExaKey(),
  };
}

export function createSessionSeed(input: {
  title: string;
  initialIdea: string;
  specContent: string;
}): SessionRecord {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO sessions (
      id, title, initial_idea, spec_content, created_at, updated_at, clarification_round
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.title, input.initialIdea, input.specContent, now, now, 0);

  const created = getWorkspace(id);
  if (!created) {
    throw new Error("Failed to hydrate created session.");
  }

  return created.session;
}

export function saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshotInput, db: Database.Database = getDb()): void {
  const isReady =
    snapshot.metrics.overall_score >= 80 &&
    snapshot.metrics.ambiguity === "Low";

  db.prepare(
    `UPDATE sessions
     SET spec_content = ?,
         updated_at = ?,
         clarification_round = ?,
         readiness = ?,
         structure_score = ?,
         ambiguity_label = ?,
         warnings_count = ?,
         open_questions_count = ?,
         overall_score = ?,
         ambiguity_score = ?,
         goal_clarity = ?,
         constraint_clarity = ?,
         success_criteria_clarity = ?,
         goal_justification = ?,
         constraint_justification = ?,
         success_criteria_justification = ?,
         is_ready = ?,
         pending_question_text = ?,
         pending_question_choices = ?,
         pending_question_dimension = ?,
         pending_question_round = ?,
         reconciliation_status = COALESCE(?, reconciliation_status),
         reconciled_round = COALESCE(?, reconciled_round)
     WHERE id = ?`
  ).run(
    snapshot.specContent,
    snapshot.updatedAt ?? new Date().toISOString(),
    snapshot.clarificationRound,
    snapshot.metrics.readiness,
    snapshot.metrics.structure,
    snapshot.metrics.ambiguity,
    snapshot.metrics.warnings,
    snapshot.metrics.open_questions,
    snapshot.metrics.overall_score,
    snapshot.metrics.ambiguity_score,
    snapshot.metrics.goal_clarity,
    snapshot.metrics.constraint_clarity,
    snapshot.metrics.success_criteria_clarity,
    snapshot.metrics.goal_justification,
    snapshot.metrics.constraint_justification,
    snapshot.metrics.success_criteria_justification,
    isReady ? 1 : 0,
    snapshot.pendingQuestion?.question ?? null,
    snapshot.pendingQuestion ? JSON.stringify(snapshot.pendingQuestion.suggested_choices) : null,
    snapshot.pendingQuestion?.target_dimension ?? null,
    snapshot.pendingQuestion?.round_number ?? null,
    snapshot.reconciliationStatus ?? null,
    snapshot.reconciledRound ?? null,
    sessionId
  );
}

export function insertTranscriptEntry(input: InsertTranscriptInput, db: Database.Database = getDb()): TranscriptEntry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO transcript_entries (
      id,
      session_id,
      role,
      entry_type,
      content,
      choices,
      selected_choice_key,
      selected_choice_label,
      target_dimension,
      round_number,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sessionId,
    input.role,
    input.entryType,
    input.content,
    input.choices ? JSON.stringify(input.choices) : null,
    input.selectedChoiceKey ?? null,
    input.selectedChoiceLabel ?? null,
    input.targetDimension ?? null,
    input.roundNumber,
    createdAt
  );

  return {
    id,
    role: input.role,
    entry_type: input.entryType,
    content: input.content,
    choices: input.choices ?? [],
    selected_choice_key: input.selectedChoiceKey ?? null,
    selected_choice_label: input.selectedChoiceLabel ?? null,
    target_dimension: input.targetDimension ?? null,
    round_number: input.roundNumber,
    created_at: createdAt,
  };
}

export function saveMarketReport(
  sessionId: string,
  snapshot: MarketReportSnapshotInput,
  db: Database.Database = getDb()
): void {
  const now = snapshot.updatedAt ?? new Date().toISOString();

  db.prepare(
    `INSERT INTO market_reports (
      session_id,
      status,
      markdown_content,
      citations_json,
      query_plan_json,
      spec_snapshot,
      generated_at,
      updated_at,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      status = excluded.status,
      markdown_content = excluded.markdown_content,
      citations_json = excluded.citations_json,
      query_plan_json = excluded.query_plan_json,
      spec_snapshot = excluded.spec_snapshot,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at,
      error_message = excluded.error_message`
  ).run(
    sessionId,
    snapshot.status,
    snapshot.markdownContent,
    JSON.stringify(snapshot.citations ?? []),
    JSON.stringify(snapshot.queryPlan ?? []),
    snapshot.specSnapshot,
    snapshot.generatedAt ?? null,
    now,
    snapshot.errorMessage ?? null
  );
}

export function deleteSessionRecord(sessionId: string, db: Database.Database = getDb()): boolean {
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  return result.changes > 0;
}

export function runInTransaction<T>(callback: (db: Database.Database) => T): T {
  const db = getDb();
  const transaction = db.transaction(() => callback(db));
  return transaction();
}

function mapSessionRow(row: SessionRow): SessionRecord {
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
    is_ready: Boolean(row.is_ready),
    reconciliation_status: row.reconciliation_status,
    reconciled_round: row.reconciled_round,
    metrics,
    pending_question: row.pending_question_text
      ? {
          question: row.pending_question_text,
          suggested_choices: parseChoices(row.pending_question_choices),
          target_dimension: row.pending_question_dimension ?? "context",
          round_number: row.pending_question_round ?? row.clarification_round + 1,
        }
      : null,
  };
}

function mapTranscriptRow(row: TranscriptRow): TranscriptEntry {
  return {
    id: row.id,
    role: row.role,
    entry_type: row.entry_type,
    content: row.content,
    choices: parseChoices(row.choices),
    selected_choice_key: row.selected_choice_key,
    selected_choice_label: row.selected_choice_label,
    target_dimension: row.target_dimension,
    round_number: row.round_number,
    created_at: row.created_at,
  };
}

function mapMarketReportRow(row: MarketReportRow): MarketReportPayload {
  return {
    status: row.status,
    markdown_content: row.markdown_content,
    citations: parseArray<MarketReportCitation>(row.citations_json),
    query_plan: parseArray<MarketResearchQuery>(row.query_plan_json),
    spec_snapshot: row.spec_snapshot,
    generated_at: row.generated_at,
    updated_at: row.updated_at,
    error_message: row.error_message,
  };
}

function parseChoices(raw: string | null): TranscriptEntry["choices"] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseArray<T>(raw: string | null): T[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
