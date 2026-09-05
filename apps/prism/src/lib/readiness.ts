import {
  computeStructureScore,
  extractOpenQuestionItems,
  extractSections,
  isMeaningfulContent,
  type SpecSection,
} from "@/lib/spec";
import type { ClarificationMetrics, PendingQuestion } from "@/types/workspace";

export interface ReadinessIssue {
  id: string;
  section: SpecSection;
  reason: string;
  question: string;
}
export interface ReadinessAssessment {
  ready: boolean;
  score: number;
  reason: string;
  blockers: ReadinessIssue[];
  nonBlockers: string[];
  evidence: Array<{ section: SpecSection; text: string }>;
}

// These checks measure implementation evidence, never document length or interview rounds.
const unresolved =
  /\b(?:not sure|do not know|don.t know|decide later|needs? confirmation)\b|\b(tbd|todo|pending|undefined|undecided|unknown|to be (defined|determined)|still needs detail|not yet (defined|decided))\b|미정|정의 필요/i;
const generic =
  /^(automate an existing manual workflow|the output becomes more reliable|the workflow becomes faster|budget and scope need to stay tight|stay inside the current stack|a clear feature checklist is enough|it needs measurable target metrics|it must be unambiguous for engineering handoff|a working prototype|everyone|all users|users|make it better|improve efficiency)[.!]?$/i;
const clean = (line: string) =>
  line
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/[_*`]/g, "")
    .trim();
export const contentItems = (body: string) =>
  body.split("\n").map(clean).filter(Boolean);
const concrete = (body: string) =>
  isMeaningfulContent(body) &&
  contentItems(body).some(
    (line) =>
      !unresolved.test(line) &&
      !generic.test(line) &&
      /[\p{L}\p{N}]/u.test(line),
  );
const none = (text: string) =>
  /^(none|no(?:ne)? (?:known |additional |critical )?(?:open questions|constraints|decisions|assumptions)(?: remain)?|not applicable|n\/a)[.!]?$/i.test(
    clean(text),
  );

export function decisionConflict(body: string): boolean {
  const active = contentItems(body)
    .filter(
      (line) => !/^(superseded|retired|rejected|historical)\s*:/i.test(line),
    )
    .join("\n");
  return (
    [
      [
        /\b(?:fit|integrat\w*|extend\w*)\b[^\n]*\bexisting product\b/i,
        /\b(?:fresh|new|standalone) product\b/i,
      ],
      [
        /\b(?:require|must use|mandatory)\b[^\n]*\b(?:login|sign.in|authentication)\b/i,
        /\b(?:no|without) (?:login|sign.in|authentication)\b/i,
      ],
      [
        /\b(?:offline.only|no network|no external (?:api|service)s?)\b/i,
        /\b(?:require|must|use)\b[^\n]*\b(?:cloud|external api|online.only)\b/i,
      ],
    ].some(([left, right]) => left.test(active) && right.test(active)) ||
    /\b(conflict|contradict\w*|mutually exclusive)\b/i.test(active)
  );
}

export function assessReadiness(spec: string): ReadinessAssessment {
  const sections = extractSections(spec);
  const blockers: ReadinessIssue[] = [];
  const evidence: ReadinessAssessment["evidence"] = [];
  const add = (
    id: string,
    section: SpecSection,
    reason: string,
    question: string,
  ) => blockers.push({ id, section, reason, question });
  const check = (section: SpecSection, question: string) => {
    if (
      !concrete(sections[section]) ||
      unresolved.test(sections[section]) ||
      (["Users", "Problem", "Goals"].includes(section) &&
        none(sections[section]))
    ) {
      add(
        section,
        section,
        `${section} needs a confirmed, project-specific answer.`,
        question,
      );
    } else evidence.push({ section, text: sections[section] });
  };
  if (
    decisionConflict(
      [sections.Decisions, sections.Constraints, sections.Goals].join("\n"),
    )
  )
    add(
      "decision-conflict",
      "Decisions",
      "Active requirements conflict. Choose the rule that applies now, update the affected sections, and move replaced decisions to Decision History.",
      "The active decisions conflict. Which decision applies now, and which should be marked superseded?",
    );
  check(
    "Users",
    "Who will use the first version, and in what specific situation?",
  );
  check(
    "Problem",
    "What can that user not accomplish today, and what is the current workaround?",
  );
  check(
    "Goals",
    "What exact workflow or output must the first version support?",
  );
  check("Non-Goals", "What is explicitly outside the first version's scope?");
  check(
    "Constraints",
    "Which technical, data, privacy, or delivery limits must implementation respect? State explicitly if there are no known limits.",
  );
  const criteria = contentItems(sections["Success Criteria"]);
  const metricIntent =
    /\b(revenue|conversion|retention|latency|uptime|accuracy|response time|time saved|percent|%|\d+\s*(?:users|customers))\b/i;
  const observable =
    /\b(returns?|shows?|displays?|saves?|exports?|downloads?|rejects?|prevents?|persists?|receives?|appears?|contains?|includes?|remains?|matches?|opens?|creates?|loads?|completes?|fails?|succeeds?|disappears?|deletes?|marks?|filters?)\b|가능|표시|저장|반환|거부|유지|생성/i;
  const quantitativeGoal =
    /\b(?:reduce|increase|improve|achieve|reach|target)\b[^\n]*\b(?:revenue|conversion|retention|latency|uptime|accuracy|response time)\b/i.test(
      sections.Goals,
    );
  const targetWithContext = (line: string) =>
    /\d+(?:\.\d+)?\s*(?:%|ms|seconds?|minutes?|hours?|dollars?|USD|\$)/i.test(
      line,
    ) &&
    /\b(when|given|under|over|per|during|within|on|for|using|measured)\b/i.test(
      line,
    );
  const missingQuantitativeTarget =
    quantitativeGoal && !criteria.some(targetWithContext);
  const badCriteria =
    missingQuantitativeTarget ||
    !concrete(sections["Success Criteria"]) ||
    criteria.some((line) => {
      if (unresolved.test(line) || generic.test(line)) return true;
      if (metricIntent.test(line)) return !targetWithContext(line);
      if (!observable.test(line)) return true;
      return (
        /\b(implementation.ready|clear enough|user.friendly|easy to use|successful|useful|reliable|fast|better|measurable (?:target )?metrics)\b/i.test(
          line,
        ) && !/\b(contains|includes|matches|returns|rejects)\b/i.test(line)
      );
    });
  if (badCriteria)
    add(
      "acceptance",
      "Success Criteria",
      "Acceptance criteria need observable pass/fail behavior. Performance or business targets also need a threshold and measurement context.",
      "What action and observable result would pass acceptance? For a performance or business goal, specify the target and how it is measured.",
    );
  else
    evidence.push({
      section: "Success Criteria",
      text: sections["Success Criteria"],
    });
  const open = extractOpenQuestionItems(spec).filter((item) => !none(item));
  const nonBlockers = open.filter((item) =>
    /^(?:\[non-blocker\]|non-blocker:|optional:)/i.test(item),
  );
  for (const item of open.filter((item) => !nonBlockers.includes(item))) {
    if (
      !blockers.some((issue) =>
        item.toLowerCase().startsWith(issue.section.toLowerCase()),
      )
    )
      add(
        `open-${blockers.length}`,
        "Open Questions",
        item,
        `What is the confirmed resolution for this remaining implementation question: ${item.replace(/[.?]$/, "")}?`,
      );
  }
  if (
    unresolved.test(sections.Decisions) &&
    isMeaningfulContent(sections.Decisions)
  )
    add(
      "decision-unresolved",
      "Decisions",
      "An active decision is unresolved.",
      "Which unresolved decision must be settled before implementation?",
    );
  blockers.sort((a, b) => {
    const priority = (issue: ReadinessIssue) =>
      issue.id === "decision-conflict"
        ? 0
        : issue.section === "Open Questions" &&
            /access|permission|privacy|security|dependency|conflict|required data|cannot/i.test(
              issue.reason,
            )
          ? 1
          : 2;
    return priority(a) - priority(b);
  });
  const ready = blockers.length === 0;
  const score = Math.round((evidence.length / 6) * 100);
  return {
    ready,
    score: ready ? score : Math.min(score, 79),
    blockers,
    nonBlockers,
    evidence,
    reason: ready
      ? "Users, problem, scope, constraints, and observable acceptance criteria are documented; no unresolved blockers were detected. Review the evidence before implementation."
      : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} must be resolved before Ready. Document completeness does not establish implementation readiness.`,
  };
}

export function readinessQuestion(
  spec: string,
  round: number,
  previous: string[] = [],
): PendingQuestion | null {
  const issue = assessReadiness(spec).blockers[0];
  if (!issue) return null;
  const repeated = previous.some((question) =>
    question.includes(issue.question),
  );
  const current = extractSections(spec)[issue.section].trim().slice(0, 300);
  return {
    question: repeated
      ? `${issue.section} still lacks the required detail. Current answer: “${current}”. ${issue.question}`
      : issue.question,
    suggested_choices: [],
    target_dimension:
      issue.section === "Success Criteria"
        ? "success_criteria"
        : issue.section === "Constraints" || issue.section === "Non-Goals"
          ? "constraints"
          : issue.section === "Decisions" || issue.section === "Open Questions"
            ? "context"
            : "goal",
    round_number: round,
  };
}

export function applyReadiness(
  metrics: ClarificationMetrics,
  spec: string,
): ClarificationMetrics {
  const assessment = assessReadiness(spec);
  return {
    ...metrics,
    structure: computeStructureScore(spec),
    readiness: assessment.score,
    overall_score: assessment.score,
    ambiguity: assessment.ready
      ? "Low"
      : assessment.score >= 50
        ? "Medium"
        : "High",
    warnings: assessment.blockers.length,
    open_questions: assessment.blockers.length + assessment.nonBlockers.length,
    ambiguity_score: 1 - assessment.score / 100,
    goal_clarity:
      assessment.evidence.filter((item) =>
        ["Users", "Problem", "Goals"].includes(item.section),
      ).length / 3,
    constraint_clarity:
      assessment.evidence.filter((item) =>
        ["Constraints", "Non-Goals"].includes(item.section),
      ).length / 2,
    success_criteria_clarity: assessment.evidence.some(
      (item) => item.section === "Success Criteria",
    )
      ? 1
      : 0,
    goal_justification: "Current-spec checks for users, problem, and scope.",
    constraint_justification:
      "Current-spec checks for constraints and scope exclusions.",
    success_criteria_justification:
      "Current-spec checks for observable acceptance behavior.",
  };
}
