import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

type SampleRow = {
  id: number;
  userId: string;
  sessionId: string;
  timestamp: string;
  transcript: string;
  aiReply: string | null;
  reasoning: string | null;
};

type CurrentApiResult = {
  status: number;
  output: string;
  reasoning: string;
  routeHints: Array<{ id: string; category?: string; route?: string }>;
  route?: string;
  rulesFired: string[];
  error?: string;
};

type GptFirstResult = {
  action: "insight" | "silent" | "clarify";
  output: string;
  reason: string;
  raw: string;
  error?: string;
};

type ReplayResult = {
  row: SampleRow;
  previousTranscriptTexts: string[];
  current: CurrentApiResult;
  gptFirst: GptFirstResult;
  xiangVoice: GptFirstResult;
  currentFlags: string[];
  gptFirstFlags: string[];
  xiangVoiceFlags: string[];
};

const DEFAULT_IDS = [
  3229, 3234, 3235, 3240, 3245, 3252, 3368,
  3539, 3540, 3544, 3549, 3552, 3554, 3555, 3556, 3565, 3566, 3567, 3568,
];

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

function parseIds(value: string | undefined): number[] {
  if (!value) return DEFAULT_IDS;
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
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

function getPreviousTranscriptTexts(db: Database, row: SampleRow, count: number): string[] {
  const rows = db.query(`
    SELECT transcript
    FROM conversation_samples
    WHERE session_id = ? AND timestamp < ? AND transcript IS NOT NULL AND transcript != ''
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(row.sessionId, row.timestamp, count) as Array<{ transcript: string }>;

  return rows.reverse().map((item) => item.transcript);
}

function loadRows(db: Database, ids: number[]): SampleRow[] {
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.query(`
    SELECT
      id,
      user_id AS userId,
      session_id AS sessionId,
      timestamp,
      transcript,
      ai_reply AS aiReply,
      reasoning
    FROM conversation_samples
    WHERE id IN (${placeholders})
    ORDER BY timestamp ASC
  `).all(...ids) as SampleRow[];

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is SampleRow => Boolean(row));
}

function loadRandomRows(db: Database, params: {
  count: number;
  scanLimit: number;
  seed: string;
  userId?: string;
}): SampleRow[] {
  const userWhere = params.userId ? "AND user_id = ?" : "";
  const queryParams: Array<string | number> = params.userId
    ? [params.userId, params.scanLimit]
    : [params.scanLimit];
  const rows = db.query(`
    SELECT
      id,
      user_id AS userId,
      session_id AS sessionId,
      timestamp,
      transcript,
      ai_reply AS aiReply,
      reasoning
    FROM conversation_samples
    WHERE transcript IS NOT NULL AND transcript != '' ${userWhere}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...queryParams) as SampleRow[];

  const eligible = rows
    .filter((row) => wordCount(row.transcript) >= 2)
    .reverse();
  const rng = makeRng(params.seed);
  const shuffled = eligible.map((row) => ({ row, key: rng() }))
    .sort((left, right) => left.key - right.key)
    .map((item) => item.row);
  return shuffled.slice(0, Math.max(1, Math.min(params.count, shuffled.length)))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

async function callCurrentApi(params: {
  apiUrl: string;
  row: SampleRow;
  previousTranscriptTexts: string[];
}): Promise<CurrentApiResult> {
  try {
    const response = await fetch(params.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.row.userId,
        transcript: params.row.transcript,
        previousTranscriptTexts: params.previousTranscriptTexts,
        outputLanguage: "english",
        frequency: "high",
        timestamp: new Date(params.row.timestamp).getTime(),
        // Keep this replay focused on transcript/context behavior, not personal memory retrieval.
        relevantPersonalMemoryContext: "",
      }),
    });
    const json = await response.json() as any;
    return {
      status: response.status,
      output: compact(json.response?.output || ""),
      reasoning: String(json.response?.reasoning || ""),
      routeHints: json.routeHints || [],
      route: json.processTrace?.route,
      rulesFired: json.processTrace?.rulesFired || [],
      error: json.error,
    };
  } catch (error) {
    return {
      status: 0,
      output: "",
      reasoning: "",
      routeHints: [],
      rulesFired: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildGptFirstPrompt(row: SampleRow, previousTranscriptTexts: string[]): string {
  const recent = previousTranscriptTexts
    .map((text, index) => `${index + 1}. ${compact(text)}`)
    .join("\n") || "No recent transcript context.";

  return `You are SayNext in GPT-first test mode.

Goal: decide what should be shown to Xiang right now, with minimum system interference.

Rules:
- Use the latest transcript first. Use recent transcript only to resolve context, pronouns, and likely ASR mistakes.
- Do not use personal memory or project facts unless the latest transcript explicitly asks about Xiang, his project, his experience, or his preferences.
- If the latest transcript is just an acknowledgement, closing, background filler, or pure frustration with no useful ask, choose "silent" or a very short clarification.
- For classroom lecture content:
  - if there is a direct question, answer it directly;
  - if the teacher just stated a core concept/formula, give one compact note or useful supplement;
  - if it is only transition/filler, choose "silent".
- Interpret obvious ASR using context, but do not overcorrect if uncertain.
- Keep output short and speakable. No markdown. No labels in the output.
- Use plain ASCII punctuation.

Return JSON only:
{"action":"insight|silent|clarify","output":"text to show, empty if silent","reason":"short reason"}

Recent transcript context:
${recent}

Latest transcript:
${compact(row.transcript)}`;
}

function buildXiangVoicePrompt(row: SampleRow, previousTranscriptTexts: string[]): string {
  const recent = previousTranscriptTexts
    .map((text, index) => `${index + 1}. ${compact(text)}`)
    .join("\n") || "No recent transcript context.";

  return `You are simulating Xiang Li's live inner voice for a real-time conversation display.

You are not giving advice to Xiang. You are deciding what Xiang would actually say next, or whether he would stay silent.

Private self-context:
- Xiang is a Chinese international MACS student at Dalhousie.
- His live speaking style is short, natural, modest, slightly imperfect, and not over-polished.
- He wants to sound calmer, clearer, and more prepared, but still believable as himself.
- He is introverted and does not force conversation when there is no useful reason to speak.
- Personal/project memory is private self-context. Do not volunteer it unless the latest transcript directly asks about Xiang, his project, his experience, his preference, or his plan.

Decision rules:
- Use the latest transcript as the main reality. Use recent transcript only for context and ASR correction.
- If Xiang would naturally say nothing, choose "silent" and leave output empty.
- If Xiang is directly asked a classroom or technical question, answer it as a capable student in 1-2 short spoken sentences.
- If a teacher just explained a formula/concept, output one compact note or useful supplement only if it would help Xiang.
- If the latest transcript is frustration, filler, acknowledgement, or unclear noise, stay silent or ask one tiny clarification.
- Do not mention that you are an assistant, a model, or SayNext.
- Use plain ASCII punctuation.

Return JSON only:
{"action":"insight|silent|clarify","output":"exact words Xiang would say, empty if silent","reason":"short reason"}

Recent transcript context:
${recent}

Latest transcript:
${compact(row.transcript)}`;
}

function parseGptJson(raw: string): GptFirstResult {
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

function makeGptFirstAgent(model: string): Agent<any, any> {
  return new Agent({
    name: "SayNextGptFirstReplay",
    model: openai(model),
    instructions: "Return only valid JSON for the user's requested schema. Do not add markdown.",
  });
}

async function callGptFirst(agent: Agent<any, any>, row: SampleRow, previousTranscriptTexts: string[]): Promise<GptFirstResult> {
  try {
    const result = await agent.generate(buildGptFirstPrompt(row, previousTranscriptTexts));
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

async function callXiangVoice(agent: Agent<any, any>, row: SampleRow, previousTranscriptTexts: string[]): Promise<GptFirstResult> {
  try {
    const result = await agent.generate(buildXiangVoicePrompt(row, previousTranscriptTexts));
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

function expectedFlags(id: number, output: string, action = "insight"): string[] {
  const flags: string[] = [];
  const text = output.toLowerCase();

  if (action !== "silent" && !output) flags.push("empty_output");
  if (wordCount(output) > 55) flags.push(`too_long:${wordCount(output)}`);
  if (/\b(route hint|must include|must avoid|as an ai|the transcript says)\b/i.test(output)) flags.push("meta_output");

  const has = (pattern: RegExp) => pattern.test(text);
  const lacks = (pattern: RegExp, label: string) => {
    if (!has(pattern)) flags.push(`missing:${label}`);
  };
  const avoids = (pattern: RegExp, label: string) => {
    if (has(pattern)) flags.push(`wrong_domain:${label}`);
  };

  switch (id) {
    case 3229:
      lacks(/\b(item[- ]item|similarity|co[- ]purchase|semantics?|user intent|weak|narrow)\b/i, "item_similarity_limit");
      avoids(/\bmisinformation|verify the source|reliable sources|emotional posts?\b/i, "misinformation_template");
      break;
    case 3234:
      lacks(/\b(social graph|nearby|similar users|friends?|people near|not what.*want|preference)\b/i, "social_preference_bias");
      avoids(/\bmr\.?\s*jiang|study abroad|mentor\b/i, "mentor_personal_memory");
      break;
    case 3240:
      lacks(/\b(comput|storage|matrix|pairwise|scale|latency|memory|expensive|o\(?n|millions?)\b/i, "computation_or_storage_limit");
      avoids(/\bcoverage|recall|filter quality|heuristic quality|shift\b/i, "condition_limit_answer");
      break;
    case 3245:
      lacks(/\b(cold start|new user|new item|no history|little interaction|interaction data|content[- ]based|metadata)\b/i, "recommender_cold_start");
      avoids(/\blambda|serverless|warm resources?|runtime|function\b/i, "serverless_cold_start");
      break;
    case 3252:
      lacks(/\b(similarity matrix|storage|memory|pairwise|precompute|serve|latency|io|cpu|millions?)\b/i, "similarity_matrix_bottleneck");
      break;
    case 3368:
      lacks(/\b(embedding|matrix factorization|optimization|scal|train|latent|als|loss)\b/i, "book_recommendation_ml_task");
      avoids(/\bnonfiction|read books?|novel|recommend a book|reading history\b/i, "casual_book_template");
      break;
    case 3539:
      lacks(/\b(weight|business goal|vip|paying|purchase|precision|interaction)\b/i, "business_weighting");
      avoids(/\bjobs?|career|ai replacing|anxiety\b/i, "career_anxiety_template");
      break;
    case 3540:
      lacks(/\b(user bias|item bias|rating|harsh|generous|systematic|popularity|baseline)\b/i, "bias_terms_usefulness");
      if (/^hey[.!]?$/i.test(output.trim())) flags.push("empty_greeting_answer");
      break;
    case 3544:
      lacks(/\b(matchbox|trainable mapping|matrix|translate|embedding|pretrained|external)\b/i, "matchbox_mapping");
      avoids(/\bcareer|interview|resume\b/i, "career_route");
      break;
    case 3549:
      lacks(/\b(one[- ]class|positive|unobserved|missing|negative|weight|implicit|collaborative)\b/i, "one_class_cf_weighting");
      avoids(/\bhybrid search|retrieved chunk|faithfulness|latency\b/i, "hybrid_search_template");
      break;
    case 3552:
      lacks(/\bbayes|p\s*\(|conditional|flip|posterior|probability\b/i, "bayes_rule");
      avoids(/\bbase rule|baseline recommender|training weights|missing data as negative\b/i, "base_rule_misread");
      break;
    case 3554:
    case 3555:
    case 3556:
      lacks(/\b(log|probability|posterior|gaussian|sum|loss|regularization|embedding)\b/i, "math_log_probability");
      avoids(/\berror line|request id|timestamp|cloudwatch|debug\b/i, "debug_log_template");
      break;
    case 3565:
    case 3566:
    case 3567:
    case 3568:
      avoids(/\berror line|request id|timestamp|cloudwatch|exact log lines|what step.*running|pinpoint where it broke\b/i, "debug_log_template");
      break;
  }

  return flags;
}

function classifyRouteNoise(result: CurrentApiResult): string[] {
  const flags: string[] = [];
  const hintIds = result.routeHints.map((hint) => hint.id).join(" ");
  if (/\bmentor|book|misinformation|ai-jobs|hybrid-search|serverless|case-follow-up|failure-debug\b/i.test(hintIds)) {
    flags.push(`route_hint_noise:${hintIds}`);
  }
  if (/\bservice_admin|career_pitch|tech_debug|casual\b/.test(result.route || "")
    && /\bfeedback|address|cold|log\b/i.test(result.rulesFired.join(" "))) {
    flags.push(`route_keyword_noise:${result.route}`);
  }
  return flags;
}

function renderResult(result: ReplayResult): string[] {
  const lines = [
    `## #${result.row.id}`,
    `- time: ${result.row.timestamp}`,
    `- transcript: ${compact(result.row.transcript)}`,
    `- previous_context: ${result.previousTranscriptTexts.map(compact).join(" | ") || "none"}`,
    `- old_vps: ${compact(result.row.aiReply || "") || "(empty)"}`,
    `- current_route: ${result.current.route || "unknown"}`,
    `- current_hints: ${result.current.routeHints.map((hint) => `${hint.id}:${hint.category || ""}->${hint.route || ""}`).join(", ") || "none"}`,
    `- current_output: ${result.current.output || "(empty)"}`,
    `- current_flags: ${result.currentFlags.join(", ") || "none"}`,
    `- gpt_first_action: ${result.gptFirst.action}`,
    `- gpt_first_output: ${result.gptFirst.output || "(empty)"}`,
    `- gpt_first_reason: ${result.gptFirst.reason || "(empty)"}`,
    `- gpt_first_flags: ${result.gptFirstFlags.join(", ") || "none"}`,
    `- xiang_voice_action: ${result.xiangVoice.action}`,
    `- xiang_voice_output: ${result.xiangVoice.output || "(empty)"}`,
    `- xiang_voice_reason: ${result.xiangVoice.reason || "(empty)"}`,
    `- xiang_voice_flags: ${result.xiangVoiceFlags.join(", ") || "none"}`,
  ];
  if (result.current.error) lines.push(`- current_error: ${result.current.error}`);
  if (result.gptFirst.error) lines.push(`- gpt_first_error: ${result.gptFirst.error}`);
  if (result.xiangVoice.error) lines.push(`- xiang_voice_error: ${result.xiangVoice.error}`);
  lines.push("");
  return lines;
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));

  if (!process.env.OPENAI_API_KEY) {
    console.error("[compare-gpt-first-api-replay] OPENAI_API_KEY is missing.");
    process.exitCode = 1;
    return;
  }

  const dbPath = argValue("--db") || "data/saynext.sqlite";
  const apiUrl = argValue("--api") || "http://localhost:3107/api/debug/saynext-replay";
  const model = argValue("--model") || process.env.OPENAI_MODEL || "gpt-5.4-nano";
  const randomCount = Number(argValue("--random") || "0");
  const scanLimit = Number(argValue("--scan-limit") || "500");
  const seed = argValue("--seed") || "gpt-first-random";
  const userId = argValue("--user");
  const ids = parseIds(argValue("--ids"));
  const outDir = argValue("--out-dir") || join("data", "review");
  const db = new Database(dbPath, { readonly: true });
  const rows = randomCount > 0
    ? loadRandomRows(db, {
      count: randomCount,
      scanLimit: Math.max(randomCount, scanLimit),
      seed,
      userId,
    })
    : loadRows(db, ids);
  const agent = makeGptFirstAgent(model);

  if (!rows.length) {
    console.error(randomCount > 0
      ? `[compare-gpt-first-api-replay] No random rows found.`
      : `[compare-gpt-first-api-replay] No rows found for ids: ${ids.join(",")}`);
    process.exitCode = 1;
    return;
  }

  const results: ReplayResult[] = [];
  for (const [index, row] of rows.entries()) {
    const previousTranscriptTexts = getPreviousTranscriptTexts(db, row, 4);
    const [current, gptFirst, xiangVoice] = await Promise.all([
      callCurrentApi({ apiUrl, row, previousTranscriptTexts }),
      callGptFirst(agent, row, previousTranscriptTexts),
      callXiangVoice(agent, row, previousTranscriptTexts),
    ]);

    const currentFlags = [
      ...classifyRouteNoise(current),
      ...expectedFlags(row.id, current.output, current.output ? "insight" : "silent"),
    ];
    const gptFirstFlags = expectedFlags(row.id, gptFirst.output, gptFirst.action);
    const xiangVoiceFlags = expectedFlags(row.id, xiangVoice.output, xiangVoice.action);
    results.push({ row, previousTranscriptTexts, current, gptFirst, xiangVoice, currentFlags, gptFirstFlags, xiangVoiceFlags });

    console.log(`[${index + 1}/${rows.length}] #${row.id} currentFlags=${currentFlags.length} gptFirstFlags=${gptFirstFlags.length} xiangVoiceFlags=${xiangVoiceFlags.length}`);
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `gpt-first-vs-current-api-replay-${stamp}`;
  const jsonPath = join(outDir, `${baseName}.json`);
  const mdPath = join(outDir, `${baseName}.md`);

  const currentBad = results.filter((item) => item.currentFlags.length).length;
  const gptFirstBad = results.filter((item) => item.gptFirstFlags.length).length;
  const xiangVoiceBad = results.filter((item) => item.xiangVoiceFlags.length).length;
  const currentRouteNoise = results.filter((item) => item.currentFlags.some((flag) => flag.startsWith("route_"))).length;
  const gptFirstSilent = results.filter((item) => item.gptFirst.action === "silent").length;
  const xiangVoiceSilent = results.filter((item) => item.xiangVoice.action === "silent").length;

  const lines = [
    "# GPT-First vs Xiang Voice vs Current API Replay",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Database: ${dbPath}`,
    `Current API: ${apiUrl}`,
    `GPT-first model: ${model}`,
    randomCount > 0 ? `Selection: random count=${randomCount} scanLimit=${scanLimit} seed=${seed}${userId ? ` user=${userId}` : ""}` : `Selection: ids=${rows.map((row) => row.id).join(",")}`,
    `Rows: ${results.length}`,
    `Current flagged rows: ${currentBad}`,
    `Current route-noise rows: ${currentRouteNoise}`,
    `GPT-first flagged rows: ${gptFirstBad}`,
    `GPT-first silent rows: ${gptFirstSilent}`,
    `Xiang-voice flagged rows: ${xiangVoiceBad}`,
    `Xiang-voice silent rows: ${xiangVoiceSilent}`,
    "",
    "Policy: this is an A/B review aid. Flags are deterministic heuristics for known classroom failures; human review still decides final quality.",
    "",
    ...results.flatMap(renderResult),
  ];

  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  writeFileSync(mdPath, lines.join("\n"));
  console.log(`[compare-gpt-first-api-replay] Wrote ${mdPath}`);
  console.log(`[compare-gpt-first-api-replay] Wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
