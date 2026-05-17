import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AsrEvent = {
  text: string;
  isFinal: boolean;
  delayMs?: number;
  language?: string;
};

type ProcessedUtterance = {
  text: string;
  timestamp: number;
};

type TestCase = {
  id: string;
  note: string;
  events: AsrEvent[];
  waitAfterMs: number;
  expected: string[];
};

type CaseResult = {
  id: string;
  note: string;
  expected: string[];
  actual: string[];
  pass: boolean;
  statuses: string[];
};

const outputDir = join("data", "eval");
const now = new Date().toISOString().replace(/[:.]/g, "-");
const waitScale = Number(process.argv.find((arg) => arg.startsWith("--scale="))?.split("=")[1] || 1);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms * waitScale))));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

const processed: ProcessedUtterance[] = [];
const statusEvents: Array<{ type: string; reason?: string }> = [];
const insightEvents: Array<{ text: string; reasoning: string }> = [];
let transcriptionHandler: ((data: any) => void) | null = null;

const agents = await import("../src/server/mastra/agents");
const originalProcessTranscript = agents.MergeResponseHandler.prototype.processTranscript;
agents.MergeResponseHandler.prototype.processTranscript = async function patchedProcessTranscript(text: string, timestamp: number) {
  processed.push({ text: normalize(text), timestamp });
  this.onStatus?.({ type: "processing_done", reason: "mock_processed" });
};

const { User } = await import("../src/server/session/User");

function makeFakeSession() {
  return {
    logger: {
      info: () => {},
      error: () => {},
    },
    simpleStorage: {
      get: async (key: string) => {
        if (key === "output_language") return "english";
        if (key === "insight_frequency") return "high";
        return null;
      },
      set: async () => {},
    },
    layouts: {
      showTextWall: () => {},
    },
    events: {
      onTranscriptionForLanguage: (_language: string, handler: (data: any) => void) => {
        transcriptionHandler = handler;
        return () => {
          transcriptionHandler = null;
        };
      },
      onDisconnected: () => () => {},
      onPermissionDenied: () => () => {},
      onPermissionError: () => () => {},
    },
  };
}

const user = new User("asr-rhythm-test@example.com");
user.addSSEClient((data) => {
  try {
    const event = JSON.parse(data);
    if (event.type === "processing" || event.type === "processing_done") {
      statusEvents.push({ type: event.type, reason: event.reason });
    }
    if (event.type === "insight") {
      insightEvents.push({ text: event.text, reasoning: event.reasoning });
    }
  } catch {}
});

await user.setAppSession(makeFakeSession() as any);

const cases: TestCase[] = [
  {
    id: "evolving_partials_final_before_timeout",
    note: "final=false keeps changing, final=true arrives before timeout; only final text should process.",
    events: [
      { text: "Wh", isFinal: false },
      { text: "What project", isFinal: false, delayMs: 220 },
      { text: "What project did you", isFinal: false, delayMs: 220 },
      { text: "What project did you build?", isFinal: true, delayMs: 220 },
    ],
    waitAfterMs: 450,
    expected: ["What project did you build?"],
  },
  {
    id: "late_final_same_after_timeout",
    note: "final=true arrives after timeout with same text; timeout result should not duplicate.",
    events: [
      { text: "Can you explain Lambda cold start?", isFinal: false },
      { text: "Can you explain Lambda cold start?", isFinal: true, delayMs: 2050 },
    ],
    waitAfterMs: 450,
    expected: ["Can you explain Lambda cold start?"],
  },
  {
    id: "late_final_minor_correction_after_timeout",
    note: "final=true arrives after timeout with tiny ASR correction; should not duplicate.",
    events: [
      { text: "Can you explain lambda cold start", isFinal: false },
      { text: "Can you explain Lambda cold starts?", isFinal: true, delayMs: 2050 },
    ],
    waitAfterMs: 450,
    expected: ["Can you explain lambda cold start"],
  },
  {
    id: "late_final_material_extension_after_timeout",
    note: "final=true has significant new information; processing again is acceptable.",
    events: [
      { text: "Can you explain Lambda cold start", isFinal: false },
      { text: "Can you explain Lambda cold start and DynamoDB partition key tradeoff?", isFinal: true, delayMs: 2050 },
    ],
    waitAfterMs: 450,
    expected: [
      "Can you explain Lambda cold start",
      "Can you explain Lambda cold start and DynamoDB partition key tradeoff?",
    ],
  },
  {
    id: "half_sentence_pause_timeout",
    note: "user says half a sentence and pauses; latest partial should process by timeout.",
    events: [
      { text: "Tell me about my AWS cloud project", isFinal: false },
    ],
    waitAfterMs: 2050,
    expected: ["Tell me about my AWS cloud project"],
  },
  {
    id: "interruption_overwrites_unfinalized_user_partial",
    note: "another speaker interrupts before timeout; latest transcript should be the one processed.",
    events: [
      { text: "I think the main reason is", isFinal: false },
      { text: "Actually can I ask a quick question about the cost?", isFinal: true, delayMs: 420 },
    ],
    waitAfterMs: 450,
    expected: ["Actually can I ask a quick question about the cost?"],
  },
  {
    id: "rapid_short_final_sentences",
    note: "several short final utterances within 3 seconds should all process.",
    events: [
      { text: "What's your name?", isFinal: true },
      { text: "Where are you from?", isFinal: true, delayMs: 650 },
      { text: "What school do you go to?", isFinal: true, delayMs: 650 },
    ],
    waitAfterMs: 450,
    expected: ["What's your name?", "Where are you from?", "What school do you go to?"],
  },
  {
    id: "same_partial_repeated_until_timeout",
    note: "same ASR partial repeats; timeout should process once.",
    events: [
      { text: "What school?", isFinal: false },
      { text: "What school?", isFinal: false, delayMs: 240 },
      { text: "What school?", isFinal: false, delayMs: 240 },
      { text: "What school?", isFinal: false, delayMs: 240 },
    ],
    waitAfterMs: 2050,
    expected: ["What school?"],
  },
  {
    id: "low_value_fragments_skipped",
    note: "low-value fragments should not create processing work.",
    events: [
      { text: "And.", isFinal: true },
      { text: "uh", isFinal: true, delayMs: 200 },
      { text: "okay", isFinal: true, delayMs: 200 },
    ],
    waitAfterMs: 450,
    expected: [],
  },
  {
    id: "mixed_language_revision",
    note: "mixed Chinese-English ASR revision should keep only the final corrected question.",
    events: [
      { text: "那个 cloud", isFinal: false },
      { text: "那个 cloud architecture", isFinal: false, delayMs: 260 },
      { text: "那个 cloud architecture why?", isFinal: true, delayMs: 260 },
    ],
    waitAfterMs: 450,
    expected: ["那个 cloud architecture why?"],
  },
];

const results: CaseResult[] = [];

for (const test of cases) {
  processed.length = 0;
  statusEvents.length = 0;
  user.resetCurrentSession();
  await sleep(80);

  if (!transcriptionHandler) throw new Error("Transcription handler was not registered.");
  for (const event of test.events) {
    if (event.delayMs) await sleep(event.delayMs);
    transcriptionHandler({
      text: event.text,
      isFinal: event.isFinal,
      transcribeLanguage: event.language || "auto",
    });
  }
  await sleep(test.waitAfterMs);

  const actual = processed.map((item) => item.text);
  results.push({
    id: test.id,
    note: test.note,
    expected: test.expected,
    actual,
    pass: sameList(actual, test.expected),
    statuses: statusEvents.map((event) => `${event.type}:${event.reason || ""}`),
  });
}

agents.MergeResponseHandler.prototype.processTranscript = originalProcessTranscript;
user.cleanup();

const flags = results
  .filter((result) => !result.pass)
  .map((result) => ({
    area: "asr_rhythm",
    severity: "critical" as const,
    message: `${result.id} processed unexpected utterances.`,
    sample: {
      expected: result.expected,
      actual: result.actual,
      note: result.note,
    },
  }));

mkdirSync(outputDir, { recursive: true });
const jsonPath = join(outputDir, `asr-rhythm-${now}.json`);
const mdPath = join(outputDir, `asr-rhythm-${now}.md`);
writeFileSync(jsonPath, JSON.stringify({ results, flags }, null, 2));
writeFileSync(mdPath, [
  "# ASR Rhythm Eval",
  "",
  `Cases: ${results.length}`,
  `Passed: ${results.filter((result) => result.pass).length}`,
  `Failed: ${flags.length}`,
  "",
  "## Results",
  "",
  results.map((result) => [
    `### ${result.pass ? "PASS" : "FAIL"} ${result.id}`,
    "",
    result.note,
    "",
    `Expected: \`${result.expected.join(" | ")}\``,
    `Actual: \`${result.actual.join(" | ")}\``,
  ].join("\n")).join("\n\n"),
  "",
  "## Flags",
  "",
  flags.length ? flags.map((flag, index) => [
    `### ${index + 1}. ${flag.area} / ${flag.severity}`,
    "",
    flag.message,
    "",
    "```json",
    JSON.stringify(flag.sample, null, 2),
    "```",
  ].join("\n")).join("\n\n") : "No flags.",
  "",
  `JSON report: \`${jsonPath}\``,
].join("\n"));

console.log(`ASR rhythm report: ${mdPath}`);
console.log(`Passed=${results.filter((result) => result.pass).length}/${results.length}`);
if (flags.length > 0) {
  process.exitCode = 1;
}
