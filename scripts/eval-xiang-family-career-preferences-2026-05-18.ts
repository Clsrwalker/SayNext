import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

const newRefs = [
  "xiang-update:2026-05-18:no-food-allergies",
  "xiang-update:2026-05-18:deposit-contract-pressure-risk",
  "xiang-update:2026-05-18:family-communication-money-profile",
  "xiang-update:2026-05-18:formal-speaking-style",
  "xiang-update:2026-05-18:classroom-question-style",
  "xiang-update:2026-05-18:career-target-workplace-preferences",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "food-allergy",
    query: "Do you have any food allergies?",
    expectedRefs: ["xiang-update:2026-05-18:no-food-allergies"],
  },
  {
    id: "restaurant-allergy-check",
    query: "The server asks if you are allergic to any ingredient. What should you say?",
    expectedRefs: ["xiang-update:2026-05-18:no-food-allergies"],
  },
  {
    id: "deposit-pressure",
    query: "The landlord says I need to send the deposit now or lose the apartment.",
    expectedRefs: ["xiang-update:2026-05-18:deposit-contract-pressure-risk"],
  },
  {
    id: "lease-addendum",
    query: "Can you just sign the lease addendum now? Everyone signs it.",
    expectedRefs: ["xiang-update:2026-05-18:deposit-contract-pressure-risk"],
  },
  {
    id: "mom-late-reply",
    query: "What should you say if your mom is upset because you replied late?",
    expectedRefs: ["xiang-update:2026-05-18:family-communication-money-profile"],
  },
  {
    id: "family-property-rent",
    query: "So for the family property rent, what do you think we should do next?",
    expectedRefs: ["xiang-update:2026-05-18:family-communication-money-profile"],
  },
  {
    id: "father-admire",
    query: "Who do you admire most in your family?",
    expectedRefs: ["xiang-update:2026-05-18:family-communication-money-profile"],
  },
  {
    id: "sister-relationship",
    query: "How is your relationship with your sister?",
    expectedRefs: ["xiang-update:2026-05-18:family-communication-money-profile"],
  },
  {
    id: "formal-style",
    query: "What formal speaking style do you prefer?",
    expectedRefs: ["xiang-update:2026-05-18:formal-speaking-style"],
  },
  {
    id: "wedding-toast",
    query: "Can you help me make a wedding toast sound more like me?",
    expectedRefs: ["xiang-update:2026-05-18:formal-speaking-style"],
  },
  {
    id: "classroom-style",
    query: "What kind of questions do you ask in class?",
    expectedRefs: ["xiang-update:2026-05-18:classroom-question-style"],
  },
  {
    id: "professor-any-questions",
    query: "The professor asks if there are any questions after explaining cloud architecture.",
    expectedRefs: ["xiang-update:2026-05-18:classroom-question-style"],
  },
  {
    id: "target-role",
    query: "What kind of job do you want?",
    expectedRefs: ["xiang-update:2026-05-18:career-target-workplace-preferences"],
  },
  {
    id: "workplace-preference",
    query: "What workplace or team style fits you best?",
    expectedRefs: ["xiang-update:2026-05-18:career-target-workplace-preferences"],
  },
  {
    id: "skill-confidence",
    query: "Which technical areas are you more and less experienced in?",
    expectedRefs: ["xiang-update:2026-05-18:career-target-workplace-preferences"],
  },
];

const negativeCases = [
  "What is an API contract in general?",
  "What does remote-friendly mean in general?",
  "Explain food allergies medically in general.",
  "What is a wedding ceremony tradition in general?",
  "Explain Kubernetes in simple words.",
  "What is cache invalidation?",
];

type LlmCase = {
  id: string;
  query: string;
  expectedAny: string[];
  forbiddenAny?: string[];
};

const llmCases: LlmCase[] = [
  {
    id: "llm-allergy",
    query: "Do you have any food allergies?",
    expectedAny: ["don't have", "no food allergies", "no known food allergies"],
  },
  {
    id: "llm-deposit",
    query: "The landlord says I need to send the deposit right now or lose the apartment. Should I just pay?",
    expectedAny: ["writing", "check", "verify", "deposit", "receipt", "refund"],
    forbiddenAny: ["pay now", "just pay", "send it now"],
  },
  {
    id: "llm-mom-late",
    query: "My mom is upset because I didn't reply yesterday. What should I say right now?",
    expectedAny: ["group meeting", "went to eat", "had something", "sorry", "just saw"],
    forbiddenAny: ["father", "property", "money"],
  },
  {
    id: "llm-family-property",
    query: "So for the family property rent, what do you think we should do next?",
    expectedAny: ["numbers", "background", "details", "not guess", "lease"],
    forbiddenAny: ["market rent is", "definitely sell", "raise it to"],
  },
  {
    id: "llm-formal-style",
    query: "What formal speaking style do you prefer for graduation?",
    expectedAny: ["natural", "relaxed", "not too official", "not corporate", "humble"],
  },
  {
    id: "llm-classroom-question",
    query: "What kind of question should I ask after a lecture about cloud architecture?",
    expectedAny: ["edge case", "implementation", "would it be", "so basically", "short"],
    forbiddenAny: ["In conclusion", "as a groundbreaking question"],
  },
  {
    id: "llm-career",
    query: "What kind of job do you want?",
    expectedAny: ["full-stack", "AI", "cloud", "application", "developer"],
  },
  {
    id: "llm-unrelated-clean",
    query: "What is cache invalidation?",
    expectedAny: ["cache", "stale", "data"],
    forbiddenAny: ["mom", "father", "food allergies", "Full-stack Developer"],
  },
];

function refsFor(query: string, limit = 6): string[] {
  return conversationLogger
    .searchPersonalMemoriesHybrid(userId, query, limit)
    .map((memory) => memory.sourceRef || `id:${memory.id}`);
}

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

const lines: string[] = [];
const json: Record<string, unknown> = {
  userId,
  retrieval: [],
  negative: [],
  llm: [],
};

let retrievalTop1 = 0;
let retrievalTop3 = 0;
let negativeClean = 0;
let llmPassed = 0;

lines.push("# Xiang Family/Career Preference Eval");
lines.push("");
lines.push(`User: ${userId}`);
lines.push(`Time: ${new Date().toISOString()}`);
lines.push("");

lines.push("## Retrieval");
for (const test of retrievalCases) {
  const refs = refsFor(test.query, 6);
  const top1Ok = test.expectedRefs.includes(refs[0] || "");
  const top3Ok = refs.slice(0, 3).some((ref) => test.expectedRefs.includes(ref));
  if (top1Ok) retrievalTop1 += 1;
  if (top3Ok) retrievalTop3 += 1;
  lines.push(`- ${top3Ok ? "PASS" : "FAIL"} ${test.id}: top=${refs.slice(0, 4).join(" | ") || "none"}`);
  if (!top3Ok) lines.push(`  - expected: ${test.expectedRefs.join(" | ")}`);
  (json.retrieval as unknown[]).push({ ...test, refs, top1Ok, top3Ok });
}
lines.push("");

lines.push("## Negative Retrieval");
for (const query of negativeCases) {
  const refs = refsFor(query, 6);
  const leaked = refs.filter((ref) => newRefs.includes(ref));
  const clean = leaked.length === 0;
  if (clean) negativeClean += 1;
  lines.push(`- ${clean ? "PASS" : "FAIL"} ${query}: ${refs.slice(0, 4).join(" | ") || "none"}`);
  if (!clean) lines.push(`  - leaked new refs: ${leaked.join(" | ")}`);
  (json.negative as unknown[]).push({ query, refs, clean, leaked });
}
lines.push("");

const canRunOpenAi = Boolean(process.env.OPENAI_API_KEY);
lines.push("## LLM Output");
if (!canRunOpenAi) {
  lines.push("- SKIP: OPENAI_API_KEY is not set.");
} else {
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-nano";
  process.env.OPENAI_LONG_MODEL = process.env.OPENAI_LONG_MODEL || "gpt-5.4-mini";
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = "false";

  const { processConversation } = await import("../src/server/mastra/agents/initial-agent");

  for (const test of llmCases) {
    const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.query, 5);
    const conversation: Conversation = [{ type: "transcript", text: test.query, timestamp: Date.now() }];
    const started = performance.now();
    const response = await processConversation(conversation, "high", undefined, "english", "", "", relevantMemory);
    const latencyMs = Math.round(performance.now() - started);
    const output = response.type === "insight" ? response.output : "";
    const expectedOk = includesAny(output, test.expectedAny);
    const forbiddenHits = (test.forbiddenAny ?? []).filter((term) => includesAny(output, [term]));
    const pass = expectedOk && forbiddenHits.length === 0;
    if (pass) llmPassed += 1;
    lines.push(`- ${pass ? "PASS" : "CHECK"} ${test.id} (${latencyMs}ms)`);
    lines.push(`  - Q: ${test.query}`);
    lines.push(`  - refs: ${refsFor(test.query, 5).slice(0, 4).join(" | ") || "none"}`);
    lines.push(`  - output: ${output}`);
    if (!expectedOk) lines.push(`  - missing expected signal: ${test.expectedAny.join(" | ")}`);
    if (forbiddenHits.length) lines.push(`  - forbidden hits: ${forbiddenHits.join(" | ")}`);
    (json.llm as unknown[]).push({
      ...test,
      relevantMemoryPresent: Boolean(relevantMemory.trim()),
      output,
      latencyMs,
      expectedOk,
      forbiddenHits,
      pass,
    });
  }
}
lines.push("");

lines.push("## Summary");
lines.push(`- retrievalTop1: ${retrievalTop1}/${retrievalCases.length}`);
lines.push(`- retrievalTop3: ${retrievalTop3}/${retrievalCases.length}`);
lines.push(`- negativeClean: ${negativeClean}/${negativeCases.length}`);
lines.push(`- llmPassed: ${canRunOpenAi ? `${llmPassed}/${llmCases.length}` : "skipped"}`);

(json as any).summary = {
  retrievalTop1,
  retrievalTotal: retrievalCases.length,
  retrievalTop3,
  negativeClean,
  negativeTotal: negativeCases.length,
  llmPassed: canRunOpenAi ? llmPassed : null,
  llmTotal: canRunOpenAi ? llmCases.length : 0,
};

mkdirSync(join("data", "eval"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = join("data", "eval", `xiang-family-career-preferences-${stamp}.md`);
const jsonPath = join("data", "eval", `xiang-family-career-preferences-${stamp}.json`);
writeFileSync(reportPath, `${lines.join("\n")}\n`);
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

console.log(`Family/career preference eval report: ${reportPath}`);
console.log(`Family/career preference eval data: ${jsonPath}`);

if (retrievalTop3 !== retrievalCases.length || negativeClean !== negativeCases.length || (canRunOpenAi && llmPassed < llmCases.length - 1)) {
  process.exitCode = 1;
}
