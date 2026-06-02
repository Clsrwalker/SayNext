import { AppSession } from "@mentra/sdk";
import { InsightHistoryManager, type InsightEntry } from "../manager/InsightHistoryManager";
import { LocationManager } from "../manager/LocationManager";
import {
  MergeResponseHandler,
  type InteractionMode,
  type ManualActionResult,
  type ManualRuntimeState,
} from "../mastra/agents";
import type { OutputLanguage } from "../mastra/agents/initial-agent";
import { UTTERANCE_TIMEOUT_MS } from "../config";

const MAX_EVENT_QUEUE_SIZE = 100;
const SINGLE_TAP_DELAY_MS = 280;
const LOW_VALUE_UTTERANCE_PATTERN = /^(and|so|then|but|or|uh|um|erm|hmm|mm|ah|oh|okay|ok|right|yeah|yes|no|嗯|呃|啊|哦|噢|唔|然后|所以)[\s.,!?。！？]*$/i;

function isLowValueUtterance(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return LOW_VALUE_UTTERANCE_PATTERN.test(normalized);
}

function normalizeInteractionMode(value: unknown, fallback: InteractionMode = "g2_manual"): InteractionMode {
  if (value === "g1_auto" || value === "g2_manual") return value;
  return fallback;
}

function inactiveManualState(mode: InteractionMode, sessionId = ""): ManualRuntimeState {
  return {
    mode,
    sessionId,
    transcriptCount: 0,
    lastGeneratedCursor: null,
    pending: null,
    currentAnswer: null,
    stateVersion: 0,
  };
}

function inactiveManualResult(mode: InteractionMode, error = "No active session"): ManualActionResult {
  return {
    status: "error",
    sessionId: "",
    state: inactiveManualState(mode),
    error,
  };
}

/**
 * User — per-user state container.
 * Composes managers and the SayNext response handler.
 * Created on connect, destroyed after grace period.
 */
export class User {
  /** Active glasses connection, null when webview-only */
  appSession: AppSession | null = null;

  /** Location manager with reverse geocoding cache */
  location: LocationManager;

  /** In-memory insight history for webview display */
  insightHistory: InsightHistoryManager;

  /** SayNext AI response handler */
  private responseHandler: MergeResponseHandler | null = null;

  /** Transcription buffering state */
  private currentUtteranceBuffer: string = "";
  private utteranceTimer: NodeJS.Timeout | null = null;
  private pendingSingleTapTimer: NodeJS.Timeout | null = null;
  private lastProcessedUtterance: string = "";
  private lastProcessedAt: number = 0;
  private lastProcessedReason: 'isFinal' | 'timeout' | null = null;

  /** SSE clients for broadcasting events */
  private sseClients: Set<(data: string) => void> = new Set();

  /** Event queue for events that arrive before SSE connects */
  private eventQueue: any[] = [];

  /** Event listener unsubscribers for cleanup */
  private eventUnsubscribers: (() => void)[] = [];

  constructor(public readonly userId: string) {
    this.insightHistory = new InsightHistoryManager();
    this.location = new LocationManager(userId);
  }

  /** Wire up the onInsight callback */
  private wireInsightCallback(): void {
    if (!this.responseHandler) return;
    this.responseHandler.onInsight = (insight) => {
      const entry = this.insightHistory.addInsight(
        insight.text,
        insight.agentType,
        insight.reasoning
      );
      this.broadcastInsightEvent({
        type: 'insight',
        id: entry.id,
        text: entry.text,
        timestamp: entry.timestamp.toISOString(),
        agentType: entry.agentType,
        reasoning: entry.reasoning,
      });
    };
    this.responseHandler.onStatus = (event) => {
      this.broadcastInsightEvent(event);
    };
  }

  /** Wire up a glasses connection */
  async setAppSession(session: AppSession): Promise<void> {
    this.appSession = session;

    // Unsubscribe any existing listeners from a previous session
    this.unsubscribeEventListeners();

    // Load settings from SimpleStorage synchronously before setting up listeners
    let frequency: 'low' | 'medium' | 'high' = 'high';
    let outputLanguage: OutputLanguage = 'english';
    let interactionMode: InteractionMode = normalizeInteractionMode(process.env.SAYNEXT_INTERACTION_MODE);
    try {
      const value = await session.simpleStorage.get('insight_frequency');
      frequency = (value as 'low' | 'medium' | 'high') || 'high';
      session.logger.info(`Initial insight frequency: ${frequency}`);
    } catch (err) {
      session.logger.error(`Failed to load frequency setting: ${err}`);
    }
    try {
      const value = await session.simpleStorage.get('output_language');
      outputLanguage = value === 'chinese' ? 'chinese' : 'english';
      session.logger.info(`Initial output language: ${outputLanguage}`);
    } catch (err) {
      session.logger.error(`Failed to load output language setting: ${err}`);
    }
    try {
      const value = await session.simpleStorage.get('interaction_mode');
      interactionMode = normalizeInteractionMode(value ?? interactionMode);
      session.logger.info(`Initial interaction mode: ${interactionMode}`);
    } catch (err) {
      session.logger.error(`Failed to load interaction mode setting: ${err}`);
    }

    // Create the response handler BEFORE setting up transcription listener
    this.responseHandler = new MergeResponseHandler(session, this.userId, this.location, frequency, outputLanguage, interactionMode);
    this.wireInsightCallback();

    // Set up transcription listener — responseHandler is guaranteed to exist
    this.setupTranscriptionListener(session);

    if (interactionMode === "g2_manual") {
      this.responseHandler.showManualListeningStatus();
    } else {
      session.layouts.showTextWall("SayNext is listening.", { durationMs: 2000 });
    }

    // Broadcast session started
    this.broadcastInsightEvent({ type: 'session_started' });
    this.broadcastInsightEvent({ type: 'session_reconnected' });
    console.log(`[User] SayNext ready for ${this.userId}`);
  }

  /** Unsubscribe all event listeners from previous session */
  private unsubscribeEventListeners(): void {
    for (const unsub of this.eventUnsubscribers) {
      try { unsub(); } catch {}
    }
    this.eventUnsubscribers = [];
  }

  /** Set up transcription listener with utterance buffering */
  private setupTranscriptionListener(session: AppSession): void {
    const handleTranscription = (data: any) => {
      const language = data.transcribeLanguage || data.language || 'unknown';
      session.logger.info(`Transcription Event (${language}): "${data.text}", isFinal: ${data.isFinal}`);
      console.log(`[SayNext] Transcript (${language}, final=${data.isFinal}): ${data.text}`);

      const text = data.text.trim();
      if (!text) return;

      this.currentUtteranceBuffer = text;

      if (data.isFinal) {
        processBufferAndReset('isFinal');
        return;
      }

      this.responseHandler?.handlePartialTranscript(text, Date.now());

      if (this.utteranceTimer) {
        clearTimeout(this.utteranceTimer);
      }
      this.utteranceTimer = setTimeout(() => processBufferAndReset('timeout'), UTTERANCE_TIMEOUT_MS);
    };

    const normalizeForDuplicate = (value: string) => value
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    const isLateFinalCorrectionDuplicate = (text: string, reason: 'isFinal' | 'timeout') => {
      if (reason !== 'isFinal') return false;
      if (this.lastProcessedReason !== 'timeout') return false;
      if (Date.now() - this.lastProcessedAt > 3000) return false;

      const current = normalizeForDuplicate(text);
      const previous = normalizeForDuplicate(this.lastProcessedUtterance);
      if (!current || !previous) return false;
      if (current === previous) return true;

      const shorter = current.length < previous.length ? current : previous;
      const longer = current.length < previous.length ? previous : current;
      const lengthRatio = shorter.length / Math.max(longer.length, 1);
      return longer.startsWith(shorter) && lengthRatio >= 0.72;
    };

    const processBufferAndReset = (reason: 'isFinal' | 'timeout') => {
      if (this.utteranceTimer) {
        clearTimeout(this.utteranceTimer);
        this.utteranceTimer = null;
      }

      const textToProcess = this.currentUtteranceBuffer.trim();
      if (textToProcess.length > 0) {
        if (isLowValueUtterance(textToProcess)) {
          session.logger.info(`Skipping low-value utterance: "${textToProcess}"`);
          this.currentUtteranceBuffer = "";
          return;
        }

        const shouldForwardLateFinalToTeleprompt =
          reason === 'isFinal' &&
          this.lastProcessedReason === 'timeout' &&
          this.responseHandler?.isTelepromptActive();

        if (textToProcess === this.lastProcessedUtterance && !shouldForwardLateFinalToTeleprompt) {
          session.logger.info(`Skipping duplicate utterance: "${textToProcess}"`);
          this.currentUtteranceBuffer = "";
          return;
        }

        if (isLateFinalCorrectionDuplicate(textToProcess, reason) && !shouldForwardLateFinalToTeleprompt) {
          session.logger.info(`Skipping late final ASR correction duplicate: "${textToProcess}"`);
          this.currentUtteranceBuffer = "";
          return;
        }

        this.lastProcessedUtterance = textToProcess;
        this.lastProcessedAt = Date.now();
        this.lastProcessedReason = reason;
        session.logger.info(`Processing utterance (reason: ${reason}): "${textToProcess}"`);
        console.log(`[SayNext] Processing (${reason}): ${textToProcess}`);
        // Broadcast processing event for webview thinking indicator
        this.broadcastInsightEvent({ type: 'processing' });
        const timestamp = Date.now();
        this.responseHandler?.processTranscript(textToProcess, timestamp, reason).catch(error => {
          session.logger.error(`Failed to process transcript: ${error}`);
          this.broadcastInsightEvent({ type: 'processing_done', reason: 'processing_error' });
        });
      }

      this.currentUtteranceBuffer = "";
    };

    const unsubTranscription = session.events.onTranscriptionForLanguage('auto', handleTranscription, {
      hints: ['en', 'zh'],
    });

    const unsubDisconnected = session.events.onDisconnected(() => {
      session.logger.info(`Session disconnected for ${this.userId}`);
      console.log(`[SayNext] Session disconnected for ${this.userId}`);
    });

    const unsubPermissionDenied = session.events.onPermissionDenied((data) => {
      session.logger.error({ data }, `Permission denied`);
      console.error(`[SayNext] Permission denied: ${JSON.stringify(data)}`);
    });

    const unsubPermissionError = session.events.onPermissionError((data) => {
      session.logger.error({ data }, `Permission error`);
      console.error(`[SayNext] Permission error: ${JSON.stringify(data)}`);
    });

    // Store unsubscribers for cleanup
    if (typeof unsubTranscription === 'function') {
      this.eventUnsubscribers.push(unsubTranscription);
    }
    if (typeof unsubDisconnected === 'function') {
      this.eventUnsubscribers.push(unsubDisconnected);
    }
    if (typeof unsubPermissionDenied === 'function') {
      this.eventUnsubscribers.push(unsubPermissionDenied);
    }
    if (typeof unsubPermissionError === 'function') {
      this.eventUnsubscribers.push(unsubPermissionError);
    }

    this.setupManualGestureListener(session);
  }

  /** Wire G2/R1 touch gestures to manual-first controls when available. */
  private setupManualGestureListener(session: AppSession): void {
    const events = session.events as any;
    if (typeof events.onTouchEvent === "function") {
      const unsubscribe = events.onTouchEvent((event: any) => {
        const gesture = this.normalizeManualGesture(event, "touch");
        this.logManualGesturePayload("touch", gesture, event);
        if (!gesture) return;
        void this.handleManualGesture(gesture);
      });

      if (typeof unsubscribe === "function") {
        this.eventUnsubscribers.push(unsubscribe);
      }
    }

    if (typeof events.onButtonPress === "function") {
      const unsubscribe = events.onButtonPress((event: any) => {
        const gesture = this.normalizeManualGesture(event, "button");
        this.logManualGesturePayload("button", gesture, event);
        if (!gesture) return;
        void this.handleManualGesture(gesture);
      });

      if (typeof unsubscribe === "function") {
        this.eventUnsubscribers.push(unsubscribe);
      }
    }
  }

  private async handleManualGesture(gesture: string): Promise<void> {
    if (this.getInteractionMode() !== "g2_manual") return;

    const eventId = `gesture:${gesture}:${Date.now()}`;
    this.broadcastInsightEvent({ type: 'manual_gesture', gesture });

    if (gesture.includes("hold") || gesture.includes("long")) {
      this.cancelPendingSingleTap();
      const result = this.clearManualAnswer(eventId);
      this.broadcastInsightEvent({ type: 'processing_done', reason: `manual_clear_${result.status}` });
      return;
    }

    if (gesture.includes("double")) {
      this.cancelPendingSingleTap();
      this.broadcastInsightEvent({ type: 'processing' });
      const result = await this.regenerateManualAnswer(eventId);
      this.broadcastInsightEvent({ type: 'processing_done', reason: `manual_${result.status}` });
      return;
    }

    if (gesture.includes("single") || gesture.includes("tap")) {
      if (this.pendingSingleTapTimer) {
        this.cancelPendingSingleTap();
        this.broadcastInsightEvent({ type: 'processing' });
        const result = await this.regenerateManualAnswer(eventId);
        this.broadcastInsightEvent({ type: 'processing_done', reason: `manual_${result.status}` });
        return;
      }

      this.cancelPendingSingleTap();
      this.pendingSingleTapTimer = setTimeout(() => {
        this.pendingSingleTapTimer = null;
        this.broadcastInsightEvent({ type: 'processing' });
        void this.generateManualAnswer(eventId).then((result) => {
          this.broadcastInsightEvent({ type: 'processing_done', reason: `manual_${result.status}` });
        });
      }, SINGLE_TAP_DELAY_MS);
      this.broadcastInsightEvent({ type: 'manual_gesture_pending', gesture, delayMs: SINGLE_TAP_DELAY_MS });
      return;
    }

    if (gesture.includes("down") || gesture.includes("next")) {
      const result = this.pageManualAnswer("next", eventId);
      this.broadcastInsightEvent({ type: 'processing_done', reason: `manual_page_${result.status}` });
      return;
    }

    if (gesture.includes("up") || gesture.includes("previous") || gesture.includes("prev")) {
      const result = this.pageManualAnswer("previous", eventId);
      this.broadcastInsightEvent({ type: 'processing_done', reason: `manual_page_${result.status}` });
      return;
    }

  }

  private normalizeManualGesture(event: any, source: "touch" | "button"): string {
    if (source === "button") {
      const pressType = String(event?.pressType || event?.press_type || "").toLowerCase();
      if (pressType.includes("long")) return "hold";
      if (pressType.includes("short")) return "single_tap";
    }

    return String(
      event?.gesture_name
      || event?.gestureName
      || event?.gesture
      || event?.touchType
      || event?.action
      || event?.eventType
      || "",
    ).toLowerCase();
  }

  private logManualGesturePayload(source: "touch" | "button", gesture: string, event: any): void {
    const payload = {
      source,
      gesture,
      rawType: event?.type,
      gesture_name: event?.gesture_name,
      gestureName: event?.gestureName,
      pressType: event?.pressType,
      buttonId: event?.buttonId,
      device_model: event?.device_model,
    };
    console.log(`[SayNext] Manual gesture payload: ${JSON.stringify(payload)}`);
    this.broadcastInsightEvent({ type: 'manual_gesture_payload', ...payload });
  }

  private cancelPendingSingleTap(): void {
    if (!this.pendingSingleTapTimer) return;
    clearTimeout(this.pendingSingleTapTimer);
    this.pendingSingleTapTimer = null;
    this.broadcastInsightEvent({ type: 'manual_gesture_cancelled', gesture: 'single_tap' });
  }

  /** Update frequency setting */
  setFrequency(frequency: 'low' | 'medium' | 'high'): void {
    if (this.responseHandler) {
      this.responseHandler.frequency = frequency;
      console.log(`[User] Frequency updated to ${frequency} for ${this.userId}`);
    }
    // Also persist to SimpleStorage
    if (this.appSession) {
      this.appSession.simpleStorage.set('insight_frequency', frequency).catch((err) => {
        console.error(`[User] Failed to save frequency to SimpleStorage: ${err}`);
      });
    }
  }

  /** Get current frequency */
  getFrequency(): 'low' | 'medium' | 'high' {
    return this.responseHandler?.frequency || 'high';
  }

  /** Update output language setting */
  setOutputLanguage(outputLanguage: OutputLanguage): void {
    if (this.responseHandler) {
      this.responseHandler.outputLanguage = outputLanguage;
      console.log(`[User] Output language updated to ${outputLanguage} for ${this.userId}`);
    }

    if (this.appSession) {
      this.appSession.simpleStorage.set('output_language', outputLanguage).catch((err) => {
        console.error(`[User] Failed to save output language to SimpleStorage: ${err}`);
      });
    }
  }

  /** Get current output language */
  getOutputLanguage(): OutputLanguage {
    return this.responseHandler?.outputLanguage || 'english';
  }

  /** Update G1 auto vs G2 manual interaction mode. */
  setInteractionMode(mode: InteractionMode): void {
    if (mode !== "g2_manual") {
      this.cancelPendingSingleTap();
    }
    this.responseHandler?.setInteractionMode(mode);
    console.log(`[User] Interaction mode updated to ${mode} for ${this.userId}`);

    if (this.appSession) {
      this.appSession.simpleStorage.set('interaction_mode', mode).catch((err) => {
        console.error(`[User] Failed to save interaction mode to SimpleStorage: ${err}`);
      });
    }
  }

  /** Get current interaction mode */
  getInteractionMode(): InteractionMode {
    return this.responseHandler?.getInteractionMode() || normalizeInteractionMode(process.env.SAYNEXT_INTERACTION_MODE);
  }

  /** Get the active runtime session id, if glasses are connected. */
  getRuntimeSessionId(): string | null {
    return this.responseHandler?.getRuntimeSessionId() || null;
  }

  /** Get current G2 manual runtime state. */
  getManualState(): ManualRuntimeState {
    return this.responseHandler?.getManualState()
      || inactiveManualState(this.getInteractionMode(), this.getRuntimeSessionId() || "");
  }

  /** Generate from committed speech since the last successful manual generation. */
  generateManualAnswer(clientEventId?: string): Promise<ManualActionResult> {
    return this.responseHandler?.generateManualAnswer(clientEventId)
      || Promise.resolve(inactiveManualResult(this.getInteractionMode()));
  }

  /** Regenerate an alternate answer from the same previous source range. */
  regenerateManualAnswer(clientEventId?: string): Promise<ManualActionResult> {
    return this.responseHandler?.regenerateManualAnswer(clientEventId)
      || Promise.resolve(inactiveManualResult(this.getInteractionMode()));
  }

  /** Page through the current manual answer. */
  pageManualAnswer(direction: "next" | "previous", clientEventId?: string): ManualActionResult {
    return this.responseHandler?.pageManualAnswer(direction, clientEventId)
      || inactiveManualResult(this.getInteractionMode());
  }

  /** Clear the pinned G2 answer and keep listening. */
  clearManualAnswer(clientEventId?: string): ManualActionResult {
    return this.responseHandler?.clearManualAnswer(clientEventId)
      || inactiveManualResult(this.getInteractionMode());
  }

  /** Pause AI processing while the user reads the current suggestion */
  pauseForReading(): void {
    this.responseHandler?.pauseForReading();
    this.broadcastInsightEvent({ type: 'manual_pause', paused: true });
  }

  /** Pin a specific insight on the display while paused */
  showInsightForReading(text: string): void {
    this.responseHandler?.showPinnedText(text);
    this.broadcastInsightEvent({ type: 'manual_pause', paused: true });
  }

  /** Resume automatic processing */
  resumeAutomatic(): void {
    this.responseHandler?.resumeAutomatic();
    this.broadcastInsightEvent({ type: 'manual_pause', paused: false });
  }

  /** Force the current teleprompt to move to the next readable chunk. */
  advanceTeleprompt(): boolean {
    return this.responseHandler?.advanceTelepromptManually() || false;
  }

  /** Move the current teleprompt back to the previous readable chunk. */
  rewindTeleprompt(): boolean {
    return this.responseHandler?.rewindTelepromptManually() || false;
  }

  /** Cancel the current teleprompt and return to normal listening. */
  cancelTeleprompt(): boolean {
    return this.responseHandler?.cancelTelepromptManually() || false;
  }

  /** Get current manual pause state */
  isPausedForReading(): boolean {
    return this.responseHandler?.getManualPauseState() || false;
  }

  /** Update cached location from passive updates */
  updateLocation(lat: number, lng: number): void {
    this.location.updateCoordinates(lat, lng);
  }

  /** Disconnect glasses but keep user alive (insights, SSE clients stay) */
  clearAppSession(): void {
    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer);
      this.utteranceTimer = null;
    }
    this.cancelPendingSingleTap();
    this.unsubscribeEventListeners();
    this.currentUtteranceBuffer = "";
    this.responseHandler?.close();
    this.responseHandler = null;
    this.appSession = null;
  }

  /** Clear only the current webview screen history. Database export history is kept. */
  clearScreenHistory(): void {
    this.insightHistory.clearAll();
    this.eventQueue = [];
  }

  /** Reset real-time runtime state without deleting database history. */
  resetCurrentSession(): void {
    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer);
      this.utteranceTimer = null;
    }
    this.cancelPendingSingleTap();

    this.currentUtteranceBuffer = "";
    this.lastProcessedUtterance = "";
    this.lastProcessedAt = 0;
    this.lastProcessedReason = null;
    this.responseHandler?.resetRuntimeState();
    this.clearScreenHistory();
    this.broadcastInsightEvent({ type: 'session_reset' });
  }

  /** Register an SSE client */
  addSSEClient(send: (data: string) => void): void {
    this.sseClients.add(send);

    // Flush event queue
    for (const event of this.eventQueue) {
      send(JSON.stringify(event));
    }
    this.eventQueue = [];
  }

  /** Remove an SSE client */
  removeSSEClient(send: (data: string) => void): void {
    this.sseClients.delete(send);
  }

  /** Broadcast an event to all connected SSE clients */
  broadcastInsightEvent(event: any): void {
    const data = JSON.stringify(event);

    if (this.sseClients.size === 0) {
      // Queue for when SSE connects (cap to prevent unbounded growth)
      if (this.eventQueue.length < MAX_EVENT_QUEUE_SIZE) {
        this.eventQueue.push(event);
      }
      return;
    }

    for (const send of this.sseClients) {
      try {
        send(data);
      } catch (err) {
        console.error(`[User] Failed to send SSE event:`, err);
        this.sseClients.delete(send);
      }
    }
  }

  /** Nuke everything */
  cleanup(): void {
    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer);
      this.utteranceTimer = null;
    }
    this.cancelPendingSingleTap();
    this.unsubscribeEventListeners();
    this.responseHandler?.close();
    this.insightHistory.destroy();
    this.location.destroy();
    this.sseClients.clear();
    this.eventQueue = [];
    this.responseHandler = null;
    this.appSession = null;
  }
}
