import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation, type OutputLanguage } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";

const userId = process.argv[2] || "li2897283405@gmail.com";
const limitArg = Number(process.argv[3] || 0);

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";

type LlmEvalCase = {
  id: string;
  scene: SceneKey;
  latest: string;
  history?: string[];
  language?: OutputLanguage;
  expectAny?: string[];
  rejectAny?: string[];
  maxWords?: number;
  minWords?: number;
  allowProjectMention?: boolean;
  allowChinese?: boolean;
  note: string;
};

const cases: LlmEvalCase[] = [
  {
    id: "daily_morning",
    scene: "Daily Chat",
    latest: "Good morning! How's your day going so far?",
    expectAny: ["good", "not bad", "pretty", "chill", "okay", "alright", "tired", "morning", "nothing"],
    rejectAny: ["today i plan", "cloud", "architecting", "project", "career"],
    maxWords: 28,
    note: "Daily chat should sound casual, not robotic planning.",
  },
  {
    id: "daily_weekend",
    scene: "Daily Chat",
    latest: "What are you doing this weekend?",
    expectAny: ["game", "anime", "stay", "probably", "chill", "home"],
    rejectAny: ["aws", "cloud", "resume", "career", "stable software"],
    maxWords: 35,
    note: "Weekend answer can use real lifestyle, not school/project unless asked.",
  },
  {
    id: "daily_weather",
    scene: "Daily Chat",
    latest: "It's so windy today.",
    expectAny: ["halifax", "windy", "yeah", "honestly", "outside", "cold"],
    rejectAny: ["project", "cloud", "ai system", "career"],
    maxWords: 24,
    note: "Casual reaction only.",
  },
  {
    id: "daily_indoor",
    scene: "Daily Chat",
    latest: "Do you prefer spending free time indoors or outdoors?",
    expectAny: ["indoors", "inside", "home", "games", "anime"],
    rejectAny: ["as a computer science student", "software", "cloud", "career"],
    maxWords: 45,
    note: "Use personal preference without overexplaining.",
  },
  {
    id: "personal_high_school_canada",
    scene: "Daily Chat",
    latest: "Where did you study high school after moving to Canada?",
    expectAny: ["aubrey", "drive", "dartmouth", "halifax"],
    rejectAny: ["shishi", "peking university affiliated"],
    maxWords: 40,
    note: "Should retrieve Canada high school memory.",
  },
  {
    id: "personal_china_school",
    scene: "Daily Chat",
    latest: "What high school did you study in China before Canada?",
    expectAny: ["shishi", "peking", "affiliated", "chengdu"],
    rejectAny: ["aubrey drive"],
    maxWords: 55,
    note: "Should retrieve China school memory.",
  },
  {
    id: "privacy_generic",
    scene: "Daily Chat",
    latest: "Tell me something about yourself.",
    rejectAny: ["father", "passed away", "bullying", "fatty liver", "uric", "pr", "permanent residency", "family business", "financially"],
    maxWords: 45,
    note: "Generic personal question should not overshare sensitive facts.",
  },
  {
    id: "classroom_supervised_learning",
    scene: "Classroom",
    history: ["The professor is explaining supervised and unsupervised learning."],
    latest: "Can somebody give another example of supervised learning?",
    expectAny: ["spam", "email", "label", "classification", "labeled", "predict"],
    rejectAny: ["my project", "saynext", "i built"],
    maxWords: 55,
    note: "Classroom direct question should give a professional short answer.",
  },
  {
    id: "classroom_rl_lecture",
    scene: "Classroom",
    history: ["The professor is explaining reinforcement learning and evaluative feedback."],
    latest: "In reinforcement learning, you only get feedback for the action you actually take.",
    expectAny: ["exploration", "reward", "policy", "trial", "feedback", "supervised"],
    rejectAny: ["yeah that makes sense", "i like", "my project"],
    maxWords: 60,
    note: "Lecture statement should get useful knowledge supplement, not small talk.",
  },
  {
    id: "classroom_cloud_multi_az",
    scene: "Classroom",
    latest: "Why do we use multi-AZ in cloud architecture?",
    expectAny: ["availability", "failure", "zone", "resilience", "failover"],
    rejectAny: ["because i used", "my project"],
    maxWords: 55,
    note: "Cloud knowledge should be precise.",
  },
  {
    id: "technical_code_review",
    scene: "Interview",
    latest: "Why is code review important?",
    expectAny: ["bugs", "quality", "readability", "maintainability", "shared understanding"],
    rejectAny: ["harsh feedback", "senior engineer told me", "in saynext"],
    maxWords: 55,
    note: "General CS workplace question should not become behavioral story.",
  },
  {
    id: "interview_about_self",
    scene: "Interview",
    latest: "Could you tell me about yourself?",
    expectAny: ["xiang", "macs", "dalhousie", "web", "cloud", "ai"],
    rejectAny: ["best candidate", "dream job", "passionate", "senior"],
    maxWords: 70,
    allowProjectMention: true,
    note: "Interview intro should be concise and not exaggerated.",
  },
  {
    id: "interview_project_name",
    scene: "Interview",
    latest: "What's the project name of the real-time conversation assistant you built?",
    expectAny: ["saynext"],
    rejectAny: ["elder album", "joblens", "dalparkaid"],
    maxWords: 35,
    allowProjectMention: true,
    note: "Specific SayNext project question should answer directly.",
  },
  {
    id: "interview_saynext_why",
    scene: "Interview",
    latest: "Why did you build SayNext?",
    expectAny: ["conversation", "real-time", "communication", "assistant", "respond"],
    rejectAny: ["smart glasses app", "production", "users at scale", "senior"],
    maxWords: 75,
    allowProjectMention: true,
    note: "SayNext is mobile app/product experiment, not smart glasses app.",
  },
  {
    id: "interview_hard_bug",
    scene: "Interview",
    latest: "Tell me about the hardest bug you fixed recently.",
    expectAny: ["context", "stale", "transcript", "json", "ollama", "loading", "debug"],
    rejectAny: ["production incident", "at my company", "senior"],
    maxWords: 95,
    allowProjectMention: true,
    note: "Behavioral story should use real SayNext bug without fake work experience.",
  },
  {
    id: "interview_conflict",
    scene: "Interview",
    latest: "Tell me about a time you had a conflict with a teammate.",
    expectAny: ["technical", "disagreement", "trade-off", "deadline", "scope", "smaller"],
    rejectAny: ["fight", "angry", "unreasonable", "manager at work"],
    maxWords: 90,
    note: "Conflict should be low-drama group/project disagreement.",
  },
  {
    id: "interview_manager_influence",
    scene: "Interview",
    latest: "How did you influence a product decision without a formal role?",
    expectAny: ["scene", "prenote", "user control", "automatic", "transcript"],
    rejectAny: ["manager", "company", "production team"],
    maxWords: 95,
    allowProjectMention: true,
    note: "Should use SayNext user-control story.",
  },
  {
    id: "interview_future_job",
    scene: "Interview",
    latest: "What kind of job do you want in the future?",
    expectAny: ["software", "web", "mobile", "ai", "full-stack", "cloud"],
    rejectAny: ["dream job", "best candidate", "change the world"],
    maxWords: 55,
    note: "Career answer should be practical, not inflated.",
  },
  {
    id: "meeting_scope",
    scene: "Meeting / Group Discussion",
    history: ["We still need upload, matching, dashboard, and notification features before the demo."],
    latest: "What should we focus on first?",
    expectAny: ["core", "demo", "working", "upload", "matching", "scope", "priority"],
    rejectAny: ["i think everything is important", "my personal"],
    maxWords: 55,
    note: "Meeting should move discussion forward.",
  },
  {
    id: "meeting_blocker",
    scene: "Meeting / Group Discussion",
    latest: "I'm still waiting for the API response format from the backend.",
    expectAny: ["mock", "schema", "assumption", "block", "continue", "document"],
    rejectAny: ["sorry could you say that again", "that's nice"],
    maxWords: 55,
    note: "Meeting blocker should suggest practical next step.",
  },
  {
    id: "asr_noise_and",
    scene: "Daily Chat",
    latest: "And.",
    rejectAny: ["cloud", "project", "career", "father", "family"],
    maxWords: 18,
    note: "Short ASR fragment should not trigger personal/project details.",
  },
  {
    id: "asr_malformed_project",
    scene: "Interview",
    latest: "What project you did for next",
    expectAny: ["saynext", "conversation", "assistant"],
    rejectAny: ["sorry could you say that again", "elder album"],
    maxWords: 50,
    allowProjectMention: true,
    note: "Common ASR project question should map to SayNext.",
  },
  {
    id: "language_chinese",
    scene: "Daily Chat",
    latest: "你周末一般干嘛？",
    language: "chinese",
    expectAny: ["游戏", "动漫", "家", "躺", "可能"],
    allowChinese: true,
    rejectAny: ["cloud", "aws", "career"],
    maxWords: 45,
    note: "Chinese output mode should answer in Chinese.",
  },
  {
    id: "english_default_no_chinese",
    scene: "Daily Chat",
    latest: "What games do you usually play?",
    expectAny: ["genshin", "gacha", "pokemon", "open-world", "games"],
    rejectAny: ["我", "喜欢", "游戏"],
    maxWords: 50,
    note: "English default should avoid Chinese.",
  },
];

function makeEventMemory(scene: SceneKey, transcripts: string[]): EventMemorySnapshot {
  const sceneMap: Record<SceneKey, string> = {
    "Daily Chat": "daily_chat",
    "Classroom": "classroom",
    "Interview": "interview",
    "Meeting / Group Discussion": "group_discussion",
  };

  return {
    eventId: `eval-${Date.now()}`,
    scene: sceneMap[scene],
    title: transcripts[0]?.slice(0, 80) || sceneMap[scene],
    summary: `Eval scene: ${sceneMap[scene]}. Recent context: ${transcripts.slice(-3).join(" / ")}`,
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function outputFlags(test: LlmEvalCase, output: string): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|you could say|suggested reply|answer:|reply:)/i.test(output)) flags.push("label_or_meta_prefix");
  if (normalized.includes("as an ai")) flags.push("as_an_ai");
  if (normalized.includes("today i plan")) flags.push("robotic_today_i_plan");
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (test.minWords && wordCount(output) < test.minWords) flags.push(`too_short:${wordCount(output)}<${test.minWords}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (!test.allowChinese && test.language !== "chinese" && hasChinese(output)) flags.push("unexpected_chinese");

  if (!test.allowProjectMention && includesAny(output, [
    "saynext", "elder album", "elderalbum", "joblens", "dalparkaid", "dal parking", "aws", "lambda", "dynamodb",
  ]) && !includesAny(test.latest, ["project", "saynext", "elder", "joblens", "dalparkaid", "aws", "lambda", "dynamodb", "code review"])) {
    flags.push("unwanted_project_or_tech_mention");
  }

  if (includesAny(output, ["father", "passed away", "bullying", "fatty liver", "uric acid", "permanent residency", "pr goal", "family was financially"])) {
    flags.push("sensitive_overshare");
  }

  return flags;
}

function formatSceneProfile(scene: SceneKey): string {
  const profiles = conversationLogger.listSceneProfiles(userId);
  const profile = profiles.find((item) => item.name === scene);
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${scene}`;
}

const selectedCases = limitArg > 0 ? cases.slice(0, limitArg) : cases;
let flagged = 0;
const startedAt = Date.now();

console.log(`LLM_OUTPUT_EVAL provider=${process.env.LLM_PROVIDER || "openai"} model=${process.env.OLLAMA_MODEL || "openai"} cases=${selectedCases.length}`);

for (const test of selectedCases) {
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
    makeEventMemory(test.scene, transcripts),
    test.language ?? "english",
    "",
    formatSceneProfile(test.scene),
    relevantMemory,
  );

  const output = response.type === "insight" ? response.output : "";
  const refs = conversationLogger.searchPersonalMemoriesHybrid(userId, test.latest, 3).map((memory) => memory.sourceRef || memory.title);
  const flags = outputFlags(test, output);
  if (flags.length) flagged += 1;

  console.log(`\n[${flags.length ? "FLAG" : "OK"}] ${test.id} (${test.scene})`);
  console.log(`transcript: ${test.latest}`);
  console.log(`memory: ${refs.join(" | ") || "none"}`);
  console.log(`output: ${output}`);
  if (flags.length) console.log(`flags: ${flags.join(", ")}`);
  console.log(`note: ${test.note}`);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nLLM_OUTPUT_EVAL_DONE cases=${selectedCases.length} flagged=${flagged} elapsedSec=${elapsed}`);

if (flagged > 0) {
  process.exitCode = 1;
}
