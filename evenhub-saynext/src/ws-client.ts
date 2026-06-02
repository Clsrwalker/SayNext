import { APP_VERSION, type ClientMessage, type SayNextSettings, type ServerMessage } from "./protocol";

type WsClientOptions = {
  url: string;
  token: string;
  userId: string;
  sessionId: string;
  settings: SayNextSettings;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: string) => void;
  onOpen?: () => void;
};

export class SayNextWsClient {
  private ws: WebSocket | null = null;
  private readonly options: WsClientOptions;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(options: WsClientOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.close();
    this.manualClose = false;
    this.clearReconnectTimer();
    const url = new URL(this.options.url);
    if (this.options.token.trim()) url.searchParams.set("token", this.options.token.trim());
    if (this.options.userId.trim()) url.searchParams.set("userId", this.options.userId.trim());
    if (this.options.sessionId.trim()) url.searchParams.set("sessionId", this.options.sessionId.trim());

    this.options.onStatus("Connecting...");
    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.options.onStatus("Connected");
      this.send({
        type: "hello",
        userId: this.options.userId,
        sessionId: this.options.sessionId,
        token: this.options.token,
        settings: this.options.settings,
        client: {
          name: "evenhub-saynext",
          version: APP_VERSION,
        },
      });
      this.options.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.options.onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        this.options.onStatus("Invalid server message");
      }
    };

    this.ws.onerror = () => this.options.onStatus("WebSocket error");
    this.ws.onclose = () => {
      this.options.onStatus("Disconnected");
      if (!this.manualClose) this.scheduleReconnect();
    };
  }

  close(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    if (!this.ws) return;
    this.ws.close();
    this.ws = null;
  }

  send(message: ClientMessage): void {
    if (!this.connected || !this.ws) {
      this.options.onStatus("Not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  sendAudio(pcm: Uint8Array): void {
    if (!this.connected || !this.ws) return;
    this.ws.send(pcm);
  }

  sendControl(action: Extract<ClientMessage, { type: "control" }>["action"]): void {
    this.send({
      type: "control",
      action,
      clientEventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  sendSettings(settings: Partial<SayNextSettings>): void {
    this.send({
      type: "settings",
      settings,
    });
  }

  sendDebugTranscript(text: string, autoGenerate: boolean): void {
    this.send({
      type: "debug_transcript",
      text,
      isFinal: true,
      autoGenerate,
      clientEventId: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  sendClientEventLog(summary: string, payload?: unknown): void {
    if (import.meta.env.VITE_SAYNEXT_SEND_EVENT_LOGS !== "true") return;
    this.send({
      type: "client_event_log",
      summary,
      payload,
      clientEventId: `client-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delayMs = Math.min(8000, 750 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.options.onStatus(`Reconnecting in ${Math.round(delayMs / 1000)}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.ws = null;
      this.connect();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
