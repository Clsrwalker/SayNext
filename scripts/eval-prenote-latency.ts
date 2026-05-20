import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import { buildLosslessRuntimeContext, processPrenote } from "../src/server/prenotes/prenote-processor";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const userId = process.argv.find((arg) => arg.includes("@")) || `eval-prenote-latency-${Date.now()}`;
const iterations = Number(valueAfter("--iterations") || 4);

function valueAfter(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function nowMs(): number {
  return performance.now();
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number): number {
  return Math.round(value);
}

function makeEvent(transcripts: string[]): EventMemorySnapshot {
  return {
    eventId: `latency-${timestamp}`,
    scene: "classroom",
    title: "Prenote latency eval",
    summary: "Measuring SayNext latency with and without active prenote retrieval.",
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function makeConversation(latest: string): Conversation {
  const base = Date.now();
  return [
    { type: "transcript", text: "The professor is talking about deployment reliability.", timestamp: base - 4000 },
    { type: "transcript", text: latest, timestamp: base },
  ];
}

function buildLongPrenoteText(): string {
  const sections = [
    `# Deployment Reliability
LATENCY_CRITICAL_DEPLOYMENT: The demo answer should mention rollback owner, smoke test command, and monitoring checkpoint after release.`,
    Array.from({ length: 120 }, (_, index) => `Deployment filler ${index}: unrelated padding about schedules, notes, and background context.`).join("\n"),
    `# API Contract
LATENCY_CRITICAL_API: The important API contract fields are userId, sessionId, transcriptText, activePrenoteIds, and responseMode.`,
    Array.from({ length: 120 }, (_, index) => `API filler ${index}: unrelated padding about client screens and routes.`).join("\n"),
    `# Privacy Risk
LATENCY_CRITICAL_PRIVACY: Uploaded files and transcripts should stay as exact source text, with only relevant chunks entering the live LLM prompt.`,
  ];
  return sections.join("\n\n");
}

async function createActivePrenote(): Promise<number> {
  const title = `Latency Prenote ${timestamp}`;
  const sourceText = buildLongPrenoteText();
  const processed = await processPrenote({
    title,
    sourceText,
    description: "Latency eval prenote",
    files: [],
  });

  const prenote = conversationLogger.createPrenote({
    userId,
    title,
    sourceText,
    contentHash: processed.contentHash,
  });
  if (!prenote) throw new Error("Failed to create prenote");

  conversationLogger.updatePrenoteProcessing(prenote.id, {
    status: "ready",
    extractedText: processed.extractedText,
    processedJson: processed.processedJson,
    runtimeContext: buildLosslessRuntimeContext(title, processed.extractedText),
    model: processed.model,
    contentHash: processed.contentHash,
  });
  conversationLogger.setPrenoteActive(userId, prenote.id, true);

  const start = nowMs();
  const chunks = await conversationLogger.rebuildPrenoteChunks(prenote.id);
  const elapsed = nowMs() - start;
  console.log(`LATENCY_INDEX chunks=${chunks.length} embeddingModel=${chunks[0]?.embeddingModel || "(none)"} ms=${round(elapsed)}`);
  return prenote.id;
}

async function runOnce(label: string, latest: string, includePrenote: boolean): Promise<{
  label: string;
  retrievalMs: number;
  memoryMs: number;
  llmMs: number;
  totalMs: number;
  contextChars: number;
  output: string;
}> {
  const conversation = makeConversation(latest);
  const event = makeEvent(conversation.filter((item) => item.type === "transcript").map((item) => item.text));
  const activeSceneProfilePrompt = "Scene: Classroom. Give a concise useful answer or question.";
  const query = [
    latest,
    event.title,
    event.summary,
    event.recentTranscripts.slice(-4).join("\n"),
    activeSceneProfilePrompt,
  ].join("\n");

  const t0 = nowMs();
  const mode = label.includes("semantic") ? "semantic" : "fast";
  const activePrenoteContext = includePrenote
    ? await conversationLogger.getActivePrenoteRuntimeContextForQuery(userId, query, mode)
    : "";
  const t1 = nowMs();
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, query, 3);
  const t2 = nowMs();
  const response = await processConversation(
    conversation,
    "high",
    event,
    "english",
    activePrenoteContext,
    activeSceneProfilePrompt,
    relevantMemory,
  );
  const t3 = nowMs();

  return {
    label,
    retrievalMs: t1 - t0,
    memoryMs: t2 - t1,
    llmMs: t3 - t2,
    totalMs: t3 - t0,
    contextChars: activePrenoteContext.length,
    output: response.type === "insight" ? response.output : "",
  };
}

function formatRows(rows: Awaited<ReturnType<typeof runOnce>>[]): string {
  const labels = [...new Set(rows.map((row) => row.label))];
  return labels.map((label) => {
    const subset = rows.filter((row) => row.label === label);
    const retrieval = subset.map((row) => row.retrievalMs);
    const memory = subset.map((row) => row.memoryMs);
    const llm = subset.map((row) => row.llmMs);
    const total = subset.map((row) => row.totalMs);
    const chars = subset.map((row) => row.contextChars);
    return [
      `## ${label}`,
      "",
      `- runs: ${subset.length}`,
      `- retrieval avg/p95: ${round(avg(retrieval))}ms / ${round(percentile(retrieval, 95))}ms`,
      `- memory avg/p95: ${round(avg(memory))}ms / ${round(percentile(memory, 95))}ms`,
      `- llm avg/p95: ${round(avg(llm))}ms / ${round(percentile(llm, 95))}ms`,
      `- total avg/p95: ${round(avg(total))}ms / ${round(percentile(total, 95))}ms`,
      `- prenote context chars avg: ${round(avg(chars))}`,
      "",
      "Sample output:",
      "```text",
      subset[subset.length - 1]?.output || "",
      "```",
    ].join("\n");
  }).join("\n\n");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const rows: Awaited<ReturnType<typeof runOnce>>[] = [];
  const baselineQuestion = "How should I explain a rollback plan in deployment?";
  const prenoteQuestion = "What should I say about the rollback owner and smoke test command?";
  const longPrenoteQuestion = "Can you help me explain the deployment rollback owner and smoke test command in more detail for a presentation?";

  for (let index = 0; index < iterations; index += 1) {
    rows.push(await runOnce("baseline_no_prenote", baselineQuestion, false));
  }

  const prenoteId = await createActivePrenote();
  try {
    for (let index = 0; index < iterations; index += 1) {
      rows.push(await runOnce("prenote_fast_retrieval_plus_llm", prenoteQuestion, true));
    }
    for (let index = 0; index < iterations; index += 1) {
      rows.push(await runOnce("prenote_semantic_retrieval_plus_llm", longPrenoteQuestion, true));
    }
  } finally {
    conversationLogger.deletePrenote(userId, prenoteId);
  }

  const report = [
    "# Prenote Latency Eval",
    "",
    `- timestamp: ${new Date().toISOString()}`,
    `- userId: ${userId}`,
    `- iterations: ${iterations}`,
    `- embeddingProvider: ${process.env.PRENOTE_EMBEDDING_PROVIDER || "auto"}`,
    `- llmProvider: ${process.env.LLM_PROVIDER || "auto/default"}`,
    "",
    formatRows(rows),
    "",
    "## Raw Rows",
    "",
    "```json",
    JSON.stringify(rows.map((row) => ({
      ...row,
      retrievalMs: round(row.retrievalMs),
      memoryMs: round(row.memoryMs),
      llmMs: round(row.llmMs),
      totalMs: round(row.totalMs),
      output: row.output.slice(0, 240),
    })), null, 2),
    "```",
  ].join("\n");

  const path = join(outDir, `prenote-latency-${timestamp}.md`);
  writeFileSync(path, report, "utf8");
  console.log(`PRENOTE_LATENCY_REPORT ${path}`);
  console.log(formatRows(rows));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
