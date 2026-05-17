import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import {
  buildSessionMemorySource,
  extractSessionMemoryCandidatesFromText,
  type ExtractSessionMemoryFromTextOutput,
  type ExtractedSessionMemoryCandidate,
} from "../src/server/memory/session-memory-extractor";

type ReviewMode = "manual_only" | "auto_safe_knowledge" | "review_all";

type ModeSummary = {
  mode: ReviewMode;
  pending: number;
  rejected: number;
  promoted: number;
  promotedTitles: string[];
};

type SessionEval = {
  sessionId: string;
  title: string;
  transcriptCount: number;
  aiReplyCount: number;
  scenes: string[];
  transcriptChars: number;
  aiOutputChars: number;
  output?: ExtractSessionMemoryFromTextOutput;
  modes: ModeSummary[];
  flags: string[];
  error?: string;
};

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const userId = positional[0] || "li2897283405@gmail.com";
const explicitSessionId = positional[1] && positional[1] !== "--latest" ? positional[1] : "";
const provider = args.find((arg) => arg.startsWith("--provider="))?.slice("--provider=".length) === "ollama" ? "ollama" : "openai";
const sessionCount = Math.max(1, Math.min(10, Number(args.find((arg) => arg.startsWith("--sessions="))?.slice("--sessions=".length) || (explicitSessionId ? 1 : 3))));
const limitCandidates = Math.max(1, Math.min(20, Number(args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) || 10)));
const maxCharsArg = args.find((arg) => arg.startsWith("--max-chars="))?.slice("--max-chars=".length);
const maxTranscriptChars = maxCharsArg ? Number(maxCharsArg) : undefined;
const minTranscripts = Math.max(1, Number(args.find((arg) => arg.startsWith("--min-transcripts="))?.slice("--min-transcripts=".length) || 1));
const explicitSessionIds = args
  .find((arg) => arg.startsWith("--session-ids="))
  ?.slice("--session-ids=".length)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean) ?? [];
const now = new Date().toISOString().replace(/[:.]/g, "-");

function truncate(text: string, length = 360): string {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length)}...` : compact;
}

function parseValidationFlags(candidate: ExtractedSessionMemoryCandidate): string[] {
  return candidate.validation.flags || [];
}

function simulateMode(candidates: ExtractedSessionMemoryCandidate[], mode: ReviewMode): ModeSummary {
  let pending = 0;
  let rejected = 0;
  let promoted = 0;
  const promotedTitles: string[] = [];

  for (const item of candidates) {
    if (mode === "review_all") {
      pending += 1;
      continue;
    }

    if (!item.validation.valid) {
      rejected += 1;
      continue;
    }

    if (mode === "auto_safe_knowledge" && item.validation.safeToPromote && item.candidate.candidateType === "knowledge_fact") {
      promoted += 1;
      promotedTitles.push(item.candidate.title);
      continue;
    }

    pending += 1;
  }

  return { mode, pending, rejected, promoted, promotedTitles };
}

function looksLikeAiOutputLeak(item: ExtractedSessionMemoryCandidate): boolean {
  return parseValidationFlags(item).includes("looks_derived_from_ai_output");
}

function looksLikeThirdPartyPersonalLeak(item: ExtractedSessionMemoryCandidate): boolean {
  return parseValidationFlags(item).some((flag) => [
    "personal_candidate_without_xiang_anchor",
    "project_detail_without_known_xiang_anchor",
    "third_party_lecture_as_personal_memory",
  ].includes(flag));
}

function isTemporaryLongTermRisk(item: ExtractedSessionMemoryCandidate): boolean {
  const flags = parseValidationFlags(item);
  const content = item.candidate.content.toLowerCase();
  if (item.candidate.candidateType === "event_summary") return false;
  if (flags.includes("ambiguous_time_in_content") || flags.includes("unverified_date_in_content")) return true;
  return /\b(next meeting|in thirty minutes|today|tomorrow|this week|currently|right now|deadline|temporary|for this meeting)\b/i.test(content);
}

function buildProcessFlags(output: ExtractSessionMemoryFromTextOutput): string[] {
  const flags: string[] = [];
  for (const item of output.candidates) {
    const status = item.validation.valid ? "pending" : "rejected";
    if (looksLikeAiOutputLeak(item) && status !== "rejected") {
      flags.push(`ai_output_leak_not_rejected:${item.candidate.title}`);
    }
    if (looksLikeThirdPartyPersonalLeak(item) && status !== "rejected") {
      flags.push(`third_party_personal_not_rejected:${item.candidate.title}`);
    }
    if (isTemporaryLongTermRisk(item) && status !== "rejected") {
      flags.push(`temporary_fact_not_rejected:${item.candidate.title}`);
    }
    if (item.candidate.candidateType === "event_summary" && item.validation.safeToPromote) {
      flags.push(`event_summary_safe_to_promote:${item.candidate.title}`);
    }
    if (item.candidate.candidateType !== "knowledge_fact" && item.validation.safeToPromote) {
      flags.push(`non_knowledge_safe_to_promote:${item.candidate.title}`);
    }
  }
  return flags;
}

function formatCandidate(item: ExtractedSessionMemoryCandidate): string {
  const flags = parseValidationFlags(item);
  const date = item.validation.dateMetadata;
  return [
    `### ${item.status.toUpperCase()} ${item.candidate.candidateType}: ${item.candidate.title}`,
    "",
    `- confidence/value/risk: ${item.candidate.confidence.toFixed(2)} / ${item.candidate.valueScore.toFixed(2)} / ${item.candidate.riskScore.toFixed(2)}`,
    `- validation: ${item.validation.valid ? "valid" : "invalid"}`,
    `- safeToPromote: ${item.validation.safeToPromote ? "yes" : "no"}`,
    `- flags: ${flags.length ? flags.join(", ") : "none"}`,
    `- date: ${date.mentionedDate || "none"} (${date.dateSource}, ${date.dateConfidence.toFixed(2)})`,
    "",
    item.candidate.content,
    "",
    item.candidate.usageRule ? `Usage: ${item.candidate.usageRule}` : "",
    item.candidate.keywords.length ? `Keywords: ${item.candidate.keywords.join(", ")}` : "",
    item.validation.groundedEvidence.length
      ? `Evidence:\n${item.validation.groundedEvidence.map((line) => `- ${line}`).join("\n")}`
      : "Evidence: none",
  ].filter(Boolean).join("\n");
}

function resolveSessions() {
  if (explicitSessionIds.length > 0) {
    return explicitSessionIds.map((sessionId) => {
      const session = conversationLogger.getTranscriptExportSession(userId, sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      return session;
    });
  }

  if (explicitSessionId) {
    const session = conversationLogger.getTranscriptExportSession(userId, explicitSessionId);
    if (!session) throw new Error(`Session not found: ${explicitSessionId}`);
    return [session];
  }

  return conversationLogger
    .listTranscriptExportSessions(userId, 50)
    .filter((session) => session.transcriptCount >= minTranscripts)
    .slice(0, sessionCount);
}

async function evalSession(sessionId: string): Promise<SessionEval> {
  const source = buildSessionMemorySource(userId, sessionId, maxTranscriptChars);
  if (!source) throw new Error(`Session source not found: ${sessionId}`);

  try {
    const output = await extractSessionMemoryCandidatesFromText({
      userId,
      sessionId,
      sessionStartTimestamp: source.session.startTimestamp,
      sessionLastTimestamp: source.session.lastTimestamp,
      transcriptText: source.transcriptText,
      aiOutputText: source.aiOutputText,
      limitCandidates,
      provider,
      trustFirstPersonTranscript: true,
    });

    return {
      sessionId,
      title: source.session.title,
      transcriptCount: source.session.transcriptCount,
      aiReplyCount: source.session.aiReplyCount,
      scenes: source.session.scenes,
      transcriptChars: source.transcriptText.length,
      aiOutputChars: source.aiOutputText.length,
      output,
      modes: [
        simulateMode(output.candidates, "manual_only"),
        simulateMode(output.candidates, "auto_safe_knowledge"),
        simulateMode(output.candidates, "review_all"),
      ],
      flags: buildProcessFlags(output),
    };
  } catch (error) {
    return {
      sessionId,
      title: source.session.title,
      transcriptCount: source.session.transcriptCount,
      aiReplyCount: source.session.aiReplyCount,
      scenes: source.session.scenes,
      transcriptChars: source.transcriptText.length,
      aiOutputChars: source.aiOutputText.length,
      modes: [],
      flags: ["extract_error"],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildReport(results: SessionEval[]): string {
  const totalCandidates = results.reduce((sum, result) => sum + (result.output?.candidates.length || 0), 0);
  const totalFlags = results.reduce((sum, result) => sum + result.flags.length, 0);
  const lines = [
    "# Real Session Memory Review Mode Eval",
    "",
    `- userId: ${userId}`,
    `- provider: ${provider}`,
    `- sessions: ${results.length}`,
    `- limitCandidates: ${limitCandidates}`,
    `- minTranscripts: ${minTranscripts}`,
    `- maxTranscriptChars: ${maxTranscriptChars || "none"}`,
    `- total candidates: ${totalCandidates}`,
    `- process flags: ${totalFlags}`,
    "",
  ];

  for (const result of results) {
    lines.push(
      `## ${result.sessionId}`,
      "",
      `- title: ${result.title}`,
      `- scenes: ${result.scenes.join(", ") || "none"}`,
      `- transcript count: ${result.transcriptCount}`,
      `- AI reply count: ${result.aiReplyCount}`,
      `- transcript chars: ${result.transcriptChars}`,
      `- AI output chars: ${result.aiOutputChars}`,
      `- flags: ${result.flags.join(", ") || "none"}`,
      "",
    );

    if (result.error) {
      lines.push(`Error: ${result.error}`, "");
      continue;
    }

    lines.push("### Mode Simulation", "");
    for (const mode of result.modes) {
      lines.push(`- ${mode.mode}: pending=${mode.pending}, rejected=${mode.rejected}, promoted=${mode.promoted}${mode.promotedTitles.length ? ` (${mode.promotedTitles.join(" | ")})` : ""}`);
    }

    lines.push("", "### Session Summary", "", result.output?.sessionSummary || "(empty)", "");

    if (!result.output?.candidates.length) {
      lines.push("No candidates.", "");
      continue;
    }

    lines.push("### Candidates", "", ...result.output.candidates.map(formatCandidate), "");

    const rejectedLeakExamples = result.output.candidates
      .filter((item) => looksLikeAiOutputLeak(item) || looksLikeThirdPartyPersonalLeak(item))
      .map((item) => `${item.candidate.title}: ${parseValidationFlags(item).join(", ")}`);
    if (rejectedLeakExamples.length) {
      lines.push("### Correctly Blocked Risks", "", ...rejectedLeakExamples.map((item) => `- ${item}`), "");
    }

    const knowledge = result.output.candidates.filter((item) => item.candidate.candidateType === "knowledge_fact");
    if (knowledge.length) {
      lines.push("### Knowledge Candidates", "", ...knowledge.map((item) => `- ${item.status}: ${item.candidate.title} — ${truncate(item.candidate.content, 220)}`), "");
    }
  }

  return `${lines.join("\n")}\n`;
}

const sessions = resolveSessions();
if (sessions.length === 0) {
  throw new Error(`No transcript sessions found for ${userId}`);
}

const results: SessionEval[] = [];
for (const [index, session] of sessions.entries()) {
  console.log(`[real-modes] ${index + 1}/${sessions.length}: ${session.sessionId} transcripts=${session.transcriptCount}`);
  results.push(await evalSession(session.sessionId));
}

mkdirSync(join("data", "eval"), { recursive: true });
const reportPath = join("data", "eval", `session-memory-real-modes-${now}.md`);
const jsonPath = join("data", "eval", `session-memory-real-modes-${now}.json`);
writeFileSync(reportPath, buildReport(results), "utf8");
writeFileSync(jsonPath, JSON.stringify({ userId, provider, limitCandidates, maxTranscriptChars, results }, null, 2), "utf8");

const flags = results.reduce((sum, result) => sum + result.flags.length, 0);
const candidates = results.reduce((sum, result) => sum + (result.output?.candidates.length || 0), 0);
console.log(`REAL_SESSION_MEMORY_MODES provider=${provider} sessions=${results.length} candidates=${candidates} flags=${flags}`);
console.log(`Report: ${reportPath}`);

if (flags > 0) process.exitCode = 1;
