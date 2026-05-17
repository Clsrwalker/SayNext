import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { extractSessionMemoryCandidates } from "../src/server/memory/session-memory-extractor";

const userId = process.argv[2] || "li2897283405@gmail.com";
const rawSessionId = process.argv[3] || "--latest";
const promoteSafe = process.argv.includes("--promote-safe");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limitCandidates = limitArg ? Number(limitArg.split("=")[1]) : 8;
const maxCharsArg = process.argv.find((arg) => arg.startsWith("--max-chars="));
const maxTranscriptChars = maxCharsArg ? Number(maxCharsArg.split("=")[1]) : undefined;

function resolveSessionId(): string {
  if (rawSessionId && rawSessionId !== "--latest") return rawSessionId;
  const latest = conversationLogger.listTranscriptExportSessions(userId, 1)[0];
  if (!latest) {
    throw new Error(`No transcript sessions found for ${userId}`);
  }
  return latest.sessionId;
}

function formatCandidate(candidate: any): string {
  let validation: Record<string, any> = {};
  try {
    validation = JSON.parse(candidate.validationJson || "{}");
  } catch {
    validation = {};
  }

  return [
    `## Candidate ${candidate.id}: ${candidate.title}`,
    `- Status: ${candidate.status}`,
    `- Type: ${candidate.candidateType}`,
    `- Category: ${candidate.category}`,
    `- Sensitivity: ${candidate.sensitivity}`,
    `- Confidence/value/risk: ${candidate.confidence.toFixed(2)} / ${candidate.valueScore.toFixed(2)} / ${candidate.riskScore.toFixed(2)}`,
    validation.dateMetadata
      ? `- Date: event=${validation.dateMetadata.eventTime || "unknown"}; mentioned=${validation.dateMetadata.mentionedDate || "none"}; source=${validation.dateMetadata.dateSource}; confidence=${Number(validation.dateMetadata.dateConfidence ?? 0).toFixed(2)}`
      : "",
    `- Safe to promote: ${validation.safeToPromote ? "yes" : "no"}`,
    `- Flags: ${Array.isArray(validation.flags) && validation.flags.length ? validation.flags.join(", ") : "none"}`,
    `- Duplicate refs: ${Array.isArray(validation.duplicateMemoryRefs) && validation.duplicateMemoryRefs.length ? validation.duplicateMemoryRefs.join(" | ") : "none"}`,
    "",
    candidate.content,
    "",
    candidate.usageRule ? `Usage: ${candidate.usageRule}` : "",
    candidate.keywords?.length ? `Keywords: ${candidate.keywords.join(", ")}` : "",
    candidate.evidence?.length ? `Evidence:\n${candidate.evidence.map((item: string) => `- ${item}`).join("\n")}` : "Evidence: none",
  ].filter(Boolean).join("\n");
}

async function main() {
  const sessionId = resolveSessionId();
  const result = await extractSessionMemoryCandidates({
    userId,
    sessionId,
    limitCandidates,
    promoteSafe,
    maxTranscriptChars,
  });

  mkdirSync("data/eval", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join("data", "eval", `session-memory-candidates-${timestamp}.md`);
  const jsonPath = join("data", "eval", `session-memory-candidates-${timestamp}.json`);

  const report = [
    "# Session Memory Candidate Extraction",
    "",
    `User: \`${userId}\``,
    `Session: \`${sessionId}\``,
    `Model: \`${result.model}\``,
    `Runtime: \`${result.runtimeMode}/${result.provider}/${result.batchEnabled ? "batch" : "sync"}\``,
    `Promote safe: ${promoteSafe ? "yes" : "no"}`,
    `Max transcript chars: ${maxTranscriptChars || "default"}`,
    `Candidates: ${result.candidates.length}`,
    `Promoted: ${result.promoted.length}`,
    "",
    "## Session Summary",
    result.sessionSummary || "(empty)",
    "",
    ...result.candidates.map(formatCandidate),
  ].join("\n");

  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");

  console.log(`Session memory extraction complete.`);
  console.log(`Report: ${reportPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Candidates: ${result.candidates.length}, promoted: ${result.promoted.length}`);
  for (const candidate of result.candidates) {
    console.log(`#${candidate.id} [${candidate.status}] ${candidate.title} (${candidate.candidateType})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
