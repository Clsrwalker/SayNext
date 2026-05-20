import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

const newRefs = [
  "xiang-update:2026-05-18:first-presentation-panic-history-class",
  "xiang-update:2026-05-18:snow-walk-home-boundary",
  "xiang-update:2026-05-18:travel-not-alone-preference",
  "xiang-update:2026-05-18:relationship-autonomy-no-pressure",
  "xiang-update:2026-05-18:developer-identity-frontend-to-ux",
  "xiang-update:2026-05-18:china-political-values-return-boundary",
  "xiang-update:2026-05-18:true-happiness-no-pressure",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "presentation-panic-history",
    query: "What was your first presentation panic after coming to Canada?",
    expectedRefs: ["xiang-update:2026-05-18:first-presentation-panic-history-class"],
  },
  {
    id: "presentation-phone-translator",
    query: "Did you ever read from a phone translator in a history class presentation?",
    expectedRefs: ["xiang-update:2026-05-18:first-presentation-panic-history-class"],
  },
  {
    id: "snow-walk-boundary",
    query: "Do you remember your first time walking home alone in snow in Canada?",
    expectedRefs: ["xiang-update:2026-05-18:snow-walk-home-boundary"],
  },
  {
    id: "solo-travel",
    query: "Do you like traveling alone?",
    expectedRefs: ["xiang-update:2026-05-18:travel-not-alone-preference"],
  },
  {
    id: "canada-travel-car",
    query: "Why have you not traveled much in Canada even after getting a car?",
    expectedRefs: ["xiang-update:2026-05-18:travel-not-alone-preference"],
  },
  {
    id: "relationship-ideal-type",
    query: "What is your ideal type in a relationship?",
    expectedRefs: ["xiang-update:2026-05-18:relationship-autonomy-no-pressure"],
  },
  {
    id: "relationship-finance-kids",
    query: "How do you think about relationship finances and having children?",
    expectedRefs: ["xiang-update:2026-05-18:relationship-autonomy-no-pressure"],
  },
  {
    id: "developer-ui-good",
    query: "What developer identity moment makes you feel the project is real?",
    expectedRefs: ["xiang-update:2026-05-18:developer-identity-frontend-to-ux"],
  },
  {
    id: "frontend-to-ux",
    query: "How did AI change your view of frontend work and user experience?",
    expectedRefs: ["xiang-update:2026-05-18:developer-identity-frontend-to-ux"],
  },
  {
    id: "political-return-china",
    query: "Why do you not want to return to China politically?",
    expectedRefs: ["xiang-update:2026-05-18:china-political-values-return-boundary"],
  },
  {
    id: "political-values-censorship",
    query: "What are your political values around censorship and authoritarianism?",
    expectedRefs: ["xiang-update:2026-05-18:china-political-values-return-boundary"],
  },
  {
    id: "true-happiness-pressure",
    query: "What does true happiness mean for you?",
    expectedRefs: ["xiang-update:2026-05-18:true-happiness-no-pressure"],
  },
];

const negativeCases = [
  "What was Tiananmen Square?",
  "Explain censorship in China generally.",
  "What is solo travel?",
  "What is a frontend developer?",
  "What is a relationship in databases?",
  "Explain phone translators in general.",
  "What is happiness in philosophy?",
  "What is snow in Canada like?",
];

type LlmCase = {
  id: string;
  query: string;
  expectedAny: string[];
  forbiddenAny?: string[];
};

const llmCases: LlmCase[] = [
  {
    id: "llm-presentation",
    query: "Tell me about your first presentation panic in Canada.",
    expectedAny: ["history", "translator", "nervous", "embarrass", "language barrier"],
    forbiddenAny: ["won an award", "perfect presentation"],
  },
  {
    id: "llm-snow-boundary",
    query: "Do you remember the first time you walked home alone in snow?",
    expectedAny: ["don't really remember", "do not really remember", "not really", "snow happens", "too often"],
    forbiddenAny: ["beautiful quiet street", "first snowfall changed my life"],
  },
  {
    id: "llm-travel",
    query: "Do you like traveling alone?",
    expectedAny: ["not really", "alone", "less fun", "with someone", "not much solo"],
  },
  {
    id: "llm-relationship",
    query: "What relationship style do you prefer?",
    expectedAny: ["freedom", "autonomy", "separate", "finances", "single"],
    forbiddenAny: ["want children soon", "must get married"],
  },
  {
    id: "llm-developer-identity",
    query: "How do you think about frontend now that AI can generate UI code?",
    expectedAny: ["user experience", "UX", "product feel", "actual experience", "frontend"],
    forbiddenAny: ["frontend is useless", "I hate frontend"],
  },
  {
    id: "llm-political-boundary",
    query: "Why do you not want to return to China politically?",
    expectedAny: ["authoritarian", "censorship", "freedom", "propaganda", "speech"],
    forbiddenAny: ["because of food", "because of weather"],
  },
  {
    id: "llm-happiness",
    query: "What does real happiness mean to you?",
    expectedAny: ["no pressure", "not pressure", "ordinary", "daily", "freedom"],
  },
  {
    id: "llm-unrelated-politics-clean",
    query: "What was Tiananmen Square?",
    expectedAny: ["Beijing", "public square", "China"],
    forbiddenAny: ["Xiang", "I don't want to return", "physically uncomfortable", "rather be lonely"],
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

lines.push("# Xiang Life Boundary Anchor Eval");
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
const mdPath = join(process.cwd(), "data", "eval", `xiang-life-boundary-anchors-${timestamp}.md`);
const jsonPath = join(process.cwd(), "data", "eval", `xiang-life-boundary-anchors-${timestamp}.json`);
writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");

console.log(`Life boundary anchor eval report: ${mdPath}`);
console.log(`Life boundary anchor eval data: ${jsonPath}`);
