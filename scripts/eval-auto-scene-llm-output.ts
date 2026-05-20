import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import { routeFastScene, type SceneBuiltinKey } from "../src/server/scene/fast-scene-router";

type AutoLlmCase = {
  id: string;
  latest: string;
  history?: string[];
  expectedScene: SceneBuiltinKey;
  previousScene?: SceneBuiltinKey;
  expectAny?: string[];
  rejectAny?: string[];
  maxWords?: number;
  allowPersonal?: boolean;
  allowProject?: boolean;
  note: string;
};

type Result = {
  test: AutoLlmCase;
  routeScene: SceneBuiltinKey;
  routeConfidence: number;
  usedScene: SceneBuiltinKey;
  output: string;
  elapsedMs: number;
  flags: string[];
  verdict: "good" | "watch" | "bad";
};

const userId = process.argv.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const outputDir = join("data", "eval");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const cases: AutoLlmCase[] = [
  {
    id: "daily_slang_exam",
    latest: "ngl that midterm cooked me, I'm so dead right now",
    expectedScene: "daily_chat",
    expectAny: ["yeah", "rough", "brutal", "sleep", "cooked"],
    rejectAny: ["AWS", "project", "career"],
    maxWords: 35,
    note: "Daily slang should stay casual, not become classroom/interview.",
  },
  {
    id: "daily_project_casual",
    latest: "what project did you make recently?",
    expectedScene: "daily_chat",
    allowProject: true,
    expectAny: ["SayNext", "project", "app", "conversation"],
    rejectAny: ["STAR", "behavioral", "senior"],
    maxWords: 55,
    note: "A casual project question can mention SayNext naturally without interview tone.",
  },
  {
    id: "daily_store_payment",
    latest: "The total is forty two eighty, do you want to tap or insert?",
    expectedScene: "daily_chat",
    expectAny: ["Tap"],
    rejectAny: ["I think", "maybe"],
    maxWords: 8,
    note: "Fast local router should classify a transaction as daily/service.",
  },
  {
    id: "classroom_teacher_concept",
    latest: "So the key idea with indexes is that writes become more expensive but reads can become much faster",
    expectedScene: "classroom",
    expectAny: ["index", "write", "read", "query"],
    rejectAny: ["pretty chill", "my project"],
    maxWords: 85,
    note: "Teacher explanation should produce a useful classroom supplement.",
  },
  {
    id: "classroom_noisy_lambda",
    latest: "lambda cold start not my why it happen when function sleep long time",
    expectedScene: "classroom",
    allowProject: true,
    expectAny: ["cold start", "initialize", "function", "idle"],
    rejectAny: ["game", "anime"],
    maxWords: 85,
    note: "Broken English technical question should answer intent.",
  },
  {
    id: "classroom_good_question",
    history: ["The professor is explaining eventual consistency and replicas."],
    latest: "So replicas may briefly return different values after a write.",
    expectedScene: "classroom",
    expectAny: ["replica", "consistency", "read", "stale", "eventual"],
    rejectAny: ["my family", "takeout"],
    maxWords: 85,
    note: "Classroom lecture statement should not turn into daily reply.",
  },
  {
    id: "interview_small_talk_keep",
    previousScene: "interview",
    latest: "How's your morning going?",
    expectedScene: "interview",
    expectAny: ["good", "pretty", "ready", "morning", "well"],
    rejectAny: ["cooked", "side quest"],
    maxWords: 30,
    note: "Interview small talk should keep interview context and remain simple.",
  },
  {
    id: "interview_student_question",
    latest: "Okay, so do you work or are you a student?",
    expectedScene: "interview",
    allowPersonal: true,
    expectAny: ["MACS", "Dalhousie", "student"],
    rejectAny: ["math", "mathematics"],
    maxWords: 45,
    note: "Auto should classify IELTS/interview intro and preserve MACS identity.",
  },
  {
    id: "interview_behavioral_conflict",
    latest: "Tell me about a time you had conflict with a teammate.",
    expectedScene: "interview",
    allowProject: true,
    expectAny: ["clarify", "team", "project", "communication"],
    rejectAny: ["senior", "manager at work", "production team"],
    maxWords: 130,
    note: "Behavioral interview answer should be grounded, not fake senior.",
  },
  {
    id: "interview_unsupported_google",
    latest: "Tell me about your Google internship project.",
    expectedScene: "interview",
    allowProject: true,
    expectAny: ["not", "Google", "internship"],
    rejectAny: ["at Google I", "during my Google internship"],
    maxWords: 95,
    note: "Unsupported premise should not be invented.",
  },
  {
    id: "meeting_blocker_privacy",
    history: ["We are deciding the API contract for uploaded prenote files."],
    latest: "The main blocker is the privacy issue with uploaded files, what should we do next?",
    expectedScene: "meeting_group",
    allowProject: true,
    expectAny: ["privacy", "storage", "access", "delete", "rule"],
    rejectAny: ["wedding", "anime"],
    maxWords: 75,
    note: "Meeting should produce a concrete next step.",
  },
  {
    id: "meeting_current_flow",
    history: ["We are reviewing the mobile flow and API response."],
    latest: "I don't think it works with the current flow, what do you think?",
    expectedScene: "meeting_group",
    allowProject: true,
    expectAny: ["clarify", "flow", "test", "step", "user"],
    rejectAny: ["I agree completely"],
    maxWords: 70,
    note: "Ambiguous meeting statement should clarify specific part.",
  },
  {
    id: "meeting_scope_cut",
    latest: "We probably can't finish file upload, search, summary, and sharing by tomorrow.",
    expectedScene: "meeting_group",
    allowProject: true,
    expectAny: ["must", "demo", "scope", "upload", "cut"],
    rejectAny: ["do everything"],
    maxWords: 80,
    note: "Meeting should suggest scope cut.",
  },
  {
    id: "scene_switch_daily_to_interview",
    history: ["Good morning, how's your day going so far?", "Pretty chill, just waking up a bit."],
    latest: "Okay let's start, tell me about a technical trade-off you made.",
    expectedScene: "interview",
    allowProject: true,
    expectAny: ["trade-off", "SayNext", "testing", "latency", "context"],
    rejectAny: ["pretty chill", "takeout"],
    maxWords: 120,
    note: "Auto should switch from daily into interview.",
  },
  {
    id: "scene_switch_interview_to_meeting",
    previousScene: "interview",
    history: ["Tell me about your project.", "SayNext is a mobile real-time conversation assistant."],
    latest: "Actually for our team meeting, who owns the API contract before demo?",
    expectedScene: "meeting_group",
    allowProject: true,
    expectAny: ["owner", "API contract", "demo", "confirm"],
    rejectAny: ["interview"],
    maxWords: 70,
    note: "Auto should switch into meeting when the wording is explicit.",
  },
  {
    id: "public_dialogue_no_personal",
    history: ["Speaker A: Notifications are making everyone anxious."],
    latest: "Speaker B: Yeah, phones basically turned into tiny anxiety machines.",
    expectedScene: "daily_chat",
    expectAny: ["notifications", "phone", "attention", "anxiety"],
    rejectAny: ["Xiang", "Dalhousie", "SayNext", "my project"],
    maxWords: 60,
    note: "Public dialogue should not inject Xiang personal facts.",
  },
];

function wordCount(text: string): number {
  return String(text || "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function sceneToEventScene(scene: SceneBuiltinKey): string {
  if (scene === "daily_chat") return "daily_chat";
  if (scene === "classroom") return "classroom";
  if (scene === "interview") return "interview";
  return "group_discussion";
}

function formatAutoSceneProfile(sceneKey: SceneBuiltinKey): string {
  const profile = conversationLogger.getSceneProfileByBuiltinKey(userId, sceneKey);
  if (!profile) return `Active scene profile: Auto -> ${sceneKey}`;
  return `Active scene profile: Auto -> ${profile.name}\n${profile.prompt.trim()}`;
}

function makeEventMemory(test: AutoLlmCase, usedScene: SceneBuiltinKey, transcripts: string[]): EventMemorySnapshot {
  return {
    eventId: `auto-llm-${test.id}`,
    scene: sceneToEventScene(usedScene),
    title: test.latest.slice(0, 90),
    summary: `Auto scene LLM output test. Expected scene=${test.expectedScene}. ${test.note}`,
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function judge(test: AutoLlmCase, result: Omit<Result, "flags" | "verdict">): { flags: string[]; verdict: Result["verdict"] } {
  const flags: string[] = [];
  const output = result.output;
  if (!output.trim()) flags.push("empty_output");
  if (result.usedScene !== test.expectedScene) flags.push(`wrong_scene:${result.usedScene}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (/^\s*(you can say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (/\bas an ai\b/i.test(output)) flags.push("as_an_ai");
  if (!test.allowProject && /\b(saynext|say next|joblens|elderalbum|dalparkaid|lambda|dynamodb|aws)\b/i.test(output)) {
    flags.push("unwanted_project_or_tech");
  }
  if (!test.allowPersonal && /\b(father|mother|sister|chengdu|dalhousie|macs|acadia|health|bullying|immigration|pr)\b/i.test(output)
    && !/\b(do you work|student|program|major)\b/i.test(test.latest)) {
    flags.push("unwanted_personal_detail");
  }
  if (/\b(at Google I|during my Google internship|when I worked at Google|as a senior)\b/i.test(output)) {
    flags.push("unsupported_experience_claim");
  }

  const bad = flags.some((flag) => [
    "empty_output",
    "meta_prefix",
    "as_an_ai",
    "unsupported_experience_claim",
  ].some((badFlag) => flag.startsWith(badFlag))) || flags.some((flag) => flag.startsWith("wrong_scene"));
  return { flags, verdict: bad ? "bad" : flags.length ? "watch" : "good" };
}

async function runCase(test: AutoLlmCase): Promise<Result> {
  const started = performance.now();
  const recent = test.history || [];
  const route = routeFastScene({
    latestTranscript: test.latest,
    recentTranscripts: recent,
    previousSceneKey: test.previousScene,
  });
  const usedScene = route.sceneKey;
  const transcripts = [...recent, test.latest];
  const now = Date.now();
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: now - (transcripts.length - index) * 1000,
  }));
  const memoryQuery = transcripts.slice(-4).join("\n");
  const relevantPersonalMemoryContext = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 4);
  const response = await processConversation(
    conversation,
    "high",
    makeEventMemory(test, usedScene, transcripts),
    "english",
    "",
    formatAutoSceneProfile(usedScene),
    relevantPersonalMemoryContext,
  );
  const output = response.type === "insight" ? response.output : "";
  const base = {
    test,
    routeScene: route.sceneKey,
    routeConfidence: route.confidence,
    usedScene,
    output,
    elapsedMs: Math.round(performance.now() - started),
  };
  return {
    ...base,
    ...judge(test, base),
  };
}

function render(results: Result[]): string {
  const counts = results.reduce<Record<string, number>>((acc, item) => {
    acc[item.verdict] = (acc[item.verdict] || 0) + 1;
    return acc;
  }, {});
  const lines: string[] = [
    "# Auto Scene LLM Output Eval",
    "",
    `- timestamp: ${new Date().toISOString()}`,
    `- userId: ${userId}`,
    `- llmProvider: ${process.env.LLM_PROVIDER || "auto/default"}`,
    `- cases: ${results.length}`,
    `- good/watch/bad: ${counts.good || 0}/${counts.watch || 0}/${counts.bad || 0}`,
    `- avg elapsed: ${Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / Math.max(1, results.length))}ms`,
    "",
  ];

  const review = results.filter((item) => item.verdict !== "good");
  if (review.length) {
    lines.push("## Review Needed", "");
    for (const item of review) {
      lines.push(`### ${item.verdict.toUpperCase()} ${item.test.id}`);
      lines.push(`- expectedScene: ${item.test.expectedScene}`);
      lines.push(`- usedScene: ${item.usedScene}`);
      lines.push(`- routeConfidence: ${item.routeConfidence}`);
      lines.push(`- elapsedMs: ${item.elapsedMs}`);
      lines.push(`- flags: ${item.flags.join(", ")}`);
      lines.push(`- latest: ${item.test.latest}`);
      lines.push(`- output: ${item.output}`);
      lines.push("");
    }
  }

  lines.push("## All Cases", "");
  for (const item of results) {
    lines.push(`### ${item.verdict.toUpperCase()} ${item.test.id}`);
    lines.push(`- note: ${item.test.note}`);
    lines.push(`- expectedScene: ${item.test.expectedScene}`);
    lines.push(`- usedScene: ${item.usedScene}`);
    lines.push(`- routeConfidence: ${item.routeConfidence}`);
    lines.push(`- elapsedMs: ${item.elapsedMs}`);
    lines.push(`- flags: ${item.flags.join(", ") || "(none)"}`);
    lines.push(`- latest: ${item.test.latest}`);
    if (item.test.history?.length) lines.push(`- history: ${item.test.history.join(" | ")}`);
    lines.push("");
    lines.push("```text");
    lines.push(item.output);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outputDir, { recursive: true });
  // Ensure default profiles including Auto are installed.
  conversationLogger.listSceneProfiles(userId);
  const results: Result[] = [];
  for (const test of cases) {
    console.log(`[auto-llm] ${results.length + 1}/${cases.length} ${test.id}`);
    results.push(await runCase(test));
  }
  const mdPath = join(outputDir, `auto-scene-llm-output-${stamp}.md`);
  const jsonPath = join(outputDir, `auto-scene-llm-output-${stamp}.json`);
  writeFileSync(mdPath, render(results));
  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  const counts = results.reduce<Record<string, number>>((acc, item) => {
    acc[item.verdict] = (acc[item.verdict] || 0) + 1;
    return acc;
  }, {});
  console.log(`AUTO_SCENE_LLM_OUTPUT_REPORT ${mdPath}`);
  console.log(`good/watch/bad: ${counts.good || 0}/${counts.watch || 0}/${counts.bad || 0}`);
  if (counts.bad) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
