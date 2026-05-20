import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSession } from "@mentra/sdk";
import { LocationManager } from "../src/server/manager/LocationManager";
import { MergeResponseHandler } from "../src/server/mastra/agents/response-handler";
import { Action, AgentType, type AgentInsight, type Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";

type DisplayEvent = {
  text: string;
  durationMs?: number;
};

type StatusEvent = {
  event: Record<string, unknown>;
};

type CaseResult = {
  id: string;
  description: string;
  statuses: Record<string, number>;
  displays: DisplayEvent[];
  flags: string[];
  pass: boolean;
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const userId = `eval-readback-continuation-${Date.now()}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockSession {
  public displays: DisplayEvent[] = [];
  public logs: string[] = [];

  layouts = {
    showTextWall: (text: string, options: { durationMs?: number } = {}) => {
      this.displays.push({ text, durationMs: options.durationMs });
    },
  };

  logger = {
    info: (...args: unknown[]) => this.logs.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => this.logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => this.logs.push(args.map(String).join(" ")),
  };
}

function createHandler(): {
  handler: MergeResponseHandler;
  mock: MockSession;
  statuses: StatusEvent[];
} {
  const mock = new MockSession();
  const statuses: StatusEvent[] = [];
  const handler = new MergeResponseHandler(
    mock as unknown as AppSession,
    userId,
    new LocationManager(userId),
    "high",
    "english",
  );
  handler.onStatus = (event) => statuses.push({ event });
  return { handler, mock, statuses };
}

function makeInsight(text: string): AgentInsight {
  return {
    type: Action.INSIGHT,
    reasoning: "eval seeded display",
    timestamp: Date.now(),
    output: text,
    confidence: 0.9,
    metadata: { agentType: AgentType.Initial },
  };
}

function fakeEvent(scene = "interview"): EventMemorySnapshot {
  return {
    eventId: `eval-${Date.now()}`,
    scene,
    title: scene,
    summary: `Scene: ${scene}.`,
    transcriptCount: 1,
    aiReplyCount: 1,
    recentTranscripts: [],
  };
}

function seedDisplayAndContext(handler: MergeResponseHandler, suggestion: string, sourceTranscript: string, scene = "interview"): void {
  const conversation: Conversation = [
    { type: "transcript", text: sourceTranscript, timestamp: Date.now() - 1000 },
  ];
  (handler as any).lastDisplayedAnswerContext = {
    displayText: suggestion,
    sourceTranscript,
    context: conversation,
    eventSnapshot: fakeEvent(scene),
    activePrenoteContext: "",
    activeSceneProfilePrompt: "",
    relevantPersonalMemoryContext: "",
    timestamp: Date.now() - 1000,
  };
  (handler as any).tryShowInsight(suggestion, 45_000, { skipCache: true }, makeInsight(suggestion));
}

function countStatus(statuses: StatusEvent[], type: string, reason?: string): number {
  return statuses.filter(({ event }) => {
    if (event.type !== type) return false;
    if (reason !== undefined && event.reason !== reason) return false;
    return true;
  }).length;
}

function summarizeStatus(statuses: StatusEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { event } of statuses) {
    const key = typeof event.reason === "string" ? `${event.type}:${event.reason}` : String(event.type);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function runCompleteReadSchedules(): Promise<CaseResult> {
  const { handler, mock, statuses } = createHandler();
  const suggestion = "I'm currently a MACS student at Dalhousie, so it's Master of Applied Computer Science. It is more applied and project-focused than a pure math program.";
  const source = "Do you work or are you a student, and what is your major?";
  const flags: string[] = [];

  try {
    seedDisplayAndContext(handler, suggestion, source, "interview");
    await handler.processTranscript("I'm currently a MACS student at Dalhousie so it's Master of Applied Computer Science it is more applied and project focused than a pure math program", Date.now());

    if (!countStatus(statuses, "processing_done", "suggestion_echo")) flags.push("readback_not_classified_as_echo");
    if (!countStatus(statuses, "readback_continuation_scheduled")) flags.push("continuation_not_scheduled_after_complete_read");
    if (countStatus(statuses, "display_refreshed", "suggestion_echo")) flags.push("complete_read_redrew_active_display");
    if (!countStatus(statuses, "display_extended", "suggestion_echo")) flags.push("active_display_not_extended");

    return {
      id: "complete_read_schedules_continuation",
      description: "A full readback of a normal interview answer should stay on screen and schedule one optional continuation.",
      statuses: summarizeStatus(statuses),
      displays: mock.displays,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runPartialReadDoesNotSchedule(): Promise<CaseResult> {
  const { handler, mock, statuses } = createHandler();
  const suggestion = "One project I worked on is SayNext, a mobile real-time conversation assistant. It listens to live transcript and suggests a natural sentence I can say next.";
  const source = "Could you tell me about a project you made?";
  const flags: string[] = [];

  try {
    seedDisplayAndContext(handler, suggestion, source, "interview");
    await handler.processTranscript("One project I worked on is SayNext a mobile real-time conversation assistant", Date.now());

    if (!countStatus(statuses, "processing_done", "suggestion_echo")) flags.push("partial_read_not_classified_as_echo");
    if (countStatus(statuses, "readback_continuation_scheduled")) flags.push("partial_read_scheduled_too_early");

    return {
      id: "partial_read_no_continuation",
      description: "A partial readback should keep the answer visible but should not schedule continuation yet.",
      statuses: summarizeStatus(statuses),
      displays: mock.displays,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runInterruptionCancelsContinuation(): Promise<CaseResult> {
  const { handler, mock, statuses } = createHandler();
  const suggestion = "I'm currently a MACS student at Dalhousie, so it's Master of Applied Computer Science. It is more applied and project-focused than a pure math program.";
  const source = "Do you work or are you a student, and what is your major?";
  const flags: string[] = [];

  try {
    seedDisplayAndContext(handler, suggestion, source, "interview");
    await handler.processTranscript("I'm currently a MACS student at Dalhousie so it's Master of Applied Computer Science it is more applied and project focused than a pure math program", Date.now());
    await handler.processTranscript("Okay, and what project did you build?", Date.now() + 500);

    if (!countStatus(statuses, "readback_continuation_scheduled")) flags.push("continuation_was_not_scheduled_before_interruption");
    if (!countStatus(statuses, "readback_continuation_cancelled", "new_transcript")) flags.push("interruption_did_not_cancel_continuation");
    if (countStatus(statuses, "processing_done", "suggestion_echo") < 1) flags.push("initial_readback_not_echo");

    return {
      id: "interruption_cancels_continuation",
      description: "If the other person speaks after Xiang finishes reading, the pending continuation must be cancelled so the new question can be answered.",
      statuses: summarizeStatus(statuses),
      displays: mock.displays,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runServiceDoesNotSchedule(): Promise<CaseResult> {
  const { handler, mock, statuses } = createHandler();
  const suggestion = "Okay, here you go.";
  const source = "Could I have your ID, please?";
  const flags: string[] = [];

  try {
    seedDisplayAndContext(handler, suggestion, source, "service_or_advisor");
    await handler.processTranscript("Okay here you go", Date.now());

    if (!countStatus(statuses, "processing_done", "suggestion_echo")) flags.push("service_readback_not_echo");
    if (countStatus(statuses, "readback_continuation_scheduled")) flags.push("service_short_answer_scheduled_continuation");

    return {
      id: "service_short_answer_no_continuation",
      description: "Short service transaction readback should not create an awkward extra supplement.",
      statuses: summarizeStatus(statuses),
      displays: mock.displays,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runTimerDeclinesWhenDisplayChanges(): Promise<CaseResult> {
  const { handler, mock, statuses } = createHandler();
  const suggestion = "I think the safest next step is to lock the API fields first, then test the mobile flow with a small sample. That way we avoid changing the frontend and backend at the same time.";
  const source = "What should we do next for the project?";
  const flags: string[] = [];

  try {
    seedDisplayAndContext(handler, suggestion, source, "group_discussion");
    await handler.processTranscript("I think the safest next step is to lock the API fields first then test the mobile flow with a small sample that way we avoid changing the frontend and backend at the same time", Date.now());
    (handler as any).tryShowInsight("New unrelated display.", 45_000, { skipCache: true }, makeInsight("New unrelated display."));
    await sleep(20);

    if (!countStatus(statuses, "readback_continuation_scheduled")) flags.push("continuation_not_scheduled_initially");
    if (!countStatus(statuses, "readback_continuation_cancelled", "new_display")) flags.push("new_display_did_not_cancel_continuation");

    return {
      id: "new_display_cancels_continuation",
      description: "A fresh display should cancel pending continuation from the older answer.",
      statuses: summarizeStatus(statuses),
      displays: mock.displays,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

function renderReport(results: CaseResult[]): string {
  const failed = results.filter((item) => !item.pass);
  const lines: string[] = [];
  lines.push("# Readback Continuation Runtime Eval");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Cases: ${results.length}`);
  lines.push(`Passed: ${results.length - failed.length}`);
  lines.push(`Failed: ${failed.length}`);
  lines.push("");
  lines.push("## Process Contract");
  lines.push("- Self-read echo keeps the current answer on screen and does not call the normal response path.");
  lines.push("- Only a near-complete readback schedules an optional continuation.");
  lines.push("- Any new non-echo transcript or fresh display cancels the pending continuation.");
  lines.push("- Short service/transaction replies should not create awkward extra speech.");
  lines.push("");

  for (const result of results) {
    lines.push(`## ${result.pass ? "PASS" : "FAIL"} ${result.id}`);
    lines.push(result.description);
    lines.push(`Statuses: ${JSON.stringify(result.statuses)}`);
    lines.push(`Displays: ${result.displays.map((item) => `"${item.text}"`).join(" | ")}`);
    if (result.flags.length) lines.push(`Flags: ${result.flags.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const results = [
    await runCompleteReadSchedules(),
    await runPartialReadDoesNotSchedule(),
    await runInterruptionCancelsContinuation(),
    await runServiceDoesNotSchedule(),
    await runTimerDeclinesWhenDisplayChanges(),
  ];

  const report = renderReport(results);
  const reportPath = join(outDir, `readback-continuation-runtime-${timestamp}.md`);
  const jsonPath = join(outDir, `readback-continuation-runtime-${timestamp}.json`);
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

  const failed = results.filter((item) => !item.pass);
  console.log(`READBACK_CONTINUATION_RUNTIME_REPORT ${reportPath}`);
  console.log(`cases: ${results.length}, failed: ${failed.length}`);
  for (const result of failed) {
    console.log(`- ${result.id}: ${result.flags.join(", ")}`);
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
