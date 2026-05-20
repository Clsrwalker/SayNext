import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { conversationLogger } from "../src/server/data/conversation-logger";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv.find((arg) => !arg.startsWith("--") && arg.includes("@")) || "li2897283405@gmail.com";

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

const retrievalOnly = process.argv.includes("--retrieval-only");
const provider = args.get("provider") || "ollama";

const playbookRefs = [
  "knowledge:xiang-playbook:team-conflict",
  "knowledge:xiang-playbook:feedback",
  "knowledge:xiang-playbook:deadline-scope",
  "knowledge:xiang-playbook:hard-bug",
  "knowledge:xiang-playbook:demo-pressure",
  "knowledge:xiang-playbook:unclear-requirements",
  "knowledge:xiang-playbook:unknown-question",
  "knowledge:xiang-playbook:interview-no-fake-story",
  "knowledge:xiang-playbook:high-stakes-transaction",
];

type RetrievalCase = {
  id: string;
  query: string;
  expectedRefs: string[];
};

const retrievalCases: RetrievalCase[] = [
  {
    id: "team-conflict",
    query: "How should I answer if a teammate disagrees with my technical approach?",
    expectedRefs: ["knowledge:xiang-playbook:team-conflict"],
  },
  {
    id: "code-review-feedback",
    query: "I got harsh code review feedback from a senior engineer. What should I say?",
    expectedRefs: ["knowledge:xiang-playbook:feedback", "knowledge:behavioral-interview:code-review-feedback"],
  },
  {
    id: "deadline-scope",
    query: "The deadline is close and the team wants too many features. What should we do right now?",
    expectedRefs: ["knowledge:xiang-playbook:deadline-scope"],
  },
  {
    id: "hard-bug",
    query: "I found a hard bug but I don't know where it is. How should I debug it?",
    expectedRefs: ["knowledge:xiang-playbook:hard-bug"],
  },
  {
    id: "demo-pressure",
    query: "The demo is tomorrow and integration is flaky. What should we do?",
    expectedRefs: ["knowledge:xiang-playbook:demo-pressure"],
  },
  {
    id: "unclear-requirements",
    query: "The API contract keeps changing and requirements are unclear. What is the best next step?",
    expectedRefs: ["knowledge:xiang-playbook:unclear-requirements"],
  },
  {
    id: "unknown-answer",
    query: "How should I answer if I don't know enough about this question?",
    expectedRefs: ["knowledge:xiang-playbook:unknown-question"],
  },
  {
    id: "no-fake-story",
    query: "What should I say if I never had a dramatic conflict but the interviewer asks for a real example?",
    expectedRefs: ["knowledge:xiang-playbook:interview-no-fake-story", "knowledge:behavioral-interview:no-dramatic-conflict"],
  },
  {
    id: "transaction-pressure",
    query: "The landlord says I need to send a non-refundable deposit right now. What should I say?",
    expectedRefs: ["knowledge:xiang-playbook:high-stakes-transaction", "xiang-update:2026-05-18:deposit-contract-pressure-risk"],
  },
];

const negativeQueries = [
  "Could you explain Kubernetes in simple words?",
  "What is cache invalidation?",
  "What food do you usually cook?",
  "What music do you like?",
  "Tell me about your childhood friend.",
  "What is a hash map?",
];

type LlmCase = {
  id: string;
  scene: string;
  query: string;
  expectedAny: string[];
  forbiddenAny?: string[];
  maxWords?: number;
};

const llmCases: LlmCase[] = [
  {
    id: "team-conflict-sayable",
    scene: "Interview",
    query: "Tell me about a time you had a conflict with a teammate.",
    expectedAny: ["technical disagreement", "trade-off", "smaller working version", "deadline"],
    forbiddenAny: ["at my job", "at my company", "production team", "my manager told me"],
    maxWords: 80,
  },
  {
    id: "deadline-scope-sayable",
    scene: "Meeting / Group Discussion",
    query: "The deadline is close and the team wants too many features. What should we do right now?",
    expectedAny: ["core flow", "must-have", "cut", "nice-to-have", "demo"],
    forbiddenAny: ["we already finished", "ship everything", "just add all"],
    maxWords: 70,
  },
  {
    id: "hard-bug-sayable",
    scene: "Meeting / Group Discussion",
    query: "I found a hard bug but I don't know where it is. How should I debug it?",
    expectedAny: ["reproduce", "isolate", "logs", "raw", "one small"],
    forbiddenAny: ["just guess", "rewrite everything"],
    maxWords: 75,
  },
  {
    id: "unclear-requirements-sayable",
    scene: "Meeting / Group Discussion",
    query: "The API contract keeps changing and requirements are unclear. What is the best next step?",
    expectedAny: ["v1", "contract", "mock", "schema", "assumption"],
    forbiddenAny: ["`", "\"", "(", ")", "e.g."],
    maxWords: 70,
  },
  {
    id: "unknown-answer-sayable",
    scene: "Interview",
    query: "What should I say if I don't know enough about this question?",
    expectedAny: ["not fully sure", "verify", "current understanding", "check"],
    forbiddenAny: ["I know exactly", "definitely"],
    maxWords: 60,
  },
  {
    id: "transaction-safety-sayable",
    scene: "Daily Chat",
    query: "The landlord says I need to send a non-refundable deposit right now. What should I say?",
    expectedAny: ["writing", "receipt", "refund", "terms", "amount"],
    forbiddenAny: ["send it now", "just pay", "pay now"],
    maxWords: 65,
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

function wordCount(value: string): number {
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}

function sceneProfile(scene: string): string {
  if (scene === "Meeting / Group Discussion") {
    return "Active scene profile: Meeting / Group Discussion\nMove the task forward with blocker, risk, owner, decision, contract, test, or scope cut. Keep it short and spoken.";
  }
  if (scene === "Interview") {
    return "Active scene profile: Interview\nAnswer honestly, clearly, and without fake work history. If no exact story exists, use a real project pattern or explain the approach.";
  }
  return "Active scene profile: Daily Chat\nNatural, brief, cautious when money or contracts are involved.";
}

const lines: string[] = [];
const json: Record<string, unknown> = {
  userId,
  provider,
  retrieval: [],
  negative: [],
  llm: [],
};

let retrievalTop1 = 0;
let retrievalTop3 = 0;
let negativeClean = 0;
let llmPassed = 0;
let llmRan = false;

lines.push("# Xiang Response Playbook Eval");
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
  lines.push(`- ${top3Ok ? "PASS" : "FAIL"} ${test.id}: ${refs.slice(0, 4).join(" | ") || "none"}`);
  if (!top3Ok) lines.push(`  - expected: ${test.expectedRefs.join(" | ")}`);
  (json.retrieval as unknown[]).push({ ...test, refs, top1Ok, top3Ok });
}
lines.push("");

lines.push("## Negative Retrieval");
for (const query of negativeQueries) {
  const refs = refsFor(query, 6);
  const leaked = refs.filter((ref) => playbookRefs.includes(ref));
  const clean = leaked.length === 0;
  if (clean) negativeClean += 1;
  lines.push(`- ${clean ? "PASS" : "FAIL"} ${query}: ${refs.slice(0, 4).join(" | ") || "none"}`);
  if (!clean) lines.push(`  - leaked playbooks: ${leaked.join(" | ")}`);
  (json.negative as unknown[]).push({ query, refs, clean, leaked });
}
lines.push("");

lines.push("## LLM Output");
if (retrievalOnly) {
  lines.push("- SKIP: --retrieval-only");
} else {
  process.env.LLM_PROVIDER = provider;
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = "false";
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-nano";
  process.env.OPENAI_LONG_MODEL = process.env.OPENAI_LONG_MODEL || "gpt-5.4-mini";

  try {
    const { processConversation } = await import("../src/server/mastra/agents/initial-agent");
    llmRan = true;

    for (const test of llmCases) {
      const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.query, 5);
      const conversation: Conversation = [{ type: "transcript", text: test.query, timestamp: Date.now() }];
      const started = performance.now();
      const response = await processConversation(
        conversation,
        "low",
        undefined,
        "english",
        "",
        sceneProfile(test.scene),
        relevantMemory,
      );
      const latencyMs = Math.round(performance.now() - started);
      const output = response.type === "insight" ? response.output : "";
      const expectedOk = includesAny(output, test.expectedAny);
      const forbiddenHits = (test.forbiddenAny ?? []).filter((term) => includesAny(output, [term]));
      const words = wordCount(output);
      const lengthOk = !test.maxWords || words <= test.maxWords;
      const pass = expectedOk && forbiddenHits.length === 0 && lengthOk;
      if (pass) llmPassed += 1;
      lines.push(`- ${pass ? "PASS" : "CHECK"} ${test.id} (${latencyMs}ms, ${words} words)`);
      lines.push(`  - Q: ${test.query}`);
      lines.push(`  - refs: ${refsFor(test.query, 5).slice(0, 4).join(" | ") || "none"}`);
      lines.push(`  - output: ${output}`);
      if (!expectedOk) lines.push(`  - missing expected signal: ${test.expectedAny.join(" | ")}`);
      if (forbiddenHits.length) lines.push(`  - forbidden hits: ${forbiddenHits.join(" | ")}`);
      if (!lengthOk) lines.push(`  - too long: ${words}/${test.maxWords}`);
      (json.llm as unknown[]).push({
        ...test,
        relevantMemoryPresent: Boolean(relevantMemory.trim()),
        output,
        latencyMs,
        words,
        expectedOk,
        forbiddenHits,
        lengthOk,
        pass,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`- SKIP: LLM output eval failed: ${message}`);
    (json as any).llmError = message;
  }
}
lines.push("");

lines.push("## Summary");
lines.push(`- retrievalTop1: ${retrievalTop1}/${retrievalCases.length}`);
lines.push(`- retrievalTop3: ${retrievalTop3}/${retrievalCases.length}`);
lines.push(`- negativeClean: ${negativeClean}/${negativeQueries.length}`);
lines.push(`- llmPassed: ${llmRan ? `${llmPassed}/${llmCases.length}` : "skipped"}`);

(json as any).summary = {
  retrievalTop1,
  retrievalTotal: retrievalCases.length,
  retrievalTop3,
  negativeClean,
  negativeTotal: negativeQueries.length,
  llmPassed: llmRan ? llmPassed : null,
  llmTotal: llmRan ? llmCases.length : 0,
};

mkdirSync(join("data", "eval"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = join("data", "eval", `xiang-response-playbooks-${stamp}.md`);
const jsonPath = join("data", "eval", `xiang-response-playbooks-${stamp}.json`);
writeFileSync(reportPath, `${lines.join("\n")}\n`);
writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

console.log(`Response playbook eval report: ${reportPath}`);
console.log(`Response playbook eval data: ${jsonPath}`);

if (
  retrievalTop3 !== retrievalCases.length
  || negativeClean !== negativeQueries.length
  || (llmRan && llmPassed < llmCases.length - 1)
) {
  process.exitCode = 1;
}
