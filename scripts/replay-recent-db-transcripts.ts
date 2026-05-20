import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { buildContextSignals } from "../src/server/saynext/context-signals";
import { getImmediateDecision } from "../src/server/saynext/immediate-rules";

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

type ReplayResult = {
  row: SampleRow;
  previousTranscriptTexts: string[];
  oldFailure: string | null;
  newAction: "silent" | "insight" | "route_hint" | "defer_to_model" | "route";
  newReasoning: string | null;
  newOutput: string | null;
  signals: ReturnType<typeof buildContextSignals>;
  improvement: string | null;
};

function argValue(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function classifyOldFailure(row: SampleRow): string | null {
  const transcript = row.transcript.trim();
  const normalizedOutput = normalize(row.aiReply || "");
  const isShortAck = /^(ok|okay|yeah|yep|yes|no|nope|thanks|thank you|thanks so much|that's fine|that is fine|hello|hi|happy)[.!?,\s]*$/i.test(transcript);
  const hasStaleTechnicalOutput = hasAny(normalizedOutput, [
    /linear classifier/,
    /high-dimensional/,
    /hyperplane/,
    /classifiers?/,
    /template image/,
  ]);

  if (isShortAck && hasStaleTechnicalOutput) return "context_stale_no_intervention_missing";
  if (/^(hello|hi|hey)[.!?,\s]*$/i.test(transcript) && /heard the name|enough context/i.test(row.aiReply || "")) {
    return "route_misfire_greeting_as_name";
  }
  return null;
}

function main(): void {
  const dbPath = argValue("--db") || "data/saynext.sqlite";
  const userId = argValue("--user") || "li2897283405@gmail.com";
  const limit = Number(argValue("--limit") || "40");
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
  `).all(userId, Math.max(1, Math.min(limit, 200))) as SampleRow[];

  const rows = rowsDesc.reverse();
  const transcriptHistoryBySession = new Map<string, string[]>();
  const results: ReplayResult[] = [];

  for (const row of rows) {
    const previousTranscriptTexts = [...(transcriptHistoryBySession.get(row.sessionId) || [])].slice(-4);
    const decision = getImmediateDecision(row.transcript, new Date(row.timestamp).getTime(), "english", {
      previousTranscriptTexts,
    });
    const response = decision.response;
    const signals = buildContextSignals({
      latestTranscript: row.transcript,
      previousTranscriptTexts,
    });
    const oldFailure = classifyOldFailure(row);
    const newAction = response?.type || (decision.routeHints.length ? "route_hint" : "defer_to_model");
    const newOutput = response?.type === "insight" ? response.output : null;
    const improvement = oldFailure && newAction === "silent"
      ? "fixed_by_fast_silent_decision"
      : oldFailure && oldFailure === "route_misfire_greeting_as_name" && newAction !== "insight"
        ? "fixed_by_not_treating_greeting_as_name"
        : null;

    results.push({
      row,
      previousTranscriptTexts,
      oldFailure,
      newAction,
      newReasoning: response?.reasoning || (decision.routeHints.length ? `Route hints: ${decision.routeHints.map((hint) => hint.id).join(", ")}` : null),
      newOutput,
      signals,
      improvement,
    });

    const nextHistory = [...previousTranscriptTexts, row.transcript].slice(-4);
    transcriptHistoryBySession.set(row.sessionId, nextHistory);
  }

  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outputDir, `recent-db-fast-replay-${stamp}.md`);
  const jsonPath = join(outputDir, `recent-db-fast-replay-${stamp}.json`);
  const oldFailureCount = results.filter((result) => result.oldFailure).length;
  const improvementCount = results.filter((result) => result.improvement).length;
  const silentCount = results.filter((result) => result.newAction === "silent").length;
  const hintCount = results.filter((result) => result.newAction === "route_hint").length;
  const deferCount = results.filter((result) => result.newAction === "defer_to_model").length;
  const insightCount = results.filter((result) => result.newAction === "insight").length;

  const lines = [
    "# Recent DB Fast Replay",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Database: ${dbPath}`,
    `User: ${userId}`,
    `Limit: ${limit}`,
    "",
    "This replay uses real DB transcripts and only the fast deterministic layer. It does not call GPT.",
    "",
    `Summary: rows=${results.length} old_failure=${oldFailureCount} improved=${improvementCount} new_silent=${silentCount} new_route_hint=${hintCount} new_defer_to_model=${deferCount} new_insight=${insightCount}`,
    "",
  ];

  for (const result of [...results].reverse()) {
    if (!result.oldFailure && result.newAction !== "silent" && result.newAction !== "route_hint") continue;
    lines.push(`## #${result.row.id} ${result.improvement || result.oldFailure || result.newAction}`);
    lines.push(`- time: ${result.row.timestamp}`);
    lines.push(`- session: ${result.row.sessionId}`);
    lines.push(`- transcript: ${result.row.transcript}`);
    lines.push(`- previous_context: ${result.previousTranscriptTexts.join(" | ") || "(none)"}`);
    lines.push(`- old_action: ${result.row.actionType}`);
    lines.push(`- old_output: ${result.row.aiReply || ""}`);
    lines.push(`- old_reasoning: ${result.row.reasoning || ""}`);
    lines.push(`- old_failure: ${result.oldFailure || ""}`);
    lines.push(`- new_action: ${result.newAction}`);
    lines.push(`- new_reasoning: ${result.newReasoning || ""}`);
    lines.push(`- new_output: ${result.newOutput || ""}`);
    lines.push(`- signals: word_count=${result.signals.latestWordCount} backchannel=${result.signals.latestIsBackchannel} closing=${result.signals.latestIsClosing} greeting=${result.signals.latestIsGreeting} question=${result.signals.latestIsQuestion} concrete_task=${result.signals.latestHasConcreteTask} likely_no_display=${result.signals.likelyNoDisplay}`);
    lines.push("");
  }

  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

  console.log(`[recent-db-fast-replay] rows=${results.length} old_failure=${oldFailureCount} improved=${improvementCount} new_silent=${silentCount} new_route_hint=${hintCount} new_defer_to_model=${deferCount} new_insight=${insightCount}`);
  console.log(`[recent-db-fast-replay] report=${mdPath}`);
  console.log(`[recent-db-fast-replay] json=${jsonPath}`);
  for (const result of results.filter((item) => item.oldFailure || item.improvement).slice(-8)) {
    console.log(JSON.stringify({
      id: result.row.id,
      transcript: result.row.transcript,
      oldFailure: result.oldFailure,
      oldOutput: result.row.aiReply,
      newAction: result.newAction,
      newReasoning: result.newReasoning,
      improvement: result.improvement,
    }));
  }
}

main();
