import { createHash } from "node:crypto";
import {
  createEvenHubSttAdapter,
  type EvenHubSttAdapter,
  type EvenHubSttCallbacks,
} from "../evenhub/stt";
import {
  normalizeAutoCueOutput,
  OpenAiAutoCueGenerator,
  shouldDisplayAutoCue,
  type AutoCueGenerationResult,
  type AutoCueGenerator,
} from "./auto-cue-generator";
import {
  LightweightEvenHubV2ContextAdapter,
  type EvenHubV2ContextAdapter,
} from "./context-adapter";
import {
  defaultEvenHubV2Settings,
  makeEvenHubV2Id,
  normalizeEvenHubV2Settings,
  type AudioStatus,
  type AutoCueJobStatus,
  type ConversationStatus,
  type EvenHubV2ClientMessage,
  type EvenHubV2Envelope,
  type EvenHubV2ServerMessage,
  type EvenHubV2Settings,
} from "./protocol";
import {
  evenHubV2Store,
  type EvenHubV2CueRecord,
  type EvenHubV2Store,
  type EvenHubV2TranscriptLineRecord,
} from "./store";
import { evenHubV2SummaryRunner, type EvenHubV2SummaryRunner } from "./summary-runner";

type RuntimeState = {
  conversationStatus: ConversationStatus;
  audioStatus: AudioStatus;
  activeAutoJobs: Map<string, AutoCueJobStatus>;
};

type EvenHubV2RuntimeOptions = {
  userId: string;
  clientSessionId?: string;
  send: (message: EvenHubV2ServerMessage) => void;
  store?: EvenHubV2Store;
  autoCueGenerator?: AutoCueGenerator;
  contextAdapter?: EvenHubV2ContextAdapter;
  summaryRunner?: Pick<EvenHubV2SummaryRunner, "queueSummary" | "enqueue">;
  sttAdapterFactory?: (callbacks: EvenHubSttCallbacks) => EvenHubSttAdapter | null;
  settings?: Partial<EvenHubV2Settings>;
  debounceMs?: number;
  cooldownMs?: number;
  maxDisplayedCuesPerMinute?: number;
  confidenceThreshold?: number;
  finalFlushTimeoutMs?: number;
  partialCommitMs?: number;
};

const DEFAULT_USER_ID = "evenhub-v2-user";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class EvenHubV2Runtime {
  readonly userId: string;
  readonly clientSessionId: string;
  private sendToClient: ((message: EvenHubV2ServerMessage) => void) | null;
  private readonly store: EvenHubV2Store;
  private readonly autoCueGenerator: AutoCueGenerator;
  private readonly contextAdapter: EvenHubV2ContextAdapter;
  private readonly summaryRunner: Pick<EvenHubV2SummaryRunner, "queueSummary" | "enqueue">;
  private readonly sttAdapter: EvenHubSttAdapter | null;
  private readonly debounceMs: number;
  private readonly cooldownMs: number;
  private readonly maxDisplayedCuesPerMinute: number;
  private readonly confidenceThreshold: number;
  private readonly finalFlushTimeoutMs: number;
  private readonly partialCommitMs: number;
  private serverSeq = 0;
  private settings: EvenHubV2Settings;
  private conversationId: string | null = null;
  private conversationStartedAt = 0;
  private selectedPrenoteIds: string[] = [];
  private selectedPrenoteText = "";
  private transcriptLines: EvenHubV2TranscriptLineRecord[] = [];
  private candidateBuffer: EvenHubV2TranscriptLineRecord[] = [];
  private generatedTranscriptHashes = new Set<string>();
  private lastDisplayedCueOutputHash: string | null = null;
  private displayedCueTimes: number[] = [];
  private pendingFlush = false;
  private cueFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentAutoJob: Promise<void> | null = null;
  private audioBytesReceived = 0;
  private audioChunksReceived = 0;
  private sttPartialCount = 0;
  private sttFinalCount = 0;
  private finalSavedCount = 0;
  private lastAudioStatusAt = 0;
  private lastPartialText = "";
  private lastFinalText = "";
  private partialCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private state: RuntimeState = {
    conversationStatus: "idle",
    audioStatus: "stopped",
    activeAutoJobs: new Map(),
  };

  constructor(options: EvenHubV2RuntimeOptions) {
    this.userId = options.userId.trim() || DEFAULT_USER_ID;
    this.clientSessionId = options.clientSessionId?.trim() || makeEvenHubV2Id("evenhub_v2_session");
    this.sendToClient = options.send;
    this.store = options.store || evenHubV2Store;
    this.autoCueGenerator = options.autoCueGenerator || new OpenAiAutoCueGenerator();
    this.contextAdapter = options.contextAdapter || new LightweightEvenHubV2ContextAdapter();
    this.summaryRunner = options.summaryRunner || evenHubV2SummaryRunner;
    this.sttAdapter = (options.sttAdapterFactory || createEvenHubSttAdapter)({
      onTranscript: (event) => this.handleSttTranscript(event.text, event.isFinal),
      onStatus: (detail) => this.sendAudioStatus(this.state.audioStatus, detail),
      onError: (error) => {
        this.state.audioStatus = "failed";
        this.sendAudioStatus("failed", error.message);
      },
    });
    this.settings = normalizeEvenHubV2Settings(options.settings);
    this.debounceMs = options.debounceMs ?? Number(process.env.EVENHUB_V2_CUE_DEBOUNCE_MS || 900);
    this.cooldownMs = options.cooldownMs ?? Number(process.env.EVENHUB_V2_CUE_COOLDOWN_MS || 8000);
    this.maxDisplayedCuesPerMinute = options.maxDisplayedCuesPerMinute ?? Number(process.env.EVENHUB_V2_MAX_CUES_PER_MINUTE || 3);
    this.confidenceThreshold = options.confidenceThreshold ?? Number(process.env.EVENHUB_V2_CUE_CONFIDENCE_THRESHOLD || 0.75);
    this.finalFlushTimeoutMs = options.finalFlushTimeoutMs ?? Number(process.env.EVENHUB_V2_FINAL_FLUSH_TIMEOUT_MS || 800);
    this.partialCommitMs = options.partialCommitMs ?? Number(process.env.EVENHUB_STT_PARTIAL_COMMIT_MS || 1200);
  }

  get snapshot(): RuntimeState {
    return {
      conversationStatus: this.state.conversationStatus,
      audioStatus: this.state.audioStatus,
      activeAutoJobs: new Map(this.state.activeAutoJobs),
    };
  }

  get activeConversationId(): string | null {
    return this.conversationId;
  }

  attachClient(send: (message: EvenHubV2ServerMessage) => void): void {
    this.sendToClient = send;
  }

  handleOpen(): void {
    this.sendMessage("ready", {
      conversationStatus: this.state.conversationStatus,
      audioStatus: this.state.audioStatus,
      settings: this.settings,
    });
  }

  async handleClientMessage(message: EvenHubV2ClientMessage): Promise<void> {
    if (message.type === "hello") {
      this.settings = normalizeEvenHubV2Settings(message.payload?.settings, this.settings);
      this.sendMessage("ready", {
        conversationStatus: this.state.conversationStatus,
        audioStatus: this.state.audioStatus,
        settings: this.settings,
      });
      return;
    }

    if (message.type === "conversation_start") {
      await this.startConversation(message);
      return;
    }

    if (message.type === "audio_start") {
      await this.startAudio();
      return;
    }

    if (message.type === "audio_stop") {
      await this.stopAudio("stopped_by_client");
      return;
    }

    if (message.type === "debug_transcript") {
      const text = message.payload?.text || "";
      if (message.payload?.isFinal === false) {
        this.handlePartialTranscript(text);
      } else {
        await this.commitFinalTranscript(text, "debug");
      }
      return;
    }

    if (message.type === "conversation_end") {
      await this.endConversation();
      return;
    }

    if (message.type === "ack") {
      return;
    }
  }

  handleAudioChunk(chunk: Uint8Array): void {
    this.audioBytesReceived += chunk.byteLength;
    this.audioChunksReceived += 1;
    this.logAudioProgress("chunk");
    if (this.state.conversationStatus !== "active") {
      this.sendAudioStatus(this.state.audioStatus, "Audio ignored because no active conversation.", true);
      return;
    }
    if (this.state.audioStatus === "starting" && this.sttAdapter) {
      this.sttAdapter.pushAudio(chunk);
      this.sendAudioStatus("starting", "Audio queued while STT is starting.");
      return;
    }
    if (this.state.audioStatus !== "listening") {
      this.sendAudioStatus(this.state.audioStatus, "Audio received while not listening.", true);
      return;
    }
    if (!this.sttAdapter) {
      this.state.audioStatus = "failed";
      this.sendAudioStatus("failed", "STT adapter is not configured.", true);
      return;
    }
    this.sttAdapter.pushAudio(chunk);
    this.sendAudioStatus("listening", "Audio streaming to STT.");
  }

  async close(): Promise<void> {
    this.clearCueFlushTimer();
    this.clearPartialCommitTimer();
    await this.sttAdapter?.close();
    this.sendToClient = null;
  }

  async detachClient(): Promise<void> {
    this.sendToClient = null;
  }

  async flushCueBufferNow(): Promise<void> {
    this.clearCueFlushTimer();
    await this.tryStartAutoCueJob();
  }

  private async startConversation(message: Extract<EvenHubV2ClientMessage, { type: "conversation_start" }>): Promise<void> {
    if (this.state.conversationStatus === "active" || this.state.conversationStatus === "ending") {
      this.sendError("conversation_already_active", "A conversation is already active.", true);
      return;
    }

    this.settings = normalizeEvenHubV2Settings(message.payload?.settings, this.settings);
    this.conversationId = makeEvenHubV2Id("conv");
    this.conversationStartedAt = Date.now();
    this.selectedPrenoteIds = message.payload?.selectedPrenoteIds || [];
    this.selectedPrenoteText = message.payload?.selectedPrenoteText || "";
    this.transcriptLines = [];
    this.candidateBuffer = [];
    this.generatedTranscriptHashes = new Set();
    this.lastDisplayedCueOutputHash = null;
    this.displayedCueTimes = [];
    this.audioBytesReceived = 0;
    this.audioChunksReceived = 0;
    this.sttPartialCount = 0;
    this.sttFinalCount = 0;
    this.finalSavedCount = 0;
    this.lastAudioStatusAt = 0;
    this.lastPartialText = "";
    this.lastFinalText = "";
    this.clearPartialCommitTimer();
    this.state = {
      conversationStatus: "active",
      audioStatus: "stopped",
      activeAutoJobs: new Map(),
    };

    this.store.createConversation({
      id: this.conversationId,
      userId: this.userId,
      clientSessionId: this.clientSessionId,
      title: "New Conversation",
      startedAt: new Date(this.conversationStartedAt).toISOString(),
      settings: this.settings,
      usedPrenote: {
        ids: this.selectedPrenoteIds,
        text: this.selectedPrenoteText,
      },
    });

    this.sendMessage("conversation_started", {
      conversationId: this.conversationId,
      conversationStatus: this.state.conversationStatus,
      audioStatus: this.state.audioStatus,
    });
  }

  private async startAudio(): Promise<void> {
    if (this.state.conversationStatus !== "active") {
      this.sendError("conversation_not_active", "Start a conversation before starting audio.", true);
      return;
    }
    if (this.state.audioStatus === "listening" || this.state.audioStatus === "starting") {
      this.sendAudioStatus(this.state.audioStatus, "Audio is already active.", true);
      return;
    }
    if (!this.sttAdapter) {
      this.state.audioStatus = "failed";
      this.sendAudioStatus("failed", "Deepgram STT is not configured.", true);
      return;
    }

    this.state.audioStatus = "starting";
    this.sendAudioStatus("starting", "Starting audio.", true);
    try {
      await this.sttAdapter.start();
      if (this.state.conversationStatus !== "active") return;
      this.state.audioStatus = "listening";
      this.sendAudioStatus("listening", "Listening.", true);
    } catch (error) {
      this.state.audioStatus = "failed";
      this.sendAudioStatus("failed", error instanceof Error ? error.message : String(error), true);
    }
  }

  private async stopAudio(detail: string): Promise<void> {
    if (this.state.audioStatus === "stopped") {
      this.sendAudioStatus("stopped", detail, true);
      return;
    }
    this.state.audioStatus = "stopped";
    await this.sttAdapter?.stop().catch((error) => {
      this.sendAudioStatus("failed", error instanceof Error ? error.message : String(error), true);
    });
    this.sendAudioStatus("stopped", detail, true);
  }

  private handlePartialTranscript(text: string): void {
    const normalized = normalizeText(text);
    if (!normalized || this.state.conversationStatus !== "active") return;
    this.lastPartialText = normalized;
    this.sendMessage("transcript_partial", {
      text: normalized,
      offsetMs: this.currentOffsetMs(),
    });
    this.schedulePartialCommit();
  }

  private async commitFinalTranscript(text: string, source: string): Promise<EvenHubV2TranscriptLineRecord | null> {
    const normalized = normalizeText(text);
    const canCommit = this.state.conversationStatus === "active" || this.state.conversationStatus === "ending";
    if (!normalized || normalized === this.lastFinalText || !canCommit || !this.conversationId) {
      return null;
    }

    const receivedAt = new Date().toISOString();
    let line: EvenHubV2TranscriptLineRecord | null = null;
    const previousLine = this.transcriptLines[this.transcriptLines.length - 1];
    if (source !== "partial_timeout" && previousLine?.source === "partial_timeout" && this.shouldReplacePartialTimeout(previousLine.text, normalized)) {
      line = this.store.updateTranscriptLine({
        id: previousLine.id,
        text: normalized,
        receivedAt,
        source,
      });
      if (line) {
        this.transcriptLines[this.transcriptLines.length - 1] = line;
        this.candidateBuffer = this.candidateBuffer.map((item) => item.id === line!.id ? line! : item);
      }
    }
    if (!line) {
      line = this.store.addTranscriptLine({
        id: makeEvenHubV2Id("line"),
        conversationId: this.conversationId,
        userId: this.userId,
        lineIndex: this.transcriptLines.length,
        text: normalized,
        receivedAt,
        source,
      });
      this.transcriptLines.push(line);
    }
    this.lastFinalText = normalized;
    this.lastPartialText = normalized === this.lastPartialText ? "" : this.lastPartialText;
    this.finalSavedCount += 1;
    this.logTranscriptProgress("saved_final", normalized, source);
    if (this.state.conversationStatus === "active") {
      if (source !== "partial_timeout") {
        this.candidateBuffer.push(line);
      }
      this.sendMessage("transcript_final", {
        lineId: line.id,
        index: line.lineIndex,
        text: line.text,
        receivedAt: line.receivedAt,
        offsetMs: this.offsetForIso(line.receivedAt),
      });
      if (source !== "partial_timeout") {
        this.scheduleCueFlush();
      }
    }
    return line;
  }

  private async handleSttTranscript(text: string, isFinal: boolean): Promise<void> {
    if (isFinal) {
      this.sttFinalCount += 1;
      this.clearPartialCommitTimer();
      this.logTranscriptProgress("deepgram_final", text, "deepgram");
      await this.commitFinalTranscript(text, "deepgram");
      return;
    }
    this.sttPartialCount += 1;
    this.logTranscriptProgress("deepgram_partial", text, "deepgram");
    this.handlePartialTranscript(text);
  }

  private scheduleCueFlush(): void {
    if (this.debounceMs <= 0) {
      void this.flushCueBufferNow();
      return;
    }
    this.clearCueFlushTimer();
    this.cueFlushTimer = setTimeout(() => {
      void this.flushCueBufferNow();
    }, this.debounceMs);
  }

  private clearCueFlushTimer(): void {
    if (!this.cueFlushTimer) return;
    clearTimeout(this.cueFlushTimer);
    this.cueFlushTimer = null;
  }

  private async tryStartAutoCueJob(): Promise<void> {
    if (!this.conversationId || this.state.conversationStatus !== "active") return;
    if (this.currentAutoJob) {
      this.pendingFlush = true;
      return;
    }
    if (!this.candidateBuffer.length) return;

    const now = Date.now();
    this.displayedCueTimes = this.displayedCueTimes.filter((time) => now - time < 60_000);
    if (this.displayedCueTimes.length >= this.maxDisplayedCuesPerMinute) {
      this.writeSkippedAttempt("rate_limited");
      return;
    }

    const lastDisplayedAt = this.displayedCueTimes[this.displayedCueTimes.length - 1] || 0;
    const cooldownRemaining = this.cooldownMs - (now - lastDisplayedAt);
    if (lastDisplayedAt && cooldownRemaining > 0) {
      this.clearCueFlushTimer();
      this.cueFlushTimer = setTimeout(() => {
        void this.flushCueBufferNow();
      }, cooldownRemaining);
      return;
    }

    const windowLines = this.candidateBuffer.slice(-3);
    this.candidateBuffer = [];
    const triggerWindow = windowLines.map((line) => line.text).join("\n");
    const inputHash = hashText(triggerWindow);
    if (this.generatedTranscriptHashes.has(inputHash)) {
      this.writeSkippedAttempt("duplicate_transcript_hash", windowLines, triggerWindow, inputHash);
      return;
    }
    this.generatedTranscriptHashes.add(inputHash);

    const requestId = makeEvenHubV2Id("auto_req");
    const attemptId = makeEvenHubV2Id("attempt");
    const sourceTranscriptLineIds = windowLines.map((line) => line.id);
    this.state.activeAutoJobs.set(requestId, "running");
    const startedAt = Date.now();

    const job = this.runAutoCueJob({
      attemptId,
      requestId,
      triggerWindow,
      inputHash,
      sourceTranscriptLineIds,
      startedAt,
    }).finally(() => {
      this.state.activeAutoJobs.delete(requestId);
      this.currentAutoJob = null;
      if (this.pendingFlush) {
        this.pendingFlush = false;
        this.scheduleCueFlush();
      }
    });

    this.currentAutoJob = job;
    await job;
  }

  private async runAutoCueJob(input: {
    attemptId: string;
    requestId: string;
    triggerWindow: string;
    inputHash: string;
    sourceTranscriptLineIds: string[];
    startedAt: number;
  }): Promise<void> {
    if (!this.conversationId) return;
    const recentTranscript = this.transcriptLines.slice(-8).map((line) => line.text).join("\n");
    const context = await this.contextAdapter.build({
      userId: this.userId,
      conversationId: this.conversationId,
      triggerWindow: input.triggerWindow,
      recentTranscript,
      selectedPrenoteIds: this.selectedPrenoteIds,
      selectedPrenoteText: this.selectedPrenoteText,
      settings: this.settings,
    });

    this.store.createAutoCueAttempt({
      id: input.attemptId,
      conversationId: this.conversationId,
      userId: this.userId,
      requestId: input.requestId,
      status: "running",
      inputHash: input.inputHash,
      inputWindow: input.triggerWindow,
      sourceTranscriptLineIds: input.sourceTranscriptLineIds,
      promptContextSnapshot: context.contextSnapshot,
      trace: {
        memoryUsedIds: context.memoryUsedIds,
        prenoteUsedIds: context.prenoteUsedIds,
      },
    });

    let result: AutoCueGenerationResult;
    try {
      result = await this.autoCueGenerator.generate({
        triggerWindow: input.triggerWindow,
        recentTranscript,
        contextSnapshot: context.contextSnapshot,
        settings: this.settings,
      });
    } catch (error) {
      this.store.updateAutoCueAttempt(input.attemptId, {
        status: "failed",
        latencyMs: Date.now() - input.startedAt,
        skippedReason: "generator_error",
        trace: {
          error: error instanceof Error ? error.message : String(error),
          memoryUsedIds: context.memoryUsedIds,
          prenoteUsedIds: context.prenoteUsedIds,
        },
      });
      return;
    }

    const cue = normalizeAutoCueOutput(result.data);
    const outputHash = hashText(cue.output);
    const displayDecision = shouldDisplayAutoCue({
      cue,
      confidenceThreshold: this.confidenceThreshold,
      previousOutputHash: this.lastDisplayedCueOutputHash,
      outputHash,
      conversationActive: this.state.conversationStatus === "active",
    });

    if (!displayDecision.ok) {
      this.store.updateAutoCueAttempt(input.attemptId, {
        status: this.state.conversationStatus === "active" ? "skipped" : "stale",
        category: cue.category,
        confidence: cue.confidence,
        title: cue.title,
        g2Title: cue.g2Title,
        output: cue.output,
        reason: cue.reason,
        rawOutput: result.rawText,
        model: result.model,
        latencyMs: Date.now() - input.startedAt,
        skippedReason: displayDecision.reason,
        trace: {
          memoryUsedIds: context.memoryUsedIds,
          prenoteUsedIds: context.prenoteUsedIds,
        },
      });
      return;
    }

    if (!this.conversationId || this.state.conversationStatus !== "active" || cue.category === "none") {
      this.store.updateAutoCueAttempt(input.attemptId, {
        status: "stale",
        category: cue.category,
        confidence: cue.confidence,
        title: cue.title,
        g2Title: cue.g2Title,
        output: cue.output,
        reason: cue.reason,
        rawOutput: result.rawText,
        model: result.model,
        latencyMs: Date.now() - input.startedAt,
        skippedReason: "stale_after_validation",
      });
      return;
    }

    const createdAt = new Date().toISOString();
    const storedCue = this.store.createCue({
      id: makeEvenHubV2Id("cue"),
      conversationId: this.conversationId,
      userId: this.userId,
      attemptId: input.attemptId,
      category: cue.category,
      title: cue.title,
      g2Title: cue.g2Title,
      output: cue.output,
      sourceTranscriptLineIds: input.sourceTranscriptLineIds,
      createdAt,
    });
    this.lastDisplayedCueOutputHash = outputHash;
    this.displayedCueTimes.push(Date.now());
    this.store.updateAutoCueAttempt(input.attemptId, {
      status: "created",
      category: cue.category,
      confidence: cue.confidence,
      title: cue.title,
      g2Title: cue.g2Title,
      output: cue.output,
      reason: cue.reason,
      rawOutput: result.rawText,
      model: result.model,
      latencyMs: Date.now() - input.startedAt,
      trace: {
        cueId: storedCue.id,
        memoryUsedIds: context.memoryUsedIds,
        prenoteUsedIds: context.prenoteUsedIds,
      },
    });
    this.sendCueCreated(storedCue);
  }

  private writeSkippedAttempt(
    reason: string,
    lines: EvenHubV2TranscriptLineRecord[] = this.candidateBuffer.splice(0),
    triggerWindow = lines.map((line) => line.text).join("\n"),
    inputHash = hashText(triggerWindow || reason),
  ): void {
    if (!this.conversationId) return;
    const attemptId = makeEvenHubV2Id("attempt");
    this.store.createAutoCueAttempt({
      id: attemptId,
      conversationId: this.conversationId,
      userId: this.userId,
      requestId: makeEvenHubV2Id("auto_req"),
      status: "skipped",
      inputHash,
      inputWindow: triggerWindow,
      sourceTranscriptLineIds: lines.map((line) => line.id),
      promptContextSnapshot: "",
      trace: { reason },
    });
    this.store.updateAutoCueAttempt(attemptId, {
      status: "skipped",
      skippedReason: reason,
      trace: { reason },
    });
  }

  private async endConversation(): Promise<void> {
    if (this.state.conversationStatus === "ending") {
      return;
    }

    if (!this.conversationId || this.state.conversationStatus === "idle" || this.state.conversationStatus === "ended") {
      this.sendError("conversation_not_active", "No active conversation to end.", true);
      return;
    }

    this.state.conversationStatus = "ending";
    this.clearCueFlushTimer();
    await this.stopAudio("conversation_ending");
    await new Promise((resolve) => setTimeout(resolve, this.finalFlushTimeoutMs));
    await this.commitPendingPartialTranscript();

    const endedAt = new Date().toISOString();
    const conversationId = this.conversationId;
    this.store.endConversation({
      conversationId,
      endedAt,
      durationMs: Math.max(0, Date.now() - this.conversationStartedAt),
      lastPartialAtEnd: this.lastPartialText,
    });
    this.summaryRunner.queueSummary({
      conversationId,
      userId: this.userId,
      queuedAt: endedAt,
    });
    this.state.conversationStatus = "ended";
    this.state.audioStatus = "stopped";
    this.conversationId = null;
    this.candidateBuffer = [];
    this.clearPartialCommitTimer();
    console.info(`[EvenHubV2] conversation ended id=${conversationId} chunks=${this.audioChunksReceived} bytes=${this.audioBytesReceived} partials=${this.sttPartialCount} finals=${this.sttFinalCount} saved=${this.finalSavedCount}`);
    this.sendMessage("conversation_saved", {
      conversationId,
      transcriptCount: this.transcriptLines.length,
      cueCount: this.store.listCues(conversationId).length,
      endedAt,
    }, conversationId);
    this.summaryRunner.enqueue(conversationId);
  }

  private sendCueCreated(cue: EvenHubV2CueRecord): void {
    this.sendMessage("cue_created", {
      cueId: cue.id,
      attemptId: cue.attemptId,
      category: cue.category,
      title: cue.title,
      g2Title: cue.g2Title,
      output: cue.output,
      sourceTranscriptLineIds: parseJsonArray(cue.sourceTranscriptLineIdsJson),
      createdAt: cue.createdAt,
    }, cue.conversationId);
  }

  private sendAudioStatus(audioStatus: AudioStatus, detail?: string, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastAudioStatusAt < 1000) return;
    this.lastAudioStatusAt = now;
    this.sendMessage("audio_status", {
      audioStatus,
      detail,
      audioBytesReceived: this.audioBytesReceived,
    });
  }

  private currentOffsetMs(): number {
    if (!this.conversationStartedAt) return 0;
    return Math.max(0, Date.now() - this.conversationStartedAt);
  }

  private offsetForIso(value: string): number {
    if (!this.conversationStartedAt) return 0;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return this.currentOffsetMs();
    return Math.max(0, time - this.conversationStartedAt);
  }

  private schedulePartialCommit(): void {
    this.clearPartialCommitTimer();
    if (!this.lastPartialText || this.partialCommitMs <= 0) return;
    this.partialCommitTimer = setTimeout(() => {
      void this.commitPendingPartialTranscript();
    }, this.partialCommitMs);
  }

  private clearPartialCommitTimer(): void {
    if (!this.partialCommitTimer) return;
    clearTimeout(this.partialCommitTimer);
    this.partialCommitTimer = null;
  }

  private async commitPendingPartialTranscript(): Promise<void> {
    const text = this.lastPartialText.trim();
    if (!text) return;
    this.clearPartialCommitTimer();
    this.lastPartialText = "";
    await this.commitFinalTranscript(text, "partial_timeout");
  }

  private shouldReplacePartialTimeout(partial: string, final: string): boolean {
    const left = normalizeText(partial).toLowerCase();
    const right = normalizeText(final).toLowerCase();
    return Boolean(left && right && (right.startsWith(left) || left.startsWith(right)));
  }

  private logAudioProgress(reason: string): void {
    if (this.audioChunksReceived <= 3 || this.audioChunksReceived % 50 === 0) {
      console.info(`[EvenHubV2] audio ${reason} conv=${this.conversationId || "-"} status=${this.state.audioStatus} chunks=${this.audioChunksReceived} bytes=${this.audioBytesReceived}`);
    }
  }

  private logTranscriptProgress(event: string, text: string, source: string): void {
    const normalized = normalizeText(text);
    if (event === "deepgram_partial" && this.sttPartialCount > 3 && this.sttPartialCount % 20 !== 0) return;
    console.info(`[EvenHubV2] transcript ${event} conv=${this.conversationId || "-"} source=${source} partials=${this.sttPartialCount} finals=${this.sttFinalCount} saved=${this.finalSavedCount} len=${normalized.length} text=${JSON.stringify(normalized.slice(0, 120))}`);
  }

  private sendError(code: string, message: string, recoverable = false): void {
    this.sendMessage("error", { code, message, recoverable });
  }

  private sendMessage(
    type: EvenHubV2ServerMessage["type"],
    payload: unknown,
    conversationId = this.conversationId || undefined,
  ): void {
    const message: EvenHubV2Envelope<string, unknown> = {
      protocolVersion: "evenhub-v2.1",
      messageId: makeEvenHubV2Id("server_msg"),
      conversationId,
      serverSeq: ++this.serverSeq,
      timestamp: new Date().toISOString(),
      type,
      payload,
    };
    this.sendToClient?.(message as EvenHubV2ServerMessage);
  }
}

export function createEvenHubV2Runtime(options: Omit<EvenHubV2RuntimeOptions, "userId"> & { userId?: string }): EvenHubV2Runtime {
  return new EvenHubV2Runtime({
    ...options,
    userId: options.userId || DEFAULT_USER_ID,
  });
}
