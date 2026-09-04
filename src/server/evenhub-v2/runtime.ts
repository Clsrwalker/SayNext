import { createHash } from "node:crypto";
import {
  createEvenHubSttAdapter,
  type EvenHubSttAdapter,
  type EvenHubSttCallbacks,
  type EvenHubSttConnectionEvent,
  type EvenHubSttStartOptions,
  type EvenHubTranscriptEvent,
} from "../evenhub/stt";
import {
  normalizeAutoCueOutput,
  OpenAiAutoCueGenerator,
  shouldDisplayAutoCue,
  type AutoCueGenerationResult,
  type AutoCueGenerator,
  type AutoCueSession,
} from "./auto-cue-generator";
import {
  LightweightEvenHubV2ContextAdapter,
  type EvenHubV2ContextAdapter,
  type EvenHubV2ContextSnapshot,
} from "./context-adapter";
import { computeLinear16AudioStats, type Linear16AudioStats } from "./audio-diagnostics";
import { isLikelyCueReadback, sameSpokenText } from "./cue-turn";
import { getDeepSenseInterviewCards } from "./interview-guide";
import {
  evenHubV2CueOpportunityRouter,
  type CueOpportunityRouter,
  type CueOpportunityRouterResult,
} from "./cue-opportunity-router";
import {
  defaultEvenHubV2Settings,
  makeEvenHubV2Id,
  normalizeEvenHubV2Settings,
  type AudioStatus,
  type AutoCueJobStatus,
  type ConversationStatus,
  type EvenHubV2AudioSource,
  type EvenHubV2ClientMessage,
  type EvenHubV2Envelope,
  type EvenHubV2ObservedAudioSource,
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

type LiveTranscriptTurn = {
  id: string;
  revision: number;
  text: string;
  updatedAt: number;
  providerTurnOrder?: number;
};

type SpeculativeTrigger = "utterance" | "partial_watchdog";

type PendingSpeculativeRequest = {
  turn: LiveTranscriptTurn;
  trigger: SpeculativeTrigger;
  utteranceHash?: string;
};

type SpeculativeTurnBudget = {
  turnId: string;
  providerTurnOrder?: number;
  attemptsStarted: number;
  totalAttemptsStarted: number;
  utteranceHashes: Set<string>;
  forceEndpointRequested: boolean;
  forceEndpointRequestedAt?: number;
  recoveryCount: number;
};

type FinalCueCandidate = {
  turnId: string;
  revision: number;
  line: EvenHubV2TranscriptLineRecord;
  previousTurns: Array<{ lineId: string; text: string; role: "unknown" | "xiang_readback" }>;
};

type CueJobInput = {
  attemptId: string;
  requestId: string;
  questionId: string;
  sourceRevision: number;
  triggerWindow: string;
  inputHash: string;
  sourceTranscriptLineIds: string[];
  previousTurns: Array<{ lineId: string; text: string; role: "unknown" | "xiang_readback" }>;
  startedAt: number;
  speculative: boolean;
  speculativeTrigger?: SpeculativeTrigger;
  speculativeAttemptOrdinal?: number;
  providerTurnOrder?: number;
  speculativeRecoveryCount?: number;
};

type GeneratedCueDraft = {
  input: CueJobInput;
  result: AutoCueGenerationResult;
  context: EvenHubV2ContextSnapshot;
  contextLatencyMs: number;
  router: CueOpportunityRouterResult | null;
  routerError: string;
};

type AutoCueProviderLifecycle = {
  localConversationId: string;
  session: AutoCueSession | null;
  sessionPromise: Promise<AutoCueSession | null>;
  commitChain: Promise<void>;
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
  cueOpportunityRouter?: CueOpportunityRouter | null;
  finalFlushTimeoutMs?: number;
  partialCommitMs?: number;
  partialCommitMinChars?: number;
  partialCommitMinWords?: number;
  speculativeSoftBudget?: number;
  speculativeHardBudget?: number;
  speculativeEndpointGraceMs?: number;
};

const DEFAULT_USER_ID = "evenhub-v2-user";
const DEFAULT_PARTIAL_COMMIT_MS = 1200;
const DEFAULT_PARTIAL_COMMIT_MIN_CHARS = 12;
const DEFAULT_PARTIAL_COMMIT_MIN_WORDS = 4;
const DEFAULT_SPECULATIVE_SOFT_BUDGET = 3;
const DEFAULT_SPECULATIVE_HARD_BUDGET = 5;
const DEFAULT_SPECULATIVE_ENDPOINT_GRACE_MS = 2500;
const LOW_RMS_THRESHOLD = 80;
const DEEPSENSE_ACTIVE_INTERVIEW_QUERY = "DeepSense Full-Stack AI Developer Co-op Fall 2026 interview";

function sttStartOptionsForLanguage(
  language: EvenHubV2Settings["language"],
): EvenHubSttStartOptions {
  if (language === "english") return { languageCode: "en" };
  if (language === "chinese") return { languageCode: "zh" };
  return { languageCode: null };
}

type ClientAudioDiagnostics = {
  selectedSource?: EvenHubV2AudioSource;
  chunkCount?: number;
  byteCount?: number;
  sourceCounts?: Record<EvenHubV2ObservedAudioSource, number>;
  mismatchCount?: number;
};

type AudioStatsSummary = {
  chunkCount: number;
  byteCount: number;
  avgRms: number;
  minRms: number;
  maxRms: number;
  peak: number;
  avgZeroRatio: number;
  maxClippedRatio: number;
  lowRmsChunkCount: number;
  selectedSource?: EvenHubV2AudioSource;
  clientChunkCount?: number;
  clientByteCount?: number;
  clientSourceCounts?: Record<EvenHubV2ObservedAudioSource, number>;
  clientMismatchCount?: number;
};

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
  private clientConnectionId: string | null = null;
  private readonly store: EvenHubV2Store;
  private readonly autoCueGenerator: AutoCueGenerator;
  private readonly contextAdapter: EvenHubV2ContextAdapter;
  private readonly summaryRunner: Pick<EvenHubV2SummaryRunner, "queueSummary" | "enqueue">;
  private readonly sttAdapter: EvenHubSttAdapter | null;
  private readonly sttProvider: string;
  private readonly debounceMs: number;
  private readonly cueOpportunityRouter: CueOpportunityRouter | null;
  private readonly finalFlushTimeoutMs: number;
  private readonly partialCommitMs: number;
  private readonly partialCommitMinChars: number;
  private readonly partialCommitMinWords: number;
  private readonly speculativeSoftBudget: number;
  private readonly speculativeHardBudget: number;
  private readonly speculativeEndpointGraceMs: number;
  private serverSeq = 0;
  private settings: EvenHubV2Settings;
  private conversationId: string | null = null;
  private conversationStartedAt = 0;
  private selectedPrenoteIds: string[] = [];
  private selectedPrenoteText = "";
  private transcriptLines: EvenHubV2TranscriptLineRecord[] = [];
  private candidateBuffer: FinalCueCandidate[] = [];
  private generatedTranscriptHashes = new Set<string>();
  private lastDisplayedCueOutputHash: string | null = null;
  private lastDisplayedCueOutput = "";
  private pendingFlush = false;
  private cueFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentAutoJob: Promise<void> | null = null;
  private currentAutoJobInput: CueJobInput | null = null;
  private currentAutoJobAbortController: AbortController | null = null;
  private readonly preemptedAutoJobReasons = new Map<string, string>();
  private pendingSpeculativeRequest: PendingSpeculativeRequest | null = null;
  private speculativeTurnBudget: SpeculativeTurnBudget | null = null;
  private providerLifecycle: AutoCueProviderLifecycle | null = null;
  private liveTurn: LiveTranscriptTurn | null = null;
  private completedSpeculativeRevisions = new Map<string, number>();
  private publishedSpeculativeTurnIds = new Set<string>();
  private finalizedTurns = new Map<string, { revision: number; text: string; lineId: string }>();
  private canonicalTurns: Array<{ lineId: string; text: string; role: "unknown" | "xiang_readback" }> = [];
  private audioBytesReceived = 0;
  private audioChunksReceived = 0;
  private lastAudioStats: Linear16AudioStats | null = null;
  private audioRmsTotal = 0;
  private audioMinRms: number | null = null;
  private audioMaxRms = 0;
  private audioPeak = 0;
  private audioZeroRatioTotal = 0;
  private audioMaxClippedRatio = 0;
  private lowRmsChunkCount = 0;
  private clientAudioDiagnostics: ClientAudioDiagnostics = {};
  private sttPartialCount = 0;
  private sttFinalCount = 0;
  private finalSavedCount = 0;
  private lastAudioStatusAt = 0;
  private audioSource: EvenHubV2AudioSource = "glasses";
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
    this.contextAdapter = options.contextAdapter || new LightweightEvenHubV2ContextAdapter({
      activeInterviewQuery: process.env.EVENHUB_V2_ACTIVE_INTERVIEW_QUERY?.trim()
        || DEEPSENSE_ACTIVE_INTERVIEW_QUERY,
      interviewCards: getDeepSenseInterviewCards(),
    });
    this.summaryRunner = options.summaryRunner || evenHubV2SummaryRunner;
    this.sttAdapter = (options.sttAdapterFactory || createEvenHubSttAdapter)({
      onTranscript: (event) => this.handleSttTranscript(event),
      onConnectionState: (event) => this.handleSttConnectionState(event),
      onStatus: (detail) => this.sendAudioStatus(this.state.audioStatus, detail),
      onError: (error) => {
        if (this.state.audioStatus === "failed") {
          console.warn(`[EvenHubV2] STT error after failed state: ${error.message}`);
          return;
        }
        this.state.audioStatus = "failed";
        this.sendAudioStatus("failed", error.message);
      },
    });
    this.sttProvider = this.sttAdapter?.provider || "stt";
    this.settings = normalizeEvenHubV2Settings(options.settings);
    this.debounceMs = options.debounceMs ?? Number(process.env.EVENHUB_V2_CUE_DEBOUNCE_MS || 0);
    this.cueOpportunityRouter = options.cueOpportunityRouter === undefined
      ? evenHubV2CueOpportunityRouter
      : options.cueOpportunityRouter;
    this.finalFlushTimeoutMs = options.finalFlushTimeoutMs ?? Number(process.env.EVENHUB_V2_FINAL_FLUSH_TIMEOUT_MS || 800);
    this.partialCommitMs = options.partialCommitMs ?? Number(
      process.env.EVENHUB_V2_STT_PARTIAL_COMMIT_MS
      || process.env.EVENHUB_STT_PARTIAL_COMMIT_MS
      || DEFAULT_PARTIAL_COMMIT_MS,
    );
    this.partialCommitMinChars = options.partialCommitMinChars ?? Number(process.env.EVENHUB_STT_PARTIAL_COMMIT_MIN_CHARS || DEFAULT_PARTIAL_COMMIT_MIN_CHARS);
    this.partialCommitMinWords = options.partialCommitMinWords ?? Number(process.env.EVENHUB_STT_PARTIAL_COMMIT_MIN_WORDS || DEFAULT_PARTIAL_COMMIT_MIN_WORDS);
    const configuredSoftBudget = options.speculativeSoftBudget ?? Number(
      process.env.EVENHUB_V2_SPECULATIVE_SOFT_BUDGET || DEFAULT_SPECULATIVE_SOFT_BUDGET,
    );
    const configuredHardBudget = options.speculativeHardBudget ?? Number(
      process.env.EVENHUB_V2_SPECULATIVE_HARD_BUDGET || DEFAULT_SPECULATIVE_HARD_BUDGET,
    );
    this.speculativeSoftBudget = Math.max(1, Math.floor(configuredSoftBudget));
    this.speculativeHardBudget = Math.max(
      this.speculativeSoftBudget,
      Math.floor(configuredHardBudget),
    );
    this.speculativeEndpointGraceMs = Math.max(0, Math.floor(
      options.speculativeEndpointGraceMs
      ?? Number(process.env.EVENHUB_V2_SPECULATIVE_ENDPOINT_GRACE_MS || DEFAULT_SPECULATIVE_ENDPOINT_GRACE_MS),
    ));
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

  attachClient(send: (message: EvenHubV2ServerMessage) => void, connectionId?: string): void {
    this.sendToClient = send;
    this.clientConnectionId = connectionId || null;
  }

  handleOpen(): void {
    this.sendMessage("ready", {
      conversationId: this.conversationId,
      conversationStatus: this.state.conversationStatus,
      audioStatus: this.state.audioStatus,
      settings: this.settings,
    });
  }

  async handleClientMessage(message: EvenHubV2ClientMessage): Promise<void> {
    if (message.type === "hello") {
      this.settings = normalizeEvenHubV2Settings(message.payload?.settings, this.settings);
      this.sendMessage("ready", {
        conversationId: this.conversationId,
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
      await this.startAudio(message.payload?.audioSource);
      return;
    }

    if (message.type === "audio_diagnostics") {
      this.handleAudioDiagnostics(message.payload || {});
      return;
    }

    if (message.type === "glass_diagnostic") {
      this.handleGlassDiagnostic(message);
      return;
    }

    if (message.type === "audio_stop") {
      await this.stopAudio("stopped_by_client");
      return;
    }

    if (message.type === "debug_transcript") {
      const text = message.payload?.text || "";
      if (message.payload?.isFinal === false) {
        this.handlePartialTranscript({ text, isFinal: false });
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
    this.lastAudioStats = computeLinear16AudioStats(chunk);
    this.updateAudioStats(this.lastAudioStats);
    this.logAudioProgress("chunk");
    if (this.state.conversationStatus !== "active") {
      this.sendAudioStatus(this.state.audioStatus, "Audio ignored because no active conversation.", true);
      return;
    }
    if (
      (this.state.audioStatus === "starting" || this.state.audioStatus === "reconnecting")
      && this.sttAdapter
    ) {
      this.sttAdapter.pushAudio(chunk);
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
    this.clientConnectionId = null;
  }

  detachClient(connectionId?: string): boolean {
    if (connectionId && this.clientConnectionId && connectionId !== this.clientConnectionId) return false;
    this.sendToClient = null;
    this.clientConnectionId = null;
    return true;
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
    this.lastDisplayedCueOutput = "";
    this.liveTurn = null;
    this.completedSpeculativeRevisions.clear();
    this.publishedSpeculativeTurnIds.clear();
    this.finalizedTurns.clear();
    this.canonicalTurns = [];
    this.currentAutoJobInput = null;
    this.pendingSpeculativeRequest = null;
    this.speculativeTurnBudget = null;
    this.audioBytesReceived = 0;
    this.audioChunksReceived = 0;
    this.lastAudioStats = null;
    this.audioRmsTotal = 0;
    this.audioMinRms = null;
    this.audioMaxRms = 0;
    this.audioPeak = 0;
    this.audioZeroRatioTotal = 0;
    this.audioMaxClippedRatio = 0;
    this.lowRmsChunkCount = 0;
    this.clientAudioDiagnostics = {};
    this.sttPartialCount = 0;
    this.sttFinalCount = 0;
    this.finalSavedCount = 0;
    this.lastAudioStatusAt = 0;
    this.audioSource = "glasses";
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
    this.beginAutoCueProviderSession(this.conversationId);

    this.sendMessage("conversation_started", {
      conversationId: this.conversationId,
      conversationStatus: this.state.conversationStatus,
      audioStatus: this.state.audioStatus,
    });
  }

  private async startAudio(audioSource: EvenHubV2AudioSource = "glasses"): Promise<void> {
    if (this.state.conversationStatus !== "active") {
      this.sendError("conversation_not_active", "Start a conversation before starting audio.", true);
      return;
    }
    this.audioSource = audioSource;
    if (this.state.audioStatus === "listening" || this.state.audioStatus === "starting") {
      this.sendAudioStatus(this.state.audioStatus, "Audio is already active.", true);
      return;
    }
    if (!this.sttAdapter) {
      this.state.audioStatus = "failed";
      this.sendAudioStatus("failed", "Deepgram STT is not configured.", true);
      return;
    }

    const resumingReconnect = this.state.audioStatus === "reconnecting";
    if (!resumingReconnect) {
      this.state.audioStatus = "starting";
    }
    this.sendAudioStatus(
      this.state.audioStatus,
      resumingReconnect ? "Retrying STT connection now." : "Starting audio.",
      true,
    );
    try {
      await this.sttAdapter.start(sttStartOptionsForLanguage(this.settings.language));
      if (
        this.state.conversationStatus !== "active"
        || (this.state.audioStatus !== "starting" && this.state.audioStatus !== "reconnecting")
      ) return;
      this.state.audioStatus = "listening";
      this.sendAudioStatus("listening", "Listening.", true);
    } catch (error) {
      if (
        this.state.conversationStatus !== "active"
        || this.state.audioStatus === "stopped"
        || this.state.audioStatus === "reconnecting"
      ) return;
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

  private handleSttConnectionState(event: EvenHubSttConnectionEvent): void {
    const activeConversation = this.state.conversationStatus === "active";
    if (event.status === "reconnecting") {
      if (activeConversation && this.state.audioStatus !== "stopped") {
        this.state.audioStatus = "reconnecting";
        this.sendAudioStatus("reconnecting", event.detail, true);
      }
    } else if (event.status === "connected") {
      if (activeConversation && this.state.audioStatus !== "stopped") {
        this.state.audioStatus = "listening";
        this.sendAudioStatus("listening", event.detail, true);
      }
    } else if (event.status === "failed") {
      if (activeConversation && this.state.audioStatus !== "stopped") {
        this.state.audioStatus = "failed";
        this.sendAudioStatus("failed", event.detail, true);
      }
    } else if (event.status === "stopped") {
      if (this.state.audioStatus !== "failed") {
        this.state.audioStatus = "stopped";
        this.sendAudioStatus("stopped", event.detail, true);
      }
    } else if (event.status === "connecting") {
      if (activeConversation && this.state.audioStatus !== "stopped") {
        this.state.audioStatus = this.state.audioStatus === "reconnecting" ? "reconnecting" : "starting";
        this.sendAudioStatus(this.state.audioStatus, event.detail, true);
      }
    }

    console.info(
      `[EvenHubV2] stt_connection provider=${event.provider} status=${event.status}`
      + ` conv=${this.conversationId || "-"} attempt=${event.attempt ?? "-"}`
      + ` retryMs=${event.retryInMs ?? "-"} code=${event.code ?? "-"}`
      + ` queuedBytes=${event.queuedAudioBytes ?? 0}`
      + ` droppedBytes=${event.droppedAudioBytes ?? 0}`
      + ` droppedChunks=${event.droppedAudioChunks ?? 0}`,
    );
  }

  private handleAudioDiagnostics(payload: Extract<EvenHubV2ClientMessage, { type: "audio_diagnostics" }>["payload"]): void {
    if (!payload) return;
    const sourceCounts = payload.sourceCounts || {};
    this.clientAudioDiagnostics = {
      selectedSource: payload.selectedSource || this.clientAudioDiagnostics.selectedSource,
      chunkCount: typeof payload.chunkCount === "number" ? payload.chunkCount : this.clientAudioDiagnostics.chunkCount,
      byteCount: typeof payload.byteCount === "number" ? payload.byteCount : this.clientAudioDiagnostics.byteCount,
      sourceCounts: {
        phone: sourceCounts.phone ?? this.clientAudioDiagnostics.sourceCounts?.phone ?? 0,
        glasses: sourceCounts.glasses ?? this.clientAudioDiagnostics.sourceCounts?.glasses ?? 0,
        unknown: sourceCounts.unknown ?? this.clientAudioDiagnostics.sourceCounts?.unknown ?? 0,
      },
      mismatchCount: typeof payload.mismatchCount === "number" ? payload.mismatchCount : this.clientAudioDiagnostics.mismatchCount,
    };
  }

  private handleGlassDiagnostic(
    message: Extract<EvenHubV2ClientMessage, { type: "glass_diagnostic" }>,
  ): void {
    console.info(`[EvenHubV2] glass_diagnostic ${JSON.stringify({
      clientSessionId: this.clientSessionId,
      conversationId: this.conversationId,
      messageId: message.messageId,
      requestId: message.requestId,
      clientSeq: message.clientSeq,
      clientTimestamp: message.timestamp,
      ...message.payload,
    })}`);
  }

  private updateAudioStats(stats: Linear16AudioStats): void {
    this.audioRmsTotal += stats.rms;
    this.audioMinRms = this.audioMinRms === null ? stats.rms : Math.min(this.audioMinRms, stats.rms);
    this.audioMaxRms = Math.max(this.audioMaxRms, stats.rms);
    this.audioPeak = Math.max(this.audioPeak, stats.peak);
    this.audioZeroRatioTotal += stats.zeroRatio;
    this.audioMaxClippedRatio = Math.max(this.audioMaxClippedRatio, stats.clippedRatio);
    if (stats.rms > 0 && stats.rms < LOW_RMS_THRESHOLD) {
      this.lowRmsChunkCount += 1;
    }
  }

  private audioStatsSummary(): AudioStatsSummary {
    const chunkCount = this.audioChunksReceived;
    const diagnostics = this.clientAudioDiagnostics;
    return {
      chunkCount,
      byteCount: this.audioBytesReceived,
      avgRms: chunkCount ? Math.round(this.audioRmsTotal / chunkCount) : 0,
      minRms: this.audioMinRms ?? 0,
      maxRms: this.audioMaxRms,
      peak: this.audioPeak,
      avgZeroRatio: chunkCount ? Number((this.audioZeroRatioTotal / chunkCount).toFixed(3)) : 0,
      maxClippedRatio: this.audioMaxClippedRatio,
      lowRmsChunkCount: this.lowRmsChunkCount,
      selectedSource: diagnostics.selectedSource || this.audioSource,
      clientChunkCount: diagnostics.chunkCount,
      clientByteCount: diagnostics.byteCount,
      clientSourceCounts: diagnostics.sourceCounts,
      clientMismatchCount: diagnostics.mismatchCount,
    };
  }

  private handlePartialTranscript(event: EvenHubTranscriptEvent): void {
    const normalized = normalizeText(event.text);
    if (!normalized || this.state.conversationStatus !== "active") return;
    const providerTurnChanged = Boolean(
      this.liveTurn
      && event.turnOrder !== undefined
      && this.liveTurn.providerTurnOrder !== undefined
      && event.turnOrder !== this.liveTurn.providerTurnOrder,
    );
    if (!this.liveTurn || providerTurnChanged) {
      this.liveTurn = {
        id: makeEvenHubV2Id("turn"),
        revision: 0,
        text: normalized,
        updatedAt: Date.now(),
        providerTurnOrder: event.turnOrder,
      };
      this.pendingSpeculativeRequest = null;
      this.speculativeTurnBudget = null;
    } else if (!sameSpokenText(this.liveTurn.text, normalized)) {
      this.liveTurn = {
        ...this.liveTurn,
        revision: this.liveTurn.revision + 1,
        text: normalized,
        updatedAt: Date.now(),
        providerTurnOrder: event.turnOrder ?? this.liveTurn.providerTurnOrder,
      };
    } else {
      this.liveTurn.updatedAt = Date.now();
      this.liveTurn.providerTurnOrder = event.turnOrder ?? this.liveTurn.providerTurnOrder;
    }
    this.lastPartialText = normalized;
    this.sendMessage("transcript_partial", {
      text: normalized,
      offsetMs: this.currentOffsetMs(),
    });
    if (isLikelyCueReadback(normalized, this.lastDisplayedCueOutput)) {
      this.clearPartialCommitTimer();
      this.pendingSpeculativeRequest = null;
      return;
    }

    const utterance = normalizeText(event.utterance || "");
    if (utterance) {
      this.clearPartialCommitTimer();
      void this.startSpeculativeCue(this.liveTurn, "utterance", hashText(utterance));
      return;
    }
    this.schedulePartialCommit();
  }

  private async commitFinalTranscript(text: string, source: string): Promise<EvenHubV2TranscriptLineRecord | null> {
    const normalized = normalizeText(text);
    const canCommit = this.state.conversationStatus === "active" || this.state.conversationStatus === "ending";
    if (!normalized || !canCommit || !this.conversationId) {
      return null;
    }

    const hadLiveTurn = Boolean(this.liveTurn);
    if (!hadLiveTurn && normalized === this.lastFinalText) return null;
    const liveTurn = this.liveTurn || {
      id: makeEvenHubV2Id("turn"),
      revision: 0,
      text: normalized,
      updatedAt: Date.now(),
    };
    const finalRevision = sameSpokenText(liveTurn.text, normalized)
      ? liveTurn.revision
      : liveTurn.revision + 1;
    const finalTurn = {
      ...liveTurn,
      revision: finalRevision,
      text: normalized,
      updatedAt: Date.now(),
    };
    this.clearPartialCommitTimer();

    const receivedAt = new Date().toISOString();
    const line = this.store.addTranscriptLine({
      id: makeEvenHubV2Id("line"),
      conversationId: this.conversationId,
      userId: this.userId,
      lineIndex: this.transcriptLines.length,
      text: normalized,
      receivedAt,
      source,
    });
    this.transcriptLines.push(line);
    this.lastFinalText = normalized;
    this.lastPartialText = "";
    this.liveTurn = null;
    this.pendingSpeculativeRequest = null;
    this.speculativeTurnBudget = null;
    this.finalSavedCount += 1;
    this.logTranscriptProgress("saved_final", normalized, source);
    if (this.state.conversationStatus === "active") {
      this.sendMessage("transcript_final", {
        lineId: line.id,
        index: line.lineIndex,
        text: line.text,
        receivedAt: line.receivedAt,
        offsetMs: this.offsetForIso(line.receivedAt),
      });

      const readback = isLikelyCueReadback(normalized, this.lastDisplayedCueOutput);
      const previousTurns = this.canonicalTurns.slice(-4);
      this.canonicalTurns.push({
        lineId: line.id,
        text: normalized,
        role: readback ? "xiang_readback" : "unknown",
      });

      this.completedSpeculativeRevisions.delete(finalTurn.id);
      const alreadyPublishedSpeculative = this.publishedSpeculativeTurnIds.delete(finalTurn.id);
      if (readback) {
        this.writeSkippedAttempt("cue_readback", [{ turnId: finalTurn.id, revision: finalTurn.revision, line, previousTurns }]);
        return line;
      }

      if (alreadyPublishedSpeculative) {
        return line;
      }

      const activeSpeculationMatches = Boolean(
        this.currentAutoJobInput?.speculative
        && this.currentAutoJobInput.questionId === finalTurn.id
        && sameSpokenText(this.currentAutoJobInput.triggerWindow, normalized),
      );
      if (activeSpeculationMatches) {
        this.finalizedTurns.set(finalTurn.id, {
          revision: finalTurn.revision,
          text: normalized,
          lineId: line.id,
        });
      } else {
        this.preemptRevisedSpeculative(finalTurn.id);
        this.candidateBuffer.push({
          turnId: finalTurn.id,
          revision: finalTurn.revision,
          line,
          previousTurns,
        });
        this.scheduleCueFlush();
      }
    }
    return line;
  }

  private async handleSttTranscript(event: EvenHubTranscriptEvent): Promise<void> {
    if (event.isFinal) {
      this.sttFinalCount += 1;
      this.clearPartialCommitTimer();
      this.lastPartialText = "";
      this.logTranscriptProgress("stt_final", event.text, this.sttProvider);
      await this.commitFinalTranscript(event.text, this.sttProvider);
      return;
    }
    this.sttPartialCount += 1;
    this.logTranscriptProgress("stt_partial", event.text, this.sttProvider);
    this.handlePartialTranscript(event);
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

    const candidate = this.candidateBuffer.shift()!;
    const triggerWindow = candidate.line.text;
    const inputHash = hashText(triggerWindow);
    if (this.generatedTranscriptHashes.has(inputHash)) {
      this.writeSkippedAttempt("duplicate_transcript_hash", [candidate], triggerWindow, inputHash);
      return;
    }
    this.generatedTranscriptHashes.add(inputHash);

    await this.startAutoCueJob({
      attemptId: makeEvenHubV2Id("attempt"),
      requestId: makeEvenHubV2Id("auto_req"),
      questionId: candidate.turnId,
      sourceRevision: candidate.revision,
      triggerWindow,
      inputHash,
      sourceTranscriptLineIds: [candidate.line.id],
      previousTurns: candidate.previousTurns,
      startedAt: Date.now(),
      speculative: false,
    });
  }

  private async startSpeculativeCue(
    turn: LiveTranscriptTurn,
    trigger: SpeculativeTrigger,
    utteranceHash?: string,
  ): Promise<void> {
    if (!this.conversationId || this.state.conversationStatus !== "active") return;
    if (this.publishedSpeculativeTurnIds.has(turn.id)) return;
    if (isLikelyCueReadback(turn.text, this.lastDisplayedCueOutput)) return;

    const budget = this.getSpeculativeTurnBudget(turn);
    if (trigger === "utterance" && utteranceHash && budget.utteranceHashes.has(utteranceHash)) return;
    if (budget.attemptsStarted >= this.speculativeHardBudget) {
      const endpointGraceExpired = budget.forceEndpointRequestedAt !== undefined
        && Date.now() - budget.forceEndpointRequestedAt >= this.speculativeEndpointGraceMs;
      if (trigger === "utterance" && endpointGraceExpired) {
        budget.attemptsStarted = this.speculativeHardBudget - 1;
        budget.forceEndpointRequested = false;
        budget.forceEndpointRequestedAt = undefined;
        budget.recoveryCount += 1;
      } else {
        this.requestForcedEndpoint(budget);
        return;
      }
    }
    if (trigger === "partial_watchdog" && budget.attemptsStarted >= this.speculativeSoftBudget) return;
    if (this.currentAutoJob) {
      this.mergePendingSpeculativeRequest({
        turn: { ...turn },
        trigger,
        utteranceHash,
      });
      return;
    }
    if (this.completedSpeculativeRevisions.get(turn.id) === turn.revision) return;
    if (this.pendingSpeculativeRequest?.turn.id === turn.id) {
      this.pendingSpeculativeRequest = null;
    }
    budget.attemptsStarted += 1;
    budget.totalAttemptsStarted += 1;
    if (trigger === "utterance" && utteranceHash) {
      budget.utteranceHashes.add(utteranceHash);
    }
    const attemptOrdinal = budget.totalAttemptsStarted;
    const triggerWindow = turn.text;
    const job = this.startAutoCueJob({
      attemptId: makeEvenHubV2Id("attempt"),
      requestId: makeEvenHubV2Id("auto_req"),
      questionId: turn.id,
      sourceRevision: turn.revision,
      triggerWindow,
      inputHash: hashText(triggerWindow),
      sourceTranscriptLineIds: [],
      previousTurns: this.canonicalTurns.slice(-4),
      startedAt: Date.now(),
      speculative: true,
      speculativeTrigger: trigger,
      speculativeAttemptOrdinal: attemptOrdinal,
      providerTurnOrder: turn.providerTurnOrder,
      speculativeRecoveryCount: budget.recoveryCount,
    });
    if (budget.attemptsStarted >= this.speculativeHardBudget) {
      this.requestForcedEndpoint(budget);
    }
    await job;
  }

  private getSpeculativeTurnBudget(turn: LiveTranscriptTurn): SpeculativeTurnBudget {
    if (!this.speculativeTurnBudget || this.speculativeTurnBudget.turnId !== turn.id) {
      this.speculativeTurnBudget = {
        turnId: turn.id,
        providerTurnOrder: turn.providerTurnOrder,
        attemptsStarted: 0,
        totalAttemptsStarted: 0,
        utteranceHashes: new Set(),
        forceEndpointRequested: false,
        recoveryCount: 0,
      };
    }
    return this.speculativeTurnBudget;
  }

  private mergePendingSpeculativeRequest(next: PendingSpeculativeRequest): void {
    const current = this.pendingSpeculativeRequest;
    if (!current || current.turn.id !== next.turn.id) {
      this.pendingSpeculativeRequest = next;
      return;
    }
    this.pendingSpeculativeRequest = {
      turn: next.turn.updatedAt >= current.turn.updatedAt ? next.turn : current.turn,
      trigger: current.trigger === "utterance" || next.trigger === "utterance"
        ? "utterance"
        : "partial_watchdog",
      utteranceHash: next.utteranceHash || current.utteranceHash,
    };
  }

  private requestForcedEndpoint(budget: SpeculativeTurnBudget): void {
    if (budget.forceEndpointRequested) return;
    budget.forceEndpointRequested = true;
    budget.forceEndpointRequestedAt = Date.now();
    let sent = false;
    try {
      sent = this.sttAdapter?.forceEndpoint?.() === true;
    } catch (error) {
      console.warn(`[EvenHubV2] speculative ForceEndpoint failed conv=${this.conversationId || "-"} turn=${budget.turnId} error=${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    console.info(`[EvenHubV2] speculative ForceEndpoint requested conv=${this.conversationId || "-"} turn=${budget.turnId} providerTurn=${budget.providerTurnOrder ?? "-"} attempts=${budget.attemptsStarted} sent=${sent}`);
  }

  private async startAutoCueJob(input: CueJobInput): Promise<void> {
    const abortController = new AbortController();
    this.state.activeAutoJobs.set(input.requestId, "running");
    this.currentAutoJobInput = input;
    this.currentAutoJobAbortController = abortController;
    const job = this.runAutoCueJob(input, abortController.signal).finally(() => {
      this.state.activeAutoJobs.delete(input.requestId);
      this.preemptedAutoJobReasons.delete(input.requestId);
      if (this.currentAutoJobInput?.requestId !== input.requestId) return;
      this.currentAutoJobInput = null;
      this.currentAutoJobAbortController = null;
      this.currentAutoJob = null;
      const pendingSpeculation = this.pendingSpeculativeRequest;
      this.pendingSpeculativeRequest = null;
      if (this.pendingFlush || this.candidateBuffer.length) {
        this.pendingFlush = false;
        this.scheduleCueFlush();
      } else if (
        pendingSpeculation
        && this.liveTurn?.id === pendingSpeculation.turn.id
      ) {
        this.pendingSpeculativeRequest = {
          ...pendingSpeculation,
          turn: { ...this.liveTurn },
        };
        this.schedulePartialCommit();
      }
    });
    this.currentAutoJob = job;
    await job;
  }

  private preemptRevisedSpeculative(questionId: string): void {
    const input = this.currentAutoJobInput;
    if (!input?.speculative || input.questionId !== questionId) return;

    this.preemptedAutoJobReasons.set(input.requestId, "final_preempted");
    this.currentAutoJobAbortController?.abort();
    this.currentAutoJobInput = null;
    this.currentAutoJobAbortController = null;
    this.currentAutoJob = null;
    if (this.pendingSpeculativeRequest?.turn.id === questionId) {
      this.pendingSpeculativeRequest = null;
    }
  }

  private recentCanonicalContext(
    turns: Array<{ lineId: string; text: string; role: "unknown" | "xiang_readback" }>,
  ): string {
    return turns
      .map((turn) => `${turn.role === "xiang_readback" ? "Xiang answer" : "Conversation turn"}: ${turn.text}`)
      .join("\n");
  }

  private cueJobTrace(input: CueJobInput): Record<string, unknown> {
    return {
      speculative: input.speculative,
      ...(input.speculative ? {
        speculativeTrigger: input.speculativeTrigger,
        speculativeAttemptOrdinal: input.speculativeAttemptOrdinal,
        providerTurnOrder: input.providerTurnOrder,
        speculativeRecoveryCount: input.speculativeRecoveryCount,
        speculativeSoftBudget: this.speculativeSoftBudget,
        speculativeHardBudget: this.speculativeHardBudget,
      } : {}),
    };
  }

  private async runAutoCueJob(input: CueJobInput, signal: AbortSignal): Promise<void> {
    if (!this.conversationId) return;
    const recentTranscript = this.recentCanonicalContext(input.previousTurns);
    const routerLines = [
      ...input.previousTurns
        .slice(-2)
        .map((turn) => turn.text),
      input.triggerWindow,
    ].slice(-3);
    const routerPromise = (async (): Promise<{
      router: CueOpportunityRouterResult | null;
      routerError: string;
    }> => {
      if (!this.cueOpportunityRouter) return { router: null, routerError: "" };
      try {
        return {
          router: await this.cueOpportunityRouter.predict({
            segmentMinus2: routerLines.at(-3) || "",
            segmentMinus1: routerLines.at(-2) || "",
            current: routerLines.at(-1) || "",
          }),
          routerError: "",
        };
      } catch (error) {
        const routerError = error instanceof Error ? error.message : String(error);
        console.warn(`[EvenHubV2] cue router failed open: ${routerError}`);
        return { router: null, routerError };
      }
    })();
    const contextStartedAt = Date.now();
    const contextPromise = this.contextAdapter.build({
      userId: this.userId,
      conversationId: this.conversationId,
      currentQuestion: input.triggerWindow,
      triggerWindow: input.triggerWindow,
      recentTranscript,
      selectedPrenoteIds: this.selectedPrenoteIds,
      selectedPrenoteText: this.selectedPrenoteText,
      settings: this.settings,
    }).then((context) => ({
      context,
      contextLatencyMs: Date.now() - contextStartedAt,
    }));
    const providerLifecycle = this.providerLifecycle?.localConversationId === this.conversationId
      ? this.providerLifecycle
      : null;
    const providerSessionPromise = (async () => {
      if (input.speculative) return providerLifecycle?.session || null;
      if (providerLifecycle) await providerLifecycle.commitChain.catch(() => undefined);
      return await providerLifecycle?.sessionPromise.catch(() => null) || null;
    })();
    const [routerOutcome, contextOutcome, providerSession] = await Promise.all([
      routerPromise,
      contextPromise,
      providerSessionPromise,
    ]);
    const { router, routerError } = routerOutcome;
    const { context, contextLatencyMs } = contextOutcome;

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
        ...this.cueJobTrace(input),
        memoryUsedIds: context.memoryUsedIds,
        interviewAnswerCardIds: context.interviewAnswerCardIds,
        answerPolicyCardIds: context.answerPolicyCardIds,
        prenoteUsedIds: context.prenoteUsedIds,
        contextLatencyMs,
        router,
        routerError,
      },
    });

    let result: AutoCueGenerationResult;
    try {
      result = await this.autoCueGenerator.generate({
        triggerWindow: input.triggerWindow,
        recentTranscript,
        contextSnapshot: context.contextSnapshot,
        settings: this.settings,
        router,
        session: providerSession,
        speculative: input.speculative,
        signal,
      });
    } catch (error) {
      const preemptedReason = this.preemptedAutoJobReasons.get(input.requestId);
      this.store.updateAutoCueAttempt(input.attemptId, {
        status: preemptedReason || signal.aborted ? "stale" : "failed",
        latencyMs: Date.now() - input.startedAt,
        skippedReason: preemptedReason || (signal.aborted ? "generator_aborted" : "generator_error"),
        trace: {
          ...this.cueJobTrace(input),
          error: error instanceof Error ? error.message : String(error),
          memoryUsedIds: context.memoryUsedIds,
          interviewAnswerCardIds: context.interviewAnswerCardIds,
          answerPolicyCardIds: context.answerPolicyCardIds,
          prenoteUsedIds: context.prenoteUsedIds,
          contextLatencyMs,
          router,
          routerError,
        },
      });
      return;
    }

    const cue = normalizeAutoCueOutput(result.data);
    const draft: GeneratedCueDraft = {
      input,
      result: { ...result, data: cue },
      context,
      contextLatencyMs,
      router,
      routerError,
    };
    const preemptedReason = this.preemptedAutoJobReasons.get(input.requestId);
    if (preemptedReason || signal.aborted) {
      this.markDraftStale(draft, preemptedReason || "generator_aborted");
      return;
    }
    if (input.speculative) {
      this.completedSpeculativeRevisions.set(input.questionId, input.sourceRevision);
    }
    if (!input.speculative) {
      this.publishGeneratedDraft(draft, input.sourceTranscriptLineIds);
      return;
    }

    const finalized = this.finalizedTurns.get(input.questionId);
    if (finalized) {
      if (sameSpokenText(input.triggerWindow, finalized.text)) {
        this.publishGeneratedDraft(draft, [finalized.lineId]);
      } else {
        this.markDraftStale(draft, "final_revised");
      }
      this.finalizedTurns.delete(input.questionId);
      return;
    }

    if (
      this.liveTurn?.id === input.questionId
      && this.liveTurn.revision === input.sourceRevision
      && sameSpokenText(this.liveTurn.text, input.triggerWindow)
    ) {
      const storedCue = this.publishGeneratedDraft(draft, []);
      if (storedCue) this.publishedSpeculativeTurnIds.add(input.questionId);
      return;
    }

    this.markDraftStale(draft, "partial_revised");
  }

  private publishGeneratedDraft(draft: GeneratedCueDraft, sourceTranscriptLineIds: string[]): EvenHubV2CueRecord | null {
    const cue = normalizeAutoCueOutput(draft.result.data);
    const outputHash = hashText(cue.output);
    const displayDecision = shouldDisplayAutoCue({
      cue,
      previousOutputHash: this.lastDisplayedCueOutputHash,
      outputHash,
      conversationActive: this.state.conversationStatus === "active",
    });
    if (!displayDecision.ok || !this.conversationId) {
      this.store.updateAutoCueAttempt(draft.input.attemptId, {
        status: this.state.conversationStatus === "active" ? "skipped" : "stale",
        category: cue.category,
        confidence: cue.confidence,
        title: cue.title,
        g2Title: cue.g2Title,
        output: cue.output,
        reason: cue.reason,
        rawOutput: draft.result.rawText,
        model: draft.result.model,
        latencyMs: Date.now() - draft.input.startedAt,
        skippedReason: displayDecision.ok ? "conversation_missing" : displayDecision.reason,
        trace: {
          ...this.cueJobTrace(draft.input),
          memoryUsedIds: draft.context.memoryUsedIds,
          interviewAnswerCardIds: draft.context.interviewAnswerCardIds,
          answerPolicyCardIds: draft.context.answerPolicyCardIds,
          prenoteUsedIds: draft.context.prenoteUsedIds,
          contextLatencyMs: draft.contextLatencyMs,
          router: draft.router,
          routerError: draft.routerError,
          generationLane: draft.result.lane,
        },
      });
      return null;
    }

    const storedCue = this.store.createCue({
      id: makeEvenHubV2Id("cue"),
      conversationId: this.conversationId,
      userId: this.userId,
      attemptId: draft.input.attemptId,
      category: cue.category as Exclude<typeof cue.category, "none">,
      title: cue.title,
      g2Title: cue.g2Title,
      preview: cue.preview,
      output: cue.output,
      language: cue.language,
      code: cue.code,
      explanation: "",
      sourceTranscriptLineIds,
      createdAt: new Date().toISOString(),
    });
    this.lastDisplayedCueOutputHash = outputHash;
    this.lastDisplayedCueOutput = cue.output;
    this.store.updateAutoCueAttempt(draft.input.attemptId, {
      status: "created",
      category: cue.category,
      confidence: cue.confidence,
      title: cue.title,
      g2Title: cue.g2Title,
      output: cue.output,
      reason: cue.reason,
      rawOutput: draft.result.rawText,
      model: draft.result.model,
      latencyMs: Date.now() - draft.input.startedAt,
      trace: {
        cueId: storedCue.id,
        ...this.cueJobTrace(draft.input),
        memoryUsedIds: draft.context.memoryUsedIds,
        interviewAnswerCardIds: draft.context.interviewAnswerCardIds,
        answerPolicyCardIds: draft.context.answerPolicyCardIds,
        prenoteUsedIds: draft.context.prenoteUsedIds,
        contextLatencyMs: draft.contextLatencyMs,
        router: draft.router,
        routerError: draft.routerError,
        generationLane: draft.result.lane,
      },
    });
    this.sendCueCreated(storedCue);
    if (draft.input.speculative || draft.result.lane === "stateless_fallback") {
      this.queueCanonicalTurnCommit(draft);
    }
    return storedCue;
  }

  private markDraftStale(draft: GeneratedCueDraft, reason: string): void {
    const cue = normalizeAutoCueOutput(draft.result.data);
    this.store.updateAutoCueAttempt(draft.input.attemptId, {
      status: "stale",
      category: cue.category,
      confidence: cue.confidence,
      title: cue.title,
      g2Title: cue.g2Title,
      output: cue.output,
      reason: cue.reason,
      rawOutput: draft.result.rawText,
      model: draft.result.model,
      latencyMs: Date.now() - draft.input.startedAt,
      skippedReason: reason,
      trace: {
        ...this.cueJobTrace(draft.input),
        memoryUsedIds: draft.context.memoryUsedIds,
        interviewAnswerCardIds: draft.context.interviewAnswerCardIds,
        answerPolicyCardIds: draft.context.answerPolicyCardIds,
        prenoteUsedIds: draft.context.prenoteUsedIds,
        contextLatencyMs: draft.contextLatencyMs,
        router: draft.router,
        routerError: draft.routerError,
        generationLane: draft.result.lane,
      },
    });
  }

  private beginAutoCueProviderSession(localConversationId: string): void {
    if (!this.autoCueGenerator.startSession) {
      this.providerLifecycle = null;
      return;
    }

    this.store.updateOpenAiConversationState({
      conversationId: localConversationId,
      status: "creating",
    });
    const lifecycle: AutoCueProviderLifecycle = {
      localConversationId,
      session: null,
      sessionPromise: Promise.resolve(null),
      commitChain: Promise.resolve(),
    };
    lifecycle.sessionPromise = this.autoCueGenerator.startSession({
      localConversationId,
      userId: this.userId,
      selectedPrenoteIds: [...this.selectedPrenoteIds],
      selectedPrenoteText: this.selectedPrenoteText,
    }).then((session) => {
      lifecycle.session = session;
      if (session) {
        this.store.updateOpenAiConversationState({
          conversationId: localConversationId,
          providerConversationId: session.providerConversationId,
          status: "active",
          promptVersion: session.promptVersion,
          interviewGuideVersion: session.interviewGuideVersion,
        });
      } else {
        this.store.updateOpenAiConversationState({
          conversationId: localConversationId,
          status: "failed",
        });
      }
      return session;
    }).catch((error) => {
      console.warn(`[EvenHubV2] OpenAI conversation create failed open: ${error instanceof Error ? error.message : String(error)}`);
      this.store.updateOpenAiConversationState({
        conversationId: localConversationId,
        status: "failed",
      });
      return null;
    });
    this.providerLifecycle = lifecycle;
  }

  private queueCanonicalTurnCommit(draft: GeneratedCueDraft): void {
    const lifecycle = this.providerLifecycle;
    if (
      !lifecycle
      || lifecycle.localConversationId !== this.conversationId
      || !this.autoCueGenerator.commitCanonicalTurn
    ) return;

    lifecycle.commitChain = lifecycle.commitChain
      .catch(() => undefined)
      .then(async () => {
        const session = lifecycle.session || await lifecycle.sessionPromise;
        if (!session) return;
        await this.autoCueGenerator.commitCanonicalTurn!({
          session,
          question: draft.input.triggerWindow,
          result: draft.result,
        });
      })
      .catch((error) => {
        console.warn(`[EvenHubV2] canonical cue commit failed open: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private async cleanupAutoCueProviderSession(
    lifecycle: AutoCueProviderLifecycle,
    activeJob: Promise<void> | null,
  ): Promise<void> {
    await activeJob?.catch(() => undefined);
    await lifecycle.commitChain.catch(() => undefined);
    const session = lifecycle.session || await lifecycle.sessionPromise.catch(() => null);
    if (!session || !this.autoCueGenerator.endSession) return;

    this.store.updateOpenAiConversationState({
      conversationId: lifecycle.localConversationId,
      status: "deleting",
    });
    try {
      await this.autoCueGenerator.endSession(session);
      this.store.updateOpenAiConversationState({
        conversationId: lifecycle.localConversationId,
        status: "deleted",
      });
    } catch (error) {
      console.warn(`[EvenHubV2] OpenAI conversation delete failed: ${error instanceof Error ? error.message : String(error)}`);
      this.store.updateOpenAiConversationState({
        conversationId: lifecycle.localConversationId,
        status: "failed",
      });
    }
  }

  private writeSkippedAttempt(
    reason: string,
    lines: FinalCueCandidate[] = this.candidateBuffer.splice(0),
    triggerWindow = lines.map((candidate) => candidate.line.text).join("\n"),
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
      sourceTranscriptLineIds: lines.map((candidate) => candidate.line.id),
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
    const endedAt = new Date().toISOString();
    const conversationId = this.conversationId;
    const providerLifecycle = this.providerLifecycle?.localConversationId === conversationId
      ? this.providerLifecycle
      : null;
    const activeAutoJob = this.currentAutoJob;
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
    this.providerLifecycle = null;
    this.candidateBuffer = [];
    this.liveTurn = null;
    this.completedSpeculativeRevisions.clear();
    this.publishedSpeculativeTurnIds.clear();
    this.finalizedTurns.clear();
    this.currentAutoJobInput = null;
    this.pendingSpeculativeRequest = null;
    this.speculativeTurnBudget = null;
    this.clearPartialCommitTimer();
    const audioStats = this.audioStatsSummary();
    console.info(`[EvenHubV2] conversation ended id=${conversationId} chunks=${this.audioChunksReceived} bytes=${this.audioBytesReceived} partials=${this.sttPartialCount} finals=${this.sttFinalCount} saved=${this.finalSavedCount} audio=${JSON.stringify(audioStats)}`);
    this.sendMessage("conversation_saved", {
      conversationId,
      transcriptCount: this.transcriptLines.length,
      cueCount: this.store.listCues(conversationId).length,
      endedAt,
      audioStats,
    }, conversationId);
    this.summaryRunner.enqueue(conversationId);
    if (providerLifecycle) {
      void this.cleanupAutoCueProviderSession(providerLifecycle, activeAutoJob);
    }
  }

  private sendCueCreated(cue: EvenHubV2CueRecord): void {
    this.sendMessage("cue_created", {
      cueId: cue.id,
      attemptId: cue.attemptId,
      category: cue.category,
      title: cue.title,
      g2Title: cue.g2Title,
      preview: cue.preview,
      fullAnswer: cue.output,
      output: cue.output,
      language: cue.language,
      code: cue.code,
      explanation: "",
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
      audioSource: this.audioSource,
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
    if (!this.shouldCommitPartialTimeout(text)) {
      this.logTranscriptProgress("partial_timeout_skipped", text, "partial_timeout");
      return;
    }
    const turn = this.liveTurn;
    if (!turn || !sameSpokenText(turn.text, text)) return;
    const pending = this.pendingSpeculativeRequest?.turn.id === turn.id
      ? this.pendingSpeculativeRequest
      : null;
    this.pendingSpeculativeRequest = null;
    await this.startSpeculativeCue(
      turn,
      pending?.trigger || "partial_watchdog",
      pending?.utteranceHash,
    );
  }

  private shouldCommitPartialTimeout(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized || normalized === this.lastFinalText) return false;
    if (normalized.length < this.partialCommitMinChars) return false;
    if (/\s/.test(normalized)) {
      return normalized.split(/\s+/).filter(Boolean).length >= this.partialCommitMinWords;
    }
    return Array.from(normalized).length >= this.partialCommitMinChars;
  }

  private logAudioProgress(reason: string): void {
    if (this.audioChunksReceived <= 3 || this.audioChunksReceived % 50 === 0) {
      const stats = this.lastAudioStats;
      const statsText = stats
        ? ` samples=${stats.samples} rms=${stats.rms} peak=${stats.peak} zero=${stats.zeroRatio} clipped=${stats.clippedRatio}`
        : "";
      console.info(`[EvenHubV2] audio ${reason} conv=${this.conversationId || "-"} status=${this.state.audioStatus} source=${this.audioSource} chunks=${this.audioChunksReceived} bytes=${this.audioBytesReceived}${statsText}`);
    }
  }

  private logTranscriptProgress(event: string, text: string, source: string): void {
    const normalized = normalizeText(text);
    if (event === "stt_partial" && this.sttPartialCount > 3 && this.sttPartialCount % 20 !== 0) return;
    console.info(`[EvenHubV2] transcript ${event} conv=${this.conversationId || "-"} provider=${this.sttProvider} source=${source} partials=${this.sttPartialCount} finals=${this.sttFinalCount} saved=${this.finalSavedCount} len=${normalized.length} text=${JSON.stringify(normalized.slice(0, 120))}`);
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
