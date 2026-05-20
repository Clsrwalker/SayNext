import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import type { ScenarioResult, ScenarioSpec, TurnResult } from "./eval-llm-simulated-conversations-types";

type EvalJson = {
  scenarios?: ScenarioResult[];
  results?: TurnResult[];
};

type ReplayOutput = {
  action: "insight" | "silent" | "clarify";
  output: string;
  reason: string;
  raw: string;
  error?: string;
};

type CurrentApiOutput = {
  output: string;
  reasoning: string;
  route?: string;
  routeHints: Array<{ id: string; category?: string; route?: string }>;
  rulesFired: string[];
  error?: string;
};

type SelectedTurn = {
  sourceFile: string;
  spec: ScenarioSpec;
  turn: TurnResult;
  previousInputs: string[];
};

type CompareResult = SelectedTurn & {
  current: CurrentApiOutput;
  gptFirst: ReplayOutput;
  xiangVoice: ReplayOutput;
  oldFlags: string[];
  currentFlags: string[];
  gptFirstFlags: string[];
  xiangVoiceFlags: string[];
};

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function argValue(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function compact(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value: string): number {
  const text = compact(value);
  return text ? text.split(/\s+/).length : 0;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function latestEvalJsonFiles(count: number): string[] {
  return readdirSync(join(process.cwd(), "data", "eval"))
    .filter((name) => /^llm-simulated-conversations-.*\.json$/.test(name))
    .map((name) => join(process.cwd(), "data", "eval", name))
    .sort((left, right) => {
      const leftText = basename(left);
      const rightText = basename(right);
      return rightText.localeCompare(leftText);
    })
    .slice(0, Math.max(1, count));
}

function loadEvalTurns(paths: string[]): SelectedTurn[] {
  const selected: SelectedTurn[] = [];
  for (const path of paths) {
    const json = JSON.parse(readFileSync(path, "utf8")) as EvalJson;
    const specById = new Map((json.scenarios || []).map((scenario) => [scenario.spec.id, scenario.spec]));
    const turnsByScenario = new Map<string, TurnResult[]>();
    for (const turn of json.results || []) {
      const turns = turnsByScenario.get(turn.scenarioId) || [];
      turns.push(turn);
      turnsByScenario.set(turn.scenarioId, turns);
    }
    for (const [scenarioId, turns] of turnsByScenario) {
      const spec = specById.get(scenarioId);
      if (!spec) continue;
      const sorted = [...turns].sort((left, right) => left.turn - right.turn);
      for (const turn of sorted) {
        selected.push({
          sourceFile: basename(path),
          spec,
          turn,
          previousInputs: sorted.filter((item) => item.turn < turn.turn).map((item) => item.input).slice(-4),
        });
      }
    }
  }
  return selected;
}

function selectDiverse(turns: SelectedTurn[], limit: number, seed: string): SelectedTurn[] {
  const rng = makeRng(seed);
  const shuffled = turns
    .map((turn) => ({ turn, key: rng() }))
    .sort((left, right) => left.key - right.key)
    .map((item) => item.turn);

  const selected: SelectedTurn[] = [];
  const seenScenes = new Set<string>();
  const seenDomains = new Set<string>();
  for (const item of shuffled) {
    const sceneKey = item.spec.scene;
    const domainKey = item.turn.domain || item.spec.domain || "unknown";
    if (seenScenes.has(sceneKey) && seenDomains.has(domainKey)) continue;
    selected.push(item);
    seenScenes.add(sceneKey);
    seenDomains.add(domainKey);
    if (selected.length >= limit) return selected;
  }
  for (const item of shuffled) {
    if (selected.includes(item)) continue;
    selected.push(item);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

async function callCurrentApi(apiUrl: string, item: SelectedTurn): Promise<CurrentApiOutput> {
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "li2897283405@gmail.com",
        transcript: item.turn.input,
        previousTranscriptTexts: item.previousInputs,
        outputLanguage: "english",
        frequency: "high",
        timestamp: Date.now(),
        activeSceneProfilePrompt: `Scene: ${item.spec.scene}. Situation: ${item.spec.situation}. Style: ${item.spec.style}.`,
        relevantPersonalMemoryContext: "",
      }),
    });
    const json = await response.json() as any;
    return {
      output: compact(json.response?.output || ""),
      reasoning: String(json.response?.reasoning || ""),
      route: json.processTrace?.route,
      routeHints: json.routeHints || [],
      rulesFired: json.processTrace?.rulesFired || [],
      error: json.error,
    };
  } catch (error) {
    return {
      output: "",
      reasoning: "",
      routeHints: [],
      rulesFired: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildGptPrompt(item: SelectedTurn, xiangVoice: boolean): string {
  const recent = item.previousInputs
    .map((text, index) => `${index + 1}. ${compact(text)}`)
    .join("\n") || "No recent transcript context.";
  const spec = item.spec;
  const tags = [
    `scene=${spec.scene}`,
    `other=${spec.otherPerson}`,
    item.turn.domain || spec.domain ? `domain=${item.turn.domain || spec.domain}` : "",
    item.turn.asrSeverity || spec.asrSeverity ? `asr=${item.turn.asrSeverity || spec.asrSeverity}` : "",
    item.turn.interventionPolicy || spec.interventionPolicy ? `intervention=${item.turn.interventionPolicy || spec.interventionPolicy}` : "",
  ].filter(Boolean).join("; ");

  if (xiangVoice) {
    return `You are simulating Xiang Li's live inner voice for a real-time conversation display.

You are not giving advice to Xiang. Output only what Xiang would actually say next, or choose silent.

Self-context:
- Xiang is a Chinese international MACS student at Dalhousie.
- His speech is short, natural, modest, slightly imperfect, and not over-polished.
- He wants to sound clearer and more prepared, but still believable as himself.
- He does not force a reply when silence is more natural.
- Do not volunteer personal/project memory unless the latest utterance directly asks about Xiang, his project, experience, preference, or plan.

Scenario:
${tags}
Situation: ${compact(spec.situation)}
Style: ${compact(spec.style)}

Rules:
- Use latest utterance first; recent context only resolves context and ASR.
- If directly asked, answer in 1-2 short spoken sentences.
- If not addressed or no useful reply is needed, choose silent.
- If unclear, ask one tiny clarification.
- Use plain ASCII punctuation.

Return JSON only:
{"action":"insight|silent|clarify","output":"exact words Xiang would say, empty if silent","reason":"short reason"}

Recent utterances:
${recent}

Latest utterance:
${compact(item.turn.input)}`;
  }

  return `You are SayNext in GPT-first test mode.

Goal: decide what should be shown to Xiang right now with minimum system interference.

Scenario:
${tags}
Situation: ${compact(spec.situation)}
Style: ${compact(spec.style)}

Rules:
- Use latest utterance first. Use recent context only for context, pronouns, and likely ASR mistakes.
- Do not use personal/project facts unless the latest utterance explicitly asks about Xiang, his project, experience, preference, or plan.
- If the latest utterance is only acknowledgement, closing, background filler, or frustration with no useful ask, choose silent or a tiny clarification.
- For classroom/technical/interview/service content, answer the current ask directly and compactly.
- Keep output short and speakable. No markdown. No labels. Use plain ASCII punctuation.

Return JSON only:
{"action":"insight|silent|clarify","output":"text to show, empty if silent","reason":"short reason"}

Recent utterances:
${recent}

Latest utterance:
${compact(item.turn.input)}`;
}

function parseGptJson(raw: string): ReplayOutput {
  const trimmed = raw.trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    const parsed = JSON.parse(jsonText) as any;
    const action = parsed.action === "silent" || parsed.action === "clarify" ? parsed.action : "insight";
    return {
      action,
      output: compact(String(parsed.output || "")),
      reason: compact(String(parsed.reason || "")),
      raw,
    };
  } catch {
    return {
      action: trimmed ? "insight" : "silent",
      output: compact(trimmed),
      reason: "non_json_model_output",
      raw,
    };
  }
}

async function callGpt(agent: Agent<any, any>, item: SelectedTurn, xiangVoice: boolean): Promise<ReplayOutput> {
  try {
    const result = await agent.generate(buildGptPrompt(item, xiangVoice));
    return parseGptJson(result.text);
  } catch (error) {
    return {
      action: "silent",
      output: "",
      reason: "openai_error",
      raw: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function outputFlags(spec: ScenarioSpec, output: string, action = "insight"): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  if (action !== "silent" && !output) flags.push("empty_output");
  if (wordCount(output) > 70) flags.push(`too_long:${wordCount(output)}`);
  if (/\b(route hint|must include|must avoid|as an ai|the assistant should|the transcript says|xiang should)\b/i.test(output)) {
    flags.push("meta_output");
  }
  for (const rejected of spec.rejectAny || []) {
    if (rejected && normalized.includes(rejected.toLowerCase())) flags.push(`reject:${rejected}`);
  }
  if (spec.expectAny?.length && action !== "silent") {
    const matched = spec.expectAny.some((term) => normalized.includes(term.toLowerCase()));
    if (!matched) flags.push(`missing_expect_any:${spec.expectAny.slice(0, 4).join("|")}`);
  }
  if (spec.shouldAvoidPersonal && /\b(xiang|dalhousie|saynext|my project|my family|my school|my experience)\b/i.test(output)) {
    flags.push("personal_context_leak");
  }
  return flags;
}

function routeNoiseFlags(current: CurrentApiOutput): string[] {
  const hintIds = current.routeHints.map((hint) => hint.id).join(" ");
  const flags: string[] = [];
  if (/\bmentor|book|misinformation|ai-jobs|hybrid-search|serverless|case-follow-up|failure-debug|photo|childhood|weekend|food|localized\b/i.test(hintIds)) {
    flags.push(`route_hint_noise:${hintIds}`);
  }
  return flags;
}

function renderResult(item: CompareResult): string[] {
  return [
    `## ${item.turn.scenarioId} / turn ${item.turn.turn}`,
    "",
    `Source: ${item.sourceFile}`,
    `Scene: ${item.spec.scene}; domain=${item.turn.domain || item.spec.domain || "unknown"}; asr=${item.turn.asrSeverity || item.spec.asrSeverity || "unknown"}`,
    `Other: ${item.spec.otherPerson}`,
    `Situation: ${compact(item.spec.situation)}`,
    `Latest: ${compact(item.turn.input)}`,
    `Previous: ${item.previousInputs.map(compact).join(" | ") || "none"}`,
    "",
    `Old eval output: ${compact(item.turn.output) || "(empty)"}`,
    `Old flags: ${item.oldFlags.join(", ") || "none"}`,
    `Old route: ${item.turn.processTrace?.route || "unknown"}; rules=${item.turn.processTrace?.rulesFired?.join(" | ") || "none"}`,
    "",
    `Current API: ${item.current.output || "(empty)"}`,
    `Current flags: ${item.currentFlags.join(", ") || "none"}`,
    `Current route: ${item.current.route || "unknown"}; hints=${item.current.routeHints.map((hint) => hint.id).join(" | ") || "none"}`,
    "",
    `GPT-first: [${item.gptFirst.action}] ${item.gptFirst.output || "(empty)"}`,
    `GPT-first flags: ${item.gptFirstFlags.join(", ") || "none"}`,
    `GPT-first reason: ${item.gptFirst.reason || "(empty)"}`,
    "",
    `Xiang-voice: [${item.xiangVoice.action}] ${item.xiangVoice.output || "(empty)"}`,
    `Xiang-voice flags: ${item.xiangVoiceFlags.join(", ") || "none"}`,
    `Xiang-voice reason: ${item.xiangVoice.reason || "(empty)"}`,
    "",
  ];
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));
  if (!process.env.OPENAI_API_KEY) {
    console.error("[compare-gpt-first-simulated-eval] OPENAI_API_KEY is missing.");
    process.exitCode = 1;
    return;
  }

  const input = argValue("--input");
  const latest = Number(argValue("--latest") || (input ? "0" : "3"));
  const paths = input
    ? input.split(",").map((item) => item.trim()).filter(Boolean)
    : latestEvalJsonFiles(latest);
  const limit = Number(argValue("--limit") || argValue("--random") || "24");
  const seed = argValue("--seed") || "simulated-gpt-first";
  const apiUrl = argValue("--api") || "http://localhost:3107/api/debug/saynext-replay";
  const model = argValue("--model") || process.env.OPENAI_MODEL || "gpt-5.4-nano";
  const outDir = argValue("--out-dir") || join(process.cwd(), "data", "review");

  const turns = selectDiverse(loadEvalTurns(paths), limit, seed);
  const agent = new Agent({
    name: "SayNextSimulatedGptFirstCompare",
    model: openai(model),
    instructions: "Return only valid JSON for the requested schema. No markdown.",
  });

  const results: CompareResult[] = [];
  for (const [index, item] of turns.entries()) {
    const [current, gptFirst, xiangVoice] = await Promise.all([
      callCurrentApi(apiUrl, item),
      callGpt(agent, item, false),
      callGpt(agent, item, true),
    ]);
    const oldFlags = outputFlags(item.spec, item.turn.output, item.turn.output ? "insight" : "silent");
    const currentFlags = [...routeNoiseFlags(current), ...outputFlags(item.spec, current.output, current.output ? "insight" : "silent")];
    const gptFirstFlags = outputFlags(item.spec, gptFirst.output, gptFirst.action);
    const xiangVoiceFlags = outputFlags(item.spec, xiangVoice.output, xiangVoice.action);
    results.push({ ...item, current, gptFirst, xiangVoice, oldFlags, currentFlags, gptFirstFlags, xiangVoiceFlags });
    console.log(`[${index + 1}/${turns.length}] ${item.turn.scenarioId}#${item.turn.turn} old=${oldFlags.length} current=${currentFlags.length} gpt=${gptFirstFlags.length} xiang=${xiangVoiceFlags.length}`);
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `gpt-first-vs-simulated-eval-${stamp}.md`);
  const jsonPath = join(outDir, `gpt-first-vs-simulated-eval-${stamp}.json`);
  const countFlagged = (key: keyof Pick<CompareResult, "oldFlags" | "currentFlags" | "gptFirstFlags" | "xiangVoiceFlags">) =>
    results.filter((item) => item[key].length).length;
  const countSilent = (key: "gptFirst" | "xiangVoice") =>
    results.filter((item) => item[key].action === "silent").length;

  const lines = [
    "# GPT-First vs Previous LLM Simulated Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Sources: ${paths.map((path) => basename(path)).join(", ")}`,
    `Model: ${model}`,
    `Current API: ${apiUrl}`,
    `Selection: diverse random limit=${limit} seed=${seed}`,
    `Turns: ${results.length}`,
    `Old eval flagged rows: ${countFlagged("oldFlags")}`,
    `Current API flagged rows: ${countFlagged("currentFlags")}`,
    `GPT-first flagged rows: ${countFlagged("gptFirstFlags")}`,
    `GPT-first silent rows: ${countSilent("gptFirst")}`,
    `Xiang-voice flagged rows: ${countFlagged("xiangVoiceFlags")}`,
    `Xiang-voice silent rows: ${countSilent("xiangVoice")}`,
    "",
    "Policy: flags are only deterministic review aids based on scenario expect/reject fields and generic meta/length checks. Use this report for manual comparison.",
    "",
    ...results.flatMap(renderResult),
  ];

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ sources: paths, results }, null, 2), "utf8");
  console.log(`[compare-gpt-first-simulated-eval] Wrote ${mdPath}`);
  console.log(`[compare-gpt-first-simulated-eval] Wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
