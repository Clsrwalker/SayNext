import { Database } from "bun:sqlite";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { EventMemoryManager } from "../src/server/memory/event-memory";

const userId = process.argv[2] || "li2897283405@gmail.com";
const dbPath = process.argv[3] || "data/saynext.sqlite";
const db = new Database(dbPath, { readonly: true });

type SampleRow = {
  id: number;
  user_id: string;
  session_id: string;
  timestamp: string;
  transcript: string;
  ai_reply: string | null;
  action_type: string;
  model: string | null;
};

type ExpectedRoute = {
  reason: string;
  refs?: string[];
  noMemory?: boolean;
};

type Flag = {
  id: number;
  timestamp: string;
  transcript: string;
  aiReply: string;
  kind: string;
  detail: string;
  top?: string[];
};

const rows = db
  .query(`
    SELECT id, user_id, session_id, timestamp, transcript, ai_reply, action_type, model
    FROM conversation_samples
    WHERE user_id = ?
    ORDER BY timestamp ASC, id ASC
  `)
  .all(userId) as SampleRow[];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function isMostlyEnglish(text: string): boolean {
  const asciiLetters = (text.match(/[a-z]/gi) ?? []).length;
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return asciiLetters >= 5 && cjk === 0;
}

function isFillerTranscript(text: string): boolean {
  const normalized = normalize(text).replace(/[.!?,，。！？]/g, "");
  if (normalized.length <= 2) return true;
  return [
    "and",
    "uh",
    "um",
    "okay",
    "ok",
    "yeah",
    "yes",
    "no",
    "right",
    "definitely",
    "sounds good",
    "i see",
    "not sure",
    "not really",
  ].includes(normalized);
}

function isClearQuestion(text: string): boolean {
  const normalized = normalize(text);
  return text.includes("?") || /^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|tell me|describe|explain)\b/.test(normalized);
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function expectedForTranscript(transcript: string): ExpectedRoute | null {
  const q = normalize(transcript);

  if (isFillerTranscript(transcript)) return { reason: "filler/noise", noMemory: true };
  if (includesAny(q, ["gargle", "hairy nuts", "weather tomorrow", "hockey game", "photosynthesis", "translate hello", "recipe"])) {
    return { reason: "unrelated/noise", noMemory: true };
  }
  if (transcript.length > 600) {
    return null;
  }

  if (includesAny(q, ["summer"]) && includesAny(q, ["course", "schedule", "term", "class"])) {
    return { reason: "summer courses", refs: ["xiang-update:2026-05:summer-courses"] };
  }
  if (includesAny(q, ["course do you take", "what course do you take", "course you take"])) {
    return { reason: "current courses", refs: ["xiang-update:2026-05:summer-courses"] };
  }
  if (includesAny(q, ["recommendation system", "recommender system", "no recommendation"])) {
    return { reason: "summer recommender course", refs: ["xiang-update:2026-05:summer-courses", "knowledge:cs-interview:recommender-systems"] };
  }
  if (includesAny(q, ["high school"]) && includesAny(q, ["china", "before canada"])) {
    return { reason: "China high school", refs: ["xiang-profile:china-school-history"] };
  }
  if (includesAny(q, ["high school"]) && includesAny(q, ["canada", "dartmouth", "halifax"])) {
    return { reason: "Canada high school", refs: ["xiang-profile:canada-high-school-transition"] };
  }
  if (includesAny(q, ["what game", "game you played", "played any games"])) {
    return { reason: "games", refs: ["xiang-profile:favorite-games", "xiang-profile:games-general"] };
  }
  if (hasWord(transcript, "mom") || hasWord(transcript, "mother") || hasWord(transcript, "family") || q.includes("family member")) {
    return { reason: "family/privacy", refs: ["xiang-profile:family-background", "xiang-profile:identity-education"] };
  }
  if (includesAny(q, ["project name", "small project", "what project", "project you did"])) {
    return {
      reason: "project answer",
      refs: [
        "xiang-profile:project-saynext",
        "xiang-profile:project-elder-album",
        "xiang-profile:project-study-session-tracker",
        "xiang-profile:project-dal-parking-aid",
        "doc:saynext:interview-story",
        "doc:resume:selected-projects",
      ],
    };
  }
  if (includesAny(q, ["lambda", "cold start"]) && includesAny(q, ["project", "elder", "album", "aws"])) {
    return { reason: "ElderAlbum AWS", refs: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album", "knowledge:cs-interview:serverless-lambda"] };
  }
  if (includesAny(q, ["lambda", "cold start", "serverless"])) {
    return { reason: "serverless concept", refs: ["knowledge:cs-interview:serverless-lambda"] };
  }
  if (includesAny(q, ["react native", "parking"])) {
    return { reason: "DalParkAid", refs: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] };
  }
  if (includesAny(q, ["cloud architecture", "cloud architecting"]) && includesAny(q, ["why", "like", "course"])) {
    return { reason: "favorite cloud course", refs: ["xiang-update:2026-05:favorite-subjects"] };
  }

  return null;
}

function summarizeTop(query: string): string[] {
  return conversationLogger
    .searchPersonalMemoriesHybrid(userId, query, 5)
    .map((result) => `${result.sourceRef || `id:${result.id}`} :: ${result.title}`);
}

const retrievalFlags: Flag[] = [];
const legacyOutputFlags: Flag[] = [];
const duplicateFlags: Flag[] = [];
const sceneTransitions: string[] = [];

const eventMemory = new EventMemoryManager(`db-eval-${userId}`, `db-eval-${Date.now()}`, false);
let previousScene = "unknown";
let previousByTranscript = new Map<string, SampleRow>();

for (const row of rows) {
  const transcript = row.transcript || "";
  const reply = row.ai_reply || "";
  const q = normalize(transcript);
  const r = normalize(reply);
  const expected = expectedForTranscript(transcript);
  const top = summarizeTop(transcript);

  if (expected?.noMemory && top.length > 0) {
    retrievalFlags.push({
      id: row.id,
      timestamp: row.timestamp,
      transcript,
      aiReply: reply,
      kind: "retrieval_on_noise",
      detail: expected.reason,
      top,
    });
  } else if (expected?.refs?.length && !expected.refs.some((ref) => top[0]?.startsWith(ref))) {
    retrievalFlags.push({
      id: row.id,
      timestamp: row.timestamp,
      transcript,
      aiReply: reply,
      kind: "retrieval_top1_mismatch",
      detail: `${expected.reason}; expected ${expected.refs.join(" | ")}`,
      top,
    });
  }

  const snapshot = eventMemory.addTranscript(transcript, new Date(row.timestamp).getTime());
  if (snapshot.scene !== previousScene) {
    sceneTransitions.push(`${row.timestamp} #${row.id}: ${previousScene} -> ${snapshot.scene} | ${transcript}`);
    previousScene = snapshot.scene;
  }

  const duplicateKey = q;
  const previous = previousByTranscript.get(duplicateKey);
  if (previous) {
    const deltaMs = new Date(row.timestamp).getTime() - new Date(previous.timestamp).getTime();
    if (deltaMs >= 0 && deltaMs <= 90_000 && normalize(previous.ai_reply || "") !== r) {
      duplicateFlags.push({
        id: row.id,
        timestamp: row.timestamp,
        transcript,
        aiReply: reply,
        kind: "duplicate_transcript_different_output",
        detail: `previous #${previous.id} ${previous.timestamp}: ${previous.ai_reply}`,
      });
    }
  }
  previousByTranscript.set(duplicateKey, row);

  if (/```|\{\s*"type"\s*:|"reasoning"\s*:/.test(reply)) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "malformed_or_json_output", detail: "Legacy output contains JSON/code markers." });
  }

  if (isMostlyEnglish(transcript) && hasCjk(reply)) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "language_mismatch", detail: "Legacy output language does not match transcript. This may be caused by old settings." });
  }

  if (isClearQuestion(transcript) && includesAny(r, ["could you repeat", "say that again", "not sure what you mean"])) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "clarified_clear_question", detail: "Legacy output clarified a clear question." });
  }

  if (includesAny(r, ["projectecho", "personal assistant bot", "daily habits", "habit and goals", "track daily habits"])) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "invented_project_risk", detail: "Legacy output names a project/fact not in current memory." });
  }

  if (includesAny(q, ["summer", "course do you take", "schedule of this summer", "summer term"]) && includesAny(q, ["course", "schedule", "term"])) {
    if (includesAny(r, ["just two", "only two", "two courses"]) || !includesAny(r, ["recommender", "recommendation"])) {
      legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "summer_course_incomplete", detail: "Legacy output missed Recommender Systems; current memory includes it." });
    }
  }

  if (includesAny(q, ["high school"]) && includesAny(q, ["china"]) && !includesAny(r, ["peking", "shishi", "affiliated", "experimental", "chengdu"])) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "high_school_answer_vague", detail: "Legacy output did not use stored school details." });
  }

  if (includesAny(q, ["project name", "small project", "project you did"]) && !includesAny(r, ["saynext", "elder", "dal", "parking", "joblens", "study session"])) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "project_answer_not_grounded", detail: "Legacy output did not use known project memory." });
  }

  if (includesAny(r, ["how about you", "what about you"]) && !includesAny(q, ["how about you", "what about you"])) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "forced_return_question", detail: "Legacy output asks a return question; often not useful for SayNext display." });
  }

  if (hasCjk(reply) && includesAny(r, ["应该", "要小心", "别给人添麻烦", "孝顺", "保暖很重要", "肯定很开心"])) {
    legacyOutputFlags.push({ id: row.id, timestamp: row.timestamp, transcript, aiReply: reply, kind: "unsolicited_advice_or_moralizing", detail: "Legacy Chinese casual answer sounds advisory/moralizing instead of Xiang-like." });
  }
}

function printFlags(title: string, flags: Flag[], limit = 30): void {
  console.log(`\n${title}: ${flags.length}`);
  for (const flag of flags.slice(0, limit)) {
    console.log(`#${flag.id} ${flag.timestamp} [${flag.kind}] ${flag.detail}`);
    console.log(`  transcript: ${flag.transcript}`);
    console.log(`  ai: ${flag.aiReply}`);
    if (flag.top?.length) console.log(`  top: ${flag.top.slice(0, 3).join(" | ")}`);
  }
  if (flags.length > limit) console.log(`  ... ${flags.length - limit} more`);
}

console.log(`DB_TRANSCRIPT_EVAL user=${userId} samples=${rows.length}`);
console.log(`sceneTransitions=${sceneTransitions.length}`);
console.log(sceneTransitions.slice(0, 20).join("\n"));
if (sceneTransitions.length > 20) console.log(`... ${sceneTransitions.length - 20} more transitions`);

printFlags("retrievalFlags", retrievalFlags);
printFlags("legacyOutputFlags_info_only", legacyOutputFlags, 60);
printFlags("duplicateFlags", duplicateFlags, 40);

const hardFailures = retrievalFlags.length;

if (hardFailures > 0) {
  process.exitCode = 1;
}
