import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { env, mutation, query } from "./_generated/server";
import {
  clarificationMetrics,
  marketReportCitation,
  marketReportRow,
  marketReportStatus,
  marketResearchQuery,
  pendingQuestion,
  pendingQuestionDimension,
  reconciliationStatus,
  sessionRow,
  sessionSummary,
  suggestedChoice,
  transcriptEntryType,
  transcriptRole,
  transcriptRow,
} from "./validators";

const DEFAULT_SESSION_LIMIT = 100;
const MAX_SESSION_LIMIT = 200;
const DEFAULT_TRANSCRIPT_LIMIT = 1_000;
const MAX_TRANSCRIPT_LIMIT = 2_000;

export const listSessionSummaries = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(sessionSummary),
  handler: async (ctx, args) => {
    const limit = boundedLimit(args.limit, DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT);
    const rows = await ctx.db
      .query("prismSessions")
      .withIndex("by_updated_at_and_created_at")
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      overall_score: row.overall_score,
      ambiguity: row.ambiguity_label,
      is_ready: row.is_ready,
      reconciliation_status: row.reconciliation_status,
    }));
  },
});

export const getWorkspaceRows = query({
  args: {
    sessionId: v.string(),
    transcriptLimit: v.optional(v.number()),
  },
  returns: v.object({
    session: v.union(sessionRow, v.null()),
    transcriptEntries: v.array(transcriptRow),
    marketReport: v.union(marketReportRow, v.null()),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("prismSessions")
      .withIndex("by_external_id", (q) => q.eq("id", args.sessionId))
      .unique();

    if (!session) {
      return {
        session: null,
        transcriptEntries: [],
        marketReport: null,
      };
    }

    const transcriptLimit = boundedLimit(
      args.transcriptLimit,
      DEFAULT_TRANSCRIPT_LIMIT,
      MAX_TRANSCRIPT_LIMIT,
    );
    const transcriptEntries = await ctx.db
      .query("prismTranscriptEntries")
      .withIndex("by_session_id_and_round_number_and_created_at", (q) =>
        q.eq("session_id", args.sessionId),
      )
      .order("asc")
      .take(transcriptLimit + 1);

    if (transcriptEntries.length > transcriptLimit) {
      throw new Error(
        `Session ${args.sessionId} has more than ${transcriptLimit} transcript entries. Increase transcriptLimit or archive the session.`,
      );
    }

    const marketReport = await ctx.db
      .query("prismMarketReports")
      .withIndex("by_session_id", (q) => q.eq("session_id", args.sessionId))
      .unique();

    return {
      session: toSessionRow(session),
      transcriptEntries: transcriptEntries.map(toTranscriptRow),
      marketReport: marketReport ? toMarketReportRow(marketReport) : null,
    };
  },
});

export const createSession = mutation({
  args: {
    id: v.string(),
    title: v.string(),
    initialIdea: v.string(),
    specContent: v.string(),
    createdAt: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  returns: sessionRow,
  handler: async (ctx, args) => {
    assertWriteAccess(args.writeSecret);
    assertNonEmptyId(args.id, "session id");
    const existing = await ctx.db
      .query("prismSessions")
      .withIndex("by_external_id", (q) => q.eq("id", args.id))
      .unique();
    if (existing) {
      throw new Error(`Session ${args.id} already exists.`);
    }

    const now = args.createdAt ?? new Date().toISOString();
    const document = {
      id: args.id,
      title: args.title,
      initial_idea: args.initialIdea,
      spec_content: args.specContent,
      created_at: now,
      updated_at: now,
      clarification_round: 0,
      readiness: 0,
      structure_score: 0,
      ambiguity_label: "High" as const,
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
      reconciliation_status: "idle" as const,
      reconciled_round: 0,
    };

    await ctx.db.insert("prismSessions", document);
    return document;
  },
});

export const saveSessionSnapshot = mutation({
  args: {
    sessionId: v.string(),
    specContent: v.string(),
    clarificationRound: v.number(),
    metrics: clarificationMetrics,
    pendingQuestion: v.union(pendingQuestion, v.null()),
    reconciliationStatus: v.optional(reconciliationStatus),
    reconciledRound: v.optional(v.number()),
    updatedAt: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertWriteAccess(args.writeSecret);
    const session = await ctx.db
      .query("prismSessions")
      .withIndex("by_external_id", (q) => q.eq("id", args.sessionId))
      .unique();
    if (!session) {
      throw new Error(`Session ${args.sessionId} does not exist.`);
    }

    const isReady =
      args.metrics.overall_score >= 80 && args.metrics.ambiguity === "Low";
    await ctx.db.patch(session._id, {
      spec_content: args.specContent,
      updated_at: args.updatedAt ?? new Date().toISOString(),
      clarification_round: args.clarificationRound,
      readiness: args.metrics.readiness,
      structure_score: args.metrics.structure,
      ambiguity_label: args.metrics.ambiguity,
      warnings_count: args.metrics.warnings,
      open_questions_count: args.metrics.open_questions,
      overall_score: args.metrics.overall_score,
      ambiguity_score: args.metrics.ambiguity_score,
      goal_clarity: args.metrics.goal_clarity,
      constraint_clarity: args.metrics.constraint_clarity,
      success_criteria_clarity: args.metrics.success_criteria_clarity,
      goal_justification: args.metrics.goal_justification,
      constraint_justification: args.metrics.constraint_justification,
      success_criteria_justification:
        args.metrics.success_criteria_justification,
      is_ready: isReady,
      pending_question_text: args.pendingQuestion?.question ?? null,
      pending_question_choices:
        args.pendingQuestion?.suggested_choices ?? null,
      pending_question_dimension:
        args.pendingQuestion?.target_dimension ?? null,
      pending_question_round: args.pendingQuestion?.round_number ?? null,
      reconciliation_status:
        args.reconciliationStatus ?? session.reconciliation_status,
      reconciled_round: args.reconciledRound ?? session.reconciled_round,
    });

    return null;
  },
});

export const insertTranscriptEntry = mutation({
  args: {
    id: v.string(),
    sessionId: v.string(),
    role: transcriptRole,
    entryType: transcriptEntryType,
    content: v.string(),
    choices: v.optional(v.array(suggestedChoice)),
    selectedChoiceKey: v.optional(v.union(v.string(), v.null())),
    selectedChoiceLabel: v.optional(v.union(v.string(), v.null())),
    targetDimension: v.optional(v.union(pendingQuestionDimension, v.null())),
    roundNumber: v.number(),
    createdAt: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  returns: transcriptRow,
  handler: async (ctx, args) => {
    assertWriteAccess(args.writeSecret);
    assertNonEmptyId(args.id, "transcript entry id");
    const session = await ctx.db
      .query("prismSessions")
      .withIndex("by_external_id", (q) => q.eq("id", args.sessionId))
      .unique();
    if (!session) {
      throw new Error(`Session ${args.sessionId} does not exist.`);
    }

    const duplicate = await ctx.db
      .query("prismTranscriptEntries")
      .withIndex("by_external_id", (q) => q.eq("id", args.id))
      .unique();
    if (duplicate) {
      throw new Error(`Transcript entry ${args.id} already exists.`);
    }

    const document = {
      id: args.id,
      session_id: args.sessionId,
      role: args.role,
      entry_type: args.entryType,
      content: args.content,
      choices: args.choices ?? [],
      selected_choice_key: args.selectedChoiceKey ?? null,
      selected_choice_label: args.selectedChoiceLabel ?? null,
      target_dimension: args.targetDimension ?? null,
      round_number: args.roundNumber,
      created_at: args.createdAt ?? new Date().toISOString(),
    };

    await ctx.db.insert("prismTranscriptEntries", document);
    return document;
  },
});

export const upsertMarketReport = mutation({
  args: {
    sessionId: v.string(),
    status: marketReportStatus,
    markdownContent: v.string(),
    citations: v.array(marketReportCitation),
    queryPlan: v.array(marketResearchQuery),
    specSnapshot: v.string(),
    generatedAt: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.optional(v.string()),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    writeSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertWriteAccess(args.writeSecret);
    const session = await ctx.db
      .query("prismSessions")
      .withIndex("by_external_id", (q) => q.eq("id", args.sessionId))
      .unique();
    if (!session) {
      throw new Error(`Session ${args.sessionId} does not exist.`);
    }

    const existing = await ctx.db
      .query("prismMarketReports")
      .withIndex("by_session_id", (q) => q.eq("session_id", args.sessionId))
      .unique();
    const document = {
      session_id: args.sessionId,
      status: args.status,
      markdown_content: args.markdownContent,
      citations_json: args.citations,
      query_plan_json: args.queryPlan,
      spec_snapshot: args.specSnapshot,
      generated_at: args.generatedAt ?? null,
      updated_at: args.updatedAt ?? new Date().toISOString(),
      error_message: args.errorMessage ?? null,
    };

    if (existing) {
      await ctx.db.replace(existing._id, document);
    } else {
      await ctx.db.insert("prismMarketReports", document);
    }

    return null;
  },
});

export const deleteSession = mutation({
  args: {
    sessionId: v.string(),
    writeSecret: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertWriteAccess(args.writeSecret);
    const session = await ctx.db
      .query("prismSessions")
      .withIndex("by_external_id", (q) => q.eq("id", args.sessionId))
      .unique();
    if (!session) {
      return false;
    }

    const transcriptEntries = await ctx.db
      .query("prismTranscriptEntries")
      .withIndex("by_session_id_and_round_number_and_created_at", (q) =>
        q.eq("session_id", args.sessionId),
      )
      .take(MAX_TRANSCRIPT_LIMIT + 1);
    if (transcriptEntries.length > MAX_TRANSCRIPT_LIMIT) {
      throw new Error(
        `Session ${args.sessionId} has more than ${MAX_TRANSCRIPT_LIMIT} transcript entries and cannot be deleted in one transaction.`,
      );
    }

    const marketReport = await ctx.db
      .query("prismMarketReports")
      .withIndex("by_session_id", (q) => q.eq("session_id", args.sessionId))
      .unique();

    await Promise.all(transcriptEntries.map((entry) => ctx.db.delete(entry._id)));
    if (marketReport) {
      await ctx.db.delete(marketReport._id);
    }
    await ctx.db.delete(session._id);
    return true;
  },
});

function boundedLimit(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
): number {
  const resolved = value ?? defaultValue;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`limit must be an integer between 1 and ${maximum}.`);
  }
  return resolved;
}

function assertNonEmptyId(id: string, label: string): void {
  if (!id.trim()) {
    throw new Error(`${label} cannot be empty.`);
  }
}

function assertWriteAccess(writeSecret: string | undefined): void {
  if (env.PRISM_WRITE_SECRET && writeSecret !== env.PRISM_WRITE_SECRET) {
    throw new Error("Unauthorized write request.");
  }
}

function toSessionRow(document: Doc<"prismSessions">) {
  const { _id, _creationTime, ...row } = document;
  return row;
}

function toTranscriptRow(document: Doc<"prismTranscriptEntries">) {
  const { _id, _creationTime, ...row } = document;
  return row;
}

function toMarketReportRow(document: Doc<"prismMarketReports">) {
  const { _id, _creationTime, ...row } = document;
  return row;
}
