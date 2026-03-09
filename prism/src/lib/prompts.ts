import type { ClarificationMetrics, PendingQuestionDimension, TranscriptEntry } from "@/types/workspace";

const ADAPTED_SOCRATIC_BASE_PROMPT = `# Socratic Interviewer

You are an expert requirements engineer conducting a Socratic interview to clarify vague ideas into actionable requirements.

## CRITICAL ROLE BOUNDARIES
- You are ONLY an interviewer. You gather information through questions.
- NEVER say "I will implement X", "Let me build", "I'll create" - you gather requirements only
- NEVER promise to build demos, write code, or execute anything
- Another agent will handle implementation AFTER you finish gathering requirements

## CONTEXT USAGE
- You CAN use: the provided specification draft, conversation history, score breakdowns, and initial context
- You CANNOT use: external tools, hidden context, or invented facts
- After reviewing context, always ask a clarifying question

## RESPONSE FORMAT
- You MUST always end with a question - never end without asking something
- Keep questions focused (1-2 sentences)
- No preambles like "Great question!" or "I understand"
- If context is incomplete, still ask a question based on what you know

## QUESTIONING STRATEGY
- Target the biggest source of ambiguity
- Build on previous responses
- Be specific and actionable
- Use ontological questions: "What IS this?", "Root cause or symptom?", "What are we assuming?"`;

export function buildQuestionSystemPrompt(initialContext: string, roundNumber: number): string {
  const roundInfo = `Round ${roundNumber}`;

  if (roundNumber === 1) {
    return `You are an expert requirements engineer conducting a Socratic interview.

CRITICAL: Start your FIRST response with a DIRECT QUESTION about the project. Do NOT introduce yourself. Do NOT say "I'll conduct" or "Let me ask". Just ask a specific, clarifying question immediately.

This is ${roundInfo}. Your ONLY job is to ask questions that reduce ambiguity.

Initial context: ${initialContext}

${ADAPTED_SOCRATIC_BASE_PROMPT}`;
  }

  return `You are an expert requirements engineer conducting a Socratic interview.

This is ${roundInfo}. Your ONLY job is to ask questions that reduce ambiguity.

Initial context: ${initialContext}

${ADAPTED_SOCRATIC_BASE_PROMPT}`;
}

export function buildQuestionUserPrompt(input: {
  supportingSpecContext: string;
  transcript: TranscriptEntry[];
  metrics: ClarificationMetrics;
  roundNumber: number;
  recentAssistantQuestions: string[];
  rejectedQuestions?: string[];
}): string {
  const transcriptSummary = input.transcript
    .map((entry) => `${entry.role === "assistant" ? "Q" : "A"}: ${entry.content}`)
    .join("\n");
  const latestAnswer = [...input.transcript].reverse().find((entry) => entry.role === "user")?.content ?? "(no answer yet)";
  const latestQuestion = [...input.transcript].reverse().find((entry) => entry.role === "assistant")?.content ?? "(no prior question)";
  const recentQuestionSummary =
    input.recentAssistantQuestions.length > 0
      ? input.recentAssistantQuestions.map((question) => `- ${question}`).join("\n")
      : "- None yet";
  const rejectedSummary =
    input.rejectedQuestions && input.rejectedQuestions.length > 0
      ? input.rejectedQuestions.map((question) => `- ${question}`).join("\n")
      : "- None";

  return `Question generation priority:
1. Treat the latest answered question and answer as the freshest source of truth.
2. Use the full conversation history to continue the interview without repeating yourself.
3. Use the supporting spec context and score breakdown only as secondary reference.
4. If the supporting spec conflicts with the latest answer, trust the latest answer.

Latest answered pair:
- Last question: ${latestQuestion}
- Last answer: ${latestAnswer}

Recent assistant questions to avoid repeating:
${recentQuestionSummary}

Rejected candidate questions from earlier attempts:
${rejectedSummary}

Supporting spec context (reference only):
---
${input.supportingSpecContext}
---

Conversation history:
---
${transcriptSummary || "(no prior rounds)"}
---

Current score breakdown:
- Goal clarity: ${input.metrics.goal_clarity.toFixed(2)}
- Constraint clarity: ${input.metrics.constraint_clarity.toFixed(2)}
- Success criteria clarity: ${input.metrics.success_criteria_clarity.toFixed(2)}
- Ambiguity score: ${input.metrics.ambiguity_score.toFixed(2)}
- Ambiguity label: ${input.metrics.ambiguity}
- Open questions: ${input.metrics.open_questions}

Target the single biggest remaining ambiguity. Do not restate or lightly rephrase any recent assistant question unless the latest answer is still clearly insufficient and you can ask a narrower follow-up. Return strict JSON with:
- question: string
- suggested_choices: 2-4 concise options
- target_dimension: one of "goal", "constraints", "success_criteria", "context"`;
}

export function buildInterviewContext(initialContext: string, transcript: TranscriptEntry[]): string {
  const parts = [`Initial Context: ${initialContext}`];

  for (const entry of transcript) {
    if (entry.role === "assistant") {
      parts.push(`\nQ: ${entry.content}`);
      continue;
    }

    parts.push(`A: ${entry.content}`);
  }

  return parts.join("\n");
}

export function buildScoringSystemPrompt(isBrownfield = false): string {
  if (isBrownfield) {
    return `You are an expert requirements analyst. Evaluate the clarity of software requirements.

Evaluate four components:
1. Goal Clarity (35%): Is the goal specific and well-defined?
2. Constraint Clarity (25%): Are constraints and limitations specified?
3. Success Criteria Clarity (25%): Are success criteria measurable?
4. Context Clarity (15%): Is the existing codebase context clear? Are referenced codebases, patterns, and conventions well understood?

Score each from 0.0 (unclear) to 1.0 (perfectly clear). Scores above 0.8 require very specific requirements.

RESPOND ONLY WITH VALID JSON. No other text before or after.

Required JSON format:
{"goal_clarity_score": 0.0, "goal_clarity_justification": "string", "constraint_clarity_score": 0.0, "constraint_clarity_justification": "string", "success_criteria_clarity_score": 0.0, "success_criteria_clarity_justification": "string", "context_clarity_score": 0.0, "context_clarity_justification": "string"}`;
  }

  return `You are an expert requirements analyst. Evaluate the clarity of software requirements.

Evaluate three components:
1. Goal Clarity (40%): Is the goal specific and well-defined?
2. Constraint Clarity (30%): Are constraints and limitations specified?
3. Success Criteria Clarity (30%): Are success criteria measurable?

Score each from 0.0 (unclear) to 1.0 (perfectly clear). Scores above 0.8 require very specific requirements.

RESPOND ONLY WITH VALID JSON. No other text before or after.

Required JSON format:
{"goal_clarity_score": 0.0, "goal_clarity_justification": "string", "constraint_clarity_score": 0.0, "constraint_clarity_justification": "string", "success_criteria_clarity_score": 0.0, "success_criteria_clarity_justification": "string"}`;
}

export function buildScoringUserPrompt(context: string): string {
  return `Please evaluate the clarity of the following requirements conversation:

---
${context}
---

Analyze each component and provide scores with justifications.`;
}

export function buildSpecUpdateSystemPrompt(): string {
  return `You maintain a canonical markdown specification for a software project.

Rules:
- Rewrite the FULL specification.
- Preserve the existing section order and markdown headings.
- Reflect only confirmed facts from the current specification and the latest answer.
- Do NOT invent implementation details, technologies, deadlines, or user personas that were not confirmed.
- If uncertainty remains, keep it in "Open Questions" instead of guessing.
- Keep the document concise, implementation-ready, and readable.

Return strict JSON with:
- spec_markdown: the full markdown document
- warnings: array of contradictions, scope risks, or unresolved placeholders
- open_questions: array of remaining unresolved questions`;
}

export function buildSpecUpdateUserPrompt(input: {
  title: string;
  specContent: string;
  question: string;
  answer: string;
  transcript: TranscriptEntry[];
  targetDimension: PendingQuestionDimension | null;
}): string {
  const transcriptSummary = input.transcript
    .map((entry) => `${entry.role === "assistant" ? "Question" : "Answer"}: ${entry.content}`)
    .join("\n");

  return `Project title: ${input.title}
Target dimension: ${input.targetDimension ?? "context"}

Current markdown spec:
---
${input.specContent}
---

Conversation history:
---
${transcriptSummary}
---

Latest clarification:
Question: ${input.question}
Answer: ${input.answer}

Rewrite the full markdown spec now.`;
}

export const questionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["question", "suggested_choices", "target_dimension"],
  properties: {
    question: { type: "string", minLength: 8 },
    target_dimension: {
      type: "string",
      enum: ["goal", "constraints", "success_criteria", "context"],
    },
    suggested_choices: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label"],
        properties: {
          key: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

export const scoringSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal_clarity_score",
    "goal_clarity_justification",
    "constraint_clarity_score",
    "constraint_clarity_justification",
    "success_criteria_clarity_score",
    "success_criteria_clarity_justification",
  ],
  properties: {
    goal_clarity_score: { type: "number", minimum: 0, maximum: 1 },
    goal_clarity_justification: { type: "string" },
    constraint_clarity_score: { type: "number", minimum: 0, maximum: 1 },
    constraint_clarity_justification: { type: "string" },
    success_criteria_clarity_score: { type: "number", minimum: 0, maximum: 1 },
    success_criteria_clarity_justification: { type: "string" },
  },
} as const;

export const specUpdateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spec_markdown", "warnings", "open_questions"],
  properties: {
    spec_markdown: { type: "string", minLength: 1 },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    open_questions: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;
