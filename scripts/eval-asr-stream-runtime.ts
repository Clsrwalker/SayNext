import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSession } from "@mentra/sdk";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { LocationManager } from "../src/server/manager/LocationManager";
import { MergeResponseHandler } from "../src/server/mastra/agents/response-handler";
import { buildLosslessRuntimeContext, processPrenote } from "../src/server/prenotes/prenote-processor";

type SceneName = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";
type Verdict = "good" | "watch" | "bad";

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

type ProcessedUtterance = {
  atMs: number;
  text: string;
  reason: "isFinal" | "timeout";
  skipped?: "low_value" | "exact_duplicate" | "late_final_duplicate";
};

type RuntimeEvent =
  | {
      type: "asr";
      text: string;
      final?: boolean;
      delayMs?: number;
    }
  | {
      type: "wait";
      delayMs: number;
    }
  | {
      type: "waitForDisplay";
      timeoutMs?: number;
    }
  | {
      type: "manual";
      action: "advance" | "rewind" | "cancel" | "reset";
      delayMs?: number;
    }
  | {
      type: "echoLast";
      final?: boolean;
      delayMs?: number;
      mutate?: "same" | "fillers" | "partial" | "wrong_words" | "stutter" | "reordered";
    };

type Scenario = {
  id: string;
  scene: SceneName;
  category: string;
  description: string;
  events: RuntimeEvent[];
  expectAny?: string[];
  expectProcessedAny?: string[];
  expectStatusReason?: string[];
  rejectAny?: string[];
  rejectStatusReason?: string[];
  requireProcessedMax?: number;
  requireNoDisplay?: boolean;
  maxScenarioMs?: number;
  knownRisk?: string;
};

type ScenarioResult = {
  id: string;
  scene: SceneName;
  category: string;
  description: string;
  elapsedMs: number;
  processed: ProcessedUtterance[];
  displays: DisplayEvent[];
  statuses: StatusEvent[];
  insights: InsightEvent[];
  flags: string[];
  verdict: Verdict;
  knownRisk?: string;
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");
const userId = process.argv.find((arg) => arg.includes("@")) || `eval-asr-stream-${Date.now()}`;
const testTimeoutMs = Number(process.env.ASR_EVAL_TIMEOUT_MS || "350");

const LOW_VALUE_UTTERANCE_PATTERN = /^(and|so|then|but|or|uh|um|erm|hmm|mm|ah|oh|okay|ok|right|yeah|yes|no|锟斤拷锟斤拷锟斤拷锟斤拷锟叫讹拷锟斤拷[\s.,!?。！？]*)$/i;

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
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function isLowValueUtterance(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return LOW_VALUE_UTTERANCE_PATTERN.test(normalized);
}

function normalizeForDuplicate(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mutateEcho(text: string, mode: RuntimeEvent extends { type: "echoLast"; mutate?: infer T } ? T : never): string {
  const cleaned = compact(text);
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/);
  if (mode === "partial") {
    return words.slice(0, Math.max(4, Math.floor(words.length * 0.52))).join(" ");
  }
  if (mode === "fillers") {
    return `uh yeah like ${cleaned.replace(/\b(and|because|so|then|but)\b/gi, "$1, like,")}`;
  }
  if (mode === "wrong_words") {
    return cleaned
      .replace(/\bdeadline\b/gi, "dead lion")
      .replace(/\bprivacy\b/gi, "private sea")
      .replace(/\brollback\b/gi, "roll back")
      .replace(/\bdeployment\b/gi, "the ploy mint")
      .replace(/\bproject\b/gi, "pro jack");
  }
  if (mode === "stutter") {
    return words.map((word, index) => index % 5 === 0 ? `${word} ${word}` : word).join(" ");
  }
  if (mode === "reordered") {
    const first = words.slice(0, Math.ceil(words.length / 2));
    const second = words.slice(Math.ceil(words.length / 2));
    return `${second.join(" ")} ${first.join(" ")}`;
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

class AsrStreamHarness {
  public processed: ProcessedUtterance[] = [];
  private currentUtteranceBuffer = "";
  private utteranceTimer: NodeJS.Timeout | null = null;
  private lastProcessedUtterance = "";
  private lastProcessedAt = 0;
  private lastProcessedReason: "isFinal" | "timeout" | null = null;
  private pending: Promise<void>[] = [];

  constructor(
    private readonly handler: MergeResponseHandler,
    private readonly startMs: number,
    private readonly timeoutMs: number,
    private readonly getLastDisplayText: () => string,
    private readonly getDisplayCount: () => number,
  ) {}

  async run(events: RuntimeEvent[]): Promise<void> {
    for (const event of events) {
      if (event.delayMs) await sleep(event.delayMs);
      if (event.type === "wait") {
        await sleep(event.delayMs);
        continue;
      }
      if (event.type === "waitForDisplay") {
        const before = this.getDisplayCount();
        const deadline = performance.now() + (event.timeoutMs || 6000);
        while (performance.now() < deadline && this.getDisplayCount() <= before) {
          await sleep(40);
        }
        continue;
      }
      if (event.type === "manual") {
        if (event.action === "advance") this.handler.advanceTelepromptManually();
        if (event.action === "rewind") this.handler.rewindTelepromptManually();
        if (event.action === "cancel") this.handler.cancelTelepromptManually();
        if (event.action === "reset") this.handler.resetRuntimeState();
        continue;
      }
      if (event.type === "echoLast") {
        this.handleTranscription({
          text: mutateEcho(this.getLastDisplayText(), event.mutate || "same"),
          isFinal: event.final !== false,
        });
        continue;
      }
      this.handleTranscription({ text: event.text, isFinal: event.final === true });
    }
  }

  async settle(): Promise<void> {
    await sleep(this.timeoutMs + 30);
    if (this.pending.length) {
      await Promise.allSettled(this.pending.splice(0));
    }
    await sleep(30);
  }

  reset(): void {
    if (this.utteranceTimer) clearTimeout(this.utteranceTimer);
    this.utteranceTimer = null;
    this.currentUtteranceBuffer = "";
    this.lastProcessedUtterance = "";
    this.lastProcessedAt = 0;
    this.lastProcessedReason = null;
    this.processed = [];
    this.pending = [];
  }

  private handleTranscription(data: { text: string; isFinal: boolean }): void {
    const text = data.text.trim();
    if (!text) return;

    this.currentUtteranceBuffer = text;

    if (data.isFinal) {
      this.processBufferAndReset("isFinal");
      return;
    }

    this.handler.handlePartialTranscript(text, Date.now());

    if (this.utteranceTimer) clearTimeout(this.utteranceTimer);
    this.utteranceTimer = setTimeout(() => this.processBufferAndReset("timeout"), this.timeoutMs);
  }

  private isLateFinalCorrectionDuplicate(text: string, reason: "isFinal" | "timeout"): boolean {
    if (reason !== "isFinal") return false;
    if (this.lastProcessedReason !== "timeout") return false;
    if (Date.now() - this.lastProcessedAt > 3000) return false;

    const current = normalizeForDuplicate(text);
    const previous = normalizeForDuplicate(this.lastProcessedUtterance);
    if (!current || !previous) return false;
    if (current === previous) return true;

    const shorter = current.length < previous.length ? current : previous;
    const longer = current.length < previous.length ? previous : current;
    const lengthRatio = shorter.length / Math.max(longer.length, 1);
    return longer.startsWith(shorter) && lengthRatio >= 0.72;
  }

  private processBufferAndReset(reason: "isFinal" | "timeout"): void {
    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer);
      this.utteranceTimer = null;
    }

    const textToProcess = this.currentUtteranceBuffer.trim();
    if (!textToProcess) return;

    const processedBase = {
      atMs: nowMs(this.startMs),
      text: textToProcess,
      reason,
    };

    if (isLowValueUtterance(textToProcess)) {
      this.processed.push({ ...processedBase, skipped: "low_value" });
      this.currentUtteranceBuffer = "";
      return;
    }
    const shouldForwardLateFinalToTeleprompt =
      reason === "isFinal" &&
      this.lastProcessedReason === "timeout" &&
      this.handler.isTelepromptActive();

    if (textToProcess === this.lastProcessedUtterance && !shouldForwardLateFinalToTeleprompt) {
      this.processed.push({ ...processedBase, skipped: "exact_duplicate" });
      this.currentUtteranceBuffer = "";
      return;
    }
    if (this.isLateFinalCorrectionDuplicate(textToProcess, reason) && !shouldForwardLateFinalToTeleprompt) {
      this.processed.push({ ...processedBase, skipped: "late_final_duplicate" });
      this.currentUtteranceBuffer = "";
      return;
    }

    this.lastProcessedUtterance = textToProcess;
    this.lastProcessedAt = Date.now();
    this.lastProcessedReason = reason;
    this.processed.push(processedBase);

    const promise = this.handler.processTranscript(textToProcess, Date.now(), reason).catch(() => undefined);
    this.pending.push(promise);
    this.currentUtteranceBuffer = "";
  }
}

async function createEvalPrenote(): Promise<number> {
  const title = `ASR Stream Eval Prenote ${timestamp}`;
  const sourceText = [
    "# Logistics",
    "ASR_EVAL_FINAL_REPORT_DEADLINE: The final report is due June 12 at 11:59 PM.",
    "ASR_EVAL_REHEARSAL_ROOM: The rehearsal is in Goldberg Computer Science Building room 134.",
    "ASR_EVAL_WEDDING_NOTE: If asked to say a few words at a wedding, keep it warm, simple, and avoid jokes about money or private family conflict.",
    "",
    "# Service And Transaction Facts",
    "ASR_EVAL_RETURN_POLICY: For a clothing return question, ask whether the item can be returned with the receipt and whether there is a final sale exception.",
    "ASR_EVAL_CAR_SERVICE: For a Honda Civic service appointment, mention the concern clearly, ask for an estimate, and confirm pickup time.",
    "",
    "# Project Demo",
    "ASR_EVAL_DEMO_RUBRIC: The demo should mention rollback owner, smoke-test command, privacy risk mitigation, and exact API contract.",
    "ASR_EVAL_API_FIELDS: Stable fields are userId, sessionId, transcriptText, activePrenoteIds, and responseMode.",
    "",
    Array.from({ length: 70 }, (_, index) => `Noise row ${index}: unrelated chat, shopping, classroom, family, ceremony, and meeting filler.`).join("\n"),
  ].join("\n");

  const processed = await processPrenote({
    title,
    description: "ASR stream realistic runtime prenote",
    sourceText,
    files: [],
  });
  const prenote = conversationLogger.createPrenote({
    userId,
    title,
    sourceText,
    contentHash: processed.contentHash,
  });
  if (!prenote) throw new Error("Failed to create eval prenote");

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

function setScene(scene: SceneName): void {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === scene);
  if (profile) conversationLogger.setActiveSceneProfile(userId, profile.id);
}

function makeEventsFromFinal(text: string, options: { chunkWords?: number; correction?: string[]; finalDelayMs?: number } = {}): RuntimeEvent[] {
  const words = text.split(/\s+/);
  const chunkWords = options.chunkWords || 3;
  const events: RuntimeEvent[] = [];
  for (let i = chunkWords; i < words.length; i += chunkWords) {
    events.push({ type: "asr", text: words.slice(0, i).join(" "), final: false, delayMs: 25 });
  }
  for (const correction of options.correction || []) {
    events.push({ type: "asr", text: correction, final: false, delayMs: 35 });
  }
  events.push({ type: "asr", text, final: true, delayMs: options.finalDelayMs ?? 35 });
  return events;
}

function makeTimeoutThenFinal(partial: string, final: string): RuntimeEvent[] {
  return [
    { type: "asr", text: partial, final: false },
    { type: "wait", delayMs: testTimeoutMs + 80 },
    { type: "asr", text: final, final: true, delayMs: 60 },
  ];
}

function makeScenarios(): Scenario[] {
  return [
    {
      id: "asr_001_partial_final_daily",
      scene: "Daily Chat",
      category: "ASR incremental",
      description: "A normal daily question arrives word by word and should process only the final utterance.",
      events: makeEventsFromFinal("What are you up to later today?", { chunkWords: 2 }),
      expectAny: ["probably", "maybe", "just", "later", "chill", "today"],
      rejectAny: ["rollback", "DynamoDB", "final report"],
      requireProcessedMax: 1,
      maxScenarioMs: 2200,
    },
    {
      id: "asr_002_timeout_late_final_duplicate",
      scene: "Classroom",
      category: "ASR timeout",
      description: "No final arrives, timeout processes the question, then the same final arrives late.",
      events: makeTimeoutThenFinal("where is the rehearsal room", "Where is the rehearsal room?"),
      expectAny: ["Goldberg", "134"],
      rejectAny: ["not sure", "maybe"],
      requireProcessedMax: 2,
      maxScenarioMs: 2600,
      knownRisk: "Late final has different casing/punctuation; duplicate suppression should skip it.",
    },
    {
      id: "asr_003_timeout_then_refined_final",
      scene: "Classroom",
      category: "ASR timeout",
      description: "Timeout fires on an incomplete phrase; final later contains the full intended question.",
      events: makeTimeoutThenFinal("what school you", "What school did you study at before Canada?"),
      expectAny: ["Aubrey", "China", "Shishi", "Peking", "high school"],
      requireProcessedMax: 2,
      maxScenarioMs: 3000,
      knownRisk: "Current timeout can create one premature answer before the refined final.",
    },
    {
      id: "asr_004_correction_middle_words",
      scene: "Classroom",
      category: "ASR correction",
      description: "ASR revises the middle of the sentence before final.",
      events: [
        { type: "asr", text: "what project you did for next", final: false },
        { type: "asr", text: "what project did you make for SayNext", final: false, delayMs: 80 },
        { type: "asr", text: "What project did you make for SayNext?", final: true, delayMs: 80 },
      ],
      expectAny: ["Hybrid Search Memory Assistant", "real-time", "transcript", "memory", "conversation"],
      rejectAny: ["no idea"],
      requireProcessedMax: 1,
      maxScenarioMs: 2400,
    },
    {
      id: "echo_001_readback_fillers_then_new_question",
      scene: "Daily Chat",
      category: "self-read echo",
      description: "Xiang reads the displayed suggestion with many fillers, then the other person asks a fresh question.",
      events: [
        ...makeEventsFromFinal("Good morning, how's your day going so far?", { chunkWords: 3 }),
        { type: "waitForDisplay", timeoutMs: 8000 },
        { type: "echoLast", mutate: "partial", final: false, delayMs: 80 },
        { type: "echoLast", mutate: "fillers", final: true, delayMs: 120 },
        ...makeEventsFromFinal("Nice, are you just taking it easy today?", { chunkWords: 3, finalDelayMs: 90 }),
      ],
      expectAny: ["yeah", "probably", "taking it easy", "mostly", "chill"],
      expectStatusReason: ["suggestion_echo"],
      rejectAny: ["rollback", "deadline", "DynamoDB"],
      maxScenarioMs: 3600,
    },
    {
      id: "echo_002_readback_wrong_words",
      scene: "Classroom",
      category: "self-read echo",
      description: "Xiang repeats the previous output with ASR word errors; it should not generate a new answer from his own words.",
      events: [
        ...makeEventsFromFinal("What should I mention in the project demo rubric?", { chunkWords: 3 }),
        { type: "waitForDisplay", timeoutMs: 8000 },
        { type: "echoLast", mutate: "wrong_words", final: true, delayMs: 120 },
      ],
      expectAny: ["rollback", "smoke", "privacy", "API"],
      expectStatusReason: ["suggestion_echo"],
      requireProcessedMax: 2,
      maxScenarioMs: 3200,
      knownRisk: "Echo suppression must tolerate ASR substitutions without swallowing real follow-up questions.",
    },
    {
      id: "echo_003_readback_reordered",
      scene: "Daily Chat",
      category: "self-read echo",
      description: "Xiang says the second half before the first half while reading. This should usually be treated as self-read, not a new user question.",
      events: [
        ...makeEventsFromFinal("What are you doing this weekend?", { chunkWords: 3 }),
        { type: "waitForDisplay", timeoutMs: 8000 },
        { type: "echoLast", mutate: "reordered", final: true, delayMs: 120 },
      ],
      expectStatusReason: ["suggestion_echo"],
      requireProcessedMax: 2,
      maxScenarioMs: 3200,
      knownRisk: "Echo suppression may fail if the same words are read out of order.",
    },
    {
      id: "echo_004_readback_half_then_interruption",
      scene: "Interview",
      category: "self-read interrupted",
      description: "Xiang starts reading a long answer, but the interviewer interrupts with a new direct question.",
      events: [
        ...makeEventsFromFinal("Can you explain your SayNext project in detail?", { chunkWords: 3 }),
        { type: "waitForDisplay", timeoutMs: 8000 },
        { type: "echoLast", mutate: "partial", final: false, delayMs: 80 },
        ...makeEventsFromFinal("Sorry quick question, what was the hardest bug you fixed?", { chunkWords: 3, finalDelayMs: 80 }),
      ],
      expectAny: ["bug", "fixed", "issue", "problem", "debug"],
      rejectAny: ["June 12", "wedding"],
      maxScenarioMs: 4200,
    },
    {
      id: "shopping_001_return_policy",
      scene: "Daily Chat",
      category: "shopping",
      description: "Clothing return question in a store with partial ASR and noise.",
      events: makeEventsFromFinal("If this hoodie doesn't fit can I return it with the receipt or is it final sale?", { chunkWords: 4 }),
      expectAny: ["receipt", "return", "final sale", "ask"],
      rejectAny: ["project", "lambda", "school"],
      maxScenarioMs: 2200,
    },
    {
      id: "shopping_002_price_after_tax",
      scene: "Daily Chat",
      category: "shopping",
      description: "Simple store price question should not turn into a long essay.",
      events: makeEventsFromFinal("So it's thirty nine ninety nine before tax, roughly how much after tax?", { chunkWords: 4 }),
      expectAny: ["around", "about", "tax", "forty", "45", "46"],
      rejectAny: ["as an AI", "project", "DynamoDB"],
      maxScenarioMs: 2200,
    },
    {
      id: "transaction_001_cashier_tap_insert",
      scene: "Daily Chat",
      category: "transaction",
      description: "Cashier asks for tap or insert; response should be minimal and natural.",
      events: makeEventsFromFinal("The total is forty two eighty, do you want to tap or insert?", { chunkWords: 4 }),
      expectAny: ["tap", "I'll tap", "I can tap", "sure"],
      rejectAny: ["because", "project", "deadline"],
      maxScenarioMs: 2200,
    },
    {
      id: "transaction_002_deposit_terms",
      scene: "Daily Chat",
      category: "transaction",
      description: "A used-item purchase deposit sounds risky; answer should ask for written terms, not overcommit.",
      events: makeEventsFromFinal("Can you send a deposit now and pick it up next week, it's non refundable okay?", { chunkWords: 4 }),
      expectAny: ["confirm", "written", "receipt", "details", "hold"],
      rejectAny: ["sure no problem", "send it now"],
      maxScenarioMs: 2400,
      knownRisk: "High-stakes transaction needs caution without sounding robotic.",
    },
    {
      id: "ceremony_001_wedding_words",
      scene: "Daily Chat",
      category: "important ceremony",
      description: "Someone asks Xiang to say a few words at a wedding.",
      events: makeEventsFromFinal("Could you say a few words for everyone before the toast?", { chunkWords: 4 }),
      expectAny: ["congratulations", "happy", "wish", "thank", "cheers", "friends", "family", "together"],
      rejectAny: ["lowkey", "cooked", "project", "DynamoDB", "money"],
      maxScenarioMs: 2600,
      knownRisk: "Daily scene slang should be suppressed for formal ceremony context.",
    },
    {
      id: "ceremony_002_graduation_intro",
      scene: "Daily Chat",
      category: "important ceremony",
      description: "A formal school event asks for a short self-introduction.",
      events: makeEventsFromFinal("Can you introduce yourself quickly before the graduation photo?", { chunkWords: 4 }),
      expectAny: ["I'm Xiang", "thanks", "happy", "nice"],
      rejectAny: ["meme", "DynamoDB", "fatty liver"],
      maxScenarioMs: 2600,
    },
    {
      id: "family_001_money_property_meeting",
      scene: "Meeting / Group Discussion",
      category: "family meeting",
      description: "Family discussion about property/rent should be careful and not invent private facts.",
      events: makeEventsFromFinal("So for the family property rent, what do you think we should do next?", { chunkWords: 4 }),
      expectAny: ["clear", "numbers", "options", "decide", "compare", "lease", "rental", "financial", "review", "preferences"],
      rejectAny: ["sell everything", "definitely", "father died", "factory"],
      maxScenarioMs: 2600,
    },
    {
      id: "family_002_conflict_deescalation",
      scene: "Daily Chat",
      category: "family meeting",
      description: "Family conflict and emotional tone; answer should de-escalate.",
      events: makeEventsFromFinal("My mom is upset because I didn't reply, what should I say right now?", { chunkWords: 4 }),
      expectAny: ["sorry", "reply", "busy", "later", "call"],
      rejectAny: ["it's her fault", "ignore her"],
      maxScenarioMs: 2400,
    },
    {
      id: "service_001_car_appointment",
      scene: "Daily Chat",
      category: "service appointment",
      description: "Honda service counter asks for the problem and pickup timing.",
      events: makeEventsFromFinal("For your Honda Civic appointment, what issue should we write down and when do you need it back?", { chunkWords: 5 }),
      expectAny: ["Civic", "estimate", "pickup", "issue", "check"],
      rejectAny: ["DynamoDB", "course", "wedding"],
      maxScenarioMs: 2400,
    },
    {
      id: "medical_001_pharmacy_side_effect",
      scene: "Daily Chat",
      category: "high-stakes advice",
      description: "Pharmacy/medical question should avoid overconfident medical advice.",
      events: makeEventsFromFinal("This medicine might affect liver right, should I still take it tonight?", { chunkWords: 4 }),
      expectAny: ["pharmacist", "doctor", "check", "safe", "not sure"],
      rejectAny: ["definitely take it", "definitely stop"],
      maxScenarioMs: 2600,
      knownRisk: "High-stakes medical content needs cautious phrasing in a tiny display.",
    },
    {
      id: "legal_001_contract_signature",
      scene: "Daily Chat",
      category: "high-stakes advice",
      description: "Contract signing pressure; answer should ask for time to review.",
      events: makeEventsFromFinal("Can you just sign the lease addendum now, it's standard and everyone signs it?", { chunkWords: 5 }),
      expectAny: ["review", "read", "send", "time", "before I sign"],
      rejectAny: ["sure I'll sign"],
      maxScenarioMs: 2600,
    },
    {
      id: "restaurant_001_allergy_ingredient",
      scene: "Daily Chat",
      category: "restaurant",
      description: "Restaurant allergy/ingredient check, with casual ASR.",
      events: makeEventsFromFinal("Does this have peanuts or sesame, because I'm trying to avoid that?", { chunkWords: 4 }),
      expectAny: ["check", "kitchen", "peanuts", "sesame", "avoid"],
      rejectAny: ["probably fine", "project"],
      maxScenarioMs: 2200,
    },
    {
      id: "meeting_001_pronoun_ambiguous",
      scene: "Meeting / Group Discussion",
      category: "meeting ambiguity",
      description: "Ambiguous 'it' in meeting should ask for clarification or anchor to recent topic.",
      events: makeEventsFromFinal("I don't think it works with the current flow, what do you think?", { chunkWords: 4 }),
      expectAny: ["which part", "current flow", "clarify", "if it's"],
      rejectAny: ["definitely", "obviously"],
      maxScenarioMs: 2600,
    },
    {
      id: "meeting_002_people_talking_over",
      scene: "Meeting / Group Discussion",
      category: "overlap",
      description: "Two people talk over each other; model should not roleplay both speakers.",
      events: makeEventsFromFinal("A says the API is fine but B says wait the privacy issue is still open", { chunkWords: 4 }),
      expectAny: ["privacy", "API", "separate", "clarify", "let's"],
      rejectAny: ["A:", "B:"],
      maxScenarioMs: 2600,
    },
    {
      id: "classroom_001_teacher_explains_no_question",
      scene: "Classroom",
      category: "classroom listening",
      description: "Teacher explains content without asking Xiang. The output should be a useful note/question, not fake an answer as if asked personally.",
      events: makeEventsFromFinal("So the key idea with indexes is that writes become more expensive but reads can become much faster", { chunkWords: 5 }),
      expectAny: ["trade-off", "writes", "reads", "index", "question"],
      rejectAny: ["I think my answer is"],
      maxScenarioMs: 2600,
    },
    {
      id: "classroom_002_student_bad_grammar",
      scene: "Classroom",
      category: "learner grammar",
      description: "Student asks in broken English; output should answer intent rather than correct grammar.",
      events: makeEventsFromFinal("lambda cold start not my why it happen when function sleep long time", { chunkWords: 4 }),
      expectAny: ["cold start", "container", "idle", "latency"],
      rejectAny: ["your grammar", "project"],
      maxScenarioMs: 2600,
    },
    {
      id: "slang_001_daily_confusing",
      scene: "Daily Chat",
      category: "slang",
      description: "Daily slang/unclear phrase should be natural, not formal.",
      events: makeEventsFromFinal("ngl that midterm cooked me, I'm so dead right now", { chunkWords: 4 }),
      expectAny: ["same", "rough", "cooked", "recover", "sleep", "brutal", "hit hard", "wiped", "chill"],
      rejectAny: ["I understand that the examination", "DynamoDB"],
      maxScenarioMs: 2400,
    },
    {
      id: "bilingual_001_chinese_english_mix",
      scene: "Classroom",
      category: "bilingual ASR",
      description: "Chinese-English mixed transcript asking a logistics question.",
      events: [
        { type: "asr", text: "那个 final report deadline", final: false },
        { type: "asr", text: "那个 final report deadline 是哪天来着", final: true, delayMs: 90 },
      ],
      expectAny: ["June 12", "11:59"],
      rejectAny: ["not sure"],
      maxScenarioMs: 2600,
    },
    {
      id: "noise_001_background_music",
      scene: "Daily Chat",
      category: "noise",
      description: "ASR includes background lyrics/noise before a real question.",
      events: [
        { type: "asr", text: "music playing baby baby yeah", final: false },
        { type: "asr", text: "music playing baby baby yeah what time should we head out", final: true, delayMs: 90 },
      ],
      expectAny: ["maybe", "around", "head out", "time"],
      rejectAny: ["baby baby"],
      maxScenarioMs: 2600,
    },
    {
      id: "no_final_001_user_finished",
      scene: "Daily Chat",
      category: "ASR no final",
      description: "User finishes speaking but ASR never sends final. Timeout should process and then recover for the next speaker.",
      events: [
        { type: "asr", text: "what are you doing after class", final: false },
        { type: "wait", delayMs: testTimeoutMs + 100 },
        ...makeEventsFromFinal("Cool, do you want to grab food later?", { chunkWords: 4, finalDelayMs: 80 }),
      ],
      expectAny: ["food", "later", "sure", "maybe", "grab"],
      requireProcessedMax: 2,
      maxScenarioMs: 3600,
      knownRisk: "Timeout must not leave the buffer stuck and block the next turn.",
    },
    {
      id: "formal_001_interview_small_talk_switch",
      scene: "Interview",
      category: "scene switch pressure",
      description: "Interview starts with casual small talk then switches into a serious behavioral question.",
      events: [
        ...makeEventsFromFinal("How's your morning going?", { chunkWords: 3 }),
        ...makeEventsFromFinal("Okay let's start, tell me about a time you had conflict with a teammate.", { chunkWords: 5, finalDelayMs: 80 }),
      ],
      expectAny: ["teammate", "conflict", "I", "project"],
      rejectAny: ["chill", "meme", "cooked"],
      maxScenarioMs: 3800,
    },
    {
      id: "public_001_other_person_intro",
      scene: "Daily Chat",
      category: "other speaker",
      description: "Other speaker introduces themselves; SayNext should respond, not store as Xiang identity.",
      events: makeEventsFromFinal("Hi I'm Daniel, I work at the front desk.", { chunkWords: 4 }),
      expectAny: ["Nice to meet you", "Daniel", "Hi Daniel"],
      rejectAny: ["I'm Xiang and I work at the front desk"],
      maxScenarioMs: 2200,
    },
  ];
}

function judgeScenario(scenario: Scenario, base: Omit<ScenarioResult, "flags" | "verdict">): { flags: string[]; verdict: Verdict } {
  const flags: string[] = [];
  const displayText = base.displays.map((item) => item.text).join("\n");
  const statusReasons = base.statuses.map((item) => String(item.event.reason || item.event.type));
  const processedTexts = base.processed.filter((item) => !item.skipped).map((item) => item.text).join("\n");

  if (scenario.expectAny?.length && !includesAny(displayText, scenario.expectAny)) {
    flags.push(`missing_display_expected:${scenario.expectAny.join("|")}`);
  }
  if (scenario.expectProcessedAny?.length && !includesAny(processedTexts, scenario.expectProcessedAny)) {
    flags.push(`missing_processed_expected:${scenario.expectProcessedAny.join("|")}`);
  }
  if (scenario.rejectAny?.length && includesAny(displayText, scenario.rejectAny)) {
    flags.push(`contains_rejected:${scenario.rejectAny.join("|")}`);
  }
  for (const expected of scenario.expectStatusReason || []) {
    if (!statusReasons.includes(expected)) flags.push(`missing_status:${expected}`);
  }
  for (const rejected of scenario.rejectStatusReason || []) {
    if (statusReasons.includes(rejected)) flags.push(`contains_status:${rejected}`);
  }
  if (typeof scenario.requireProcessedMax === "number") {
    const realProcessed = base.processed.filter((item) => !item.skipped).length;
    if (realProcessed > scenario.requireProcessedMax) {
      flags.push(`too_many_processed:${realProcessed}>${scenario.requireProcessedMax}`);
    }
  }
  if (scenario.requireNoDisplay && base.displays.length > 0) {
    flags.push("unexpected_display");
  }
  if (!scenario.requireNoDisplay && base.displays.length === 0 && !statusReasons.includes("suggestion_echo") && !statusReasons.some((item) => item.startsWith("teleprompt_"))) {
    flags.push("no_display");
  }
  if (scenario.maxScenarioMs && base.elapsedMs > scenario.maxScenarioMs) {
    flags.push(`slow:${base.elapsedMs}>${scenario.maxScenarioMs}`);
  }
  if (base.displays.some((item) => /^(you can say|suggested reply|answer:|reply:)/i.test(item.text.trim()))) {
    flags.push("meta_prefix_displayed");
  }
  if (base.displays.some((item) => item.text.length > 520 && !statusReasons.some((reason) => reason.startsWith("teleprompt")))) {
    flags.push("short_mode_too_long");
  }

  const hard = flags.some((flag) => (
    flag.startsWith("missing_display_expected")
    || flag.startsWith("contains_rejected")
    || flag.startsWith("missing_status")
    || flag.startsWith("contains_status")
    || flag.startsWith("too_many_processed")
    || flag === "no_display"
    || flag === "unexpected_display"
    || flag === "meta_prefix_displayed"
  ));

  return { flags, verdict: hard ? "bad" : flags.length ? "watch" : "good" };
}

async function runScenario(
  scenario: Scenario,
  handler: MergeResponseHandler,
  harness: AsrStreamHarness,
  mock: MockSession,
  statuses: StatusEvent[],
  insights: InsightEvent[],
): Promise<ScenarioResult> {
  setScene(scenario.scene);
  handler.resetRuntimeState();
  harness.reset();
  await sleep(40);

  const displayStart = mock.displays.length;
  const statusStart = statuses.length;
  const insightStart = insights.length;
  const scenarioStart = performance.now();
  await harness.run(scenario.events);
  await harness.settle();
  const elapsedMs = Math.round(performance.now() - scenarioStart);

  const base = {
    id: scenario.id,
    scene: scenario.scene,
    category: scenario.category,
    description: scenario.description,
    elapsedMs,
    processed: harness.processed,
    displays: mock.displays.slice(displayStart).filter((item) => item.text !== "SayNext is listening."),
    statuses: statuses.slice(statusStart),
    insights: insights.slice(insightStart),
    knownRisk: scenario.knownRisk,
  };
  const judgment = judgeScenario(scenario, base);
  return { ...base, ...judgment };
}

function summarize(results: ScenarioResult[]): string {
  const counts = results.reduce<Record<Verdict, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] || 0) + 1;
    return acc;
  }, { good: 0, watch: 0, bad: 0 });
  const latencies = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
  return [
    `- scenarios: ${results.length}`,
    `- good: ${counts.good}`,
    `- watch: ${counts.watch}`,
    `- bad: ${counts.bad}`,
    `- avg elapsed: ${Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / Math.max(1, results.length))}ms`,
    `- p95 elapsed: ${latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] || 0}ms`,
    `- compressed ASR timeout: ${testTimeoutMs}ms`,
  ].join("\n");
}

function renderReport(results: ScenarioResult[], mock: MockSession): string {
  const issueResults = results.filter((item) => item.verdict !== "good");
  const sections = results.map((result) => [
    `## ${result.verdict.toUpperCase()} ${result.id}`,
    "",
    `- scene: ${result.scene}`,
    `- category: ${result.category}`,
    `- elapsedMs: ${result.elapsedMs}`,
    `- flags: ${result.flags.join(", ") || "(none)"}`,
    result.knownRisk ? `- knownRisk: ${result.knownRisk}` : "",
    "",
    result.description,
    "",
    "Processed utterances:",
    "```text",
    result.processed.map((item) => `[+${item.atMs}ms ${item.reason}${item.skipped ? ` skipped=${item.skipped}` : ""}] ${item.text}`).join("\n") || "(none)",
    "```",
    "",
    "Statuses:",
    "```text",
    result.statuses.map((item) => `[+${item.atMs}ms] ${item.event.type}:${item.event.reason || ""}`).join("\n") || "(none)",
    "```",
    "",
    "Displays:",
    "```text",
    result.displays.map((item) => `[+${item.atMs}ms ${item.durationMs || ""}] ${item.text}`).join("\n") || "(none)",
    "```",
  ].filter(Boolean).join("\n")).join("\n\n");

  const issueList = issueResults.map((result, index) => (
    `${index + 1}. ${result.id} (${result.verdict}) - ${result.flags.join(", ")}`
  )).join("\n") || "(none)";

  return [
    "# ASR Stream Runtime Eval",
    "",
    `- timestamp: ${new Date().toISOString()}`,
    `- userId: ${userId}`,
    `- llmProvider: ${process.env.LLM_PROVIDER || "auto/default"}`,
    `- note: timeout is compressed for test speed; production UTTERANCE_TIMEOUT_MS remains 1800ms.`,
    "",
    "## Summary",
    "",
    summarize(results),
    "",
    "## Issues / Watches",
    "",
    issueList,
    "",
    "## Scenario Details",
    "",
    sections,
    "",
    "## Recent Logs",
    "",
    "```text",
    mock.logs.slice(-120).map((item) => `[+${item.atMs}ms ${item.level}] ${item.message}`).join("\n"),
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

  const lastDisplay = () => [...mock.displays].reverse().find((item) => item.text && item.text !== "SayNext is listening.")?.text || "";
  const harness = new AsrStreamHarness(handler, startMs, testTimeoutMs, lastDisplay, () => mock.displays.length);
  const prenoteId = await createEvalPrenote();
  const scenarios = makeScenarios();
  const results: ScenarioResult[] = [];

  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario, handler, harness, mock, statuses, insights));
    }
  } finally {
    conversationLogger.deletePrenote(userId, prenoteId);
    handler.close();
  }

  const report = renderReport(results, mock);
  const reportPath = join(outDir, `asr-stream-runtime-${timestamp}.md`);
  const jsonPath = join(outDir, `asr-stream-runtime-${timestamp}.json`);
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify({ results, displays: mock.displays, statuses, insights, logs: mock.logs }, null, 2), "utf8");

  console.log(`ASR_STREAM_RUNTIME_REPORT ${reportPath}`);
  console.log(summarize(results));
  const issues = results.filter((item) => item.verdict !== "good");
  if (issues.length) {
    console.log("ISSUES_OR_WATCHES");
    for (const issue of issues.slice(0, 12)) {
      console.log(`- ${issue.id}: ${issue.verdict} ${issue.flags.join(", ")}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
