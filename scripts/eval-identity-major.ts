import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { EventMemoryManager } from "../src/server/memory/event-memory";
import { processConversation } from "../src/server/mastra/agents/initial-agent";

type CaseResult = {
  id: string;
  query: string;
  memoryRefs: string[];
  output: string;
  flags: string[];
  pass: boolean;
};

const userId = process.argv.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");

const tests = [
  { id: "major_direct", query: "What is your major?" },
  { id: "program_direct", query: "What program are you in?" },
  { id: "degree_direct", query: "Which degree are you taking?" },
  { id: "study_direct", query: "What are you studying?" },
  { id: "work_or_student", query: "Do you work or are you a student?" },
  { id: "asr_bad_grammar_major", query: "what major you study" },
  { id: "asr_bad_grammar_program", query: "what program you in" },
  { id: "asr_student", query: "you student or working now" },
];

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function memoryRefs(query: string): string[] {
  return conversationLogger
    .searchPersonalMemoriesHybrid(userId, query, 5)
    .map((memory) => memory.sourceRef || memory.title);
}

async function runCase(test: { id: string; query: string }): Promise<CaseResult> {
  const sessionId = `eval-identity-major-${test.id}-${Date.now()}`;
  const eventMemory = new EventMemoryManager(userId, sessionId);
  const snapshot = eventMemory.addTranscript(test.query, Date.now());
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.query, 4);
  const response = await processConversation(
    [{ type: "transcript", text: test.query, timestamp: Date.now() }],
    "high",
    snapshot,
    "english",
    "",
    conversationLogger.getActiveSceneProfilePrompt(userId),
    relevantMemory,
  );
  eventMemory.closeActiveEvent();

  const output = response.type === "insight" ? response.output : "";
  const flags: string[] = [];
  if (!includesAny(output, ["MACS", "Master of Applied Computer Science", "Applied Computer Science"])) {
    flags.push("missing_macs_or_applied_computer_science");
  }
  if (/\bmath(?:ematics)?\b/i.test(output)) {
    flags.push("mentions_math");
  }
  if (!/\bDalhousie\b/i.test(output)) {
    flags.push("missing_dalhousie");
  }

  return {
    id: test.id,
    query: test.query,
    memoryRefs: memoryRefs(test.query),
    output,
    flags,
    pass: flags.length === 0,
  };
}

function render(results: CaseResult[]): string {
  const lines: string[] = [];
  lines.push("# Identity Major Eval");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Cases: ${results.length}`);
  lines.push(`Failed: ${results.filter((result) => !result.pass).length}`);
  lines.push("");
  for (const result of results) {
    lines.push(`## ${result.pass ? "PASS" : "FAIL"} ${result.id}`);
    lines.push(`Query: ${result.query}`);
    lines.push(`Output: ${result.output}`);
    lines.push(`Memory refs: ${result.memoryRefs.join(" | ") || "(none)"}`);
    if (result.flags.length) lines.push(`Flags: ${result.flags.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

mkdirSync(outDir, { recursive: true });
const results: CaseResult[] = [];
for (const test of tests) {
  results.push(await runCase(test));
}

const reportPath = join(outDir, `identity-major-${timestamp}.md`);
const jsonPath = join(outDir, `identity-major-${timestamp}.json`);
writeFileSync(reportPath, render(results), "utf8");
writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

console.log(`IDENTITY_MAJOR_REPORT ${reportPath}`);
console.log(`cases: ${results.length}, failed: ${results.filter((result) => !result.pass).length}`);
for (const result of results.filter((item) => !item.pass)) {
  console.log(`- ${result.id}: ${result.flags.join(", ")} -> ${result.output}`);
}

if (results.some((result) => !result.pass)) {
  process.exitCode = 1;
}
