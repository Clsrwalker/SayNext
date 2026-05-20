import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

const newRefs = [
  "xiang-update:2026-05-18:childhood-personality-change",
  "xiang-update:2026-05-18:study-avoidance-turnaround",
  "xiang-update:2026-05-18:languages-german-japanese",
  "xiang-update:2026-05-18:soccer-history",
  "xiang-update:2026-05-18:food-restaurants-cooking",
  "xiang-update:2026-05-18:drinks-diet-coke",
  "xiang-update:2026-05-18:canada-high-school-friends",
  "xiang-update:2026-05-18:childhood-friend-xu-ziyang",
  "xiang-update:2026-05-18:host-family-grace-michael",
  "xiang-update:2026-05-18:undergrad-covid-life",
  "xiang-update:2026-05-18:undergrad-roommates",
  "xiang-update:2026-05-18:undergrad-ebike-hill",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "childhood-personality-en",
    query: "What were you like as a kid?",
    expectedRefs: ["xiang-update:2026-05-18:childhood-personality-change"],
  },
  {
    id: "childhood-personality-cn",
    query: "小时候的我是个怎样的人呢",
    expectedRefs: ["xiang-update:2026-05-18:childhood-personality-change"],
  },
  {
    id: "study-turnaround",
    query: "Were you a good student in middle school and high school?",
    expectedRefs: ["xiang-update:2026-05-18:study-avoidance-turnaround"],
  },
  {
    id: "canada-high-school",
    query: "How was your high school experience after moving to Canada?",
    expectedRefs: ["xiang-update:2026-05-18:study-avoidance-turnaround"],
  },
  {
    id: "languages-en",
    query: "What languages have you learned?",
    expectedRefs: ["xiang-update:2026-05-18:languages-german-japanese"],
  },
  {
    id: "languages-cn",
    query: "你学过什么语言，以后还想学什么",
    expectedRefs: ["xiang-update:2026-05-18:languages-german-japanese"],
  },
  {
    id: "soccer",
    query: "Did you play soccer when you were younger?",
    expectedRefs: ["xiang-update:2026-05-18:soccer-history"],
  },
  {
    id: "future-sport",
    query: "What sport would you like to try in the future?",
    expectedRefs: ["xiang-update:2026-05-18:soccer-history"],
  },
  {
    id: "restaurants",
    query: "What restaurants do you go to often?",
    expectedRefs: ["xiang-update:2026-05-18:food-restaurants-cooking"],
  },
  {
    id: "cooking",
    query: "What do you usually cook at home?",
    expectedRefs: ["xiang-update:2026-05-18:food-restaurants-cooking"],
  },
  {
    id: "drinks",
    query: "What do you usually drink?",
    expectedRefs: ["xiang-update:2026-05-18:drinks-diet-coke"],
  },
  {
    id: "canada-friends",
    query: "Tell me about your high school friends in Canada.",
    expectedRefs: ["xiang-update:2026-05-18:canada-high-school-friends"],
  },
  {
    id: "childhood-best-friend",
    query: "Who was your childhood best friend?",
    expectedRefs: ["xiang-update:2026-05-18:childhood-friend-xu-ziyang"],
  },
  {
    id: "host-family",
    query: "Tell me about your host family in Canada.",
    expectedRefs: ["xiang-update:2026-05-18:host-family-grace-michael"],
  },
  {
    id: "undergrad-covid",
    query: "How was your undergraduate life during COVID?",
    expectedRefs: ["xiang-update:2026-05-18:undergrad-covid-life"],
  },
  {
    id: "undergrad-peer-influence",
    query: "Who influenced you during undergrad?",
    expectedRefs: ["xiang-update:2026-05-18:undergrad-roommates"],
  },
  {
    id: "undergrad-transport",
    query: "How did you get around during undergrad?",
    expectedRefs: ["xiang-update:2026-05-18:undergrad-ebike-hill"],
  },
];

const negativeCases = [
  "Could you explain Kubernetes in simple words?",
  "What should we do about API contract changes?",
  "Can you help me compare EC2 host networking and container networking?",
  "What should I check before buying a used monitor?",
  "What is the weather like tomorrow?",
];

type LlmCase = {
  id: string;
  query: string;
  expectedAny: string[];
  forbiddenAny?: string[];
};

const llmCases: LlmCase[] = [
  {
    id: "llm-childhood",
    query: "What were you like as a kid?",
    expectedAny: ["active", "mischievous", "quiet", "middle school"],
  },
  {
    id: "llm-languages",
    query: "What languages have you learned?",
    expectedAny: ["English", "German", "Japanese"],
  },
  {
    id: "llm-food",
    query: "What restaurants do you go to often?",
    expectedAny: ["KFC", "Mary Brown", "fried chicken"],
  },
  {
    id: "llm-host-family-privacy",
    query: "Tell me about your host family in Canada.",
    expectedAny: ["warm", "English", "food", "home"],
    forbiddenAny: ["Grace", "Michael", "Andrew"],
  },
  {
    id: "llm-friends-privacy",
    query: "Tell me about your high school friends in Canada.",
    expectedAny: ["Halifax", "Dartmouth", "mall", "bus"],
    forbiddenAny: ["Zhang", "Yifeng", "Xue"],
  },
  {
    id: "llm-unrelated-technical",
    query: "Could you explain Kubernetes in simple words?",
    expectedAny: ["container", "manage", "scale"],
    forbiddenAny: ["KFC", "childhood", "host family", "Diet Coke"],
  },
];

function refsFor(query: string, limit = 5): string[] {
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

lines.push("# Xiang Personal Life Memory Eval");
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
  const status = top3Ok ? "PASS" : "FAIL";
  lines.push(`- ${status} ${test.id}: top=${refs.slice(0, 4).join(" | ") || "none"}`);
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
    const forbiddenOk = forbiddenHits.length === 0;
    const pass = expectedOk && forbiddenOk;
    if (pass) llmPassed += 1;
    lines.push(`- ${pass ? "PASS" : "CHECK"} ${test.id} (${latencyMs}ms)`);
    lines.push(`  - Q: ${test.query}`);
    lines.push(`  - refs: ${refsFor(test.query, 5).slice(0, 4).join(" | ") || "none"}`);
    lines.push(`  - output: ${output}`);
    if (!expectedOk) lines.push(`  - missing expected signal: ${test.expectedAny.join(" | ")}`);
    if (!forbiddenOk) lines.push(`  - forbidden hits: ${forbiddenHits.join(" | ")}`);
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
const reportPath = join("data", "eval", `xiang-personal-life-memory-${stamp}.md`);
const jsonPath = join("data", "eval", `xiang-personal-life-memory-${stamp}.json`);
writeFileSync(reportPath, `${lines.join("\n")}\n`);
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

console.log(`Personal life memory eval report: ${reportPath}`);
console.log(`Personal life memory eval data: ${jsonPath}`);

if (retrievalTop3 !== retrievalCases.length || negativeClean !== negativeCases.length || (canRunOpenAi && llmPassed < llmCases.length - 1)) {
  process.exitCode = 1;
}
