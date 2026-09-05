import { applyReadiness, assessReadiness, readinessQuestion } from "@/lib/readiness";
import { createInMemoryPrismStore } from "@/lib/stores/in-memory";
import { createConvexPrismStore } from "@/lib/stores/convex";
import type {
  InsertTranscriptInput,
  MarketReportSnapshotInput,
  PrismStoreAdapter,
  SessionSnapshotInput,
} from "@/lib/store-contract";

let runtimeStore: PrismStoreAdapter | null = null;
let testStore: PrismStoreAdapter | null = null;

function getStore(): PrismStoreAdapter {
  if (testStore) {
    return testStore;
  }

  if (!runtimeStore) {
    runtimeStore = createConvexPrismStore();
  }

  return runtimeStore;
}

export function setStoreAdapterForTests(store: PrismStoreAdapter | null): void {
  testStore = store;
}

export function createTestStore(): PrismStoreAdapter {
  return createInMemoryPrismStore();
}

export async function listSessionSummaries() {
  const summaries = await getStore().listSessionSummaries();
  const result = [];
  // Bound fan-out while revalidating legacy summaries without mutating their rows.
  for (let offset = 0; offset < summaries.length; offset += 8) {
    result.push(...await Promise.all(summaries.slice(offset, offset + 8).map(async summary => {
      const workspace = await getWorkspace(summary.id);
      return workspace ? { ...summary, is_ready: workspace.session.is_ready, overall_score: workspace.metrics.overall_score, ambiguity: workspace.metrics.ambiguity } : summary;
    })));
  }
  return result;
}

export async function getWorkspace(sessionId: string) {
  const workspace = await getStore().getWorkspace(sessionId);
  if (!workspace) return null;
  const spec = workspace.session.spec_content;
  const assessment = assessReadiness(spec);
  const metrics = applyReadiness(workspace.metrics, spec);
  const pendingQuestion = assessment.ready ? null : readinessQuestion(spec, workspace.session.clarification_round + 1, workspace.transcript.filter(entry => entry.role === "assistant").map(entry => entry.content));
  return { ...workspace, metrics, pendingQuestion, session: { ...workspace.session, metrics, is_ready: assessment.ready, pending_question: pendingQuestion } };
}

export async function createSessionSeed(input: {
  title: string;
  initialIdea: string;
  specContent: string;
}) {
  return getStore().createSessionSeed(input);
}

export async function saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshotInput): Promise<void> {
  await getStore().saveSessionSnapshot(sessionId, snapshot);
}

export async function insertTranscriptEntry(input: InsertTranscriptInput) {
  return getStore().insertTranscriptEntry(input);
}

export async function saveMarketReport(sessionId: string, snapshot: MarketReportSnapshotInput): Promise<void> {
  await getStore().saveMarketReport(sessionId, snapshot);
}

export async function deleteSessionRecord(sessionId: string): Promise<boolean> {
  return getStore().deleteSessionRecord(sessionId);
}
