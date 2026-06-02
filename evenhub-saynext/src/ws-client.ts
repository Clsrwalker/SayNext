import { APP_VERSION, type ClientMessage, type SayNextSettings, type ServerMessage } from "./protocol";

type WsClientOptions = {
  url: string;
  token: string;
  userId: string;
  sessionId: string;
  settings: SayNextSettings;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: string) => void;
};

export class SayNextWsClient {
  private ws: WebSocket | null = null;
  private readonly options: WsClientOptions;

  constructor(options: WsClientOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.close();
    const url = new URL(this.options.url);
    if (this.options.token.trim()) url.searchParams.set("token", this.options.token.trim());
    if (this.options.userId.trim()) url.searchParams.set("userId", this.options.userId.trim());
    if (this.options.sessionId.trim()) url.searchParams.set("sessionId", this.options.sessionId.trim());

    this.options.onStatus("Connecting...");
    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
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
    this.ws.onclose = () => this.options.onStatus("Disconnected");
  }

  close(): void {
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
}
