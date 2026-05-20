import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

const newRefs = [
  "xiang-update:2026-05-18:hybrid-search-memory-assistant-origin",
  "xiang-update:2026-05-18:hybrid-search-memory-assistant-goal-architecture",
  "xiang-update:2026-05-18:personal-growth-achievement",
  "xiang-update:2026-05-18:technical-strengths-weaknesses",
  "xiang-update:2026-05-18:procrastination-project-blockers",
  "xiang-update:2026-05-18:ai-assisted-development-workflow",
  "xiang-update:2026-05-18:english-confidence-turning-point",
  "xiang-update:2026-05-18:blood-donation-first-software-project",
  "xiang-update:2026-05-18:ai-meeting-monitor",
  "xiang-update:2026-05-18:solitude-communication-preferences",
  "xiang-update:2026-05-18:nostalgic-childhood-neighborhood",
  "xiang-update:2026-05-18:ideal-day-low-pressure",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "hsma-origin",
    query: "Why did you become interested in real-time AI assistants?",
    expectedRefs: ["xiang-update:2026-05-18:hybrid-search-memory-assistant-origin"],
  },
  {
    id: "hsma-project",
    query: "What is your Hybrid Search Memory Assistant project?",
    expectedRefs: [
      "xiang-update:2026-05-18:hybrid-search-memory-assistant-origin",
      "xiang-update:2026-05-18:hybrid-search-memory-assistant-goal-architecture",
    ],
  },
  {
    id: "hsma-token-goal",
    query: "What was the main technical goal for reducing input tokens in your Hybrid Search Memory Assistant?",
    expectedRefs: ["xiang-update:2026-05-18:hybrid-search-memory-assistant-goal-architecture"],
  },
  {
    id: "proudest-achievement",
    query: "What is your proudest achievement?",
    expectedRefs: ["xiang-update:2026-05-18:personal-growth-achievement"],
  },
  {
    id: "lowest-period",
    query: "What was your lowest or most difficult period?",
    expectedRefs: ["xiang-update:2026-05-18:personal-growth-achievement"],
  },
  {
    id: "technical-strengths",
    query: "What are your technical strengths?",
    expectedRefs: ["xiang-update:2026-05-18:technical-strengths-weaknesses"],
  },
  {
    id: "technical-weaknesses",
    query: "What are your technical weaknesses?",
    expectedRefs: ["xiang-update:2026-05-18:technical-strengths-weaknesses"],
  },
  {
    id: "procrastination",
    query: "How do you usually procrastinate?",
    expectedRefs: ["xiang-update:2026-05-18:procrastination-project-blockers"],
  },
  {
    id: "project-blockers",
    query: "What project problems or blockers do you run into most often?",
    expectedRefs: ["xiang-update:2026-05-18:procrastination-project-blockers"],
  },
  {
    id: "ai-workflow",
    query: "How do you prefer to use AI when coding?",
    expectedRefs: ["xiang-update:2026-05-18:ai-assisted-development-workflow"],
  },
  {
    id: "bad-ai-style",
    query: "What AI response style do you dislike?",
    expectedRefs: ["xiang-update:2026-05-18:ai-assisted-development-workflow"],
  },
  {
    id: "english-confidence",
    query: "When did you first feel confident speaking English?",
    expectedRefs: ["xiang-update:2026-05-18:english-confidence-turning-point"],
  },
  {
    id: "blood-donation-first-project",
    query: "What was your first real software project?",
    expectedRefs: ["xiang-update:2026-05-18:blood-donation-first-software-project"],
  },
  {
    id: "blood-donation-role",
    query: "What did you do in the Blood Donation Management System?",
    expectedRefs: ["xiang-update:2026-05-18:blood-donation-first-software-project"],
  },
  {
    id: "meeting-monitor-overview",
    query: "Tell me about your AI Meeting Monitor project.",
    expectedRefs: ["xiang-update:2026-05-18:ai-meeting-monitor"],
  },
  {
    id: "meeting-monitor-stress",
    query: "What was stressful about AI Meeting Monitor near the deadline?",
    expectedRefs: ["xiang-update:2026-05-18:ai-meeting-monitor"],
  },
  {
    id: "solitude",
    query: "Why do you prefer being alone?",
    expectedRefs: ["xiang-update:2026-05-18:solitude-communication-preferences"],
  },
  {
    id: "communication-style",
    query: "What communication styles do you dislike?",
    expectedRefs: ["xiang-update:2026-05-18:solitude-communication-preferences"],
  },
  {
    id: "nostalgic-childhood",
    query: "What childhood period do you remember most warmly?",
    expectedRefs: ["xiang-update:2026-05-18:nostalgic-childhood-neighborhood"],
  },
  {
    id: "ideal-day",
    query: "What is your ideal day like?",
    expectedRefs: ["xiang-update:2026-05-18:ideal-day-low-pressure"],
  },
];

const negativeCases = [
  "Could you explain Kubernetes in simple words?",
  "What is cache invalidation?",
  "How do I configure an S3 bucket policy?",
  "Can you summarize this public lecture about distributed systems?",
  "What should I ask before buying a used monitor?",
  "Give me a general definition of hybrid search, not from my project.",
];

type LlmCase = {
  id: string;
  query: string;
  expectedAll?: string[];
  expectedAny?: string[];
  forbiddenAny?: string[];
};

const llmCases: LlmCase[] = [
  {
    id: "llm-hsma-origin",
    query: "Why did you build Hybrid Search Memory Assistant?",
    expectedAll: ["Hybrid Search Memory Assistant"],
    expectedAny: ["weak English", "conversation", "translation", "Canada"],
    forbiddenAny: ["SayNext"],
  },
  {
    id: "llm-hsma-users-revenue",
    query: "Tell me about your production users and revenue for that Hybrid Search Memory Assistant.",
    expectedAny: ["not", "personal", "experimental", "no production", "no revenue"],
    forbiddenAny: ["paid pilot", "paying users", "launched commercially"],
  },
  {
    id: "llm-proudest-achievement",
    query: "What is your proudest achievement?",
    expectedAny: ["working systems", "real software", "turning ideas", "struggling"],
  },
  {
    id: "llm-technical-weakness",
    query: "What is your technical weakness?",
    expectedAny: ["LeetCode", "algorithms", "advanced math", "competitive programming"],
  },
  {
    id: "llm-blood-donation",
    query: "What was your first real software project?",
    expectedAll: ["Blood Donation"],
    expectedAny: ["ASP.NET", "C#", "database", "backend"],
  },
  {
    id: "llm-ai-meeting-monitor",
    query: "Tell me about your AI Meeting Monitor project.",
    expectedAll: ["AI Meeting Monitor"],
    expectedAny: ["React", "TypeScript", "integration", "testing", "A grade"],
  },
  {
    id: "llm-ai-workflow",
    query: "How do you prefer to use AI when coding?",
    expectedAny: ["project structure", "break", "TDD", "diff", "human verifies", "review"],
  },
  {
    id: "llm-unrelated-technical-clean",
    query: "Could you explain Kubernetes in simple words?",
    expectedAny: ["container", "manage", "scale"],
    forbiddenAny: ["Hybrid Search Memory Assistant", "Blood Donation", "AI Meeting Monitor", "weak English"],
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

function includesAll(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.every((term) => normalized.includes(term.toLowerCase()));
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

lines.push("# Xiang Memory Gap Eval");
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
    const allOk = test.expectedAll ? includesAll(output, test.expectedAll) : true;
    const anyOk = test.expectedAny ? includesAny(output, test.expectedAny) : true;
    const forbiddenHits = (test.forbiddenAny ?? []).filter((term) => includesAny(output, [term]));
    const pass = allOk && anyOk && forbiddenHits.length === 0;
    if (pass) llmPassed += 1;
    lines.push(`- ${pass ? "PASS" : "CHECK"} ${test.id} (${latencyMs}ms)`);
    lines.push(`  - Q: ${test.query}`);
    lines.push(`  - refs: ${refsFor(test.query, 5).slice(0, 4).join(" | ") || "none"}`);
    lines.push(`  - output: ${output}`);
    if (!allOk && test.expectedAll) lines.push(`  - missing all-required signal: ${test.expectedAll.join(" | ")}`);
    if (!anyOk && test.expectedAny) lines.push(`  - missing any signal: ${test.expectedAny.join(" | ")}`);
    if (forbiddenHits.length) lines.push(`  - forbidden hits: ${forbiddenHits.join(" | ")}`);
    (json.llm as unknown[]).push({
      ...test,
      relevantMemoryPresent: Boolean(relevantMemory.trim()),
      output,
      latencyMs,
      allOk,
      anyOk,
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
const reportPath = join("data", "eval", `xiang-memory-gaps-${stamp}.md`);
const jsonPath = join("data", "eval", `xiang-memory-gaps-${stamp}.json`);
writeFileSync(reportPath, `${lines.join("\n")}\n`);
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

console.log(`Memory gap eval report: ${reportPath}`);
console.log(`Memory gap eval data: ${jsonPath}`);

if (retrievalTop3 !== retrievalCases.length || negativeClean !== negativeCases.length || (canRunOpenAi && llmPassed < llmCases.length - 1)) {
  process.exitCode = 1;
}
