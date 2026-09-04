export type EvenHubTranscriptEvent = {
  text: string;
  isFinal: boolean;
  utterance?: string;
  turnOrder?: number;
};

export type EvenHubSttConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "failed";

export type EvenHubSttConnectionEvent = {
  provider: "deepgram" | "assemblyai";
  status: EvenHubSttConnectionStatus;
  detail: string;
  attempt?: number;
  retryInMs?: number;
  code?: number;
  reason?: string;
  queuedAudioBytes?: number;
  droppedAudioBytes?: number;
  droppedAudioChunks?: number;
};

export type EvenHubSttCallbacks = {
  onTranscript(event: EvenHubTranscriptEvent): Promise<void> | void;
  onConnectionState?(event: EvenHubSttConnectionEvent): void;
  onStatus?(message: string): void;
  onError?(error: Error): void;
};

export type EvenHubSttStartOptions = {
  languageCode?: string | null;
};

export type EvenHubSttAdapter = {
  provider?: "deepgram" | "assemblyai";
  start(options?: EvenHubSttStartOptions): Promise<void>;
  pushAudio(chunk: Uint8Array): void;
  forceEndpoint?(): boolean;
  stop(): Promise<void>;
  close(): Promise<void> | void;
};

type DeepgramMessage = {
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
  type?: string;
};

type AssemblyAiMessage = {
  type?: string;
  turn_order?: number;
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  error?: string;
  message?: string;
};

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeDeepgramUrl(options?: EvenHubSttStartOptions): string {
  const sampleRate = envNumber("EVENHUB_STT_SAMPLE_RATE", 16000);
  const endpointing = envNumber("EVENHUB_STT_ENDPOINTING_MS", 300);
  const model = process.env.DEEPGRAM_MODEL || process.env.EVENHUB_STT_MODEL || "nova-3";
  const hasSessionLanguage = options && Object.prototype.hasOwnProperty.call(options, "languageCode");
  const requestedLanguage = hasSessionLanguage
    ? (options?.languageCode || "multi").trim()
    : (process.env.EVENHUB_STT_LANGUAGE || "en").trim();
  // Nova-3 supports zh explicitly. Its streaming multilingual mode is `multi`,
  // not omitted language/detect_language, and does not currently include Chinese.
  // https://developers.deepgram.com/docs/models-languages-overview
  const language = requestedLanguage === "auto" || !requestedLanguage ? "multi" : requestedLanguage;
  const params = new URLSearchParams({
    model,
    language,
    encoding: "linear16",
    sample_rate: String(sampleRate),
    channels: "1",
    interim_results: "true",
    endpointing: String(endpointing),
    smart_format: "true",
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function assemblyAiStreamingHost(): string {
  const explicitHost = (process.env.ASSEMBLYAI_STT_HOST || "").trim();
  if (explicitHost) return explicitHost;

  const region = (process.env.ASSEMBLYAI_STT_REGION || "").trim().toLowerCase();
  if (region === "us") return "streaming.us.assemblyai.com";
  if (region === "eu") return "streaming.eu.assemblyai.com";
  return "streaming.assemblyai.com";
}

export function makeAssemblyAiUrl(options?: EvenHubSttStartOptions): string {
  const sampleRate = envNumber("ASSEMBLYAI_STT_SAMPLE_RATE", envNumber("EVENHUB_STT_SAMPLE_RATE", 16000));
  const speechModel = process.env.ASSEMBLYAI_STT_MODEL || "universal-3-5-pro";
  const mode = (process.env.ASSEMBLYAI_STT_MODE || "max_accuracy").trim();
  const hasSessionLanguage = Boolean(
    options && Object.prototype.hasOwnProperty.call(options, "languageCode"),
  );
  const languageCode = hasSessionLanguage
    ? (options?.languageCode || "").trim()
    : (process.env.ASSEMBLYAI_STT_LANGUAGE_CODE || "").trim();
  const minTurnSilence = envNumber("ASSEMBLYAI_STT_MIN_TURN_SILENCE_MS", 0);
  const maxTurnSilence = envNumber("ASSEMBLYAI_STT_MAX_TURN_SILENCE_MS", 0);
  const params = new URLSearchParams({
    sample_rate: String(sampleRate),
    speech_model: speechModel,
  });
  if (mode) params.set("mode", mode);
  if (languageCode) params.set("language_code", languageCode);
  if (minTurnSilence > 0) params.set("min_turn_silence", String(minTurnSilence));
  if (maxTurnSilence > 0) params.set("max_turn_silence", String(maxTurnSilence));
  return `wss://${assemblyAiStreamingHost()}/v3/ws?${params.toString()}`;
}

export function parseAssemblyAiTranscriptEvent(raw: unknown): EvenHubTranscriptEvent | null {
  const text = typeof raw === "string" ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : "";
  if (!text) return null;
  let parsed: AssemblyAiMessage;
  try {
    parsed = JSON.parse(text) as AssemblyAiMessage;
  } catch {
    return null;
  }
  if (parsed.type !== "Turn") return null;
  const transcript = (parsed.transcript || parsed.utterance || "").trim();
  if (!transcript) return null;
  const utterance = (parsed.utterance || "").trim();
  const event: EvenHubTranscriptEvent = {
    text: transcript,
    isFinal: Boolean(parsed.end_of_turn),
  };
  if (utterance) event.utterance = utterance;
  if (typeof parsed.turn_order === "number" && Number.isFinite(parsed.turn_order)) {
    event.turnOrder = parsed.turn_order;
  }
  return event;
}

export class DeepgramEvenHubSttAdapter implements EvenHubSttAdapter {
  readonly provider = "deepgram" as const;
  private ws: WebSocket | null = null;
  private queue: Uint8Array[] = [];
  private queuedAudioBytes = 0;
  private droppedAudioBytes = 0;
  private droppedAudioChunks = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private opening: Promise<void> | null = null;
  private cancelOpening: ((error: Error) => void) | null = null;
  private desiredRunning = false;
  private socketGeneration = 0;
  private reconnectAttempt = 0;
  private sessionOptions: EvenHubSttStartOptions | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly callbacks: EvenHubSttCallbacks,
  ) {}

  async start(options?: EvenHubSttStartOptions): Promise<void> {
    if (!this.desiredRunning) {
      // A resume can overtake the previous stop's finalization wait.
      this.retireSocket(new DOMException("STT start replaced the old socket", "AbortError"));
      this.sessionOptions = options ? { ...options } : undefined;
      this.reconnectAttempt = 0;
      this.droppedAudioBytes = 0;
      this.droppedAudioChunks = 0;
    }
    this.desiredRunning = true;
    if (this.opening) return this.opening;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.clearReconnectTimer();
    return this.openSocket();
  }

  private openSocket(): Promise<void> {
    if (!this.desiredRunning) return Promise.resolve();
    const generation = ++this.socketGeneration;
    let resolveOpening!: () => void;
    let rejectOpening!: (error: Error) => void;
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const opening = new Promise<void>((resolve, reject) => {
      resolveOpening = resolve;
      rejectOpening = reject;
    });
    this.opening = opening;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      if (this.opening === opening) {
        this.opening = null;
        this.cancelOpening = null;
      }
      if (error) rejectOpening(error);
      else resolveOpening();
    };
    this.cancelOpening = settle;
    if (!this.reconnectAttempt) {
      this.emitConnectionState({ status: "connecting", detail: "Connecting to Deepgram STT." });
    }
    // Install ownership before constructing the transport so synchronous failures
    // cannot leave a rejected promise permanently occupying `opening`.
    try {
      const WebSocketCtor = globalThis.WebSocket as unknown as new (url: string, options?: unknown) => WebSocket;
      const socket = new WebSocketCtor(makeDeepgramUrl(this.sessionOptions), {
        headers: { Authorization: `Token ${this.apiKey}` },
      });
      this.ws = socket;
      socket.binaryType = "arraybuffer";
      handshakeTimer = setTimeout(() => {
        this.handleSocketFailure(socket, generation, 1006, "Deepgram STT handshake timed out.");
      }, envNumber("DEEPGRAM_STT_CONNECT_TIMEOUT_MS", 10000));

      socket.onopen = () => {
        if (!this.isCurrentSocket(socket, generation)) return;
        if (!this.desiredRunning) {
          this.retireSocket(new DOMException("STT stopped", "AbortError"));
          return;
        }
        this.emitConnectionState({ status: "connected", detail: "Deepgram STT connected." });
        this.flushQueue(socket, generation);
        if (!this.isCurrentSocket(socket, generation)) return;
        this.reconnectAttempt = 0;
        // Deepgram recommends 3-5 seconds; 10 seconds races its idle timeout.
        this.keepAliveTimer = setInterval(() => {
          if (!this.desiredRunning || !this.isCurrentSocket(socket, generation)) return;
          try {
            socket.send(JSON.stringify({ type: "KeepAlive" }));
          } catch {
            this.handleSocketFailure(socket, generation, 1006, "Deepgram STT keepalive send failed.");
          }
        }, 4000);
        settle();
      };
      socket.onmessage = (event) => {
        if (this.isCurrentSocket(socket, generation)) this.handleMessage(event.data);
      };
      socket.onerror = () => this.handleSocketFailure(socket, generation, 1006, "Deepgram STT websocket error.");
      socket.onclose = (event) => this.handleSocketFailure(
        socket, generation, event?.code || 1006, event?.reason || "Deepgram STT closed.",
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.retireSocket(failure);
      this.scheduleReconnect(1006, failure.message);
    }
    return opening;
  }

  pushAudio(chunk: Uint8Array): void {
    if (!this.desiredRunning || !chunk.byteLength) return;
    const socket = this.ws;
    const generation = this.socketGeneration;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(chunk);
        return;
      } catch {
        this.enqueueAudio(chunk);
        this.handleSocketFailure(socket, generation, 1006, "Deepgram STT audio send failed.");
        return;
      }
    }
    this.enqueueAudio(chunk);
  }

  async stop(): Promise<void> {
    this.desiredRunning = false;
    this.clearReconnectTimer();
    this.clearKeepAlive();
    this.clearQueue();
    const socket = this.ws;
    const generation = this.socketGeneration;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "Finalize" }));
        // Keep this socket's last final transcript eligible until finalization ends.
        await delay(envNumber("EVENHUB_STT_FINALIZE_WAIT_MS", 900));
      } catch {
        // Finalization is best effort; cleanup and stopping must still complete.
      }
    }
    if (generation !== this.socketGeneration) return;
    this.retireSocket(new DOMException("STT stopped", "AbortError"));
    this.emitConnectionState({ status: "stopped", detail: "Deepgram STT stopped." });
  }

  close(): void {
    this.desiredRunning = false;
    this.clearReconnectTimer();
    this.clearQueue();
    this.retireSocket(new DOMException("STT closed", "AbortError"));
    this.emitConnectionState({ status: "stopped", detail: "Deepgram STT stopped." });
  }

  private handleSocketFailure(socket: WebSocket, generation: number, code: number, reason: string): void {
    if (!this.isCurrentSocket(socket, generation)) return;
    const error = new Error(`Deepgram STT closed (${code}): ${reason}`);
    this.retireSocket(error);
    if (!this.desiredRunning) return;
    if (code === 1002 || code === 1003 || code === 1008) {
      this.fail(error, code, reason);
    } else {
      this.scheduleReconnect(code, reason);
    }
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (!this.desiredRunning || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > envNumber("DEEPGRAM_STT_RECONNECT_ATTEMPTS", 8)) {
      this.fail(new Error(`Deepgram STT reconnect limit reached: ${reason}`), code, reason);
      return;
    }
    const retryInMs = Math.min(
      envNumber("DEEPGRAM_STT_RECONNECT_MAX_MS", 4000),
      envNumber("DEEPGRAM_STT_RECONNECT_BASE_MS", 250) * (2 ** (this.reconnectAttempt - 1)),
    );
    this.emitConnectionState({
      status: "reconnecting", detail: `Deepgram STT reconnecting after close code ${code}.`,
      attempt: this.reconnectAttempt, retryInMs, code, reason,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.desiredRunning) void this.openSocket().catch(() => {
        // The failure handler has already scheduled recovery or reported failure.
      });
    }, retryInMs);
  }

  private fail(error: Error, code: number, reason: string): void {
    this.desiredRunning = false;
    this.clearReconnectTimer();
    this.clearQueue();
    this.emitConnectionState({ status: "failed", detail: error.message, code, reason });
    this.callbacks.onError?.(error);
  }

  private retireSocket(error: Error): void {
    this.clearKeepAlive();
    this.cancelOpening?.(error);
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    } catch {
      // Ownership is already revoked; delayed transport events cannot mutate us.
    }
  }

  private enqueueAudio(chunk: Uint8Array): void {
    const sampleRate = envNumber("EVENHUB_STT_SAMPLE_RATE", 16000);
    const bufferMs = envNumber("DEEPGRAM_STT_RECONNECT_BUFFER_MS", 500);
    const maxBytes = Math.max(2, Math.floor(sampleRate * bufferMs / 1000) * 2);
    let queuedChunk = chunk.slice();
    if (queuedChunk.byteLength > maxBytes) {
      this.droppedAudioBytes += queuedChunk.byteLength - maxBytes;
      this.droppedAudioChunks += 1;
      queuedChunk = queuedChunk.slice(-maxBytes);
    }
    while (this.queue.length && this.queuedAudioBytes + queuedChunk.byteLength > maxBytes) {
      const dropped = this.queue.shift()!;
      this.queuedAudioBytes -= dropped.byteLength;
      this.droppedAudioBytes += dropped.byteLength;
      this.droppedAudioChunks += 1;
    }
    this.queue.push(queuedChunk);
    this.queuedAudioBytes += queuedChunk.byteLength;
  }

  private flushQueue(socket: WebSocket, generation: number): void {
    while (this.queue.length && this.isCurrentSocket(socket, generation)) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.handleSocketFailure(socket, generation, 1006, "Deepgram STT closed while replaying audio.");
        return;
      }
      const chunk = this.queue[0];
      try {
        socket.send(chunk);
      } catch {
        this.handleSocketFailure(socket, generation, 1006, "Deepgram STT audio replay failed.");
        return;
      }
      this.queue.shift();
      this.queuedAudioBytes -= chunk.byteLength;
    }
  }

  private handleMessage(raw: unknown): void {
    const text = typeof raw === "string" ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : "";
    if (!text) return;
    let parsed: DeepgramMessage;
    try {
      parsed = JSON.parse(text) as DeepgramMessage;
    } catch {
      return;
    }
    const transcript = parsed.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript) return;
    void this.callbacks.onTranscript({
      text: transcript,
      isFinal: Boolean(parsed.is_final || parsed.speech_final),
    });
  }

  private isCurrentSocket(socket: WebSocket, generation: number): boolean {
    return this.ws === socket && this.socketGeneration === generation;
  }

  private emitConnectionState(event: Omit<EvenHubSttConnectionEvent, "provider">): void {
    const connectionEvent = {
      ...event, provider: this.provider, queuedAudioBytes: this.queuedAudioBytes,
      droppedAudioBytes: this.droppedAudioBytes, droppedAudioChunks: this.droppedAudioChunks,
    };
    if (this.callbacks.onConnectionState) this.callbacks.onConnectionState(connectionEvent);
    else this.callbacks.onStatus?.(event.detail);
  }

  private clearQueue(): void {
    this.queue = [];
    this.queuedAudioBytes = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }
}

export class AssemblyAiEvenHubSttAdapter implements EvenHubSttAdapter {
  readonly provider = "assemblyai" as const;
  private ws: WebSocket | null = null;
  private queue: Uint8Array[] = [];
  private queuedAudioBytes = 0;
  private droppedAudioBytes = 0;
  private droppedAudioChunks = 0;
  private opening: Promise<void> | null = null;
  private terminationResolver: (() => void) | null = null;
  private desiredRunning = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private socketGeneration = 0;
  private sessionOptions: EvenHubSttStartOptions | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly callbacks: EvenHubSttCallbacks,
  ) {}

  async start(options?: EvenHubSttStartOptions): Promise<void> {
    if (!this.desiredRunning) {
      this.reconnectAttempt = 0;
      this.droppedAudioBytes = 0;
      this.droppedAudioChunks = 0;
      this.sessionOptions = options ? { ...options } : undefined;
    }
    this.desiredRunning = true;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.opening) return this.opening;
    this.clearReconnectTimer();
    return this.openSocket();
  }

  private openSocket(): Promise<void> {
    if (!this.desiredRunning) return Promise.resolve();
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.opening) return this.opening;

    const generation = ++this.socketGeneration;
    const reconnecting = this.reconnectAttempt > 0;
    if (!reconnecting) {
      this.emitConnectionState({
        status: "connecting",
        detail: "Connecting to AssemblyAI STT.",
      });
    }

    const opening = new Promise<void>((resolve, reject) => {
      const WebSocketCtor = globalThis.WebSocket as unknown as new (url: string, options?: unknown) => WebSocket;
      const ws = new WebSocketCtor(makeAssemblyAiUrl(this.sessionOptions), {
        headers: {
          Authorization: this.apiKey,
        },
      });
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      let settled = false;

      const resolveOpening = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOpening = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      ws.onopen = () => {
        if (!this.isCurrentSocket(ws, generation)) {
          ws.close();
          return;
        }
        this.opening = null;
        if (!this.desiredRunning) {
          resolveOpening();
          ws.close();
          return;
        }
        this.reconnectAttempt = 0;
        this.emitConnectionState({
          status: "connected",
          detail: "AssemblyAI STT connected.",
        });
        this.flushQueue(ws, generation);
        resolveOpening();
      };

      ws.onmessage = (event) => {
        if (!this.isCurrentSocket(ws, generation)) return;
        this.handleMessage(event.data, ws);
      };

      ws.onerror = () => {
        const error = new Error("AssemblyAI STT websocket error.");
        rejectOpening(error);
        this.handleSocketClosed(ws, generation, {
          code: 1006,
          reason: error.message,
          wasClean: false,
        });
        try {
          ws.close();
        } catch {
          // The connection state has already been handled above.
        }
      };

      ws.onclose = (event) => {
        const closeEvent = event || { code: 1006, reason: "", wasClean: false };
        rejectOpening(new Error(
          `AssemblyAI STT closed before connecting (${closeEvent.code || 1006}${closeEvent.reason ? `: ${closeEvent.reason}` : ""}).`,
        ));
        this.handleSocketClosed(ws, generation, closeEvent);
      };
    });

    this.opening = opening;
    return opening;
  }

  pushAudio(chunk: Uint8Array): void {
    const socket = this.ws;
    const generation = this.socketGeneration;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(chunk);
        return;
      } catch {
        this.enqueueAudio(chunk);
        this.handleSocketClosed(socket, generation, {
          code: 1006,
          reason: "AssemblyAI audio send failed.",
          wasClean: false,
        });
        try {
          socket.close();
        } catch {
          // The reconnect state is already scheduled.
        }
        return;
      }
    }
    this.enqueueAudio(chunk);
  }

  forceEndpoint(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "ForceEndpoint" }));
    return true;
  }

  async stop(): Promise<void> {
    this.desiredRunning = false;
    this.clearReconnectTimer();
    const socket = this.ws;
    if (socket?.readyState === WebSocket.OPEN) {
      const termination = this.waitForTermination();
      socket.send(JSON.stringify({ type: "Terminate" }));
      await Promise.race([
        termination,
        delay(envNumber("ASSEMBLYAI_STT_TERMINATE_WAIT_MS", 900)),
      ]);
      socket.close();
    } else if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    } else {
      this.emitConnectionState({
        status: "stopped",
        detail: "AssemblyAI STT stopped.",
      });
    }
    this.clearQueue();
  }

  close(): void {
    this.desiredRunning = false;
    this.clearReconnectTimer();
    const socket = this.ws;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "Terminate" }));
      }
      socket.close();
    } else {
      this.emitConnectionState({
        status: "stopped",
        detail: "AssemblyAI STT stopped.",
      });
    }
    this.clearQueue();
    this.resolveTermination();
  }

  private enqueueAudio(chunk: Uint8Array): void {
    const maxBytes = this.maxQueuedAudioBytes();
    let queuedChunk = chunk.slice();
    if (queuedChunk.byteLength > maxBytes) {
      const keepFrom = queuedChunk.byteLength - maxBytes;
      this.droppedAudioBytes += keepFrom;
      this.droppedAudioChunks += 1;
      queuedChunk = queuedChunk.slice(keepFrom);
    }
    while (this.queue.length && this.queuedAudioBytes + queuedChunk.byteLength > maxBytes) {
      const dropped = this.queue.shift();
      if (!dropped) break;
      this.queuedAudioBytes -= dropped.byteLength;
      this.droppedAudioBytes += dropped.byteLength;
      this.droppedAudioChunks += 1;
    }
    this.queue.push(queuedChunk);
    this.queuedAudioBytes += queuedChunk.byteLength;
  }

  private flushQueue(socket: WebSocket, generation: number): void {
    if (!this.queue.length) return;
    const queued = this.queue;
    this.queue = [];
    this.queuedAudioBytes = 0;

    for (let index = 0; index < queued.length; index += 1) {
      if (!this.isCurrentSocket(socket, generation) || socket.readyState !== WebSocket.OPEN) {
        this.restoreQueuedAudio(queued.slice(index));
        return;
      }
      try {
        socket.send(queued[index]);
      } catch {
        this.restoreQueuedAudio(queued.slice(index));
        this.handleSocketClosed(socket, generation, {
          code: 1006,
          reason: "AssemblyAI audio send failed.",
          wasClean: false,
        });
        try {
          socket.close();
        } catch {
          // The reconnect state is already scheduled.
        }
        return;
      }
    }
  }

  private restoreQueuedAudio(chunks: Uint8Array[]): void {
    const pending = [...chunks, ...this.queue];
    this.queue = [];
    this.queuedAudioBytes = 0;
    for (const chunk of pending) this.enqueueAudio(chunk);
  }

  private handleMessage(raw: unknown, socket: WebSocket): void {
    const text = typeof raw === "string" ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : "";
    if (!text) return;
    let parsed: AssemblyAiMessage;
    try {
      parsed = JSON.parse(text) as AssemblyAiMessage;
    } catch {
      return;
    }
    if (parsed.type === "Termination") {
      this.resolveTermination();
      return;
    }
    if (parsed.type === "Error" || parsed.error) {
      const error = new Error(parsed.error || parsed.message || "AssemblyAI STT error.");
      try {
        socket.close(3006, error.message.slice(0, 120));
      } catch {
        this.desiredRunning = false;
        this.clearQueue();
        this.emitConnectionState({
          status: "failed",
          detail: error.message,
          code: 3006,
          reason: error.message,
        });
        this.callbacks.onError?.(error);
      }
      return;
    }
    const transcriptEvent = parseAssemblyAiTranscriptEvent(text);
    if (!transcriptEvent) return;
    void this.callbacks.onTranscript(transcriptEvent);
  }

  private handleSocketClosed(
    socket: WebSocket,
    generation: number,
    event: { code?: number; reason?: string; wasClean?: boolean },
  ): void {
    if (!this.isCurrentSocket(socket, generation)) return;
    this.resolveTermination();
    this.ws = null;
    this.opening = null;
    const code = event.code || 1006;
    const reason = event.reason || "";

    if (!this.desiredRunning) {
      this.emitConnectionState({
        status: "stopped",
        detail: "AssemblyAI STT stopped.",
        code,
        reason,
      });
      return;
    }

    if (this.isFatalCloseCode(code)) {
      this.desiredRunning = false;
      this.clearReconnectTimer();
      this.clearQueue();
      const error = new Error(
        `AssemblyAI STT closed with non-retryable code ${code}${reason ? `: ${reason}` : ""}.`,
      );
      this.emitConnectionState({
        status: "failed",
        detail: error.message,
        code,
        reason,
      });
      this.callbacks.onError?.(error);
      return;
    }

    this.scheduleReconnect(code, reason);
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (!this.desiredRunning || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const retryInMs = this.reconnectDelayMs(code, this.reconnectAttempt);
    this.emitConnectionState({
      status: "reconnecting",
      detail: `AssemblyAI STT reconnecting after close code ${code}.`,
      attempt: this.reconnectAttempt,
      retryInMs,
      code,
      reason,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.desiredRunning) return;
      void this.openSocket().catch(() => {
        // A retryable close schedules the next attempt through handleSocketClosed.
      });
    }, retryInMs);
  }

  private reconnectDelayMs(code: number, attempt: number): number {
    if (code === 3008) return 0;
    const baseMs = envNumber("ASSEMBLYAI_STT_RECONNECT_BASE_MS", 250);
    const maxMs = envNumber("ASSEMBLYAI_STT_RECONNECT_MAX_MS", 4000);
    const backoff = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
    return code === 3009 ? Math.max(5000, backoff) : backoff;
  }

  private isFatalCloseCode(code: number): boolean {
    return code === 1008 || code === 3006 || code === 3007;
  }

  private maxQueuedAudioBytes(): number {
    const sampleRate = envNumber("ASSEMBLYAI_STT_SAMPLE_RATE", envNumber("EVENHUB_STT_SAMPLE_RATE", 16000));
    const bufferMs = envNumber("ASSEMBLYAI_STT_RECONNECT_BUFFER_MS", 500);
    const bytes = Math.floor((sampleRate * 2 * bufferMs) / 1000);
    return Math.max(2, bytes - (bytes % 2));
  }

  private isCurrentSocket(socket: WebSocket, generation: number): boolean {
    return this.ws === socket && this.socketGeneration === generation;
  }

  private emitConnectionState(
    event: Omit<EvenHubSttConnectionEvent, "provider" | "queuedAudioBytes" | "droppedAudioBytes" | "droppedAudioChunks">,
  ): void {
    const connectionEvent: EvenHubSttConnectionEvent = {
      provider: "assemblyai",
      ...event,
      queuedAudioBytes: this.queuedAudioBytes,
      droppedAudioBytes: this.droppedAudioBytes,
      droppedAudioChunks: this.droppedAudioChunks,
    };
    if (this.callbacks.onConnectionState) {
      this.callbacks.onConnectionState(connectionEvent);
    } else {
      this.callbacks.onStatus?.(event.detail);
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearQueue(): void {
    this.queue = [];
    this.queuedAudioBytes = 0;
  }

  private waitForTermination(): Promise<void> {
    return new Promise((resolve) => {
      this.terminationResolver = resolve;
    });
  }

  private resolveTermination(): void {
    this.terminationResolver?.();
    this.terminationResolver = null;
  }
}

export function createEvenHubSttAdapter(callbacks: EvenHubSttCallbacks): EvenHubSttAdapter | null {
  const provider = (process.env.EVENHUB_STT_PROVIDER || "").trim().toLowerCase();
  const assemblyAiApiKey = (process.env.ASSEMBLYAI_API_KEY || "").trim();
  if (provider === "assemblyai" && assemblyAiApiKey) {
    return new AssemblyAiEvenHubSttAdapter(assemblyAiApiKey, callbacks);
  }

  const apiKey = (process.env.DEEPGRAM_API_KEY || "").trim();
  if ((provider === "deepgram" || (!provider && apiKey)) && apiKey) {
    return new DeepgramEvenHubSttAdapter(apiKey, callbacks);
  }
  return null;
}
