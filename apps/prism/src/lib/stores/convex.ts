import { randomUUID } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { hasExaKey } from "@/lib/exa";
import {
  buildWorkspace,
  mapSessionRow,
  mapTranscriptRow,
  type InsertTranscriptInput,
  type MarketReportSnapshotInput,
  type PrismStoreAdapter,
  type SessionSnapshotInput,
} from "@/lib/store-contract";
import { api } from "@convex/_generated/api";

let client: ConvexHttpClient | null = null;

function writeAccess() {
  return process.env.PRISM_WRITE_SECRET
    ? { writeSecret: process.env.PRISM_WRITE_SECRET }
    : {};
}

function getClient(): ConvexHttpClient {
  const deploymentUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

  if (!deploymentUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is required.");
  }

  if (!client) {
    client = new ConvexHttpClient(deploymentUrl);
  }

  return client;
}

export function createConvexPrismStore(): PrismStoreAdapter {
  return {
    async listSessionSummaries() {
      return getClient().query(api.prism.listSessionSummaries, { limit: 200 });
    },

    async getWorkspace(sessionId) {
      const rows = await getClient().query(api.prism.getWorkspaceRows, {
        sessionId,
        transcriptLimit: 200,
      });

      if (!rows.session) {
        return null;
      }

      return buildWorkspace({
        sessionRow: rows.session,
        transcriptRows: rows.transcriptEntries,
        marketReportRow: rows.marketReport,
        researchConfigured: hasExaKey(),
      });
    },

    async createSessionSeed(input) {
      const row = await getClient().mutation(api.prism.createSession, {
        id: randomUUID(),
        title: input.title,
        initialIdea: input.initialIdea,
        specContent: input.specContent,
        ...writeAccess(),
      });

      return mapSessionRow(row);
    },

    async saveSessionSnapshot(
      sessionId: string,
      snapshot: SessionSnapshotInput
    ) {
      await getClient().mutation(api.prism.saveSessionSnapshot, {
        sessionId,
        specContent: snapshot.specContent,
        clarificationRound: snapshot.clarificationRound,
        metrics: snapshot.metrics,
        pendingQuestion: snapshot.pendingQuestion,
        ...(snapshot.reconciliationStatus
          ? { reconciliationStatus: snapshot.reconciliationStatus }
          : {}),
        ...(snapshot.reconciledRound !== undefined
          ? { reconciledRound: snapshot.reconciledRound }
          : {}),
        ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
        ...writeAccess(),
      });
    },

    async insertTranscriptEntry(input: InsertTranscriptInput) {
      const row = await getClient().mutation(api.prism.insertTranscriptEntry, {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: input.role,
        entryType: input.entryType,
        content: input.content,
        ...(input.choices ? { choices: input.choices } : {}),
        ...(input.selectedChoiceKey !== undefined
          ? { selectedChoiceKey: input.selectedChoiceKey }
          : {}),
        ...(input.selectedChoiceLabel !== undefined
          ? { selectedChoiceLabel: input.selectedChoiceLabel }
          : {}),
        ...(input.targetDimension !== undefined
          ? { targetDimension: input.targetDimension }
          : {}),
        roundNumber: input.roundNumber,
        ...writeAccess(),
      });

      return mapTranscriptRow(row);
    },

    async saveMarketReport(
      sessionId: string,
      snapshot: MarketReportSnapshotInput
    ) {
      await getClient().mutation(api.prism.upsertMarketReport, {
        sessionId,
        status: snapshot.status,
        markdownContent: snapshot.markdownContent,
        citations: snapshot.citations,
        queryPlan: snapshot.queryPlan,
        specSnapshot: snapshot.specSnapshot,
        ...(snapshot.generatedAt !== undefined
          ? { generatedAt: snapshot.generatedAt }
          : {}),
        ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
        ...(snapshot.errorMessage !== undefined
          ? { errorMessage: snapshot.errorMessage }
          : {}),
        ...writeAccess(),
      });
    },

    async deleteSessionRecord(sessionId: string) {
      return getClient().mutation(api.prism.deleteSession, {
        sessionId,
        ...writeAccess(),
      });
    },
  };
}
