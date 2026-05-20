import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSession } from "@mentra/sdk";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { LocationManager } from "../src/server/manager/LocationManager";
import { MergeResponseHandler } from "../src/server/mastra/agents/response-handler";
import { routeFastScene, type SceneBuiltinKey } from "../src/server/scene/fast-scene-router";

type PureCase = {
  id: string;
  latestTranscript: string;
  recentTranscripts?: string[];
  previousSceneKey?: SceneBuiltinKey;
  expected: SceneBuiltinKey;
};

type RuntimeCase = {
  id: string;
  transcript: string;
  expected: SceneBuiltinKey;
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const userId = `eval-auto-scene-${Date.now()}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockSession {
  layouts = {
    showTextWall: () => undefined,
  };
  logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

const pureCases: PureCase[] = [
  {
    id: "daily_morning",
    latestTranscript: "Good morning, how's your day going so far?",
    expected: "daily_chat",
  },
  {
    id: "daily_after_class_food",
    latestTranscript: "what are you doing after class, wanna grab food?",
    expected: "daily_chat",
  },
  {
    id: "daily_store_transaction",
    latestTranscript: "The total is forty two eighty, do you want to tap or insert?",
    expected: "daily_chat",
  },
  {
    id: "classroom_lambda_concept",
    latestTranscript: "lambda cold start not my why it happen when function sleep long time",
    expected: "classroom",
  },
  {
    id: "classroom_teacher_lecture",
    latestTranscript: "So the key idea with indexes is that writes become more expensive but reads can become much faster",
    expected: "classroom",
  },
  {
    id: "interview_behavioral",
    latestTranscript: "Okay let's start, tell me about a time you had conflict with a teammate.",
    expected: "interview",
  },
  {
    id: "interview_ielts",
    latestTranscript: "In this first part I'd like to ask you, do you work or are you a student?",
    expected: "interview",
  },
  {
    id: "interview_small_talk_keep",
    latestTranscript: "How's your morning going?",
    previousSceneKey: "interview",
    expected: "interview",
  },
  {
    id: "meeting_blocker",
    latestTranscript: "The main blocker is the privacy issue with uploaded files, what should we do next?",
    expected: "meeting_group",
  },
  {
    id: "meeting_current_flow",
    latestTranscript: "I don't think it works with the current flow, what do you think?",
    recentTranscripts: ["We are reviewing the API contract and mobile flow in the team meeting."],
    expected: "meeting_group",
  },
  {
    id: "meeting_people_overlap",
    latestTranscript: "A says the API is fine but B says wait the privacy issue is still open",
    expected: "meeting_group",
  },
  {
    id: "casual_project_question",
    latestTranscript: "what project did you make recently?",
    expected: "daily_chat",
  },
  {
    id: "interview_project_question_keep",
    latestTranscript: "what project did you make recently?",
    previousSceneKey: "interview",
    expected: "interview",
  },
];

const runtimeCases: RuntimeCase[] = [
  {
    id: "runtime_daily",
    transcript: "Good morning, how's your day going so far?",
    expected: "daily_chat",
  },
  {
    id: "runtime_interview",
    transcript: "In this first part I'd like to ask you, do you work or are you a student?",
    expected: "interview",
  },
  {
    id: "runtime_meeting",
    transcript: "The main blocker is the privacy issue with uploaded files, what should we do next?",
    expected: "meeting_group",
  },
  {
    id: "runtime_transaction_daily",
    transcript: "The total is forty two eighty, do you want to tap or insert?",
    expected: "daily_chat",
  },
];

async function runRuntimeCase(test: RuntimeCase): Promise<{ id: string; expected: SceneBuiltinKey; actual: string; passed: boolean }> {
  const session = new MockSession() as unknown as AppSession;
  const handler = new MergeResponseHandler(session, `${userId}-${test.id}`, new LocationManager(), "high", "english");
  const profiles = conversationLogger.listSceneProfiles(`${userId}-${test.id}`);
  const auto = profiles.find((profile) => profile.builtinKey === "auto");
  if (!auto) throw new Error("Auto scene profile was not created");
  conversationLogger.setActiveSceneProfile(`${userId}-${test.id}`, auto.id);

  let actual = "";
  handler.onStatus = (event) => {
    if (event.type === "auto_scene") actual = String(event.sceneKey || "");
  };
  await handler.processTranscript(test.transcript, Date.now());
  await sleep(20);
  handler.close();
  return {
    id: test.id,
    expected: test.expected,
    actual,
    passed: actual === test.expected,
  };
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const pureResults = pureCases.map((test) => {
    const result = routeFastScene(test);
    return {
      id: test.id,
      expected: test.expected,
      actual: result.sceneKey,
      confidence: result.confidence,
      reason: result.reason,
      scores: result.scores,
      passed: result.sceneKey === test.expected,
    };
  });

  const runtimeResults = [];
  for (const test of runtimeCases) {
    runtimeResults.push(await runRuntimeCase(test));
  }

  const failures = [
    ...pureResults.filter((item) => !item.passed).map((item) => `pure:${item.id}`),
    ...runtimeResults.filter((item) => !item.passed).map((item) => `runtime:${item.id}`),
  ];

  const report = [
    "# Auto Scene Router Eval",
    "",
    `- timestamp: ${new Date().toISOString()}`,
    `- pure cases: ${pureResults.length}`,
    `- runtime cases: ${runtimeResults.length}`,
    `- failures: ${failures.length}`,
    "",
    "## Pure Router",
    "",
    ...pureResults.map((item) => [
      `### ${item.passed ? "PASS" : "FAIL"} ${item.id}`,
      `- expected: ${item.expected}`,
      `- actual: ${item.actual}`,
      `- confidence: ${item.confidence}`,
      `- reason: ${item.reason}`,
      `- scores: ${JSON.stringify(item.scores)}`,
      "",
    ].join("\n")),
    "## Runtime Auto Profile",
    "",
    ...runtimeResults.map((item) => [
      `### ${item.passed ? "PASS" : "FAIL"} ${item.id}`,
      `- expected: ${item.expected}`,
      `- actual: ${item.actual}`,
      "",
    ].join("\n")),
  ].join("\n");

  const path = join(outDir, `auto-scene-router-${timestamp}.md`);
  writeFileSync(path, report);
  console.log(`AUTO_SCENE_ROUTER_REPORT ${path}`);
  console.log(`pure: ${pureResults.length}, runtime: ${runtimeResults.length}, failures: ${failures.length}`);
  if (failures.length) {
    console.log(`FAILURES ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
