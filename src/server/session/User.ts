import { AppSession } from "@mentra/sdk";
import { InsightHistoryManager, type InsightEntry } from "../manager/InsightHistoryManager";
import { LocationManager } from "../manager/LocationManager";
import { MergeResponseHandler } from "../mastra/agents";
import type { OutputLanguage } from "../mastra/agents/initial-agent";
import { UTTERANCE_TIMEOUT_MS } from "../config";

const MAX_EVENT_QUEUE_SIZE = 100;
const LOW_VALUE_UTTERANCE_PATTERN = /^(and|so|then|but|or|uh|um|erm|hmm|mm|ah|oh|okay|ok|right|yeah|yes|no|嗯|呃|啊|哦|噢|唔|然后|所以)[\s.,!?。！？]*$/i;

function isLowValueUtterance(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return LOW_VALUE_UTTERANCE_PATTERN.test(normalized);
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
  private lastProcessedUtterance: string = "";

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

    // Create the response handler BEFORE setting up transcription listener
    this.responseHandler = new MergeResponseHandler(session, this.userId, this.location, frequency, outputLanguage);
    this.wireInsightCallback();

    // Set up transcription listener — responseHandler is guaranteed to exist
    this.setupTranscriptionListener(session);

    session.layouts.showTextWall("SayNext is listening.", { durationMs: 2000 });

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

      if (this.utteranceTimer) {
        clearTimeout(this.utteranceTimer);
      }
      this.utteranceTimer = setTimeout(() => processBufferAndReset('timeout'), UTTERANCE_TIMEOUT_MS);
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

        if (textToProcess === this.lastProcessedUtterance) {
          session.logger.info(`Skipping duplicate utterance: "${textToProcess}"`);
          this.currentUtteranceBuffer = "";
          return;
        }

        this.lastProcessedUtterance = textToProcess;
        session.logger.info(`Processing utterance (reason: ${reason}): "${textToProcess}"`);
        console.log(`[SayNext] Processing (${reason}): ${textToProcess}`);
        // Broadcast processing event for webview thinking indicator
        this.broadcastInsightEvent({ type: 'processing' });
        const timestamp = Date.now();
        this.responseHandler?.processTranscript(textToProcess, timestamp).catch(error => {
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

    this.currentUtteranceBuffer = "";
    this.lastProcessedUtterance = "";
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
