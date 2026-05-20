import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

const newRefs = [
  "xiang-update:2026-05-18:motivation-energy-work-rhythm",
  "xiang-update:2026-05-18:social-confidence-conversation-prep",
  "xiang-update:2026-05-18:recognition-self-image-capability",
  "xiang-update:2026-05-18:future-work-lifestyle-boundary",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "motivation-pattern",
    query: "How would you describe your motivation pattern?",
    expectedRefs: ["xiang-update:2026-05-18:motivation-energy-work-rhythm"],
  },
  {
    id: "interest-burst",
    query: "Are you a stable long-term grinder or more interest-triggered?",
    expectedRefs: ["xiang-update:2026-05-18:motivation-energy-work-rhythm"],
  },
  {
    id: "monitoring",
    query: "Why do you dislike constant manager check-ins and being monitored while working?",
    expectedRefs: ["xiang-update:2026-05-18:motivation-energy-work-rhythm"],
  },
  {
    id: "hyperfocus",
    query: "What happens once you enter project mode and hyperfocus?",
    expectedRefs: ["xiang-update:2026-05-18:motivation-energy-work-rhythm"],
  },
  {
    id: "social-confidence",
    query: "What kind of people do you envy socially or in English speaking?",
    expectedRefs: ["xiang-update:2026-05-18:social-confidence-conversation-prep"],
  },
  {
    id: "conversation-prep",
    query: "Do you simulate conversations mentally before speaking?",
    expectedRefs: ["xiang-update:2026-05-18:social-confidence-conversation-prep"],
  },
  {
    id: "observer",
    query: "Do you feel more like an observer of the world?",
    expectedRefs: ["xiang-update:2026-05-18:social-confidence-conversation-prep"],
  },
  {
    id: "recognition",
    query: "What do you want people to think about your ability?",
    expectedRefs: ["xiang-update:2026-05-18:recognition-self-image-capability"],
  },
  {
    id: "technical-genius",
    query: "Do you see yourself as a technical genius or star engineer?",
    expectedRefs: ["xiang-update:2026-05-18:recognition-self-image-capability"],
  },
  {
    id: "capability-insecurity",
    query: "Why do you sometimes feel insecure even after building projects?",
    expectedRefs: ["xiang-update:2026-05-18:recognition-self-image-capability"],
  },
  {
    id: "future-fear",
    query: "What kind of future or work culture do you fear?",
    expectedRefs: ["xiang-update:2026-05-18:future-work-lifestyle-boundary"],
  },
  {
    id: "life-preference",
    query: "What kind of lifestyle and work environment do you prefer long term?",
    expectedRefs: ["xiang-update:2026-05-18:future-work-lifestyle-boundary"],
  },
];

const negativeCases = [
  "What is self-esteem in psychology?",
  "Explain hyperfocus in general.",
  "What is high-pressure work culture?",
  "What does futuristic technology mean?",
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
    id: "llm-motivation-pattern",
    query: "How would you describe your motivation pattern?",
    expectedAny: ["interest", "burst", "not really", "stable", "grinder", "cool", "technical"],
    forbiddenAny: ["lazy"],
  },
  {
    id: "llm-monitoring",
    query: "Why do you dislike constant manager check-ins while working?",
    expectedAny: ["monitored", "pressure", "focus", "interrupt", "responsiveness", "quiet"],
    forbiddenAny: ["too dumb", "father"],
  },
  {
    id: "llm-technical-genius",
    query: "Do you see yourself as a technical genius?",
    expectedAny: ["not really", "reliable", "practical", "systems work", "make systems"],
    forbiddenAny: ["star engineer", "ultra-strong"],
  },
  {
    id: "llm-workplace-future",
    query: "What kind of future work culture do you want to avoid?",
    expectedAny: ["high-pressure", "no freedom", "constant socializing", "private space", "grind"],
    forbiddenAny: ["too dumb", "father"],
  },
  {
    id: "llm-social-confidence",
    query: "What kind of people do you envy in conversation?",
    expectedAny: ["speak naturally", "talk naturally", "fluent English", "English is fluent", "react quickly", "react fast", "knowledgeable", "sound smart"],
    forbiddenAny: ["diagnosed", "disorder"],
  },
  {
    id: "llm-unrelated-clean",
    query: "Explain hyperfocus in general.",
    expectedAny: ["focus", "attention", "task"],
    forbiddenAny: ["Xiang", "too dumb", "manager check-ins", "fluent English"],
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

lines.push("# Xiang Personality/Cognitive Profile Eval");
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
const mdPath = join(process.cwd(), "data", "eval", `xiang-personality-cognitive-profile-${timestamp}.md`);
const jsonPath = join(process.cwd(), "data", "eval", `xiang-personality-cognitive-profile-${timestamp}.json`);
writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");

console.log(`Personality/cognitive profile eval report: ${mdPath}`);
console.log(`Personality/cognitive profile eval data: ${jsonPath}`);
