import { conversationLogger, type PersonalMemorySensitivity } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type PlaybookSeed = {
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  sourceRef: string;
};

const playbookUsage =
  "Use as a response playbook only. This is not evidence that Xiang personally experienced the event. Use it to structure a clear, sayable answer or next step. Do not turn it into a fake past-tense story.";

const memories: PlaybookSeed[] = [
  {
    title: "Response playbook: low-drama team conflict",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:team-conflict",
    keywords: ["playbook", "team conflict", "teammate", "disagreement", "technical disagreement", "group project", "tradeoff"],
    content: `Playbook, not personal evidence.

Use when Xiang needs to answer or react to a team conflict, teammate disagreement, or different ideas in a group project.

Reasoning path:
- Keep it low-drama: frame it as a difference in priorities, constraints, or technical trade-offs.
- Separate the person from the problem.
- Restate the shared goal and deadline.
- Compare options by risk, time, user impact, and what can actually be finished.
- Suggest the smallest working version first, then keep extra ideas as future work.
- End with a concrete decision, owner, or next check.

Xiang-like line:
"I would keep it about the trade-off, not the person. If the deadline is close, I would suggest we finish the smaller working version first, then keep the extra idea as future work."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: feedback and code review",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:feedback",
    keywords: ["playbook", "feedback", "code review", "criticism", "harsh feedback", "review comment", "improve"],
    content: `Playbook, not personal evidence.

Use when Xiang receives feedback, code review criticism, or a question about constructive feedback.

Reasoning path:
- Do not defend immediately.
- Ask what part is risky or unclear: correctness, readability, maintainability, missing tests, or edge cases.
- Separate style preference from real bug/risk.
- Turn feedback into a small checklist.
- Make the change, test it, and follow up.

Xiang-like line:
"I try not to take code review personally. I would ask what part is risky, like edge cases or maintainability, then fix that and use it as a checklist next time."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: deadline and scope cut",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:deadline-scope",
    keywords: ["playbook", "deadline", "scope", "cut scope", "too many features", "must have", "nice to have", "ship"],
    content: `Playbook, not personal evidence.

Use when there are too many features, deadline pressure, or a need to prioritize.

Reasoning path:
- Name the fixed constraint: time, demo, grade, client deadline, or production risk.
- Split must-have from nice-to-have.
- Protect the core flow that proves the system works.
- Cut risky or hard-to-test changes first.
- Assign owners for must-have items.
- Keep a short future-work list so cuts do not feel ignored.

Xiang-like line:
"I think we should protect the core flow first. If the deadline is close, I would cut the risky nice-to-have parts and make sure the demo path is stable."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: hard bug debugging",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:hard-bug",
    keywords: ["playbook", "hard bug", "debugging", "reproduce", "root cause", "logs", "regression test", "flaky"],
    content: `Playbook, not personal evidence.

Use when Xiang is asked about debugging, a hard bug, or a broken/flaky system.

Reasoning path:
- Reproduce the issue first.
- Reduce it to the smallest failing path.
- Identify which layer is failing: UI, API, database, model, config, async timing, or external service.
- Add logs or inspect raw inputs/outputs before guessing.
- Test one hypothesis at a time.
- After the fix, add a regression test or smoke test so it does not come back.

Xiang-like line:
"I would not guess first. I would reproduce it, isolate which layer is wrong, check logs or raw input/output, then make one small fix and add a regression test."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: demo pressure and stabilization",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:demo-pressure",
    keywords: ["playbook", "demo", "presentation", "stabilize", "smoke test", "fallback", "last minute", "integration"],
    content: `Playbook, not personal evidence.

Use when a demo, presentation, or important walkthrough is near and the system is unstable.

Reasoning path:
- Freeze scope.
- Identify the exact demo path and test only that path first.
- Run a smoke test from a clean state.
- Avoid last-minute risky refactors.
- Prepare a fallback explanation or manual backup if one part fails.
- Keep only fixes that reduce demo risk.

Xiang-like line:
"For the demo, I would freeze scope and test the exact flow from a clean state. I would avoid risky last-minute changes and prepare a fallback if one part fails."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: unclear requirements and changing API contract",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:unclear-requirements",
    keywords: ["playbook", "unclear requirements", "vague requirements", "api contract", "schema", "assumption", "mock", "version"],
    content: `Playbook, not personal evidence.

Use when requirements are vague, the API contract keeps changing, or the team is blocked by ambiguity.

Reasoning path:
- Restate the current assumption in simple language.
- Freeze the smallest temporary contract for the next iteration.
- Version it if useful, like v1.
- Use a mock schema or sample request/response to unblock frontend/backend work.
- Put uncertain parts in a future-change list.
- Ask one owner to write the current agreed spec.

Xiang-like line:
"I think we should freeze a small v1 contract for now, even if it is not perfect. Then frontend and backend can work against the same mock shape, and we can log changes for later."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: unknown or uncertain answer",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:unknown-question",
    keywords: ["playbook", "unknown", "uncertain", "not sure", "do not know", "graceful unknown", "honest uncertainty"],
    content: `Playbook, not personal evidence.

Use when Xiang does not know the answer or lacks enough context.

Reasoning path:
- Do not fake confidence.
- State the part he knows.
- State what is uncertain.
- Give the next thing to check or the assumption that would make the answer valid.
- Keep it calm and short.

Xiang-like line:
"I am not fully sure yet, but my current understanding is this. I would verify the logs or requirement first before making a final call."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: no fake interview story",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:interview-no-fake-story",
    keywords: ["playbook", "real example", "tell me about a time", "describe a time", "behavioral interview", "no dramatic story"],
    content: `Playbook, not personal evidence.

Use when Xiang is asked for a real behavioral example but memory does not contain a matching real event.

Reasoning path:
- Do not invent a fake workplace story or dramatic conflict.
- If a supported project memory exists, use that.
- If no exact event exists, say it was not a dramatic example and explain the approach.
- Keep the answer practical and honest.

Xiang-like line:
"I do not have a dramatic example for that, but the way I would handle it is to make the trade-off clear, agree on the smallest working version, and document what can wait."`,
    usageRule: playbookUsage,
  },
  {
    title: "Response playbook: high-pressure transaction safety",
    category: "knowledge_response_playbook",
    sensitivity: "low",
    sourceRef: "knowledge:xiang-playbook:high-stakes-transaction",
    keywords: ["playbook", "deposit", "lease", "contract", "non-refundable", "payment pressure", "receipt", "verify", "sign now"],
    content: `Playbook, not personal evidence.

Use for high-pressure money, lease, deposit, contract, or non-refundable payment situations.

Reasoning path:
- Pause before paying or signing.
- Ask for written terms.
- Verify identity, amount, refund policy, due date, and payment method.
- Ask for a receipt.
- If pressured, say he needs to review first.
- Do not commit for Xiang.

Xiang-like line:
"I should not pay just because there is pressure. I need the terms in writing, the exact amount, refund policy, and a receipt before I send anything."`,
    usageRule: playbookUsage,
  },
];

let count = 0;
for (const memory of memories) {
  const result = conversationLogger.createPersonalMemory({
    userId,
    title: memory.title,
    category: memory.category,
    sensitivity: memory.sensitivity,
    content: memory.content,
    usageRule: memory.usageRule,
    keywords: memory.keywords,
    source: "knowledge",
    sourceRef: memory.sourceRef,
    status: "active",
    upsertBySource: true,
  });

  if (result) {
    count += 1;
    console.log(`upserted: ${result.sourceRef} -> ${result.title}`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Seeded Xiang response playbooks: ${count}`);
