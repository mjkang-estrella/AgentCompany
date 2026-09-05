import { assessReadiness, readinessQuestion } from "@/lib/readiness";
import { buildInitialSpec, updateSection, extractSections } from "@/lib/spec";
import {
  createSessionWorkspace,
  getSessionWorkspace,
  getSessionSummaries,
  updateSessionDraft,
  submitSessionAnswer,
} from "@/lib/clarification";
import { createTestStore, setStoreAdapterForTests } from "@/lib/store";
import { buildExportBundle } from "@/lib/export";
import { EXAMPLE_SPEC, EXAMPLE_ACCEPTANCE } from "@/lib/example";
import { READY_SPEC } from "./readiness-fixture";

describe("implementation readiness", () => {
  it("does not award readiness for headings, title, or generic answers", () => {
    const spec = buildInitialSpec(
      "AI Semiconductor Industry",
      "Automate an existing manual workflow",
    );
    const result = assessReadiness(spec);
    expect(result.ready).toBe(false);
    expect(result.score).toBe(0);
    expect(result.blockers.map((item) => item.section)).toEqual(
      expect.arrayContaining([
        "Users",
        "Problem",
        "Goals",
        "Non-Goals",
        "Constraints",
        "Success Criteria",
      ]),
    );
  });
  it.each([
    "It needs measurable target metrics",
    "A clear feature checklist is enough",
    "The output should be better",
    "Increase conversion",
    "TODO",
    "It must be unambiguous for engineering handoff",
  ])("rejects placeholder acceptance: %s", (criterion) => {
    expect(
      assessReadiness(updateSection(READY_SPEC, "Success Criteria", criterion))
        .ready,
    ).toBe(false);
  });
  it("accepts functional criteria without forcing revenue or user targets", () => {
    const result = assessReadiness(READY_SPEC);
    expect(result.ready).toBe(true);
    expect(result.evidence).toHaveLength(6);
    expect(result.nonBlockers).toHaveLength(1);
  });
  it("requires thresholds when the actual goal is quantitative", () => {
    const spec = updateSection(
      READY_SPEC,
      "Goals",
      "Reduce response time for loading saved articles.",
    );
    expect(assessReadiness(spec).ready).toBe(false);
    expect(
      assessReadiness(
        updateSection(
          spec,
          "Success Criteria",
          "When loading 100 saved articles, the list appears within 200 ms on the supported laptop.",
        ),
      ).ready,
    ).toBe(true);
  });
  it("prioritizes a decision conflict and excludes superseded decisions", () => {
    const spec = updateSection(
      READY_SPEC,
      "Decisions",
      "- Fit it into an existing product\n- Treat it as a fresh product idea",
    );
    expect(assessReadiness(spec).blockers[0].id).toBe("decision-conflict");
    expect(readinessQuestion(spec, 9)?.question).toContain(
      "Which decision applies now",
    );
    expect(readinessQuestion(spec, 9)?.suggested_choices).toEqual([]);
    expect(
      assessReadiness(
        updateSection(
          READY_SPEC,
          "Decision History",
          "Fit it into an existing product",
        ),
      ).ready,
    ).toBe(true);
  });
  it("treats unclassified open implementation questions conservatively", () => {
    expect(
      assessReadiness(
        updateSection(
          READY_SPEC,
          "Open Questions",
          "Which provider grants access to the required data?",
        ),
      ).ready,
    ).toBe(false);
  });
});

describe("readiness lifecycle", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    setStoreAdapterForTests(createTestStore());
  });
  afterEach(() => setStoreAdapterForTests(null));
  it("resolves the example through answers, exports evidence, and reopens after a destructive draft edit", async () => {
    const original = await createSessionWorkspace({ title: "Original idea" });
    const example = await createSessionWorkspace({ title: "Example copy" });
    const blocked = await updateSessionDraft(example.session.id, EXAMPLE_SPEC);
    expect(blocked?.session.is_ready).toBe(false);
    expect(blocked?.pendingQuestion?.target_dimension).toBe("success_criteria");
    const ready = await submitSessionAnswer(example.session.id, {
      answer: EXAMPLE_ACCEPTANCE,
    });
    expect(ready.session.is_ready).toBe(true);
    expect(ready.pendingQuestion).toBeNull();
    const exported = buildExportBundle(ready);
    for (const heading of [
      "READY FOR IMPLEMENTATION REVIEW",
      "## Goal",
      "## In Scope",
      "## Constraints",
      "## Acceptance Criteria",
      "## Active Decisions",
      "## Assumptions",
      "## Open Questions",
      "## Decision History",
    ])
      expect(exported).toContain(heading);
    const reopened = await updateSessionDraft(
      example.session.id,
      updateSection(ready.session.spec_content, "Users", "TBD"),
    );
    expect(reopened?.session.is_ready).toBe(false);
    expect(reopened?.pendingQuestion?.question).toContain("Who will use");
    expect(
      (await getSessionSummaries()).find(
        (item) => item.id === example.session.id,
      )?.is_ready,
    ).toBe(false);
    expect(
      (await getSessionWorkspace(original.session.id))?.session.spec_content,
    ).toBe(original.session.spec_content);
  });
  it("preserves replaced decisions and transcript while resolving a conflict", async () => {
    const session = await createSessionWorkspace({
      title: "Conflicting choices",
    });
    await updateSessionDraft(
      session.session.id,
      updateSection(
        READY_SPEC,
        "Decisions",
        "- Fit it into an existing product\n- Treat it as a fresh product idea",
      ),
    );
    const resolved = await submitSessionAnswer(session.session.id, {
      answer: "Build a standalone single-user web app.",
    });
    expect(resolved.session.is_ready).toBe(true);
    expect(
      extractSections(resolved.session.spec_content)["Decision History"],
    ).toContain("Fit it into an existing product");
    expect(
      resolved.transcript.some((entry) =>
        entry.content.includes("Which decision applies now"),
      ),
    ).toBe(true);
    const edited = await updateSessionDraft(
      session.session.id,
      updateSection(
        resolved.session.spec_content,
        "Decisions",
        "Integrate the reading queue into the existing product.",
      ),
    );
    expect(
      extractSections(edited!.session.spec_content)["Decision History"],
    ).toContain("Build a standalone single-user web app.");
  });
});
