import type { AppSession } from "@mentra/sdk";
import { LocationManager } from "../manager/LocationManager";
import { MergeResponseHandler, type ManualActionResult, type ManualRuntimeState } from "../mastra/agents";
import type { PromptMode } from "../saynext/process-router";
import {
  defaultEvenHubSettings,
  normalizeEvenHubSettings,
  type EvenHubClientMessage,
  type EvenHubControlAction,
  type EvenHubRuntimeSettings,
  type EvenHubServerMessage,
} from "./protocol";
import {
  createEvenHubSttAdapter,
  type EvenHubSttAdapter,
  type EvenHubSttCallbacks,
} from "./stt";

type ManualHandlerLike = {
  processTranscript(text: string, timestamp: number, reason: "isFinal" | "timeout"): Promise<void>;
  generateManualAnswer(clientEventId?: string): Promise<ManualActionResult>;
  regenerateManualAnswer(clientEventId?: string): Promise<ManualActionResult>;
  pageManualAnswer(direction: "next" | "previous", clientEventId?: string): ManualActionResult;
  clearManualAnswer(clientEventId?: string): ManualActionResult;
  getManualState(): ManualRuntimeState;
  getRuntimeSessionId(): string;
  setManualPromptModeOverride?: (mode: PromptMode | null) => void;
  onStatus?: (event: { type: string; [key: string]: unknown }) => void;
  onInsight?: (insight: { text: string; timestamp: number; agentType: string; reasoning: string }) => void;
};

type RuntimeLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type DisplaySink = {
  showTextWall(text: string): void;
  clearView(): void;
};

type EvenHubRuntimeOptions = {
  userId: string;
  clientSessionId?: string;
  send: (message: EvenHubServerMessage) => void;
  manualHandler?: ManualHandlerLike;
  sttAdapterFactory?: (callbacks: EvenHubSttCallbacks) => EvenHubSttAdapter | null;
  settings?: Partial<EvenHubRuntimeSettings>;
};

const DEFAULT_USER_ID = "evenhub-user";
const PARTIAL_COMMIT_MS = Number(process.env.EVENHUB_STT_PARTIAL_COMMIT_MS || 1200);

function makeLogger(): RuntimeLogger {
  return {
    info: (message) => console.log(`[EvenHub] ${message}`),
    warn: (message) => console.warn(`[EvenHub] ${message}`),
    error: (message) => console.error(`[EvenHub] ${message}`),
  };
}

function createDisplaySink(send: (message: EvenHubServerMessage) => void, sessionIdRef: () => string): DisplaySink {
  return {
    showTextWall(text: string) {
      const normalized = text.trim();
      if (!normalized) return;
      if (/^generating/i.test(normalized)) {
        send({ type: "status", status: "generating", sessionId: sessionIdRef(), message: normalized });
        return;
      }
      if (/^(no new speech|no answer|listening)/i.test(normalized)) {
        send({ type: "status", status: "ready", sessionId: sessionIdRef(), message: normalized });
        return;
      }
      send({
        type: "answer_page",
        text: normalized,
        pageIndex: 0,
        totalPages: 1,
        sessionId: sessionIdRef(),
      });
    },
    clearView() {
      send({ type: "status", status: "cleared", sessionId: sessionIdRef(), message: "Cleared" });
    },
  };
}

function createMinimalAppSession(
  display: DisplaySink,
  logger: RuntimeLogger,
): AppSession {
  return {
    layouts: {
      showTextWall: (text: string) => display.showTextWall(text),
      clearView: () => display.clearView(),
    },
    logger,
  } as unknown as AppSession;
}

function createMergeManualHandler(
  userId: string,
  send: (message: EvenHubServerMessage) => void,
): ManualHandlerLike {
  let handler: MergeResponseHandler | null = null;
  const logger = makeLogger();
  const display = createDisplaySink(send, () => handler?.getRuntimeSessionId() || "");
  const session = createMinimalAppSession(display, logger);
  handler = new MergeResponseHandler(
    session,
    userId,
    new LocationManager(userId),
    "high",
    "english",
    "g2_manual",
  );
  return handler;
}

function promptModeForEvenHubScene(sceneMode: EvenHubRuntimeSettings["sceneMode"]): PromptMode | null {
  if (sceneMode === "auto") return null;
  if (sceneMode === "daily") return "casual";
  if (sceneMode === "discussion") return "general";
  if (sceneMode === "teleprompt") return "general";
  if (sceneMode === "classroom" || sceneMode === "interview") return sceneMode;
  return null;
}

function resultPage(result: ManualActionResult): Extract<EvenHubServerMessage, { type: "answer_page" }> | null {
  if (!result.answer) return null;
  return {
    type: "answer_page",
    text: result.answer.text,
    output: result.answer.output,
    pageIndex: result.answer.pageIndex,
    totalPages: result.answer.totalPages,
    sessionId: result.sessionId,
  };
}

export class EvenHubRuntime {
  private readonly userId: string;
  private readonly clientSessionId: string;
  private sendToClient: ((message: EvenHubServerMessage) => void) | null;
  private readonly manualHandler: ManualHandlerLike;
  private readonly sttAdapter: EvenHubSttAdapter | null;
  private settings: EvenHubRuntimeSettings;
  private audioBytesReceived = 0;
  private listening = false;
  private lastAudioStatusAt = 0;
  private lastTranscriptText = "";
  private lastCommittedTranscriptText = "";
  private lastPartialTranscriptText = "";
  private lastPartialTranscriptAt = 0;
  private partialCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAnswerPage: Extract<EvenHubServerMessage, { type: "answer_page" }> | null = null;
  private readonly logger = makeLogger();

  constructor(options: EvenHubRuntimeOptions) {
    this.userId = options.userId.trim() || DEFAULT_USER_ID;
    this.clientSessionId = options.clientSessionId?.trim() || `server-${Date.now().toString(36)}`;
    this.sendToClient = options.send;
    this.settings = normalizeEvenHubSettings(options.settings, defaultEvenHubSettings());
    this.manualHandler = options.manualHandler || createMergeManualHandler(this.userId, (message) => this.sendMessage(message));
    this.applySceneModeOverride();
    this.sttAdapter = (options.sttAdapterFactory || createEvenHubSttAdapter)({
      onTranscript: (event) => this.handleSttTranscript(event.text, event.isFinal),
      onStatus: (message) => this.sendMessage({ type: "status", status: "stt_status", sessionId: this.sessionId, clientSessionId: this.clientSessionId, message }),
      onError: (error) => this.sendMessage({
        type: "error",
        code: "stt_error",
        message: error.message,
        sessionId: this.sessionId,
      }),
    });
    this.manualHandler.onStatus = (event) => this.handleManualStatus(event);
    this.manualHandler.onInsight = (insight) => {
      this.sendMessage({
        type: "status",
        status: "insight",
        sessionId: this.sessionId,
        clientSessionId: this.clientSessionId,
        message: insight.text,
      });
    };
  }

  get sessionId(): string {
    return this.manualHandler.getRuntimeSessionId();
  }

  get clientSessionKey(): string {
    return this.clientSessionId;
  }

  attachClient(send: (message: EvenHubServerMessage) => void): void {
    this.sendToClient = send;
  }

  handleOpen(): void {
    this.logger.info(`runtime open user=${this.userId} clientSession=${this.clientSessionId} runtimeSession=${this.sessionId} hasPinnedAnswer=${Boolean(this.lastAnswerPage)}`);
    this.sendMessage({
      type: "status",
      status: "connected",
      sessionId: this.sessionId,
      clientSessionId: this.clientSessionId,
      settings: this.settings,
      message: "EvenHub connected",
    });
    if (this.lastTranscriptText) {
      this.sendMessage({ type: "transcript_final", text: this.lastTranscriptText, sessionId: this.sessionId });
    }
    if (this.lastAnswerPage) {
      this.sendMessage(this.lastAnswerPage);
      this.sendMessage({
        type: "answer_done",
        status: "resumed",
        sessionId: this.sessionId,
        stateVersion: this.manualHandler.getManualState().stateVersion,
      });
    }
  }

  async handleClientMessage(message: EvenHubClientMessage): Promise<void> {
    if (message.type === "hello") {
      this.settings = normalizeEvenHubSettings(message.settings, this.settings);
      this.applySceneModeOverride();
      this.sendMessage({
        type: "status",
        status: "ready",
        sessionId: this.sessionId,
        clientSessionId: this.clientSessionId,
        settings: this.settings,
        message: "Ready",
      });
      return;
    }

    if (message.type === "settings") {
      this.settings = normalizeEvenHubSettings(message.settings, this.settings);
      this.applySceneModeOverride();
      this.sendMessage({
        type: "status",
        status: "settings_updated",
        sessionId: this.sessionId,
        clientSessionId: this.clientSessionId,
        settings: this.settings,
      });
      return;
    }

    if (message.type === "debug_transcript") {
      this.logger.info(`debug transcript user=${this.userId} clientSession=${this.clientSessionId} len=${message.text.length} autoGenerate=${Boolean(message.autoGenerate)}`);
      await this.commitTranscript(message.text, message.isFinal === false ? "timeout" : "isFinal");
      if (message.autoGenerate) {
        await this.generate(message.clientEventId);
      }
      return;
    }

    await this.handleControl(message.action, message.clientEventId);
  }

  handleAudioChunk(chunk: Uint8Array): void {
    this.audioBytesReceived += chunk.byteLength;
    if (this.listening && this.sttAdapter) {
      this.sttAdapter.pushAudio(chunk);
      this.emitAudioStatus("Audio streaming to STT.");
      return;
    }
    const message = this.listening
      ? "Audio received; STT adapter not enabled yet."
      : "Audio received while not listening; STT idle.";
    this.emitAudioStatus(message, true);
  }

  async close(): Promise<void> {
    this.clearPartialCommitTimer();
    await this.sttAdapter?.close();
  }

  async detachClient(): Promise<void> {
    this.listening = false;
    this.clearPartialCommitTimer();
    await this.sttAdapter?.stop().catch(() => undefined);
    this.sendToClient = null;
  }

  private emitAudioStatus(message: string, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastAudioStatusAt < 1000) return;
    this.lastAudioStatusAt = now;
    this.sendMessage({
      type: "status",
      status: "audio_received",
      sessionId: this.sessionId,
      clientSessionId: this.clientSessionId,
      audioBytesReceived: this.audioBytesReceived,
      message,
    });
  }

  private async commitTranscript(text: string, reason: "isFinal" | "timeout"): Promise<void> {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized || normalized === this.lastCommittedTranscriptText) return;
    this.lastCommittedTranscriptText = normalized;
    this.lastTranscriptText = normalized;
    if (normalized === this.lastPartialTranscriptText) {
      this.lastPartialTranscriptText = "";
      this.lastPartialTranscriptAt = 0;
    }
    this.logger.info(`transcript commit user=${this.userId} clientSession=${this.clientSessionId} reason=${reason} len=${normalized.length}`);
    await this.manualHandler.processTranscript(normalized, Date.now(), reason);
    this.sendMessage({
      type: reason === "isFinal" ? "transcript_final" : "transcript_partial",
      text: normalized,
      sessionId: this.sessionId,
    });
  }

  private async handleControl(action: EvenHubControlAction, clientEventId?: string): Promise<void> {
    if (action === "start_listening") {
      this.listening = true;
      if (this.sttAdapter) {
        await this.sttAdapter.start();
      }
      this.sendMessage({
        type: "status",
        status: "listening",
        sessionId: this.sessionId,
        clientSessionId: this.clientSessionId,
        message: this.sttAdapter ? "Listening" : "Listening; STT adapter not configured.",
      });
      return;
    }
    if (action === "stop_listening") {
      this.listening = false;
      await this.commitPendingPartialTranscript();
      await this.sttAdapter?.stop();
      this.sendMessage({ type: "status", status: "ready", sessionId: this.sessionId, clientSessionId: this.clientSessionId, message: "Stopped" });
      return;
    }
    if (action === "generate") {
      await this.generate(clientEventId);
      return;
    }
    if (action === "regenerate") {
      await this.regenerate(clientEventId);
      return;
    }
    if (action === "page_next" || action === "page_previous") {
      this.page(action === "page_next" ? "next" : "previous", clientEventId);
      return;
    }
    if (action === "clear") {
      const result = this.manualHandler.clearManualAnswer(clientEventId);
      this.lastAnswerPage = null;
      this.sendMessage({ type: "answer_done", status: result.status, sessionId: result.sessionId, stateVersion: result.state.stateVersion });
    }
  }

  private async generate(clientEventId?: string): Promise<void> {
    await this.commitPendingPartialTranscript();
    const startedAt = Date.now();
    this.logger.info(`generate start user=${this.userId} clientSession=${this.clientSessionId} event=${clientEventId || "-"} mode=${this.settings.sceneMode}`);
    this.sendMessage({ type: "status", status: "generating", sessionId: this.sessionId, clientSessionId: this.clientSessionId, message: "Generating" });
    try {
      const result = await this.manualHandler.generateManualAnswer(clientEventId);
      this.logger.info(`generate done user=${this.userId} clientSession=${this.clientSessionId} event=${clientEventId || "-"} status=${result.status} hasAnswer=${Boolean(result.answer)} ms=${Date.now() - startedAt}`);
      this.emitManualResult(result);
    } catch (error) {
      this.logger.error(`generate error user=${this.userId} clientSession=${this.clientSessionId} event=${clientEventId || "-"} ms=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async regenerate(clientEventId?: string): Promise<void> {
    const startedAt = Date.now();
    this.logger.info(`regenerate start user=${this.userId} clientSession=${this.clientSessionId} event=${clientEventId || "-"} mode=${this.settings.sceneMode}`);
    this.sendMessage({ type: "status", status: "generating", sessionId: this.sessionId, clientSessionId: this.clientSessionId, message: "Regenerating" });
    try {
      const result = await this.manualHandler.regenerateManualAnswer(clientEventId);
      this.logger.info(`regenerate done user=${this.userId} clientSession=${this.clientSessionId} event=${clientEventId || "-"} status=${result.status} hasAnswer=${Boolean(result.answer)} ms=${Date.now() - startedAt}`);
      this.emitManualResult(result);
    } catch (error) {
      this.logger.error(`regenerate error user=${this.userId} clientSession=${this.clientSessionId} event=${clientEventId || "-"} ms=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private page(direction: "next" | "previous", clientEventId?: string): void {
    const result = this.manualHandler.pageManualAnswer(direction, clientEventId);
    this.emitManualResult(result);
  }

  private emitManualResult(result: ManualActionResult): void {
    const page = resultPage(result);
    if (page) {
      this.lastAnswerPage = page;
      this.sendMessage(page);
    }
    if (result.error) {
      this.sendMessage({
        type: "error",
        code: "manual_runtime_error",
        message: result.error,
        sessionId: result.sessionId || this.sessionId,
      });
    }
    this.sendMessage({
      type: "answer_done",
      status: result.status,
      sessionId: result.sessionId || this.sessionId,
      stateVersion: result.state.stateVersion,
    });
  }

  private handleManualStatus(event: { type: string; [key: string]: unknown }): void {
    if (event.type === "manual_generating") {
      this.sendMessage({ type: "status", status: "generating", sessionId: this.sessionId, clientSessionId: this.clientSessionId, message: "Generating" });
      return;
    }
    if (event.type === "manual_cleared") {
      this.lastAnswerPage = null;
      this.sendMessage({ type: "status", status: "cleared", sessionId: this.sessionId, clientSessionId: this.clientSessionId, message: "Cleared" });
      return;
    }
    if (event.type === "manual_status") {
      this.sendMessage({ type: "status", status: "transcript", sessionId: this.sessionId, clientSessionId: this.clientSessionId });
    }
  }

  private async handleSttTranscript(text: string, isFinal: boolean): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!isFinal) {
      this.lastPartialTranscriptText = trimmed;
      this.lastPartialTranscriptAt = Date.now();
      this.schedulePartialCommit();
      this.sendMessage({
        type: "transcript_partial",
        text: trimmed,
        sessionId: this.sessionId,
      });
      return;
    }
    this.clearPartialCommitTimer();
    await this.commitTranscript(trimmed, "isFinal");
  }

  private applySceneModeOverride(): void {
    this.manualHandler.setManualPromptModeOverride?.(promptModeForEvenHubScene(this.settings.sceneMode));
  }

  private sendMessage(message: EvenHubServerMessage): void {
    this.sendToClient?.(message);
  }

  private schedulePartialCommit(): void {
    this.clearPartialCommitTimer();
    if (!this.lastPartialTranscriptText) return;
    this.partialCommitTimer = setTimeout(() => {
      void this.commitPendingPartialTranscript();
    }, PARTIAL_COMMIT_MS);
  }

  private clearPartialCommitTimer(): void {
    if (!this.partialCommitTimer) return;
    clearTimeout(this.partialCommitTimer);
    this.partialCommitTimer = null;
  }

  private async commitPendingPartialTranscript(): Promise<void> {
    const text = this.lastPartialTranscriptText.trim();
    if (!text) return;
    this.clearPartialCommitTimer();
    this.lastPartialTranscriptText = "";
    this.lastPartialTranscriptAt = 0;
    await this.commitTranscript(text, "timeout");
  }
}

export function createEvenHubRuntime(options: Omit<EvenHubRuntimeOptions, "userId"> & { userId?: string }): EvenHubRuntime {
  return new EvenHubRuntime({
    ...options,
    userId: options.userId || DEFAULT_USER_ID,
  });
}
