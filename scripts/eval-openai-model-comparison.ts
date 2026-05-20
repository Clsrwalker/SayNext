import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Conversation, AgentResponse } from "../src/server/mastra/types";

type Case = {
  id: string;
  scene: string;
  latest: string;
  history?: string[];
  memory?: string;
  prenote?: string;
  profile?: string;
  expectAny?: string[];
  rejectAny?: string[];
  maxWords?: number;
};

type CaseResult = {
  id: string;
  scene: string;
  latest: string;
  output: string;
  latencyMs: number;
  wordCount: number;
  flags: string[];
};

type ModelResult = {
  model: string;
  results: CaseResult[];
  summary: {
    cases: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    flaggedCases: number;
  };
};

const models = ["gpt-5.4-nano", "gpt-5-mini", "gpt-5.4-mini"];
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");

const cases: Case[] = [
  {
    id: "daily_used_monitor",
    scene: "Daily Chat",
    latest: "I'm thinking of buying a used monitor for my desk. What should I check before I pay?",
    expectAny: ["dead pixel", "ports", "scratch", "resolution", "refresh", "return"],
    rejectAny: ["contract", "lawyer", "medical"],
    maxWords: 55,
  },
  {
    id: "technical_kubernetes_simple",
    scene: "Classroom",
    latest: "Could you explain Kubernetes in simple words?",
    expectAny: ["container", "manage", "run", "scale", "restart"],
    rejectAny: ["I don't know", "not sure"],
    maxWords: 70,
  },
  {
    id: "interview_project_tradeoff",
    scene: "Interview",
    latest: "What was the main trade-off in your AI context engine project?",
    memory: `Relevant personal memory:
- Xiang built an AI-centered context engine around live transcript handling, hybrid search, memory retrieval, memory gating, and input token reduction.
- The core trade-off was giving the model enough context to answer accurately while keeping latency low for a real-time app.
- Techniques included removing duplicate latest transcripts, canonical rules, scene-based memory gating, knowledge-first retrieval, prenote chunk retrieval, and separating cacheable instructions from dynamic transcript context.`,
    expectAny: ["latency", "context", "token", "retrieval", "gating"],
    rejectAny: ["SayNext", "production users", "senior engineer", "Google"],
    maxWords: 95,
  },
  {
    id: "interview_team_example",
    scene: "Interview",
    latest: "Can you give me an example of working as part of a team?",
    memory: `Relevant personal memory:
- Xiang has school project and team experience but should not claim senior workplace experience.
- For teamwork examples, Xiang can talk about student projects where responsibilities were split, assumptions were documented, and integration issues were solved by agreeing on interfaces and checking progress regularly.`,
    expectAny: ["student", "project", "interface", "responsibilities", "integration", "progress"],
    rejectAny: ["client", "manager", "at my company", "senior"],
    maxWords: 120,
  },
  {
    id: "meeting_unclear_blocker",
    scene: "Meeting / Group Discussion",
    history: ["We still don't have the final API schema from the backend."],
    latest: "Can you take that part?",
    expectAny: ["mock", "schema", "assumption", "confirm", "contract", "interface"],
    rejectAny: ["I already finished", "I fixed"],
    maxWords: 65,
  },
  {
    id: "classroom_smart_question",
    scene: "Classroom",
    latest: "So that's the basic idea of cache invalidation. Any questions?",
    expectAny: ["stale", "TTL", "invalidation", "write", "consistency", "cache"],
    rejectAny: ["haha", "crazy", "my favorite"],
    maxWords: 55,
  },
  {
    id: "safety_lease_pressure",
    scene: "Daily Chat",
    latest: "The landlord says I need to send the deposit now or lose the apartment. Should I just pay?",
    expectAny: ["confirm", "writing", "review", "receipt", "scam", "before"],
    rejectAny: ["just pay", "send it now", "definitely"],
    maxWords: 60,
  },
  {
    id: "personal_major",
    scene: "Interview",
    latest: "What is your major?",
    memory: "Relevant personal memory:\n- Xiang is a MACS student at Dalhousie. MACS means Master of Applied Computer Science.",
    expectAny: ["MACS", "Master of Applied Computer Science", "Dalhousie"],
    rejectAny: ["math", "mathematics"],
    maxWords: 35,
  },
  {
    id: "casual_slang",
    scene: "Daily Chat",
    latest: "Bro this assignment is kinda cooked, what are you doing after class?",
    expectAny: ["probably", "after class", "work", "home", "chill", "assignment"],
    rejectAny: ["I will be conducting", "as an AI"],
    maxWords: 45,
  },
  {
    id: "unknown_project_guardrail",
    scene: "Interview",
    latest: "Tell me about your production users and revenue for that AI context engine.",
    memory: "Relevant personal memory:\n- Xiang built a personal prototype AI context engine. Do not claim production users, revenue, enterprise clients, or a real company launch unless directly supported.",
    expectAny: ["prototype", "not", "users", "revenue", "personal"],
    rejectAny: ["thousands", "enterprise", "revenue was"],
    maxWords: 80,
  },
];

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function containsAny(text: string, terms: string[] = []): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function evaluateOutput(testCase: Case, output: string): string[] {
  const flags: string[] = [];
  if (/^\s*(you can say|answer:|reply:|suggested reply|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (/\bas an ai\b/i.test(output)) flags.push("as_an_ai");
  if (testCase.expectAny?.length && !containsAny(output, testCase.expectAny)) flags.push("missing_expected_term");
  if (testCase.rejectAny?.length && containsAny(output, testCase.rejectAny)) flags.push("contains_rejected_term");
  if (/\bproduction users\b/i.test(output) && !/\b(no|not|don't|do not|doesn't|didn't|without|haven't|no real)\b/i.test(output)) {
    flags.push("unsupported_production_user_claim");
  }
  if (testCase.maxWords && wordCount(output) > testCase.maxWords) flags.push("too_long");
  if (!/[.!?。！？]["'”’)]?$/.test(output.trim())) flags.push("incomplete_sentence");
  if (/generic|variety of settings|demanding client/i.test(output)) flags.push("generic_phrase");
  return flags;
}

function getSceneProfile(scene: string): string {
  if (scene === "Interview") {
    return "Active scene profile: Interview\nBe specific, truthful, grounded in memory, and avoid unsupported work history. Use STAR-style concrete details when asked for examples.";
  }
  if (scene === "Classroom") {
    return "Active scene profile: Classroom\nAnswer like a capable student: direct, conceptually accurate, and useful. Ask a smart question when appropriate.";
  }
  if (scene === "Meeting / Group Discussion") {
    return "Active scene profile: Meeting / Group Discussion\nMove the task forward with blocker, owner, risk, decision, contract, or next step.";
  }
  return "Active scene profile: Daily Chat\nNatural, brief, casual, not essay-like.";
}

async function runWorker(model: string): Promise<ModelResult> {
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_MODEL = model;
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = "false";
  const { processConversation } = await import("../src/server/mastra/agents/initial-agent");
  const { Action } = await import("../src/server/mastra/types");

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const conversation: Conversation = [
      ...(testCase.history || []).map((text) => ({ type: "transcript" as const, text, timestamp: Date.now() - 1 })),
      { type: "transcript", text: testCase.latest, timestamp: Date.now() },
    ];
    const start = performance.now();
    const response: AgentResponse = await processConversation(
      conversation,
      "high",
      undefined,
      "english",
      testCase.prenote || "",
      testCase.profile || getSceneProfile(testCase.scene),
      testCase.memory || "",
    );
    const latencyMs = Math.round(performance.now() - start);
    const output = response.type === Action.INSIGHT ? response.output : response.reasoning;
    results.push({
      id: testCase.id,
      scene: testCase.scene,
      latest: testCase.latest,
      output,
      latencyMs,
      wordCount: wordCount(output),
      flags: evaluateOutput(testCase, output),
    });
  }

  const sortedLatencies = results.map((item) => item.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = Math.round(sortedLatencies.reduce((sum, item) => sum + item, 0) / sortedLatencies.length);
  const p50LatencyMs = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] ?? 0;
  const p95LatencyMs = sortedLatencies[Math.min(sortedLatencies.length - 1, Math.ceil(sortedLatencies.length * 0.95) - 1)] ?? 0;

  return {
    model,
    results,
    summary: {
      cases: results.length,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      flaggedCases: results.filter((item) => item.flags.length > 0).length,
    },
  };
}

function runParent(): void {
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY is not configured; skipping OpenAI model comparison.");
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const bunExe = process.execPath;
  const allResults: ModelResult[] = [];

  for (const model of models) {
    const child = spawnSync(bunExe, ["run", import.meta.path], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SAYNEXT_MODEL_COMPARE_WORKER: "1",
        SAYNEXT_MODEL_COMPARE_MODEL: model,
      },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });

    if (child.status !== 0) {
      console.error(child.stdout);
      console.error(child.stderr);
      throw new Error(`Model comparison worker failed for ${model}`);
    }

    const jsonStart = child.stdout.indexOf("__MODEL_RESULT_JSON__");
    if (jsonStart === -1) {
      console.error(child.stdout);
      throw new Error(`Model comparison worker returned no JSON for ${model}`);
    }
    const jsonText = child.stdout.slice(jsonStart + "__MODEL_RESULT_JSON__".length).trim();
    allResults.push(JSON.parse(jsonText) as ModelResult);
  }

  const lines: string[] = [
    "# OpenAI Model Output Comparison",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Models: ${models.join(", ")}`,
    `Cases: ${cases.length}`,
    "",
    "## Summary",
    "",
    "| Model | Avg latency | P50 | P95 | Flagged cases |",
    "|---|---:|---:|---:|---:|",
    ...allResults.map((item) => `| ${item.model} | ${item.summary.avgLatencyMs}ms | ${item.summary.p50LatencyMs}ms | ${item.summary.p95LatencyMs}ms | ${item.summary.flaggedCases}/${item.summary.cases} |`),
    "",
  ];

  for (const testCase of cases) {
    lines.push(`## ${testCase.id}`, "");
    lines.push(`Scene: ${testCase.scene}`);
    lines.push(`Latest: ${testCase.latest}`, "");
    for (const modelResult of allResults) {
      const result = modelResult.results.find((item) => item.id === testCase.id);
      if (!result) continue;
      lines.push(`### ${modelResult.model}`);
      lines.push(`Latency: ${result.latencyMs}ms`);
      lines.push(`Words: ${result.wordCount}`);
      lines.push(`Flags: ${result.flags.length ? result.flags.join(", ") : "none"}`);
      lines.push(`Output: ${result.output}`, "");
    }
  }

  const mdPath = join(outDir, `openai-model-comparison-${timestamp}.md`);
  const jsonPath = join(outDir, `openai-model-comparison-${timestamp}.json`);
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify(allResults, null, 2), "utf8");
  console.log(`OpenAI model comparison written: ${mdPath}`);
}

async function main(): Promise<void> {
  if (process.env.SAYNEXT_MODEL_COMPARE_WORKER === "1") {
    const model = process.env.SAYNEXT_MODEL_COMPARE_MODEL;
    if (!model) throw new Error("SAYNEXT_MODEL_COMPARE_MODEL is required");
    const result = await runWorker(model);
    console.log(`__MODEL_RESULT_JSON__${JSON.stringify(result)}`);
    return;
  }

  runParent();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
