export type EvenHubTranscriptEvent = {
  text: string;
  isFinal: boolean;
};

export type EvenHubSttCallbacks = {
  onTranscript(event: EvenHubTranscriptEvent): Promise<void> | void;
  onStatus?(message: string): void;
  onError?(error: Error): void;
};

export type EvenHubSttAdapter = {
  start(): Promise<void>;
  pushAudio(chunk: Uint8Array): void;
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

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDeepgramUrl(): string {
  const sampleRate = envNumber("EVENHUB_STT_SAMPLE_RATE", 16000);
  const endpointing = envNumber("EVENHUB_STT_ENDPOINTING_MS", 300);
  const model = process.env.DEEPGRAM_MODEL || process.env.EVENHUB_STT_MODEL || "nova-3";
  const language = process.env.EVENHUB_STT_LANGUAGE || "en";
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

export class DeepgramEvenHubSttAdapter implements EvenHubSttAdapter {
  private ws: WebSocket | null = null;
  private queue: Uint8Array[] = [];
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private opening: Promise<void> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly callbacks: EvenHubSttCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.opening) return this.opening;

    this.opening = new Promise((resolve, reject) => {
      const WebSocketCtor = globalThis.WebSocket as unknown as new (url: string, options?: unknown) => WebSocket;
      const ws = new WebSocketCtor(makeDeepgramUrl(), {
        headers: {
          Authorization: `Token ${this.apiKey}`,
        },
      });
      this.ws = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        this.callbacks.onStatus?.("Deepgram STT connected.");
        this.flushQueue();
        this.keepAliveTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 10000);
        resolve();
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      ws.onerror = () => {
        const error = new Error("Deepgram STT websocket error.");
        this.callbacks.onError?.(error);
        reject(error);
      };

      ws.onclose = () => {
        this.clearKeepAlive();
        this.ws = null;
        this.opening = null;
        this.callbacks.onStatus?.("Deepgram STT closed.");
      };
    });

    return this.opening;
  }

  pushAudio(chunk: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      return;
    }
    this.queue.push(chunk);
  }

  async stop(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Finalize" }));
      await delay(envNumber("EVENHUB_STT_FINALIZE_WAIT_MS", 900));
      this.ws.close();
    }
    this.queue = [];
    this.clearKeepAlive();
  }

  close(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
    this.queue = [];
    this.clearKeepAlive();
  }

  private flushQueue(): void {
    const queued = this.queue;
    this.queue = [];
    for (const chunk of queued) {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.queue.unshift(chunk);
        return;
      }
      this.ws.send(chunk);
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

  private clearKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

export function createEvenHubSttAdapter(callbacks: EvenHubSttCallbacks): EvenHubSttAdapter | null {
  const provider = (process.env.EVENHUB_STT_PROVIDER || "").trim().toLowerCase();
  const apiKey = (process.env.DEEPGRAM_API_KEY || "").trim();
  if ((provider === "deepgram" || (!provider && apiKey)) && apiKey) {
    return new DeepgramEvenHubSttAdapter(apiKey, callbacks);
  }
  return null;
}
