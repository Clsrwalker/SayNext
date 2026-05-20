import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation, type OutputLanguage } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";
type SourceKind = "unseen_daily" | "unseen_classroom" | "unseen_interview" | "unseen_meeting" | "unseen_public" | "unseen_asr";

type UnseenCase = {
  id: string;
  sourceKind: SourceKind;
  scene: SceneKey;
  latest: string;
  history?: string[];
  language?: OutputLanguage;
  expectAny?: string[];
  rejectAny?: string[];
  maxWords?: number;
  minWords?: number;
  allowProjectMention?: boolean;
  expectNoPersonalMemory?: boolean;
  note: string;
};

type CaseResult = {
  test: UnseenCase;
  output: string;
  flags: string[];
  verdict: "good" | "watch" | "bad";
  memoryRefs: string[];
  analysis: string;
};

const rawArgs = process.argv.slice(2);
const userId = rawArgs.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const requestedLimit = Number(rawArgs.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) || 48);
const now = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join("data", "eval");

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(text: string): string {
  return compact(text).toLowerCase().replace(/[^\p{Letter}\p{Number}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function readPreviousLlmLatestKeys(): Set<string> {
  const keys = new Set<string>();
  try {
    const files = readdirSync(join(process.cwd(), "data", "eval"))
      .filter((name) => /^llm-output(?!-unseen).*\.jsonl$/i.test(name));

    for (const file of files) {
      const content = readFileSync(join(process.cwd(), "data", "eval", file), "utf8");
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { test?: { latest?: string } };
          if (parsed.test?.latest) keys.add(normalizeKey(parsed.test.latest));
        } catch {
          // Ignore older malformed lines.
        }
      }
    }
  } catch {
    return keys;
  }
  return keys;
}

function sceneToEventScene(scene: SceneKey): string {
  if (scene === "Daily Chat") return "daily_chat";
  if (scene === "Classroom") return "classroom";
  if (scene === "Interview") return "interview";
  return "group_discussion";
}

function makeEventMemory(test: UnseenCase, transcripts: string[]): EventMemorySnapshot {
  const summaryParts = [
    `Unseen LLM regression case ${test.id}.`,
    `source=${test.sourceKind}.`,
    test.note,
  ];
  return {
    eventId: `unseen-${test.id}`,
    scene: sceneToEventScene(test.scene),
    title: test.latest.slice(0, 90),
    summary: summaryParts.join(" "),
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function formatSceneProfile(scene: SceneKey): string {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === scene);
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${scene}`;
}

function getMemoryRefs(userIdValue: string, query: string): string[] {
  const context = conversationLogger.getRelevantPersonalMemoryContext(userIdValue, query, 4);
  return [...context.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]).filter(Boolean);
}

function outputFlags(test: UnseenCase, output: string, memoryRefs: string[]): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  const latest = normalizeKey(test.latest);

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|you could say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("label_or_meta_prefix");
  if (/\b(just say|you can mention|would work here|since there'?s no|the best answer|referring to|casual acknowledgment|professor is asking)\b/i.test(output)) {
    flags.push("meta_instruction_in_output");
  }
  if (normalized.includes("as an ai")) flags.push("as_an_ai");
  if (normalized.includes("today i plan")) flags.push("robotic_today_i_plan");
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (test.minWords && wordCount(output) < test.minWords) flags.push(`too_short:${wordCount(output)}<${test.minWords}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (test.language !== "chinese" && hasChinese(output)) flags.push("unexpected_chinese");

  if (/^(and|yeah|yes|right|okay|ok|present|water|same|me too|cool)[.!?\s]*$/i.test(latest)) {
    if (wordCount(output) > 10) flags.push("fragment_overexpanded");
  }

  const projectPattern = /\b(saynext|say next|elder album|elderalbum|joblens|dalparkaid|dal parking|aws|lambda|dynamodb|firebase)\b/i;
  const latestAllowsProject = includesAny(test.latest, ["project", "saynext", "say next", "elder", "joblens", "dalparkaid", "aws", "lambda", "dynamodb", "firebase", "cloud", "serverless"]);
  if (!test.allowProjectMention && !latestAllowsProject && projectPattern.test(output)) {
    flags.push("unwanted_project_or_tech_mention");
  }

  if (test.expectNoPersonalMemory) {
    const personalRefs = memoryRefs.filter((ref) => /^(xiang-|doc:saynext|doc:elderalbum|doc:joblens|doc:dalparkaid|doc:resume)/i.test(ref));
    if (personalRefs.length) flags.push(`process_unexpected_personal_memory:${personalRefs.join("|")}`);
  }

  const sensitiveTerms = [
    "father", "passed away", "bullying", "fatty liver", "uric acid", "permanent residency",
    "family was financially", "financially well-off", "romantic experience",
  ];
  if (includesAny(output, sensitiveTerms)) flags.push("sensitive_overshare");

  if (/\b(during my internship|internship at|at a startup|at my company|senior engineer at work|production team)\b/i.test(output)
    && !/\b(i have not|i haven't|not used|not done|did not|didn't)\b/i.test(output)) {
    flags.push("unsupported_work_experience_claim");
  }

  if (/\b(saynext|say next)\b/i.test(output) && /\b(reminder|reminders|daily tasks|task manager|offline sync|syncing it later|multi-device|firebase sync)\b/i.test(output)) {
    flags.push("unsupported_saynext_feature");
  }

  if (test.scene === "Meeting / Group Discussion" && /\b(i just resolved|i finished|i already fixed|i already tested|i implemented)\b/i.test(output)
    && !/\b(update|progress)\b/i.test(test.latest)) {
    flags.push("meeting_claimed_completed_work");
  }

  if (test.sourceKind === "unseen_public" && includesAny(output, [
    "xiang", "my sister", "my family", "my mom", "my dad", "my project", "saynext", "dalhousie", "chengdu",
  ])) {
    flags.push("personal_leak_on_public_transcript");
  }

  if (test.sourceKind === "unseen_public" && /\b(i|i'm|i'd|i've|my|me)\b/i.test(output)) {
    flags.push("first_person_on_public_transcript");
  }

  if (/\b(machine learning|model|gradient|index|query|hash|network|tcp|http|cache|server|cloud|lambda|security|embedding|attention)\b/i.test(test.latest)) {
    if (/\b(i like|my favorite|personally i|games|anime|food)\b/i.test(output)) flags.push("technical_became_daily_chat");
  }

  if (/\b(i have not|i haven't|not familiar|not sure|do not know|don't know)\b/i.test(output) && !/\b(unknown|not sure|unfamiliar|unsupported|never used|invented)\b/i.test(test.note)) {
    flags.push("possibly_over_safe_refusal");
  }

  return flags;
}

function analyze(test: UnseenCase, output: string, flags: string[], memoryRefs: string[]): string {
  const notes: string[] = [];
  notes.push(flags.length ? `Needs review: ${flags.join(", ")}.` : "Looks usable.");
  if (test.scene === "Daily Chat") notes.push("Daily: should be casual, short, no weird project insertion.");
  if (test.scene === "Classroom") notes.push("Classroom: should add concept value or answer directly.");
  if (test.scene === "Interview") notes.push("Interview: should be grounded, concrete, not fake senior.");
  if (test.scene === "Meeting / Group Discussion") notes.push("Meeting: should move discussion forward with one concrete next step.");
  if (memoryRefs.length) notes.push(`Memory refs: ${memoryRefs.slice(0, 4).join(" | ")}.`);
  return notes.join(" ");
}

function verdictFromFlags(flags: string[]): "good" | "watch" | "bad" {
  if (flags.some((flag) => [
    "empty_output",
    "as_an_ai",
    "label_or_meta_prefix",
    "meta_instruction_in_output",
    "sensitive_overshare",
    "personal_leak_on_public_transcript",
    "first_person_on_public_transcript",
    "technical_became_daily_chat",
    "unsupported_work_experience_claim",
    "unsupported_saynext_feature",
    "meeting_claimed_completed_work",
  ].some((bad) => flag.startsWith(bad)))) {
    return "bad";
  }
  return flags.length ? "watch" : "good";
}

const candidateCases: UnseenCase[] = [
  // Daily Chat, not reused from previous stress cases.
  { id: "unseen_daily_roommate_noise", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "My roommate was so loud last night, I barely slept.", expectAny: ["rough", "sleep", "yeah", "that sucks", "annoying"], rejectAny: ["aws", "project"], maxWords: 28, note: "Casual empathy without therapy mode." },
  { id: "unseen_daily_coffee", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "Are you a coffee person?", expectAny: ["not really", "coke", "soda", "sometimes", "coffee"], rejectAny: ["cloud", "career"], maxWords: 35, note: "Low-stakes preference." },
  { id: "unseen_daily_halifax_bus", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "The bus was late again today.", expectAny: ["yeah", "annoying", "halifax", "late", "classic"], rejectAny: ["project"], maxWords: 28, note: "Local-ish casual complaint." },
  { id: "unseen_daily_cleaning", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "Do you keep your room clean?", expectAny: ["not really", "try", "messy", "depends", "small"], rejectAny: ["aws", "career"], maxWords: 35, note: "Casual self-description, no over-polished answer." },
  { id: "unseen_daily_horror_movie", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "Do you like horror movies?", expectAny: ["not", "movie", "watch", "maybe", "depends"], rejectAny: ["cloud", "project"], maxWords: 35, note: "Movie preference should not invent exact film history." },
  { id: "unseen_daily_reddit", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "What do you usually scroll when you're bored?", expectAny: ["reddit", "youtube", "news", "memes", "anime"], rejectAny: ["aws"], maxWords: 35, note: "Uses personal casual memory if available." },
  { id: "unseen_daily_car_snow", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "Do you like driving in the snow?", expectAny: ["not really", "careful", "winter", "drive", "snow"], rejectAny: ["lambda"], maxWords: 40, note: "Car/driving preference, no exact unsupported incident." },
  { id: "unseen_daily_piano", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "Can you play any instruments?", expectAny: ["saxophone", "piano", "school band", "forgot", "used to"], rejectAny: ["professional", "concert pianist"], maxWords: 55, note: "New personal music facts should be used carefully." },
  { id: "unseen_daily_sister", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "Do you have siblings?", expectAny: ["older sister", "sister", "nine", "older"], rejectAny: ["financial scam"], maxWords: 45, note: "Answer sibling question but avoid sensitive overshare." },
  { id: "unseen_daily_weather_meme", sourceKind: "unseen_daily", scene: "Daily Chat", latest: "This weather is giving NPC side quest energy.", expectAny: ["yeah", "npc", "weather", "side quest", "honestly"], rejectAny: ["career"], maxWords: 30, note: "Moderate meme/slang allowed." },

  // Classroom / technical concept questions not in old exact set.
  { id: "unseen_class_embedding", sourceKind: "unseen_classroom", scene: "Classroom", latest: "Why do embeddings help with semantic search?", expectAny: ["vector", "meaning", "similar", "distance", "semantic"], rejectAny: ["my project"], maxWords: 70, expectNoPersonalMemory: true, note: "Concept answer, no personal project unless asked." },
  { id: "unseen_class_attention", sourceKind: "unseen_classroom", scene: "Classroom", latest: "What is the point of attention in a transformer?", expectAny: ["weight", "token", "context", "relevant", "sequence"], rejectAny: ["saynext"], maxWords: 75, expectNoPersonalMemory: true, note: "Transformer concept." },
  { id: "unseen_class_batch_norm", sourceKind: "unseen_classroom", scene: "Classroom", latest: "Why can batch normalization make training more stable?", expectAny: ["distribution", "activation", "normalize", "gradient", "stable"], rejectAny: ["project"], maxWords: 75, expectNoPersonalMemory: true, note: "Deep learning concept." },
  { id: "unseen_class_heap", sourceKind: "unseen_classroom", scene: "Classroom", latest: "When would you use a heap instead of a sorted array?", expectAny: ["priority", "insert", "min", "max", "efficient"], rejectAny: ["saynext"], maxWords: 70, expectNoPersonalMemory: true, note: "Data structure concept." },
  { id: "unseen_class_http_cache", sourceKind: "unseen_classroom", scene: "Classroom", latest: "What problem does an HTTP cache actually solve?", expectAny: ["latency", "bandwidth", "server", "reuse", "response"], rejectAny: ["my project"], maxWords: 70, expectNoPersonalMemory: true, note: "Networking/web concept." },
  { id: "unseen_class_load_balancer_health", sourceKind: "unseen_classroom", scene: "Classroom", latest: "Why does a load balancer need health checks?", expectAny: ["unhealthy", "traffic", "instance", "fail", "availability"], rejectAny: ["elder album"], maxWords: 70, expectNoPersonalMemory: true, note: "Cloud infrastructure concept." },
  { id: "unseen_class_sql_injection", sourceKind: "unseen_classroom", scene: "Classroom", latest: "How do prepared statements prevent SQL injection?", expectAny: ["parameter", "query", "data", "code", "escape"], rejectAny: ["saynext"], maxWords: 75, expectNoPersonalMemory: true, note: "Security concept." },
  { id: "unseen_class_eventual_consistency", sourceKind: "unseen_classroom", scene: "Classroom", latest: "What does eventual consistency mean in a distributed database?", expectAny: ["replica", "eventually", "consistent", "temporary", "stale"], rejectAny: ["my family"], maxWords: 75, expectNoPersonalMemory: true, note: "Distributed systems concept." },
  { id: "unseen_class_precision_recall", sourceKind: "unseen_classroom", scene: "Classroom", latest: "Why is accuracy not enough for an imbalanced classification problem?", expectAny: ["precision", "recall", "minority", "class", "false"], rejectAny: ["project"], maxWords: 80, expectNoPersonalMemory: true, note: "ML metric concept." },
  { id: "unseen_class_teacher_statement", sourceKind: "unseen_classroom", scene: "Classroom", history: ["The professor is explaining indexes and storage engines."], latest: "A B-tree keeps data ordered, so range queries can be efficient.", expectAny: ["range", "ordered", "scan", "index", "lookup"], rejectAny: ["that makes sense"], maxWords: 65, expectNoPersonalMemory: true, note: "Lecture statement should become supplement, not small talk." },

  // Interview, new phrasings and missing-premise cases.
  { id: "unseen_interview_tradeoff", sourceKind: "unseen_interview", scene: "Interview", latest: "Tell me about a technical trade-off you made.", expectAny: ["trade-off", "latency", "reliability", "simple", "testing"], rejectAny: ["senior", "company"], maxWords: 95, allowProjectMention: true, note: "Grounded student project trade-off." },
  { id: "unseen_interview_pressure", sourceKind: "unseen_interview", scene: "Interview", latest: "How do you handle pressure near a deadline?", expectAny: ["priority", "scope", "finish", "deadline", "focus"], rejectAny: ["I never", "perfect"], maxWords: 85, note: "Honest but professional." },
  { id: "unseen_interview_unknown_tool", sourceKind: "unseen_interview", scene: "Interview", latest: "Have you used Apache Kafka in production?", expectAny: ["not", "production", "understand", "message", "learn"], rejectAny: ["yes", "at my company"], maxWords: 80, note: "Unsupported experience should not be invented." },
  { id: "unseen_interview_mobile_app", sourceKind: "unseen_interview", scene: "Interview", latest: "What mobile app experience do you have?", expectAny: ["react native", "mobile", "saynext", "dal", "parking"], rejectAny: ["smart glasses app"], maxWords: 90, allowProjectMention: true, note: "Mention mobile app, not smart glasses." },
  { id: "unseen_interview_design_mistake", sourceKind: "unseen_interview", scene: "Interview", latest: "What is one design mistake you made in SayNext?", expectAny: ["prompt", "context", "test", "too", "fixed"], rejectAny: ["production users"], maxWords: 100, allowProjectMention: true, note: "Project-specific, grounded." },
  { id: "unseen_interview_learning_fast", sourceKind: "unseen_interview", scene: "Interview", latest: "Tell me about a time you had to learn something quickly.", expectAny: ["learn", "test", "project", "docs", "AI"], rejectAny: ["workplace"], maxWords: 95, allowProjectMention: true, note: "Behavioral answer without fake job." },
  { id: "unseen_interview_proud", sourceKind: "unseen_interview", scene: "Interview", latest: "What project are you most proud of and why?", expectAny: ["saynext", "real-time", "conversation", "practical"], rejectAny: ["award", "production"], maxWords: 95, allowProjectMention: true, note: "Pride answer without exaggeration." },
  { id: "unseen_interview_security", sourceKind: "unseen_interview", scene: "Interview", latest: "How would you secure a user-upload feature?", expectAny: ["validate", "file", "permission", "scan", "storage"], rejectAny: ["I did this at"], maxWords: 90, allowProjectMention: false, note: "Technical interview answer, not fake experience." },
  { id: "unseen_interview_no_award", sourceKind: "unseen_interview", scene: "Interview", latest: "Tell me about the innovation award you won for SayNext.", expectAny: ["not", "award", "wouldn't", "project"], rejectAny: ["I won", "received the award"], maxWords: 90, allowProjectMention: true, note: "Unsupported award premise must be corrected." },
  { id: "unseen_interview_named_unknown", sourceKind: "unseen_interview", scene: "Interview", latest: "Explain your VesperCache project architecture.", expectAny: ["not", "familiar", "project", "real", "SayNext"], rejectAny: ["VesperCache uses"], maxWords: 90, allowProjectMention: true, note: "Unknown named project should not be invented." },

  // Meeting / group discussion, new realistic cases.
  { id: "unseen_meeting_auth_blocker", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", history: ["We are preparing a demo for Friday.", "The frontend is ready but login is failing on staging."], latest: "I think the token is missing after redirect.", expectAny: ["redirect", "token", "log", "auth", "check"], rejectAny: ["my childhood"], maxWords: 65, allowProjectMention: true, note: "Debug next step in meeting." },
  { id: "unseen_meeting_design_argument", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", history: ["One teammate wants a dashboard, another wants a simpler list."], latest: "Which UI should we choose for the demo?", expectAny: ["demo", "simple", "user", "core", "list"], rejectAny: ["everything"], maxWords: 65, allowProjectMention: true, note: "Concrete decision guidance." },
  { id: "unseen_meeting_unclear_task", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "I don't know what exactly I'm supposed to finish before next meeting.", expectAny: ["clarify", "owner", "task", "deadline", "acceptance"], rejectAny: ["anime"], maxWords: 65, allowProjectMention: true, note: "Clarify task ownership." },
  { id: "unseen_meeting_model_quality", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", history: ["The assistant sometimes gives robotic replies."], latest: "How should we evaluate whether the output is actually natural?", expectAny: ["test", "case", "human", "rubric", "compare"], rejectAny: ["just trust"], maxWords: 75, allowProjectMention: true, note: "SayNext-like meeting but no overclaim." },
  { id: "unseen_meeting_privacy", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "Should we store every transcript forever?", expectAny: ["privacy", "retention", "delete", "consent", "only"], rejectAny: ["yes, everything"], maxWords: 75, allowProjectMention: true, note: "Privacy/product decision." },
  { id: "unseen_meeting_cost", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "The API cost might be too high if we process every transcript.", expectAny: ["filter", "batch", "cache", "important", "only"], rejectAny: ["ignore"], maxWords: 75, allowProjectMention: true, note: "Cost mitigation." },
  { id: "unseen_meeting_bad_data", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "Our test data is too clean compared with real user speech.", expectAny: ["noisy", "asr", "real", "edge", "test"], rejectAny: ["not a problem"], maxWords: 75, allowProjectMention: true, note: "Testing quality discussion." },
  { id: "unseen_meeting_merge_conflict", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "My branch conflicts with the latest main branch.", expectAny: ["pull", "conflict", "small", "merge", "file"], rejectAny: ["cloud"], maxWords: 65, allowProjectMention: true, note: "Practical Git meeting suggestion." },
  { id: "unseen_meeting_present_update", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "Xiang, can you give a quick update?", expectAny: ["finished", "working", "blocker", "next"], rejectAny: ["father"], maxWords: 75, allowProjectMention: true, note: "Quick progress update shape." },
  { id: "unseen_meeting_scope_cut", sourceKind: "unseen_meeting", scene: "Meeting / Group Discussion", latest: "We probably can't finish file upload, search, summary, and sharing by tomorrow.", expectAny: ["must-have", "cut", "demo", "upload", "scope"], rejectAny: ["do all"], maxWords: 75, allowProjectMention: true, note: "Scope cut suggestion." },

  // Public / third-party transcripts: no Xiang leakage.
  { id: "unseen_public_customer", sourceKind: "unseen_public", scene: "Daily Chat", history: ["Customer: I ordered two weeks ago and still have no tracking number."], latest: "Agent: I'm sorry, let me check the shipping status for you.", expectAny: ["tracking", "order", "check", "shipping"], rejectAny: ["xiang", "saynext", "my project"], maxWords: 45, expectNoPersonalMemory: true, note: "Public customer support snippet should stay neutral." },
  { id: "unseen_public_podcast", sourceKind: "unseen_public", scene: "Daily Chat", history: ["Speaker A: I think people are burned out from constant notifications."], latest: "Speaker B: Yeah, phones basically turned into tiny anxiety machines.", expectAny: ["notification", "phone", "anxiety", "yeah", "attention"], rejectAny: ["my phone app", "SayNext"], maxWords: 45, expectNoPersonalMemory: true, note: "Public podcast-like transcript, no self insertion." },
  { id: "unseen_public_meeting", sourceKind: "unseen_public", scene: "Meeting / Group Discussion", history: ["A: The prototype remote has too many buttons.", "B: Users may not understand the mode switch."], latest: "C: Maybe we should make the main button larger and hide advanced settings.", expectAny: ["main", "button", "advanced", "settings", "simple"], rejectAny: ["xiang", "my project"], maxWords: 55, expectNoPersonalMemory: true, note: "Open meeting transcript, neutral design suggestion." },
  { id: "unseen_public_lecture", sourceKind: "unseen_public", scene: "Classroom", latest: "Professor: If the model memorizes the training set, the validation loss starts rising even while training loss keeps falling.", expectAny: ["overfitting", "validation", "training", "generalize"], rejectAny: ["my project", "xiang"], maxWords: 65, expectNoPersonalMemory: true, note: "Public lecture supplement." },

  // Noisy ASR and fragments.
  { id: "unseen_asr_half_question", sourceKind: "unseen_asr", scene: "Daily Chat", latest: "so you mean the thing with your", expectAny: ["Sorry", "last part", "mean"], rejectAny: ["project", "father"], maxWords: 18, note: "Incomplete sentence should not be over-expanded." },
  { id: "unseen_asr_wrong_name", sourceKind: "unseen_asr", scene: "Interview", latest: "Tell me about the google internship you did last winter", expectAny: ["not", "internship", "didn't", "haven't"], rejectAny: ["I worked at Google", "during my Google internship"], maxWords: 80, allowProjectMention: true, note: "Unsupported internship premise." },
  { id: "unseen_asr_question_repair", sourceKind: "unseen_asr", scene: "Classroom", latest: "back prop uh no I mean why gradient vanish happen", expectAny: ["gradient", "vanish", "deep", "activation", "small"], rejectAny: ["saynext"], maxWords: 75, expectNoPersonalMemory: true, note: "Self-corrected noisy technical question." },
  { id: "unseen_asr_reordered", sourceKind: "unseen_asr", scene: "Interview", latest: "for joblens what did you use AWS like the backend was how", expectAny: ["aws", "lambda", "dynamodb", "backend", "joblens"], rejectAny: ["saynext"], maxWords: 90, allowProjectMention: true, note: "Reordered project question." },
  { id: "unseen_asr_bilingual", sourceKind: "unseen_asr", scene: "Daily Chat", latest: "那个 weekend you usually just chill or go out", expectAny: ["usually", "chill", "home", "games", "sometimes"], rejectAny: ["cloud"], maxWords: 45, note: "Mixed Chinese/English input, English output by default." },
  { id: "unseen_asr_attendance", sourceKind: "unseen_asr", scene: "Classroom", latest: "here.", expectAny: ["here"], rejectAny: ["project", "cloud"], maxWords: 12, note: "Attendance-like fragment." },
  { id: "unseen_asr_filler_only", sourceKind: "unseen_asr", scene: "Daily Chat", latest: "uh like you know", expectAny: ["Sorry", "last part", "say"], rejectAny: ["project"], maxWords: 18, note: "Filler-only should ask clarification." },
  { id: "unseen_asr_shopify", sourceKind: "unseen_asr", scene: "Interview", latest: "How did your Shopify production outage experience change your engineering style?", expectAny: ["not", "Shopify", "production", "experience"], rejectAny: ["when I was at Shopify", "outage taught me"], maxWords: 90, allowProjectMention: true, note: "Unsupported work incident premise." },
  { id: "unseen_asr_lost_context", sourceKind: "unseen_asr", scene: "Meeting / Group Discussion", history: ["The team is discussing whether transcript echo detection is too strict."], latest: "wait it swallowed my question", expectAny: ["echo", "threshold", "log", "check", "question"], rejectAny: ["food"], maxWords: 70, allowProjectMention: true, note: "Ambiguous but meeting context helps." },
  { id: "unseen_asr_one_word", sourceKind: "unseen_asr", scene: "Daily Chat", latest: "Same.", expectAny: ["Yeah", "same"], rejectAny: ["project", "career"], maxWords: 15, note: "One-word agreement should stay tiny." },
];

const previousKeys = readPreviousLlmLatestKeys();
const unseenCases = candidateCases.filter((test) => !previousKeys.has(normalizeKey(test.latest))).slice(0, requestedLimit);

async function runCase(test: UnseenCase): Promise<CaseResult> {
  const timestamp = Date.now();
  const transcripts = [...(test.history || []), test.latest];
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: timestamp - (transcripts.length - index) * 1000,
  }));
  const eventMemory = makeEventMemory(test, transcripts);
  const activeSceneProfilePrompt = formatSceneProfile(test.scene);
  const memoryQuery = transcripts.slice(-4).join("\n");
  const relevantPersonalMemoryContext = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 4);
  const memoryRefs = getMemoryRefs(userId, memoryQuery);

  const response = await processConversation(
    conversation,
    "high",
    eventMemory,
    test.language || "english",
    "",
    activeSceneProfilePrompt,
    relevantPersonalMemoryContext,
  );

  const output = response.type === "insight" ? response.output : "";
  const flags = outputFlags(test, output, memoryRefs);
  const verdict = verdictFromFlags(flags);
  return {
    test,
    output,
    flags,
    verdict,
    memoryRefs,
    analysis: analyze(test, output, flags, memoryRefs),
  };
}

function renderReport(results: CaseResult[]): string {
  const good = results.filter((result) => result.verdict === "good").length;
  const watch = results.filter((result) => result.verdict === "watch").length;
  const bad = results.filter((result) => result.verdict === "bad").length;
  const groups = [...new Set(results.map((result) => result.test.sourceKind))];
  const lines: string[] = [];

  lines.push("# LLM Output Unseen Regression");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Provider: ${process.env.LLM_PROVIDER || "openai"}`);
  lines.push(`Model: ${(process.env.LLM_PROVIDER || "openai").toLowerCase() === "ollama" ? process.env.OLLAMA_MODEL : "gpt-4.1-mini"}`);
  lines.push(`Previous llm-output latest keys scanned: ${previousKeys.size}`);
  lines.push(`Candidate unseen cases: ${candidateCases.length}`);
  lines.push(`Selected cases: ${results.length}`);
  lines.push(`Good/watch/bad: ${good}/${watch}/${bad}`);
  lines.push("");
  lines.push("## Groups");
  for (const group of groups) {
    const groupResults = results.filter((result) => result.test.sourceKind === group);
    const groupGood = groupResults.filter((result) => result.verdict === "good").length;
    const groupWatch = groupResults.filter((result) => result.verdict === "watch").length;
    const groupBad = groupResults.filter((result) => result.verdict === "bad").length;
    lines.push(`- ${group}: good/watch/bad ${groupGood}/${groupWatch}/${groupBad}`);
  }
  lines.push("");

  const review = results.filter((result) => result.verdict !== "good");
  if (review.length) {
    lines.push("## Review Needed");
    for (const result of review) {
      lines.push("");
      lines.push(`### ${result.verdict.toUpperCase()} ${result.test.id}`);
      lines.push(`Scene: ${result.test.scene}`);
      lines.push(`Latest: ${result.test.latest}`);
      lines.push(`Output: ${result.output}`);
      lines.push(`Flags: ${result.flags.join(", ")}`);
      lines.push(`Analysis: ${result.analysis}`);
    }
    lines.push("");
  }

  lines.push("## All Cases");
  for (const result of results) {
    lines.push("");
    lines.push(`### ${result.verdict.toUpperCase()} ${result.test.id}`);
    lines.push(`Source: ${result.test.sourceKind}`);
    lines.push(`Scene: ${result.test.scene}`);
    lines.push(`Note: ${result.test.note}`);
    lines.push(`Latest: ${result.test.latest}`);
    if (result.test.history?.length) lines.push(`History: ${result.test.history.join(" / ")}`);
    lines.push(`Output: ${result.output}`);
    lines.push(`Flags: ${result.flags.length ? result.flags.join(", ") : "none"}`);
    if (result.memoryRefs.length) lines.push(`Memory refs: ${result.memoryRefs.slice(0, 6).join(" | ")}`);
  }

  return lines.join("\n");
}

mkdirSync(outputDir, { recursive: true });

const results: CaseResult[] = [];
for (const test of unseenCases) {
  console.log(`Running ${results.length + 1}/${unseenCases.length}: ${test.id}`);
  try {
    results.push(await runCase(test));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      test,
      output: "",
      flags: [`exception:${message}`],
      verdict: "bad",
      memoryRefs: [],
      analysis: `Exception while running case: ${message}`,
    });
  }
}

const report = renderReport(results);
const mdPath = join(outputDir, `llm-output-unseen-${now}.md`);
const jsonlPath = join(outputDir, `llm-output-unseen-${now}.jsonl`);
const metaPath = join(outputDir, `llm-output-unseen-${now}.meta.json`);

writeFileSync(mdPath, report, "utf8");
writeFileSync(jsonlPath, results.map((result) => JSON.stringify(result)).join("\n"), "utf8");
writeFileSync(metaPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  provider: process.env.LLM_PROVIDER || "openai",
  model: (process.env.LLM_PROVIDER || "openai").toLowerCase() === "ollama" ? process.env.OLLAMA_MODEL : "gpt-4.1-mini",
  previousLatestKeys: previousKeys.size,
  candidateCases: candidateCases.length,
  selectedCases: unseenCases.length,
}, null, 2), "utf8");

const good = results.filter((result) => result.verdict === "good").length;
const watch = results.filter((result) => result.verdict === "watch").length;
const bad = results.filter((result) => result.verdict === "bad").length;
console.log(`LLM unseen output regression complete. good/watch/bad=${good}/${watch}/${bad}`);
console.log(`Report: ${mdPath}`);

if (bad > 0) {
  console.log("Bad cases:");
  for (const result of results.filter((item) => item.verdict === "bad").slice(0, 10)) {
    console.log(`- ${result.test.id}: ${result.flags.join(", ")}`);
    console.log(`  output: ${result.output}`);
  }
  process.exitCode = 1;
}
