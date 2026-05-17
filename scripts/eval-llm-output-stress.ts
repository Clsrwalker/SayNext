import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PDFParse } from "pdf-parse";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation, type OutputLanguage } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";

const rawArgs = process.argv.slice(2);
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith("--"));
const userId = positionalArgs[0] || "li2897283405@gmail.com";
const targetCount = Math.max(100, Number(positionalArgs[1] || 110));
const dbPath = positionalArgs[2] || "data/saynext.sqlite";
const randomMode = rawArgs.includes("--random");
const seedArg = rawArgs.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length);
const runSeed = seedArg || new Date().toISOString().replace(/[:.]/g, "-");

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";
type SourceKind = "synthetic" | "db" | "ielts" | "open_dialogue" | "open_meeting" | "open_lecture" | "open_news" | "short_form";

type StressCase = {
  id: string;
  sourceKind: SourceKind;
  scene: SceneKey;
  latest: string;
  history?: string[];
  language?: OutputLanguage;
  expectAny?: string[];
  rejectAny?: string[];
  expectedMemoryRefs?: string[];
  forbiddenMemoryRefs?: string[];
  expectNoMemory?: boolean;
  expectNoPersonalMemory?: boolean;
  maxWords?: number;
  minWords?: number;
  allowProjectMention?: boolean;
  allowChinese?: boolean;
  shouldBeGrounded?: boolean;
  shouldNotOvershare?: boolean;
  desired: string;
};

type CaseResult = {
  test: StressCase;
  memoryRefs: string[];
  output: string;
  flags: string[];
  verdict: "good" | "watch" | "bad";
  analysis: string;
};

type EvalRunMeta = {
  randomMode: boolean;
  seed: string;
  targetCount: number;
  selectedCount: number;
  casePoolSize: number;
  sources: Record<string, string>;
};

type ReportPaths = {
  mdPath: string;
  jsonlPath: string;
  metaPath: string;
};

const DAILY_DIALOG_URL = "https://raw.githubusercontent.com/liuzeming01/XDailyDialog/master/data/1k_part_data/dialogues_text_En.txt";
const AMI_DEV_URL = "https://raw.githubusercontent.com/tsuruoka-lab/AMI-Meeting-Parallel-Corpus/master/dev.json";
const MIT_OCW_PDF_URL = "https://ocw.mit.edu/courses/18-085-computational-science-and-engineering-i-fall-2008/1b9d3132350905168127c7d42421f0a0_18-085F08-L14.pdf";
const IELTS_SPEAKING_URL = "https://huggingface.co/datasets/qwertyuiopasdfg/IELTs-Speaking-answer/resolve/main/ielts_new.json";

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
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

function isPersonalOrProjectMemoryRef(ref: string): boolean {
  const normalized = ref.toLowerCase();
  return normalized.startsWith("xiang-")
    || normalized.startsWith("doc:resume")
    || normalized.startsWith("doc:saynext")
    || normalized.startsWith("doc:elderalbum")
    || normalized.startsWith("doc:joblens")
    || normalized.startsWith("doc:dalparkaid");
}

function memoryRefMatches(ref: string, matcher: string): boolean {
  const normalizedRef = ref.toLowerCase();
  const normalizedMatcher = matcher.toLowerCase();
  return normalizedRef === normalizedMatcher
    || normalizedRef.startsWith(normalizedMatcher)
    || normalizedRef.includes(normalizedMatcher);
}

function shouldDefaultRejectPersonalMemory(test: StressCase): boolean {
  return ["open_dialogue", "open_meeting", "open_lecture", "open_news", "short_form"].includes(test.sourceKind);
}

function memoryProcessFlags(test: StressCase, memoryRefs: string[]): string[] {
  const flags: string[] = [];
  const topRefs = memoryRefs.slice(0, 3);

  if (test.expectedMemoryRefs?.length && !topRefs.some((ref) => test.expectedMemoryRefs?.includes(ref))) {
    flags.push(`process_missing_expected_memory:${test.expectedMemoryRefs.join("|")}`);
  }

  if (test.expectNoMemory && memoryRefs.length > 0) {
    flags.push(`process_unexpected_memory:${memoryRefs.join("|")}`);
  }

  const rejectPersonalMemory = test.expectNoPersonalMemory ?? shouldDefaultRejectPersonalMemory(test);
  const personalRefs = rejectPersonalMemory ? memoryRefs.filter(isPersonalOrProjectMemoryRef) : [];
  if (personalRefs.length) {
    flags.push(`process_unexpected_personal_memory:${personalRefs.join("|")}`);
  }

  const forbiddenRefs = test.forbiddenMemoryRefs ?? [];
  const forbiddenHits = forbiddenRefs.length
    ? memoryRefs.filter((ref) => forbiddenRefs.some((matcher) => memoryRefMatches(ref, matcher)))
    : [];
  if (forbiddenHits.length) {
    flags.push(`process_forbidden_memory:${forbiddenHits.join("|")}`);
  }

  return flags;
}

function takeEvery<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const picked: T[] = [];
  for (let i = 0; i < items.length && picked.length < count; i += step) {
    picked.push(items[Math.floor(i)]);
  }
  return picked;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded<T>(items: T[], seed: string): T[] {
  const rng = mulberry32(hashSeed(seed));
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SayNext local LLM stress evaluation",
      "Accept": "text/plain,application/json,application/pdf,*/*",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function makeEventMemory(test: StressCase, transcripts: string[]): EventMemorySnapshot {
  const sceneMap: Record<SceneKey, string> = {
    "Daily Chat": "daily_chat",
    "Classroom": "classroom",
    "Interview": "interview",
    "Meeting / Group Discussion": "group_discussion",
  };

  return {
    eventId: `stress-${test.id}`,
    scene: sceneMap[test.scene],
    title: transcripts[0]?.slice(0, 80) || sceneMap[test.scene],
    summary: `Stress eval source=${test.sourceKind}; desired=${test.desired}; recent=${transcripts.slice(-3).join(" / ")}`,
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function formatSceneProfile(scene: SceneKey): string {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === scene);
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${scene}`;
}

function outputFlags(test: StressCase, output: string, memoryRefs: string[] = []): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  const latest = compact(test.latest).toLowerCase();

  flags.push(...memoryProcessFlags(test, memoryRefs));

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|you could say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("label_or_meta_prefix");
  if (/\b(just say|you can mention|would work here|since there'?s no|the best answer|referring to|casual acknowledgment|professor is asking)\b/i.test(output)) flags.push("meta_instruction_in_output");
  if (normalized.includes("as an ai")) flags.push("as_an_ai");
  if (normalized.includes("today i plan")) flags.push("robotic_today_i_plan");
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (test.minWords && wordCount(output) < test.minWords) flags.push(`too_short:${wordCount(output)}<${test.minWords}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (!test.allowChinese && test.language !== "chinese" && hasChinese(output)) flags.push("unexpected_chinese");

  if (test.sourceKind !== "open_dialogue" && /^(and|yeah|yes|right|present|water|thank you|me too|good idea)[.!?\s]*$/i.test(latest)) {
    if (wordCount(output) > 10) flags.push("fragment_overexpanded");
    if (/\b(what'?s up|how are things going|what were you thinking|do you want me to|have you talked to anyone)\b/i.test(output)) {
      flags.push("fragment_invented_new_topic");
    }
  }

  if (/^present[.!?\s]*$/i.test(latest) && !/\b(present|here|i'?m here)\b/i.test(output)) {
    flags.push("attendance_wrong_reply");
  }

  const projectTermPattern = /\b(saynext|say next|elder album|elderalbum|joblens|dalparkaid|dal parking|aws|lambda|dynamodb|firebase)\b/i;
  const transcriptAllowsProject = includesAny(test.latest, [
    "project", "saynext", "say next", "elder", "joblens", "dalparkaid", "aws", "lambda", "dynamodb", "firebase", "cloud",
  ]);
  if (!test.allowProjectMention && !transcriptAllowsProject && projectTermPattern.test(output)) {
    flags.push("unwanted_project_or_tech_mention");
  }

  const sensitiveTerms = [
    "father", "passed away", "bullying", "fatty liver", "uric acid", "permanent residency",
    "pr goal", "family was financially", "financially well-off", "romantic experience",
  ];
  if (test.shouldNotOvershare !== false && includesAny(output, sensitiveTerms)) {
    flags.push("sensitive_overshare");
  }

  if (test.sourceKind.startsWith("open_") && includesAny(output, [
    "xiang",
    "my sister",
    "my brother",
    "my family",
    "my mom",
    "my dad",
    "my childhood",
    "when i was a child",
    "back in chengdu",
    "my macs",
    "dalhousie",
    "chengdu",
    "my project",
    "saynext",
    "my coding",
    "video games and coding",
    "i'll be working on",
    "backend development",
  ])) {
    flags.push("personal_leak_on_public_transcript");
  }

  if (/\b(name|pronounce|pronunciation|called)\b/i.test(test.latest) && /\bdaewon\b/i.test(output)) {
    flags.push("wrong_identity_name");
  }

  const personalExampleQuestion = /\b(describe|tell me about|a time when|an occasion when|have you ever|did you have|did you like|do you have a favou?rite|when you were young|when you were a child)\b/i.test(test.latest);
  const highRiskUnsupportedDetail = /\b(?:Mr|Ms|Mrs|Dr)\.\s+[A-Z][a-z]+|\b(?:in 20\d{2}|last semester|last year|at [A-Z][A-Za-z]+ (?:University|College|High School|School)|worked at [A-Z][A-Za-z]+|intern(?:ed)? at [A-Z][A-Za-z]+)\b/i.test(output);
  if (test.sourceKind === "ielts" && personalExampleQuestion && memoryRefs.length === 0 && highRiskUnsupportedDetail) {
    flags.push("ungrounded_high_risk_personal_detail");
  }

  return flags;
}

function analyzeOutput(test: StressCase, output: string, flags: string[], memoryRefs: string[]): string {
  const parts: string[] = [];
  if (flags.length === 0) {
    parts.push("Looks usable for the target scene.");
  } else {
    parts.push(`Needs review: ${flags.join(", ")}.`);
  }

  if (test.scene === "Daily Chat") {
    parts.push("Daily target: short, natural, no unnecessary project/career details.");
  } else if (test.scene === "Classroom") {
    parts.push("Classroom target: answer or supplement the concept, not repeat the speaker.");
  } else if (test.scene === "Interview") {
    parts.push("Interview target: grounded, concrete, not senior/fake.");
  } else {
    parts.push("Meeting target: move the task forward with one practical next step.");
  }

  if (memoryRefs.length) parts.push(`Memory used: ${memoryRefs.slice(0, 3).join(" | ")}.`);
  if (wordCount(output) > 70) parts.push("Output is fairly long for real-time display.");
  return parts.join(" ");
}

function makeSyntheticCases(): StressCase[] {
  const expectedMemoryById: Record<string, string[]> = {
    daily_lunch: ["xiang-profile:lifestyle-food-health"],
    daily_music: ["xiang-update:2026-05:music-listening", "xiang-profile:game-scripting-music"],
    daily_parks: ["xiang-update:2026-05:parks-going-out"],
    daily_sleep: ["xiang-update:2026-05:sleep-routine"],
    daily_fruit: ["xiang-update:2026-05:fruit"],
    daily_sports: ["xiang-update:2026-05:swimming"],
    class_dl: ["knowledge:cs-interview:deep-learning"],
    class_overfit: ["knowledge:cs-interview:ml-fundamentals"],
    class_recommender: ["knowledge:cs-interview:recommender-systems"],
    class_cloud_cost: ["knowledge:cs-interview:serverless-lambda", "knowledge:cs-interview:aws-well-architected"],
    class_cap: ["knowledge:cs-interview:distributed-systems"],
    class_index: ["knowledge:cs-interview:database-sql"],
    class_network: ["knowledge:cs-interview:networking-web-protocols"],
    class_security: ["knowledge:cs-interview:security-web-app"],
    interview_self: ["xiang-profile:identity-education"],
    interview_why_cs: ["xiang-update:2026-05:why-computer-science"],
    interview_job: ["xiang-update:2026-05:future-job"],
    interview_saynext: ["doc:saynext:positioning", "doc:saynext:runtime-flow", "xiang-profile:project-saynext"],
    interview_elder: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"],
    interview_dalpark: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"],
    interview_joblens: ["doc:joblens:overview-problem", "doc:joblens:workflow-features"],
    interview_bug: ["xiang-behavioral:saynext-hard-bug-context", "xiang-behavioral:saynext-local-llm-json-latency"],
    interview_conflict: ["xiang-behavioral:team-disagreement-pattern"],
    interview_feedback: ["xiang-behavioral:constructive-feedback-ai-like"],
    interview_failure: ["xiang-behavioral:saynext-prompt-failure"],
    asr_project_next: ["doc:saynext:positioning", "doc:saynext:interview-story", "xiang-profile:project-saynext"],
    asr_cloud_why: ["xiang-update:2026-05:favorite-subjects", "knowledge:cs-interview:aws-well-architected"],
    asr_lambda: ["knowledge:cs-interview:serverless-lambda"],
    asr_supervise: ["knowledge:cs-interview:ml-fundamentals"],
    asr_what_school: ["xiang-profile:china-school-history"],
    asr_game: ["xiang-profile:favorite-games", "xiang-profile:games-general"],
  };
  const noMemoryIds = new Set(["asr_and", "asr_definitely", "asr_noise", "asr_present"]);
  const forbidProjectForTechnicalIds = new Set([
    "class_dl",
    "class_overfit",
    "class_regularization",
    "class_cnn",
    "class_recommender",
    "class_cloud_cost",
    "class_cap",
    "class_index",
    "class_network",
    "class_security",
    "asr_lambda",
    "asr_supervise",
  ]);
  const cases: StressCase[] = [
    ["daily_cold", "Daily Chat", "It's freezing outside today.", ["cold", "yeah", "outside", "halifax"], ["project", "career"], 24],
    ["daily_lunch", "Daily Chat", "What did you eat for lunch?", ["fried", "takeout", "food", "chicken", "simple"], ["cloud", "aws"], 35],
    ["daily_anime", "Daily Chat", "Do you watch anime?", ["anime", "watch", "popular", "yeah"], ["project", "career"], 40],
    ["daily_music", "Daily Chat", "Where do you usually listen to music?", ["headphones", "alone", "anywhere", "quiet"], ["cloud", "project"], 45],
    ["daily_parks", "Daily Chat", "Do you go outside often?", ["park", "sometimes", "not really", "walk"], ["career", "aws"], 45],
    ["daily_shopping", "Daily Chat", "Do you like shopping in stores?", ["online", "delivery", "superstore", "not really"], ["project"], 45],
    ["daily_clothes", "Daily Chat", "What kind of clothes do you usually wear?", ["black", "simple", "white", "don't care"], ["cloud"], 45],
    ["daily_sleep", "Daily Chat", "What time do you usually sleep?", ["irregular", "late", "depends", "project"], ["father", "family"], 45],
    ["daily_fruit", "Daily Chat", "What's your favorite fruit?", ["pineapple", "orange", "sweet", "sour"], ["project"], 35],
    ["daily_sports", "Daily Chat", "Are you good at any sport?", ["swimming", "swim", "freestyle", "breaststroke"], ["cloud"], 45],

    ["class_dl", "Classroom", "Why do neural networks need backpropagation?", ["gradient", "loss", "weight", "error"], ["my project"], 60],
    ["class_overfit", "Classroom", "What is overfitting in machine learning?", ["training", "generalize", "unseen", "validation"], ["saynext"], 60],
    ["class_regularization", "Classroom", "How does regularization help a model?", ["penalty", "overfit", "complex", "generalization"], ["my project"], 65],
    ["class_cnn", "Classroom", "Why are CNNs useful for images?", ["spatial", "filters", "features", "local"], ["career"], 65],
    ["class_recommender", "Classroom", "What's the difference between collaborative filtering and content-based recommendation?", ["user", "item", "similar", "features"], ["saynext"], 75],
    ["class_cloud_cost", "Classroom", "Why does serverless reduce operational overhead but not always cost?", ["manage", "scale", "usage", "cold", "control"], ["my elder"], 75],
    ["class_cap", "Classroom", "Can you explain CAP theorem quickly?", ["consistency", "availability", "partition"], ["project"], 65],
    ["class_index", "Classroom", "Why does a database index make reads faster?", ["lookup", "scan", "write", "storage"], ["my project"], 65],
    ["class_network", "Classroom", "What happens in a TCP three-way handshake?", ["syn", "ack", "connection"], ["project"], 60],
    ["class_security", "Classroom", "Why should passwords be hashed and salted?", ["hash", "salt", "rainbow", "leak"], ["project"], 65],

    ["interview_self", "Interview", "Tell me about yourself.", ["xiang", "macs", "dalhousie"], ["father", "bullying", "best candidate"], 70],
    ["interview_why_cs", "Interview", "Why did you choose computer science?", ["money", "project", "interested", "computer"], ["passionate since childhood"], 80],
    ["interview_job", "Interview", "What kind of role are you looking for?", ["software", "mobile", "web", "ai", "cloud"], ["dream job", "best candidate"], 60],
    ["interview_saynext", "Interview", "Explain SayNext as a project.", ["mobile", "conversation", "real-time", "memory"], ["smart glasses app", "production users"], 90],
    ["interview_elder", "Interview", "Tell me about your AWS project.", ["elder", "album", "lambda", "dynamodb", "s3"], ["production scale"], 90],
    ["interview_dalpark", "Interview", "Tell me about your React Native parking project.", ["parking", "react native", "dal", "weather", "timetable"], ["aws lambda"], 90],
    ["interview_joblens", "Interview", "What was JobLens AI?", ["resume", "job", "matching", "aws"], ["saynext"], 90],
    ["interview_bug", "Interview", "Tell me about a hard bug.", ["context", "stale", "debug", "saynext"], ["company", "production incident"], 95],
    ["interview_conflict", "Interview", "Tell me about a teammate conflict.", ["technical", "scope", "deadline", "trade-off"], ["fight", "angry"], 90],
    ["interview_feedback", "Interview", "What constructive feedback have you received?", ["ai-like", "natural", "feedback", "changed"], ["senior engineer at work"], 90],
    ["interview_failure", "Interview", "Tell me about a failure and what you learned.", ["rigid", "prompt", "template", "learned"], ["company"], 95],
    ["interview_above", "Interview", "Tell me about a time you went above and beyond.", ["saynext", "memory", "prenote", "scene"], ["production"], 95],
    ["interview_independent", "Interview", "Tell me about a time you worked independently.", ["saynext", "tested", "logs", "learned"], ["company"], 95],
    ["interview_no_conflict", "Interview", "What if you never had a dramatic conflict?", ["technical", "disagreement", "not personal", "trade-off"], ["fake"], 80],
    ["interview_code_review_feedback", "Interview", "How would you answer harsh code review feedback?", ["calm", "specific", "feedback", "improvement"], ["my senior at work"], 80],

    ["meeting_api", "Meeting / Group Discussion", "We still do not have the API response schema from backend.", ["mock", "schema", "assumption", "contract"], ["that's nice"], 55],
    ["meeting_scope", "Meeting / Group Discussion", "We have too many features before the demo.", ["core", "demo", "scope", "working"], ["everything"], 55],
    ["meeting_bug", "Meeting / Group Discussion", "The upload works locally but fails after deployment.", ["logs", "environment", "config", "network"], ["how about you"], 60],
    ["meeting_db", "Meeting / Group Discussion", "The DynamoDB query is getting slow.", ["access pattern", "index", "gsi", "query"], ["my favorite"], 65],
    ["meeting_ui", "Meeting / Group Discussion", "Users were confused by the Add button.", ["tooltip", "explain", "clearer", "button"], ["cloud"], 60],
    ["meeting_deadline", "Meeting / Group Discussion", "We only have two days before submission.", ["critical", "deadline", "focus", "complete"], ["sleep"], 55],
    ["meeting_disagree", "Meeting / Group Discussion", "I think we should add notifications before fixing the matching bug.", ["bug", "core", "priority", "demo"], ["fight"], 65],
    ["meeting_unknown", "Meeting / Group Discussion", "I'm not sure which branch has the latest code.", ["check", "main", "compare", "merge"], ["aws"], 60],
    ["meeting_report", "Meeting / Group Discussion", "What should I say for my progress update?", ["finished", "working", "blocker", "next"], ["father"], 60],
    ["meeting_risk", "Meeting / Group Discussion", "This design may expose private user data.", ["privacy", "access", "permission", "store"], ["whatever"], 65],

    ["asr_and", "Daily Chat", "And.", [], ["father", "project", "cloud", "career"], 18],
    ["asr_definitely", "Daily Chat", "Definitely.", [], ["father", "project", "aws"], 18],
    ["asr_project_next", "Interview", "What project you did for next", ["saynext", "conversation", "assistant"], ["elder album"], 55],
    ["asr_cloud_why", "Classroom", "that cloud architecture why", ["availability", "cost", "scalability", "resilience", "cloud"], ["my project"], 70],
    ["asr_lambda", "Classroom", "lambda cold start not my", ["cold start", "container", "latency", "warm"], ["elder album"], 70],
    ["asr_supervise", "Classroom", "how do you know about answer supervise learning", ["labeled", "input", "output", "training"], ["saynext"], 75],
    ["asr_noise", "Daily Chat", "This whole gargle might hairy nuts set you naughty people.", [], ["father", "project", "cloud", "career"], 18],
    ["asr_present", "Classroom", "Present.", [], ["project", "cloud architecture", "family"], 15],
    ["asr_what_school", "Daily Chat", "What school you studying? What high school you studying in China?", ["shishi", "peking", "affiliated", "chengdu"], ["aubrey"], 65],
    ["asr_game", "Daily Chat", "What game you played?", ["genshin", "pokemon", "gacha", "open-world", "games"], ["cloud"], 60],
  ].map(([id, scene, latest, expectAny, rejectAny, maxWords]) => ({
    id: String(id),
    sourceKind: "synthetic" as const,
    scene: scene as SceneKey,
    latest: String(latest),
    expectAny: expectAny as string[],
    rejectAny: rejectAny as string[],
    expectedMemoryRefs: expectedMemoryById[String(id)],
    expectNoMemory: noMemoryIds.has(String(id)),
    forbiddenMemoryRefs: forbidProjectForTechnicalIds.has(String(id))
      ? ["xiang-", "doc:saynext", "doc:elderalbum", "doc:joblens", "doc:dalparkaid", "doc:resume"]
      : undefined,
    maxWords: maxWords as number,
    allowProjectMention: String(id).includes("interview") || String(id).includes("project") || String(id).includes("meeting"),
    shouldBeGrounded: true,
    desired: "Synthetic edge case with explicit rubric.",
  }));

  cases.push({
    id: "zh_daily_weekend",
    sourceKind: "synthetic",
    scene: "Daily Chat",
    latest: "你周末一般干嘛？",
    language: "chinese",
    allowChinese: true,
    expectAny: ["游戏", "休息", "动漫", "家", "可能"],
    rejectAny: ["aws", "cloud"],
    expectedMemoryRefs: ["xiang-profile:favorite-games", "xiang-profile:games-general", "xiang-profile:lifestyle-food-health"],
    maxWords: 45,
    desired: "Chinese mode should answer naturally in Chinese.",
  });

  return cases;
}

function inferSceneFromTranscript(text: string): SceneKey {
  const q = text.toLowerCase();
  if (includesAny(q, ["interview", "candidate", "hire", "tell me about yourself", "project you did", "project name"])) return "Interview";
  if (includesAny(q, ["lambda", "learning", "professor", "class", "course", "architecture", "supervised", "unsupervised", "reinforcement"])) return "Classroom";
  if (includesAny(q, ["team", "backend", "api", "deadline", "demo", "branch", "meeting"])) return "Meeting / Group Discussion";
  return "Daily Chat";
}

function makeDbCases(limit: number): StressCase[] {
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.query(`
      SELECT id, transcript
      FROM conversation_samples
      WHERE user_id = ? AND LENGTH(TRIM(transcript)) BETWEEN 3 AND 220
      ORDER BY id ASC
    `).all(userId) as Array<{ id: number; transcript: string }>;

    const candidates = rows.filter((row) => {
      const text = compact(row.transcript);
      if (!text) return false;
      if (/^\d+$/.test(text)) return false;
      return true;
    });

    return takeEvery(candidates, limit).map((row) => {
      const scene = inferSceneFromTranscript(row.transcript);
      return {
        id: `db_${row.id}`,
        sourceKind: "db",
        scene,
        latest: row.transcript,
        rejectAny: ["father", "passed away", "fatty liver", "permanent residency", "family was financially"],
        maxWords: scene === "Interview" ? 95 : scene === "Classroom" ? 75 : 45,
        allowProjectMention: includesAny(row.transcript, ["project", "saynext", "elder", "joblens", "parking", "aws", "cloud", "lambda"]),
        shouldNotOvershare: true,
        desired: "Replay old database transcript through current model and avoid stale/overshared output.",
      };
    });
  } catch (error) {
    console.warn(`[stress] DB cases skipped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function makeIeltsStressCase(question: string, index: number, sourceId = "ielts"): StressCase {
  const latest = compact(question);
  const allowsProject = includesAny(latest, [
    "project", "technology", "computer", "work", "job", "study", "school", "university", "teamwork", "future",
  ]);
  const isNarrativePrompt = /^(describe|tell me about|talk about)\b/i.test(latest);

  return {
    id: `${sourceId}_${index + 1}`,
    sourceKind: "ielts",
    scene: "Daily Chat",
    latest,
    rejectAny: ["passed away", "fatty liver", "uric acid", "permanent residency", "family was financially", "financially well-off"],
    maxWords: allowsProject || isNarrativePrompt ? 70 : 55,
    allowProjectMention: allowsProject,
    shouldNotOvershare: true,
    desired: "IELTS-style speaking question should get a natural Xiang-style answer without oversharing or sounding scripted.",
  };
}

function makeLocalIeltsCases(limit: number): StressCase[] {
  try {
    const source = readFileSync(join(process.cwd(), "scripts", "eval-ielts-speaking-memory.ts"), "utf8");
    const matches = [...source.matchAll(/\{\s*topic:\s*"[^"]+",\s*q:\s*"([^"]+)"/g)];
    return takeEvery(matches.map((match) => match[1]).filter(Boolean), limit).map((question, index) => makeIeltsStressCase(question, index, "ielts_local"));
  } catch (error) {
    console.warn(`[stress] local IELTS fallback skipped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function makeIeltsCases(limit: number): Promise<StressCase[]> {
  try {
    const raw = await fetchText(IELTS_SPEAKING_URL);
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed && Array.isArray((parsed as { train?: unknown[] }).train)
        ? (parsed as { train: unknown[] }).train
        : [];

    const questions = rows
      .map((row) => {
        if (!row || typeof row !== "object") return "";
        const item = row as { instruction?: unknown; question?: unknown; prompt?: unknown };
        return compact(String(item.instruction || item.question || item.prompt || ""));
      })
      .filter((question) => question.length >= 8 && question.length <= 180);

    if (!questions.length) return makeLocalIeltsCases(limit);
    return takeEvery(questions, limit).map((question, index) => makeIeltsStressCase(question, index));
  } catch (error) {
    console.warn(`[stress] remote IELTS loader skipped: ${error instanceof Error ? error.message : String(error)}`);
    return makeLocalIeltsCases(limit);
  }
}

async function makeOpenDialogueCases(limit: number): Promise<StressCase[]> {
  const text = await fetchText(DAILY_DIALOG_URL);
  const dialogues = text
    .split(/\r?\n/)
    .map((line) => line.split("__eou__").map(compact).filter(Boolean))
    .filter((turns) => turns.length >= 2);

  return takeEvery(dialogues, limit).map((turns, index) => ({
    id: `open_dialogue_${index + 1}`,
    sourceKind: "open_dialogue",
    scene: "Daily Chat",
    history: turns.slice(0, -1).slice(-3),
    latest: turns.slice(-1)[0],
    rejectAny: ["xiang", "saynext", "dalhousie", "chengdu", "macs", "father", "aws", "lambda", "dynamodb", "coding", "video games"],
    maxWords: 35,
    desired: "Public open-domain dialogue should get a natural reply without leaking Xiang personal/project memory.",
  }));
}

async function makeOpenMeetingCases(limit: number): Promise<StressCase[]> {
  const raw = await fetchText(AMI_DEV_URL);
  const docs = JSON.parse(raw) as Array<{ id: string; conversation: Array<{ en_speaker: string; en_sentence: string }> }>;
  const chunks: StressCase[] = [];

  for (const doc of docs.slice(0, 5)) {
    const turns = doc.conversation
      .map((turn) => `${turn.en_speaker}: ${compact(turn.en_sentence)}`)
      .filter((line) => line.length > 10);

    for (let i = 0; i < turns.length && chunks.length < limit; i += 8) {
      const history = turns.slice(i, i + 3);
      const latest = turns[i + 3] || turns[i + 2];
      if (!latest) continue;
      chunks.push({
        id: `open_meeting_${chunks.length + 1}`,
        sourceKind: "open_meeting",
        scene: "Meeting / Group Discussion",
        history,
        latest,
        rejectAny: ["xiang", "saynext", "dalhousie", "chengdu", "macs", "father", "backend development", "i'll be working on"],
        maxWords: 60,
        desired: "Open meeting transcript should produce one practical meeting-style sentence, no personal memory leak.",
      });
    }
  }

  return chunks;
}

async function makeOpenLectureCases(limit: number): Promise<StressCase[]> {
  const response = await fetch(MIT_OCW_PDF_URL);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for MIT OCW PDF`);
  const parser = new PDFParse({ data: Buffer.from(await response.arrayBuffer()) });
  try {
    const parsed = await parser.getText();
    const words = compact(parsed.text).split(/\s+/);
    const cases: StressCase[] = [];
    for (let i = 0; i < words.length && cases.length < limit; i += 90) {
      const chunk = words.slice(i, i + 90).join(" ");
      if (chunk.length < 120) continue;
      cases.push({
        id: `open_lecture_${cases.length + 1}`,
        sourceKind: "open_lecture",
        scene: "Classroom",
        latest: chunk,
        rejectAny: ["xiang", "saynext", "dalhousie", "chengdu", "macs", "father"],
        maxWords: 70,
        desired: "Open lecture transcript should get a concise concept supplement/question, no personal memory leak.",
      });
    }
    return cases;
  } finally {
    await parser.destroy();
  }
}

function makeShortFormCases(): StressCase[] {
  return [
    "The easiest way to make a group project worse is pretending everything is fine until the deadline. Say the blocker early, even if it feels awkward.",
    "If you are learning a new skill, stop waiting until you feel ready. Just make the bad first version, because the first version is supposed to be kind of ugly.",
    "People romanticize working all night, but most of the time it just means you started too late and tomorrow you will feel like a low battery laptop.",
    "Here is a simple explanation of cloud storage. Instead of keeping files only on your own computer, you store them on remote servers and access them through the internet.",
    "A lot of people think confidence means acting like you know everything. Honestly, it is more like being comfortable saying you are not sure and still trying the next step.",
    "This is why people get confused by AI tools. They expect magic, but most of the real value comes from giving the tool better context and checking the output like a normal person.",
    "Three small habits that helped me save money: stop buying random drinks outside, check subscriptions once a month, and do not open food delivery apps when you are already hungry.",
    "If you are watching this before an interview, remember this. You do not need a perfect answer. You need a clear answer with one real example and one thing you learned.",
    "Nobody tells you this about debugging. Half of the job is not writing clever code, it is figuring out which assumption was wrong.",
    "In a meeting, the most useful person is often not the loudest person. It is the person who can turn a vague problem into the next concrete step.",
  ].map((latest, index) => ({
    id: `short_form_${index + 1}`,
    sourceKind: "short_form",
    scene: index === 0 || index === 9 ? "Meeting / Group Discussion" : index === 3 || index === 5 || index === 8 ? "Classroom" : "Daily Chat",
    latest,
    rejectAny: ["saynext", "dalhousie", "chengdu", "macs", "father", "elder album"],
    maxWords: 55,
    desired: "Short public-style monologue should not trigger personal/project memory unless directly relevant.",
  })) as StressCase[];
}

async function buildCases(): Promise<StressCase[]> {
  const all: StressCase[] = [];
  all.push(...makeSyntheticCases());
  all.push(...makeDbCases(50));

  const loaders: Array<() => Promise<StressCase[]>> = [
    () => makeIeltsCases(216),
    () => makeOpenDialogueCases(40),
    () => makeOpenMeetingCases(30),
    () => makeOpenLectureCases(20),
  ];
  for (const loader of loaders) {
    try {
      all.push(...await loader());
    } catch (error) {
      console.warn(`[stress] open source loader skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  all.push(...makeShortFormCases());

  const seen = new Set<string>();
  return all.filter((test) => {
    const key = `${test.sourceKind}:${compact(test.latest).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function evaluateCase(test: StressCase): Promise<CaseResult> {
  const timestamp = Date.now();
  const transcripts = [...(test.history ?? []), test.latest];
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: timestamp + index,
  }));

  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.latest, 3);
  const response = await processConversation(
    conversation,
    "high",
    makeEventMemory(test, transcripts),
    test.language ?? "english",
    "",
    formatSceneProfile(test.scene),
    relevantMemory,
  );

  const output = response.type === "insight" ? response.output : "";
  const memoryRefs = conversationLogger.searchPersonalMemoriesHybrid(userId, test.latest, 3).map((memory) => memory.sourceRef || memory.title);
  const flags = outputFlags(test, output, memoryRefs);
  const verdict: CaseResult["verdict"] = flags.some((flag) => flag.startsWith("process_") || flag.includes("sensitive") || flag.includes("personal_leak") || flag.includes("contains_rejected")) ? "bad" : flags.length ? "watch" : "good";

  return {
    test,
    memoryRefs,
    output,
    flags,
    verdict,
    analysis: analyzeOutput(test, output, flags, memoryRefs),
  };
}

function writeReport(results: CaseResult[], meta: EvalRunMeta): ReportPaths {
  const dir = join(process.cwd(), "data", "eval");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(dir, `llm-output-stress-${stamp}.md`);
  const jsonlPath = join(dir, `llm-output-stress-${stamp}.jsonl`);
  const metaPath = join(dir, `llm-output-stress-${stamp}.meta.json`);

  const byKind = new Map<string, { total: number; good: number; watch: number; bad: number }>();
  for (const result of results) {
    const stat = byKind.get(result.test.sourceKind) ?? { total: 0, good: 0, watch: 0, bad: 0 };
    stat.total += 1;
    stat[result.verdict] += 1;
    byKind.set(result.test.sourceKind, stat);
  }

  const lines: string[] = [
    "# SayNext LLM Output Stress Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Provider: ${process.env.LLM_PROVIDER || "openai"}`,
    `Model: ${process.env.OLLAMA_MODEL || "openai"}`,
    `Random mode: ${meta.randomMode ? "yes" : "no"}`,
    `Seed: ${meta.seed}`,
    `Case pool size: ${meta.casePoolSize}`,
    `Cases: ${results.length}`,
    `Good: ${results.filter((r) => r.verdict === "good").length}`,
    `Watch: ${results.filter((r) => r.verdict === "watch").length}`,
    `Bad: ${results.filter((r) => r.verdict === "bad").length}`,
    "",
    "## Summary By Source",
    "",
    "| Source | Total | Good | Watch | Bad |",
    "|---|---:|---:|---:|---:|",
    ...[...byKind.entries()].sort().map(([kind, stat]) => `| ${kind} | ${stat.total} | ${stat.good} | ${stat.watch} | ${stat.bad} |`),
    "",
    "## Sources",
    "",
    ...Object.entries(meta.sources).map(([name, url]) => `- ${name}: ${url}`),
    "",
    "## Case Analysis",
    "",
  ];

  for (const [index, result] of results.entries()) {
    lines.push(
      `### ${index + 1}. ${result.test.id} [${result.verdict.toUpperCase()}]`,
      "",
      `- Source: ${result.test.sourceKind}`,
      `- Scene: ${result.test.scene}`,
      `- Desired: ${result.test.desired}`,
      `- Flags: ${result.flags.length ? result.flags.join(", ") : "none"}`,
      `- Memory: ${result.memoryRefs.join(" | ") || "none"}`,
      "",
      "**Transcript**",
      "",
      "```text",
      result.test.latest,
      "```",
      "",
      "**Output**",
      "",
      "```text",
      result.output,
      "```",
      "",
      "**Analysis**",
      "",
      result.analysis,
      "",
    );
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonlPath, results.map((result) => JSON.stringify(result)).join("\n"), "utf8");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  return { mdPath, jsonlPath, metaPath };
}

const cases = await buildCases();
if (cases.length < 100) {
  console.warn(`[stress] only built ${cases.length} cases; adding more synthetic repeats with ASR variants`);
  const extra = makeSyntheticCases().map((test, index) => ({
    ...test,
    id: `extra_${index + 1}_${test.id}`,
    latest: `${test.latest} ${index % 2 === 0 ? "uh" : ""}`.trim(),
  }));
  cases.push(...extra.slice(0, 100 - cases.length));
}

const selected = (randomMode ? shuffleSeeded(cases, runSeed) : cases).slice(0, targetCount);
const meta: EvalRunMeta = {
  randomMode,
  seed: runSeed,
  targetCount,
  selectedCount: selected.length,
  casePoolSize: cases.length,
  sources: {
    ielts: IELTS_SPEAKING_URL,
    dailyDialogue: DAILY_DIALOG_URL,
    meetingTranscript: AMI_DEV_URL,
    lectureTranscript: MIT_OCW_PDF_URL,
    localDatabase: dbPath,
    synthetic: "scripts/eval-llm-output-stress.ts",
  },
};
const results: CaseResult[] = [];
const start = Date.now();
console.log(`LLM_OUTPUT_STRESS provider=${process.env.LLM_PROVIDER || "openai"} model=${process.env.OLLAMA_MODEL || "openai"} cases=${selected.length} pool=${cases.length} random=${randomMode ? "yes" : "no"} seed=${runSeed}`);

for (const [index, test] of selected.entries()) {
  const result = await evaluateCase(test);
  results.push(result);
  console.log(`[${index + 1}/${selected.length}] ${result.verdict.toUpperCase()} ${test.id}: ${result.output}`);
  if (result.flags.length) console.log(`  flags=${result.flags.join(", ")}`);
}

const reportPaths = writeReport(results, meta);
const good = results.filter((result) => result.verdict === "good").length;
const watch = results.filter((result) => result.verdict === "watch").length;
const bad = results.filter((result) => result.verdict === "bad").length;
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`LLM_OUTPUT_STRESS_DONE cases=${results.length} good=${good} watch=${watch} bad=${bad} elapsedSec=${elapsed}`);
console.log(`report=${reportPaths.mdPath}`);
console.log(`jsonl=${reportPaths.jsonlPath}`);
console.log(`meta=${reportPaths.metaPath}`);

if (bad > 0) {
  process.exitCode = 1;
}
