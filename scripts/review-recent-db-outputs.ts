import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

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

type Review = {
  taxonomy: string;
  severity: number;
  reason: string;
  expectedProcess: string[];
  feedbackQuestion: string;
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

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function classify(row: SampleRow): Review {
  const transcript = normalize(row.transcript);
  const output = normalize(row.aiReply || "");
  const outputWords = wordCount(row.aiReply || "");
  const isShortAck = /^(ok|okay|yeah|yep|yes|no|nope|thanks|thank you|thanks so much|that's fine|that is fine|hello|hi|happy)[.!?,\s]*$/i.test(row.transcript.trim());
  const hasLectureCarryover = hasAny(output, [
    /linear classifier/,
    /high-dimensional/,
    /hyperplane/,
    /template image/,
    /classifiers?/,
    /brightspace attendance/,
  ]);
  const asksDirectQuestion = /\?\s*$/.test(row.transcript.trim()) || /\b(what|how|why|should|could|can|do you|would you)\b/i.test(row.transcript);
  const outputAsksQuestion = /\?\s*$/.test((row.aiReply || "").trim());
  const isGreeting = /^(hello|hi|hey)[.!?,\s]*$/i.test(row.transcript.trim());
  const isAttendance = /\b(attendance|brightspace)\b/i.test(row.transcript);

  if (isShortAck && hasLectureCarryover) {
    return {
      taxonomy: "context_stale + no_intervention_missing",
      severity: 4,
      reason: "Short acknowledgement/closing was answered with stale lecture content from previous context.",
      expectedProcess: [
        "detect short acknowledgement or closing",
        "do not continue old technical answer",
        "return no action or a minimal natural acknowledgement",
      ],
      feedbackQuestion: "For this short acknowledgement, should SayNext show nothing, show 'No action needed yet.', or show a minimal reply like 'Thanks.'?",
    };
  }

  if (isGreeting && /name|context|heard/i.test(row.aiReply || "")) {
    return {
      taxonomy: "route_misfire",
      severity: 3,
      reason: "Greeting was treated like a name/context fragment.",
      expectedProcess: [
        "detect greeting",
        "avoid missing-context name-fragment response",
        "use a simple greeting or no intervention",
      ],
      feedbackQuestion: "For a standalone 'Hello.', should SayNext answer 'Hey.', or stay silent?",
    };
  }

  if (!asksDirectQuestion && outputWords > 28 && hasLectureCarryover) {
    return {
      taxonomy: "context_stale",
      severity: 3,
      reason: "Non-question transcript got a long stale technical continuation.",
      expectedProcess: [
        "current turn intent has priority",
        "only continue lecture content when the current turn asks for it",
        "avoid long generated answer on filler",
      ],
      feedbackQuestion: "For a classroom non-question fragment, should SayNext keep summarizing lecture content, or default to no intervention?",
    };
  }

  if (isAttendance && outputAsksQuestion) {
    return {
      taxonomy: "forced_question / classroom_process",
      severity: 2,
      reason: "Attendance/Brightspace statement produced a follow-up question; this may be socially unnecessary.",
      expectedProcess: [
        "answer only if Xiang is expected to speak",
        "avoid forced follow-up questions",
        "keep classroom admin replies minimal",
      ],
      feedbackQuestion: "For attendance/Brightspace admin talk, should SayNext suggest a question, or only a short acknowledgement like 'Okay, thanks.'?",
    };
  }

  if (outputWords > 45) {
    return {
      taxonomy: "quality_watch:length",
      severity: 1,
      reason: `Output is long for live SayNext use (${outputWords} words).`,
      expectedProcess: [
        "keep live answer concise",
        "preserve main answer",
        "avoid overexplaining",
      ],
      feedbackQuestion: "Should this answer be compressed to one sentence, or is a two-sentence explanation acceptable?",
    };
  }

  return {
    taxonomy: "ok_or_needs_human_feedback",
    severity: 0,
    reason: "No deterministic process failure detected by this review pass.",
    expectedProcess: ["manual review optional"],
    feedbackQuestion: "Does this sound natural and useful to you, or should it be rewritten closer to your voice?",
  };
}

function main(): void {
  const dbPath = argValue("--db") || "data/saynext.sqlite";
  const userId = argValue("--user") || "li2897283405@gmail.com";
  const limit = Number(argValue("--limit") || "30");
  const outputDir = argValue("--out-dir") || join("data", "review");
  const db = new Database(dbPath, { readonly: true });

  const rows = db.query(`
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

  const reviewed = rows.map((row) => ({ row, review: classify(row) }));
  const sorted = [...reviewed].sort((a, b) => b.review.severity - a.review.severity || b.row.id - a.row.id);

  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outputDir, `recent-db-output-review-${stamp}.md`);
  const jsonPath = join(outputDir, `recent-db-output-review-${stamp}.json`);

  const lines = [
    "# Recent DB Transcript / Output Review",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Database: ${dbPath}`,
    `User: ${userId}`,
    `Limit: ${limit}`,
    "",
    "Taxonomy policy: process_bad only when current-turn intent is dropped, stale context wins, wrong route fires, high-risk boundary fails, technical process is too shallow, or the system should not intervene.",
    "",
  ];

  for (const item of sorted) {
    lines.push(`## #${item.row.id} severity=${item.review.severity} ${item.review.taxonomy}`);
    lines.push(`- time: ${item.row.timestamp}`);
    lines.push(`- session: ${item.row.sessionId}`);
    lines.push(`- transcript: ${item.row.transcript}`);
    lines.push(`- output: ${item.row.aiReply || ""}`);
    lines.push(`- reasoning: ${item.row.reasoning || ""}`);
    lines.push(`- model: ${item.row.model || ""}`);
    lines.push(`- reason: ${item.review.reason}`);
    lines.push(`- expected_process: ${item.review.expectedProcess.join(" | ")}`);
    lines.push(`- feedback_question: ${item.review.feedbackQuestion}`);
    lines.push("");
  }

  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(jsonPath, JSON.stringify(sorted, null, 2), "utf8");

  const counts = new Map<string, number>();
  for (const item of reviewed) counts.set(item.review.taxonomy, (counts.get(item.review.taxonomy) || 0) + 1);
  const countText = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}=${count}`)
    .join(" ");

  console.log(`[recent-db-output-review] rows=${rows.length}`);
  console.log(`[recent-db-output-review] counts=${countText}`);
  console.log(`[recent-db-output-review] report=${mdPath}`);
  console.log(`[recent-db-output-review] json=${jsonPath}`);
  for (const item of sorted.slice(0, 8)) {
    console.log(JSON.stringify({
      id: item.row.id,
      severity: item.review.severity,
      taxonomy: item.review.taxonomy,
      transcript: item.row.transcript,
      output: item.row.aiReply,
      reason: item.review.reason,
    }));
  }
}

main();
