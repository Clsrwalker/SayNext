import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger, createPersonalMemoryRetrievalDebug } from "../src/server/data/conversation-logger";
import { extractResponseText } from "../src/server/mastra/agents/openai-conversation-state";
import { buildSayNextLiveTaskPrompt, sayNextInstructions } from "../src/server/saynext/prompts";

type EvalMode = "current_live" | "deep_answer";

type DepthCase = {
  id: string;
  group: string;
  question: string;
  expectedTerms: string[];
  tradeoffTerms: string[];
};

type ModeResult = {
  mode: EvalMode;
  output: string;
  latencyMs: number;
  wordCount: number;
  matchedTerms: string[];
  score: number;
  flags: string[];
};

type CaseResult = {
  id: string;
  group: string;
  question: string;
  retrieved: Array<{ sourceRef: string; title: string; score: number }>;
  contextChars: number;
  modeResults: ModeResult[];
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const cases: DepthCase[] = [
  {
    id: "dynamodb_access_pattern_hot_partition",
    group: "database_nosql",
    question: "Why does DynamoDB table design start from access patterns, and what goes wrong with a bad partition key?",
    expectedTerms: ["access pattern", "partition key", "sort key", "GSI", "hot partition", "query"],
    tradeoffTerms: ["hot partition", "scan", "write", "cost", "latency", "throughput"],
  },
  {
    id: "sql_isolation_phantom_read",
    group: "database_sql",
    question: "Explain transaction isolation using dirty read, non-repeatable read, and phantom read.",
    expectedTerms: ["isolation", "dirty read", "non-repeatable", "phantom", "transaction", "serializable"],
    tradeoffTerms: ["lock", "concurrency", "performance", "consistency", "snapshot"],
  },
  {
    id: "deadlock_prevention",
    group: "os_concurrency",
    question: "What conditions cause deadlock, and how can a system prevent it?",
    expectedTerms: ["mutual exclusion", "hold and wait", "no preemption", "circular wait", "lock ordering", "timeout"],
    tradeoffTerms: ["starvation", "overhead", "throughput", "ordering", "timeout"],
  },
  {
    id: "cap_theorem_design_choice",
    group: "distributed_systems",
    question: "How should I explain CAP theorem without making it sound like every system simply picks two?",
    expectedTerms: ["partition", "consistency", "availability", "network", "trade-off", "replica"],
    tradeoffTerms: ["partition", "latency", "stale", "quorum", "availability", "consistency"],
  },
  {
    id: "jwt_validation_security",
    group: "security",
    question: "How should JWT validation work, and what security mistakes should I avoid?",
    expectedTerms: ["signature", "issuer", "audience", "expiration", "algorithm", "secret"],
    tradeoffTerms: ["replay", "leak", "revocation", "least privilege", "refresh token", "trust"],
  },
  {
    id: "url_shortener_bottlenecks",
    group: "system_design",
    question: "Design a URL shortener and explain the first bottlenecks you would expect.",
    expectedTerms: ["short code", "redirect", "database", "cache", "collision", "read heavy"],
    tradeoffTerms: ["latency", "collision", "hot key", "cache", "write", "analytics"],
  },
  {
    id: "backprop_vanishing_gradient",
    group: "deep_learning",
    question: "What is backpropagation, and why can vanishing gradients make training deep networks hard?",
    expectedTerms: ["gradient", "chain rule", "weights", "loss", "vanishing", "activation"],
    tradeoffTerms: ["ReLU", "normalization", "residual", "learning rate", "deep", "saturating"],
  },
  {
    id: "cache_invalidation_consistency",
    group: "system_design",
    question: "Why is cache invalidation difficult, and how do TTL and write-through strategies differ?",
    expectedTerms: ["cache", "invalidation", "TTL", "write-through", "stale", "consistency"],
    tradeoffTerms: ["latency", "freshness", "stale", "write cost", "miss", "consistency"],
  },
];

function loadDotEnvFile(path: string): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      const key = match[1];
      if (process.env[key]) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // Optional local env file.
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const prefix = `${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function termMatched(output: string, term: string): boolean {
  const normalizedOutput = output.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  if (normalizedOutput.includes(normalizedTerm)) return true;
  return normalizedTerm
    .split(/\s+/)
    .filter((part) => part.length >= 4)
    .some((part) => normalizedOutput.includes(part));
}

function evaluateOutput(testCase: DepthCase, mode: EvalMode, output: string): Omit<ModeResult, "mode" | "output" | "latencyMs" | "wordCount"> {
  const lower = output.toLowerCase();
  const matchedTerms = testCase.expectedTerms.filter((term) => termMatched(output, term));
  const matchedTradeoff = testCase.tradeoffTerms.filter((term) => termMatched(output, term));
  const flags: string[] = [];
  const hasMechanism = /\b(because|works by|uses|checks|maps|stores|updates|propagates|chooses|splits|replicates|validates|compares|prevents)\b/i.test(output);
  const hasTradeoff = matchedTradeoff.length > 0 || /\b(trade[- ]?off|risk|cost|latency|overhead|failure|consistency|performance|scalability|stale|slow|hot)\b/i.test(output);
  const hasConcreteMove = /\b(for example|example|first|then|if|use|check|choose|add|avoid|measure|start with)\b/i.test(output);

  if (matchedTerms.length < Math.ceil(testCase.expectedTerms.length * 0.45)) flags.push("missing_core_terms");
  if (!hasMechanism) flags.push("missing_mechanism");
  if (!hasTradeoff) flags.push("missing_tradeoff_or_failure");
  if (!hasConcreteMove) flags.push("missing_concrete_example_or_move");
  if (/^\s*(you can say|answer:|reply:|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (/\bas an ai\b/i.test(output)) flags.push("as_an_ai");

  const words = wordCount(output);
  if (mode === "current_live" && words > 55) flags.push("too_long_for_live");
  if (mode === "deep_answer" && words < 55) flags.push("too_short_for_deep");
  if (mode === "deep_answer" && words > 160) flags.push("too_long_for_deep");

  let score = 0;
  if (matchedTerms.length >= Math.ceil(testCase.expectedTerms.length * 0.45)) score += 1;
  if (matchedTerms.length >= Math.ceil(testCase.expectedTerms.length * 0.7)) score += 1;
  if (hasMechanism) score += 1;
  if (hasTradeoff) score += 1;
  if (hasConcreteMove) score += 1;
  if (flags.includes("meta_prefix") || flags.includes("as_an_ai")) score -= 1;

  return { matchedTerms, score: Math.max(0, score), flags };
}

async function callOpenAi(params: {
  model: string;
  instructions: string;
  input: string;
  timeoutMs: number;
}): Promise<{ output: string; latencyMs: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");

  const controller = new AbortController();
  const started = performance.now();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        instructions: params.instructions,
        input: params.input,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return {
      output: extractResponseText(data),
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(mode: EvalMode, question: string, context: string): { instructions: string; input: string } {
  if (mode === "current_live") {
    return {
      instructions: sayNextInstructions,
      input: [
        buildSayNextLiveTaskPrompt({
          promptMode: "classroom",
          supportContext: context,
        }),
        `Current transcript: ${question}`,
      ].join("\n\n"),
    };
  }

  return {
    instructions: "Answer as a strong CS tutor/interview coach. Return only the answer text, no labels or markdown.",
    input: [
      "Use the retrieved context if it is relevant, but do not copy it mechanically.",
      "Answer in 80-140 English words.",
      "Include: mechanism, trade-off or failure mode, and one concrete example or design move.",
      "Do not be generic. Prefer precise CS terms.",
      context.trim() ? `Retrieved context:\n${context.trim()}` : "Retrieved context: none.",
      `Question: ${question}`,
    ].join("\n\n"),
  };
}

async function run(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));

  const userId = argValue("--user") || process.env.DEFAULT_USER_ID || "li2897283405@gmail.com";
  const model = argValue("--model") || process.env.OPENAI_MODEL || "gpt-5.4-nano";
  const outDir = argValue("--out-dir") || join(process.cwd(), "data", "eval");
  const limit = Number(argValue("--limit") || cases.length);
  const timeoutMs = Number(argValue("--timeout-ms") || process.env.OPENAI_TIMEOUT_MS || 45000);
  const selectedCases = cases.slice(0, Number.isFinite(limit) && limit > 0 ? limit : cases.length);
  const modes: EvalMode[] = (argValue("--modes") || "current_live,deep_answer")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is EvalMode => item === "current_live" || item === "deep_answer");

  if (!process.env.OPENAI_API_KEY) {
    console.error("[eval-cs-depth-llm] OPENAI_API_KEY is missing.");
    process.exitCode = 1;
    return;
  }

  mkdirSync(outDir, { recursive: true });

  const results: CaseResult[] = [];
  for (const [index, testCase] of selectedCases.entries()) {
    const debug = createPersonalMemoryRetrievalDebug(testCase.question);
    const memories = await conversationLogger.searchPersonalMemoriesHybridAsync(userId, testCase.question, 4, debug);
    const context = await conversationLogger.getRelevantPersonalMemoryContextAsync(userId, testCase.question, 4);
    const retrieved = memories.map((memory) => ({
      sourceRef: memory.sourceRef || `id:${memory.id}`,
      title: memory.title,
      score: Number(memory.score.toFixed(4)),
    }));

    const modeResults: ModeResult[] = [];
    for (const mode of modes) {
      const prompt = buildPrompt(mode, testCase.question, context);
      const generated = await callOpenAi({
        model,
        instructions: prompt.instructions,
        input: prompt.input,
        timeoutMs,
      });
      const evaluation = evaluateOutput(testCase, mode, generated.output);
      modeResults.push({
        mode,
        output: generated.output,
        latencyMs: generated.latencyMs,
        wordCount: wordCount(generated.output),
        ...evaluation,
      });
    }

    results.push({
      id: testCase.id,
      group: testCase.group,
      question: testCase.question,
      retrieved,
      contextChars: context.length,
      modeResults,
    });
    console.log(`[${index + 1}/${selectedCases.length}] ${testCase.id} ${modeResults.map((item) => `${item.mode}=score${item.score}/5 flags${item.flags.length}`).join(" ")}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `cs-depth-llm-eval-${stamp}.json`);
  const mdPath = join(outDir, `cs-depth-llm-eval-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify({ generated: new Date().toISOString(), model, userId, results }, null, 2), "utf8");

  const summaryLines = modes.map((mode) => {
    const modeRows = results.flatMap((item) => item.modeResults.filter((result) => result.mode === mode));
    const avgScore = modeRows.reduce((sum, item) => sum + item.score, 0) / Math.max(1, modeRows.length);
    const clean = modeRows.filter((item) => item.flags.length === 0).length;
    const avgLatency = Math.round(modeRows.reduce((sum, item) => sum + item.latencyMs, 0) / Math.max(1, modeRows.length));
    return `| ${mode} | ${avgScore.toFixed(2)}/5 | ${clean}/${modeRows.length} | ${avgLatency}ms |`;
  });

  const lines: string[] = [
    "# CS Depth LLM Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Model: ${model}`,
    `User: ${userId}`,
    `Cases: ${results.length}`,
    "",
    "## Summary",
    "",
    "| Mode | Avg score | Clean cases | Avg latency |",
    "|---|---:|---:|---:|",
    ...summaryLines,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.id}`, "");
    lines.push(`Group: ${result.group}`);
    lines.push(`Question: ${result.question}`);
    lines.push(`Context chars: ${result.contextChars}`);
    lines.push("Retrieved:");
    for (const memory of result.retrieved) {
      lines.push(`- ${memory.sourceRef} | score=${memory.score} | ${memory.title}`);
    }
    lines.push("");
    for (const modeResult of result.modeResults) {
      lines.push(`### ${modeResult.mode}`);
      lines.push(`Score: ${modeResult.score}/5`);
      lines.push(`Latency: ${modeResult.latencyMs}ms`);
      lines.push(`Words: ${modeResult.wordCount}`);
      lines.push(`Matched: ${modeResult.matchedTerms.join(", ") || "none"}`);
      lines.push(`Flags: ${modeResult.flags.join(", ") || "none"}`);
      lines.push("");
      lines.push(modeResult.output);
      lines.push("");
    }
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
