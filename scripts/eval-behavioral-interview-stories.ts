import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  group: string;
  q: string;
  expected: string[];
};

const cases: EvalCase[] = [
  { group: "hard_bug", q: "What was the hardest bug you fixed recently?", expected: ["xiang-behavioral:saynext-hard-bug-context", "xiang-behavioral:saynext-local-llm-json-latency"] },
  { group: "hard_bug", q: "Tell me about a recent debugging challenge.", expected: ["xiang-behavioral:saynext-hard-bug-context", "xiang-behavioral:saynext-local-llm-json-latency"] },
  { group: "hard_bug", q: "Describe a bug where the output was wrong because of context.", expected: ["xiang-behavioral:saynext-hard-bug-context"] },
  { group: "hard_bug", q: "How did you debug the Ollama JSON parse issue?", expected: ["xiang-behavioral:saynext-local-llm-json-latency"] },
  { group: "hard_bug", q: "Tell me about a time your app got stuck loading.", expected: ["xiang-behavioral:saynext-local-llm-json-latency"] },

  { group: "failure", q: "Tell me about a failure and what you learned.", expected: ["xiang-behavioral:saynext-prompt-failure"] },
  { group: "failure", q: "Describe a mistake you made in a project.", expected: ["xiang-behavioral:saynext-prompt-failure"] },
  { group: "failure", q: "What did you learn from a prompt design that did not work?", expected: ["xiang-behavioral:saynext-prompt-failure"] },
  { group: "failure", q: "Give me an example of when your first design was too rigid.", expected: ["xiang-behavioral:saynext-prompt-failure"] },

  { group: "feedback", q: "What constructive feedback have you received?", expected: ["xiang-behavioral:constructive-feedback-ai-like"] },
  { group: "feedback", q: "Tell me about feedback that changed your project.", expected: ["xiang-behavioral:constructive-feedback-ai-like"] },
  { group: "feedback", q: "How did you react when someone said your answer sounded too AI-like?", expected: ["xiang-behavioral:constructive-feedback-ai-like"] },
  { group: "feedback", q: "Describe a time you improved communication based on feedback.", expected: ["xiang-behavioral:constructive-feedback-ai-like"] },

  { group: "leadership", q: "Tell me about a time you showed leadership.", expected: ["xiang-behavioral:leadership-ownership-saynext"] },
  { group: "leadership", q: "Give me an example of taking ownership of a project.", expected: ["xiang-behavioral:leadership-ownership-saynext"] },
  { group: "leadership", q: "How have you shown initiative without a formal leadership role?", expected: ["xiang-behavioral:leadership-ownership-saynext"] },
  { group: "leadership", q: "Describe a time you owned an end to end product decision.", expected: ["xiang-behavioral:leadership-ownership-saynext"] },
  { group: "leadership", q: "Tell me about a time you went above and beyond the requirements.", expected: ["xiang-behavioral:above-and-beyond-saynext"] },
  { group: "leadership", q: "Give me an example of extra effort you put into a project.", expected: ["xiang-behavioral:above-and-beyond-saynext"] },
  { group: "leadership", q: "Tell me about something you had to push for in a project.", expected: ["xiang-behavioral:saynext-pushed-user-control", "knowledge:behavioral-interview:manager-influence"] },
  { group: "leadership", q: "How did you influence a product decision without a formal role?", expected: ["xiang-behavioral:saynext-pushed-user-control", "knowledge:behavioral-interview:manager-influence"] },
  { group: "leadership", q: "Give me an example where you pushed for user control instead of full automation.", expected: ["xiang-behavioral:saynext-pushed-user-control"] },

  { group: "independent_work", q: "Tell me about a time you worked independently without much guidance.", expected: ["xiang-behavioral:independent-work-saynext"] },
  { group: "independent_work", q: "How do you learn and execute when you are working independently?", expected: ["xiang-behavioral:independent-work-saynext"] },
  { group: "independent_work", q: "Tell me about something you had to persevere at for multiple months.", expected: ["xiang-behavioral:saynext-long-iteration"] },
  { group: "independent_work", q: "Describe a long project where you kept improving after repeated failures.", expected: ["xiang-behavioral:saynext-long-iteration"] },

  { group: "user_impact", q: "Tell me about a time you considered user impact in a project.", expected: ["xiang-behavioral:user-impact-reliability-saynext"] },
  { group: "user_impact", q: "How did you think about reliability and user trust in SayNext?", expected: ["xiang-behavioral:user-impact-reliability-saynext"] },

  { group: "prioritization", q: "How do you prioritize tasks when several deadlines happen together?", expected: ["xiang-behavioral:prioritization-local-travel-mode", "xiang-profile:work-motivation"] },
  { group: "prioritization", q: "Tell me about a trade-off you made between cost and reliability.", expected: ["xiang-behavioral:prioritization-local-travel-mode"] },
  { group: "prioritization", q: "Why did you split local mode and travel mode?", expected: ["xiang-behavioral:prioritization-local-travel-mode", "doc:saynext:llm-deployment"] },
  { group: "prioritization", q: "Describe a time you paused one feature to finish something more important.", expected: ["xiang-behavioral:prioritization-local-travel-mode"] },
  { group: "prioritization", q: "Tell me about a time your work responsibilities got overwhelming.", expected: ["xiang-behavioral:overwhelmed-scope-control"] },
  { group: "prioritization", q: "How do you handle a tight deadline when there are too many features?", expected: ["xiang-behavioral:overwhelmed-scope-control", "xiang-behavioral:prioritization-local-travel-mode"] },
  { group: "prioritization", q: "Give me a time management example from a project.", expected: ["xiang-behavioral:overwhelmed-scope-control", "xiang-behavioral:prioritization-local-travel-mode"] },

  { group: "requirements", q: "What do you do when requirements are vague?", expected: ["xiang-behavioral:vague-requirements-prenote-scene", "xiang-profile:ai-cognitive-style"] },
  { group: "requirements", q: "Tell me about a time you turned an unclear idea into a clear feature.", expected: ["xiang-behavioral:vague-requirements-prenote-scene"] },
  { group: "requirements", q: "Why did you add Prenote and scene profiles?", expected: ["xiang-behavioral:vague-requirements-prenote-scene", "doc:saynext:memory-personalization"] },
  { group: "requirements", q: "Describe a product design decision from SayNext.", expected: ["xiang-behavioral:vague-requirements-prenote-scene", "xiang-behavioral:leadership-ownership-saynext"] },

  { group: "conflict", q: "Tell me about a time you had a conflict with a teammate.", expected: ["xiang-behavioral:team-disagreement-pattern"] },
  { group: "conflict", q: "Describe a time you disagreed with a teammate.", expected: ["xiang-behavioral:team-disagreement-pattern"] },
  { group: "conflict", q: "How do you handle different ideas in a group project?", expected: ["xiang-behavioral:team-disagreement-pattern"] },
  { group: "conflict", q: "Give me an example of a technical disagreement.", expected: ["xiang-behavioral:team-disagreement-pattern"] },
  { group: "conflict", q: "Tell me about a disagreement with your manager.", expected: ["knowledge:behavioral-interview:manager-influence"] },
  { group: "conflict", q: "How would you influence somebody else when you disagree on the approach?", expected: ["knowledge:behavioral-interview:manager-influence", "xiang-behavioral:saynext-pushed-user-control"] },
  { group: "conflict", q: "What would you do if you needed information from someone who was not responsive?", expected: ["knowledge:behavioral-interview:unresponsive-info"] },
  { group: "conflict", q: "Tell me about a time you were blocked waiting for information.", expected: ["knowledge:behavioral-interview:unresponsive-info"] },

  { group: "achievement", q: "What achievement are you most satisfied with?", expected: ["xiang-behavioral:achievement-saynext"] },
  { group: "achievement", q: "What project are you most proud of?", expected: ["xiang-behavioral:achievement-saynext", "doc:saynext:interview-story"] },
  { group: "achievement", q: "Tell me about an accomplishment from your own project.", expected: ["xiang-behavioral:achievement-saynext"] },
  { group: "achievement", q: "Which project best shows your product thinking?", expected: ["xiang-behavioral:achievement-saynext", "doc:saynext:positioning"] },

  { group: "generic_pattern", q: "How should I answer behavioral interview questions with STAR?", expected: ["knowledge:behavioral-interview:star-patterns", "knowledge:cs-interview:answer-framework"] },
  { group: "generic_pattern", q: "What is a good structure for a software engineer conflict story?", expected: ["knowledge:behavioral-interview:star-patterns", "xiang-behavioral:team-disagreement-pattern"] },
  { group: "generic_pattern", q: "How should a developer talk about failure in an interview?", expected: ["knowledge:behavioral-interview:star-patterns", "xiang-behavioral:saynext-prompt-failure"] },
  { group: "generic_pattern", q: "What should I say if I never had a dramatic conflict?", expected: ["knowledge:behavioral-interview:no-dramatic-conflict"] },
  { group: "generic_pattern", q: "How should I answer harsh code review feedback from a senior engineer?", expected: ["knowledge:behavioral-interview:code-review-feedback"] },
  { group: "generic_pattern", q: "How do I answer why this company or why this role?", expected: ["knowledge:behavioral-interview:why-company-role"] },
  { group: "generic_pattern", q: "How should I answer a manager disagreement question if I am a student?", expected: ["knowledge:behavioral-interview:manager-influence"] },
  { group: "generic_pattern", q: "How should I answer an interview question about an unresponsive teammate?", expected: ["knowledge:behavioral-interview:unresponsive-info"] },
];

let top1 = 0;
let top3 = 0;
const failures: string[] = [];
const byGroup = new Map<string, { total: number; top1: number; top3: number }>();

for (const [index, test] of cases.entries()) {
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, test.q, 5);
  const refs = results.map((result) => result.sourceRef || `id:${result.id}`);
  const titles = results.map((result) => result.title);
  const ok1 = test.expected.includes(refs[0]);
  const ok3 = refs.slice(0, 3).some((ref) => test.expected.includes(ref));

  if (ok1) top1 += 1;
  if (ok3) top3 += 1;

  const stat = byGroup.get(test.group) ?? { total: 0, top1: 0, top3: 0 };
  stat.total += 1;
  if (ok1) stat.top1 += 1;
  if (ok3) stat.top3 += 1;
  byGroup.set(test.group, stat);

  if (!ok1) {
    failures.push(`#${index + 1} [${test.group}] ${test.q}
  expected: ${test.expected.join(" | ")}
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
  }
}

console.log(`BEHAVIORAL_STORIES cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  console.log(`${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}`);
}

if (failures.length > 0) {
  console.error("\nFAILURES");
  console.error(failures.join("\n\n"));
  process.exit(1);
}
