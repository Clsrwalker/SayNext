import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAutoCuePrompt,
  buildAutoCueSessionSeed,
  buildAutoCueTurnPrompt,
  OpenAiAutoCueGenerator,
  type AutoCueGenerationResult,
  type AutoCueSession,
} from "../src/server/evenhub-v2/auto-cue-generator";
import { LightweightEvenHubV2ContextAdapter } from "../src/server/evenhub-v2/context-adapter";
import { getDeepSenseInterviewCards } from "../src/server/evenhub-v2/interview-guide";
import { defaultEvenHubV2Settings } from "../src/server/evenhub-v2/protocol";

type CueCategory = "response" | "concept" | "suggestion" | "person" | "code" | "none";

type AsrCase = {
  id: string;
  scenario: string;
  kind: string;
  partial?: string;
  final: string;
  recentContext?: string;
  expectedCategories: CueCategory[];
  minWords?: number;
  maxWords?: number;
  mustIncludeAny?: string[][];
  reject?: string[];
};

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

type GeneratedTurn = {
  input: string;
  contextSnapshot: string;
  prompt: string;
  contextLatencyMs: number;
  generationLatencyMs: number;
  result: AutoCueGenerationResult;
};

type CaseResult = {
  case: AsrCase;
  speculative: GeneratedTurn | null;
  canonical: GeneratedTurn;
  memoryUsedIds: string[];
  interviewAnswerCardIds: string[];
  answerPolicyCardIds: string[];
  checks: Check[];
  metrics: ReturnType<typeof measureAnswer>;
};

const cases: AsrCase[] = [
  {
    id: "intro_quick_version",
    scenario: "deepsense_live",
    kind: "personal_intro",
    partial: "okay um before we get into the tech stuff just give me the quick",
    final: "okay um before we get into the technical stuff, could you give me the quick version of who you are and what you're doing now?",
    expectedCategories: ["response"],
    minWords: 55,
    maxWords: 115,
    mustIncludeAny: [["MACS", "Dalhousie", "Dal"], ["Acadia", "BCS"], ["SayNext", "CueFlow"]],
  },
  {
    id: "best_project_choice",
    scenario: "deepsense_live",
    kind: "project_overview",
    partial: "out of those projects what's the one that probably shows",
    final: "out of those projects, what's the one that probably shows your work best, and why?",
    expectedCategories: ["response"],
    minWords: 45,
    maxWords: 105,
    mustIncludeAny: [["SayNext"], ["timing", "interrupt", "context", "cue"]],
  },
  {
    id: "timing_harder_than_generation",
    scenario: "deepsense_live",
    kind: "focused_followup",
    partial: "okay and in that one why was deciding when to show",
    final: "okay, and in that one, why was deciding when to show a cue harder than just generating the text?",
    expectedCategories: ["response"],
    minWords: 35,
    maxWords: 95,
    mustIncludeAny: [["router", "timing", "interrupt"], ["question", "cue", "context"]],
  },
  {
    id: "first_approach_failed",
    scenario: "deepsense_live",
    kind: "project_failure",
    partial: "what did you try first that honestly didn't",
    final: "what did you try first that honestly didn't work very well, and what did you change?",
    expectedCategories: ["response"],
    minWords: 40,
    maxWords: 100,
    mustIncludeAny: [["rules", "TF-IDF"], ["DistilBERT", "error analysis", "training data"]],
  },
  {
    id: "feedback_changed_work",
    scenario: "deepsense_live",
    kind: "behavioral_feedback",
    final: "tell me about some feedback that actually made you change how you built something.",
    expectedCategories: ["response"],
    minWords: 55,
    maxWords: 125,
    mustIncludeAny: [["feedback", "told", "said"], ["change", "changed", "started"]],
    reject: ["my manager at work", "my senior engineer"],
  },
  {
    id: "unsupported_langgraph_production",
    scenario: "deepsense_live",
    kind: "unsupported_experience",
    final: "have you actually run LangGraph agents in production, or anything like that?",
    expectedCategories: ["response"],
    minWords: 15,
    maxWords: 75,
    mustIncludeAny: [["haven't", "have not", "not in production", "no"], ["understand", "familiar", "learn", "similar"]],
    reject: ["I have run LangGraph", "I used LangGraph in production"],
  },
  {
    id: "questions_about_team",
    scenario: "deepsense_live",
    kind: "candidate_question",
    final: "okay, that's everything from me. what do you wanna ask about the team or the project?",
    expectedCategories: ["response"],
    minWords: 15,
    maxWords: 65,
    mustIncludeAny: [["success", "four months", "priority", "team", "project"]],
  },
  {
    id: "rag_retrieval_evaluation",
    scenario: "technical_live",
    kind: "technical_evaluation",
    partial: "say the rag bot looks good in the demo how do you know the retrieval",
    final: "say the RAG bot looks good in a demo. how do you know the retrieval is actually working?",
    expectedCategories: ["response"],
    minWords: 45,
    maxWords: 110,
    mustIncludeAny: [["evaluation", "test set", "questions"], ["recall", "precision", "top", "relevant"]],
  },
  {
    id: "document_reranking",
    scenario: "technical_live",
    kind: "technical_mechanism",
    final: "we've got maybe ten documents that kind of match. how would you rank which ones the model should see first?",
    expectedCategories: ["response"],
    minWords: 40,
    maxWords: 105,
    mustIncludeAny: [["rerank", "score", "relevance"], ["metadata", "permission", "fresh", "source"]],
  },
  {
    id: "aws_spiky_chatbot",
    scenario: "technical_live",
    kind: "cloud_design",
    partial: "traffic is mostly quiet but sometimes it spikes what would you put",
    final: "traffic is mostly quiet, but sometimes it spikes. what would you put on AWS for the chatbot?",
    expectedCategories: ["response"],
    minWords: 55,
    maxWords: 125,
    mustIncludeAny: [["Lambda", "serverless", "auto scaling"], ["API Gateway", "load balancer"], ["S3", "DynamoDB", "database"]],
    reject: ["I deployed this in production"],
  },
  {
    id: "public_internal_permissions",
    scenario: "technical_live",
    kind: "security_design",
    partial: "public site and internal docs are in the same bot how do you stop",
    final: "public website pages and internal documents are in the same bot. how do you stop people from seeing the wrong content?",
    expectedCategories: ["response"],
    minWords: 50,
    maxWords: 120,
    mustIncludeAny: [["authentication", "authorization", "permission", "access"], ["filter", "retrieval", "tenant"]],
  },
  {
    id: "agent_side_effect",
    scenario: "technical_live",
    kind: "agent_safety",
    final: "if the agent can update a project task, what would you check before letting it actually change anything?",
    expectedCategories: ["response"],
    minWords: 45,
    maxWords: 110,
    mustIncludeAny: [["permission", "authorize", "allowlist"], ["confirm", "approval"], ["validate", "idempotency", "audit"]],
  },
  {
    id: "debug_eight_second_latency",
    scenario: "technical_live",
    kind: "debugging",
    final: "the answer is correct, but it's taking like eight seconds. where do you start looking?",
    expectedCategories: ["response"],
    minWords: 45,
    maxWords: 105,
    mustIncludeAny: [["measure", "trace", "timing", "log"], ["retrieval", "model", "network", "database"]],
  },
  {
    id: "code_lru_cache",
    scenario: "technical_live",
    kind: "code",
    partial: "could you write type script for an l r u cache get and",
    final: "could you write TypeScript for an LRU cache with get and put? keep it simple.",
    expectedCategories: ["code"],
    minWords: 20,
    maxWords: 100,
    mustIncludeAny: [["Map", "map"], ["get"], ["put"]],
  },
  {
    id: "code_lru_complexity_followup",
    scenario: "technical_live",
    kind: "code_followup",
    final: "okay, explain why those operations are constant time and what the memory cost is.",
    expectedCategories: ["response"],
    minWords: 30,
    maxWords: 90,
    mustIncludeAny: [["O(1)", "constant time"], ["Map", "list", "node"], ["O(n)", "linear memory"]],
  },
  {
    id: "incomplete_database_fragment",
    scenario: "boundary_live",
    kind: "incomplete",
    final: "and uh for the database I guess you would probably",
    expectedCategories: ["none"],
    maxWords: 0,
  },
  {
    id: "brief_acknowledgement",
    scenario: "boundary_live",
    kind: "acknowledgement",
    final: "right, okay, yeah that makes sense.",
    expectedCategories: ["none"],
    maxWords: 0,
  },
  {
    id: "question_self_answered",
    scenario: "boundary_live",
    kind: "self_answered",
    final: "would you cache every document? no, probably just the hot ones with a TTL, otherwise invalidation gets messy.",
    expectedCategories: ["none"],
    maxWords: 0,
  },
  {
    id: "false_award_premise",
    scenario: "boundary_live",
    kind: "false_personal_premise",
    partial: "so when you won that SayNext innovation award",
    final: "so when you won that SayNext innovation award, what did that change for you?",
    expectedCategories: ["response"],
    minWords: 15,
    maxWords: 75,
    mustIncludeAny: [["didn't", "did not", "haven't", "not"]],
    reject: ["I won", "after winning", "the award helped me"],
  },
  {
    id: "unknown_project_premise",
    scenario: "boundary_live",
    kind: "unknown_personal_premise",
    final: "can you explain the architecture of your EchoLedger project?",
    expectedCategories: ["response"],
    minWords: 15,
    maxWords: 80,
    mustIncludeAny: [["not", "don't", "isn't", "haven't"], ["project", "SayNext", "CueFlow"]],
    reject: ["EchoLedger uses", "I built EchoLedger"],
  },
  {
    id: "referential_failure_followup",
    scenario: "boundary_live",
    kind: "referential_followup",
    recentContext: "Interviewer: You said the first rules-based router failed on noisy transcripts.",
    final: "and what did you do after that failed?",
    expectedCategories: ["response"],
    minWords: 30,
    maxWords: 95,
    mustIncludeAny: [["DistilBERT", "model"], ["error analysis", "training data", "examples"]],
  },
  {
    id: "lecture_batch_norm",
    scenario: "ambient_live",
    kind: "concept",
    partial: "so batch norm uses the mini batch stats to normalize",
    final: "so batch norm uses the mini-batch statistics to normalize the activations before the next part of the network.",
    expectedCategories: ["concept"],
    minWords: 25,
    maxWords: 100,
    mustIncludeAny: [["mean", "variance", "normalize"], ["training", "inference", "gamma", "beta"]],
  },
  {
    id: "meeting_priority_suggestion",
    scenario: "ambient_live",
    kind: "suggestion",
    final: "we've got two days left. the backend is still unstable and the UI needs polish. we probably need to pick one first.",
    expectedCategories: ["suggestion"],
    minWords: 20,
    maxWords: 85,
    mustIncludeAny: [["backend", "stability", "critical"], ["UI", "polish", "later"]],
  },
  {
    id: "explicit_people_roles",
    scenario: "ambient_live",
    kind: "person",
    final: "just so everyone knows, Maya owns the API deployment and Daniel is handling the retrieval test set.",
    expectedCategories: ["person"],
    minWords: 15,
    maxWords: 70,
    mustIncludeAny: [["Maya"], ["Daniel"], ["API", "deployment"], ["retrieval", "test"]],
  },
  {
    id: "ambient_noise",
    scenario: "ambient_live",
    kind: "noise",
    final: "uh sorry, one second, the door just, yeah never mind.",
    expectedCategories: ["none"],
    maxWords: 0,
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
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function answerText(result: AutoCueGenerationResult): string {
  return result.data.category === "code"
    ? result.data.explanation.trim()
    : result.data.fullAnswer.trim();
}

function measureAnswer(value: string) {
  const words = value.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || [];
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const sentenceWords = sentences.map((sentence) =>
    (sentence.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length);
  const lowered = value.toLowerCase();
  return {
    words: words.length,
    sentences: sentences.length,
    averageSentenceWords: sentences.length
      ? Number((words.length / sentences.length).toFixed(1))
      : 0,
    longestSentenceWords: Math.max(0, ...sentenceWords),
    contractions: value.match(/\b[A-Za-z]+['\u2019](?:m|re|ve|d|ll|s|t)\b/g)?.length || 0,
    abstractPhraseHits: [
      "this aligns",
      "what attracts me",
      "applied ai systems",
      "technical trade-offs",
      "the main design goal",
      "my focus has been",
      "what i'm most proud of",
    ].filter((phrase) => lowered.includes(phrase)),
    templateEnding: /(?:the main (?:thing|lesson|goal)|so my (?:focus|experience)|what i(?:'|’)?m most proud of|this (?:showed|taught) me)[^.!?]*[.!?]?$/i
      .test(value.trim()),
  };
}

function includesAny(value: string, options: string[]): boolean {
  const lowered = value.toLowerCase();
  return options.some((option) => lowered.includes(option.toLowerCase()));
}

function evaluate(testCase: AsrCase, result: AutoCueGenerationResult): Check[] {
  const cue = result.data;
  const spoken = answerText(result);
  const searchable = [spoken, cue.code, cue.fullAnswer, cue.explanation].join("\n");
  const metrics = measureAnswer(spoken);
  const checks: Check[] = [
    {
      name: "category",
      ok: testCase.expectedCategories.includes(cue.category),
      detail: `expected=${testCase.expectedCategories.join("|")} actual=${cue.category}`,
    },
    {
      name: "complete",
      ok: cue.category === "none"
        ? !spoken && !cue.code
        : Boolean(spoken) && !spoken.endsWith("..."),
    },
  ];

  if (testCase.minWords !== undefined) {
    checks.push({
      name: "minimum_depth",
      ok: metrics.words >= testCase.minWords,
      detail: `min=${testCase.minWords} actual=${metrics.words}`,
    });
  }
  if (testCase.maxWords !== undefined) {
    checks.push({
      name: "scope",
      ok: metrics.words <= testCase.maxWords,
      detail: `max=${testCase.maxWords} actual=${metrics.words}`,
    });
  }
  for (const [index, group] of (testCase.mustIncludeAny || []).entries()) {
    checks.push({
      name: `required_${index + 1}`,
      ok: includesAny(searchable, group),
      detail: group.join("|"),
    });
  }
  for (const rejected of testCase.reject || []) {
    checks.push({
      name: `reject_${rejected.replace(/\s+/g, "_")}`,
      ok: !searchable.toLowerCase().includes(rejected.toLowerCase()),
    });
  }
  if (cue.category === "code") {
    const codeLines = cue.code.split("\n");
    checks.push(
      { name: "code_present", ok: cue.code.trim().length > 40 },
      { name: "code_multiline", ok: codeLines.length >= 8 },
      { name: "code_no_fence", ok: !cue.code.includes("```") },
      { name: "code_fields_separate", ok: cue.explanation.trim().length > 15 && cue.fullAnswer === cue.explanation },
    );
  }
  return checks;
}

async function generateTurn(input: {
  text: string;
  recentTranscript: string;
  userId: string;
  conversationId: string;
  speculative: boolean;
  session: AutoCueSession;
  generator: OpenAiAutoCueGenerator;
  contextAdapter: LightweightEvenHubV2ContextAdapter;
}): Promise<GeneratedTurn & {
  memoryUsedIds: string[];
  interviewAnswerCardIds: string[];
  answerPolicyCardIds: string[];
}> {
  const contextStartedAt = performance.now();
  const context = await input.contextAdapter.build({
    userId: input.userId,
    conversationId: input.conversationId,
    currentQuestion: input.text,
    triggerWindow: input.text,
    recentTranscript: input.recentTranscript,
    selectedPrenoteIds: [],
    selectedPrenoteText: "",
    settings: defaultEvenHubV2Settings(),
  });
  const contextLatencyMs = Math.round(performance.now() - contextStartedAt);
  const generatorInput = {
    triggerWindow: input.text,
    recentTranscript: input.recentTranscript,
    contextSnapshot: context.contextSnapshot,
    settings: defaultEvenHubV2Settings(),
    router: null,
    session: input.session,
    speculative: input.speculative,
  };
  const generationStartedAt = performance.now();
  const result = await input.generator.generate(generatorInput);
  return {
    input: input.text,
    contextSnapshot: context.contextSnapshot,
    prompt: input.speculative
      ? buildAutoCuePrompt(generatorInput)
      : buildAutoCueTurnPrompt(generatorInput),
    contextLatencyMs,
    generationLatencyMs: Math.round(performance.now() - generationStartedAt),
    result,
    memoryUsedIds: context.memoryUsedIds,
    interviewAnswerCardIds: context.interviewAnswerCardIds,
    answerPolicyCardIds: context.answerPolicyCardIds,
  };
}

function buildMarkdown(results: CaseResult[], sessionIds: Record<string, string>): string {
  const checks = results.flatMap((result) => result.checks);
  const failures = checks.filter((check) => !check.ok);
  const nonNone = results.filter((result) => result.canonical.result.data.category !== "none");
  const mean = (values: number[]) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
    : 0;
  const lines = [
    "# EvenHub v2 Unseen Live ASR Variety Evaluation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Cases: ${results.length}`,
    `Checks: ${checks.length - failures.length}/${checks.length}`,
    `Speculative turns: ${results.filter((result) => result.speculative).length}`,
    `Average words, non-none: ${mean(nonNone.map((result) => result.metrics.words))}`,
    `Average sentence length: ${mean(nonNone.map((result) => result.metrics.averageSentenceWords))}`,
    `Average longest sentence: ${mean(nonNone.map((result) => result.metrics.longestSentenceWords))}`,
    `Template endings: ${nonNone.filter((result) => result.metrics.templateEnding).length}`,
    `Abstract phrase hits: ${nonNone.reduce((sum, result) => sum + result.metrics.abstractPhraseHits.length, 0)}`,
    "",
    "## Sessions",
    "",
    ...Object.entries(sessionIds).map(([scenario, id]) => `- ${scenario}: ${id}`),
    "",
  ];

  for (const result of results) {
    const canonical = result.canonical.result.data;
    const speculative = result.speculative?.result.data;
    lines.push(
      `## ${result.case.id}`,
      "",
      `Scenario: ${result.case.scenario}`,
      `Type: ${result.case.kind}`,
      result.case.partial ? `ASR partial: ${result.case.partial}` : "ASR partial: none",
      `ASR final: ${result.case.final}`,
      result.case.recentContext ? `Explicit recent context: ${result.case.recentContext}` : "Explicit recent context: none",
      "",
      `Expected category: ${result.case.expectedCategories.join(" | ")}`,
      `Speculative category: ${speculative?.category || "not run"}`,
      result.speculative ? `Speculative latency: context ${result.speculative.contextLatencyMs} ms; generation ${result.speculative.generationLatencyMs} ms` : "",
      `Final category: ${canonical.category}`,
      `Final latency: context ${result.canonical.contextLatencyMs} ms; generation ${result.canonical.generationLatencyMs} ms`,
      `Model: ${result.canonical.result.model}`,
      `Lane: ${result.canonical.result.lane || "unknown"}`,
      `Memory: ${result.memoryUsedIds.join(", ") || "none"}`,
      `Answer card: ${result.interviewAnswerCardIds.join(", ") || "none"}`,
      `Metrics: ${result.metrics.words} words; ${result.metrics.sentences} sentences; ${result.metrics.averageSentenceWords} avg; ${result.metrics.longestSentenceWords} longest; contractions=${result.metrics.contractions}`,
      `Style flags: abstract=${result.metrics.abstractPhraseHits.join(", ") || "none"}; templateEnding=${result.metrics.templateEnding}`,
      "",
      "Checks:",
      ...result.checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`),
      "",
    );
    if (result.speculative) {
      lines.push(
        "Speculative output:",
        speculative?.category === "code"
          ? `${speculative.explanation}\n\n${speculative.code}`
          : speculative?.fullAnswer || "(none)",
        "",
      );
    }
    lines.push("Final output:");
    if (canonical.category === "code") {
      lines.push(
        `Explanation: ${canonical.explanation}`,
        "",
        "````text",
        canonical.code,
        "````",
        "",
      );
    } else {
      lines.push(canonical.fullAnswer || "(none)", "");
    }
  }
  return lines.filter((line) => line !== undefined).join("\n");
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const goldenPath = join(process.cwd(), "data", "eval", "evenhub-v2-real-asr-memory-retrieval-golden-v1.json");
  const userId = (JSON.parse(readFileSync(goldenPath, "utf8")) as { userId: string }).userId;
  const generator = new OpenAiAutoCueGenerator();
  const contextAdapter = new LightweightEvenHubV2ContextAdapter({
    memoryUserId: userId,
    activeInterviewQuery: "DeepSense Full-Stack AI Developer Co-op Fall 2026 interview",
    interviewCards: getDeepSenseInterviewCards(),
  });
  const results: CaseResult[] = [];
  const sessionIds: Record<string, string> = {};

  for (const scenario of [...new Set(cases.map((testCase) => testCase.scenario))]) {
    let session: AutoCueSession | null = null;
    const recentQuestions: string[] = [];
    try {
      session = await generator.startSession({
        localConversationId: `asr-variety-${scenario}-${Date.now()}`,
        userId,
      });
      sessionIds[scenario] = session.providerConversationId;
      for (const testCase of cases.filter((candidate) => candidate.scenario === scenario)) {
        const recentTranscript = [
          ...recentQuestions.slice(-3),
          testCase.recentContext || "",
        ].filter(Boolean).join("\n");
        const conversationId = `asr-variety-${scenario}`;
        let speculative: GeneratedTurn | null = null;
        if (testCase.partial) {
          const generated = await generateTurn({
            text: testCase.partial,
            recentTranscript,
            userId,
            conversationId,
            speculative: true,
            session,
            generator,
            contextAdapter,
          });
          speculative = generated;
        }
        const canonicalWithContext = await generateTurn({
          text: testCase.final,
          recentTranscript,
          userId,
          conversationId,
          speculative: false,
          session,
          generator,
          contextAdapter,
        });
        const checks = evaluate(testCase, canonicalWithContext.result);
        const result: CaseResult = {
          case: testCase,
          speculative,
          canonical: canonicalWithContext,
          memoryUsedIds: canonicalWithContext.memoryUsedIds,
          interviewAnswerCardIds: canonicalWithContext.interviewAnswerCardIds,
          answerPolicyCardIds: canonicalWithContext.answerPolicyCardIds,
          checks,
          metrics: measureAnswer(answerText(canonicalWithContext.result)),
        };
        results.push(result);
        await generator.commitCanonicalTurn({
          session,
          question: testCase.final,
          result: canonicalWithContext.result,
        });
        recentQuestions.push(`Interviewer: ${testCase.final}`);
        console.log(
          `${testCase.id}: partial=${speculative?.result.data.category || "-"} final=${canonicalWithContext.result.data.category} `
          + `${result.metrics.words} words ${canonicalWithContext.generationLatencyMs}ms `
          + `${checks.filter((check) => check.ok).length}/${checks.length}`,
        );
      }
    } finally {
      if (session) await generator.endSession(session).catch(() => undefined);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(process.cwd(), "data", "review");
  mkdirSync(outputDir, { recursive: true });
  const baseName = `evenhub-v2-unseen-live-asr-variety-${stamp}`;
  const jsonPath = join(outputDir, `${baseName}.json`);
  const mdPath = join(outputDir, `${baseName}.md`);
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: process.env.EVENHUB_V2_AUTO_CUE_MODEL || "gpt-5.6-luna",
    sessionSeed: buildAutoCueSessionSeed(),
    sessionIds,
    results,
  }, null, 2), "utf8");
  writeFileSync(mdPath, buildMarkdown(results, sessionIds), "utf8");
  console.log(`json=${jsonPath}`);
  console.log(`report=${mdPath}`);
}

await main();
