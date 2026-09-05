import { assessReadiness, readinessQuestion, contentItems } from "@/lib/readiness";
import { appendBullet, buildInitialSpec, collectPlaceholderWarnings, extractSections, extractTitle, isMeaningfulContent, serializeSpec } from "@/lib/spec";
import { buildClarificationMetrics, calculateOverallAmbiguity, getAmbiguityLabel } from "@/lib/metrics";
import { hasStructuredJsonProvider, requestStructuredJson } from "@/lib/openai";
import { buildSpecUpdateSystemPrompt, buildSpecUpdateUserPrompt, specUpdateSchema } from "@/lib/prompts";
import {
  createSessionSeed,
  deleteSessionRecord,
  getWorkspace,
  insertTranscriptEntry,
  listSessionSummaries,
  saveSessionSnapshot,
} from "@/lib/store";
import type {
  AnswerPayload,
  ClarificationMetrics,
  CreateSessionPayload,
  PendingQuestion,
  PendingQuestionDimension,
  SessionRecord,
  TranscriptEntry,
  WorkspacePayload,
} from "@/types/workspace";


interface SpecUpdateResponse {
  spec_markdown: string;
  warnings: string[];
  open_questions: string[];
}

export async function createSessionWorkspace(payload: CreateSessionPayload): Promise<WorkspacePayload> {
  const title = payload.title.trim();
  const initialIdea = payload.initialIdea?.trim() ?? "";

  if (!title) {
    throw new Error("Session title is required.");
  }

  const specContent = buildInitialSpec(title, initialIdea);
  const session = await createSessionSeed({ title, initialIdea, specContent });
  const transcript: TranscriptEntry[] = [];
  const preMetrics = fallbackScore(session, specContent, transcript);
  const pendingQuestion = await generateNextQuestion(session, transcript);
  const metrics = buildClarificationMetrics({
    specContent,
    ambiguityScore: preMetrics.ambiguity_score,
    goalClarity: preMetrics.goal_clarity,
    constraintClarity: preMetrics.constraint_clarity,
    successCriteriaClarity: preMetrics.success_criteria_clarity,
    goalJustification: preMetrics.goal_justification,
    constraintJustification: preMetrics.constraint_justification,
    successCriteriaJustification: preMetrics.success_criteria_justification,
    modelWarnings: [],
    modelOpenQuestions: [],
    hasPendingQuestion: true,
  });

  await saveSessionSnapshot(session.id, {
    specContent,
    clarificationRound: 0,
    metrics,
    pendingQuestion,
    reconciliationStatus: "idle",
    reconciledRound: 0,
  });
  await insertTranscriptEntry({
    sessionId: session.id,
    role: "assistant",
    entryType: "question",
    content: pendingQuestion.question,
    choices: pendingQuestion.suggested_choices,
    targetDimension: pendingQuestion.target_dimension,
    roundNumber: pendingQuestion.round_number,
  });

  const workspace = await getWorkspace(session.id);
  if (!workspace) {
    throw new Error("Failed to load the created session.");
  }

  return workspace;
}

export async function getSessionWorkspace(sessionId: string): Promise<WorkspacePayload | null> {
  return getWorkspace(sessionId);
}

export async function getSessionSummaries() {
  return listSessionSummaries();
}

export async function deleteSessionWorkspace(sessionId: string): Promise<boolean> {
  return deleteSessionRecord(sessionId);
}

export async function updateSessionDraft(sessionId: string, specContent: string): Promise<WorkspacePayload | null> {
  const workspace = await getWorkspace(sessionId);

  if (!workspace) {
    return null;
  }

  specContent = preserveDecisionHistory(workspace.session.spec_content, specContent);

  const metrics = buildClarificationMetrics({
    specContent,
    ambiguityScore: workspace.metrics.ambiguity_score,
    goalClarity: workspace.metrics.goal_clarity,
    constraintClarity: workspace.metrics.constraint_clarity,
    successCriteriaClarity: workspace.metrics.success_criteria_clarity,
    goalJustification: workspace.metrics.goal_justification,
    constraintJustification: workspace.metrics.constraint_justification,
    successCriteriaJustification: workspace.metrics.success_criteria_justification,
    modelWarnings: [],
    modelOpenQuestions: [],
    hasPendingQuestion: Boolean(workspace.pendingQuestion),
  });

  await saveSessionSnapshot(sessionId, {
    specContent,
    clarificationRound: workspace.session.clarification_round,
    metrics,
    pendingQuestion: workspace.pendingQuestion,
    reconciliationStatus: "idle",
    reconciledRound: workspace.session.reconciled_round,
  });

  return getWorkspace(sessionId);
}

export async function submitSessionAnswer(sessionId: string, payload: AnswerPayload): Promise<WorkspacePayload> {
  const workspace = await getWorkspace(sessionId);
  if (!workspace) {
    throw new Error("Session not found.");
  }

  const pendingQuestion = workspace.pendingQuestion;
  if (!pendingQuestion) {
    throw new Error("This session has no pending clarification question.");
  }

  const answer = payload.answer.trim();
  if (!answer) {
    throw new Error("Answer is required.");
  }

  const userEntry: TranscriptEntry = {
    id: "pending-user-entry",
    role: "user",
    entry_type: "answer",
    content: answer,
    choices: [],
    selected_choice_key: payload.selectedChoiceKey ?? null,
    selected_choice_label: payload.selectedChoiceLabel ?? null,
    target_dimension: pendingQuestion.target_dimension,
    round_number: pendingQuestion.round_number,
    created_at: new Date().toISOString(),
  };
  const transcriptWithAnswer = [...workspace.transcript, userEntry];
  const roundNumber = pendingQuestion.round_number;
  const specUpdate = await rewriteSpecification({
    session: workspace.session,
    transcript: transcriptWithAnswer,
    pendingQuestion,
    answer,
  });
  const nextSession = {
    ...workspace.session,
    spec_content: specUpdate.spec_markdown,
  };
  const canAskNext = !assessReadiness(specUpdate.spec_markdown).ready;
  const preMetrics = fallbackScore(nextSession, specUpdate.spec_markdown, transcriptWithAnswer);
  const candidateNextQuestion = canAskNext ? await generateNextQuestion(nextSession, transcriptWithAnswer, roundNumber + 1) : null;
  const completedMetrics = buildClarificationMetrics({
    specContent: specUpdate.spec_markdown,
    ambiguityScore: preMetrics.ambiguity_score,
    goalClarity: preMetrics.goal_clarity,
    constraintClarity: preMetrics.constraint_clarity,
    successCriteriaClarity: preMetrics.success_criteria_clarity,
    goalJustification: preMetrics.goal_justification,
    constraintJustification: preMetrics.constraint_justification,
    successCriteriaJustification: preMetrics.success_criteria_justification,
    modelWarnings: specUpdate.warnings,
    modelOpenQuestions: specUpdate.open_questions,
    hasPendingQuestion: false,
  });
  const isReady =
    assessReadiness(specUpdate.spec_markdown).ready;
  const nextQuestion = canAskNext && !isReady ? candidateNextQuestion : null;
  const finalMetrics = nextQuestion
    ? buildClarificationMetrics({
        specContent: specUpdate.spec_markdown,
        ambiguityScore: preMetrics.ambiguity_score,
        goalClarity: preMetrics.goal_clarity,
        constraintClarity: preMetrics.constraint_clarity,
        successCriteriaClarity: preMetrics.success_criteria_clarity,
        goalJustification: preMetrics.goal_justification,
        constraintJustification: preMetrics.constraint_justification,
        successCriteriaJustification: preMetrics.success_criteria_justification,
        modelWarnings: specUpdate.warnings,
        modelOpenQuestions: specUpdate.open_questions,
        hasPendingQuestion: true,
      })
    : completedMetrics;

  await saveSessionSnapshot(sessionId, {
    specContent: specUpdate.spec_markdown,
    clarificationRound: roundNumber,
    metrics: finalMetrics,
    pendingQuestion: nextQuestion,
    reconciliationStatus: "idle",
    reconciledRound: roundNumber,
  });
  if (!workspace.transcript.some(entry => entry.role === "assistant" && entry.content === pendingQuestion.question && entry.round_number === roundNumber)) {
    await insertTranscriptEntry({ sessionId, role: "assistant", entryType: "question", content: pendingQuestion.question, choices: [], targetDimension: pendingQuestion.target_dimension, roundNumber });
  }
  await insertTranscriptEntry({
    sessionId,
    role: "user",
    entryType: "answer",
    content: answer,
    selectedChoiceKey: payload.selectedChoiceKey ?? null,
    selectedChoiceLabel: payload.selectedChoiceLabel ?? null,
    targetDimension: pendingQuestion.target_dimension,
    roundNumber,
  });

  if (nextQuestion) {
    await insertTranscriptEntry({
      sessionId,
      role: "assistant",
      entryType: "question",
      content: nextQuestion.question,
      choices: nextQuestion.suggested_choices,
      targetDimension: nextQuestion.target_dimension,
      roundNumber: nextQuestion.round_number,
    });
  }

  const updated = await getWorkspace(sessionId);
  if (!updated) {
    throw new Error("Updated session could not be loaded.");
  }

  return updated;
}

async function generateNextQuestion(session: SessionRecord, transcript: TranscriptEntry[], roundNumber = 1): Promise<PendingQuestion> {
  const question = readinessQuestion(session.spec_content, roundNumber, transcript.filter(entry => entry.role === "assistant").map(entry => entry.content));
  if (!question) throw new Error("No implementation blocker remains.");
  return question;
}

async function rewriteSpecification(input: {
  session: SessionRecord;
  transcript: TranscriptEntry[];
  pendingQuestion: PendingQuestion;
  answer: string;
}): Promise<SpecUpdateResponse> {
  if (hasStructuredJsonProvider()) {
    try {
      const result = await requestStructuredJson<SpecUpdateResponse>({
        task: "spec_rewrite",
        schemaName: "spec_update",
        schema: specUpdateSchema as Record<string, unknown>,
        systemPrompt: buildSpecUpdateSystemPrompt(),
        messages: [
          {
            role: "user",
            content: buildSpecUpdateUserPrompt({
              title: input.session.title,
              specContent: input.session.spec_content,
              question: input.pendingQuestion.question,
              answer: input.answer,
              transcript: input.transcript,
              targetDimension: input.pendingQuestion.target_dimension,
            }),
          },
        ],
      });

      let canonical = canonicalizeSpec(
        input.session.title,
        result.spec_markdown,
        input.session.spec_content
      );

      const findings = [...(Array.isArray(result.warnings) ? result.warnings : []), ...(Array.isArray(result.open_questions) ? result.open_questions : [])]
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()) && !/^(none|no (?:critical )?open questions remain)[.!]?$/i.test(item.trim()));
      if (findings.length) {
        const sections = extractSections(canonical);
        for (const finding of findings) {
          if (!sections["Open Questions"].includes(finding)) sections["Open Questions"] = appendBullet(sections["Open Questions"], /^\[(?:non-)?blocker\]/i.test(finding) ? finding : `[blocker] ${finding}`);
        }
        canonical = serializeSpec(input.session.title, sections);
      }
      return {
        spec_markdown: canonical,
        warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : [],
        open_questions: Array.isArray(result.open_questions) ? result.open_questions.slice(0, 8) : [],
      };
    } catch (error) {
      console.error("[Prism] spec rewrite failed, using fallback spec update.", error);
      return fallbackSpecUpdate(input.session, input.pendingQuestion, input.answer);
    }
  }

  return fallbackSpecUpdate(input.session, input.pendingQuestion, input.answer);
}

function fallbackScore(session: SessionRecord, specContent: string, transcript: TranscriptEntry[]): ClarificationMetrics {
  const assessment = assessReadiness(specContent);
  const confirmed = (section: string) => assessment.evidence.some(item => item.section === section) ? 1 : 0;
  const goalClarity = (confirmed("Users") + confirmed("Problem") + confirmed("Goals")) / 3;
  const constraintClarity = (confirmed("Constraints") + confirmed("Non-Goals")) / 2;
  const successCriteriaClarity = confirmed("Success Criteria");

  const ambiguityScore = calculateOverallAmbiguity({
    goalClarity,
    constraintClarity,
    successCriteriaClarity,
  });

  return {
    readiness: 0,
    structure: 0,
    ambiguity: getAmbiguityLabel(ambiguityScore),
    warnings: 0,
    open_questions: 0,
    overall_score: 0,
    ambiguity_score: ambiguityScore,
    goal_clarity: goalClarity,
    constraint_clarity: constraintClarity,
    success_criteria_clarity: successCriteriaClarity,
    goal_justification: "Current-spec checks for users, problem, and scope.",
    constraint_justification: "Current-spec checks for constraints and scope exclusions.",
    success_criteria_justification: "Current-spec checks for observable acceptance behavior.",
  };
}

function fallbackSpecUpdate(
  session: SessionRecord,
  pendingQuestion: PendingQuestion,
  answer: string
): SpecUpdateResponse {
  const sections = extractSections(session.spec_content);
  const answerBullet = answer.trim();
  const issue = assessReadiness(session.spec_content).blockers[0];
  const targetSection = issue?.section ?? targetDimensionToSection(pendingQuestion.target_dimension);

  if (targetSection === "Decisions" && /\b(?:not sure|don.t know|do not know|maybe|undecided|later)\b/i.test(answerBullet)) {
    sections.Assumptions = appendBullet(sections.Assumptions, `Unresolved decision answer: ${answerBullet}`);
  } else if (targetSection === "Decisions") {
    sections["Decision History"] = appendBullet(sections["Decision History"], `Superseded after round ${pendingQuestion.round_number}: ${sections.Decisions}`);
    sections.Decisions = answerBullet;
  } else if (targetSection === "Open Questions") {
    // A free-form answer is evidence, not automatic proof that a blocker is resolved.
    sections.Assumptions = appendBullet(sections.Assumptions, `Unverified answer to ${issue?.reason}: ${answerBullet}. Confirm the resolution in the draft and remove the resolved Open Question.`);
  } else {
    sections[targetSection] = answerBullet;
  }

  if (!isMeaningfulContent(sections.Overview)) {
    sections.Overview = answer.trim();
  }

  // Remove only the placeholder questions tied to the section just answered.
  sections["Open Questions"] = sections["Open Questions"].split("\n").filter(line =>
    !line.toLowerCase().replace(/^[-*]\s*/, "").startsWith(`${targetSection.toLowerCase()} still needs detail`)
  ).join("\n");
  if (!isMeaningfulContent(sections["Open Questions"])) sections["Open Questions"] = "None.";
  const remainingSections = assessReadiness(serializeSpec(session.title, sections)).blockers.map(issue => issue.reason);

  const spec_markdown = serializeSpec(extractTitle(session.spec_content), sections);

  return {
    spec_markdown,
    warnings: collectPlaceholderWarnings(spec_markdown).slice(0, 8),
    open_questions: remainingSections,
  };
}

function canonicalizeSpec(title: string, candidate: string, previous: string): string {
  const previousSections = extractSections(previous);
  const nextSections = extractSections(candidate);
  const merged = { ...previousSections };

  for (const [section, content] of Object.entries(nextSections)) {
    if (content.trim()) {
      merged[section as keyof typeof merged] = content;
    }
  }

  const removed = contentItems(previousSections.Decisions).filter(item => isMeaningfulContent(item) && !contentItems(merged.Decisions).includes(item));
  const history = [previousSections["Decision History"], merged["Decision History"], ...removed.map(item => `- Superseded: ${item}`)].filter(value => value && value !== "None.");
  merged["Decision History"] = [...new Set(history)].join("\n") || "None.";
  return serializeSpec(title, merged);
}

function targetDimensionToSection(target: PendingQuestionDimension): keyof ReturnType<typeof extractSections> {
  switch (target) {
    case "goal":
      return "Goals";
    case "constraints":
      return "Constraints";
    case "success_criteria":
      return "Success Criteria";
    case "context":
    default:
      return "Decisions";
  }
}

// Keep historical decisions even when a draft or model replaces the active set.
function preserveDecisionHistory(previous: string, next: string): string {
  const before = extractSections(previous);
  const after = extractSections(next);
  const removed = contentItems(before.Decisions).filter(item => isMeaningfulContent(item) && item !== "None." && !contentItems(after.Decisions).includes(item));
  const history = [...new Set([...contentItems(before["Decision History"]), ...contentItems(after["Decision History"]), ...removed.map(item => `Superseded: ${item}`)])].filter(item => item && item !== "None.");
  if (!history.length) return next;
  const body = history.map(item => `- ${item}`).join("\n");
  if (/^## Decision History\s*$/m.test(next)) return next.replace(/^## Decision History\s*\n[\s\S]*?(?=^## |$(?![\s\S]))/m, `## Decision History\n\n${body}\n\n`);
  return `${next.trim()}\n\n## Decision History\n\n${body}\n`;
}
