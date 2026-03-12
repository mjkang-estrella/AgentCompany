import { createInMemoryPrismStore } from "@/lib/stores/in-memory";
import { createSupabasePrismStore } from "@/lib/stores/supabase";
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
    runtimeStore = createSupabasePrismStore();
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
  return getStore().listSessionSummaries();
}

export async function getWorkspace(sessionId: string) {
  return getStore().getWorkspace(sessionId);
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
