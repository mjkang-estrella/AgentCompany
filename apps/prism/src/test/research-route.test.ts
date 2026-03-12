import { vi } from "vitest";
import { createSessionWorkspace, getSessionWorkspace } from "@/lib/clarification";
import { createTestStore, saveSessionSnapshot, setStoreAdapterForTests } from "@/lib/store";
import { runInBackground } from "@/lib/background";
import { POST as researchRoute } from "@/app/api/sessions/[id]/research-market/route";

const scheduledTasks: Promise<unknown>[] = [];

vi.mock("@/lib/background", () => ({
  runInBackground: vi.fn((task: Promise<unknown>) => {
    scheduledTasks.push(task);
  }),
}));

describe("research-market route", () => {
  beforeEach(() => {
    scheduledTasks.length = 0;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.EXA_API_KEY = "exa-test-key";
    setStoreAdapterForTests(createTestStore());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Prism market signal",
                url: "https://example.com/prism-market-signal",
                publishedDate: "2026-03-01",
                text: "Teams prefer planning tools that convert ambiguity into concrete engineering handoff docs.",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
  });

  afterEach(() => {
    scheduledTasks.length = 0;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.EXA_API_KEY;
    setStoreAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("returns pending work immediately and schedules background research", async () => {
    const workspace = await createSessionWorkspace({
      title: "Hosted research",
      initialIdea: "A planning assistant for product teams.",
    });

    await saveSessionSnapshot(workspace.session.id, {
      specContent: workspace.session.spec_content,
      clarificationRound: workspace.session.clarification_round,
      metrics: {
        ...workspace.metrics,
        readiness: 84,
        structure: 84,
        overall_score: 84,
      },
      pendingQuestion: workspace.pendingQuestion,
      reconciliationStatus: "idle",
      reconciledRound: workspace.session.reconciled_round,
    });

    const response = await researchRoute(new Request("http://localhost", { method: "POST" }), {
      params: { id: workspace.session.id },
    });
    const payload = (await response.json()) as Awaited<ReturnType<typeof getSessionWorkspace>>;

    expect(response.status).toBe(200);
    expect(payload?.marketReport?.status).toBe("pending");
    expect(vi.mocked(runInBackground)).toHaveBeenCalledTimes(1);

    await Promise.allSettled(scheduledTasks);

    const updated = await getSessionWorkspace(workspace.session.id);
    expect(updated?.marketReport?.status).toBe("completed");
    expect(updated?.marketReport?.markdown_content).toContain("## Sources");
  });
});
