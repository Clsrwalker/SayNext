import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  OpenAiAutoCueGenerator,
  type AutoCueGenerationResult,
  type AutoCueGeneratorOutput,
  type AutoCueSession,
} from "../src/server/evenhub-v2/auto-cue-generator";
import { LightweightEvenHubV2ContextAdapter } from "../src/server/evenhub-v2/context-adapter";
import { getDeepSenseInterviewCards } from "../src/server/evenhub-v2/interview-guide";
import { defaultEvenHubV2Settings, type AutoCueCategory } from "../src/server/evenhub-v2/protocol";
import {
  generateOpenAiJson,
  type OpenAiJsonGenerateOptions,
  type OpenAiJsonResult,
} from "../src/server/local-llm/openai-json-client";

type UsageRecord = {
  status: number;
  model: string;
  serviceTier: string;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type EvaluationCase = {
  id: string;
  scenario: string;
  type: string;
  partial?: string;
  final: string;
  expectedCategory: AutoCueCategory;
  minWords?: number;
  maxWords?: number;
  mustIncludeAny?: string[][];
  reject?: string[];
  memoryExpectation: "required" | "not_required" | "optional";
};

type TextMetrics = {
  words: number;
  sentences: number;
  averageSentenceWords: number;
  longestSentenceWords: number;
  contractions: number;
  fillerOpening: boolean;
  corporatePhrases: string[];
  abstractPhrases: string[];
  endsIncomplete: boolean;
};

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

type TurnResult = {
  case: EvaluationCase;
  partialResult: AutoCueGenerationResult | null;
  partialLatencyMs: number | null;
  partialUsage: UsageRecord[];
  finalResult: AutoCueGenerationResult;
  contextLatencyMs: number;
  generationLatencyMs: number;
  totalLatencyMs: number;
  usage: UsageRecord[];
  contextChars: number;
  contextSnapshot: string;
  memoryUsedIds: string[];
  interviewAnswerCardIds: string[];
  answerPolicyCardIds: string[];
  metrics: TextMetrics;
  checks: Check[];
};

const CASES: EvaluationCase[] = [
  {
    id: "intro_unpolished_asr",
    scenario: "interview",
    type: "introduction",
    partial: "yeah so before we jump in can you just kind of tell me who you are",
    final: "yeah, so before we jump in, can you just kind of tell me who you are and what you've been working on lately?",
    expectedCategory: "response",
    minWords: 75,
    maxWords: 140,
    mustIncludeAny: [
      ["Dalhousie", "MACS", "Dal"],
      ["Acadia", "BCS"],
      ["CueFlow", "SayNext", "AI Meeting Monitor"],
    ],
    memoryExpectation: "required",
  },
  {
    id: "cueflow_ownership_followup",
    scenario: "interview",
    type: "project follow-up",
    final: "you mentioned CueFlow there. what did you personally build in it, and what does the system actually do?",
    expectedCategory: "response",
    minWords: 55,
    maxWords: 115,
    mustIncludeAny: [
      ["transcript", "conversation"],
      ["cue", "help"],
      ["AWS", "Lambda", "WebSocket", "SQS", "DynamoDB", "API Gateway"],
    ],
    memoryExpectation: "required",
  },
  {
    id: "single_tradeoff_not_inventory",
    scenario: "interview",
    type: "project trade-off",
    final: "what was the hardest trade-off in that system? just give me one, not the whole architecture.",
    expectedCategory: "response",
    minWords: 35,
    maxWords: 90,
    mustIncludeAny: [
      ["latency", "speed", "fast", "timing"],
      ["quality", "context", "accurate", "relevant"],
    ],
    memoryExpectation: "required",
  },
  {
    id: "vector_database_honesty",
    scenario: "interview",
    type: "experience boundary",
    final: "I saw vector databases in the nice-to-have section. have you actually used Pinecone or Chroma in a real project, or is that more something you understand?",
    expectedCategory: "response",
    minWords: 25,
    maxWords: 85,
    mustIncludeAny: [
      ["haven't", "have not", "not directly", "not in a full project"],
      ["embedding", "vector", "cosine", "hybrid"],
    ],
    reject: ["I used Pinecone in", "I deployed Pinecone", "I built with Chroma"],
    memoryExpectation: "required",
  },
  {
    id: "agent_framework_honesty",
    scenario: "interview",
    type: "experience boundary",
    final: "and those agent frameworks, LangGraph or CrewAI, have you really built with those or not yet?",
    expectedCategory: "response",
    minWords: 20,
    maxWords: 75,
    mustIncludeAny: [
      ["haven't", "have not", "not yet", "not in a full project"],
      ["API", "workflow", "understand", "familiar"],
    ],
    reject: ["I built a LangGraph production", "I used CrewAI in production"],
    memoryExpectation: "required",
  },
  {
    id: "integration_behavioral_specific",
    scenario: "interview",
    type: "behavioral",
    final: "tell me about a time the integration was breaking near a deadline. what did you actually do yourself?",
    expectedCategory: "response",
    minWords: 60,
    maxWords: 125,
    mustIncludeAny: [
      ["AI Meeting Monitor", "meeting"],
      ["API", "mapping", "contract", "write-back"],
      ["test", "smoke", "demo"],
    ],
    reject: ["my manager", "at my company", "production customers"],
    memoryExpectation: "required",
  },
  {
    id: "deepsense_role_fit",
    scenario: "interview",
    type: "role fit",
    final: "so why this DeepSense co-op specifically? what makes it more than just another AI job for you?",
    expectedCategory: "response",
    minWords: 55,
    maxWords: 115,
    mustIncludeAny: [
      ["chatbot", "retrieval", "document", "ranking", "agent"],
      ["CueFlow", "SayNext", "Meeting Monitor"],
      ["Professor Lu", "sent", "role"],
    ],
    memoryExpectation: "required",
  },
  {
    id: "rag_permissions_design",
    scenario: "technical",
    type: "system design",
    partial: "say the bot has public pages and internal docs how do you stop the wrong",
    final: "say the chatbot has public website pages and private internal documents. how do you stop the wrong user from retrieving private content?",
    expectedCategory: "response",
    minWords: 55,
    maxWords: 125,
    mustIncludeAny: [
      ["authentication", "identity", "user"],
      ["authorization", "permission", "access"],
      ["filter", "retrieval", "metadata"],
    ],
    memoryExpectation: "not_required",
  },
  {
    id: "retrieval_wrong_document_debug",
    scenario: "technical",
    type: "debugging",
    final: "the RAG answer sounds believable, but it pulled the wrong document. how would you figure out which part failed?",
    expectedCategory: "response",
    minWords: 50,
    maxWords: 115,
    mustIncludeAny: [
      ["query", "chunk", "index", "filter"],
      ["BM25", "embedding", "vector", "rerank"],
      ["log", "trace", "inspect", "score"],
    ],
    memoryExpectation: "not_required",
  },
  {
    id: "aws_spiky_workload",
    scenario: "technical",
    type: "cloud design",
    final: "traffic is quiet most of the day and then spikes after an event. what would your first AWS version look like?",
    expectedCategory: "response",
    minWords: 50,
    maxWords: 120,
    mustIncludeAny: [
      ["API Gateway", "Lambda", "serverless"],
      ["SQS", "queue", "async"],
      ["DynamoDB", "S3", "database", "storage"],
    ],
    memoryExpectation: "not_required",
  },
  {
    id: "agent_write_safety",
    scenario: "technical",
    type: "agent safety",
    final: "if your agent can update a project task through an API, what checks happen before you let it write?",
    expectedCategory: "response",
    minWords: 45,
    maxWords: 110,
    mustIncludeAny: [
      ["permission", "authorization", "allowed"],
      ["confirm", "approval"],
      ["validate", "idempotency", "audit"],
    ],
    memoryExpectation: "not_required",
  },
  {
    id: "code_lru_complete",
    scenario: "coding",
    type: "code",
    partial: "okay can you implement a small typescript class for least recently",
    final: "okay, implement a small TypeScript LRU cache class with get and put. both operations should be constant time.",
    expectedCategory: "code",
    mustIncludeAny: [["class"], ["get"], ["put"], ["Map"]],
    memoryExpectation: "not_required",
  },
  {
    id: "code_explanation_followup",
    scenario: "coding",
    type: "code explanation",
    final: "walk me through why that code is constant time, and tell me the space complexity.",
    expectedCategory: "response",
    minWords: 30,
    maxWords: 90,
    mustIncludeAny: [
      ["O(1)", "constant time"],
      ["Map", "linked", "order"],
      ["O(n)", "linear"],
    ],
    memoryExpectation: "not_required",
  },
  {
    id: "incomplete_noise",
    scenario: "noise",
    type: "incomplete ASR",
    final: "and then with the database thing, like when the other one was",
    expectedCategory: "none",
    memoryExpectation: "not_required",
  },
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
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function captureUsage(raw: any, status: number): UsageRecord {
  const usage = raw?.usage || {};
  const details = usage.input_tokens_details || usage.prompt_tokens_details || {};
  return {
    status,
    model: String(raw?.model || ""),
    serviceTier: String(raw?.service_tier || ""),
    inputTokens: Number(usage.input_tokens || usage.prompt_tokens || 0),
    cachedTokens: Number(details.cached_tokens || 0),
    cacheWriteTokens: Number(details.cache_write_tokens || 0),
    outputTokens: Number(usage.output_tokens || usage.completion_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

function answerText(cue: AutoCueGeneratorOutput): string {
  return cue.category === "code" ? cue.code : cue.fullAnswer;
}

function countWords(value: string): number {
  return value.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g)?.length || 0;
}

function measureText(value: string, category: AutoCueCategory): TextMetrics {
  const words = countWords(value);
  const sentences = category === "code"
    ? []
    : value
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  const sentenceWordCounts = sentences.map(countWords);
  const lowered = value.toLowerCase();
  const corporateCandidates = [
    "I am a strong fit because",
    "This aligns closely with my experience",
    "I am deeply passionate about",
    "I believe my experience makes me",
    "leveraging my expertise",
    "contribute across the product",
    "This opportunity would allow me",
  ];
  const abstractCandidates = [
    "relevant personal or situational context",
    "applied AI products",
    "end-to-end solutions",
    "technical capabilities",
    "meaningful impact",
    "robust and scalable",
  ];
  return {
    words,
    sentences: sentences.length,
    averageSentenceWords: sentences.length
      ? Number((words / sentences.length).toFixed(1))
      : 0,
    longestSentenceWords: sentenceWordCounts.length
      ? Math.max(...sentenceWordCounts)
      : 0,
    contractions: value.match(/\b[A-Za-z]+['\u2019](?:m|re|ve|d|ll|s|t)\b/g)?.length || 0,
    fillerOpening: /^(?:yeah(?:,\s*)?sure|sure|absolutely|certainly|of course)\b/i.test(value.trim()),
    corporatePhrases: corporateCandidates.filter((phrase) => lowered.includes(phrase.toLowerCase())),
    abstractPhrases: abstractCandidates.filter((phrase) => lowered.includes(phrase.toLowerCase())),
    endsIncomplete: category !== "code" && (
      /\.{3}\s*$/.test(value.trim())
      || /(?:,|;|:|-)\s*$/.test(value.trim())
    ),
  };
}

function includesAny(value: string, candidates: string[]): boolean {
  const lowered = value.toLowerCase();
  return candidates.some((candidate) => lowered.includes(candidate.toLowerCase()));
}

function balanced(value: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function evaluateCase(
  testCase: EvaluationCase,
  cue: AutoCueGeneratorOutput,
  memoryUsedIds: string[],
  metrics: TextMetrics,
): Check[] {
  const text = answerText(cue);
  const checks: Check[] = [{
    name: "expected_category",
    ok: cue.category === testCase.expectedCategory,
    detail: `expected=${testCase.expectedCategory} actual=${cue.category}`,
  }];

  if (testCase.expectedCategory === "none") {
    checks.push({
      name: "no_unwanted_output",
      ok: cue.category === "none" && !text.trim(),
    });
    return checks;
  }

  checks.push(
    { name: "content_present", ok: text.trim().length > 0 },
    { name: "complete_without_ellipsis", ok: !metrics.endsIncomplete && !text.includes("...") },
    { name: "no_corporate_phrase", ok: metrics.corporatePhrases.length === 0, detail: metrics.corporatePhrases.join("|") },
  );
  if (testCase.minWords !== undefined && cue.category !== "code") {
    checks.push({
      name: "minimum_depth",
      ok: metrics.words >= testCase.minWords,
      detail: `min=${testCase.minWords} actual=${metrics.words}`,
    });
  }
  if (testCase.maxWords !== undefined && cue.category !== "code") {
    checks.push({
      name: "scope",
      ok: metrics.words <= testCase.maxWords,
      detail: `max=${testCase.maxWords} actual=${metrics.words}`,
    });
  }
  for (const [index, group] of (testCase.mustIncludeAny || []).entries()) {
    checks.push({
      name: `required_${index + 1}`,
      ok: includesAny(text, group),
      detail: group.join("|"),
    });
  }
  for (const rejected of testCase.reject || []) {
    checks.push({
      name: `reject_${rejected.replace(/\s+/g, "_")}`,
      ok: !text.toLowerCase().includes(rejected.toLowerCase()),
    });
  }
  if (testCase.memoryExpectation === "required") {
    checks.push({
      name: "personal_memory_retrieved",
      ok: memoryUsedIds.length > 0,
      detail: memoryUsedIds.join(",") || "none",
    });
  }
  if (testCase.memoryExpectation === "not_required") {
    checks.push({
      name: "no_unnecessary_personal_memory",
      ok: memoryUsedIds.length === 0,
      detail: memoryUsedIds.join(",") || "none",
    });
  }
  if (cue.category === "code") {
    const lines = cue.code.split("\n");
    checks.push(
      { name: "multiline_code", ok: lines.length >= 12, detail: `lines=${lines.length}` },
      { name: "no_markdown_fence", ok: !cue.code.includes("```") },
      { name: "balanced_braces", ok: balanced(cue.code, "{", "}") },
      { name: "balanced_parentheses", ok: balanced(cue.code, "(", ")") },
      { name: "code_only", ok: !cue.explanation.trim() && cue.fullAnswer === cue.code },
    );
  }
  return checks;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function sumUsage(records: UsageRecord[]): UsageRecord {
  return records.reduce<UsageRecord>((total, record) => ({
    status: record.status,
    model: record.model || total.model,
    serviceTier: record.serviceTier || total.serviceTier,
    inputTokens: total.inputTokens + record.inputTokens,
    cachedTokens: total.cachedTokens + record.cachedTokens,
    cacheWriteTokens: total.cacheWriteTokens + record.cacheWriteTokens,
    outputTokens: total.outputTokens + record.outputTokens,
    totalTokens: total.totalTokens + record.totalTokens,
  }), {
    status: 0,
    model: "",
    serviceTier: "",
    inputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
}

function reportMarkdown(results: TurnResult[]): string {
  const checks = results.flatMap((result) => result.checks);
  const failed = checks.filter((check) => !check.ok);
  const finalUsage = sumUsage(results.flatMap((result) => result.usage));
  const speculativeUsage = sumUsage(results.flatMap((result) => result.partialUsage));
  const generationLatencies = results.map((result) => result.generationLatencyMs);
  const contextLatencies = results.map((result) => result.contextLatencyMs);
  const spoken = results.filter((result) => {
    const category = result.finalResult.data.category;
    return category !== "none" && category !== "code";
  });
  const lines = [
    "# EvenHub v2 Current Output Evaluation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Prompt version: evenhub-v2-live-2026-07-23-v6`,
    `Cases: ${results.length}`,
    `Checks: ${checks.length - failed.length}/${checks.length}`,
    `Final generation latency: p50=${percentile(generationLatencies, 50)} ms; p95=${percentile(generationLatencies, 95)} ms`,
    `Context latency: p50=${percentile(contextLatencies, 50)} ms; p95=${percentile(contextLatencies, 95)} ms`,
    `Average spoken answer words: ${spoken.length ? Math.round(spoken.reduce((sum, result) => sum + result.metrics.words, 0) / spoken.length) : 0}`,
    `Average spoken sentence length: ${spoken.length ? Number((spoken.reduce((sum, result) => sum + result.metrics.averageSentenceWords, 0) / spoken.length).toFixed(1)) : 0}`,
    "",
    "## Token Usage",
    "",
    `Final requests: input=${finalUsage.inputTokens}; cached=${finalUsage.cachedTokens}; cache_write=${finalUsage.cacheWriteTokens}; output=${finalUsage.outputTokens}; total=${finalUsage.totalTokens}`,
    `Speculative requests: input=${speculativeUsage.inputTokens}; cached=${speculativeUsage.cachedTokens}; cache_write=${speculativeUsage.cacheWriteTokens}; output=${speculativeUsage.outputTokens}; total=${speculativeUsage.totalTokens}`,
    "",
    "## Failures",
    "",
    ...(failed.length
      ? results.flatMap((result) => result.checks
        .filter((check) => !check.ok)
        .map((check) => `- ${result.case.id}: ${check.name}${check.detail ? ` (${check.detail})` : ""}`))
      : ["- None"]),
    "",
  ];

  for (const result of results) {
    const cue = result.finalResult.data;
    const usage = sumUsage(result.usage);
    lines.push(
      `## ${result.case.id}`,
      "",
      `Scenario: ${result.case.scenario}`,
      `Type: ${result.case.type}`,
      result.case.partial ? `ASR partial: ${result.case.partial}` : "ASR partial: none",
      `ASR final: ${result.case.final}`,
      `Category: ${cue.category}`,
      `Confidence: ${cue.confidence}`,
      `Model: ${result.finalResult.model}`,
      `Lane: ${result.finalResult.lane || "unknown"}`,
      `Latency: context=${result.contextLatencyMs} ms; generation=${result.generationLatencyMs} ms; total=${result.totalLatencyMs} ms`,
      `Usage: input=${usage.inputTokens}; cached=${usage.cachedTokens}; cache_write=${usage.cacheWriteTokens}; output=${usage.outputTokens}`,
      `Context chars: ${result.contextChars}`,
      `Memory: ${result.memoryUsedIds.join(", ") || "none"}`,
      `Answer card: ${result.interviewAnswerCardIds.join(", ") || "none"}`,
      `Answer policy: ${result.answerPolicyCardIds.join(", ") || "none"}`,
      `Metrics: words=${result.metrics.words}; sentences=${result.metrics.sentences}; avg=${result.metrics.averageSentenceWords}; longest=${result.metrics.longestSentenceWords}; contractions=${result.metrics.contractions}; filler=${result.metrics.fillerOpening}`,
      `Style flags: corporate=${result.metrics.corporatePhrases.join("|") || "none"}; abstract=${result.metrics.abstractPhrases.join("|") || "none"}; incomplete=${result.metrics.endsIncomplete}`,
      "",
      "Checks:",
      ...result.checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`),
      "",
    );
    if (result.partialResult) {
      const partialCue = result.partialResult.data;
      const partialUsage = sumUsage(result.partialUsage);
      lines.push(
        `Speculative: category=${partialCue.category}; latency=${result.partialLatencyMs} ms; input=${partialUsage.inputTokens}; cached=${partialUsage.cachedTokens}; cache_write=${partialUsage.cacheWriteTokens}`,
        "",
        answerText(partialCue) || "(none)",
        "",
      );
    }
    lines.push("Final output:", "");
    if (cue.category === "code") {
      lines.push("````text", cue.code, "````", "");
    } else {
      lines.push(cue.fullAnswer || "(none)", "");
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const golden = JSON.parse(
    readFileSync(
      join(process.cwd(), "data", "eval", "evenhub-v2-real-asr-memory-retrieval-golden-v1.json"),
      "utf8",
    ),
  ) as { userId: string };
  const usageRecords: UsageRecord[] = [];
  const instrumentedJsonGenerator = async (
    options: OpenAiJsonGenerateOptions,
  ): Promise<OpenAiJsonResult<AutoCueGeneratorOutput>> => generateOpenAiJson({
    ...options,
    fetchImpl: async (input, init) => {
      const response = await fetch(input, init);
      const clone = response.clone();
      const raw = await clone.json().catch(() => ({}));
      usageRecords.push(captureUsage(raw, response.status));
      return response;
    },
  });
  const generator = new OpenAiAutoCueGenerator({
    jsonGenerator: instrumentedJsonGenerator,
  });
  const contextAdapter = new LightweightEvenHubV2ContextAdapter({
    memoryUserId: golden.userId,
    activeInterviewQuery: "DeepSense Full-Stack AI Developer Co-op Fall 2026 interview",
    interviewCards: getDeepSenseInterviewCards(),
  });
  const results: TurnResult[] = [];

  for (const scenario of [...new Set(CASES.map((testCase) => testCase.scenario))]) {
    let session: AutoCueSession | null = null;
    const recentQuestions: string[] = [];
    try {
      session = await generator.startSession({
        localConversationId: `current-output-${scenario}-${Date.now()}`,
        userId: golden.userId,
      });
      for (const testCase of CASES.filter((candidate) => candidate.scenario === scenario)) {
        const recentTranscript = recentQuestions.slice(-3).join("\n");
        let partialResult: AutoCueGenerationResult | null = null;
        let partialLatencyMs: number | null = null;
        let partialUsage: UsageRecord[] = [];
        if (testCase.partial) {
          const context = await contextAdapter.build({
            userId: golden.userId,
            conversationId: `current-output-${scenario}`,
            currentQuestion: testCase.partial,
            triggerWindow: testCase.partial,
            recentTranscript,
            selectedPrenoteIds: [],
            selectedPrenoteText: "",
            settings: defaultEvenHubV2Settings(),
          });
          const usageStart = usageRecords.length;
          const startedAt = performance.now();
          partialResult = await generator.generate({
            triggerWindow: testCase.partial,
            recentTranscript,
            contextSnapshot: context.contextSnapshot,
            settings: defaultEvenHubV2Settings(),
            router: null,
            session,
            speculative: true,
          });
          partialLatencyMs = Math.round(performance.now() - startedAt);
          partialUsage = usageRecords.slice(usageStart);
        }

        const totalStartedAt = performance.now();
        const contextStartedAt = performance.now();
        const context = await contextAdapter.build({
          userId: golden.userId,
          conversationId: `current-output-${scenario}`,
          currentQuestion: testCase.final,
          triggerWindow: testCase.final,
          recentTranscript,
          selectedPrenoteIds: [],
          selectedPrenoteText: "",
          settings: defaultEvenHubV2Settings(),
        });
        const contextLatencyMs = Math.round(performance.now() - contextStartedAt);
        const usageStart = usageRecords.length;
        const generationStartedAt = performance.now();
        const finalResult = await generator.generate({
          triggerWindow: testCase.final,
          recentTranscript,
          contextSnapshot: context.contextSnapshot,
          settings: defaultEvenHubV2Settings(),
          router: null,
          session,
          speculative: false,
        });
        const generationLatencyMs = Math.round(performance.now() - generationStartedAt);
        if (finalResult.lane === "stateless_fallback") {
          await generator.commitCanonicalTurn({
            session,
            question: testCase.final,
            result: finalResult,
          });
        }
        const totalLatencyMs = Math.round(performance.now() - totalStartedAt);
        const usage = usageRecords.slice(usageStart);
        const metrics = measureText(answerText(finalResult.data), finalResult.data.category);
        const checks = evaluateCase(
          testCase,
          finalResult.data,
          context.memoryUsedIds,
          metrics,
        );
        results.push({
          case: testCase,
          partialResult,
          partialLatencyMs,
          partialUsage,
          finalResult,
          contextLatencyMs,
          generationLatencyMs,
          totalLatencyMs,
          usage,
          contextChars: context.contextSnapshot.length,
          contextSnapshot: context.contextSnapshot,
          memoryUsedIds: context.memoryUsedIds,
          interviewAnswerCardIds: context.interviewAnswerCardIds,
          answerPolicyCardIds: context.answerPolicyCardIds,
          metrics,
          checks,
        });
        recentQuestions.push(`Interviewer: ${testCase.final}`);
        console.log(
          `${testCase.id}: category=${finalResult.data.category}`
          + ` context=${contextLatencyMs}ms generation=${generationLatencyMs}ms`
          + ` checks=${checks.filter((check) => check.ok).length}/${checks.length}`,
        );
      }
    } finally {
      if (session) await generator.endSession(session).catch(() => undefined);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(process.cwd(), "data", "review");
  mkdirSync(outputDir, { recursive: true });
  const baseName = `evenhub-v2-current-output-eval-${stamp}`;
  const jsonPath = join(outputDir, `${baseName}.json`);
  const markdownPath = join(outputDir, `${baseName}.md`);
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    cases: results,
  }, null, 2), "utf8");
  writeFileSync(markdownPath, reportMarkdown(results), "utf8");
  console.log(`json=${jsonPath}`);
  console.log(`report=${markdownPath}`);
}

await main();
