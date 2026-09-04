import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  AssemblyAiEvenHubSttAdapter,
  createEvenHubSttAdapter,
  makeAssemblyAiUrl,
  parseAssemblyAiTranscriptEvent,
} from "../evenhub/stt";

const ENV_KEYS = [
  "ASSEMBLYAI_API_KEY",
  "ASSEMBLYAI_STT_HOST",
  "ASSEMBLYAI_STT_LANGUAGE_CODE",
  "ASSEMBLYAI_STT_MAX_TURN_SILENCE_MS",
  "ASSEMBLYAI_STT_MIN_TURN_SILENCE_MS",
  "ASSEMBLYAI_STT_MODE",
  "ASSEMBLYAI_STT_MODEL",
  "ASSEMBLYAI_STT_REGION",
  "ASSEMBLYAI_STT_RECONNECT_BASE_MS",
  "ASSEMBLYAI_STT_RECONNECT_BUFFER_MS",
  "ASSEMBLYAI_STT_RECONNECT_MAX_MS",
  "ASSEMBLYAI_STT_SAMPLE_RATE",
  "ASSEMBLYAI_STT_TERMINATE_WAIT_MS",
  "DEEPGRAM_API_KEY",
  "EVENHUB_STT_PROVIDER",
  "EVENHUB_STT_SAMPLE_RATE",
] as const;

const originalEnv = new Map<string, string | undefined>();
const originalWebSocket = globalThis.WebSocket;

class ReconnectableFakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: ReconnectableFakeWebSocket[] = [];

  readyState = ReconnectableFakeWebSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly options?: unknown,
  ) {
    ReconnectableFakeWebSocket.instances.push(this);
    queueMicrotask(() => this.serverOpen());
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === ReconnectableFakeWebSocket.CLOSED) return;
    this.readyState = ReconnectableFakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  serverOpen(): void {
    if (this.readyState !== ReconnectableFakeWebSocket.CONNECTING) return;
    this.readyState = ReconnectableFakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverClose(code: number, reason: string): void {
    this.close(code, reason);
  }

  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

async function waitForSocketCount(count: number): Promise<void> {
  const deadline = Date.now() + 250;
  while (ReconnectableFakeWebSocket.instances.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(ReconnectableFakeWebSocket.instances).toHaveLength(count);
  await Promise.resolve();
}

beforeEach(() => {
  ReconnectableFakeWebSocket.instances = [];
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
  globalThis.WebSocket = originalWebSocket;
});

test("makeAssemblyAiUrl uses realtime STT defaults", () => {
  const url = new URL(makeAssemblyAiUrl());

  expect(url.origin).toBe("wss://streaming.assemblyai.com");
  expect(url.pathname).toBe("/v3/ws");
  expect(url.searchParams.get("sample_rate")).toBe("16000");
  expect(url.searchParams.get("speech_model")).toBe("universal-3-5-pro");
  expect(url.searchParams.get("mode")).toBe("max_accuracy");
});

test("makeAssemblyAiUrl applies an explicit session language over the environment", () => {
  process.env.ASSEMBLYAI_STT_LANGUAGE_CODE = "fr";

  const url = new URL(makeAssemblyAiUrl({ languageCode: "en" }));

  expect(url.searchParams.get("language_code")).toBe("en");
});

test("makeAssemblyAiUrl omits language_code for an explicit auto-language session", () => {
  process.env.ASSEMBLYAI_STT_LANGUAGE_CODE = "fr";

  const url = new URL(makeAssemblyAiUrl({ languageCode: null }));

  expect(url.searchParams.has("language_code")).toBe(false);
});

test("makeAssemblyAiUrl supports region and turn silence overrides", () => {
  process.env.ASSEMBLYAI_STT_REGION = "eu";
  process.env.ASSEMBLYAI_STT_SAMPLE_RATE = "16000";
  process.env.ASSEMBLYAI_STT_MODEL = "u3-rt-pro";
  process.env.ASSEMBLYAI_STT_MODE = "balanced";
  process.env.ASSEMBLYAI_STT_MIN_TURN_SILENCE_MS = "200";
  process.env.ASSEMBLYAI_STT_MAX_TURN_SILENCE_MS = "2000";

  const url = new URL(makeAssemblyAiUrl());

  expect(url.origin).toBe("wss://streaming.eu.assemblyai.com");
  expect(url.searchParams.get("speech_model")).toBe("u3-rt-pro");
  expect(url.searchParams.get("mode")).toBe("balanced");
  expect(url.searchParams.get("min_turn_silence")).toBe("200");
  expect(url.searchParams.get("max_turn_silence")).toBe("2000");
});

test("parseAssemblyAiTranscriptEvent maps Turn messages to transcript events", () => {
  expect(parseAssemblyAiTranscriptEvent(JSON.stringify({
    type: "Turn",
    transcript: "partial text",
    end_of_turn: false,
  }))).toEqual({
    text: "partial text",
    isFinal: false,
  });

  expect(parseAssemblyAiTranscriptEvent(JSON.stringify({
    type: "Turn",
    transcript: "final text",
    end_of_turn: true,
  }))).toEqual({
    text: "final text",
    isFinal: true,
  });

  expect(parseAssemblyAiTranscriptEvent(JSON.stringify({ type: "SpeechStarted" }))).toBeNull();
});

test("parseAssemblyAiTranscriptEvent preserves eager utterance and provider turn identity", () => {
  expect(parseAssemblyAiTranscriptEvent(JSON.stringify({
    type: "Turn",
    turn_order: 7,
    transcript: "Could you explain your most relevant project",
    utterance: "Could you explain your",
    end_of_turn: false,
  }))).toEqual({
    text: "Could you explain your most relevant project",
    isFinal: false,
    utterance: "Could you explain your",
    turnOrder: 7,
  });
});

test("createEvenHubSttAdapter selects AssemblyAI only when requested", () => {
  process.env.EVENHUB_STT_PROVIDER = "assemblyai";
  process.env.ASSEMBLYAI_API_KEY = "test-key";
  process.env.DEEPGRAM_API_KEY = "deepgram-key";

  const adapter = createEvenHubSttAdapter({ onTranscript: () => undefined });

  expect(adapter).toBeInstanceOf(AssemblyAiEvenHubSttAdapter);
  expect(adapter?.provider).toBe("assemblyai");
});

test("AssemblyAiEvenHubSttAdapter streams audio, emits turns, and terminates", async () => {
  const instances: FakeWebSocket[] = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    binaryType = "";
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(
      readonly url: string,
      readonly options?: unknown,
    ) {
      instances.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(data: unknown): void {
      this.sent.push(data);
    }

    close(): void {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  const transcripts: Array<{ text: string; isFinal: boolean }> = [];
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: (event) => {
      transcripts.push(event);
    },
  });

  await adapter.start();
  const socket = instances[0];
  adapter.pushAudio(new Uint8Array([1, 2, 3]));
  socket.onmessage?.({ data: JSON.stringify({ type: "Turn", transcript: "hello", end_of_turn: false }) });
  socket.onmessage?.({ data: JSON.stringify({ type: "Turn", transcript: "hello world.", end_of_turn: true }) });

  expect(socket.sent[0]).toEqual(new Uint8Array([1, 2, 3]));
  expect(transcripts).toEqual([
    { text: "hello", isFinal: false },
    { text: "hello world.", isFinal: true },
  ]);

  expect(adapter.forceEndpoint()).toBe(true);
  expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "ForceEndpoint" }));

  const stopped = adapter.stop();
  expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
  socket.onmessage?.({ data: JSON.stringify({ type: "Termination" }) });
  await stopped;
});

test("AssemblyAiEvenHubSttAdapter reconnects once after an unexpected close and flushes queued audio", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "1";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "2";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const connectionStates: string[] = [];
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
    onConnectionState: (event) => connectionStates.push(event.status),
  });

  await adapter.start();
  const first = ReconnectableFakeWebSocket.instances[0];
  first.serverClose(1006, "network interrupted");
  adapter.pushAudio(new Uint8Array([4, 5, 6, 7]));

  await waitForSocketCount(2);
  const second = ReconnectableFakeWebSocket.instances[1];

  expect(connectionStates).toContain("reconnecting");
  expect(connectionStates.at(-1)).toBe("connected");
  expect(second.sent).toContainEqual(new Uint8Array([4, 5, 6, 7]));

  await adapter.close();
});

test("AssemblyAiEvenHubSttAdapter limits the default reconnect replay to the latest 500ms", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "10";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "10";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
  });

  await adapter.start();
  ReconnectableFakeWebSocket.instances[0].serverClose(1006, "network interrupted");
  const chunks = Array.from(
    { length: 20 },
    (_, index) => new Uint8Array(1600).fill(index + 1),
  );
  for (const chunk of chunks) adapter.pushAudio(chunk);

  await waitForSocketCount(2);
  const replayed = ReconnectableFakeWebSocket.instances[1].sent.filter(
    (value): value is Uint8Array => value instanceof Uint8Array,
  );

  expect(replayed).toHaveLength(10);
  expect(replayed).toEqual(chunks.slice(-10));

  await adapter.close();
});

test("AssemblyAiEvenHubSttAdapter preserves the session language across reconnects", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "1";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "2";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
  });

  await adapter.start({ languageCode: "en" });
  const first = ReconnectableFakeWebSocket.instances[0];
  first.serverClose(1006, "network interrupted");

  await waitForSocketCount(2);
  const second = ReconnectableFakeWebSocket.instances[1];

  expect(new URL(first.url).searchParams.get("language_code")).toBe("en");
  expect(new URL(second.url).searchParams.get("language_code")).toBe("en");

  await adapter.close();
});

test("AssemblyAiEvenHubSttAdapter never reconnects after an intentional stop", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "1";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "2";
  process.env.ASSEMBLYAI_STT_TERMINATE_WAIT_MS = "1";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
  });

  await adapter.start();
  const stopped = adapter.stop();
  ReconnectableFakeWebSocket.instances[0].serverMessage({ type: "Termination" });
  await stopped;
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(ReconnectableFakeWebSocket.instances).toHaveLength(1);
});

test("AssemblyAiEvenHubSttAdapter treats authentication closure as fatal without retrying", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "1";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "2";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const errors: string[] = [];
  const connectionStates: string[] = [];
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
    onError: (error) => errors.push(error.message),
    onConnectionState: (event) => connectionStates.push(event.status),
  });

  await adapter.start();
  ReconnectableFakeWebSocket.instances[0].serverClose(1008, "invalid authentication");
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(ReconnectableFakeWebSocket.instances).toHaveLength(1);
  expect(connectionStates.at(-1)).toBe("failed");
  expect(errors.at(-1)).toContain("1008");
});

test("AssemblyAiEvenHubSttAdapter bounds reconnect audio and keeps the newest PCM", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "10";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "10";
  process.env.ASSEMBLYAI_STT_RECONNECT_BUFFER_MS = "1";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
  });

  await adapter.start();
  ReconnectableFakeWebSocket.instances[0].serverClose(1006, "network interrupted");
  adapter.pushAudio(new Uint8Array(16).fill(1));
  adapter.pushAudio(new Uint8Array(16).fill(2));
  adapter.pushAudio(new Uint8Array(16).fill(3));

  await waitForSocketCount(2);
  const replayed = ReconnectableFakeWebSocket.instances[1].sent.filter(
    (value): value is Uint8Array => value instanceof Uint8Array,
  );

  expect(replayed).toEqual([
    new Uint8Array(16).fill(2),
    new Uint8Array(16).fill(3),
  ]);

  await adapter.close();
});

test("AssemblyAiEvenHubSttAdapter reconnects when an open socket rejects an audio send", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "1";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "2";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
  });

  await adapter.start();
  const first = ReconnectableFakeWebSocket.instances[0];
  first.send = () => {
    throw new Error("socket write failed");
  };
  adapter.pushAudio(new Uint8Array([10, 11, 12, 13]));

  await waitForSocketCount(2);
  expect(ReconnectableFakeWebSocket.instances[1].sent).toContainEqual(
    new Uint8Array([10, 11, 12, 13]),
  );

  await adapter.close();
});

test("AssemblyAiEvenHubSttAdapter ignores a late close from the replaced socket", async () => {
  process.env.ASSEMBLYAI_STT_RECONNECT_BASE_MS = "1";
  process.env.ASSEMBLYAI_STT_RECONNECT_MAX_MS = "2";
  globalThis.WebSocket = ReconnectableFakeWebSocket as unknown as typeof WebSocket;
  const adapter = new AssemblyAiEvenHubSttAdapter("test-key", {
    onTranscript: () => undefined,
  });

  await adapter.start();
  const first = ReconnectableFakeWebSocket.instances[0];
  first.serverClose(1006, "network interrupted");
  await waitForSocketCount(2);
  first.onclose?.({ code: 1006, reason: "late duplicate close", wasClean: false });
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(ReconnectableFakeWebSocket.instances).toHaveLength(2);

  await adapter.close();
});
