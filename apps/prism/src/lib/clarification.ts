import { appendBullet, buildInitialSpec, collectPlaceholderWarnings, extractSections, extractTitle, isMeaningfulContent, serializeSpec } from "@/lib/spec";
import { buildClarificationMetrics, calculateOverallAmbiguity, getAmbiguityLabel } from "@/lib/metrics";
import { hasStructuredJsonProvider, requestStructuredJson } from "@/lib/openai";
import { buildSupportingSpecContext, isQuestionTooSimilar } from "@/lib/questioning";
import {
  buildInterviewContext,
  buildQuestionSystemPrompt,
  buildQuestionUserPrompt,
  buildScoringSystemPrompt,
  buildScoringUserPrompt,
  buildSpecUpdateSystemPrompt,
  buildSpecUpdateUserPrompt,
  questionSchema,
  scoringSchema,
  specUpdateSchema,
} from "@/lib/prompts";
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

const MAX_CLARIFICATION_ROUNDS = 12;
const MAX_QUESTION_GENERATION_ATTEMPTS = 3;

interface ScoreResponse {
  goal_clarity_score: number;
  goal_clarity_justification: string;
  constraint_clarity_score: number;
  constraint_clarity_justification: string;
  success_criteria_clarity_score: number;
  success_criteria_clarity_justification: string;
}

interface SpecUpdateResponse {
  spec_markdown: string;
  warnings: string[];
  open_questions: string[];
}

interface QuestionResponse {
  question: string;
  suggested_choices: Array<{ key: string; label: string }>;
  target_dimension: PendingQuestionDimension;
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
  const baselineMetrics = fallbackScore(session, specContent, transcript);
  const [preMetrics, pendingQuestion] = await Promise.all([
    scoreWorkspace({
      session,
      transcript,
      specContent,
    }),
    generateNextQuestion(session, transcript, baselineMetrics),
  ]);
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
  const canAskNext = roundNumber < MAX_CLARIFICATION_ROUNDS;
  const questionMetrics = fallbackScore(
    nextSession,
    specUpdate.spec_markdown,
    transcriptWithAnswer
  );
  const [preMetrics, candidateNextQuestion] = await Promise.all([
    scoreWorkspace({
      session: nextSession,
      transcript: transcriptWithAnswer,
      specContent: specUpdate.spec_markdown,
    }),
    canAskNext
      ? generateNextQuestion(
          nextSession,
          transcriptWithAnswer,
          questionMetrics,
          roundNumber + 1
        )
      : Promise.resolve(null),
  ]);
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
    completedMetrics.overall_score >= 80 && completedMetrics.ambiguity === "Low";
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

async function scoreWorkspace(input: {
  session: SessionRecord;
  transcript: TranscriptEntry[];
  specContent: string;
}): Promise<ClarificationMetrics> {
  const initialContext = input.session.initial_idea || input.session.title;

  if (hasStructuredJsonProvider()) {
    try {
      const result = await requestStructuredJson<ScoreResponse>({
        task: "ambiguity_scoring",
        schemaName: "clarification_score",
        schema: scoringSchema as Record<string, unknown>,
        systemPrompt: buildScoringSystemPrompt(false),
        messages: [
          {
            role: "user",
            content: buildScoringUserPrompt(buildInterviewContext(initialContext, input.transcript)),
          },
        ],
      });

      const ambiguityScore = calculateOverallAmbiguity({
        goalClarity: clamp01(result.goal_clarity_score),
        constraintClarity: clamp01(result.constraint_clarity_score),
        successCriteriaClarity: clamp01(result.success_criteria_clarity_score),
      });

      return {
        readiness: 0,
        structure: 0,
        ambiguity: getAmbiguityLabel(ambiguityScore),
        warnings: 0,
        open_questions: 0,
        overall_score: 0,
        ambiguity_score: ambiguityScore,
        goal_clarity: clamp01(result.goal_clarity_score),
        constraint_clarity: clamp01(result.constraint_clarity_score),
        success_criteria_clarity: clamp01(result.success_criteria_clarity_score),
        goal_justification: result.goal_clarity_justification,
        constraint_justification: result.constraint_clarity_justification,
        success_criteria_justification: result.success_criteria_clarity_justification,
      };
    } catch (error) {
      console.error("[Prism] scoring failed, using fallback scorer.", error);
      return fallbackScore(input.session, input.specContent, input.transcript);
    }
  }

  return fallbackScore(input.session, input.specContent, input.transcript);
}

async function generateNextQuestion(
  session: SessionRecord,
  transcript: TranscriptEntry[],
  metrics: ClarificationMetrics,
  roundNumber = 1
): Promise<PendingQuestion> {
  const previousAssistantQuestions = transcript
    .filter((entry) => entry.role === "assistant" && entry.entry_type === "question")
    .map((entry) => entry.content);
  const recentAssistantQuestions = previousAssistantQuestions.slice(-12);
  const supportingSpecContext = buildSupportingSpecContext(session.spec_content);
  const rejectedQuestions: string[] = [];

  if (hasStructuredJsonProvider()) {
    try {
      for (let attempt = 0; attempt < MAX_QUESTION_GENERATION_ATTEMPTS; attempt += 1) {
        const response = await requestStructuredJson<QuestionResponse>({
          task: "question_generation",
          schemaName: "clarification_question",
          schema: questionSchema as Record<string, unknown>,
          systemPrompt: buildQuestionSystemPrompt(session.initial_idea || session.title, roundNumber),
          messages: [
            {
              role: "user",
              content: buildQuestionUserPrompt({
                supportingSpecContext,
                transcript,
                metrics,
                roundNumber,
                recentAssistantQuestions,
                rejectedQuestions,
              }),
            },
          ],
        });

        const candidate = normalizeQuestion(response, metrics, roundNumber);
        if (candidate.suggested_choices.length < 2) {
          candidate.suggested_choices = fallbackQuestion(
            metrics,
            session.spec_content,
            roundNumber,
            previousAssistantQuestions
          ).suggested_choices;
        }
        if (!isQuestionTooSimilar(candidate.question, previousAssistantQuestions)) {
          return candidate;
        }

        rejectedQuestions.push(candidate.question);
      }

      return fallbackQuestion(metrics, session.spec_content, roundNumber, previousAssistantQuestions);
    } catch (error) {
      console.error("[Prism] question generation failed, using fallback question.", error);
      return fallbackQuestion(metrics, session.spec_content, roundNumber, previousAssistantQuestions);
    }
  }

  return fallbackQuestion(metrics, session.spec_content, roundNumber, previousAssistantQuestions);
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

      const canonical = canonicalizeSpec(
        input.session.title,
        result.spec_markdown,
        input.session.spec_content
      );

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
  const sections = extractSections(specContent);
  const answerCount = transcript.filter((entry) => entry.role === "user").length;
  const goalText = [session.initial_idea, sections.Overview, sections.Problem, sections.Goals].join("\n");
  const constraintText = [sections.Constraints, sections["Non-Goals"]].join("\n");
  const successText = sections["Success Criteria"];
  const goalClarity = heuristicSectionScore(goalText, false, answerCount);
  const constraintClarity = heuristicSectionScore(constraintText, false, answerCount);
  const successCriteriaClarity = heuristicSectionScore(successText, true, answerCount);

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
    goal_justification: "Fallback heuristic based on the specificity of the overview, problem, and goals sections.",
    constraint_justification: "Fallback heuristic based on how concrete the constraints and non-goals are.",
    success_criteria_justification: "Fallback heuristic based on whether success criteria are concrete and measurable.",
  };
}

function fallbackQuestion(
  metrics: ClarificationMetrics,
  specContent: string,
  roundNumber: number,
  recentQuestions: string[] = []
): PendingQuestion {
  const sections = extractSections(specContent);
  const dimension = lowestClarityDimension(metrics);

  if (roundNumber === 1) {
    return {
      question: "What is the single most important outcome this project needs to achieve first?",
      target_dimension: "goal",
      round_number: 1,
      suggested_choices: [
        { key: "prototype", label: "Ship a working prototype quickly" },
        { key: "automation", label: "Automate an existing manual workflow" },
        { key: "validation", label: "Validate demand before building deeply" },
      ],
    };
  }

  const prompts: Record<PendingQuestionDimension, PendingQuestion> = {
    goal: {
      question: "What specifically should feel different for the user or business once this is working?",
      target_dimension: "goal",
      round_number: roundNumber,
      suggested_choices: [
        { key: "speed", label: "The workflow becomes faster" },
        { key: "quality", label: "The output becomes more reliable" },
        { key: "revenue", label: "It directly creates or protects revenue" },
      ],
    },
    constraints: {
      question: "What constraints are real here: existing stack, budget, timeline, compliance, or team capacity?",
      target_dimension: "constraints",
      round_number: roundNumber,
      suggested_choices: [
        { key: "existing-stack", label: "Stay inside the current stack" },
        { key: "time", label: "Time-to-ship matters most" },
        { key: "budget", label: "Budget and scope need to stay tight" },
      ],
    },
    success_criteria: {
      question: "How will you decide that this spec is successful enough to implement or ship?",
      target_dimension: "success_criteria",
      round_number: roundNumber,
      suggested_choices: [
        { key: "checklist", label: "A clear feature checklist is enough" },
        { key: "metric", label: "It needs measurable target metrics" },
        { key: "handoff", label: "It must be unambiguous for engineering handoff" },
      ],
    },
    context: {
      question: "What existing product context or decisions should this spec assume instead of redefining from scratch?",
      target_dimension: "context",
      round_number: roundNumber,
      suggested_choices: [
        { key: "new", label: "Treat it as a fresh product idea" },
        { key: "existing", label: "Fit it into an existing product" },
        { key: "hybrid", label: "It extends something that already exists" },
      ],
    },
  };

  let candidate = prompts[dimension];
  const openQuestions = collectPlaceholderWarnings(specContent);
  if (dimension === "constraints" && isMeaningfulContent(sections.Constraints)) {
    candidate = prompts.success_criteria;
  }
  if (openQuestions.length === 0 && dimension !== "success_criteria") {
    candidate = prompts.success_criteria;
  }

  const additionalCandidates: PendingQuestion[] = [
    {
      question: "Which user should benefit first, and what are they unable to do today?",
      target_dimension: "goal",
      round_number: roundNumber,
      suggested_choices: [
        { key: "individual", label: "One individual user with a recurring problem" },
        { key: "small-team", label: "A small team coordinating the same workflow" },
        { key: "operator", label: "An operator making a repeated decision" },
      ],
    },
    {
      question: "What decision or next action should this product make easier?",
      target_dimension: "goal",
      round_number: roundNumber,
      suggested_choices: [
        { key: "prioritize", label: "Prioritize what deserves attention" },
        { key: "approve", label: "Make a clear go or no-go decision" },
        { key: "handoff", label: "Hand work to the next person with less ambiguity" },
      ],
    },
    {
      question: "What is the hardest limit the first version cannot change?",
      target_dimension: "constraints",
      round_number: roundNumber,
      suggested_choices: [
        { key: "time-limit", label: "It must ship within a short timeline" },
        { key: "data-limit", label: "It must work with limited or imperfect data" },
        { key: "integration-limit", label: "It must fit the tools users already have" },
      ],
    },
    {
      question: "Which data, privacy, or integration requirement could block launch?",
      target_dimension: "constraints",
      round_number: roundNumber,
      suggested_choices: [
        { key: "sensitive-data", label: "The workflow includes sensitive data" },
        { key: "source-access", label: "Reliable access to source data is uncertain" },
        { key: "existing-tools", label: "The product must connect to existing tools" },
      ],
    },
    {
      question: "What observable result would prove the first version is useful?",
      target_dimension: "success_criteria",
      round_number: roundNumber,
      suggested_choices: [
        { key: "time-saved", label: "Users complete the workflow in less time" },
        { key: "better-output", label: "Users produce a more accurate result" },
        { key: "repeat-use", label: "Users return and use it repeatedly" },
      ],
    },
    {
      question: "What must a new user accomplish in their first session?",
      target_dimension: "success_criteria",
      round_number: roundNumber,
      suggested_choices: [
        { key: "first-output", label: "Produce one useful output" },
        { key: "first-decision", label: "Make one informed decision" },
        { key: "first-setup", label: "Connect their data and finish setup" },
      ],
    },
    {
      question: "Where should this fit in the user's current workflow?",
      target_dimension: "context",
      round_number: roundNumber,
      suggested_choices: [
        { key: "before-work", label: "Before the current workflow begins" },
        { key: "inside-work", label: "Inside an existing tool or process" },
        { key: "after-work", label: "Afterward, to review or organize the result" },
      ],
    },
    {
      question: "What existing behavior or tool would this replace first?",
      target_dimension: "context",
      round_number: roundNumber,
      suggested_choices: [
        { key: "spreadsheet", label: "A spreadsheet or manually maintained list" },
        { key: "documents", label: "Scattered documents and notes" },
        { key: "meetings", label: "Repeated coordination and status meetings" },
      ],
    },
  ];

  const orderedCandidates = [
    candidate,
    ...additionalCandidates.filter(
      (item) => item.target_dimension === candidate.target_dimension
    ),
    ...Object.values(prompts).filter(
      (item) => item.target_dimension !== candidate.target_dimension
    ),
    ...additionalCandidates.filter(
      (item) => item.target_dimension !== candidate.target_dimension
    ),
  ];

  for (const nextCandidate of orderedCandidates) {
    if (!isQuestionTooSimilar(nextCandidate.question, recentQuestions)) {
      return nextCandidate;
    }
  }

  return {
    question: "What important assumption have we not tested yet?",
    target_dimension: "context",
    round_number: roundNumber,
    suggested_choices: [
      { key: "user-assumption", label: "We may be solving for the wrong user" },
      { key: "problem-assumption", label: "The problem may not be frequent enough" },
      { key: "solution-assumption", label: "The proposed workflow may be too complex" },
    ],
  };
}

function fallbackSpecUpdate(
  session: SessionRecord,
  pendingQuestion: PendingQuestion,
  answer: string
): SpecUpdateResponse {
  const sections = extractSections(session.spec_content);
  const answerBullet = answer.trim();
  const targetSection = targetDimensionToSection(pendingQuestion.target_dimension);

  sections[targetSection] = appendBullet(sections[targetSection], answerBullet);

  if (!isMeaningfulContent(sections.Overview)) {
    sections.Overview = answer.trim();
  }

  const remainingSections = Object.entries(sections)
    .filter(([sectionName, value]) => sectionName !== "Open Questions" && !isMeaningfulContent(value))
    .map(([sectionName]) => `${sectionName} still needs detail.`);

  sections["Open Questions"] =
    remainingSections.length > 0
      ? remainingSections.map((item) => `- ${item}`).join("\n")
      : "- No critical open questions remain.";

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

  return serializeSpec(title, merged);
}

function normalizeQuestion(
  response: QuestionResponse,
  metrics: ClarificationMetrics,
  roundNumber: number
): PendingQuestion {
  const fallback = fallbackQuestion(metrics, "", roundNumber);

  return {
    question: normalizeQuestionText(response.question || fallback.question),
    target_dimension: response.target_dimension || fallback.target_dimension,
    round_number: roundNumber,
    suggested_choices: normalizeChoices(response.suggested_choices),
  };
}

function normalizeChoices(rawChoices: Array<{ key: string; label: string }> | undefined): PendingQuestion["suggested_choices"] {
  return (Array.isArray(rawChoices) ? rawChoices : [])
    .map((choice, index) => ({
      key: sanitizeChoiceKey(choice?.key || `choice-${index + 1}`),
      label: choice?.label?.trim() || "",
    }))
    .filter((choice, index, array) => choice.label && array.findIndex((item) => item.label === choice.label) === index)
    .slice(0, 4);
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

function heuristicSectionScore(content: string, measurable: boolean, answerCount: number): number {
  if (!isMeaningfulContent(content)) {
    return Math.min(0.15 + answerCount * 0.03, 0.4);
  }

  let score = 0.55;

  if (content.length > 100) {
    score += 0.12;
  }

  if ((content.match(/\n[-*]/g) ?? []).length >= 2) {
    score += 0.08;
  }

  if (measurable && /\b\d+(\.\d+)?\b|%|ms|seconds|minutes|hours|days|users|customers|conversion|latency|uptime|revenue/i.test(content)) {
    score += 0.15;
  }

  score += Math.min(answerCount * 0.02, 0.1);
  return clamp01(score);
}

function lowestClarityDimension(metrics: ClarificationMetrics): PendingQuestionDimension {
  const entries: Array<[PendingQuestionDimension, number]> = [
    ["goal", metrics.goal_clarity],
    ["constraints", metrics.constraint_clarity],
    ["success_criteria", metrics.success_criteria_clarity],
  ];

  entries.sort((a, b) => a[1] - b[1]);
  return entries[0]?.[0] ?? "goal";
}

function normalizeQuestionText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "What is the most important ambiguity still left in this idea?";
  }
  return /[?]$/.test(trimmed) ? trimmed : `${trimmed}?`;
}

function sanitizeChoiceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "choice";
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
