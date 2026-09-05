import { assessReadiness } from "@/lib/readiness";
import { extractOpenQuestionItems, extractSections, isMeaningfulContent } from "@/lib/spec";
import type { WorkspacePayload } from "@/types/workspace";

function formatSection(value: string, fallback = "_None specified._"): string {
  return isMeaningfulContent(value) ? value.trim() : fallback;
}

function ensureBulletedList(value: string, fallbackItems: string[] = []): string {
  const normalized = value.trim();

  if (isMeaningfulContent(normalized) && /^([-*]|\d+\.)\s+/m.test(normalized)) {
    return normalized;
  }

  if (isMeaningfulContent(normalized)) {
    return `- ${normalized.replace(/^[-*]\s+/, "").trim()}`;
  }

  if (fallbackItems.length > 0) {
    return fallbackItems.map((item) => `- ${item}`).join("\n");
  }

  return "- None specified.";
}

function buildAcceptanceCriteria(workspace: WorkspacePayload): string {
  const sections = extractSections(workspace.session.spec_content);
  const candidates = [sections["Success Criteria"], sections.Goals]
    .map((section) => ensureBulletedList(section))
    .filter(Boolean);

  return candidates[0] ?? "- None specified.";
}

function buildOpenQuestions(workspace: WorkspacePayload): string {
  const openQuestions = extractOpenQuestionItems(workspace.session.spec_content);
  if (
    openQuestions.length === 0 ||
    openQuestions.every((item) => /^none\.?$/i.test(item.trim()))
  ) {
    return "- None.";
  }

  return openQuestions.map((item) => `- ${item}`).join("\n");
}

function buildAgentHandoff(workspace: WorkspacePayload): string {
  const sections = extractSections(workspace.session.spec_content);

  return [
    "# Agent Handoff",
    "",
    "## Project Snapshot",
    `- Title: ${workspace.session.title}`,
    `- Clarification score: ${workspace.metrics.overall_score}%`,
    `- Ambiguity: ${workspace.metrics.ambiguity}`,
    `- Clarification round: ${workspace.session.clarification_round}`,
    `- Last updated: ${workspace.session.updated_at}`,
    "",
    "## Goal",
    formatSection(sections.Overview, workspace.session.initial_idea || "_No overview captured._"),
    "",
    "## Problem",
    formatSection(sections.Problem),
    "",
    "## Users",
    formatSection(sections.Users),
    "",
    "## In Scope",
    ensureBulletedList(sections.Goals),
    "",
    "## Out Of Scope",
    ensureBulletedList(sections["Non-Goals"]),
    "",
    "## Constraints",
    ensureBulletedList(sections.Constraints),
    "",
    "## Acceptance Criteria",
    buildAcceptanceCriteria(workspace),
    "",
    "## Active Decisions",
    ensureBulletedList(sections.Decisions),
    "",
    "## Decision History (not active requirements)",
    formatSection(sections["Decision History"]),
    "",
    "## Assumptions (unverified)",
    formatSection(sections.Assumptions),
    "",
    "## Open Questions",
    buildOpenQuestions(workspace),
    "",
    "## Handoff Guidance",
    "- Treat the source spec above as the source of truth.",
    "- Decision History records superseded choices, not active requirements. Do not resolve contradictory active requirements by guessing.",
    "- Resolve remaining open questions before implementation if they block core behavior.",
  ].join("\n");
}

function buildImplementationPrompt(workspace: WorkspacePayload): string {
  const assessment = assessReadiness(workspace.session.spec_content);
  const sections = extractSections(workspace.session.spec_content);

  return [
    assessment.ready ? "Implement the project described below." : "Review this draft. Resolve the implementation blockers before writing product code.",
    `Readiness: ${assessment.ready ? "Ready for implementation review" : "Blocked"}`,
    "Implementation blockers:",
    ...(assessment.blockers.length ? assessment.blockers.map(issue => `- ${issue.section}: ${issue.reason}`) : ["- None detected."]),
    "",
    "Use the specification and handoff notes as the source of truth.",
    "",
    `Project title: ${workspace.session.title}`,
    "",
    "Goal:",
    formatSection(sections.Overview, workspace.session.initial_idea || "No overview provided."),
    "",
    "Problem:",
    formatSection(sections.Problem, "No explicit problem statement provided."),
    "",
    "Target users:",
    formatSection(sections.Users, "No explicit user definition provided."),
    "",
    "In scope:",
    ensureBulletedList(sections.Goals),
    "",
    "Out of scope:",
    ensureBulletedList(sections["Non-Goals"]),
    "",
    "Constraints:",
    ensureBulletedList(sections.Constraints),
    "",
    "Acceptance criteria:",
    buildAcceptanceCriteria(workspace),
    "",
    "Active decisions:",
    ensureBulletedList(sections.Decisions),
    "",
    "Assumptions (unverified):",
    formatSection(sections.Assumptions),
    "",
    "Open questions:",
    buildOpenQuestions(workspace),
    "",
    "Execution requirements:",
    "- Start by inspecting the existing codebase and identifying the smallest coherent implementation path.",
    "- Preserve established patterns unless the spec explicitly requires a change.",
    "- Implement the feature end-to-end, including tests and verification.",
    "- If a remaining open question blocks implementation, surface it explicitly before proceeding.",
    "- Return a concise summary of what changed, what was verified, and any residual risks.",
  ].join("\n");
}

export function buildExportBundle(workspace: WorkspacePayload): string {
  const assessment = assessReadiness(workspace.session.spec_content);
  return [
    `> ${assessment.ready ? "READY FOR IMPLEMENTATION REVIEW" : "DRAFT: NOT READY FOR IMPLEMENTATION"}`,
    `> ${assessment.reason}`,
    "",
    "## Implementation blockers",
    ...(assessment.blockers.length ? assessment.blockers.map(issue => `- [blocker] ${issue.section}: ${issue.reason}`) : ["- None detected."]),
    "",
    "## Non-blocking follow-ups",
    ...assessment.nonBlockers.map(item => `- ${item}`),
    "",
    workspace.session.spec_content.trim(),
    "",
    "---",
    "",
    buildAgentHandoff(workspace),
    "",
    "---",
    "",
    "# Codex / Claude Code Prompt",
    "",
    "```text",
    buildImplementationPrompt(workspace),
    "```",
    "",
  ].join("\n");
}
