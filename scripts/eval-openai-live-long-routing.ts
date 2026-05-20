import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResponse, Conversation } from "../src/server/mastra/types";

type LiveCase = {
  id: string;
  scene: string;
  latest: string;
  memory?: string;
  prenote?: string;
  expectAny: string[];
  rejectAny?: string[];
  maxWords: number;
};

type LongCase = {
  id: string;
  scene: string;
  latest: string;
  openingLine: string;
  memory?: string;
  prenote?: string;
  expectAny: string[];
  rejectAny?: string[];
  minWords: number;
  maxWords: number;
};

type EvalResult = {
  id: string;
  path: "live" | "long";
  model: string;
  latencyMs: number;
  words: number;
  flags: string[];
  output: string;
};

const liveCases: LiveCase[] = [
  {
    id: "daily_casual_monitor",
    scene: "Daily Chat",
    latest: "I'm thinking of buying a used monitor. What should I check before paying?",
    expectAny: ["dead", "port", "scratch", "return", "refresh"],
    rejectAny: ["lawyer", "medical", "contract"],
    maxWords: 60,
  },
  {
    id: "classroom_kubernetes_short",
    scene: "Classroom",
    latest: "Could you explain Kubernetes in simple words?",
    expectAny: ["container", "manage", "run", "scale", "restart"],
    rejectAny: ["not sure", "I don't know"],
    maxWords: 45,
  },
  {
    id: "interview_major_memory",
    scene: "Interview",
    latest: "What is your major?",
    memory: "Relevant personal memory:\n- Xiang is a MACS student at Dalhousie. MACS means Master of Applied Computer Science.",
    expectAny: ["MACS", "Master of Applied Computer Science", "Dalhousie"],
    rejectAny: ["math", "mathematics"],
    maxWords: 35,
  },
  {
    id: "meeting_api_blocker",
    scene: "Meeting / Group Discussion",
    latest: "The API contract is still changing. What should we do right now?",
    expectAny: ["mock", "schema", "contract", "confirm", "assumption"],
    rejectAny: ["already finished", "ignore", "`", "\"", "(", ")", "e.g.", "/"],
    maxWords: 70,
  },
  {
    id: "safety_deposit_pressure",
    scene: "Daily Chat",
    latest: "The landlord says I need to send the deposit right now or lose the apartment. Should I just pay?",
    expectAny: ["writing", "lease", "verify", "before", "deposit"],
    rejectAny: ["just pay", "send it now", "definitely", "pickup"],
    maxWords: 65,
  },
];

const longCases: LongCase[] = [
  {
    id: "long_kubernetes_beginner",
    scene: "Classroom",
    latest: "Could you explain Kubernetes in detail for a beginner presentation?",
    openingLine: "Sure, Kubernetes is basically a system for running containerized apps.",
    expectAny: ["container", "deployment", "scale", "restart", "service"],
    rejectAny: ["not sure", "I don't know"],
    minWords: 100,
    maxWords: 260,
  },
  {
    id: "long_ai_context_tradeoff",
    scene: "Interview",
    latest: "Can you explain your AI context engine project and the main trade-off?",
    openingLine: "One project I can talk about is an AI context engine for real-time conversation support.",
    memory: `Relevant personal memory:
- Xiang worked on an AI-centered context engine around live transcript handling, hybrid search, memory retrieval, scene routing, and input token reduction.
- The core trade-off was giving the model enough context to answer accurately while keeping latency low enough for real-time use.
- Techniques included duplicate transcript removal, canonical prompt rules, scene-based memory gating, knowledge-first retrieval, prenote chunk retrieval, cacheable prompt prefix separation, and latency regression tests.`,
    expectAny: ["latency", "context", "retrieval", "memory", "token"],
    rejectAny: ["production users", "enterprise", "revenue"],
    minWords: 100,
    maxWords: 260,
  },
  {
    id: "long_unsupported_revenue_guardrail",
    scene: "Interview",
    latest: "Tell me about your production users and revenue for that AI context engine.",
    openingLine: "I should be clear that this was a personal prototype, not a launched business.",
    memory: `Relevant personal memory:
- Xiang built a personal prototype AI context engine.
- Do not claim production users, revenue, enterprise customers, or a public company launch.`,
    expectAny: ["prototype", "not", "users", "revenue", "latency"],
    rejectAny: ["thousands", "enterprise customers", "revenue was", "launched company"],
    minWords: 90,
    maxWords: 230,
  },
];

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const rawArgs = process.argv.slice(2);
const liveLimit = Number(rawArgs.find((arg) => arg.startsWith("--live-limit="))?.slice("--live-limit=".length) || liveCases.length);
const longLimit = Number(rawArgs.find((arg) => arg.startsWith("--long-limit="))?.slice("--long-limit=".length) || longCases.length);

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const cleaned = compact(text);
  return cleaned ? cleaned.split(/\s+/).length : 0;
}

function containsAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function getSceneProfile(scene: string): string {
  if (scene === "Interview") {
    return "Active scene profile: Interview\nBe specific, truthful, grounded in memory, and avoid unsupported work history.";
  }
  if (scene === "Classroom") {
    return "Active scene profile: Classroom\nAnswer like a capable student: direct, conceptually accurate, and useful.";
  }
  if (scene === "Meeting / Group Discussion") {
    return "Active scene profile: Meeting / Group Discussion\nMove the task forward with blocker, owner, risk, decision, contract, or next step. Keep it to one or two short spoken sentences, not a spec document.";
  }
  return "Active scene profile: Daily Chat\nNatural, brief, casual, not essay-like.";
}

function evaluateOutput(testCase: LiveCase | LongCase, output: string): string[] {
  const flags: string[] = [];
  const words = wordCount(output);
  if (/^\s*(you can say|answer:|reply:|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (!containsAny(output, testCase.expectAny)) flags.push("missing_expected_term");
  if (testCase.rejectAny && containsAny(output, testCase.rejectAny)) flags.push("contains_rejected_term");
  if (words > testCase.maxWords) flags.push(`too_long:${words}>${testCase.maxWords}`);
  if ("minWords" in testCase && words < testCase.minWords) flags.push(`too_short:${words}<${testCase.minWords}`);
  if (!/[.!?。！？]["']?$/.test(output.trim())) flags.push("incomplete_sentence");
  if (/\b(variety of settings|demanding client|many different teams)\b/i.test(output)) flags.push("generic_phrase");
  if (testCase.scene === "Meeting / Group Discussion" && /[`"()/]/.test(output)) flags.push("written_punctuation");
  return flags;
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY is not configured; skipping OpenAI live/long routing eval.");
    return;
  }

  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-nano";
  process.env.OPENAI_LONG_MODEL = process.env.OPENAI_LONG_MODEL || "gpt-5.4-mini";
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = "false";

  const {
    generateTelepromptScript,
    processConversation,
    resolveOpenAiModelConfig,
  } = await import("../src/server/mastra/agents/initial-agent");
  const { Action } = await import("../src/server/mastra/types");
  const config = resolveOpenAiModelConfig();

  const selectedLiveCases = liveCases.slice(0, Math.max(0, Math.min(liveLimit, liveCases.length)));
  const selectedLongCases = longCases.slice(0, Math.max(0, Math.min(longLimit, longCases.length)));

  const results: EvalResult[] = [];
  for (const testCase of selectedLiveCases) {
    const conversation: Conversation = [{ type: "transcript", text: testCase.latest, timestamp: Date.now() }];
    const start = performance.now();
    const response: AgentResponse = await processConversation(
      conversation,
      "high",
      undefined,
      "english",
      testCase.prenote || "",
      getSceneProfile(testCase.scene),
      testCase.memory || "",
    );
    const output = response.type === Action.INSIGHT ? response.output : response.reasoning;
    results.push({
      id: testCase.id,
      path: "live",
      model: config.liveModel,
      latencyMs: Math.round(performance.now() - start),
      words: wordCount(output),
      flags: evaluateOutput(testCase, output),
      output,
    });
  }

  for (const testCase of selectedLongCases) {
    const conversation: Conversation = [{ type: "transcript", text: testCase.latest, timestamp: Date.now() }];
    const start = performance.now();
    const output = await generateTelepromptScript({
      conversation,
      outputLanguage: "english",
      activeSceneProfilePrompt: getSceneProfile(testCase.scene),
      relevantPersonalMemoryContext: testCase.memory || "",
      activePrenoteContext: testCase.prenote || "",
      openingLine: testCase.openingLine,
      targetMode: "long",
    });
    results.push({
      id: testCase.id,
      path: "long",
      model: config.longModel,
      latencyMs: Math.round(performance.now() - start),
      words: wordCount(output),
      flags: evaluateOutput(testCase, output),
      output,
    });
  }

  mkdirSync(outDir, { recursive: true });
  const liveLatencies = results.filter((item) => item.path === "live").map((item) => item.latencyMs);
  const longLatencies = results.filter((item) => item.path === "long").map((item) => item.latencyMs);
  const avg = (items: number[]) => Math.round(items.reduce((sum, item) => sum + item, 0) / Math.max(items.length, 1));
  const lines = [
    "# OpenAI Live / Long Model Routing Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Live model: ${config.liveModel}`,
    `Long model: ${config.longModel}`,
    `Live limit: ${selectedLiveCases.length}/${liveCases.length}`,
    `Long limit: ${selectedLongCases.length}/${longCases.length}`,
    "",
    "## Summary",
    "",
    `- live cases: ${liveLatencies.length}, avg latency: ${avg(liveLatencies)}ms`,
    `- long cases: ${longLatencies.length}, avg latency: ${avg(longLatencies)}ms`,
    `- flagged cases: ${results.filter((item) => item.flags.length > 0).length}/${results.length}`,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.id}`, "");
    lines.push(`- path: ${result.path}`);
    lines.push(`- model: ${result.model}`);
    lines.push(`- latency: ${result.latencyMs}ms`);
    lines.push(`- words: ${result.words}`);
    lines.push(`- flags: ${result.flags.length ? result.flags.join(", ") : "none"}`);
    lines.push("");
    lines.push("```text");
    lines.push(result.output);
    lines.push("```");
    lines.push("");
  }

  const mdPath = join(outDir, `openai-live-long-routing-${timestamp}.md`);
  const jsonPath = join(outDir, `openai-live-long-routing-${timestamp}.json`);
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ config, results }, null, 2), "utf8");
  console.log(`OpenAI live/long routing eval written: ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
