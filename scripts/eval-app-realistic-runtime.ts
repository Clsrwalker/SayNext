import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSession } from "@mentra/sdk";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { LocationManager } from "../src/server/manager/LocationManager";
import { MergeResponseHandler } from "../src/server/mastra/agents/response-handler";
import { buildLosslessRuntimeContext, processPrenote } from "../src/server/prenotes/prenote-processor";

type DisplayEvent = {
  atMs: number;
  text: string;
  durationMs?: number;
};

type StatusEvent = {
  atMs: number;
  event: Record<string, unknown>;
};

type InsightEvent = {
  atMs: number;
  text: string;
  reasoning: string;
  agentType: string;
};

type LoggerEvent = {
  atMs: number;
  level: "info" | "warn" | "error";
  message: string;
};

type Step =
  | {
      kind: "say";
      id: string;
      text: string;
      note?: string;
      expectAny?: string[];
      rejectAny?: string[];
      expectStatusReason?: string;
      maxMs?: number;
    }
  | {
      kind: "echoLast";
      id: string;
      note?: string;
      mutate?: "same" | "fillers" | "partial" | "wrong_words";
      expectStatusReason?: string;
      maxMs?: number;
    }
  | {
      kind: "concurrent";
      id: string;
      first: string;
      second: string;
      gapMs: number;
      note?: string;
      expectStatusReason?: string;
      maxMs?: number;
    }
  | {
      kind: "manual";
      id: string;
      action: "advance" | "rewind" | "cancel" | "reset";
      note?: string;
    };

type Scenario = {
  id: string;
  scene: "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";
  description: string;
  steps: Step[];
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const userId = process.argv.find((arg) => arg.includes("@")) || `eval-app-runtime-${Date.now()}`;

function nowMs(start: number): number {
  return Math.round(performance.now() - start);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function mutateEcho(text: string, mode: Step extends { kind: "echoLast"; mutate?: infer T } ? T : never): string {
  const cleaned = compact(text);
  if (!cleaned) return "";
  if (mode === "partial") {
    return cleaned.split(/\s+/).slice(0, Math.max(4, Math.floor(cleaned.split(/\s+/).length * 0.55))).join(" ");
  }
  if (mode === "fillers") {
    return `uh yeah ${cleaned.replace(/\b(is|are|the|a)\b/gi, "$1, like,")}`;
  }
  if (mode === "wrong_words") {
    return cleaned
      .replace(/\brollback\b/gi, "roll back")
      .replace(/\bdeployment\b/gi, "deploy mint")
      .replace(/\bdeadline\b/gi, "dead line")
      .replace(/\bprivacy\b/gi, "private sea");
  }
  return cleaned;
}

class MockSession {
  public displays: DisplayEvent[] = [];
  public logs: LoggerEvent[] = [];

  constructor(private readonly startMs: number) {}

  layouts = {
    showTextWall: (text: string, options: { durationMs?: number } = {}) => {
      this.displays.push({
        atMs: nowMs(this.startMs),
        text,
        durationMs: options.durationMs,
      });
    },
  };

  logger = {
    info: (...args: any[]) => this.log("info", args),
    warn: (...args: any[]) => this.log("warn", args),
    error: (...args: any[]) => this.log("error", args),
  };

  private log(level: "info" | "warn" | "error", args: any[]): void {
    const message = args
      .map((item) => typeof item === "string" ? item : JSON.stringify(item))
      .join(" ");
    this.logs.push({ atMs: nowMs(this.startMs), level, message });
  }
}

async function createEvalPrenote(): Promise<number> {
  const title = `Runtime Eval Prenote ${timestamp}`;
  const sourceText = [
    "# Course Logistics",
    "APP_RUNTIME_CRITICAL_DEADLINE: The final report is due June 12 at 11:59 PM.",
    "APP_RUNTIME_CRITICAL_ROOM: The rehearsal room is Goldberg Computer Science Building room 134.",
    "",
    "# Project Demo Rubric",
    "APP_RUNTIME_CRITICAL_DEMO: The demo should mention rollback owner, smoke-test command, privacy risk mitigation, and exact API contract.",
    "",
    "# API Contract",
    "APP_RUNTIME_CRITICAL_API_FIELDS: Stable fields are userId, sessionId, transcriptText, activePrenoteIds, and responseMode.",
    "",
    Array.from({ length: 80 }, (_, index) => `Noise filler ${index}: unrelated classroom notes, project chatter, social conversation, and random ASR text.`).join("\n"),
  ].join("\n");

  const processed = await processPrenote({
    title,
    description: "Runtime simulation prenote",
    sourceText,
    files: [],
  });
  const prenote = conversationLogger.createPrenote({
    userId,
    title,
    sourceText,
    contentHash: processed.contentHash,
  });
  if (!prenote) throw new Error("Failed to create runtime eval prenote");

  conversationLogger.updatePrenoteProcessing(prenote.id, {
    status: "ready",
    extractedText: processed.extractedText,
    processedJson: processed.processedJson,
    runtimeContext: buildLosslessRuntimeContext(title, processed.extractedText),
    model: processed.model,
    contentHash: processed.contentHash,
  });
  conversationLogger.setPrenoteActive(userId, prenote.id, true);
  await conversationLogger.rebuildPrenoteChunks(prenote.id);
  return prenote.id;
}

function setScene(scene: Scenario["scene"]): void {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === scene);
  if (profile) conversationLogger.setActiveSceneProfile(userId, profile.id);
}

function makeScenarios(): Scenario[] {
  return [
    {
      id: "daily_echo_and_interruption",
      scene: "Daily Chat",
      description: "Daily small talk, then Xiang reads the AI output back with filler words, then the other person asks a new question.",
      steps: [
        {
          kind: "say",
          id: "day_question",
          text: "Good morning, how's your day going so far?",
          expectAny: ["going", "pretty", "chill", "slow", "not bad", "okay"],
          rejectAny: ["project", "lambda", "dynamodb"],
          maxMs: 1800,
        },
        {
          kind: "echoLast",
          id: "xiang_reads_output",
          mutate: "fillers",
          expectStatusReason: "suggestion_echo",
          maxMs: 120,
        },
        {
          kind: "say",
          id: "fresh_question_after_echo",
          text: "Nice. Are you just taking it easy today?",
          expectAny: ["yeah", "mostly", "probably", "kind of", "taking it easy"],
          rejectAny: ["suggestion_echo", "rollback", "deadline"],
          maxMs: 1800,
        },
      ],
    },
    {
      id: "prenote_short_precision",
      scene: "Classroom",
      description: "Short daily/classroom logistics question should use Prenote fast retrieval without semantic wait.",
      steps: [
        {
          kind: "say",
          id: "deadline_noisy",
          text: "uh the final report deadline like when again?",
          expectAny: ["June 12", "11:59", "midnight"],
          rejectAny: ["I think", "not sure", "project"],
          maxMs: 1800,
        },
        {
          kind: "say",
          id: "room_question",
          text: "where is the rehearsal room, the classroom room number?",
          expectAny: ["Goldberg", "134"],
          rejectAny: ["maybe", "not sure"],
          maxMs: 1800,
        },
      ],
    },
    {
      id: "teleprompt_interrupt",
      scene: "Interview",
      description: "Long project answer starts teleprompt; Xiang reads part of it, then someone interrupts with a specific Prenote question.",
      steps: [
        {
          kind: "say",
          id: "long_project_prompt",
          text: "Can you explain your project in detail for a presentation?",
          expectAny: ["Hybrid Search Memory Assistant", "project", "real-time", "I built"],
          maxMs: 1200,
        },
        {
          kind: "echoLast",
          id: "read_opening_partial",
          mutate: "partial",
          expectStatusReason: "teleprompt_hold",
          maxMs: 180,
        },
        {
          kind: "say",
          id: "interrupt_deadline",
          text: "wait sorry quick question, what's the final report deadline?",
          expectAny: ["June 12", "11:59"],
          maxMs: 2200,
        },
        {
          kind: "manual",
          id: "cancel_after_interrupt",
          action: "cancel",
        },
      ],
    },
    {
      id: "meeting_stale_response",
      scene: "Meeting / Group Discussion",
      description: "Two rapid turns arrive before the first model call finishes; stale response should not overwrite newer output.",
      steps: [
        {
          kind: "concurrent",
          id: "rapid_correction",
          first: "I think the main issue is the API contract, we need to explain the fields.",
          second: "Actually the blocker is privacy risk mitigation for uploaded files.",
          gapMs: 80,
          expectStatusReason: "stale_response",
          maxMs: 3000,
        },
      ],
    },
    {
      id: "asr_noise_wrong_words",
      scene: "Classroom",
      description: "ASR has wrong words, fillers, and reduced grammar. It should still retrieve project demo rubric or answer safely.",
      steps: [
        {
          kind: "say",
          id: "wrong_words_demo",
          text: "uh for the demo rub brick what we need mention roll back owner smoke test and private sea thing?",
          expectAny: ["rollback", "smoke", "privacy", "API"],
          rejectAny: ["food", "game"],
          maxMs: 2000,
        },
      ],
    },
  ];
}

type StepResult = {
  scenarioId: string;
  stepId: string;
  kind: Step["kind"];
  input: string;
  elapsedMs: number;
  newDisplays: DisplayEvent[];
  newStatuses: StatusEvent[];
  newInsights: InsightEvent[];
  flags: string[];
  verdict: "good" | "watch" | "bad";
};

function judgeStep(step: Step, result: Omit<StepResult, "flags" | "verdict">): { flags: string[]; verdict: StepResult["verdict"] } {
  const flags: string[] = [];
  const displayText = result.newDisplays.map((item) => item.text).join("\n");
  const statusReasons = result.newStatuses.map((item) => String(item.event.reason || item.event.type));

  if ("expectAny" in step && step.expectAny?.length && !includesAny(displayText, step.expectAny)) {
    flags.push(`missing_expected:${step.expectAny.join("|")}`);
  }
  if ("rejectAny" in step && step.rejectAny?.length && includesAny(displayText, step.rejectAny)) {
    flags.push(`contains_rejected:${step.rejectAny.join("|")}`);
  }
  if ("expectStatusReason" in step && step.expectStatusReason && !statusReasons.includes(step.expectStatusReason)) {
    flags.push(`missing_status:${step.expectStatusReason}`);
  }
  if ("maxMs" in step && step.maxMs && result.elapsedMs > step.maxMs) {
    flags.push(`slow:${result.elapsedMs}>${step.maxMs}`);
  }
  if (step.kind === "say" && !result.newDisplays.length && !statusReasons.some((reason) => reason.includes("teleprompt"))) {
    flags.push("no_display");
  }
  if (result.newDisplays.some((item) => /^(you can say|suggested reply|answer:|reply:)/i.test(item.text.trim()))) {
    flags.push("meta_prefix_displayed");
  }

  const bad = flags.some((flag) => flag.startsWith("missing_expected") || flag.startsWith("contains_rejected") || flag.startsWith("missing_status") || flag === "no_display");
  return { flags, verdict: bad ? "bad" : flags.length ? "watch" : "good" };
}

async function runScenario(scenario: Scenario, handler: MergeResponseHandler, mock: MockSession, statuses: StatusEvent[], insights: InsightEvent[], startMs: number): Promise<StepResult[]> {
  setScene(scenario.scene);
  handler.resetRuntimeState();
  await sleep(20);

  const results: StepResult[] = [];
  for (const step of scenario.steps) {
    const displayStart = mock.displays.length;
    const statusStart = statuses.length;
    const insightStart = insights.length;
    const stepStart = performance.now();
    let input = "";

    if (step.kind === "say") {
      input = step.text;
      await handler.processTranscript(step.text, Date.now());
    } else if (step.kind === "echoLast") {
      const lastDisplay = [...mock.displays].reverse().find((item) => item.text && item.text !== "SayNext is listening.");
      input = mutateEcho(lastDisplay?.text || "", step.mutate || "same");
      await handler.processTranscript(input, Date.now());
    } else if (step.kind === "concurrent") {
      input = `${step.first} || ${step.second}`;
      const first = handler.processTranscript(step.first, Date.now());
      await sleep(step.gapMs);
      const second = handler.processTranscript(step.second, Date.now());
      await Promise.allSettled([first, second]);
    } else if (step.kind === "manual") {
      input = step.action;
      if (step.action === "advance") handler.advanceTelepromptManually();
      if (step.action === "rewind") handler.rewindTelepromptManually();
      if (step.action === "cancel") handler.cancelTelepromptManually();
      if (step.action === "reset") handler.resetRuntimeState();
    }

    const elapsedMs = Math.round(performance.now() - stepStart);
    const baseResult = {
      scenarioId: scenario.id,
      stepId: step.id,
      kind: step.kind,
      input,
      elapsedMs,
      newDisplays: mock.displays.slice(displayStart),
      newStatuses: statuses.slice(statusStart),
      newInsights: insights.slice(insightStart),
    };
    const judgment = judgeStep(step, baseResult);
    results.push({ ...baseResult, ...judgment });

    await sleep(80);
  }

  return results;
}

function summarize(results: StepResult[]): string {
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] || 0) + 1;
    return acc;
  }, {});

  return [
    `- steps: ${results.length}`,
    `- good: ${counts.good || 0}`,
    `- watch: ${counts.watch || 0}`,
    `- bad: ${counts.bad || 0}`,
    `- avg elapsed: ${Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / Math.max(1, results.length))}ms`,
    `- p95 elapsed: ${results.map((item) => item.elapsedMs).sort((a, b) => a - b)[Math.max(0, Math.ceil(results.length * 0.95) - 1)] || 0}ms`,
  ].join("\n");
}

function renderReport(scenarios: Scenario[], results: StepResult[], mock: MockSession): string {
  const sections = scenarios.map((scenario) => {
    const scenarioResults = results.filter((item) => item.scenarioId === scenario.id);
    return [
      `## ${scenario.id}`,
      "",
      `Scene: ${scenario.scene}`,
      "",
      scenario.description,
      "",
      ...scenarioResults.map((result) => [
        `### ${result.verdict.toUpperCase()} ${result.stepId}`,
        "",
        `- kind: ${result.kind}`,
        `- elapsedMs: ${result.elapsedMs}`,
        `- flags: ${result.flags.join(", ") || "(none)"}`,
        `- input: ${result.input}`,
        `- statuses: ${result.newStatuses.map((item) => `${item.event.type}:${item.event.reason || ""}`).join(" | ") || "(none)"}`,
        "",
        "Displays:",
        "```text",
        result.newDisplays.map((item) => `[+${item.atMs}ms ${item.durationMs || ""}] ${item.text}`).join("\n") || "(none)",
        "```",
      ].join("\n")),
    ].join("\n");
  }).join("\n\n");

  const processNotes = [
    "## Process Notes",
    "",
    "- This uses MergeResponseHandler with a mock Mentra session, so display/status paths are exercised.",
    "- ASR partial buffering is approximated by feeding final utterances and echo/noise variants; User.ts timeout buffering is not fully wall-clock simulated here.",
    "- Fast Prenote retrieval is used for short replies; semantic retrieval is used only when teleprompt starts.",
    "- The report flags process failures separately from content quality.",
  ].join("\n");

  return [
    "# App Realistic Runtime Eval",
    "",
    `- timestamp: ${new Date().toISOString()}`,
    `- userId: ${userId}`,
    `- llmProvider: ${process.env.LLM_PROVIDER || "auto/default"}`,
    "",
    "## Summary",
    "",
    summarize(results),
    "",
    sections,
    "",
    processNotes,
    "",
    "## Recent Internal Logs",
    "",
    "```text",
    mock.logs.slice(-80).map((item) => `[+${item.atMs}ms ${item.level}] ${item.message}`).join("\n"),
    "```",
  ].join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const startMs = performance.now();
  const mock = new MockSession(startMs);
  const statuses: StatusEvent[] = [];
  const insights: InsightEvent[] = [];
  const handler = new MergeResponseHandler(
    mock as unknown as AppSession,
    userId,
    new LocationManager(userId),
    "high",
    "english",
  );

  handler.onStatus = (event) => statuses.push({ atMs: nowMs(startMs), event });
  handler.onInsight = (event) => insights.push({ atMs: nowMs(startMs), ...event });

  const prenoteId = await createEvalPrenote();
  const scenarios = makeScenarios();
  const results: StepResult[] = [];

  try {
    for (const scenario of scenarios) {
      results.push(...await runScenario(scenario, handler, mock, statuses, insights, startMs));
    }
  } finally {
    conversationLogger.deletePrenote(userId, prenoteId);
    handler.close();
  }

  const report = renderReport(scenarios, results, mock);
  const reportPath = join(outDir, `app-realistic-runtime-${timestamp}.md`);
  const jsonPath = join(outDir, `app-realistic-runtime-${timestamp}.json`);
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify({ scenarios, results, displays: mock.displays, statuses, insights, logs: mock.logs }, null, 2), "utf8");

  console.log(`APP_REALISTIC_RUNTIME_REPORT ${reportPath}`);
  console.log(summarize(results));
  if (results.some((result) => result.verdict === "bad")) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
