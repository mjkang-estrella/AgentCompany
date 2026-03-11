"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { WorkspacePayload } from "@/types/workspace";

interface SpecEditorProps {
  workspace: WorkspacePayload | null;
  isSaving: boolean;
  isLocked: boolean;
  isResearchStarting: boolean;
  onSaveDraft: (specContent: string) => Promise<void>;
  onExport: () => Promise<void> | void;
  onRunResearch: () => Promise<void> | void;
  onDownloadResearch: () => void;
}

const MAX_UNDO_STACK = 50;

export default function SpecEditor({
  workspace,
  isSaving,
  isLocked,
  isResearchStarting,
  onSaveDraft,
  onExport,
  onRunResearch,
  onDownloadResearch,
}: SpecEditorProps) {
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [documentView, setDocumentView] = useState<"spec" | "research">("spec");
  const [draft, setDraft] = useState("");
  const [highlightedMetrics, setHighlightedMetrics] = useState<Record<string, boolean>>({});
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushedRef = useRef("");
  const metricFlashTimeouts = useRef<number[]>([]);
  const previousMetricValues = useRef<Record<string, string> | null>(null);
  const activeSessionId = workspace?.session.id ?? null;
  const activeSpecContent = workspace?.session.spec_content ?? "";
  const readinessValue = workspace ? `${workspace.metrics.readiness}%` : "—";
  const structureValue = workspace ? `${workspace.metrics.structure}%` : "—";
  const ambiguityValue = workspace?.metrics.ambiguity ?? "—";
  const warningsValue = workspace ? String(workspace.metrics.warnings) : "—";
  const openQuestionsValue = workspace ? String(workspace.metrics.open_questions) : "—";
  const overallScoreValue = workspace ? `${workspace.metrics.overall_score}%` : "—";
  const researchStatus = workspace?.marketReport?.status ?? "idle";
  const isResearchRunning = researchStatus === "pending" || researchStatus === "running";
  const hasResearchReport = Boolean(workspace?.marketReport?.markdown_content);
  const researchDisabledReason = !workspace
    ? "Create or select a session to unlock research."
    : !workspace.researchConfigured
      ? "Configure EXA_API_KEY to enable market research."
      : workspace.metrics.overall_score < 80
        ? "Unlocks at 80% clarity."
        : isLocked
          ? "Wait for the current spec update to finish."
          : "";
  const canRunResearch = Boolean(
    workspace &&
    workspace.researchConfigured &&
    workspace.metrics.overall_score >= 80 &&
    !isLocked &&
    !isResearchStarting &&
    !isResearchRunning
  );
  const researchButtonLabel = isResearchRunning
    ? "Researching…"
    : hasResearchReport
      ? "Refresh Research"
      : "Research Market";

  // Sync draft from workspace (AI updates or session switch)
  useEffect(() => {
    const incoming = activeSpecContent;
    setDraft(incoming);
    // Push previous draft to undo stack when AI overwrites
    if (lastPushedRef.current && lastPushedRef.current !== incoming) {
      undoStack.current.push(lastPushedRef.current);
      if (undoStack.current.length > MAX_UNDO_STACK) {
        undoStack.current.shift();
      }
      redoStack.current = [];
    }
    lastPushedRef.current = incoming;
  }, [activeSessionId, activeSpecContent]);

  useEffect(() => {
    metricFlashTimeouts.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    metricFlashTimeouts.current = [];
    previousMetricValues.current = null;
    setHighlightedMetrics({});

    return () => {
      metricFlashTimeouts.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      metricFlashTimeouts.current = [];
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!workspace) {
      setDocumentView("spec");
      return;
    }

    if (documentView === "research" && !workspace.marketReport && !workspace.researchConfigured && workspace.metrics.overall_score < 80) {
      setDocumentView("spec");
    }
  }, [documentView, workspace]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const nextValues: Record<string, string> = {
      readiness: readinessValue,
      structure: structureValue,
      ambiguity: ambiguityValue,
      warnings: warningsValue,
      open_questions: openQuestionsValue,
      overall_score: overallScoreValue,
    };
    const previousValues = previousMetricValues.current;

    if (previousValues) {
      const changedKeys = Object.keys(nextValues).filter((key) => previousValues[key] !== nextValues[key]);

      if (changedKeys.length > 0) {
        setHighlightedMetrics((current) => {
          const next = { ...current };
          for (const key of changedKeys) {
            next[key] = true;
          }
          return next;
        });

        for (const key of changedKeys) {
          const timeoutId = window.setTimeout(() => {
            setHighlightedMetrics((current) => {
              const next = { ...current };
              delete next[key];
              return next;
            });
          }, 1400);
          metricFlashTimeouts.current.push(timeoutId);
        }
      }
    }

    previousMetricValues.current = nextValues;
  }, [
    activeSessionId,
    ambiguityValue,
    openQuestionsValue,
    overallScoreValue,
    readinessValue,
    structureValue,
    warningsValue,
  ]);

  const handleChange = useCallback((value: string) => {
    // Push current draft to undo before changing
    undoStack.current.push(draft);
    if (undoStack.current.length > MAX_UNDO_STACK) {
      undoStack.current.shift();
    }
    redoStack.current = [];
    setDraft(value);
    lastPushedRef.current = value;
  }, [draft]);

  const handleUndo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (previous === undefined) return;
    redoStack.current.push(draft);
    setDraft(previous);
    lastPushedRef.current = previous;
  }, [draft]);

  const handleRedo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(draft);
    setDraft(next);
    lastPushedRef.current = next;
  }, [draft]);

  // Keyboard shortcut for undo/redo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (mode !== "edit") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (mod && e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, handleUndo, handleRedo]);

  // Auto-save debounce
  useEffect(() => {
    if (!activeSessionId || isLocked || draft === activeSpecContent) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void onSaveDraft(draft);
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [activeSessionId, activeSpecContent, draft, isLocked, onSaveDraft]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  const researchUpdatedAt = workspace?.marketReport?.generated_at
    ? new Date(workspace.marketReport.generated_at).toLocaleString()
    : null;

  return (
    <section className="panel panel-mid">
      <div className="panel-header">
        <h3>Live Specification</h3>
        <div className="editor-status">
          {workspace?.session.is_ready ? <span className="pill ready">Ready</span> : null}
          <span className={`micro-text ${isSaving ? "accent-text" : "muted-text"}`}>
            {documentView === "research"
              ? isResearchRunning
                ? "Researching market"
                : workspace?.marketReport?.status === "failed"
                  ? "Research failed"
                  : workspace?.marketReport?.generated_at
                    ? `Updated ${researchUpdatedAt}`
                    : "Research idle"
              : isSaving
                ? "Saving"
                : workspace && workspace.session.reconciliation_status !== "idle"
                  ? "Updating spec"
                  : workspace
                    ? `Round ${workspace.session.clarification_round}`
                    : "Idle"}
          </span>
        </div>
      </div>

      <div className="metrics-bar">
        <Metric label="Readiness" value={readinessValue} highlighted={Boolean(highlightedMetrics.readiness)} />
        <Metric label="Structure" value={structureValue} highlighted={Boolean(highlightedMetrics.structure)} />
        <Metric label="Ambiguity" value={ambiguityValue} warn={workspace?.metrics.ambiguity === "High"} highlighted={Boolean(highlightedMetrics.ambiguity)} />
        <Metric label="Warnings" value={warningsValue} warn={(workspace?.metrics.warnings ?? 0) > 0} highlighted={Boolean(highlightedMetrics.warnings)} />
        <Metric label="Open Questions" value={openQuestionsValue} warn={(workspace?.metrics.open_questions ?? 0) > 0} highlighted={Boolean(highlightedMetrics.open_questions)} />
        <Metric label="Clarification Score" value={overallScoreValue} highlighted={Boolean(highlightedMetrics.overall_score)} />
      </div>

      <div className="editor-toolbar">
        <div className="editor-actions">
          <button
            className={`toggle-button${documentView === "spec" ? " active" : ""}`}
            type="button"
            onClick={() => setDocumentView("spec")}
            disabled={!workspace}
          >
            Specification
          </button>
          <button
            className={`toggle-button${documentView === "research" ? " active" : ""}`}
            type="button"
            onClick={() => setDocumentView("research")}
            disabled={!workspace}
          >
            Market Research
          </button>
        </div>

        <div className="editor-actions">
          {documentView === "spec" ? (
            <>
              <button
                className={`toggle-button${mode === "edit" ? " active" : ""}`}
                type="button"
                onClick={() => setMode("edit")}
                disabled={!workspace || isLocked}
              >
                Edit
              </button>
              <button
                className={`toggle-button${mode === "preview" ? " active" : ""}`}
                type="button"
                onClick={() => setMode("preview")}
                disabled={!workspace || isLocked}
              >
                Preview
              </button>
              {mode === "edit" ? (
                <>
                  <button
                    className="toggle-button"
                    type="button"
                    onClick={handleUndo}
                    disabled={!canUndo || isLocked}
                    title="Undo (Ctrl+Z)"
                  >
                    Undo
                  </button>
                  <button
                    className="toggle-button"
                    type="button"
                    onClick={handleRedo}
                    disabled={!canRedo || isLocked}
                    title="Redo (Ctrl+Shift+Z)"
                  >
                    Redo
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <span className="micro-text muted-text">
              Research report is read-only.
            </span>
          )}
        </div>

        <div className="editor-actions">
          {documentView === "research" && researchDisabledReason ? (
            <span className="micro-text muted-text">{researchDisabledReason}</span>
          ) : workspace && isLocked ? (
            <span className="micro-text accent-text">AI is updating the spec</span>
          ) : null}
          <button
            className={`toggle-button${canRunResearch ? " active" : ""}`}
            type="button"
            onClick={() => void onRunResearch()}
            disabled={!canRunResearch}
            title={researchDisabledReason}
          >
            {researchButtonLabel}
          </button>
          <button
            className="toggle-button"
            type="button"
            onClick={onDownloadResearch}
            disabled={!hasResearchReport}
          >
            Download Research
          </button>
          <button
            className={`export-button${workspace?.session.is_ready ? " ready" : ""}`}
            type="button"
            onClick={() => void onExport()}
            disabled={!workspace?.session.is_ready || isLocked}
          >
            Export Bundle
          </button>
        </div>
      </div>

      <div className="spec-shell">
        <div className="spec-editor-wrap">
          {!workspace ? (
            <div className="empty-state">Select or create a session to open the editable specification.</div>
          ) : documentView === "research" ? (
            workspace.marketReport?.status === "failed" && !workspace.marketReport.markdown_content ? (
              <div className="empty-state">
                <strong>Market research failed.</strong>
                <br />
                {workspace.marketReport.error_message || "No report was generated."}
              </div>
            ) : workspace.marketReport?.markdown_content ? (
              <div className="spec-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {workspace.marketReport.markdown_content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="empty-state">
                {isResearchRunning
                  ? "Researching the market and compiling the report…"
                  : "Run Market Research to generate an evidence-backed report for this session."}
              </div>
            )
          ) : mode === "edit" ? (
            <textarea
              className="spec-textarea"
              value={draft}
              onChange={(event) => handleChange(event.target.value)}
              spellCheck={false}
              disabled={isLocked}
            />
          ) : (
            <div className="spec-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {draft}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  warn = false,
  highlighted = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div className={`metric-readout${highlighted ? " highlighted" : ""}`}>
      <span className="metric-label">{label}</span>
      <span className={`metric-value${warn ? " warning" : ""}`}>{value}</span>
    </div>
  );
}
