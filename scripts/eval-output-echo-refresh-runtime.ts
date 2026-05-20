import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSession } from "@mentra/sdk";
import { LocationManager } from "../src/server/manager/LocationManager";
import { MergeResponseHandler, detectSuggestionEcho } from "../src/server/mastra/agents/response-handler";
import { Action, AgentType, type AgentInsight } from "../src/server/mastra/types";

type DisplayEvent = {
  atMs: number;
  text: string;
  durationMs?: number;
};

type StatusEvent = {
  atMs: number;
  event: Record<string, unknown>;
};

type LoggerEvent = {
  atMs: number;
  level: "info" | "warn" | "error";
  message: string;
};

type EchoMutation =
  | "same"
  | "partial_first"
  | "partial_middle"
  | "partial_second"
  | "fillers"
  | "stutter"
  | "wrong_words"
  | "dropped_words"
  | "punctuationless"
  | "reordered_halves";

type EchoCaseResult = {
  id: string;
  category: string;
  suggestion: string;
  transcript: string;
  mutation: EchoMutation;
  expectedEcho: boolean;
  actualEcho: boolean;
  refreshed: boolean;
  processingDoneEcho: boolean;
  elapsedMs: number;
  lastDisplayText: string;
  lastDisplayDuration?: number;
  flags: string[];
  pass: boolean;
};

type InterruptionCaseResult = {
  id: string;
  category: string;
  suggestion: string;
  interruption: string;
  actualEcho: boolean;
  matchedCandidate: string;
  flags: string[];
  pass: boolean;
};

type SplitReadCaseResult = {
  id: string;
  suggestion: string;
  fragments: string[];
  refreshedCount: number;
  processingDoneEchoCount: number;
  displayCount: number;
  flags: string[];
  pass: boolean;
};

type ExpiryCaseResult = {
  id: string;
  suggestion: string;
  transcript: string;
  echoBeforeExpiry: boolean;
  echoAfterExpiry: boolean;
  flags: string[];
  pass: boolean;
};

type NoBlinkCaseResult = {
  id: string;
  suggestion: string;
  transcript: string;
  displayCountBefore: number;
  displayCountAfter: number;
  extended: boolean;
  redrawn: boolean;
  flags: string[];
  pass: boolean;
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const userId = `eval-output-echo-refresh-${Date.now()}`;
const REFRESH_DURATION_MS = 45_000;

function nowMs(start: number): number {
  return Math.round(performance.now() - start);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return compact(text).split(/\s+/).filter(Boolean);
}

function hashText(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function mutate(text: string, mode: EchoMutation): string {
  const source = compact(text);
  const sourceWords = words(source);
  if (!sourceWords.length) return "";

  if (mode === "same") return source;
  if (mode === "partial_first") {
    return sourceWords.slice(0, Math.max(5, Math.floor(sourceWords.length * 0.42))).join(" ");
  }
  if (mode === "partial_middle") {
    const start = Math.max(0, Math.floor(sourceWords.length * 0.22));
    const end = Math.min(sourceWords.length, start + Math.max(6, Math.floor(sourceWords.length * 0.4)));
    return sourceWords.slice(start, end).join(" ");
  }
  if (mode === "partial_second") {
    return sourceWords.slice(Math.max(0, Math.floor(sourceWords.length * 0.48))).join(" ");
  }
  if (mode === "fillers") {
    return `uh yeah like ${source.replace(/\b(and|because|so|then|but|also)\b/gi, "$1, like,")}, you know`;
  }
  if (mode === "stutter") {
    return sourceWords.map((word, index) => index % 4 === 0 ? `${word} ${word}` : word).join(" ");
  }
  if (mode === "wrong_words") {
    return source
      .replace(/\bDalhousie\b/gi, "Dal house")
      .replace(/\bHalifax\b/gi, "Hally fax")
      .replace(/\bproject\b/gi, "pro jack")
      .replace(/\btranscript\b/gi, "trans crib")
      .replace(/\bserverless\b/gi, "server less")
      .replace(/\bDynamoDB\b/gi, "dynamic db")
      .replace(/\brollback\b/gi, "roll back")
      .replace(/\bprivacy\b/gi, "private sea")
      .replace(/\bdeadline\b/gi, "dead line")
      .replace(/\barchitecture\b/gi, "arch texture");
  }
  if (mode === "dropped_words") {
    return sourceWords.filter((_, index) => index % 5 !== 1).join(" ");
  }
  if (mode === "punctuationless") {
    return source.toLowerCase().replace(/[^\p{Letter}\p{Number}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }
  if (mode === "reordered_halves") {
    const split = Math.ceil(sourceWords.length / 2);
    return [...sourceWords.slice(split), ...sourceWords.slice(0, split)].join(" ");
  }
  return source;
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
    info: (...args: unknown[]) => this.log("info", args),
    warn: (...args: unknown[]) => this.log("warn", args),
    error: (...args: unknown[]) => this.log("error", args),
  };

  private log(level: "info" | "warn" | "error", args: unknown[]): void {
    const message = args
      .map((item) => typeof item === "string" ? item : JSON.stringify(item))
      .join(" ");
    this.logs.push({ atMs: nowMs(this.startMs), level, message });
  }
}

function createHandler(startMs: number): {
  handler: MergeResponseHandler;
  mock: MockSession;
  statuses: StatusEvent[];
} {
  const mock = new MockSession(startMs);
  const statuses: StatusEvent[] = [];
  const handler = new MergeResponseHandler(
    mock as unknown as AppSession,
    userId,
    new LocationManager(userId),
    "high",
    "english",
  );
  handler.onStatus = (event) => statuses.push({ atMs: nowMs(startMs), event });
  return { handler, mock, statuses };
}

function makeInsight(text: string): AgentInsight {
  return {
    type: Action.INSIGHT,
    reasoning: "eval seeded display",
    timestamp: Date.now(),
    output: text,
    confidence: 0.9,
    metadata: {
      agentType: AgentType.Initial,
    },
  };
}

function seedDisplay(handler: MergeResponseHandler, text: string, durationMs = 80): void {
  (handler as any).tryShowInsight(text, durationMs, { skipCache: true }, makeInsight(text));
}

function getEchoMatch(handler: MergeResponseHandler, text: string, timestampValue = Date.now()): any {
  return (handler as any).getRecentDisplayedSuggestionEcho(text, timestampValue);
}

function lastDisplay(mock: MockSession): DisplayEvent | undefined {
  return mock.displays[mock.displays.length - 1];
}

function statusCount(statuses: StatusEvent[], type: string, reason?: string): number {
  return statuses.filter((item) => {
    if (item.event.type !== type) return false;
    if (reason !== undefined && item.event.reason !== reason) return false;
    return true;
  }).length;
}

const suggestions = [
  {
    category: "interview_identity",
    text: "I'm currently a graduate student at Dalhousie University in Halifax, focusing on computer science, AI applications, and cloud-related projects. Right now I'm mostly trying to build practical software and improve how I explain technical work.",
  },
  {
    category: "project_explanation",
    text: "One project I worked on is SayNext, a mobile real-time conversation assistant. It listens to live transcript, keeps short context, retrieves useful memory, and suggests a natural sentence I can say next.",
  },
  {
    category: "cloud_project",
    text: "For the cloud side, I used a serverless setup with API Gateway, Lambda, DynamoDB, and S3. The main goal was to keep deployment simple while still having clear rollback, logging, and a stable API contract.",
  },
  {
    category: "daily_chat",
    text: "Honestly, probably just a pretty chill day. I might go to class, grab something easy to eat, and then maybe play games or watch anime later if I still have energy.",
  },
  {
    category: "classroom",
    text: "So if I understand it correctly, the key tradeoff is between faster iteration and long-term maintainability. I guess one question is how we decide when the extra abstraction is actually worth it.",
  },
  {
    category: "meeting",
    text: "I think the safest next step is to lock the API fields first, then test the mobile flow with a small sample. That way we avoid changing the frontend and backend at the same time.",
  },
  {
    category: "shopping",
    text: "Could I just check the return policy for this? I have the receipt, but I'm not sure if this item counts as final sale or if there is a normal return window.",
  },
  {
    category: "service_transaction",
    text: "I drive a 2025 Honda Civic hatchback, and I wanted to book a service appointment. The main thing I want checked is whether the noise is normal or if it needs a closer inspection.",
  },
  {
    category: "ceremony",
    text: "I just want to say congratulations, and I hope today feels calm and happy for both of you. I'm not great at big speeches, but I'm genuinely really glad to be here.",
  },
  {
    category: "family_meeting",
    text: "I think we should separate the emotional part from the practical part. For now, maybe we can first agree on what needs to be decided today, and leave the bigger discussion for later.",
  },
  {
    category: "short_ack",
    text: "Yeah, that makes sense.",
  },
];

const mutations: EchoMutation[] = [
  "same",
  "partial_first",
  "partial_middle",
  "partial_second",
  "fillers",
  "stutter",
  "wrong_words",
  "dropped_words",
  "punctuationless",
  "reordered_halves",
];

function shouldExpectEcho(suggestion: string, mutation: EchoMutation): boolean {
  return true;
}

async function runEchoCase(category: string, suggestion: string, mutation: EchoMutation, index: number): Promise<EchoCaseResult> {
  const startMs = performance.now();
  const { handler, mock, statuses } = createHandler(startMs);
  const transcript = mutate(suggestion, mutation);
  const expectedEcho = shouldExpectEcho(suggestion, mutation);

  try {
    seedDisplay(handler, suggestion, 80);
    await sleep(100);
    const beforeDisplayCount = mock.displays.length;
    const started = performance.now();
    await handler.processTranscript(transcript, Date.now());
    const elapsedMs = Math.round(performance.now() - started);
    const display = lastDisplay(mock);
    const actualEcho = statusCount(statuses, "processing_done", "suggestion_echo") > 0;
    const refreshed = statusCount(statuses, "display_refreshed", "suggestion_echo") > 0
      && mock.displays.length > beforeDisplayCount
      && display?.text === suggestion
      && display?.durationMs === REFRESH_DURATION_MS;
    const processingDoneEcho = statusCount(statuses, "processing_done", "suggestion_echo") > 0;
    const flags: string[] = [];

    if (actualEcho !== expectedEcho) flags.push(`expected_echo_${expectedEcho}_actual_${actualEcho}`);
    if (expectedEcho && !refreshed) flags.push("echo_did_not_refresh_display");
    if (expectedEcho && !processingDoneEcho) flags.push("echo_missing_processing_done");
    if (expectedEcho && elapsedMs > 250) flags.push(`slow_echo_path_${elapsedMs}ms`);

    return {
      id: `${category}_${mutation}_${index}`,
      category,
      suggestion,
      transcript,
      mutation,
      expectedEcho,
      actualEcho,
      refreshed,
      processingDoneEcho,
      elapsedMs,
      lastDisplayText: display?.text || "",
      lastDisplayDuration: display?.durationMs,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

const interruptionCases = [
  "Wait, could you explain the testing part again?",
  "Actually the deadline changed, so we should talk about the schedule first.",
  "Okay cool, but what did you use for the backend?",
  "No, I mean are you working or are you a student?",
  "Can we move on to the family questions now?",
  "That sounds good. What was the result?",
  "Before you continue, what was the hardest bug?",
  "I get the idea, but how do you avoid hallucination?",
  "Let's stop there and talk about the next task.",
  "The API contract changed this morning, so the mobile flow might break.",
  "Sounds good, let's continue with the next part.",
  "I don't think that answers the question.",
  "Could you give me a shorter version?",
  "Why did you choose Lambda instead of a normal server?",
  "What if the transcript is wrong?",
];

async function runInterruptionCase(category: string, suggestion: string, interruption: string, index: number): Promise<InterruptionCaseResult> {
  const startMs = performance.now();
  const { handler } = createHandler(startMs);
  try {
    seedDisplay(handler, suggestion, 80);
    await sleep(100);
    await handler.processTranscript(mutate(suggestion, "partial_first"), Date.now());
    const match = getEchoMatch(handler, interruption);
    const actualEcho = Boolean(match);
    const flags: string[] = [];
    if (actualEcho) flags.push("interruption_was_classified_as_self_read_echo");
    return {
      id: `${category}_interruption_${index}`,
      category,
      suggestion,
      interruption,
      actualEcho,
      matchedCandidate: match?.match?.candidate || "",
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runSplitReadCase(): Promise<SplitReadCaseResult> {
  const startMs = performance.now();
  const { handler, mock, statuses } = createHandler(startMs);
  const suggestion = [
    "I'm currently a graduate student at Dalhousie University in Halifax.",
    "I'm focusing on AI applications, cloud computing, and mobile software.",
    "The reason I like this area is that it connects real technical work with tools people can actually use.",
  ].join(" ");
  const fragments = [
    "I'm currently a graduate student at the Dal house in Hally fax",
    "I'm focusing on AI application cloud computing and mobile software",
    "uh the reason I like this area is that it connects real technical work with tools people can actually use",
    "I'm focusing on AI application cloud computing and mobile software",
  ];

  try {
    seedDisplay(handler, suggestion, 80);
    await sleep(100);
    for (const fragment of fragments) {
      await handler.processTranscript(fragment, Date.now());
    }

    const refreshedCount = statusCount(statuses, "display_refreshed", "suggestion_echo");
    const extendedCount = statusCount(statuses, "display_extended", "suggestion_echo");
    const processingDoneEchoCount = statusCount(statuses, "processing_done", "suggestion_echo");
    const continuedDisplayCount = refreshedCount + extendedCount;
    const flags: string[] = [];
    if (continuedDisplayCount !== fragments.length) flags.push(`expected_${fragments.length}_display_continuations_actual_${continuedDisplayCount}`);
    if (processingDoneEchoCount !== fragments.length) flags.push(`expected_${fragments.length}_echo_done_actual_${processingDoneEchoCount}`);

    return {
      id: "split_read_timeout_then_continuation",
      suggestion,
      fragments,
      refreshedCount: continuedDisplayCount,
      processingDoneEchoCount,
      displayCount: mock.displays.length,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runExpiryCase(): Promise<ExpiryCaseResult> {
  const startMs = performance.now();
  const { handler } = createHandler(startMs);
  const suggestion = suggestions[1].text;
  const transcript = mutate(suggestion, "partial_first");

  try {
    seedDisplay(handler, suggestion, 80);
    await sleep(100);
    const echoBeforeExpiry = Boolean(getEchoMatch(handler, transcript, Date.now()));
    const echoAfterExpiry = Boolean(getEchoMatch(handler, transcript, Date.now() + REFRESH_DURATION_MS + 1000));
    const flags: string[] = [];
    if (!echoBeforeExpiry) flags.push("echo_not_available_inside_window");
    if (echoAfterExpiry) flags.push("echo_still_available_after_expiry_window");
    return {
      id: "echo_memory_expiry_boundary",
      suggestion,
      transcript,
      echoBeforeExpiry,
      echoAfterExpiry,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

async function runNoBlinkCase(): Promise<NoBlinkCaseResult> {
  const startMs = performance.now();
  const { handler, mock, statuses } = createHandler(startMs);
  const suggestion = suggestions[0].text;
  const transcript = mutate(suggestion, "partial_first");

  try {
    seedDisplay(handler, suggestion, REFRESH_DURATION_MS);
    const displayCountBefore = mock.displays.length;
    await handler.processTranscript(transcript, Date.now());
    const displayCountAfter = mock.displays.length;
    const extended = statusCount(statuses, "display_extended", "suggestion_echo") > 0;
    const redrawn = statusCount(statuses, "display_refreshed", "suggestion_echo") > 0;
    const flags: string[] = [];
    if (!extended) flags.push("active_display_not_extended");
    if (redrawn) flags.push("active_display_redrew_and_may_flicker");
    if (displayCountAfter !== displayCountBefore) flags.push(`display_count_changed_${displayCountBefore}_to_${displayCountAfter}`);

    return {
      id: "active_echo_no_blink",
      suggestion,
      transcript,
      displayCountBefore,
      displayCountAfter,
      extended,
      redrawn,
      flags,
      pass: flags.length === 0,
    };
  } finally {
    handler.close();
  }
}

function runAmbiguityScan(): InterruptionCaseResult[] {
  const cases = [
    {
      category: "ambiguous_short_ack",
      suggestion: "Yeah, that makes sense.",
      interruption: "Yeah, that makes sense.",
    },
    {
      category: "ambiguous_short_ack",
      suggestion: "Okay, sounds good.",
      interruption: "Okay, sounds good.",
    },
    {
      category: "ambiguous_repeat_then_question",
      suggestion: "Yeah, that makes sense.",
      interruption: "Yeah, that makes sense, but what about the cost?",
    },
  ];

  return cases.map((testCase, index) => {
    const result = detectSuggestionEcho(testCase.interruption, [testCase.suggestion]);
    const expectedAmbiguous = index < 2;
    const flags: string[] = [];
    if (expectedAmbiguous && !result.matched) flags.push("expected_ambiguous_echo_not_detected");
    if (!expectedAmbiguous && result.matched) flags.push("question_after_ack_was_swallowed");
    return {
      id: `${testCase.category}_${index}`,
      category: testCase.category,
      suggestion: testCase.suggestion,
      interruption: testCase.interruption,
      actualEcho: result.matched,
      matchedCandidate: result.candidate,
      flags,
      pass: flags.length === 0,
    };
  });
}

function renderReport(params: {
  echoResults: EchoCaseResult[];
  interruptionResults: InterruptionCaseResult[];
  splitReadResult: SplitReadCaseResult;
  expiryResult: ExpiryCaseResult;
  noBlinkResult: NoBlinkCaseResult;
  ambiguityResults: InterruptionCaseResult[];
}): string {
  const hardFailures = [
    ...params.echoResults.filter((item) => !item.pass),
    ...params.interruptionResults.filter((item) => !item.pass),
    ...(params.splitReadResult.pass ? [] : [params.splitReadResult]),
    ...(params.expiryResult.pass ? [] : [params.expiryResult]),
    ...(params.noBlinkResult.pass ? [] : [params.noBlinkResult]),
    ...params.ambiguityResults.filter((item) => !item.pass),
  ];
  const refreshedEchoes = params.echoResults.filter((item) => item.refreshed).length;
  const slowEchoes = params.echoResults.filter((item) => item.flags.some((flag) => flag.startsWith("slow_echo_path"))).length;
  const lines: string[] = [];

  lines.push("# Output Echo Refresh Runtime Eval");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Echo refresh cases: ${params.echoResults.length}`);
  lines.push(`Echo refresh passed: ${params.echoResults.filter((item) => item.pass).length}`);
  lines.push(`Echo refresh actual refreshed: ${refreshedEchoes}`);
  lines.push(`Interruption cases: ${params.interruptionResults.length}`);
  lines.push(`Interruption passed: ${params.interruptionResults.filter((item) => item.pass).length}`);
  lines.push(`Split-read passed: ${params.splitReadResult.pass}`);
  lines.push(`Expiry boundary passed: ${params.expiryResult.pass}`);
  lines.push(`Active echo no-blink passed: ${params.noBlinkResult.pass}`);
  lines.push(`Ambiguity scan passed: ${params.ambiguityResults.filter((item) => item.pass).length}/${params.ambiguityResults.length}`);
  lines.push(`Slow echo paths: ${slowEchoes}`);
  lines.push(`Hard failures: ${hardFailures.length}`);
  lines.push("");
  lines.push("## Process Expectations");
  lines.push("- If Xiang is reading the displayed AI sentence, classify it as suggestion_echo, do not call the LLM, and refresh the same display for 45 seconds.");
  lines.push("- If another person interrupts with a new question or correction, do not classify it as suggestion_echo. Normal response generation should be allowed to replace the display.");
  lines.push("- If ASR splits Xiang's read into partial fragments, every matching fragment should refresh instead of making the screen disappear.");
  lines.push("- After the 45 second echo window expires without refresh, old text should stop being treated as self-read echo.");
  lines.push("- If the same text is still actively displayed, echo should extend internal state without re-calling showTextWall, to avoid blink/disappear/reappear.");
  lines.push("");

  if (hardFailures.length) {
    lines.push("## Failures");
    for (const item of hardFailures) {
      lines.push("");
      lines.push(`### ${(item as any).id}`);
      lines.push(`Flags: ${(item as any).flags.join(", ")}`);
      if ("transcript" in item) {
        lines.push(`Transcript: ${item.transcript}`);
        lines.push(`Suggestion: ${item.suggestion}`);
      }
      if ("interruption" in item) {
        lines.push(`Interruption: ${item.interruption}`);
        lines.push(`Matched candidate: ${item.matchedCandidate}`);
      }
    }
    lines.push("");
  }

  lines.push("## Known Ambiguity");
  lines.push("If the other person says the exact same very short phrase as the displayed suggestion, audio-only processing cannot reliably know the speaker. The current behavior treats it as echo to avoid self-trigger loops.");
  lines.push("");

  lines.push("## Echo Refresh Cases");
  for (const item of params.echoResults) {
    lines.push("");
    lines.push(`### ${item.pass ? "PASS" : "FAIL"} ${item.id}`);
    lines.push(`Mutation: ${item.mutation}`);
    lines.push(`Expected/actual echo: ${item.expectedEcho} / ${item.actualEcho}`);
    lines.push(`Refreshed: ${item.refreshed}`);
    lines.push(`Elapsed: ${item.elapsedMs}ms`);
    if (item.flags.length) lines.push(`Flags: ${item.flags.join(", ")}`);
    lines.push(`Transcript: ${item.transcript}`);
  }

  lines.push("");
  lines.push("## Interruption Cases");
  for (const item of params.interruptionResults) {
    lines.push("");
    lines.push(`### ${item.pass ? "PASS" : "FAIL"} ${item.id}`);
    lines.push(`Actual echo: ${item.actualEcho}`);
    if (item.flags.length) lines.push(`Flags: ${item.flags.join(", ")}`);
    lines.push(`Interruption: ${item.interruption}`);
  }

  lines.push("");
  lines.push("## Split Read");
  lines.push(`Pass: ${params.splitReadResult.pass}`);
  lines.push(`Refresh count: ${params.splitReadResult.refreshedCount}`);
  lines.push(`Processing done echo count: ${params.splitReadResult.processingDoneEchoCount}`);
  if (params.splitReadResult.flags.length) lines.push(`Flags: ${params.splitReadResult.flags.join(", ")}`);

  lines.push("");
  lines.push("## Expiry Boundary");
  lines.push(`Pass: ${params.expiryResult.pass}`);
  lines.push(`Echo before expiry: ${params.expiryResult.echoBeforeExpiry}`);
  lines.push(`Echo after expiry: ${params.expiryResult.echoAfterExpiry}`);
  if (params.expiryResult.flags.length) lines.push(`Flags: ${params.expiryResult.flags.join(", ")}`);

  lines.push("");
  lines.push("## Active Echo No-Blink");
  lines.push(`Pass: ${params.noBlinkResult.pass}`);
  lines.push(`Display count before/after: ${params.noBlinkResult.displayCountBefore} / ${params.noBlinkResult.displayCountAfter}`);
  lines.push(`Extended: ${params.noBlinkResult.extended}`);
  lines.push(`Redrawn: ${params.noBlinkResult.redrawn}`);
  if (params.noBlinkResult.flags.length) lines.push(`Flags: ${params.noBlinkResult.flags.join(", ")}`);

  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const echoResults: EchoCaseResult[] = [];
  const interruptionResults: InterruptionCaseResult[] = [];

  for (let suggestionIndex = 0; suggestionIndex < suggestions.length; suggestionIndex++) {
    const suggestion = suggestions[suggestionIndex];
    for (const mutation of mutations) {
      echoResults.push(await runEchoCase(suggestion.category, suggestion.text, mutation, suggestionIndex));
    }

    for (let interruptionIndex = 0; interruptionIndex < interruptionCases.length; interruptionIndex++) {
      interruptionResults.push(await runInterruptionCase(
        suggestion.category,
        suggestion.text,
        interruptionCases[interruptionIndex],
        interruptionIndex,
      ));
    }
  }

  const splitReadResult = await runSplitReadCase();
  const expiryResult = await runExpiryCase();
  const noBlinkResult = await runNoBlinkCase();
  const ambiguityResults = runAmbiguityScan();
  const report = renderReport({ echoResults, interruptionResults, splitReadResult, expiryResult, noBlinkResult, ambiguityResults });
  const reportPath = join(outDir, `output-echo-refresh-runtime-${timestamp}.md`);
  const jsonPath = join(outDir, `output-echo-refresh-runtime-${timestamp}.json`);

  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify({
    echoResults,
    interruptionResults,
    splitReadResult,
    expiryResult,
    noBlinkResult,
    ambiguityResults,
  }, null, 2), "utf8");

  const hardFailures = [
    ...echoResults.filter((item) => !item.pass),
    ...interruptionResults.filter((item) => !item.pass),
    ...(splitReadResult.pass ? [] : [splitReadResult]),
    ...(expiryResult.pass ? [] : [expiryResult]),
    ...(noBlinkResult.pass ? [] : [noBlinkResult]),
    ...ambiguityResults.filter((item) => !item.pass),
  ];

  console.log(`OUTPUT_ECHO_REFRESH_RUNTIME_REPORT ${reportPath}`);
  console.log(`echo refresh cases: ${echoResults.length}, failed: ${echoResults.filter((item) => !item.pass).length}`);
  console.log(`interruption cases: ${interruptionResults.length}, failed: ${interruptionResults.filter((item) => !item.pass).length}`);
  console.log(`split read passed: ${splitReadResult.pass}`);
  console.log(`expiry boundary passed: ${expiryResult.pass}`);
  console.log(`active echo no-blink passed: ${noBlinkResult.pass}`);
  console.log(`ambiguity scan failed: ${ambiguityResults.filter((item) => !item.pass).length}`);

  if (hardFailures.length) {
    console.log("FAILURES");
    for (const failure of hardFailures.slice(0, 20)) {
      console.log(`- ${(failure as any).id}: ${(failure as any).flags.join(", ")}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
