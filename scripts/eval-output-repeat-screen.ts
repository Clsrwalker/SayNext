import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectSuggestionEcho } from "../src/server/mastra/agents/response-handler";
import {
  makeTelepromptOpeningLine,
  TelepromptRuntime,
  type TelepromptTranscriptResult,
} from "../src/server/teleprompt/teleprompt-runtime";

type RuntimeAction = "advance" | "rewind" | "finish" | "cancel" | "hold_consumed" | "hold_open";
type DisplayExpectation = "same" | "changed" | "active" | "inactive" | "done" | "open";

type RuntimeStep = {
  input: string;
  expectedAction: RuntimeAction;
  expectedDisplay: DisplayExpectation;
  note: string;
};

type RuntimeCase = {
  id: string;
  group: string;
  setup: () => TelepromptRuntime;
  steps: RuntimeStep[];
};

type RuntimeStepResult = RuntimeStep & {
  actualAction: RuntimeAction;
  actualDisplay: DisplayExpectation;
  pass: boolean;
  beforeDisplay: string | null;
  afterDisplay: string | null;
  reason?: string;
};

type RuntimeCaseResult = {
  id: string;
  group: string;
  steps: RuntimeStepResult[];
  pass: boolean;
};

type EchoCase = {
  id: string;
  group: string;
  suggestion: string;
  transcript: string;
  expectedMatched: boolean;
  note: string;
};

type EchoCaseResult = EchoCase & {
  actualMatched: boolean;
  similarity: number;
  transcriptCoverage: number;
  suggestionCoverage: number;
  candidate: string;
  pass: boolean;
};

const now = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join("data", "eval");

const script = [
  "SayNext is a mobile app I have been building to help with real-time conversation support.",
  "It listens to live transcripts, keeps a short context window, and suggests a natural next response.",
  "The difficult part is handling messy speech, repeated reads, interruptions, and context drift.",
  "So I test the process carefully instead of only checking whether the final sentence looks correct.",
].join(" ");

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function actionOf(result: TelepromptTranscriptResult): RuntimeAction {
  if (result.action === "advance") return "advance";
  if (result.action === "rewind") return "rewind";
  if (result.action === "finish") return "finish";
  if (result.action === "cancel") return "cancel";
  return result.consumed ? "hold_consumed" : "hold_open";
}

function currentLine(runtime: TelepromptRuntime): string {
  const display = runtime.getDisplay();
  if (!display) return "";
  return display.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\d+\s*\/\s*\d+$/.test(line) && !/^next:?$/i.test(line) && !/^done\./i.test(line))[0] || "";
}

function displayText(runtime: TelepromptRuntime): string | null {
  return runtime.getDisplay()?.text ?? null;
}

function displayExpectation(runtime: TelepromptRuntime, before: string | null, after: string | null): DisplayExpectation {
  if (!runtime.isActive()) {
    return after && /^Done\. SayNext is listening\.?$/i.test(compact(after)) ? "done" : "inactive";
  }
  if (!before && after) return "active";
  if (before === after) return "same";
  return "changed";
}

function makeReadyRuntime(): TelepromptRuntime {
  const runtime = new TelepromptRuntime();
  runtime.startPending("Can you walk me through your SayNext project?", makeTelepromptOpeningLine("Can you walk me through your SayNext project?"));
  runtime.setScript(script);
  return runtime;
}

function makePendingRuntime(): TelepromptRuntime {
  const runtime = new TelepromptRuntime();
  runtime.startPending("Can you explain this in detail?", makeTelepromptOpeningLine("Can you explain this in detail?"));
  return runtime;
}

function makeOneChunkRuntime(): TelepromptRuntime {
  const runtime = new TelepromptRuntime();
  runtime.startPending("Tell me one long answer.", makeTelepromptOpeningLine("Tell me one long answer."));
  runtime.setScript("This is the only teleprompt sentence, so reading it completely should finish the mode.");
  return runtime;
}

function withFiller(text: string): string {
  return `uh, I mean, like, ${text}, you know, basically`;
}

function partial(text: string, ratio = 0.48): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, Math.max(5, Math.floor(words.length * ratio))).join(" ");
}

function misread(text: string): string {
  return text
    .replace(/\bmobile\b/gi, "moble")
    .replace(/\btranscripts\b/gi, "transcrips")
    .replace(/\bconversation\b/gi, "conservation")
    .replace(/\bcontext\b/gi, "con text")
    .replace(/\brepeated\b/gi, "repeat")
    .replace(/\binterruptions\b/gi, "interruption")
    .replace(/\s+/g, " ")
    .trim();
}

function runInput(runtime: TelepromptRuntime, input: string): TelepromptTranscriptResult {
  if (input === "__CURRENT__") return runtime.handleTranscript(currentLine(runtime));
  if (input === "__CURRENT_PARTIAL__") return runtime.handleTranscript(partial(currentLine(runtime)));
  if (input === "__CURRENT_FILLER__") return runtime.handleTranscript(withFiller(currentLine(runtime)));
  if (input === "__CURRENT_MISREAD__") return runtime.handleTranscript(misread(currentLine(runtime)));
  if (input === "__MANUAL_BACK__") return runtime.rewindManual();
  if (input === "__MANUAL_NEXT__") return runtime.advanceManual();
  if (input === "__MANUAL_CANCEL__") return runtime.cancelManual();
  if (input === "__IDLE_TIMEOUT__") return runtime.handleTranscript("still here", Date.now() + 4 * 60 * 1000);
  return runtime.handleTranscript(input);
}

function runRuntimeCase(testCase: RuntimeCase): RuntimeCaseResult {
  const runtime = testCase.setup();
  const steps: RuntimeStepResult[] = [];

  for (const step of testCase.steps) {
    const before = displayText(runtime);
    const result = runInput(runtime, step.input);
    const after = result.action === "advance" || result.action === "rewind" || result.action === "finish"
      ? result.display.text
      : displayText(runtime);
    const actualAction = actionOf(result);
    const actualDisplay = displayExpectation(runtime, before, after);
    steps.push({
      ...step,
      actualAction,
      actualDisplay,
      beforeDisplay: before,
      afterDisplay: after,
      reason: result.action === "cancel" ? result.reason : undefined,
      pass: actualAction === step.expectedAction && actualDisplay === step.expectedDisplay,
    });
  }

  return {
    id: testCase.id,
    group: testCase.group,
    steps,
    pass: steps.every((step) => step.pass),
  };
}

const runtimeCases: RuntimeCase[] = [
  {
    id: "pending-opening-exact-stays",
    group: "pending output reread",
    setup: makePendingRuntime,
    steps: [
      { input: "__CURRENT__", expectedAction: "hold_consumed", expectedDisplay: "same", note: "reading opening line while script is generating should stay on screen" },
      { input: "__CURRENT_FILLER__", expectedAction: "hold_consumed", expectedDisplay: "same", note: "filler-heavy opening reread should not cancel pending teleprompt" },
    ],
  },
  {
    id: "pending-real-interruption-cancels",
    group: "pending output reread",
    setup: makePendingRuntime,
    steps: [
      { input: "Actually I want to ask something different about cost", expectedAction: "cancel", expectedDisplay: "inactive", note: "real new speech while preparing should cancel and let normal flow handle it" },
    ],
  },
  {
    id: "partial-current-stays",
    group: "active current reread",
    setup: makeReadyRuntime,
    steps: [
      { input: "__CURRENT_PARTIAL__", expectedAction: "hold_consumed", expectedDisplay: "same", note: "partial reread should keep the same sentence on screen" },
      { input: "__CURRENT_PARTIAL__", expectedAction: "hold_consumed", expectedDisplay: "same", note: "repeated partial reread should still stay, not get stuck or exit" },
      { input: "__CURRENT_FILLER__", expectedAction: "advance", expectedDisplay: "changed", note: "complete current sentence with filler should advance" },
    ],
  },
  {
    id: "full-current-advances-by-design",
    group: "active current reread",
    setup: makeReadyRuntime,
    steps: [
      { input: "__CURRENT__", expectedAction: "advance", expectedDisplay: "changed", note: "complete current sentence advances to the next chunk by design" },
    ],
  },
  {
    id: "previous-sentence-reread-does-not-exit",
    group: "previous output reread after auto advance",
    setup: makeReadyRuntime,
    steps: [
      { input: "__CURRENT__", expectedAction: "advance", expectedDisplay: "changed", note: "first complete read advances" },
      {
        input: "SayNext is a mobile app I have been building to help with real-time conversation support.",
        expectedAction: "hold_consumed",
        expectedDisplay: "same",
        note: "accidentally rereading previous chunk should be swallowed and keep current screen",
      },
      {
        input: "uh like SayNext is a moble app I have been building to help with real time conservation support",
        expectedAction: "hold_consumed",
        expectedDisplay: "same",
        note: "noisy/misread previous chunk should also be swallowed without cancelling",
      },
    ],
  },
  {
    id: "current-misread-still-tracks",
    group: "active current reread",
    setup: makeReadyRuntime,
    steps: [
      { input: "__CURRENT_MISREAD__", expectedAction: "advance", expectedDisplay: "changed", note: "minor wrong words in current chunk should still advance" },
    ],
  },
  {
    id: "partial-then-other-question-cancels",
    group: "interruption while rereading",
    setup: makeReadyRuntime,
    steps: [
      { input: "__CURRENT_PARTIAL__", expectedAction: "hold_consumed", expectedDisplay: "same", note: "partial self-read is held first" },
      { input: "Wait, what happens if the transcript is wrong?", expectedAction: "cancel", expectedDisplay: "inactive", note: "other person's question should cancel teleprompt and be processed normally" },
    ],
  },
  {
    id: "long-unrelated-speech-cancels",
    group: "interruption while rereading",
    setup: makeReadyRuntime,
    steps: [
      {
        input: "The backend schema changed this morning and the blocker is actually authentication, so we should not keep talking about the previous answer.",
        expectedAction: "cancel",
        expectedDisplay: "inactive",
        note: "long unrelated speech should exit teleprompt instead of trapping the user",
      },
    ],
  },
  {
    id: "manual-controls-recover",
    group: "manual recovery",
    setup: makeReadyRuntime,
    steps: [
      { input: "__CURRENT__", expectedAction: "advance", expectedDisplay: "changed", note: "auto advance happens" },
      { input: "__MANUAL_BACK__", expectedAction: "rewind", expectedDisplay: "changed", note: "manual back can return to previous sentence if advance was too early" },
      { input: "__MANUAL_CANCEL__", expectedAction: "cancel", expectedDisplay: "inactive", note: "manual cancel always exits teleprompt" },
    ],
  },
  {
    id: "finish-does-not-stay-active",
    group: "finish behavior",
    setup: makeOneChunkRuntime,
    steps: [
      { input: "__CURRENT__", expectedAction: "finish", expectedDisplay: "done", note: "reading the final chunk finishes and returns to listening" },
      { input: "What was the main point again?", expectedAction: "hold_open", expectedDisplay: "inactive", note: "after finish, teleprompt stays inactive so new speech is open for normal AI" },
    ],
  },
  {
    id: "idle-timeout-exits",
    group: "stuck prevention",
    setup: makeReadyRuntime,
    steps: [
      { input: "__IDLE_TIMEOUT__", expectedAction: "cancel", expectedDisplay: "inactive", note: "idle timeout prevents a permanently stuck teleprompt" },
    ],
  },
];

const echoSuggestion = "I built SayNext as a mobile real-time conversation assistant. It listens to transcripts, retrieves relevant memory, and gives short replies that I can say naturally.";
const shortSuggestion = "Yeah, that makes sense.";

const echoCases: EchoCase[] = [
  {
    id: "short-exact",
    group: "short suggestion echo",
    suggestion: shortSuggestion,
    transcript: "Yeah, that makes sense.",
    expectedMatched: true,
    note: "exact short self-read should be ignored and the displayed sentence should refresh",
  },
  {
    id: "short-filler",
    group: "short suggestion echo",
    suggestion: shortSuggestion,
    transcript: "uh yeah that makes sense",
    expectedMatched: true,
    note: "short self-read with filler should still be echo",
  },
  {
    id: "long-exact",
    group: "long suggestion echo",
    suggestion: echoSuggestion,
    transcript: echoSuggestion,
    expectedMatched: true,
    note: "exact long suggestion read aloud should be ignored outside teleprompt",
  },
  {
    id: "long-partial-own-thought",
    group: "long suggestion echo",
    suggestion: echoSuggestion,
    transcript: "I built SayNext as a mobile real-time conversation assistant and honestly that is the main example I would use.",
    expectedMatched: true,
    note: "partial reread plus Xiang's own continuation should still be treated as self-read echo",
  },
  {
    id: "long-misread",
    group: "long suggestion echo",
    suggestion: echoSuggestion,
    transcript: "I built say next as a moble real time conservation assistance it listen to transcrips and give short replies",
    expectedMatched: true,
    note: "ASR/misread version should still be echo",
  },
  {
    id: "then-followup-question",
    group: "other speaker interruption",
    suggestion: echoSuggestion,
    transcript: "I built SayNext as a mobile real-time conversation assistant, but how did you test it?",
    expectedMatched: false,
    note: "quote/partial repeat plus real question should not be swallowed",
  },
  {
    id: "negative-similar-topic",
    group: "other speaker interruption",
    suggestion: echoSuggestion,
    transcript: "That sounds useful, but how do you prevent it from giving awkward replies?",
    expectedMatched: false,
    note: "similar topic from other person should not be treated as self-read",
  },
];

function runEchoCase(testCase: EchoCase): EchoCaseResult {
  const result = detectSuggestionEcho(testCase.transcript, [testCase.suggestion]);
  return {
    ...testCase,
    actualMatched: result.matched,
    similarity: result.similarity,
    transcriptCoverage: result.transcriptCoverage,
    suggestionCoverage: result.suggestionCoverage,
    candidate: result.candidate,
    pass: result.matched === testCase.expectedMatched,
  };
}

function renderReport(runtimeResults: RuntimeCaseResult[], echoResults: EchoCaseResult[]): string {
  const failedRuntime = runtimeResults.filter((result) => !result.pass);
  const failedEcho = echoResults.filter((result) => !result.pass);
  const lines: string[] = [];

  lines.push("# Output Repeat Screen Eval");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Runtime cases: ${runtimeResults.length}`);
  lines.push(`Runtime failed: ${failedRuntime.length}`);
  lines.push(`Echo cases: ${echoResults.length}`);
  lines.push(`Echo failed: ${failedEcho.length}`);
  lines.push("");
  lines.push("## Expected Behavior Summary");
  lines.push("- Short normal suggestions: self-read echoes are ignored and the existing sentence is refreshed so it does not disappear mid-read.");
  lines.push("- Teleprompt pending: reading the opening line is consumed and the same text stays on screen.");
  lines.push("- Teleprompt active partial read: consumed and the same sentence stays on screen.");
  lines.push("- Teleprompt active complete current chunk: advances to the next chunk by design.");
  lines.push("- Teleprompt previous chunk reread after auto-advance: consumed and current screen stays, preventing accidental exit.");
  lines.push("- Other speaker interruption or new question: cancels teleprompt so normal AI can respond.");
  lines.push("- Finish, manual cancel, and idle timeout all exit teleprompt so it cannot stay stuck forever.");
  lines.push("");

  if (failedRuntime.length || failedEcho.length) {
    lines.push("## Failures");
    for (const result of failedRuntime) {
      lines.push("");
      lines.push(`### Runtime ${result.id}`);
      lines.push(`Group: ${result.group}`);
      for (const step of result.steps.filter((item) => !item.pass)) {
        lines.push(`- ${step.note}`);
        lines.push(`  - Expected action/display: ${step.expectedAction} / ${step.expectedDisplay}`);
        lines.push(`  - Actual action/display: ${step.actualAction} / ${step.actualDisplay}`);
        if (step.reason) lines.push(`  - Reason: ${step.reason}`);
        lines.push(`  - Before: ${compact(step.beforeDisplay || "")}`);
        lines.push(`  - After: ${compact(step.afterDisplay || "")}`);
      }
    }
    for (const result of failedEcho) {
      lines.push("");
      lines.push(`### Echo ${result.id}`);
      lines.push(`Group: ${result.group}`);
      lines.push(`- ${result.note}`);
      lines.push(`  - Expected/actual matched: ${result.expectedMatched} / ${result.actualMatched}`);
      lines.push(`  - Transcript: ${result.transcript}`);
      lines.push(`  - Similarity: ${result.similarity.toFixed(2)}, transcriptCoverage: ${result.transcriptCoverage.toFixed(2)}, suggestionCoverage: ${result.suggestionCoverage.toFixed(2)}`);
    }
    lines.push("");
  }

  lines.push("## Runtime Cases");
  for (const result of runtimeResults) {
    lines.push("");
    lines.push(`### ${result.pass ? "PASS" : "FAIL"} ${result.id}`);
    lines.push(`Group: ${result.group}`);
    for (const step of result.steps) {
      lines.push(`- ${step.pass ? "PASS" : "FAIL"} ${step.note}`);
      lines.push(`  - Expected/actual action: ${step.expectedAction} / ${step.actualAction}`);
      lines.push(`  - Expected/actual display: ${step.expectedDisplay} / ${step.actualDisplay}`);
      if (step.reason) lines.push(`  - Reason: ${step.reason}`);
    }
  }

  lines.push("");
  lines.push("## Echo Cases");
  for (const result of echoResults) {
    lines.push("");
    lines.push(`### ${result.pass ? "PASS" : "FAIL"} ${result.id}`);
    lines.push(`Group: ${result.group}`);
    lines.push(`Note: ${result.note}`);
    lines.push(`Expected/actual matched: ${result.expectedMatched} / ${result.actualMatched}`);
    lines.push(`Similarity: ${result.similarity.toFixed(2)}, transcriptCoverage: ${result.transcriptCoverage.toFixed(2)}, suggestionCoverage: ${result.suggestionCoverage.toFixed(2)}`);
  }

  return lines.join("\n");
}

mkdirSync(outputDir, { recursive: true });

const runtimeResults = runtimeCases.map(runRuntimeCase);
const echoResults = echoCases.map(runEchoCase);
const report = renderReport(runtimeResults, echoResults);
const mdPath = join(outputDir, `output-repeat-screen-${now}.md`);
const jsonPath = join(outputDir, `output-repeat-screen-${now}.json`);

writeFileSync(mdPath, report, "utf8");
writeFileSync(jsonPath, JSON.stringify({ runtimeResults, echoResults }, null, 2), "utf8");

const failedRuntime = runtimeResults.filter((result) => !result.pass);
const failedEcho = echoResults.filter((result) => !result.pass);

console.log("Output repeat screen eval complete.");
console.log(`Runtime cases: ${runtimeResults.length}, failed: ${failedRuntime.length}`);
console.log(`Echo cases: ${echoResults.length}, failed: ${failedEcho.length}`);
console.log(`Report: ${mdPath}`);

if (failedRuntime.length || failedEcho.length) {
  for (const result of failedRuntime.slice(0, 8)) {
    console.log(`FAIL runtime ${result.id}`);
    for (const step of result.steps.filter((item) => !item.pass)) {
      console.log(`  ${step.note}: expected ${step.expectedAction}/${step.expectedDisplay}, actual ${step.actualAction}/${step.actualDisplay}`);
      if (step.reason) console.log(`  reason=${step.reason}`);
    }
  }
  for (const result of failedEcho.slice(0, 8)) {
    console.log(`FAIL echo ${result.id}: expected ${result.expectedMatched}, actual ${result.actualMatched}`);
  }
  process.exitCode = 1;
}
