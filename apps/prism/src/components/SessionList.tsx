"use client";

import React, { useState } from "react";
import type { CreateSessionPayload, SessionSummary } from "@/types/workspace";

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isCreating: boolean;
  isInteractionLocked: boolean;
  deletingSessionId: string | null;
  onCreateSession: (payload: CreateSessionPayload) => Promise<void>;
  onSelectSession: (summary: SessionSummary) => Promise<void>;
  onDeleteSession: (summary: SessionSummary) => Promise<void>;
}

export default function SessionList({
  sessions,
  activeSessionId,
  isCreating,
  isInteractionLocked,
  deletingSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
}: SessionListProps) {
  const [title, setTitle] = useState("");
  const [initialIdea, setInitialIdea] = useState("");
  const [error, setError] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setError("");

    try {
      await onCreateSession({
        title: title.trim(),
        initialIdea: initialIdea.trim(),
      });
      setTitle("");
      setInitialIdea("");
      setIsComposerOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create session.");
    }
  }

  return (
    <aside className="panel panel-left">
      <div className="panel-header">
        <h3>Project Sessions</h3>
        <button
          className="new-session-btn"
          type="button"
          onClick={() => {
            setError("");
            setIsComposerOpen((current) => !current);
          }}
          disabled={isCreating || isInteractionLocked}
        >
          New
        </button>
      </div>

      {isComposerOpen ? (
        <form className="session-form" onSubmit={handleSubmit}>
          <input
            className="session-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Project name"
            disabled={isCreating || isInteractionLocked}
          />
          <textarea
            className="session-textarea"
            value={initialIdea}
            onChange={(event) => setInitialIdea(event.target.value)}
            placeholder="Description"
            disabled={isCreating || isInteractionLocked}
          />
          <button className="panel-button" type="submit" disabled={isCreating || isInteractionLocked}>
            {isCreating ? "Creating" : "Create Session"}
          </button>
          {error ? <div className="micro-text accent-text">{error}</div> : null}
        </form>
      ) : null}

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-state">No sessions yet. Create one to start clarifying a project idea.</div>
        ) : null}

        {sessions.map((session) => (
          <div
            key={session.id}
            className={`session-item${session.id === activeSessionId ? " active" : ""}`}
          >
            <button
              className="session-select"
              type="button"
              aria-label={`Open ${session.title}`}
              onClick={() => {
                void onSelectSession(session).catch((selectionError) => {
                  setError(
                    selectionError instanceof Error
                      ? selectionError.message
                      : "Unable to load session."
                  );
                });
              }}
              disabled={isInteractionLocked}
            >
              <span className="session-date">{new Date(session.created_at).toLocaleDateString()}</span>
              <span className="session-title">{session.title}</span>
              <div className="session-score-row">
                <span>{session.overall_score}%</span>
                <span>{session.ambiguity}</span>
                <span>{session.is_ready ? "Ready" : "Active"}</span>
              </div>
            </button>
            <button
              className="session-delete"
              type="button"
              aria-label={`Delete ${session.title}`}
              onClick={() => {
                void onDeleteSession(session).catch((deleteError) => {
                  setError(
                    deleteError instanceof Error
                      ? deleteError.message
                      : "Unable to delete session."
                  );
                });
              }}
              disabled={isInteractionLocked || deletingSessionId === session.id}
            >
              {deletingSessionId === session.id ? "Deleting" : "Delete"}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
