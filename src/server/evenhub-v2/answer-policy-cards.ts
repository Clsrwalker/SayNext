export type AnswerPolicyCard = {
  id: string;
  legacyMemoryId: number;
  title: string;
  useWhen: string;
  structure: string[];
  boundaries: string[];
  matchExamples: string[];
  priority?: number;
};

const ANSWER_POLICY_CARDS: AnswerPolicyCard[] = [
  {
    id: "behavioral-star-story",
    legacyMemoryId: 100,
    title: "Specific behavioral story",
    useWhen: "A broad behavioral question asks for a real past example.",
    structure: ["Give a short situation and task.", "Focus on Xiang's concrete actions.", "End with the actual result and one behavior that changed."],
    boundaries: ["Keep it specific and low-drama; do not manufacture a conflict or result."],
    matchExamples: ["tell me about a time you showed leadership", "give me a behavioral example from a project", "tell me about a failure or mistake and what changed"],
  },
  {
    id: "behavioral-code-review-feedback",
    legacyMemoryId: 110,
    title: "Code review or critical feedback",
    useWhen: "An interviewer asks about difficult feedback, criticism, or code review.",
    structure: ["Name the concrete feedback and why it mattered.", "Explain how Xiang clarified the risk rather than defending immediately.", "Describe the change, validation, and what he now does differently."],
    boundaries: ["Use a real feedback event; never invent a reviewer or workplace."],
    matchExamples: ["tell me about harsh feedback you received in code review", "describe critical feedback and how you responded", "what did you do when someone criticized your code"],
    priority: 0.08,
  },
  {
    id: "behavioral-no-dramatic-conflict",
    legacyMemoryId: 114,
    title: "Conflict without fake drama",
    useWhen: "A behavioral interview asks for conflict but Xiang has no dramatic personal fight.",
    structure: ["Use a real technical, scope, priority, or communication disagreement.", "Clarify constraints and compare trade-offs.", "Explain the aligned decision and how Xiang supported it."],
    boundaries: ["Do not turn a normal disagreement into a personal fight."],
    matchExamples: ["tell me about a conflict with a teammate", "describe a disagreement in a group project", "have you ever had conflict on a team"],
    priority: 0.05,
  },
  {
    id: "behavioral-why-role",
    legacyMemoryId: 115,
    title: "Why this company or role",
    useWhen: "An interviewer asks why this company, team, project, or role.",
    structure: ["Start with one concrete part of the actual work.", "Connect it to one or two verified Xiang projects.", "Explain the practical contribution and growth opportunity."],
    boundaries: ["Do not claim generic passion or repeat the full job description."],
    matchExamples: [
      "why do you want this role",
      "why are you interested in our company",
      "why should we hire you for this position",
      "why deepsense and why this full stack ai co op specifically",
    ],
    priority: 0.04,
  },
  {
    id: "behavioral-manager-disagreement",
    legacyMemoryId: 116,
    title: "Manager disagreement and influence",
    useWhen: "A question asks about disagreeing with a manager or influencing without authority.",
    structure: ["State the different technical or priority view.", "Use evidence, risk, user impact, or a small test.", "Listen, propose a lower-risk option, and commit after the decision."],
    boundaries: ["Do not portray respectful disagreement as winning an argument."],
    matchExamples: ["tell me about disagreeing with your manager", "how would you influence without authority", "what if your manager rejects your technical idea"],
    priority: 0.07,
  },
  {
    id: "behavioral-waiting-on-information",
    legacyMemoryId: 119,
    title: "Blocked by missing information",
    useWhen: "Work is blocked because another person is unresponsive or required information is missing.",
    structure: ["Explain exactly what is blocked and follow up clearly.", "Make assumptions and their risk visible.", "Continue with a reversible fallback when the deadline requires it."],
    boundaries: ["Do not wait silently or imply certainty about an unconfirmed assumption."],
    matchExamples: ["what do you do when someone is not replying and you need information", "tell me about being blocked by an unresponsive teammate", "how do you proceed with missing information"],
    priority: 0.08,
  },
  {
    id: "response-low-drama-team-conflict",
    legacyMemoryId: 221,
    title: "Resolve a live team trade-off",
    useWhen: "A current team discussion has competing ideas, priorities, or constraints.",
    structure: ["Restate the shared goal and fixed constraint.", "Compare options by risk, time, and user impact.", "Choose the smallest working decision and name the next owner or check."],
    boundaries: ["Keep the discussion about the trade-off, not the person."],
    matchExamples: ["we disagree on the approach what should I say", "our group has two ideas and cannot decide", "how should we resolve this team trade off"],
  },
  {
    id: "response-feedback-code-review",
    legacyMemoryId: 222,
    title: "Respond to current code feedback",
    useWhen: "Xiang needs to respond now to code review criticism or requested changes.",
    structure: ["Clarify whether the concern is correctness, readability, maintainability, tests, or an edge case.", "Separate style preference from concrete risk.", "Confirm the change, test it, and follow up."],
    boundaries: ["Do not become defensive or agree before understanding the concern."],
    matchExamples: ["how should I respond to this code review comment", "someone says my code is hard to maintain what do I say", "what should I do with requested changes on my pull request"],
  },
  {
    id: "response-deadline-scope-cut",
    legacyMemoryId: 223,
    title: "Deadline and scope cut",
    useWhen: "There are too many features for the available time.",
    structure: ["Name the fixed deadline and define the core flow.", "Split must-have work from nice-to-have work.", "Cut risky changes first, assign owners, and preserve a future-work list."],
    boundaries: ["Protect a tested end-to-end result instead of promising every feature."],
    matchExamples: ["the deadline is close and we have too many features", "how would you prioritize and cut scope", "what do you drop when there is not enough time"],
    priority: 0.07,
  },
  {
    id: "response-hard-bug-debugging",
    legacyMemoryId: 224,
    title: "Hard bug debugging process",
    useWhen: "A question asks how to investigate a difficult, broken, or flaky system.",
    structure: ["Reproduce the smallest failing path.", "Isolate the layer and inspect raw input, output, logs, and timing.", "Test one hypothesis, fix it, and add a regression or smoke test."],
    boundaries: ["Do not guess a root cause before collecting evidence."],
    matchExamples: [
      "how do you debug a hard bug",
      "the system is flaky how would you find the root cause",
      "walk me through your debugging process",
      "tell me about a time integration broke and how you narrowed it down",
    ],
    priority: 0.05,
  },
  {
    id: "response-demo-stabilization",
    legacyMemoryId: 225,
    title: "Demo pressure and stabilization",
    useWhen: "A demo or presentation is close and the system is unstable.",
    structure: ["Freeze scope and identify the exact demo path.", "Smoke-test it from a clean state and accept only risk-reducing fixes.", "Prepare a fallback for the part most likely to fail."],
    boundaries: ["Avoid last-minute refactors that do not improve the demo path."],
    matchExamples: ["the demo is tomorrow and the system is unstable", "how do you stabilize a project before presentation", "what do you do under demo pressure"],
    priority: 0.06,
  },
  {
    id: "response-unclear-requirements-api",
    legacyMemoryId: 226,
    title: "Unclear requirements or changing API",
    useWhen: "Requirements are vague or an API contract keeps changing.",
    structure: ["State the current assumption in plain language.", "Freeze a small temporary contract with a sample request and response.", "Assign an owner and record uncertain parts for the next version."],
    boundaries: ["Do not let frontend and backend continue against different implicit contracts."],
    matchExamples: ["how do you handle unclear requirements", "the api contract keeps changing", "frontend and backend are blocked by an ambiguous data shape"],
    priority: 0.05,
  },
  {
    id: "response-unknown-uncertain",
    legacyMemoryId: 227,
    title: "Unknown or uncertain answer",
    useWhen: "Xiang does not know an answer or lacks enough context.",
    structure: ["State the part that is known.", "Name the uncertainty without excessive apology.", "Give the next check or assumption needed for a reliable answer."],
    boundaries: ["Never fake certainty or invent a personal example."],
    matchExamples: ["what do you say when you do not know the answer", "how do you handle an interview question you are unsure about", "there is not enough context to answer confidently"],
  },
  {
    id: "response-no-fake-story",
    legacyMemoryId: 228,
    title: "No unsupported behavioral story",
    useWhen: "A behavioral example is requested but no matching real event is available.",
    structure: ["Use a supported project event when one exists.", "Otherwise say the example was not dramatic and explain the practical approach.", "Keep hypothetical actions clearly hypothetical."],
    boundaries: ["Never invent a colleague, conflict, external user, employer, or production incident."],
    matchExamples: ["I do not have a real example for this behavioral question", "how do I answer without making up a story", "there is no matching experience in my projects"],
    priority: 0.06,
  },
  {
    id: "response-transaction-safety",
    legacyMemoryId: 229,
    title: "High-pressure transaction safety",
    useWhen: "Money, a lease, deposit, contract, or non-refundable payment is under pressure.",
    structure: ["Pause before paying or signing.", "Verify written terms, identity, amount, refund policy, due date, method, and receipt.", "Decline to commit until the terms are reviewable."],
    boundaries: ["Do not authorize payment or agreement on Xiang's behalf."],
    matchExamples: ["they are pressuring me to pay a deposit now", "should I sign this lease or contract immediately", "the payment is non refundable and they want money today"],
    priority: 0.08,
  },
];

const MATCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "do", "does", "for", "how", "i", "if", "in",
  "is", "it", "me", "my", "of", "on", "or", "some", "tell", "that", "the", "this",
  "to", "was", "what", "when", "with", "would", "you", "your",
]);

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bnot (?:replying|responding)\b/g, "unresponsive")
    .replace(/\s+/g, " ").trim();
}

function terms(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((term) => term.length >= 3 && !MATCH_STOP_WORDS.has(term)));
}

function bigrams(value: string): Set<string> {
  const normalized = normalize(value).replace(/ /g, "_");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function dice(left: string, right: string): number {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return 0;
  let overlap = 0;
  for (const value of leftBigrams) if (rightBigrams.has(value)) overlap += 1;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function exampleScore(query: string, example: string): number {
  const normalizedQuery = normalize(query);
  const normalizedExample = normalize(example);
  if (!normalizedQuery || !normalizedExample) return 0;
  const queryTerms = terms(query);
  const exampleTerms = terms(example);
  let overlap = 0;
  for (const term of exampleTerms) if (queryTerms.has(term)) overlap += 1;
  if (!overlap) return 0;
  const tokenDice = (2 * overlap) / (queryTerms.size + exampleTerms.size);
  const queryCoverage = overlap / Math.max(1, queryTerms.size);
  const exampleCoverage = overlap / Math.max(1, exampleTerms.size);
  const contained = normalizedQuery.includes(normalizedExample) || normalizedExample.includes(normalizedQuery) ? 0.25 : 0;
  return tokenDice * 0.4 + queryCoverage * 0.25 + exampleCoverage * 0.2 + dice(query, example) * 0.15 + contained;
}

export function getAnswerPolicyCards(): AnswerPolicyCard[] {
  return ANSWER_POLICY_CARDS.map((card) => ({
    ...card,
    structure: [...card.structure],
    boundaries: [...card.boundaries],
    matchExamples: [...card.matchExamples],
  }));
}

export function findAnswerPolicyCard(query: string, cards: AnswerPolicyCard[] = ANSWER_POLICY_CARDS): AnswerPolicyCard | null {
  let best: { card: AnswerPolicyCard; score: number } | null = null;
  for (const card of cards) {
    const matchScore = Math.max(...card.matchExamples.map((example) => exampleScore(query, example)));
    const score = matchScore + (card.priority || 0);
    if (!best || score > best.score) best = { card, score };
  }
  return best && best.score >= 0.42 ? best.card : null;
}

export function formatAnswerPolicyCard(card: AnswerPolicyCard): string {
  return [
    `[answer-policy:${card.id}] Reusable answer policy | ${card.title}`,
    "This is not personal-memory evidence. It controls answer structure only; every claim about Xiang's past must come from verified Xiang memory or approved interview context.",
    `Use when: ${card.useWhen}`,
    "Structure:",
    ...card.structure.map((item) => `- ${item}`),
    "Boundaries:",
    ...card.boundaries.map((item) => `- ${item}`),
  ].join("\n");
}
