import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation } from "../src/server/mastra/agents/initial-agent";
import { EventMemoryManager, type EventMemorySnapshot } from "../src/server/memory/event-memory";
import type { Conversation } from "../src/server/mastra/types";

type MeetingCase = {
  id: string;
  note: string;
  history: string[];
  latest: string;
  expectAny?: string[];
  rejectAny?: string[];
  maxWords?: number;
};

type CaseResult = {
  id: string;
  suite: "current" | "baseline";
  note: string;
  latest: string;
  meetingState?: EventMemorySnapshot["meetingState"];
  output: string;
  flags: string[];
  verdict: "good" | "watch" | "bad";
};

const userId = process.argv[2] || "li2897283405@gmail.com";
const compareBaseline = process.argv.includes("--compare-baseline");
const outputDir = join("data", "eval");
const nowLabel = new Date().toISOString().replace(/[:.]/g, "-");

const LEGACY_MEETING_PROMPT = `Active scene profile: Meeting / Group Discussion
Scene: Meeting / Group Discussion

Goal:
Help Xiang add one useful sentence that moves the discussion forward.
This can be a progress update, a clear opinion, a technical clarification, or a question that reveals a risk or blocker.

Style:
Short, direct, practical, professional.
Focus on the project and the current problem.
Use clear technical reasoning when needed.
Show that Xiang understands the project and can think about next steps.
If the blocker is missing API/schema/data from another person, suggest using a mock schema or documented assumption so work can continue.

When to speak:
Speak when Xiang can clarify, confirm, ask a useful question, report progress, or suggest a simple next step.
If others are just talking and no useful addition is needed, keep the output minimal and avoid generic filler.

Avoid:
Do not repeat what others already said.
Do not add generic agreement.
Do not make long speeches.`;

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function makeSceneProfile(): string {
  const profile = conversationLogger.listSceneProfiles(userId)
    .find((item) => item.builtinKey === "meeting_group");
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : "Active scene profile: Meeting / Group Discussion";
}

function withoutLiveMeetingState(eventMemory: EventMemorySnapshot): EventMemorySnapshot {
  return {
    ...eventMemory,
    summary: eventMemory.summary.replace(/\s*Live meeting state:.*?(?=Recent context:|SayNext outputs shown:|$)/, " "),
    meetingState: undefined,
  };
}

function buildMeetingEvent(caseItem: MeetingCase): EventMemorySnapshot {
  const manager = new EventMemoryManager(userId, `meeting-llm-eval-${caseItem.id}`, false);
  let timestamp = Date.now();
  let snapshot: EventMemorySnapshot | undefined;
  for (const line of [...caseItem.history, caseItem.latest]) {
    timestamp += 1000;
    snapshot = manager.addTranscript(line, timestamp);
  }

  if (!snapshot) {
    throw new Error(`Failed to build event snapshot for ${caseItem.id}`);
  }
  return snapshot;
}

function scoreCase(caseItem: MeetingCase, output: string): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (/\b(as an ai|you should|you could|the assistant|the best answer)\b/i.test(output)) flags.push("meta_or_ai_language");
  if (caseItem.maxWords && wordCount(output) > caseItem.maxWords) flags.push(`too_long:${wordCount(output)}>${caseItem.maxWords}`);
  if (caseItem.expectAny?.length && !includesAny(output, caseItem.expectAny)) {
    flags.push(`missing_expected:${caseItem.expectAny.join("|")}`);
  }
  if (caseItem.rejectAny?.length && includesAny(output, caseItem.rejectAny)) {
    flags.push(`contains_rejected:${caseItem.rejectAny.join("|")}`);
  }
  if (/\b(production scale|thousands of users|at my company|my manager|senior engineer)\b/i.test(output)) {
    flags.push("invented_scale_or_work_experience");
  }
  if (/\b(father|family|childhood|anime|takeout|romantic|fatty liver|permanent residency)\b/i.test(output)) {
    flags.push("personal_leak");
  }
  if (normalized.includes("yeah i agree") && wordCount(output) <= 6) {
    flags.push("generic_agreement_only");
  }
  if (caseItem.id === "unclear_take_that_part" && /^i can take that part\b/i.test(output.trim())) {
    flags.push("accepted_unclear_task_before_clarifying");
  }
  return flags;
}

const cases: MeetingCase[] = [
  {
    id: "progress_update_with_blocker",
    note: "Progress update should use Live Meeting State: responsibility + blocker + next step.",
    history: [
      "We need to finish the SayNext teleprompt controls before the demo.",
      "The blocker is the API contract for the settings endpoint is still missing.",
      "For now we can use a mock schema and document the assumption.",
      "Xiang can handle the frontend integration.",
    ],
    latest: "Can you give a quick update?",
    expectAny: ["frontend", "api", "schema", "mock", "blocker", "integration"],
    rejectAny: ["everything is done", "production", "users at scale", "my manager"],
    maxWords: 42,
  },
  {
    id: "missing_api_schema",
    note: "Missing API format should produce a concrete unblock step.",
    history: [
      "We are integrating the settings page with the backend this week.",
      "The backend response format is not final yet.",
    ],
    latest: "I'm still waiting for the API response format from backend.",
    expectAny: ["mock", "schema", "contract", "assumption", "confirm"],
    rejectAny: ["that's nice", "sorry could you say that again"],
    maxWords: 38,
  },
  {
    id: "decision_without_owner",
    note: "Decision made but owner/deadline missing should suggest confirming owner/deadline.",
    history: [
      "We decided to go with the simple checkbox design for this milestone.",
      "The implementation should be small enough for this week.",
    ],
    latest: "So are we good with that?",
    expectAny: ["owner", "deadline", "confirm", "who", "when", "next"],
    rejectAny: ["yeah sounds good"],
    maxWords: 38,
  },
  {
    id: "scope_creep_pushback",
    note: "Feature request before bugfix should gently push back.",
    history: [
      "The reset session bug is still not fully fixed.",
      "The demo depends on reset working if the context gets stuck.",
    ],
    latest: "Should we add notifications before fixing that bug?",
    expectAny: ["bug", "core", "fix", "first", "later", "nice-to-have", "demo"],
    rejectAny: ["yes", "notifications first", "add everything"],
    maxWords: 42,
  },
  {
    id: "tradeoff_short_vs_complete",
    note: "Trade-off should prefer milestone-safe option.",
    history: [
      "We have two options for the teleprompt UI.",
      "One is a full editor with lots of controls, and one is just next, back, and cancel.",
    ],
    latest: "Which option should we choose for the demo?",
    expectAny: ["simple", "demo", "milestone", "safer", "later", "improve"],
    rejectAny: ["do everything"],
    maxWords: 45,
  },
  {
    id: "unclear_take_that_part",
    note: "If topic is unclear, ask a short clarification instead of inventing.",
    history: [
      "We have a few parts left, but I don't remember who is doing what.",
    ],
    latest: "Can you take that part?",
    expectAny: ["which part", "what part", "which specific task", "what task"],
    rejectAny: ["frontend integration", "api schema", "saynext"],
    maxWords: 24,
  },
  {
    id: "joblens_cloud_blocker",
    note: "Cloud project meeting should use JobLens/AWS context without becoming an interview answer.",
    history: [
      "For JobLens AI, the backend uses API Gateway, Lambda, DynamoDB, and S3.",
      "The resume parsing flow works locally but fails after deployment.",
    ],
    latest: "What should we check first?",
    expectAny: ["cloudwatch", "logs", "permission", "iam", "environment", "lambda", "s3"],
    rejectAny: ["tell me about yourself", "my favorite"],
    maxWords: 50,
  },
  {
    id: "privacy_risk",
    note: "Privacy issue should identify risk and concrete mitigation.",
    history: [
      "The transcript export feature can include user conversations and AI replies.",
    ],
    latest: "This might expose private user data if we are not careful.",
    expectAny: ["privacy", "access", "permission", "mask", "export", "store", "delete"],
    rejectAny: ["whatever", "not a big deal"],
    maxWords: 48,
  },
  {
    id: "conflict_design",
    note: "Disagreement should split must-have versus later work.",
    history: [
      "One teammate wants a more visual dashboard.",
      "Another teammate says we only have two days before submission.",
    ],
    latest: "I still think we should polish the dashboard more.",
    expectAny: ["must-have", "nice-to-have", "deadline", "submission", "basic", "later"],
    rejectAny: ["you're wrong", "fight", "do everything"],
    maxWords: 45,
  },
  {
    id: "meeting_drift",
    note: "When meeting drifts, bring it back to next concrete step.",
    history: [
      "We spent ten minutes talking about colors and icons.",
      "The backend integration is still not tested.",
    ],
    latest: "Should we keep discussing the icon style?",
    expectAny: ["integration", "test", "first", "later", "core", "demo"],
    rejectAny: ["icons are the most important"],
    maxWords: 42,
  },
  {
    id: "accept_ownership",
    note: "When Xiang can own a task, accept ownership modestly.",
    history: [
      "The frontend integration needs one owner.",
      "The backend team can send the response example today.",
    ],
    latest: "Xiang, can you take the frontend part?",
    expectAny: ["i can take", "frontend", "response", "example", "confirm"],
    rejectAny: ["no", "maybe someone else"],
    maxWords: 38,
  },
  {
    id: "asr_messy_meeting",
    note: "Messy ASR should still infer blocker/update process.",
    history: [
      "Team standup SayNext demo tomorrow.",
      "api schema missing maybe frontend stuck.",
    ],
    latest: "xiang you do front end can keep with mock or no",
    expectAny: ["mock", "schema", "frontend", "confirm", "api"],
    rejectAny: ["sorry could you say that again", "daily", "anime"],
    maxWords: 45,
  },
];

mkdirSync(outputDir, { recursive: true });
const currentSceneProfile = makeSceneProfile();
const results: CaseResult[] = [];

console.log(`MEETING_LIVE_STATE_LLM provider=${process.env.LLM_PROVIDER || "openai"} model=${process.env.OLLAMA_MODEL || process.env.MODEL_NAME || "openai"} cases=${cases.length} compareBaseline=${compareBaseline ? "yes" : "no"}`);

async function runSuite(suite: CaseResult["suite"], sceneProfile: string): Promise<void> {
for (const caseItem of cases) {
  const eventMemory = buildMeetingEvent(caseItem);
  const eventForPrompt = suite === "baseline" ? withoutLiveMeetingState(eventMemory) : eventMemory;
  const conversation: Conversation = [
    ...caseItem.history.slice(-3).map((text, index) => ({
      type: "transcript" as const,
      text,
      timestamp: Date.now() - (caseItem.history.length - index) * 1000,
    })),
    {
      type: "transcript" as const,
      text: caseItem.latest,
      timestamp: Date.now(),
    },
  ];
  const memoryQuery = eventMemory.recentTranscripts.slice(-4).join("\n") || caseItem.latest;
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 3);

  const response = await processConversation(
    conversation,
    "high",
    eventForPrompt,
    "english",
    "",
    sceneProfile,
    relevantMemory,
  );
  const output = "output" in response ? response.output : "";
  const flags = scoreCase(caseItem, output);
  const verdict: CaseResult["verdict"] = flags.some((flag) => (
    flag.startsWith("empty")
    || flag.startsWith("contains_rejected")
    || flag === "personal_leak"
    || flag === "invented_scale_or_work_experience"
    || flag === "meta_or_ai_language"
  )) ? "bad" : flags.length ? "watch" : "good";

  results.push({
    suite,
    id: caseItem.id,
    note: caseItem.note,
    latest: caseItem.latest,
    meetingState: eventForPrompt.meetingState,
    output,
    flags,
    verdict,
  });

  console.log(`[${suite.toUpperCase()}:${verdict.toUpperCase()}] ${caseItem.id}: ${output}`);
  if (flags.length) console.log(`  flags=${flags.join(", ")}`);
}
}

await runSuite("current", currentSceneProfile);
if (compareBaseline) {
  await runSuite("baseline", LEGACY_MEETING_PROMPT);
}

const currentResults = results.filter((result) => result.suite === "current");
const baselineResults = results.filter((result) => result.suite === "baseline");
const countByVerdict = (items: CaseResult[], verdict: CaseResult["verdict"]) => items.filter((result) => result.verdict === verdict).length;
const good = countByVerdict(currentResults, "good");
const watch = countByVerdict(currentResults, "watch");
const bad = countByVerdict(currentResults, "bad");
const baselineGood = countByVerdict(baselineResults, "good");
const baselineWatch = countByVerdict(baselineResults, "watch");
const baselineBad = countByVerdict(baselineResults, "bad");
const mdPath = join(outputDir, `meeting-live-state-llm-${nowLabel}.md`);
const jsonPath = join(outputDir, `meeting-live-state-llm-${nowLabel}.json`);

const markdown = [
  "# Meeting Live State LLM Eval",
  "",
  `Provider: ${process.env.LLM_PROVIDER || "openai"}`,
  `Model: ${process.env.OLLAMA_MODEL || process.env.MODEL_NAME || "openai"}`,
  `User: ${userId}`,
  `Current cases: ${currentResults.length}`,
  `Current good: ${good}`,
  `Current watch: ${watch}`,
  `Current bad: ${bad}`,
  compareBaseline ? `Baseline cases: ${baselineResults.length}` : "",
  compareBaseline ? `Baseline good: ${baselineGood}` : "",
  compareBaseline ? `Baseline watch: ${baselineWatch}` : "",
  compareBaseline ? `Baseline bad: ${baselineBad}` : "",
  "",
  ...results.flatMap((result, index) => [
    `## ${index + 1}. [${result.suite}] ${result.id} (${result.verdict})`,
    "",
    `Note: ${result.note}`,
    "",
    `Latest: ${result.latest}`,
    "",
    "Meeting state:",
    "```json",
    JSON.stringify(result.meetingState ?? null, null, 2),
    "```",
    "",
    "Output:",
    "```text",
    result.output,
    "```",
    "",
    `Flags: ${result.flags.length ? result.flags.join(", ") : "none"}`,
    "",
  ]),
].join("\n");

writeFileSync(mdPath, markdown, "utf8");
writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

console.log(`MEETING_LIVE_STATE_LLM_DONE current_good=${good} current_watch=${watch} current_bad=${bad} baseline_good=${baselineGood} baseline_watch=${baselineWatch} baseline_bad=${baselineBad}`);
console.log(`Report: ${mdPath}`);
