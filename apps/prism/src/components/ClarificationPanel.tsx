"use client";

import React from "react";
import { useEffect, useRef, useState } from "react";
import type { AnswerPayload, SuggestedChoice, WorkspacePayload } from "@/types/workspace";

interface ClarificationPanelProps {
  workspace: WorkspacePayload | null;
  isLocked: boolean;
  isThinking: boolean;
  optimisticAnswer: string | null;
  errorMessage: string;
  onSubmitAnswer: (payload: AnswerPayload) => Promise<void>;
}

export default function ClarificationPanel({
  workspace,
  isLocked,
  isThinking,
  optimisticAnswer,
  errorMessage,
  onSubmitAnswer,
}: ClarificationPanelProps) {
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingQuestion = workspace?.pendingQuestion ?? null;
  const historyEntries = workspace?.transcript.filter((entry) => {
    if (!pendingQuestion) {
      return true;
    }

    return !(
      entry.role === "assistant" &&
      entry.round_number === pendingQuestion.round_number &&
      entry.content === pendingQuestion.question
    );
  }) ?? [];

  useEffect(() => {
    setValue("");
  }, [workspace?.pendingQuestion?.round_number]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [workspace?.transcript.length, workspace?.pendingQuestion?.round_number]);

  async function submitFreeText(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!value.trim()) {
      return;
    }

    const answer = value.trim();
    setValue("");
    await onSubmitAnswer({ answer });
  }

  async function submitChoice(choice: SuggestedChoice) {
    await onSubmitAnswer({
      answer: choice.label,
      selectedChoiceKey: choice.key,
      selectedChoiceLabel: choice.label,
    });
  }

  return (
    <section className="panel panel-right">
      <div className="panel-header">
        <h3>Clarification System</h3>
        <span className={`micro-text ${workspace?.session.is_ready ? "success-text" : "accent-text"}`}>
          {workspace?.session.is_ready ? "Ready" : workspace ? "In Progress" : "Idle"}
        </span>
      </div>

      {errorMessage ? <div className="status-banner error">{errorMessage}</div> : null}

      <div className="chat-history" ref={scrollRef}>
        <div className="chat-history-inner">
          {!workspace ? <div className="empty-state">The current AI question will appear here after you create or select a session.</div> : null}

          {historyEntries.map((entry) => {
          return (
            <article className="message" key={entry.id}>
              <div className={`message-sender ${entry.role === "assistant" ? "ai" : ""}`}>
                {entry.role === "assistant" ? "AI interviewer" : "Builder"}
              </div>
              <div className="message-content">{entry.content}</div>
              <div className="message-meta">Round {entry.round_number}</div>
            </article>
          );
          })}
        </div>
      </div>

      {pendingQuestion ? (
        <div className="current-question-panel">
          <article className="message message-current">
            <div className="message-sender ai">AI interviewer</div>
            <div className="message-content">{pendingQuestion.question}</div>
            <div className="message-meta">Round {pendingQuestion.round_number}</div>
          </article>

          {optimisticAnswer ? (
            <div className="choice-stack">
              <article className="message">
                <div className="message-sender">Builder</div>
                <div className="message-content">{optimisticAnswer}</div>
              </article>
              <article className="message thinking-message">
                <div className="message-sender ai">AI interviewer</div>
                <div className="message-content">{isThinking ? "Thinking..." : "Queued..."}</div>
              </article>
            </div>
          ) : (
            <div className="choice-stack">
              {pendingQuestion.suggested_choices.map((choice, index) => (
                <button
                  className={`choice-option${index === 0 ? " recommended" : ""}`}
                  key={choice.key}
                  type="button"
                  onClick={() => void submitChoice(choice)}
                  disabled={isLocked}
                >
                  <span className="choice-index">{index + 1}.</span>
                  <span>
                    {choice.label}
                    {index === 0 ? <span className="choice-recommendation"> (Recommendation)</span> : null}
                  </span>
                </button>
              ))}

              <form className="choice-option choice-option-input" onSubmit={submitFreeText}>
                <span className="choice-index">{pendingQuestion.suggested_choices.length + 1}.</span>
                <textarea
                  className="choice-input"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Type your own answer"
                  disabled={isLocked}
                />
                <button className="choice-send" type="submit" disabled={isLocked || !value.trim()}>
                  {isLocked ? "Sending" : "Send"}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
