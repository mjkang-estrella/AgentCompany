// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionList from "@/components/SessionList";
import type { SessionSummary } from "@/types/workspace";

const sessions: SessionSummary[] = [
  {
    id: "session-1",
    title: "Reflect",
    created_at: "2026-03-08T08:00:00.000Z",
    updated_at: "2026-03-08T08:00:00.000Z",
    overall_score: 70,
    ambiguity: "Medium",
    is_ready: false,
    reconciliation_status: "idle",
  },
  {
    id: "session-2",
    title: "Prism",
    created_at: "2026-03-09T08:00:00.000Z",
    updated_at: "2026-03-09T08:00:00.000Z",
    overall_score: 91,
    ambiguity: "Low",
    is_ready: true,
    reconciliation_status: "idle",
  },
];

describe("SessionList", () => {
  it("keeps session selection and deletion as separate actions", async () => {
    const user = userEvent.setup();
    const selected: string[] = [];
    const deleted: string[] = [];

    render(
      <SessionList
        sessions={sessions}
        activeSessionId="session-1"
        isCreating={false}
        isInteractionLocked={false}
        deletingSessionId={null}
        onCreateSession={async () => {}}
        onSelectSession={async (session) => {
          selected.push(session.id);
        }}
        onDeleteSession={async (session) => {
          deleted.push(session.id);
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: /Open Prism/i }));
    await user.click(screen.getByRole("button", { name: /Delete Prism/i }));

    expect(selected).toEqual(["session-2"]);
    expect(deleted).toEqual(["session-2"]);
  });
});
