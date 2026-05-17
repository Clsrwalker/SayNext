import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import {
  generateTelepromptScript,
  type OutputLanguage,
} from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import {
  makeTelepromptOpeningLine,
  shouldStartTeleprompt,
  TelepromptRuntime,
} from "../src/server/teleprompt/teleprompt-runtime";

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";
type TargetMode = "expandable" | "long";
type SourceKind = "ielts" | "interview" | "presentation" | "meeting" | "technical" | "daily" | "asr";

type StressCase = {
  id: string;
  scene: SceneKey;
  sourceKind: SourceKind;
  latest: string;
  history?: string[];
  targetMode: TargetMode;
  expectedStart?: ReturnType<typeof shouldStartTeleprompt>;
  language?: OutputLanguage;
  expectAny?: string[];
  rejectAny?: string[];
  expectedMemoryRefs?: string[];
  forbiddenMemoryRefs?: string[];
  expectNoPersonalMemory?: boolean;
  desired: string;
};

type CaseResult = {
  test: StressCase;
  startActual: ReturnType<typeof shouldStartTeleprompt>;
  memoryRefs: string[];
  openingLine: string;
  script: string;
  chunks: number;
  wordCount: number;
  flags: string[];
  verdict: "good" | "watch" | "bad";
};

const rawArgs = process.argv.slice(2);
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith("--"));
const userId = positionalArgs[0] || "li2897283405@gmail.com";
const targetCount = Math.max(20, Number(positionalArgs[1] || 32));
const seedArg = rawArgs.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length);
const seed = seedArg || new Date().toISOString().replace(/[:.]/g, "-");
const randomMode = rawArgs.includes("--random");

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const compacted = compact(text);
  const words = compacted.split(/\s+/).filter(Boolean).length;
  const cjkChars = compacted.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return cjkChars > 0 ? Math.max(words, Math.round(cjkChars / 2)) : words;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
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

function memoryProcessFlags(test: StressCase, memoryRefs: string[]): string[] {
  const flags: string[] = [];
  const topRefs = memoryRefs.slice(0, 3);

  if (test.expectedMemoryRefs?.length && !topRefs.some((ref) => test.expectedMemoryRefs?.includes(ref))) {
    flags.push(`process_missing_expected_memory:${test.expectedMemoryRefs.join("|")}`);
  }

  const personalRefs = test.expectNoPersonalMemory ? memoryRefs.filter(isPersonalOrProjectMemoryRef) : [];
  if (personalRefs.length) {
    flags.push(`process_unexpected_personal_memory:${personalRefs.join("|")}`);
  }

  const forbiddenHits = test.forbiddenMemoryRefs?.length
    ? memoryRefs.filter((ref) => test.forbiddenMemoryRefs?.some((matcher) => memoryRefMatches(ref, matcher)))
    : [];
  if (forbiddenHits.length) {
    flags.push(`process_forbidden_memory:${forbiddenHits.join("|")}`);
  }

  return flags;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(input: number): () => number {
  let value = input >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded<T>(items: T[], seedText: string): T[] {
  const rng = mulberry32(hashSeed(seedText));
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function sceneToMemoryScene(scene: SceneKey): string {
  return {
    "Daily Chat": "daily_chat",
    "Classroom": "classroom",
    "Interview": "interview",
    "Meeting / Group Discussion": "group_discussion",
  }[scene];
}

function makeEventMemory(test: StressCase, transcripts: string[]): EventMemorySnapshot {
  return {
    eventId: `teleprompt-llm-${test.id}`,
    scene: sceneToMemoryScene(test.scene),
    title: transcripts[0]?.slice(0, 80) || test.scene,
    summary: `Teleprompt LLM stress case. Scene=${test.scene}. Desired=${test.desired}.`,
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function formatSceneProfile(scene: SceneKey): string {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === scene);
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${scene}`;
}

const cases: StressCase[] = [
  {
    id: "ielts_room",
    scene: "Daily Chat",
    sourceKind: "ielts",
    latest: "IELTS Part 2: Describe a room where you like to spend time. You should say where it is, what it looks like, what you do there, and explain why you like it.",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-update:2026-05:home-room"],
    expectAny: ["room", "cozy", "study", "comfortable"],
    rejectAny: ["cloud architecture", "career", "second floor", "quiet house", "big windows", "window", "armchair", "chair", "gray walls", "poster", "posters", "trees", "view", "organized", "tidy", "decorated", "back home"],
    desired: "Natural IELTS Part 2 answer about Xiang's small cozy room.",
  },
  {
    id: "ielts_skill",
    scene: "Daily Chat",
    sourceKind: "ielts",
    latest: "Describe a skill you learned that was difficult at first.",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-update:2026-05:piano-learning", "xiang-update:2026-05:music-instruments"],
    expectAny: ["piano", "youtube", "hands", "frustrating"],
    rejectAny: ["every day", "professional"],
    desired: "Long spoken answer, concrete but not too polished.",
  },
  {
    id: "ielts_childhood_place",
    scene: "Daily Chat",
    sourceKind: "ielts",
    latest: "Describe a place from your childhood that you remember well.",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-update:2026-05:childhood-home"],
    expectAny: ["chengdu", "community", "stairs", "friends"],
    rejectAny: ["father passed", "financially"],
    desired: "Use childhood community memory without sensitive oversharing.",
  },
  {
    id: "ielts_technology_work",
    scene: "Daily Chat",
    sourceKind: "ielts",
    latest: "How do you think technology will change the way people work in the future?",
    targetMode: "expandable",
    expectAny: ["ai", "tasks", "people", "decide"],
    rejectAny: ["replace everything"],
    desired: "Medium-length natural opinion, not generic safe answer.",
  },
  {
    id: "interview_saynext",
    scene: "Interview",
    sourceKind: "interview",
    latest: "Can you walk me through your SayNext project and explain the design decisions?",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["doc:saynext:positioning", "doc:saynext:runtime-flow", "doc:saynext:memory-personalization"],
    expectAny: ["mobile app", "transcript", "memory", "scene"],
    rejectAny: ["smart glasses app", "production users"],
    desired: "Grounded project explanation using real SayNext details.",
  },
  {
    id: "interview_hard_bug",
    scene: "Interview",
    sourceKind: "interview",
    latest: "Tell me about a hard bug you fixed recently.",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-behavioral:saynext-hard-bug-context", "xiang-behavioral:saynext-local-llm-json-latency"],
    expectAny: ["transcript", "stale", "context", "debug"],
    rejectAny: ["company", "production incident"],
    desired: "Behavioral story based on SayNext real development issues.",
  },
  {
    id: "interview_conflict",
    scene: "Interview",
    sourceKind: "interview",
    latest: "Tell me about a time you had a conflict with a teammate.",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-behavioral:team-disagreement-pattern"],
    expectAny: ["disagreement", "scope", "deadline", "trade-off"],
    rejectAny: ["fight", "manager"],
    desired: "Low-drama realistic project conflict story.",
  },
  {
    id: "interview_feedback",
    scene: "Interview",
    sourceKind: "interview",
    latest: "What constructive feedback have you received, and what did you do with it?",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-behavioral:constructive-feedback-ai-like"],
    expectAny: ["ai-like", "natural", "feedback", "changed"],
    rejectAny: ["senior engineer", "company"],
    desired: "Use known feedback about robotic/AI-like replies.",
  },
  {
    id: "presentation_architecture",
    scene: "Meeting / Group Discussion",
    sourceKind: "presentation",
    latest: "Can you present the current SayNext architecture and the main risks?",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["doc:saynext:runtime-flow", "doc:saynext:memory-personalization", "doc:saynext:llm-deployment"],
    expectAny: ["transcript", "memory", "scene", "risk"],
    rejectAny: ["smart glasses app"],
    desired: "Presentation-style explanation split into readable spoken paragraphs.",
  },
  {
    id: "presentation_demo_progress",
    scene: "Meeting / Group Discussion",
    sourceKind: "presentation",
    latest: "Give a one minute progress update for the team demo.",
    targetMode: "long",
    expectedStart: "long",
    expectAny: ["finished", "working", "next", "risk"],
    rejectAny: [
      "father",
      "family",
      "firebase",
      "authentication",
      "sign-up",
      "login",
      "backend team",
      "multiple users",
      "load balancing",
      "serverless architecture",
      "peak usage",
      "production users",
    ],
    desired: "Meeting progress update that moves discussion forward.",
  },
  {
    id: "meeting_design_tradeoff",
    scene: "Meeting / Group Discussion",
    sourceKind: "meeting",
    latest: "Could you explain why manual scene profiles are better than only automatic context detection?",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["xiang-behavioral:saynext-pushed-user-control", "xiang-behavioral:vague-requirements-prenote-scene", "doc:saynext:memory-personalization"],
    expectAny: ["user", "control", "automatic", "context"],
    rejectAny: ["always perfect"],
    desired: "Concise but useful design argument.",
  },
  {
    id: "meeting_api_blocker",
    scene: "Meeting / Group Discussion",
    sourceKind: "meeting",
    latest: "Explain the API blocker and what we should do next.",
    targetMode: "expandable",
    expectAny: ["schema", "mock", "contract", "next"],
    rejectAny: ["wait and see"],
    desired: "Actionable meeting response.",
  },
  {
    id: "technical_lambda",
    scene: "Classroom",
    sourceKind: "technical",
    latest: "Can you explain Lambda cold starts and how to reduce them?",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:serverless-lambda"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["cold start", "container", "latency", "warm"],
    rejectAny: ["saynext"],
    desired: "Professional technical explanation.",
  },
  {
    id: "technical_supervised",
    scene: "Classroom",
    sourceKind: "technical",
    latest: "Explain supervised learning with a simple example.",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:ml-fundamentals"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["labeled", "input", "output", "example"],
    rejectAny: ["my project"],
    desired: "Classroom-style short technical answer.",
  },
  {
    id: "technical_database_index",
    scene: "Classroom",
    sourceKind: "technical",
    latest: "Could you explain why database indexes improve read performance but may slow writes?",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:database-sql"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["lookup", "scan", "write", "writing", "updated", "read"],
    rejectAny: ["saynext"],
    desired: "Professional explanation with trade-off.",
  },
  {
    id: "daily_indoor_long",
    scene: "Daily Chat",
    sourceKind: "daily",
    latest: "Can you explain why you prefer spending free time indoors?",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["xiang-profile:lifestyle-food-health", "xiang-profile:favorite-games", "xiang-profile:games-general"],
    expectAny: ["indoors", "games", "anime", "weather"],
    rejectAny: ["career", "cloud"],
    desired: "Natural casual long-ish answer, not interview style.",
  },
  {
    id: "daily_games",
    scene: "Daily Chat",
    sourceKind: "daily",
    latest: "Tell me more about what kind of games you like.",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["xiang-profile:favorite-games", "xiang-profile:games-general"],
    expectAny: ["open-world", "pokemon", "genshin", "music"],
    rejectAny: ["cloud architecture"],
    desired: "Personal but casual gaming answer.",
  },
  {
    id: "daily_english_learning",
    scene: "Daily Chat",
    sourceKind: "daily",
    latest: "How did you improve your English after moving to Canada?",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["xiang-update:2026-05:english-learning", "xiang-profile:canada-high-school-transition"],
    expectAny: ["youtube", "videos", "talking", "forced"],
    rejectAny: ["perfect"],
    desired: "Natural answer about English learning.",
  },
  {
    id: "asr_project_next",
    scene: "Interview",
    sourceKind: "asr",
    latest: "what project you did for next could you explain long",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["doc:saynext:positioning", "doc:saynext:interview-story", "xiang-profile:project-saynext"],
    expectAny: ["saynext", "mobile app", "conversation"],
    rejectAny: ["elder album"],
    desired: "Noisy ASR project question should become SayNext long explanation.",
  },
  {
    id: "asr_cloud_why",
    scene: "Classroom",
    sourceKind: "asr",
    latest: "that cloud architecture why serverless cold start debug",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:serverless-lambda", "xiang-update:2026-05:favorite-subjects"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["serverless", "cold start", "debug", "trade-off"],
    rejectAny: ["father", "saynext", "my project"],
    desired: "Noisy technical question should produce useful technical answer.",
  },
  {
    id: "learner_stutter_saynext_long",
    scene: "Interview",
    sourceKind: "asr",
    latest: "c c can you explan long about my say next projct like what i make and why",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["doc:saynext:positioning", "doc:saynext:interview-story", "xiang-profile:project-saynext"],
    expectAny: ["saynext", "mobile app", "conversation"],
    rejectAny: ["elder album", "smart glasses app", "production users"],
    desired: "Stuttered learner English should still become a grounded SayNext project explanation.",
  },
  {
    id: "learner_mispronounced_lambda",
    scene: "Classroom",
    sourceKind: "asr",
    latest: "could you explan lamba cold stared and server less why hard debug",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:serverless-lambda"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["cold start", "latency", "serverless"],
    rejectAny: ["saynext", "my project"],
    desired: "Mispronounced Lambda/cold start question should retrieve CS knowledge.",
  },
  {
    id: "learner_ielts_room_broken",
    scene: "Daily Chat",
    sourceKind: "asr",
    latest: "ielts part two descrip a room i i like spend time and why",
    targetMode: "long",
    expectedStart: "long",
    expectedMemoryRefs: ["xiang-update:2026-05:home-room"],
    expectAny: ["room", "cozy", "comfortable"],
    rejectAny: ["window", "poster", "posters", "trees", "view", "big"],
    desired: "Broken IELTS cue card should still produce a grounded room answer.",
  },
  {
    id: "learner_superwise_learning",
    scene: "Classroom",
    sourceKind: "asr",
    latest: "how explain superwise learning with example i not clear",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:ml-fundamentals"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["labeled", "example", "training"],
    rejectAny: ["saynext", "my project"],
    desired: "Broken supervised learning question should produce a simple technical explanation.",
  },
  {
    id: "learner_database_index",
    scene: "Classroom",
    sourceKind: "asr",
    latest: "why data base in dex make read fast but write slow",
    targetMode: "expandable",
    expectedStart: "expandable",
    expectedMemoryRefs: ["knowledge:cs-interview:database-sql"],
    forbiddenMemoryRefs: ["doc:saynext", "xiang-profile:project-saynext"],
    expectAny: ["index", "read", "write"],
    rejectAny: ["saynext"],
    desired: "Broken database index question should produce the read/write trade-off.",
  },
  {
    id: "learner_noise_mic",
    scene: "Daily Chat",
    sourceKind: "asr",
    latest: "c c can you hear me is mic work",
    targetMode: "expandable",
    expectedStart: "none",
    expectNoPersonalMemory: true,
    rejectAny: ["father", "project", "cloud", "career"],
    desired: "Mic-check noise should not start teleprompt or retrieve personal context.",
  },
  {
    id: "zh_weekend_long",
    scene: "Daily Chat",
    sourceKind: "daily",
    latest: "你周末一般会做什么？可以多说一点。",
    targetMode: "expandable",
    language: "chinese",
    expectAny: ["游戏", "动漫", "休息", "家"],
    rejectAny: ["AWS", "cloud"],
    desired: "Chinese teleprompt-style answer if Chinese output is selected.",
  },
];

function outputFlags(
  test: StressCase,
  openingLine: string,
  script: string,
  chunks: number,
  startActual: ReturnType<typeof shouldStartTeleprompt>,
  memoryRefs: string[],
): string[] {
  const flags: string[] = [];
  const lower = script.toLowerCase();
  const words = wordCount(script);
  const expectedStart = test.expectedStart ?? test.targetMode;

  if (startActual !== expectedStart) {
    flags.push(`process_start_mismatch:${expectedStart}->${startActual}`);
  }
  flags.push(...memoryProcessFlags(test, memoryRefs));

  if (!script.trim()) flags.push("empty_script");
  if (lower.includes("as an ai")) flags.push("as_an_ai");
  if (/^\s*(script|answer|response|continued answer)\s*:/i.test(script)) flags.push("label_prefix");
  if (/^\s*[-*]\s+/m.test(script)) flags.push("bullet_points");
  if (/```|\{[\s\S]*"[^"]+"\s*:/.test(script)) flags.push("markdown_or_json");
  if (script.includes(openingLine)) flags.push("repeats_opening_line");
  if (test.targetMode === "long" && words < 105) flags.push(`too_short_for_long:${words}`);
  if (test.targetMode === "long" && words > 270) flags.push(`too_long_for_long:${words}`);
  if (test.targetMode === "expandable" && words < 55) flags.push(`too_short_for_expandable:${words}`);
  if (test.targetMode === "expandable" && words > 185) flags.push(`too_long_for_expandable:${words}`);
  if (test.targetMode === "long" && chunks < 2) flags.push(`not_chunked:${chunks}`);
  if (test.expectAny?.length && !includesAny(script, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(script, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (test.language !== "chinese" && hasChinese(script)) flags.push("unexpected_chinese");
  if (test.language === "chinese" && !hasChinese(script)) flags.push("missing_chinese");
  if (includesAny(script, ["father passed", "fatty liver", "uric acid", "financially well-off", "permanent residency"])) {
    flags.push("sensitive_overshare");
  }
  if (/\b(in conclusion|overall,|this journey|passionate about|from a young age|best candidate)\b/i.test(script)) {
    flags.push("overpolished_or_cliche");
  }
  if (/\b(senior engineer|production users|at my company|my manager)\b/i.test(script)) {
    flags.push("unsupported_senior_or_work_claim");
  }

  return flags;
}

async function runCase(test: StressCase): Promise<CaseResult> {
  const timestamp = Date.now();
  const transcripts = [...(test.history ?? []), test.latest];
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: timestamp + index,
  }));
  const eventMemory = makeEventMemory(test, transcripts);
  const openingLine = makeTelepromptOpeningLine(test.latest);
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.latest, 3);
  const memoryRefs = conversationLogger.searchPersonalMemoriesHybrid(userId, test.latest, 3).map((memory) => memory.sourceRef || memory.title);
  const startActual = shouldStartTeleprompt(test.latest, `${eventMemory.scene} ${formatSceneProfile(test.scene)}`);

  const script = await generateTelepromptScript({
    conversation,
    eventMemory,
    outputLanguage: test.language ?? "english",
    activePrenoteContext: "",
    activeSceneProfilePrompt: formatSceneProfile(test.scene),
    relevantPersonalMemoryContext: relevantMemory,
    openingLine,
    targetMode: test.targetMode,
  });

  const runtime = new TelepromptRuntime();
  runtime.startPending(test.latest, openingLine, timestamp);
  runtime.setScript(script);
  const chunks = runtime.getDisplay()?.total ?? 0;
  const flags = outputFlags(test, openingLine, script, chunks, startActual, memoryRefs);
  const verdict = flags.some((flag) => flag.startsWith("process_") || flag.includes("sensitive") || flag.includes("unsupported") || flag.includes("contains_rejected"))
    ? "bad"
    : flags.length
      ? "watch"
      : "good";

  return {
    test,
    startActual,
    memoryRefs,
    openingLine,
    script,
    chunks,
    wordCount: wordCount(script),
    flags,
    verdict,
  };
}

function writeReport(results: CaseResult[]): string {
  const dir = join(process.cwd(), "data", "eval");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(dir, `teleprompt-llm-stress-${stamp}.md`);
  const jsonlPath = join(dir, `teleprompt-llm-stress-${stamp}.jsonl`);
  const good = results.filter((result) => result.verdict === "good").length;
  const watch = results.filter((result) => result.verdict === "watch").length;
  const bad = results.filter((result) => result.verdict === "bad").length;
  const lines = [
    "# Teleprompt LLM Stress Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Provider: ${process.env.LLM_PROVIDER || "openai"}`,
    `Model: ${process.env.OLLAMA_MODEL || process.env.MODEL_NAME || "openai"}`,
    `Seed: ${seed}`,
    `Random: ${randomMode ? "yes" : "no"}`,
    `Cases: ${results.length}`,
    `Good: ${good}`,
    `Watch: ${watch}`,
    `Bad: ${bad}`,
    "",
  ];

  for (const [index, result] of results.entries()) {
    lines.push(
      `## ${index + 1}. ${result.test.id} [${result.verdict.toUpperCase()}]`,
      "",
      `- Source: ${result.test.sourceKind}`,
      `- Scene: ${result.test.scene}`,
      `- Target: ${result.test.targetMode}`,
      `- shouldStartTeleprompt: ${result.startActual}`,
      `- Memory: ${result.memoryRefs.join(" | ") || "none"}`,
      `- Words: ${result.wordCount}`,
      `- Chunks: ${result.chunks}`,
      `- Flags: ${result.flags.join(", ") || "none"}`,
      "",
      "**Latest Transcript**",
      "",
      "```text",
      result.test.latest,
      "```",
      "",
      "**Opening Line**",
      "",
      "```text",
      result.openingLine,
      "```",
      "",
      "**Generated Script**",
      "",
      "```text",
      result.script,
      "```",
      "",
    );
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonlPath, results.map((result) => JSON.stringify(result)).join("\n"), "utf8");
  return mdPath;
}

const selected = (randomMode ? shuffleSeeded(cases, seed) : cases).slice(0, targetCount);
const started = Date.now();
const results: CaseResult[] = [];

console.log(`TELEPROMPT_LLM_STRESS provider=${process.env.LLM_PROVIDER || "openai"} model=${process.env.OLLAMA_MODEL || process.env.MODEL_NAME || "openai"} cases=${selected.length} seed=${seed} random=${randomMode ? "yes" : "no"}`);

for (const [index, test] of selected.entries()) {
  const result = await runCase(test);
  results.push(result);
  console.log(`[${index + 1}/${selected.length}] ${result.verdict.toUpperCase()} ${test.id} words=${result.wordCount} chunks=${result.chunks}`);
  console.log(result.script);
  if (result.flags.length) console.log(`flags=${result.flags.join(", ")}`);
}

const report = writeReport(results);
const good = results.filter((result) => result.verdict === "good").length;
const watch = results.filter((result) => result.verdict === "watch").length;
const bad = results.filter((result) => result.verdict === "bad").length;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`TELEPROMPT_LLM_STRESS_DONE cases=${results.length} good=${good} watch=${watch} bad=${bad} elapsedSec=${elapsed}`);
console.log(`report=${report}`);

if (bad > 0) {
  process.exitCode = 1;
}
