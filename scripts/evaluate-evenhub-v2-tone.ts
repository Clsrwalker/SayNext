import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAutoCuePrompt,
  normalizeAutoCueOutput,
} from "../src/server/evenhub-v2/auto-cue-generator";
import { LightweightEvenHubV2ContextAdapter } from "../src/server/evenhub-v2/context-adapter";
import { getDeepSenseInterviewCards } from "../src/server/evenhub-v2/interview-guide";
import { generateOpenAiJson } from "../src/server/local-llm/openai-json-client";
import { defaultEvenHubV2Settings } from "../src/server/evenhub-v2/protocol";

type GoldenCase = {
  id: string;
  group: string;
  asrQuestion: string;
  recentContext?: string;
};

type GoldenSet = {
  userId: string;
  cases: GoldenCase[];
};

type AnswerMetrics = {
  words: number;
  sentences: number;
  averageSentenceWords: number;
  contractions: number;
  firstPersonTerms: number;
  startsWithFiller: boolean;
  corporatePhraseHits: string[];
};

type EvaluationRecord = {
  id: string;
  group: string;
  asrQuestion: string;
  recentContext: string;
  contextLatencyMs: number;
  generationLatencyMs: number;
  model: string;
  lane: string;
  category: string;
  memoryUsedIds: string[];
  interviewAnswerCardIds: string[];
  answer: string;
  metrics: AnswerMetrics;
  error?: string;
};

const DEFAULT_CASE_IDS = [
  "profile_intro_recent_work",
  "company_why_deepsense",
  "company_why_role",
  "saynext_walkthrough_asr_say",
  "saynext_speech_to_cue_flow",
  "saynext_ml_project",
  "project_most_proud",
  "generic_chatbot_website",
  "generic_malformed_model_response",
  "generic_rag_vs_finetune",
  "generic_document_chunking",
  "generic_candidate_questions",
];

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function getArg(name: string, fallback = ""): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length || 0;
}

function measureAnswer(answer: string): AnswerMetrics {
  const words = answer.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || [];
  const sentenceParts = answer
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const corporatePhrases = [
    "I am a strong fit because",
    "This aligns closely with my experience",
    "I am deeply passionate about",
    "I believe my experience makes me",
    "leveraging my expertise",
    "contribute across the product",
  ];
  const lowered = answer.toLowerCase();

  return {
    words: words.length,
    sentences: sentenceParts.length,
    averageSentenceWords: sentenceParts.length
      ? Number((words.length / sentenceParts.length).toFixed(1))
      : 0,
    contractions: countMatches(answer, /\b[A-Za-z]+['\u2019](?:m|re|ve|d|ll|s|t)\b/g),
    firstPersonTerms: countMatches(answer, /\b(?:I|I'm|I've|I'd|I'll|me|my)\b/gi),
    startsWithFiller: /^(?:yeah(?:,\s*)?sure|sure|absolutely|certainly|of course)\b/i.test(answer.trim()),
    corporatePhraseHits: corporatePhrases.filter((phrase) => lowered.includes(phrase.toLowerCase())),
  };
}

function buildMarkdown(label: string, records: EvaluationRecord[]): string {
  const successful = records.filter((record) => !record.error);
  const mean = (values: number[]) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
    : 0;
  const lines = [
    `# EvenHub v2 Tone Evaluation: ${label}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Cases: ${successful.length}/${records.length} completed`,
    `Average words: ${mean(successful.map((record) => record.metrics.words))}`,
    `Average sentence length: ${mean(successful.map((record) => record.metrics.averageSentenceWords))} words`,
    `Filler openings: ${successful.filter((record) => record.metrics.startsWithFiller).length}`,
    `Corporate phrase hits: ${successful.reduce((sum, record) => sum + record.metrics.corporatePhraseHits.length, 0)}`,
    "",
  ];

  for (const record of records) {
    lines.push(
      `## ${record.id}`,
      "",
      `Group: ${record.group}`,
      `ASR question: ${record.asrQuestion}`,
      record.recentContext ? `Recent context: ${record.recentContext}` : "Recent context: none",
      `Model: ${record.model || "n/a"}`,
      `Lane: ${record.lane || "n/a"}`,
      `Category: ${record.category || "n/a"}`,
      `Latency: context ${record.contextLatencyMs} ms; generation ${record.generationLatencyMs} ms`,
      `Memory: ${record.memoryUsedIds.join(", ") || "none"}`,
      `Answer card: ${record.interviewAnswerCardIds.join(", ") || "none"}`,
      `Metrics: ${record.metrics.words} words; ${record.metrics.sentences} sentences; ${record.metrics.averageSentenceWords} words/sentence; ${record.metrics.contractions} contractions; filler=${record.metrics.startsWithFiller ? "yes" : "no"}`,
      record.error ? `Error: ${record.error}` : "",
      "",
      record.answer || "(no answer)",
      "",
    );
  }
  return lines.join("\n");
}

async function generateCase(
  testCase: GoldenCase,
  userId: string,
  contextAdapter: LightweightEvenHubV2ContextAdapter,
): Promise<EvaluationRecord> {
  const contextStartedAt = performance.now();
  const context = await contextAdapter.build({
    userId,
    conversationId: `tone-eval-${testCase.id}`,
    currentQuestion: testCase.asrQuestion,
    triggerWindow: testCase.asrQuestion,
    recentTranscript: testCase.recentContext || "",
    selectedPrenoteIds: [],
    selectedPrenoteText: "",
    settings: defaultEvenHubV2Settings(),
  });
  const contextLatencyMs = Math.round(performance.now() - contextStartedAt);
  const generationStartedAt = performance.now();
  let result;
  try {
    const input = {
      triggerWindow: testCase.asrQuestion,
      recentTranscript: testCase.recentContext || "",
      contextSnapshot: context.contextSnapshot,
      settings: defaultEvenHubV2Settings(),
      router: null,
    };
    const raw = await generateOpenAiJson<Record<string, unknown>>({
      model: process.env.EVENHUB_V2_AUTO_CUE_MODEL || "gpt-5.6-luna",
      prompt: buildAutoCuePrompt(input),
      reasoningEffort: "low",
      temperature: null,
      timeoutMs: Number(process.env.EVENHUB_V2_AUTO_CUE_TIMEOUT_MS || 90000),
    });
    result = {
      data: normalizeAutoCueOutput(raw.data),
      model: raw.model,
      lane: "stateless_eval",
    };
  } catch (error) {
    return {
      id: testCase.id,
      group: testCase.group,
      asrQuestion: testCase.asrQuestion,
      recentContext: testCase.recentContext || "",
      contextLatencyMs,
      generationLatencyMs: Math.round(performance.now() - generationStartedAt),
      model: "",
      lane: "",
      category: "",
      memoryUsedIds: context.memoryUsedIds,
      interviewAnswerCardIds: context.interviewAnswerCardIds,
      answer: "",
      metrics: measureAnswer(""),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const answer = result.data.category === "code"
    ? result.data.explanation
    : result.data.fullAnswer;
  return {
    id: testCase.id,
    group: testCase.group,
    asrQuestion: testCase.asrQuestion,
    recentContext: testCase.recentContext || "",
    contextLatencyMs,
    generationLatencyMs: Math.round(performance.now() - generationStartedAt),
    model: result.model,
    lane: result.lane || "",
    category: result.data.category,
    memoryUsedIds: context.memoryUsedIds,
    interviewAnswerCardIds: context.interviewAnswerCardIds,
    answer,
    metrics: measureAnswer(answer),
  };
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const label = getArg("label", "candidate").replace(/[^a-z0-9_-]/gi, "-");
  const goldenPath = join(process.cwd(), "data", "eval", "evenhub-v2-real-asr-memory-retrieval-golden-v1.json");
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenSet;
  const requestedIds = getArg("cases")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedIds = requestedIds.length ? requestedIds : DEFAULT_CASE_IDS;
  const selectedCases = selectedIds.map((id) => {
    const testCase = golden.cases.find((candidate) => candidate.id === id);
    if (!testCase) throw new Error(`Golden case not found: ${id}`);
    return testCase;
  });

  const contextAdapter = new LightweightEvenHubV2ContextAdapter({
    memoryUserId: golden.userId,
    activeInterviewQuery: "DeepSense Full-Stack AI Developer Co-op Fall 2026 interview",
    interviewCards: getDeepSenseInterviewCards(),
  });
  const records: EvaluationRecord[] = [];
  for (const testCase of selectedCases) {
    const record = await generateCase(testCase, golden.userId, contextAdapter);
    records.push(record);
    console.log(`${record.id}: ${record.category || "error"} ${record.metrics.words} words ${record.generationLatencyMs}ms`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(process.cwd(), "data", "review");
  mkdirSync(outputDir, { recursive: true });
  const baseName = `evenhub-v2-tone-${label}-${stamp}`;
  const jsonPath = join(outputDir, `${baseName}.json`);
  const mdPath = join(outputDir, `${baseName}.md`);
  writeFileSync(jsonPath, JSON.stringify({ label, generatedAt: new Date().toISOString(), records }, null, 2), "utf8");
  writeFileSync(mdPath, buildMarkdown(label, records), "utf8");
  console.log(`json=${jsonPath}`);
  console.log(`report=${mdPath}`);
}

await main();
