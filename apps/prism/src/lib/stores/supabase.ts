import { randomUUID } from "crypto";
import { hasExaKey } from "@/lib/exa";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { SessionRecord, SessionSummary, TranscriptEntry, WorkspacePayload } from "@/types/workspace";
import {
  buildSessionSummary,
  buildWorkspace,
  mapSessionRow,
  mapTranscriptRow,
  type InsertTranscriptInput,
  type MarketReportSnapshotInput,
  type MarketReportStoreRow,
  type PrismStoreAdapter,
  type SessionSnapshotInput,
  type SessionStoreRow,
  type TranscriptStoreRow,
} from "@/lib/store-contract";

const SESSION_TABLE = "prism_sessions";
const TRANSCRIPT_TABLE = "prism_transcript_entries";
const MARKET_REPORT_TABLE = "prism_market_reports";

export function createSupabasePrismStore(): PrismStoreAdapter {
  return {
    async listSessionSummaries(): Promise<SessionSummary[]> {
      const client = getSupabaseServerClient();
      const result = await client
        .from(SESSION_TABLE)
        .select(
          "id, title, created_at, updated_at, overall_score, ambiguity_label, is_ready, reconciliation_status"
        )
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });

      return assertResult(result, "Failed to load sessions.").map((row) =>
        buildSessionSummary({
          ...emptySessionRow(),
          ...row,
        } as SessionStoreRow)
      );
    },

    async getWorkspace(sessionId: string): Promise<WorkspacePayload | null> {
      const client = getSupabaseServerClient();
      const sessionResult = await client
        .from(SESSION_TABLE)
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();
      const sessionRow = assertResult(sessionResult, "Failed to load session.") as SessionStoreRow | null;

      if (!sessionRow) {
        return null;
      }

      const transcriptResult = await client
        .from(TRANSCRIPT_TABLE)
        .select("*")
        .eq("session_id", sessionId)
        .order("round_number", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      const transcriptRows = assertResult(transcriptResult, "Failed to load transcript.") as TranscriptStoreRow[];

      const marketReportResult = await client
        .from(MARKET_REPORT_TABLE)
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();
      const marketReportRow = assertResult(
        marketReportResult,
        "Failed to load market report."
      ) as MarketReportStoreRow | null;

      return buildWorkspace({
        sessionRow,
        transcriptRows,
        marketReportRow,
        researchConfigured: hasExaKey(),
      });
    },

    async createSessionSeed(input: {
      title: string;
      initialIdea: string;
      specContent: string;
    }): Promise<SessionRecord> {
      const client = getSupabaseServerClient();
      const now = new Date().toISOString();
      const result = await client
        .from(SESSION_TABLE)
        .insert({
          id: randomUUID(),
          title: input.title,
          initial_idea: input.initialIdea,
          spec_content: input.specContent,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();

      return mapSessionRow(assertResult(result, "Failed to create session.") as SessionStoreRow);
    },

    async saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshotInput): Promise<void> {
      const client = getSupabaseServerClient();
      const isReady =
        snapshot.metrics.overall_score >= 80 &&
        snapshot.metrics.ambiguity === "Low";

      const result = await client
        .from(SESSION_TABLE)
        .update({
          spec_content: snapshot.specContent,
          updated_at: snapshot.updatedAt ?? new Date().toISOString(),
          clarification_round: snapshot.clarificationRound,
          readiness: snapshot.metrics.readiness,
          structure_score: snapshot.metrics.structure,
          ambiguity_label: snapshot.metrics.ambiguity,
          warnings_count: snapshot.metrics.warnings,
          open_questions_count: snapshot.metrics.open_questions,
          overall_score: snapshot.metrics.overall_score,
          ambiguity_score: snapshot.metrics.ambiguity_score,
          goal_clarity: snapshot.metrics.goal_clarity,
          constraint_clarity: snapshot.metrics.constraint_clarity,
          success_criteria_clarity: snapshot.metrics.success_criteria_clarity,
          goal_justification: snapshot.metrics.goal_justification,
          constraint_justification: snapshot.metrics.constraint_justification,
          success_criteria_justification: snapshot.metrics.success_criteria_justification,
          is_ready: isReady,
          pending_question_text: snapshot.pendingQuestion?.question ?? null,
          pending_question_choices: snapshot.pendingQuestion?.suggested_choices ?? null,
          pending_question_dimension: snapshot.pendingQuestion?.target_dimension ?? null,
          pending_question_round: snapshot.pendingQuestion?.round_number ?? null,
          reconciliation_status: snapshot.reconciliationStatus,
          reconciled_round: snapshot.reconciledRound,
        })
        .eq("id", sessionId);

      assertResult(result, "Failed to save session state.");
    },

    async insertTranscriptEntry(input: InsertTranscriptInput): Promise<TranscriptEntry> {
      const client = getSupabaseServerClient();
      const createdAt = new Date().toISOString();
      const row: TranscriptStoreRow = {
        id: randomUUID(),
        session_id: input.sessionId,
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

      const result = await client.from(TRANSCRIPT_TABLE).insert(row);
      assertResult(result, "Failed to append transcript entry.");
      return mapTranscriptRow(row);
    },

    async saveMarketReport(sessionId: string, snapshot: MarketReportSnapshotInput): Promise<void> {
      const client = getSupabaseServerClient();
      const result = await client.from(MARKET_REPORT_TABLE).upsert(
        {
          session_id: sessionId,
          status: snapshot.status,
          markdown_content: snapshot.markdownContent,
          citations_json: snapshot.citations ?? [],
          query_plan_json: snapshot.queryPlan ?? [],
          spec_snapshot: snapshot.specSnapshot,
          generated_at: snapshot.generatedAt ?? null,
          updated_at: snapshot.updatedAt ?? new Date().toISOString(),
          error_message: snapshot.errorMessage ?? null,
        },
        {
          onConflict: "session_id",
        }
      );

      assertResult(result, "Failed to save market research.");
    },

    async deleteSessionRecord(sessionId: string): Promise<boolean> {
      const client = getSupabaseServerClient();
      const result = await client
        .from(SESSION_TABLE)
        .delete()
        .eq("id", sessionId)
        .select("id");

      return assertResult(result, "Failed to delete session.").length > 0;
    },
  };
}

function assertResult<T>(
  result: { data: T | null; error: { message?: string } | null },
  fallbackMessage: string
): T {
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }

  return result.data as T;
}

function emptySessionRow(): SessionStoreRow {
  return {
    id: "",
    title: "",
    initial_idea: "",
    spec_content: "",
    created_at: "",
    updated_at: "",
    clarification_round: 0,
    readiness: 0,
    structure_score: 0,
    ambiguity_label: "High",
    warnings_count: 0,
    open_questions_count: 0,
    overall_score: 0,
    ambiguity_score: 1,
    goal_clarity: 0,
    constraint_clarity: 0,
    success_criteria_clarity: 0,
    goal_justification: "",
    constraint_justification: "",
    success_criteria_justification: "",
    is_ready: false,
    pending_question_text: null,
    pending_question_choices: null,
    pending_question_dimension: null,
    pending_question_round: null,
    reconciliation_status: "idle",
    reconciled_round: 0,
  };
}
