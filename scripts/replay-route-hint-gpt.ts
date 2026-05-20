import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { Conversation } from "../src/server/mastra/types";
import type { ContextSignals } from "../src/server/saynext/context-signals";
import type { ImmediateRuleHint } from "../src/server/saynext/immediate-rule-registry";

type SampleRow = {
  id: number;
  userId: string;
  sessionId: string;
  timestamp: string;
  transcript: string;
  aiReply: string | null;
  actionType: string;
  reasoning: string | null;
  model: string | null;
};

type Candidate = {
  row: SampleRow;
  previousTranscriptTexts: string[];
  hints: ImmediateRuleHint[];
  signals: ContextSignals;
};

type ReplayResult = Candidate & {
  newAction: string;
  newReasoning: string;
  newOutput: string;
  flags: string[];
  verdict: "good" | "watch" | "bad" | "error";
  error?: string;
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

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function compact(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value: string): number {
  const text = compact(value);
  return text ? text.split(/\s+/).length : 0;
}

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function classifyOutput(output: string, candidate: Candidate): { verdict: ReplayResult["verdict"]; flags: string[] } {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  const oldOutput = candidate.row.aiReply || "";

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("label_or_meta_prefix");
  if (/\b(route hint|guard hint|must include|must avoid|do not invent|unless supported memory)\b/i.test(output)) {
    flags.push("leaked_route_hint_language");
  }
  if (/\b(as an ai|the assistant should|this transcript|the speaker is saying|a good response would be)\b/i.test(output)) {
    flags.push("meta_instruction_in_output");
  }
  if (wordCount(output) > 70) flags.push(`too_long:${wordCount(output)}>70`);

  const staleTemplateTerms = [
    "deadline question",
    "send me the list or screenshot",
    "separate what is required",
    "specific photo i would confidently describe",
    "heard the name",
  ];
  if (includesAny(output, staleTemplateTerms)) flags.push("old_template_or_stale_route_leak");

  if (oldOutput && compact(output).toLowerCase() === compact(oldOutput).toLowerCase()) {
    flags.push("same_as_old_output");
  }

  if (candidate.hints.some((hint) => hint.route === "technical_concept")) {
    if (!/\b(linear|classifier|classification|regression|hyperplane|template|weighted|bias|score|class)\b/i.test(output)) {
      flags.push("technical_hint_not_reflected");
    }
  }

  if (candidate.hints.some((hint) => hint.route === "casual")) {
    if (/\b(lambda|dynamodb|joblens|elderalbum|dalparkaid|api gateway|react native)\b/i.test(output)
      && !/\b(lambda|dynamodb|joblens|elderalbum|dalparkaid|api gateway|react native)\b/i.test(candidate.row.transcript)) {
      flags.push("unwanted_project_or_tech_mention");
    }
  }

  const badFlags = new Set([
    "empty_output",
    "label_or_meta_prefix",
    "leaked_route_hint_language",
    "meta_instruction_in_output",
    "old_template_or_stale_route_leak",
    "same_as_old_output",
    "technical_hint_not_reflected",
    "unwanted_project_or_tech_mention",
  ]);
  const verdict = flags.some((flag) => badFlags.has(flag.split(":")[0])) ? "bad" : flags.length ? "watch" : "good";
  return { verdict, flags };
}

function renderHint(hint: ImmediateRuleHint): string {
  const parts = [
    `${hint.id}${hint.route ? ` route=${hint.route}` : ""} category=${hint.category}`,
    ...hint.instructions.map((instruction) => `instruction=${instruction}`),
    hint.mustInclude?.length ? `must_include=${hint.mustInclude.join("; ")}` : "",
    hint.mustAvoid?.length ? `must_avoid=${hint.mustAvoid.join("; ")}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

function primaryHintId(candidate: Candidate): string {
  return candidate.hints[0]?.id || candidate.hints[0]?.route || "unknown";
}

function selectCandidates(candidates: Candidate[], limit: number, mode: string): Candidate[] {
  const safeLimit = Math.max(1, Math.min(limit, candidates.length));
  if (mode === "latest") return candidates.slice(-safeLimit);

  const selected = new Set<Candidate>();
  const seenHintIds = new Set<string>();
  for (const candidate of [...candidates].reverse()) {
    const hintId = primaryHintId(candidate);
    if (seenHintIds.has(hintId)) continue;
    seenHintIds.add(hintId);
    selected.add(candidate);
    if (selected.size >= safeLimit) break;
  }

  if (selected.size < safeLimit) {
    for (const candidate of [...candidates].reverse()) {
      selected.add(candidate);
      if (selected.size >= safeLimit) break;
    }
  }

  return candidates.filter((candidate) => selected.has(candidate));
}

function summarizeCandidateGroups(candidates: Candidate[]): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = primaryHintId(candidate);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => `${id}: ${count}`);
}

async function main(): Promise<void> {
  loadDotEnvFile(join(process.cwd(), ".env"));
  loadDotEnvFile(join(process.cwd(), ".env.local"));

  const dryRun = hasFlag("--dry-run");
  const provider = (argValue("--provider") || process.env.LLM_PROVIDER || "openai").toLowerCase();
  process.env.LLM_PROVIDER = provider;
  if (provider === "openai") {
    process.env.OPENAI_MODEL ||= "gpt-5.4-nano";
    process.env.OPENAI_LONG_MODEL ||= "gpt-5.4-mini";
    process.env.OPENAI_CONVERSATION_STATE_ENABLED ||= "false";
  } else {
    process.env.OLLAMA_MODEL ||= "qwen2.5:14b-instruct";
    process.env.OLLAMA_TIMEOUT_MS ||= "60000";
  }

  if (!dryRun && provider === "openai" && !process.env.OPENAI_API_KEY) {
    console.error("[route-hint-gpt-replay] OPENAI_API_KEY is missing after loading .env/.env.local.");
    console.error("[route-hint-gpt-replay] Run with OPENAI_API_KEY set, or pass --provider=ollama if local Ollama is running.");
    process.exitCode = 1;
    return;
  }

  const [{ buildContextSignals }, { getImmediateDecision }] = await Promise.all([
    import("../src/server/saynext/context-signals"),
    import("../src/server/saynext/immediate-rules"),
  ]);

  const dbPath = argValue("--db") || "data/saynext.sqlite";
  const userId = argValue("--user") || "li2897283405@gmail.com";
  const scanLimit = Number(argValue("--scan-limit") || "160");
  const limit = Number(argValue("--limit") || "8");
  const selectionMode = (argValue("--mode") || "diverse").toLowerCase();
  const outputDir = argValue("--out-dir") || join("data", "review");
  const db = new Database(dbPath, { readonly: true });

  const rowsDesc = db.query(`
    SELECT
      id,
      user_id AS userId,
      session_id AS sessionId,
      timestamp,
      transcript,
      ai_reply AS aiReply,
      action_type AS actionType,
      reasoning,
      model
    FROM conversation_samples
    WHERE user_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(scanLimit, 500))) as SampleRow[];

  const transcriptHistoryBySession = new Map<string, string[]>();
  const candidates: Candidate[] = [];

  for (const row of rowsDesc.reverse()) {
    const previousTranscriptTexts = [...(transcriptHistoryBySession.get(row.sessionId) || [])].slice(-4);
    const decision = getImmediateDecision(row.transcript, new Date(row.timestamp).getTime(), "english", {
      previousTranscriptTexts,
    });
    if (!decision.response && decision.routeHints.length) {
      candidates.push({
        row,
        previousTranscriptTexts,
        hints: decision.routeHints,
        signals: buildContextSignals({ latestTranscript: row.transcript, previousTranscriptTexts }),
      });
    }
    transcriptHistoryBySession.set(row.sessionId, [...previousTranscriptTexts, row.transcript].slice(-4));
  }

  const selected = selectCandidates(candidates, limit, selectionMode);
  const results: ReplayResult[] = [];
  const startedAt = Date.now();

  console.log(`[route-hint-gpt-replay] provider=${provider} model=${provider === "openai" ? process.env.OPENAI_MODEL : process.env.OLLAMA_MODEL} candidates=${candidates.length} selected=${selected.length} mode=${selectionMode}${dryRun ? " dry_run=true" : ""}`);
  console.log(`[route-hint-gpt-replay] candidate groups: ${summarizeCandidateGroups(candidates).join(" | ") || "none"}`);

  if (dryRun) {
    for (const candidate of selected) {
      console.log(`[SELECTED] #${candidate.row.id} ${primaryHintId(candidate)}`);
      console.log(`  transcript: ${compact(candidate.row.transcript).slice(0, 180)}`);
      console.log(`  old: ${compact(candidate.row.aiReply || "").slice(0, 160)}`);
    }
    return;
  }

  const [{ processConversation }, { Action }, { conversationLogger }] = await Promise.all([
    import("../src/server/mastra/agents/initial-agent"),
    import("../src/server/mastra/types"),
    import("../src/server/data/conversation-logger"),
  ]);

  for (const candidate of selected) {
    const transcripts = [...candidate.previousTranscriptTexts, candidate.row.transcript].map(compact).filter(Boolean);
    const timestamp = Date.now();
    const conversation: Conversation = transcripts.map((text, index) => ({
      type: "transcript",
      text,
      timestamp: timestamp - (transcripts.length - index) * 1000,
    }));
    const memoryQuery = transcripts.slice(-4).join("\n");
    const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 4);

    try {
      const response = await processConversation(
        conversation,
        "high",
        undefined,
        "english",
        "",
        "",
        relevantMemory,
      );
      const newOutput = response.type === Action.INSIGHT ? response.output : "";
      const classified = classifyOutput(newOutput, candidate);
      const result: ReplayResult = {
        ...candidate,
        newAction: response.type,
        newReasoning: response.reasoning,
        newOutput,
        flags: classified.flags,
        verdict: classified.verdict,
      };
      results.push(result);
      console.log(`[${result.verdict.toUpperCase()}] #${candidate.row.id} ${candidate.hints.map((hint) => hint.id).join(", ")}`);
      console.log(`  old: ${compact(candidate.row.aiReply || "").slice(0, 140)}`);
      console.log(`  new: ${compact(newOutput).slice(0, 180)}`);
      if (result.flags.length) console.log(`  flags: ${result.flags.join(", ")}`);
    } catch (error) {
      const result: ReplayResult = {
        ...candidate,
        newAction: "error",
        newReasoning: "generation failed",
        newOutput: "",
        flags: ["generation_error"],
        verdict: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.log(`[ERROR] #${candidate.row.id} ${result.error}`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outputDir, `route-hint-gpt-replay-${stamp}.md`);
  const jsonPath = join(outputDir, `route-hint-gpt-replay-${stamp}.json`);
  const counts = {
    good: results.filter((result) => result.verdict === "good").length,
    watch: results.filter((result) => result.verdict === "watch").length,
    bad: results.filter((result) => result.verdict === "bad").length,
    error: results.filter((result) => result.verdict === "error").length,
  };

  const lines = [
    "# Route-Hint GPT Replay",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Provider: ${provider}`,
    `Model: ${provider === "openai" ? process.env.OPENAI_MODEL : process.env.OLLAMA_MODEL}`,
    `Database: ${dbPath}`,
    `User: ${userId}`,
    `Scan limit: ${scanLimit}`,
    `Selection mode: ${selectionMode}`,
    `Route-hint candidates: ${candidates.length}`,
    `Candidate groups: ${summarizeCandidateGroups(candidates).join(" | ") || "none"}`,
    `Replayed: ${results.length}`,
    `Good/watch/bad/error: ${counts.good}/${counts.watch}/${counts.bad}/${counts.error}`,
    `Elapsed sec: ${((Date.now() - startedAt) / 1000).toFixed(1)}`,
    "",
    "Review policy: this is a human review aid. BAD means deterministic red flag such as leaking route-hint language, stale template output, or empty output. WATCH means length/style review.",
    "",
  ];

  for (const result of results) {
    lines.push(`## #${result.row.id} ${result.verdict.toUpperCase()}`);
    lines.push(`- time: ${result.row.timestamp}`);
    lines.push(`- session: ${result.row.sessionId}`);
    lines.push(`- hints: ${result.hints.map(renderHint).join(" || ")}`);
    lines.push(`- transcript: ${result.row.transcript}`);
    lines.push(`- previous_context: ${result.previousTranscriptTexts.join(" | ") || "(none)"}`);
    lines.push(`- old_output: ${result.row.aiReply || ""}`);
    lines.push(`- new_action: ${result.newAction}`);
    lines.push(`- new_reasoning: ${result.newReasoning}`);
    lines.push(`- new_output: ${result.newOutput}`);
    lines.push(`- flags: ${result.flags.join(", ") || "none"}`);
    if (result.error) lines.push(`- error: ${result.error}`);
    lines.push("- feedback_question: Does the new output sound natural and useful, or should this route hint be stricter/looser?");
    lines.push("");
  }

  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

  console.log(`[route-hint-gpt-replay] good=${counts.good} watch=${counts.watch} bad=${counts.bad} error=${counts.error}`);
  console.log(`[route-hint-gpt-replay] report=${mdPath}`);
  console.log(`[route-hint-gpt-replay] json=${jsonPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
