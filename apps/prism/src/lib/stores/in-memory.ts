import { randomUUID } from "crypto";
import { hasExaKey } from "@/lib/exa";
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

export function createInMemoryPrismStore(): PrismStoreAdapter {
  const sessions = new Map<string, SessionStoreRow>();
  const transcriptEntries = new Map<string, TranscriptStoreRow[]>();
  const marketReports = new Map<string, MarketReportStoreRow>();

  return {
    async listSessionSummaries(): Promise<SessionSummary[]> {
      return [...sessions.values()]
        .slice()
        .sort((left, right) => {
          if (left.updated_at === right.updated_at) {
            return right.created_at.localeCompare(left.created_at);
          }

          return right.updated_at.localeCompare(left.updated_at);
        })
        .map((row) => buildSessionSummary(clone(row)));
    },

    async getWorkspace(sessionId: string): Promise<WorkspacePayload | null> {
      const sessionRow = sessions.get(sessionId);
      if (!sessionRow) {
        return null;
      }

      return buildWorkspace({
        sessionRow: clone(sessionRow),
        transcriptRows: clone(transcriptEntries.get(sessionId) ?? []),
        marketReportRow: clone(marketReports.get(sessionId) ?? null),
        researchConfigured: hasExaKey(),
      });
    },

    async createSessionSeed(input: {
      title: string;
      initialIdea: string;
      specContent: string;
    }): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const row: SessionStoreRow = {
        id: randomUUID(),
        title: input.title,
        initial_idea: input.initialIdea,
        spec_content: input.specContent,
        created_at: now,
        updated_at: now,
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

      sessions.set(row.id, row);
      return mapSessionRow(clone(row));
    },

    async saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshotInput): Promise<void> {
      const existing = sessions.get(sessionId);
      if (!existing) {
        throw new Error("Session not found.");
      }

      const isReady =
        snapshot.metrics.overall_score >= 80 &&
        snapshot.metrics.ambiguity === "Low";

      sessions.set(sessionId, {
        ...existing,
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
        reconciliation_status: snapshot.reconciliationStatus ?? existing.reconciliation_status,
        reconciled_round: snapshot.reconciledRound ?? existing.reconciled_round,
      });
    },

    async insertTranscriptEntry(input: InsertTranscriptInput): Promise<TranscriptEntry> {
      const entry: TranscriptStoreRow = {
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
        created_at: new Date().toISOString(),
      };

      transcriptEntries.set(input.sessionId, [...(transcriptEntries.get(input.sessionId) ?? []), entry]);
      return mapTranscriptRow(clone(entry));
    },

    async saveMarketReport(sessionId: string, snapshot: MarketReportSnapshotInput): Promise<void> {
      marketReports.set(sessionId, {
        session_id: sessionId,
        status: snapshot.status,
        markdown_content: snapshot.markdownContent,
        citations_json: snapshot.citations ?? [],
        query_plan_json: snapshot.queryPlan ?? [],
        spec_snapshot: snapshot.specSnapshot,
        generated_at: snapshot.generatedAt ?? null,
        updated_at: snapshot.updatedAt ?? new Date().toISOString(),
        error_message: snapshot.errorMessage ?? null,
      });
    },

    async deleteSessionRecord(sessionId: string): Promise<boolean> {
      const existed = sessions.delete(sessionId);
      transcriptEntries.delete(sessionId);
      marketReports.delete(sessionId);
      return existed;
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
