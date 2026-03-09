import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  createSessionWorkspace,
  getSessionSummaries,
  getSessionWorkspace,
  kickSessionReconciliation,
  submitSessionAnswer,
  updateSessionDraft,
  waitForSessionReconciliation,
} from "@/lib/clarification";
import { resetDbForTests } from "@/lib/db";
import { GET as exportRoute } from "@/app/api/sessions/[id]/export/route";

describe("clarification service", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.PRISM_CODEX_DB_PATH = path.join(os.tmpdir(), `prism-codex-${randomUUID()}.db`);
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PRISM_CODEX_DB_PATH;
  });

  it("creates a persisted session with a pending question", async () => {
    const workspace = await createSessionWorkspace({
      title: "New idea",
      initialIdea: "A tool that clarifies vague software concepts.",
    });

    expect(workspace.session.title).toBe("New idea");
    expect(workspace.pendingQuestion).not.toBeNull();
    expect(getSessionSummaries()).toHaveLength(1);
    expect(getSessionWorkspace(workspace.session.id)?.transcript[0]?.role).toBe("assistant");
  });

  it("updates the spec and transcript after an answer", async () => {
    const workspace = await createSessionWorkspace({
      title: "New idea",
      initialIdea: "A tool that clarifies vague software concepts.",
    });

    const immediate = await submitSessionAnswer(workspace.session.id, {
      answer: "The first outcome is a markdown spec ready for engineering handoff.",
    });
    kickSessionReconciliation(workspace.session.id);
    await waitForSessionReconciliation(workspace.session.id);
    const updated = getSessionWorkspace(workspace.session.id);

    expect(immediate.transcript.some((entry) => entry.role === "user")).toBe(true);
    expect(immediate.session.reconciliation_status).toBe("pending");
    expect(updated?.session.spec_content).toContain("markdown spec ready for engineering handoff");
    expect(updated?.session.clarification_round).toBe(1);
    expect(updated?.session.reconciliation_status).toBe("idle");
  });

  it("supports manual draft updates with last-write-wins persistence", async () => {
    const workspace = await createSessionWorkspace({
      title: "Manual edit",
      initialIdea: "A planning assistant.",
    });

    const edited = updateSessionDraft(workspace.session.id, "# Manual edit\n\n## Overview\n\nEdited by user\n");

    expect(edited?.session.spec_content).toContain("Edited by user");
    expect(getSessionWorkspace(workspace.session.id)?.session.spec_content).toContain("Edited by user");
  });

  it("keeps export disabled until the session is ready", async () => {
    const workspace = await createSessionWorkspace({
      title: "Export gate",
      initialIdea: "A planning assistant.",
    });

    const response = await exportRoute(new Request("http://localhost"), {
      params: { id: workspace.session.id },
    });

    expect(response.status).toBe(409);
  });
});
