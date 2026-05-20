import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateOptionalContinuation } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";

type SmokeCase = {
  id: string;
  sourceTranscript: string;
  displayedAnswer: string;
  scene: string;
  output: string | null;
  elapsedMs: number;
  flags: string[];
  pass: boolean;
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");

function fakeEvent(scene: string, sourceTranscript: string): EventMemorySnapshot {
  return {
    eventId: `smoke-${Date.now()}`,
    scene,
    title: sourceTranscript,
    summary: `Scene: ${scene}. Recent context: ${sourceTranscript}`,
    transcriptCount: 1,
    aiReplyCount: 1,
    recentTranscripts: [sourceTranscript],
  };
}

async function runCase(input: Omit<SmokeCase, "output" | "elapsedMs" | "flags" | "pass">): Promise<SmokeCase> {
  const conversation: Conversation = [
    { type: "transcript", text: input.sourceTranscript, timestamp: Date.now() - 1000 },
  ];
  const started = performance.now();
  const output = await generateOptionalContinuation({
    conversation,
    eventMemory: fakeEvent(input.scene, input.sourceTranscript),
    outputLanguage: "english",
    activePrenoteContext: "",
    activeSceneProfilePrompt: "",
    relevantPersonalMemoryContext: "",
    sourceTranscript: input.sourceTranscript,
    displayedAnswer: input.displayedAnswer,
  });
  const elapsedMs = Math.round(performance.now() - started);
  const flags: string[] = [];
  if (output && output.split(/\s+/).filter(Boolean).length > 36) flags.push("too_long");
  if (output && input.displayedAnswer.toLowerCase().includes(output.toLowerCase().replace(/[.!?]+$/g, ""))) {
    flags.push("repeats_existing_answer");
  }
  if (input.scene === "service_or_advisor" && output) flags.push("service_should_decline");
  if (elapsedMs > 9000) flags.push(`slow_${elapsedMs}ms`);
  return {
    ...input,
    output,
    elapsedMs,
    flags,
    pass: flags.length === 0,
  };
}

function render(results: SmokeCase[]): string {
  const lines: string[] = [];
  const failed = results.filter((item) => !item.pass);
  lines.push("# Readback Continuation LLM Smoke");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Cases: ${results.length}`);
  lines.push(`Failed: ${failed.length}`);
  lines.push("");
  for (const result of results) {
    lines.push(`## ${result.pass ? "PASS" : "FAIL"} ${result.id}`);
    lines.push(`Scene: ${result.scene}`);
    lines.push(`Elapsed: ${result.elapsedMs}ms`);
    lines.push(`Source: ${result.sourceTranscript}`);
    lines.push(`Displayed: ${result.displayedAnswer}`);
    lines.push(`Continuation: ${result.output ?? "NO_CONTINUATION"}`);
    if (result.flags.length) lines.push(`Flags: ${result.flags.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const cases = [
    {
      id: "macs_major_followup",
      scene: "interview",
      sourceTranscript: "Do you work or are you a student, and what is your major?",
      displayedAnswer: "I'm currently a MACS student at Dalhousie, so it's Master of Applied Computer Science. It is more applied and project-focused than a pure math program.",
    },
    {
      id: "project_followup",
      scene: "interview",
      sourceTranscript: "Could you tell me about a project you made?",
      displayedAnswer: "One project I worked on is SayNext, a mobile real-time conversation assistant. It listens to live transcript and suggests a natural sentence I can say next.",
    },
    {
      id: "service_decline",
      scene: "service_or_advisor",
      sourceTranscript: "Could I have your ID, please?",
      displayedAnswer: "Okay, here you go.",
    },
  ];
  const results: SmokeCase[] = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase));
  }

  const report = render(results);
  const reportPath = join(outDir, `readback-continuation-llm-smoke-${timestamp}.md`);
  const jsonPath = join(outDir, `readback-continuation-llm-smoke-${timestamp}.json`);
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

  const failed = results.filter((item) => !item.pass);
  console.log(`READBACK_CONTINUATION_LLM_SMOKE_REPORT ${reportPath}`);
  console.log(`cases: ${results.length}, failed: ${failed.length}`);
  for (const result of failed) {
    console.log(`- ${result.id}: ${result.flags.join(", ")}`);
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
