"use client";

import { useCallback, useEffect, useState } from "react";
import SessionList from "@/components/SessionList";
import SpecEditor from "@/components/SpecEditor";
import ClarificationPanel from "@/components/ClarificationPanel";
import type { AnswerPayload, CreateSessionPayload, SessionSummary, WorkspacePayload } from "@/types/workspace";

export default function HomePage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isSelectingSession, setIsSelectingSession] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [optimisticAnswer, setOptimisticAnswer] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const activeSessionId = workspace?.session.id ?? null;
  const reconciliationStatus = workspace?.session.reconciliation_status ?? "idle";
  const isReconciling = workspace ? workspace.session.reconciliation_status !== "idle" : false;
  const isAiBusy = isCreating || isSavingDraft || isSubmittingAnswer;
  const isInteractionLocked = isAiBusy || isSelectingSession;
  const isQuestionLocked = isCreating || isSubmittingAnswer || isSelectingSession;
  const isSpecLocked = isAiBusy || isSelectingSession || isReconciling;

  async function loadSessions(selectFirst = true) {
    setIsLoadingSessions(true);
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load sessions (${response.status})`);
      }

      const payload = (await response.json()) as { sessions: SessionSummary[] };
      setSessions(payload.sessions);

      if (selectFirst && payload.sessions.length > 0 && !workspace) {
        await selectSession(payload.sessions[0]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load sessions.");
    } finally {
      setIsLoadingSessions(false);
    }
  }

  const upsertSummary = useCallback((nextWorkspace: WorkspacePayload, moveToTop: boolean) => {
    const nextSummary: SessionSummary = {
      id: nextWorkspace.session.id,
      title: nextWorkspace.session.title,
      created_at: nextWorkspace.session.created_at,
      updated_at: nextWorkspace.session.updated_at,
      overall_score: nextWorkspace.metrics.overall_score,
      ambiguity: nextWorkspace.metrics.ambiguity,
      is_ready: nextWorkspace.session.is_ready,
      reconciliation_status: nextWorkspace.session.reconciliation_status,
    };

    setSessions((current) => {
      const existingIndex = current.findIndex((session) => session.id === nextSummary.id);

      if (moveToTop) {
        const filtered = current.filter((session) => session.id !== nextSummary.id);
        return [nextSummary, ...filtered];
      }

      if (existingIndex === -1) {
        return [...current, nextSummary];
      }

      const next = [...current];
      next[existingIndex] = nextSummary;
      return next;
    });
  }, []);

  async function createSession(payload: CreateSessionPayload) {
    setIsCreating(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || `Failed to create session (${response.status})`);
      }

      const nextWorkspace = (await response.json()) as WorkspacePayload;
      setWorkspace(nextWorkspace);
      setOptimisticAnswer(null);
      upsertSummary(nextWorkspace, true);
    } finally {
      setIsCreating(false);
    }
  }

  async function selectSession(summary: SessionSummary) {
    setErrorMessage("");
    setIsSelectingSession(true);
    try {
      const response = await fetch(`/api/sessions/${summary.id}`, { cache: "no-store" });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || `Failed to load session (${response.status})`);
      }

      const nextWorkspace = (await response.json()) as WorkspacePayload;
      setWorkspace(nextWorkspace);
    } finally {
      setIsSelectingSession(false);
    }
  }

  const refreshWorkspace = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || `Failed to refresh session (${response.status})`);
    }

    const nextWorkspace = (await response.json()) as WorkspacePayload;
    setWorkspace((current) => (current?.session.id === sessionId ? nextWorkspace : current));
    upsertSummary(nextWorkspace, false);
  }, [upsertSummary]);

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeSessionId || reconciliationStatus === "idle") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshWorkspace(activeSessionId).catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to refresh session.");
      });
    }, 1200);

    return () => window.clearInterval(interval);
  }, [activeSessionId, reconciliationStatus, refreshWorkspace]);

  async function saveDraft(specContent: string) {
    if (!workspace) {
      return;
    }

    setIsSavingDraft(true);

    try {
      const response = await fetch(`/api/sessions/${workspace.session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec_content: specContent }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || `Failed to save draft (${response.status})`);
      }

      const nextWorkspace = (await response.json()) as WorkspacePayload;
      setWorkspace(nextWorkspace);
      upsertSummary(nextWorkspace, false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save draft.");
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function submitAnswer(payload: AnswerPayload) {
    if (!workspace) {
      return;
    }

    setIsSubmittingAnswer(true);
    setErrorMessage("");
    setOptimisticAnswer(payload.answer.trim());

    try {
      const response = await fetch(`/api/sessions/${workspace.session.id}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || `Failed to submit answer (${response.status})`);
      }

      const nextWorkspace = (await response.json()) as WorkspacePayload;
      setWorkspace(nextWorkspace);
      setOptimisticAnswer(null);
      upsertSummary(nextWorkspace, true);
    } catch (error) {
      setOptimisticAnswer(null);
      setErrorMessage(error instanceof Error ? error.message : "Failed to submit answer.");
    } finally {
      setIsSubmittingAnswer(false);
    }
  }

  async function exportMarkdown() {
    if (!workspace?.session.is_ready) {
      return;
    }

    const response = await fetch(`/api/sessions/${workspace.session.id}/export`);
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      setErrorMessage(error?.error || `Failed to export markdown (${response.status})`);
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workspace.session.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "prism-spec"}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <main className="workspace-root">
      <SessionList
        sessions={sessions}
        activeSessionId={workspace?.session.id ?? null}
        isCreating={isCreating}
        isInteractionLocked={isInteractionLocked}
        onCreateSession={createSession}
        onSelectSession={selectSession}
      />
      <SpecEditor
        workspace={workspace}
        isSaving={isSavingDraft}
        isLocked={isSpecLocked}
        onSaveDraft={saveDraft}
        onExport={exportMarkdown}
      />
      <ClarificationPanel
        workspace={workspace}
        isLocked={isQuestionLocked}
        isThinking={isSubmittingAnswer}
        optimisticAnswer={optimisticAnswer}
        errorMessage={errorMessage || (isLoadingSessions ? "Loading sessions…" : "")}
        onSubmitAnswer={submitAnswer}
      />
    </main>
  );
}
