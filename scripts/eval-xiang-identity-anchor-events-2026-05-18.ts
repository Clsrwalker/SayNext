import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

const newRefs = [
  "xiang-update:2026-05-18:english-social-awkwardness-anchor",
  "xiang-update:2026-05-18:driving-learning-confidence-anchor",
  "xiang-update:2026-05-18:canadian-identity-distance-anchor",
  "xiang-update:2026-05-18:halifax-home-feeling-anchor",
  "xiang-update:2026-05-18:ai-realization-not-toy-anchor",
  "xiang-update:2026-05-18:mr-jiang-mentor-anchor",
  "xiang-update:2026-05-18:hidden-insecurities-anchor",
  "xiang-update:2026-05-18:emotional-comfort-music-anchor",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "english-social-failure",
    query: "Do you remember one dramatic English social failure moment from early Canada?",
    expectedRefs: ["xiang-update:2026-05-18:english-social-awkwardness-anchor"],
  },
  {
    id: "english-adaptation-insecurity",
    query: "Did the insecurity from high school English adaptation ever fully disappear?",
    expectedRefs: ["xiang-update:2026-05-18:english-social-awkwardness-anchor"],
  },
  {
    id: "driving-learning",
    query: "When did you first learn driving and how did it feel?",
    expectedRefs: ["xiang-update:2026-05-18:driving-learning-confidence-anchor"],
  },
  {
    id: "natural-driving-skill",
    query: "What is one area where you felt surprisingly naturally talented?",
    expectedRefs: ["xiang-update:2026-05-18:driving-learning-confidence-anchor"],
  },
  {
    id: "canadian-identity",
    query: "Do you feel like a local Canadian or fully culturally integrated?",
    expectedRefs: ["xiang-update:2026-05-18:canadian-identity-distance-anchor"],
  },
  {
    id: "halifax-home",
    query: "Does Halifax feel like home to you?",
    expectedRefs: ["xiang-update:2026-05-18:halifax-home-feeling-anchor"],
  },
  {
    id: "ai-not-toy",
    query: "When did you first feel AI was not just a toy?",
    expectedRefs: ["xiang-update:2026-05-18:ai-realization-not-toy-anchor"],
  },
  {
    id: "ai-future-value",
    query: "How do you think AI changes the value of memorizing knowledge?",
    expectedRefs: ["xiang-update:2026-05-18:ai-realization-not-toy-anchor"],
  },
  {
    id: "mentor-jiang",
    query: "Who was Mr. Jiang and why was he important?",
    expectedRefs: ["xiang-update:2026-05-18:mr-jiang-mentor-anchor"],
  },
  {
    id: "study-abroad-help",
    query: "Who helped you with study abroad recommendation support in high school?",
    expectedRefs: ["xiang-update:2026-05-18:mr-jiang-mentor-anchor"],
  },
  {
    id: "hidden-insecurities",
    query: "What are the hidden insecurities you are afraid people will discover?",
    expectedRefs: ["xiang-update:2026-05-18:hidden-insecurities-anchor"],
  },
  {
    id: "emotional-comfort",
    query: "What gives you strong emotional comfort?",
    expectedRefs: ["xiang-update:2026-05-18:emotional-comfort-music-anchor"],
  },
  {
    id: "genshin-music",
    query: "What kind of music gives you emotional comfort, especially Genshin BGM?",
    expectedRefs: ["xiang-update:2026-05-18:emotional-comfort-music-anchor"],
  },
];

const negativeCases = [
  "What is a driving test in Canada?",
  "What is Canadian identity in sociology?",
  "Who developed GPT-3?",
  "Explain orchestral music in general.",
  "What is emotional regulation?",
  "What are recommendation letters in general?",
  "What does home mean philosophically?",
];

type LlmCase = {
  id: string;
  query: string;
  expectedAny: string[];
  forbiddenAny?: string[];
};

const llmCases: LlmCase[] = [
  {
    id: "llm-english-social",
    query: "Do you remember one dramatic English social failure moment?",
    expectedAny: ["not one", "no single", "one single", "constant awkwardness", "ongoing awkwardness", "weak English", "participate socially"],
    forbiddenAny: ["specific embarrassing story", "teacher laughed"],
  },
  {
    id: "llm-driving",
    query: "Tell me about when you learned driving.",
    expectedAny: ["summer 2024", "China", "first attempt", "quickly", "naturally"],
    forbiddenAny: ["failed", "major violation"],
  },
  {
    id: "llm-canadian-identity",
    query: "Do you feel like a local Canadian now?",
    expectedAny: ["not really", "not fully", "distance", "adapted", "not extreme loneliness"],
  },
  {
    id: "llm-halifax-home",
    query: "Does Halifax feel like home to you?",
    expectedAny: ["familiar", "comfortable", "not", "home", "moving", "childhood"],
  },
  {
    id: "llm-ai-not-toy",
    query: "When did you first feel AI was not just a toy?",
    expectedAny: ["conversation", "dynamic", "not fixed", "hardcoded", "GPT-3"],
  },
  {
    id: "llm-mr-jiang",
    query: "Who was Mr. Jiang in your life?",
    expectedAny: ["study abroad", "studying abroad", "recommendation", "advice", "guidance", "turning point", "Dalhousie"],
    forbiddenAny: ["father", "classmate"],
  },
  {
    id: "llm-hidden-insecurities",
    query: "What are the hidden insecurities you are afraid people will discover?",
    expectedAny: ["not smart enough", "English", "lazy", "not social", "not independent"],
  },
  {
    id: "llm-emotional-comfort",
    query: "What gives you emotional comfort?",
    expectedAny: ["freedom", "internet", "games", "private space", "music", "Genshin"],
  },
  {
    id: "llm-unrelated-music-clean",
    query: "Explain orchestral music in general.",
    expectedAny: ["instruments", "orchestra", "classical"],
    forbiddenAny: ["Xiang", "Genshin", "private space", "emotional comfort"],
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

lines.push("# Xiang Identity Anchor Events Eval");
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
  llmTotal: canRunOpenAi ? llmCases.length : null,
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(join(process.cwd(), "data", "eval"), { recursive: true });
const mdPath = join(process.cwd(), "data", "eval", `xiang-identity-anchor-events-${timestamp}.md`);
const jsonPath = join(process.cwd(), "data", "eval", `xiang-identity-anchor-events-${timestamp}.json`);
writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");

console.log(`Identity anchor events eval report: ${mdPath}`);
console.log(`Identity anchor events eval data: ${jsonPath}`);
