import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { conversationLogger, type PersonalMemoryRecord } from "../src/server/data/conversation-logger";
import { LightweightEvenHubV2ContextAdapter, type EvenHubV2MemorySearchMode } from "../src/server/evenhub-v2/context-adapter";
import { getDeepSenseInterviewCards } from "../src/server/evenhub-v2/interview-guide";
import {
  evaluateMemoryRetrieval,
  validateMemoryRetrievalGoldenCases,
  type MemoryRetrievalGoldenCase,
  type MemoryRetrievalMetrics,
  type MemoryRetrievalPrediction,
} from "../src/server/evenhub-v2/memory-retrieval-eval";
import { defaultEvenHubV2Settings } from "../src/server/evenhub-v2/protocol";

type GoldenFile = {
  version: number;
  createdAt: string;
  userId: string;
  description: string;
  source: Record<string, unknown>;
  annotationPolicy: Record<string, unknown>;
  memoryCatalogSnapshot: Record<string, { sourceRef: string; title: string }>;
  cases: MemoryRetrievalGoldenCase[];
};

type EvalRun = {
  name: string;
  description: string;
  metrics: MemoryRetrievalMetrics;
  elapsedMs: number;
};

const goldenPath = process.argv.find((argument) => argument.startsWith("--golden="))?.slice("--golden=".length)
  || "data/eval/evenhub-v2-real-asr-memory-retrieval-golden-v1.json";
const runNames = (process.argv.find((argument) => argument.startsWith("--runs="))?.slice("--runs=".length)
  || "semantic,openai_vector_only,adaptive,lexical")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const outputDir = process.argv.find((argument) => argument.startsWith("--output-dir="))?.slice("--output-dir=".length)
  || "data/review";
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFile;
const userId = process.argv.find((argument) => argument.includes("@")) || golden.userId;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function parseMemoryId(value: string): number | null {
  const match = value.match(/^personal-memory:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function normalizeVector(values: number[]): number[] {
  const finite = values.map(Number).filter(Number.isFinite);
  const norm = Math.sqrt(finite.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? finite.map((value) => value / norm) : finite;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || !left.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return dot;
}

function isDetailedPersonalMemory(memory: PersonalMemoryRecord): boolean {
  if (!memory.content.trim()) return false;
  if (memory.source === "knowledge" || memory.sourceRef?.startsWith("knowledge:")) return false;
  if (memory.category.startsWith("knowledge_")) return false;
  if (["interview_job", "interview_profile", "knowledge_prenote"].includes(memory.category)) return false;
  if (/selected project list/i.test(memory.title)) return false;
  return true;
}

function vectorQuery(testCase: MemoryRetrievalGoldenCase): string {
  return testCase.recentContext?.trim()
    ? `${testCase.asrQuestion}\nRecent context:\n${testCase.recentContext.trim()}`
    : testCase.asrQuestion;
}

async function createOpenAiEmbeddings(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for openai_vector_only");
  const model = process.env.PERSONAL_MEMORY_EMBEDDING_MODEL || "text-embedding-3-small";
  const dimensions = Number(process.env.PERSONAL_MEMORY_EMBEDDING_DIMENSIONS || 0);
  const body: Record<string, unknown> = { model, input: inputs };
  if (Number.isInteger(dimensions) && dimensions > 0) body.dimensions = dimensions;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`OpenAI embedding request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
  const embeddings = [...(data.data || [])]
    .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
    .map((item) => normalizeVector(Array.isArray(item.embedding) ? item.embedding : []));
  if (embeddings.length !== inputs.length) {
    throw new Error(`OpenAI embedding count mismatch: expected ${inputs.length}, received ${embeddings.length}`);
  }
  return embeddings;
}

function validateMemoryCatalog(memories: PersonalMemoryRecord[]): void {
  validateMemoryRetrievalGoldenCases(golden.cases);
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const referencedIds = new Set(golden.cases.flatMap((testCase) => [
    ...testCase.expectedMemoryIds,
    ...testCase.forbiddenMemoryIds,
  ]));
  for (const id of referencedIds) {
    const memory = memoryById.get(id);
    if (!memory) throw new Error(`Golden set references missing active memory ID ${id}`);
    const snapshot = golden.memoryCatalogSnapshot[String(id)];
    if (!snapshot) throw new Error(`Golden set has no catalog snapshot for memory ID ${id}`);
    if ((memory.sourceRef || "") !== snapshot.sourceRef || memory.title !== snapshot.title) {
      throw new Error(`Memory ID ${id} drifted from golden snapshot: ${memory.sourceRef} / ${memory.title}`);
    }
  }
}

async function runProductionMode(mode: EvenHubV2MemorySearchMode): Promise<EvalRun> {
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryUserId: userId,
    memorySearchMode: mode,
    interviewCards: getDeepSenseInterviewCards(),
  });
  const predictions: MemoryRetrievalPrediction[] = [];
  const startedAt = performance.now();

  for (const testCase of golden.cases) {
    const caseStartedAt = performance.now();
    const context = await adapter.build({
      userId,
      conversationId: `golden-${mode}-${testCase.id}`,
      currentQuestion: testCase.asrQuestion,
      triggerWindow: testCase.asrQuestion,
      recentTranscript: testCase.recentContext || "",
      selectedPrenoteIds: [],
      selectedPrenoteText: "",
      settings: defaultEvenHubV2Settings(),
    });
    predictions.push({
      caseId: testCase.id,
      memoryIds: context.memoryUsedIds
        .map(parseMemoryId)
        .filter((id): id is number => id !== null),
      latencyMs: Math.round((performance.now() - caseStartedAt) * 100) / 100,
    });
  }

  return {
    name: `production_${mode}`,
    description: `Actual EvenHub v2 context adapter with memorySearchMode=${mode}`,
    metrics: evaluateMemoryRetrieval(golden.cases, predictions),
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

async function runOpenAiVectorOnly(memories: PersonalMemoryRecord[]): Promise<EvalRun> {
  const pool = memories.filter((memory) => (
    isDetailedPersonalMemory(memory)
    && memory.embeddingProvider === "openai"
    && memory.embeddingStatus === "ready"
    && memory.embedding.length > 0
  ));
  if (!pool.length) throw new Error("No eligible OpenAI-embedded personal memories found");

  const startedAt = performance.now();
  const embeddings = await createOpenAiEmbeddings(golden.cases.map(vectorQuery));
  const predictions = golden.cases.map((testCase, caseIndex): MemoryRetrievalPrediction => ({
    caseId: testCase.id,
    memoryIds: pool
      .map((memory) => ({ id: memory.id, score: cosineSimilarity(embeddings[caseIndex] || [], memory.embedding) }))
      .sort((left, right) => right.score - left.score || left.id - right.id)
      .slice(0, 2)
      .map((candidate) => candidate.id),
  }));

  return {
    name: "openai_vector_only",
    description: `Pure cosine ranking over ${pool.length} detailed personal memories; no lane classifier, lexical score, aliases, reranking, or abstention gate`,
    metrics: evaluateMemoryRetrieval(golden.cases, predictions),
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function renderRun(run: EvalRun, titleById: Map<number, string>): string[] {
  const metrics = run.metrics;
  const failures = metrics.cases.filter((result) => (
    (!result.expectedNoMemory && !result.hitAt2)
    || (result.expectedNoMemory && result.predictedMemoryIds.length > 0)
    || result.forbiddenHitIds.length > 0
  ));
  return [
    `## ${run.name}`,
    "",
    run.description,
    "",
    `- elapsed: ${run.elapsedMs.toFixed(2)} ms`,
    `- precision@1 (all emitted cards): ${percent(metrics.precisionAt1.value)} (${metrics.precisionAt1.numerator}/${metrics.precisionAt1.denominator})`,
    `- precision@2 (all emitted cards): ${percent(metrics.precisionAt2.value)} (${metrics.precisionAt2.numerator}/${metrics.precisionAt2.denominator})`,
    `- precision@1 (memory-required only): ${percent(metrics.requiredPrecisionAt1.value)} (${metrics.requiredPrecisionAt1.numerator}/${metrics.requiredPrecisionAt1.denominator})`,
    `- precision@2 (memory-required only): ${percent(metrics.requiredPrecisionAt2.value)} (${metrics.requiredPrecisionAt2.numerator}/${metrics.requiredPrecisionAt2.denominator})`,
    `- hit@1: ${percent(metrics.hitRateAt1.value)}`,
    `- hit@2: ${percent(metrics.hitRateAt2.value)}`,
    `- miss rate@2: ${percent(metrics.missRateAt2.value)} (${metrics.missRateAt2.numerator}/${metrics.missRateAt2.denominator})`,
    `- forbidden case rate@2: ${percent(metrics.forbiddenCaseRateAt2.value)} (${metrics.forbiddenCaseRateAt2.numerator}/${metrics.forbiddenCaseRateAt2.denominator})`,
    `- no-memory accuracy: ${percent(metrics.noMemoryAccuracy.value)} (${metrics.noMemoryAccuracy.numerator}/${metrics.noMemoryAccuracy.denominator})`,
    `- average returned cards: ${metrics.averageReturnedCards.toFixed(2)}`,
    `- latency p50/p95: ${metrics.latencyP50Ms ?? "n/a"} / ${metrics.latencyP95Ms ?? "n/a"} ms`,
    "",
    "### Errors",
    "",
    ...(failures.length ? failures.flatMap((failure) => {
      const testCase = golden.cases.find((candidate) => candidate.id === failure.caseId)!;
      const names = (ids: number[]) => ids.map((id) => `${id}:${titleById.get(id) || "unknown"}`).join(" | ") || "(none)";
      return [
        `- **${failure.caseId}**: ${testCase.asrQuestion}`,
        `  - expected: ${names(failure.expectedMemoryIds)}`,
        `  - predicted: ${names(failure.predictedMemoryIds)}`,
        `  - forbidden hits: ${names(failure.forbiddenHitIds)}`,
      ];
    }) : ["- None"]),
    "",
  ];
}

async function main(): Promise<void> {
  const memories = conversationLogger.listPersonalMemories(userId, { status: "active", limit: 1000 });
  validateMemoryCatalog(memories);
  const titleById = new Map(memories.map((memory) => [memory.id, memory.title]));
  const runs: EvalRun[] = [];

  for (const name of runNames) {
    if (name === "openai_vector_only") runs.push(await runOpenAiVectorOnly(memories));
    else if (name === "adaptive" || name === "lexical" || name === "semantic") runs.push(await runProductionMode(name));
    else throw new Error(`Unknown run: ${name}`);
  }

  const report = [
    "# EvenHub v2 Real-ASR Memory Retrieval Golden Evaluation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Golden set: ${goldenPath}`,
    `Cases: ${golden.cases.length} (${golden.cases.filter((testCase) => testCase.expectedMemoryIds.length > 0).length} memory-required, ${golden.cases.filter((testCase) => testCase.expectedMemoryIds.length === 0).length} no-memory)`,
    "",
    "Precision uses only cards actually emitted in the first k positions. Miss rate is the share of memory-required questions with no accepted memory ID in the first two results. No-memory accuracy is reported separately so abstention is not hidden inside precision.",
    "",
    ...runs.flatMap((run) => renderRun(run, titleById)),
  ].join("\n");

  const reportPath = join(outputDir, `evenhub-v2-memory-retrieval-golden-${stamp}.md`);
  const jsonPath = join(outputDir, `evenhub-v2-memory-retrieval-golden-${stamp}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    goldenPath,
    userId,
    cases: golden.cases,
    runs,
  }, null, 2), "utf8");

  console.log(`GOLDEN_REPORT ${reportPath}`);
  console.log(`GOLDEN_JSON ${jsonPath}`);
  for (const run of runs) {
    console.log([
      run.name,
      `p1=${percent(run.metrics.precisionAt1.value)}`,
      `p2=${percent(run.metrics.precisionAt2.value)}`,
      `requiredP1=${percent(run.metrics.requiredPrecisionAt1.value)}`,
      `requiredP2=${percent(run.metrics.requiredPrecisionAt2.value)}`,
      `miss=${percent(run.metrics.missRateAt2.value)}`,
      `forbidden=${percent(run.metrics.forbiddenCaseRateAt2.value)}`,
      `noMemory=${percent(run.metrics.noMemoryAccuracy.value)}`,
    ].join(" "));
  }
}

await main();
