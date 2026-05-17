import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyScene, EventMemoryManager } from "../src/server/memory/event-memory";
import { conversationLogger, type PersonalMemorySearchResult } from "../src/server/data/conversation-logger";
import { TelepromptRuntime, type TelepromptTranscriptResult } from "../src/server/teleprompt/teleprompt-runtime";

type Flag = {
  area: string;
  severity: "warning" | "critical";
  message: string;
  sample?: unknown;
};

type ProbeResult = {
  ok: boolean;
  provider: string;
  durationMs: number;
  outputLength?: number;
  responseType?: string;
  error?: string;
  raw?: string;
};

const userId = process.argv[2] || "li2897283405@gmail.com";
const durationMinutes = Number(process.argv[3] || 120);
const transcriptPath = process.argv[4] || "docs/transcript3.md";
const seedArg = process.argv.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length);
const eventArg = process.argv.find((arg) => arg.startsWith("--events="))?.slice("--events=".length);
const seed = seedArg || `longrun-${new Date().toISOString()}`;
const eventTarget = Number(eventArg || Math.max(240, durationMinutes * 6));
const outputDir = join("data", "eval");
const now = new Date().toISOString().replace(/[:.]/g, "-");

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (const ch of text) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seedText: string): () => number {
  let state = hashSeed(seedText) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function loadSegments(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const parts = raw
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?。！？])\s+|\n{2,}/)
    .map(normalizeText)
    .filter((text) => {
      const words = text.split(/\s+/).filter(Boolean).length;
      return text.length >= 18 && words >= 4 && words <= 70;
    });

  return parts.length ? parts : [
    "Good morning, how is your day going so far?",
    "Can you explain your project in a little more detail?",
    "The professor is explaining serverless cold starts and Lambda concurrency.",
    "We need to decide what to do next for the group project.",
  ];
}

const syntheticSegments = [
  "Good morning, how's your day going so far?",
  "What did you do on the weekend?",
  "Can you tell me more about the small project you made?",
  "What project did you use for AWS cloud architecture?",
  "Where did you study during high school in China?",
  "What game have you played recently?",
  "Can you explain Lambda cold start in a simple way?",
  "The teacher is talking about database indexes and slow query performance.",
  "A: We need the API schema before we can finish the front end. B: Could we mock it for now?",
  "Could you describe a room where you like to study for one or two minutes?",
  "Tell me about a time you had a hard bug in your project.",
  "what project you did for next",
  "lambda cold start not my",
  "那个 cloud architecture why",
  "uh yeah like I mean the project thing, can you explain longer",
  "Thank you, now let's move to another question about teamwork.",
];

function makeTranscriptStream(rng: () => number, count: number, transcriptSegments: string[]): string[] {
  const stream: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 37 === 0) {
      stream.push(pick(syntheticSegments, rng));
      continue;
    }
    if (i % 53 === 0) {
      stream.push(`${pick(syntheticSegments, rng)} ${pick(transcriptSegments, rng)}`);
      continue;
    }
    stream.push(rng() < 0.35 ? pick(syntheticSegments, rng) : pick(transcriptSegments, rng));
  }
  return stream;
}

function isPrivateMemory(memory: PersonalMemorySearchResult): boolean {
  const sourceRef = memory.sourceRef.toLowerCase();
  return sourceRef.startsWith("xiang-") || sourceRef.startsWith("doc:");
}

function isGenericTechnicalQuery(text: string): boolean {
  return /\b(lambda|cold start|serverless|database index|slow query|network partition|cap theorem|container|docker|kubernetes|vpc|subnet|iam|jwt|hash map|supervised learning|backpropagation)\b/i.test(text)
    && !/\b(my|your|xiang|project|experience|made|built|saynext|elderalbum|dalpark|joblens)\b/i.test(text);
}

function isExplicitDailyText(text: string): boolean {
  return /\b(weekend|free time|anime|food|holiday|mountain|good morning|day going|what game|played any games|played recently|after class|staying home|hang out|chilling|takeout|room|bedroom|where you live|favorite website|favourite website|watch tv|music|shopping|clothes|sleep schedule)\b/i.test(text);
}

function isStrongSceneShift(previous: string, current: string, previousText: string, currentText: string): boolean {
  if (!previous || !current || previous === current) return false;
  if (previous === "daily_chat" && !isExplicitDailyText(previousText)) return false;
  if (current === "daily_chat" && !isExplicitDailyText(currentText)) return false;
  const pair = `${previous}->${current}`;
  return new Set([
    "daily_chat->classroom",
    "daily_chat->interview",
    "daily_chat->group_discussion",
    "daily_chat->work_discussion",
    "classroom->daily_chat",
    "interview->daily_chat",
    "interview->classroom",
    "group_discussion->daily_chat",
    "work_discussion->daily_chat",
  ]).has(pair);
}

function normalizeAction(result: TelepromptTranscriptResult): string {
  if (result.action === "hold") return result.consumed ? "hold_consumed" : "hold_open";
  return result.action;
}

async function runProbe(env: Record<string, string>): Promise<ProbeResult> {
  const proc = Bun.spawn(["bun", "scripts/probe-model-timeout.ts", userId], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const startedAt = Date.now();
  const timeoutMs = 12_000;
  const timedOut = new Promise<"timeout">((resolve) => {
    setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve("timeout");
    }, timeoutMs);
  });
  const done = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const result = await Promise.race([done, timedOut]);
  if (result === "timeout") {
    return {
      ok: false,
      provider: env.LLM_PROVIDER || "unknown",
      durationMs: Date.now() - startedAt,
      error: `probe did not exit within ${timeoutMs}ms`,
    };
  }
  const [stdout, stderr, exitCode] = result;
  const lastJson = stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
  if (!lastJson) {
    return {
      ok: false,
      provider: env.LLM_PROVIDER || "unknown",
      durationMs: 0,
      error: `probe exited ${exitCode}; no JSON output`,
      raw: `${stdout}\n${stderr}`.trim().slice(0, 1000),
    };
  }
  try {
    const parsed = JSON.parse(lastJson) as ProbeResult;
    return { ...parsed, raw: stderr.trim().slice(0, 1000) };
  } catch (error) {
    return {
      ok: false,
      provider: env.LLM_PROVIDER || "unknown",
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
      raw: `${stdout}\n${stderr}`.trim().slice(0, 1000),
    };
  }
}

const rng = makeRng(seed);
const flags: Flag[] = [];
const transcriptSegments = loadSegments(transcriptPath);
const stream = makeTranscriptStream(rng, eventTarget, transcriptSegments);

const eventMemory = new EventMemoryManager(userId, `long-run-stability-${hashSeed(seed)}`, false);
const baseTimestamp = Date.UTC(2026, 4, 17, 12, 0, 0);
let simulatedTimestamp = baseTimestamp;
let previousEventId = "";
let previousExpectedScene = "";
let previousGapWasIdle = false;
let idleGapChecks = 0;
let idleGapFailures = 0;
let eventSwitches = 0;
let strongSceneShiftChecks = 0;
let strongSceneShiftMerged = 0;
let maxTranscriptCount = 0;
let maxRecentTranscripts = 0;
let memorySearches = 0;
let genericTechSearches = 0;
let privateLeaks = 0;
const privateLeakSamples: unknown[] = [];
const sceneCounts = new Map<string, number>();

for (let i = 0; i < stream.length; i += 1) {
  const idleGap = i > 0 && i % 90 === 0;
  if (idleGap) {
    simulatedTimestamp += 9 * 60 * 1000;
    previousGapWasIdle = true;
    idleGapChecks += 1;
  } else {
    simulatedTimestamp += Math.floor(8_000 + rng() * 45_000);
  }

  const text = stream[i];
  const expectedScene = classifyScene(text);
  const snapshot = eventMemory.addTranscript(text, simulatedTimestamp);
  sceneCounts.set(snapshot.scene, (sceneCounts.get(snapshot.scene) || 0) + 1);

  const eventChanged = Boolean(previousEventId && snapshot.eventId !== previousEventId);
  if (eventChanged) {
    eventSwitches += 1;
  }

  if (!previousGapWasIdle && previousExpectedScene && isStrongSceneShift(previousExpectedScene, expectedScene, stream[i - 1] || "", text)) {
    strongSceneShiftChecks += 1;
    if (!eventChanged) {
      strongSceneShiftMerged += 1;
      flags.push({
        area: "event",
        severity: "warning",
        message: "Strong scene shift stayed in the same event, so old context may pollute the new turn.",
        sample: {
          index: i,
          previousScene: previousExpectedScene,
          currentScene: expectedScene,
          previous: stream[i - 1],
          current: text,
          eventId: snapshot.eventId,
        },
      });
    }
  }

  if (previousGapWasIdle && previousEventId && snapshot.eventId === previousEventId) {
    idleGapFailures += 1;
    flags.push({
      area: "event",
      severity: "critical",
      message: "Idle gap longer than 8 minutes did not start a new event.",
      sample: { index: i, text, eventId: snapshot.eventId },
    });
  }

  previousGapWasIdle = false;
  previousEventId = snapshot.eventId;
  previousExpectedScene = expectedScene;
  maxTranscriptCount = Math.max(maxTranscriptCount, snapshot.transcriptCount);
  maxRecentTranscripts = Math.max(maxRecentTranscripts, snapshot.recentTranscripts.length);

  if (snapshot.transcriptCount > 24) {
    flags.push({
      area: "event",
      severity: "critical",
      message: "Active event transcript count exceeded the intended cap.",
      sample: { index: i, count: snapshot.transcriptCount, eventId: snapshot.eventId },
    });
  }
  if (snapshot.recentTranscripts.length > 6) {
    flags.push({
      area: "event",
      severity: "critical",
      message: "Recent transcript window exceeded the intended cap.",
      sample: { index: i, count: snapshot.recentTranscripts.length, eventId: snapshot.eventId },
    });
  }

  const memoryQuery = snapshot.recentTranscripts.slice(-4).join("\n") || text;
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, memoryQuery, 3);
  memorySearches += 1;
  if (isGenericTechnicalQuery(memoryQuery)) {
    genericTechSearches += 1;
    const leaked = results.filter(isPrivateMemory);
    if (leaked.length) {
      privateLeaks += leaked.length;
      if (privateLeakSamples.length < 10) {
        privateLeakSamples.push({
          index: i,
          query: memoryQuery,
          refs: leaked.map((item) => item.sourceRef),
        });
      }
    }
  }
}

if (privateLeaks > 0) {
  flags.push({
    area: "memory",
    severity: "warning",
    message: "Generic technical queries retrieved private/project memories.",
    sample: privateLeakSamples,
  });
}

const llmProbeResults = await Promise.all([
  runProbe({
    LLM_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:9",
    OLLAMA_TIMEOUT_MS: "250",
  }),
  runProbe({
    LLM_PROVIDER: "openai",
    OPENAI_TIMEOUT_MS: "1",
    MODEL_TIMEOUT_MS: "1",
  }),
]);

for (const probe of llmProbeResults) {
  if (!probe.ok || (probe.durationMs || 0) > 10_000 || !probe.outputLength) {
    flags.push({
      area: "llm",
      severity: "critical",
      message: `${probe.provider} failure/timeout probe did not recover with a fallback response quickly.`,
      sample: probe,
    });
  }
}

const { User } = await import("../src/server/session/User");
const sseUser = new User(`${userId}.stability`);
const broadcast = (event: unknown) => (sseUser as any).broadcastInsightEvent(event);

for (let i = 0; i < 150; i += 1) {
  broadcast({ type: "insight", id: `queued-${i}`, text: `queued ${i}`, timestamp: new Date().toISOString() });
}

const queuedBeforeClient = (sseUser as any).eventQueue?.length ?? -1;
const received: string[] = [];
(sseUser as any).addSSEClient((data: string) => received.push(data));
const queuedAfterClient = (sseUser as any).eventQueue?.length ?? -1;
broadcast({ type: "insight", id: "live-one", text: "live one", timestamp: new Date().toISOString() });
const receivedAfterLive = received.length;
(sseUser as any).addSSEClient(() => { throw new Error("intentional dead SSE client"); });
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (String(args[0] ?? "").includes("[User] Failed to send SSE event")) return;
  originalConsoleError(...args);
};
broadcast({ type: "insight", id: "live-two", text: "live two", timestamp: new Date().toISOString() });
console.error = originalConsoleError;
const sseClientCountAfterThrow = (sseUser as any).sseClients?.size ?? -1;
sseUser.cleanup();

const sseResult = {
  queuedBeforeClient,
  queuedAfterClient,
  receivedAfterFlush: received.length,
  receivedAfterLive,
  sseClientCountAfterThrow,
};

if (queuedBeforeClient !== 100 || queuedAfterClient !== 0 || receivedAfterLive < 101 || sseClientCountAfterThrow !== 1) {
  flags.push({
    area: "sse",
    severity: "critical",
    message: "SSE queue cap, flush, live send, or dead-client cleanup failed.",
    sample: sseResult,
  });
}

function runTelepromptChecks() {
  const script = [
    "SayNext is a mobile app that helps with real-time conversation support.",
    "It listens to transcripts, keeps a short context window, and suggests a natural response.",
    "The hard part is handling messy speech, interruptions, and long sessions without getting stuck.",
  ].join(" ");

  const checks: Record<string, unknown> = {};

  const pendingIdle = new TelepromptRuntime();
  pendingIdle.startPending("Describe your project for one minute.", "Yeah, I can talk about SayNext.", baseTimestamp);
  checks.pendingIdle = normalizeAction(pendingIdle.handleTranscript("still waiting", baseTimestamp + 181_000));

  const pendingInterruption = new TelepromptRuntime();
  pendingInterruption.startPending("Describe your project for one minute.", "Yeah, I can talk about SayNext.", baseTimestamp);
  const pendingInterruptionResult = pendingInterruption.handleTranscript("Actually can I ask another question about the cost instead?", baseTimestamp + 5_000);
  checks.pendingInterruption = normalizeAction(pendingInterruptionResult);
  checks.pendingInterruptionReason = pendingInterruptionResult.action === "cancel" ? pendingInterruptionResult.reason : "";

  const manual = new TelepromptRuntime();
  manual.startPending("Describe your project for one minute.", "Yeah, I can talk about SayNext.", baseTimestamp);
  manual.setScript(script, baseTimestamp);
  checks.manualAdvance = normalizeAction(manual.advanceManual(baseTimestamp + 1_000));
  checks.manualRewind = normalizeAction(manual.rewindManual(baseTimestamp + 2_000));
  checks.manualCancel = normalizeAction(manual.cancelManual());

  const readyIdle = new TelepromptRuntime();
  readyIdle.startPending("Describe your project for one minute.", "Yeah, I can talk about SayNext.", baseTimestamp);
  readyIdle.setScript(script, baseTimestamp);
  checks.readyIdle = normalizeAction(readyIdle.handleTranscript("hello", baseTimestamp + 181_000));

  const reading = new TelepromptRuntime();
  reading.startPending("Describe your project for one minute.", "Yeah, I can talk about SayNext.", baseTimestamp);
  reading.setScript(script, baseTimestamp);
  checks.readingAdvance = normalizeAction(reading.handleTranscript(
    "SayNext is a mobile app that helps with real-time conversation support.",
    baseTimestamp + 2_000,
  ));
  checks.readingCancel = normalizeAction(reading.handleTranscript(
    "Wait, before you continue, can you explain the price and deployment instead?",
    baseTimestamp + 3_000,
  ));

  return checks;
}

const telepromptResult = runTelepromptChecks();
const expectedTeleprompt = {
  pendingIdle: "cancel",
  pendingInterruption: "cancel",
  manualAdvance: "advance",
  manualRewind: "rewind",
  manualCancel: "cancel",
  readyIdle: "cancel",
  readingAdvance: "advance",
  readingCancel: "cancel",
};

for (const [key, expected] of Object.entries(expectedTeleprompt)) {
  if ((telepromptResult as Record<string, unknown>)[key] !== expected) {
    flags.push({
      area: "teleprompt",
      severity: "critical",
      message: `Teleprompt ${key} expected ${expected}.`,
      sample: telepromptResult,
    });
    break;
  }
}

const report = {
  userId,
  seed,
  transcriptPath,
  simulatedDurationMinutes: durationMinutes,
  processedTranscripts: stream.length,
  sourceSegments: transcriptSegments.length,
  event: {
    eventSwitches,
    idleGapChecks,
    idleGapFailures,
    maxTranscriptCount,
    maxRecentTranscripts,
    strongSceneShiftChecks,
    strongSceneShiftMerged,
    sceneCounts: Object.fromEntries(sceneCounts),
  },
  memory: {
    memorySearches,
    genericTechSearches,
    privateLeaks,
    privateLeakSamples,
  },
  sse: sseResult,
  teleprompt: telepromptResult,
  llm: llmProbeResults,
  flags,
};

mkdirSync(outputDir, { recursive: true });
const jsonPath = join(outputDir, `long-run-stability-${now}.json`);
const mdPath = join(outputDir, `long-run-stability-${now}.md`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const criticalCount = flags.filter((flag) => flag.severity === "critical").length;
const warningCount = flags.filter((flag) => flag.severity === "warning").length;
writeFileSync(mdPath, [
  `# Long Run Stability Eval`,
  ``,
  `Seed: \`${seed}\``,
  `User: \`${userId}\``,
  `Transcript source: \`${transcriptPath}\``,
  `Simulated duration: ${durationMinutes} minutes`,
  `Processed transcripts: ${stream.length}`,
  ``,
  `## Summary`,
  ``,
  `- Critical: ${criticalCount}`,
  `- Warnings: ${warningCount}`,
  `- Event switches: ${eventSwitches}`,
  `- Idle gap checks: ${idleGapChecks}, failures: ${idleGapFailures}`,
  `- Strong scene shift checks: ${strongSceneShiftChecks}, merged: ${strongSceneShiftMerged}`,
  `- Max active event transcripts: ${maxTranscriptCount}`,
  `- Max recent transcripts: ${maxRecentTranscripts}`,
  `- Memory searches: ${memorySearches}`,
  `- Generic tech searches: ${genericTechSearches}`,
  `- Private/project leaks on generic tech: ${privateLeaks}`,
  `- SSE queued before client: ${queuedBeforeClient}`,
  `- SSE queued after client: ${queuedAfterClient}`,
  `- Teleprompt: ${JSON.stringify(telepromptResult)}`,
  `- LLM probes: ${JSON.stringify(llmProbeResults)}`,
  ``,
  `## Flags`,
  ``,
  flags.length ? flags.map((flag, index) => [
    `### ${index + 1}. ${flag.area} / ${flag.severity}`,
    ``,
    flag.message,
    ``,
    "```json",
    JSON.stringify(flag.sample ?? null, null, 2),
    "```",
  ].join("\n")).join("\n\n") : "No flags.",
  ``,
  `JSON report: \`${jsonPath}\``,
].join("\n"));

console.log(`Long-run stability report: ${mdPath}`);
console.log(`Critical=${criticalCount} Warning=${warningCount}`);

if (criticalCount > 0) {
  process.exitCode = 1;
}
