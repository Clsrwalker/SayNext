import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  OpenAiAutoCueGenerator,
  type AutoCueGenerationResult,
  type AutoCueSession,
} from "../src/server/evenhub-v2/auto-cue-generator";
import { LightweightEvenHubV2ContextAdapter } from "../src/server/evenhub-v2/context-adapter";
import { getDeepSenseInterviewCards } from "../src/server/evenhub-v2/interview-guide";
import { defaultEvenHubV2Settings } from "../src/server/evenhub-v2/protocol";
import { normalizeGlassCode } from "../evenhub-v2/src/glasses-layout";

type InterviewCase = {
  id: string;
  stage: string;
  question: string;
  expectedCategory: "response" | "code";
};

type TurnResult = {
  case: InterviewCase;
  latencyMs: number;
  contextLatencyMs: number;
  generationLatencyMs: number;
  result: AutoCueGenerationResult;
  memoryUsedIds: string[];
  interviewAnswerCardIds: string[];
  answerPolicyCardIds: string[];
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
};

const cases: InterviewCase[] = [
  {
    id: "intro",
    stage: "Introduction",
    question: "yeah sure, so uh could you tell me a little bit about yourself",
    expectedCategory: "response",
  },
  {
    id: "project",
    stage: "Project deep dive",
    question: "okay nice, can you walk me through SayNext and like what was the hardest technical part",
    expectedCategory: "response",
  },
  {
    id: "design",
    stage: "System design",
    question: "say we need a chatbot for our public site and internal docs, how would you design the RAG pipeline",
    expectedCategory: "response",
  },
  {
    id: "code",
    stage: "Live coding",
    question: "all right, can you write a TypeScript function that returns the first pair of indexes whose values add up to a target",
    expectedCategory: "code",
  },
  {
    id: "explain_code",
    stage: "Code walkthrough",
    question: "cool, now walk me through that code and tell me the time and space complexity",
    expectedCategory: "response",
  },
  {
    id: "tests",
    stage: "Testing",
    question: "what edge cases would you test for that function and why",
    expectedCategory: "response",
  },
  {
    id: "behavioral",
    stage: "Behavioral debugging",
    question: "tell me about a time something broke during integration, like how did you actually narrow it down",
    expectedCategory: "response",
  },
  {
    id: "role_fit",
    stage: "Role fit",
    question: "last one, why DeepSense and why this full stack AI co-op specifically",
    expectedCategory: "response",
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function evaluateTurn(testCase: InterviewCase, result: AutoCueGenerationResult): TurnResult["checks"] {
  const cue = result.data;
  const checks: TurnResult["checks"] = [
    {
      name: "expected_category",
      ok: cue.category === testCase.expectedCategory,
      detail: `expected=${testCase.expectedCategory} actual=${cue.category}`,
    },
    {
      name: "complete_without_ellipsis",
      ok: Boolean(cue.output.trim()) && !cue.output.includes("..."),
    },
  ];

  if (testCase.expectedCategory === "code") {
    const lines = cue.code.split("\n");
    const longestLine = Math.max(0, ...lines.map((line) => line.length));
    checks.push(
      { name: "structured_code_field", ok: cue.code.length > 0 && cue.output === cue.code },
      { name: "preserves_structure", ok: lines.length >= 4 && /\n {2}\S/.test(cue.code) },
      { name: "no_markdown_fence", ok: !cue.code.includes("```") },
      { name: "g2_keeps_complete_code", ok: normalizeGlassCode(cue.code) === cue.code },
      { name: "has_explanation", ok: cue.explanation.trim().length >= 20 },
      { name: "g2_line_length_target", ok: longestLine <= 48, detail: `lines=${lines.length} longest=${longestLine}` },
    );
  } else {
    checks.push({
      name: "spoken_answer",
      ok: cue.fullAnswer.trim().length >= 20 && !/^(answer|response|here is)/i.test(cue.fullAnswer.trim()),
    });
  }

  if (testCase.id === "explain_code") {
    checks.push({
      name: "explains_previous_code",
      ok: /map|complement|lookup/i.test(cue.fullAnswer) && /O\s*\(n\)/i.test(cue.fullAnswer),
    });
  }
  return checks;
}

function reportMarkdown(turns: TurnResult[], providerConversationId: string): string {
  const passed = turns.reduce(
    (count, turn) => count + turn.checks.filter((check) => check.ok).length,
    0,
  );
  const total = turns.reduce((count, turn) => count + turn.checks.length, 0);
  const lines = [
    "# EvenHub v2 Software Engineering Interview Simulation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Provider conversation: ${providerConversationId}`,
    `Checks: ${passed}/${total}`,
    "",
  ];

  for (const turn of turns) {
    const cue = turn.result.data;
    lines.push(
      `## ${turn.case.stage}`,
      "",
      `ASR question: ${turn.case.question}`,
      "",
      `Category: ${cue.category}`,
      `End-to-end latency: ${turn.latencyMs} ms`,
      `Context latency: ${turn.contextLatencyMs} ms`,
      `Generation latency: ${turn.generationLatencyMs} ms`,
      `Model: ${turn.result.model}`,
      `Lane: ${turn.result.lane || "unknown"}`,
      `Memory: ${turn.memoryUsedIds.join(", ") || "none"}`,
      `Answer card: ${turn.interviewAnswerCardIds.join(", ") || "none"}`,
      `Answer policy: ${turn.answerPolicyCardIds.join(", ") || "none"}`,
      "",
      "Checks:",
      ...turn.checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`),
      "",
    );
    if (cue.category === "code") {
      lines.push(
        `Explanation: ${cue.explanation}`,
        "",
        `Language: ${cue.language || "unknown"}`,
        "",
        "````text",
        cue.code,
        "````",
        "",
      );
    } else {
      lines.push(cue.fullAnswer, "");
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const args = process.argv.slice(2);
  const userId = args.find((arg) => !arg.startsWith("--"))
    || process.env.EVENHUB_V2_MEMORY_USER_ID
    || process.env.DEFAULT_USER_ID
    || "";
  if (!userId) {
    throw new Error("Pass a user ID or set EVENHUB_V2_MEMORY_USER_ID");
  }
  const selectedCases = args.includes("--coding-flow")
    ? cases.filter((testCase) => ["code", "explain_code", "tests"].includes(testCase.id))
    : args.includes("--policy-flow")
      ? cases.filter((testCase) => ["behavioral", "role_fit"].includes(testCase.id))
      : cases;
  const generator = new OpenAiAutoCueGenerator();
  const contextAdapter = new LightweightEvenHubV2ContextAdapter({
    memoryUserId: userId,
    activeInterviewQuery: "DeepSense Full-Stack AI Developer Co-op Fall 2026 interview",
    interviewCards: getDeepSenseInterviewCards(),
  });
  let session: AutoCueSession | null = null;
  const turns: TurnResult[] = [];
  const recentQuestions: string[] = [];

  try {
    session = await generator.startSession?.({
      localConversationId: `simulation-${Date.now()}`,
      userId,
    }) || null;
    if (!session) throw new Error("OpenAI conversation session was not created");

    for (const testCase of selectedCases) {
      const recentTranscript = recentQuestions.slice(-3).join("\n");
      const turnStartedAt = performance.now();
      const contextStartedAt = performance.now();
      const context = await contextAdapter.build({
        userId,
        conversationId: "software-interview-simulation",
        currentQuestion: testCase.question,
        triggerWindow: testCase.question,
        recentTranscript,
        selectedPrenoteIds: [],
        selectedPrenoteText: "",
        settings: defaultEvenHubV2Settings(),
      });
      const contextLatencyMs = Math.round(performance.now() - contextStartedAt);
      const generationStartedAt = performance.now();
      const result = await generator.generate({
        triggerWindow: testCase.question,
        recentTranscript,
        contextSnapshot: context.contextSnapshot,
        settings: defaultEvenHubV2Settings(),
        router: null,
        session,
        speculative: false,
      });
      const generationLatencyMs = Math.round(performance.now() - generationStartedAt);
      const latencyMs = Math.round(performance.now() - turnStartedAt);
      const checks = evaluateTurn(testCase, result);
      turns.push({
        case: testCase,
        latencyMs,
        contextLatencyMs,
        generationLatencyMs,
        result,
        memoryUsedIds: context.memoryUsedIds,
        interviewAnswerCardIds: context.interviewAnswerCardIds,
        answerPolicyCardIds: context.answerPolicyCardIds,
        checks,
      });
      await generator.commitCanonicalTurn?.({
        session,
        question: testCase.question,
        result,
      });
      recentQuestions.push(`Interviewer: ${testCase.question}`);
      console.log(`${testCase.id}: category=${result.data.category} total=${latencyMs}ms context=${contextLatencyMs}ms generation=${generationLatencyMs}ms checks=${checks.filter((check) => check.ok).length}/${checks.length}`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = join(process.cwd(), "data", "review");
    mkdirSync(outputDir, { recursive: true });
    const baseName = `evenhub-v2-code-interview-simulation-${stamp}`;
    const serializable = {
      generatedAt: new Date().toISOString(),
      providerConversationId: session.providerConversationId,
      turns,
    };
    writeFileSync(join(outputDir, `${baseName}.json`), JSON.stringify(serializable, null, 2), "utf8");
    writeFileSync(join(outputDir, `${baseName}.md`), reportMarkdown(turns, session.providerConversationId), "utf8");
    const failed = turns.flatMap((turn) => turn.checks.filter((check) => !check.ok));
    console.log(`report=${join(outputDir, `${baseName}.md`)}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (session) await generator.endSession?.(session).catch(() => undefined);
  }
}

await main();
