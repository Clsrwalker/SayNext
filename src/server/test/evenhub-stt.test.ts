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
  "ASSEMBLYAI_STT_SAMPLE_RATE",
  "ASSEMBLYAI_STT_TERMINATE_WAIT_MS",
  "DEEPGRAM_API_KEY",
  "EVENHUB_STT_PROVIDER",
  "EVENHUB_STT_SAMPLE_RATE",
] as const;

const originalEnv = new Map<string, string | undefined>();
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
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
    onTranscript: (event) => transcripts.push(event),
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

  const stopped = adapter.stop();
  expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
  socket.onmessage?.({ data: JSON.stringify({ type: "Termination" }) });
  await stopped;
});
