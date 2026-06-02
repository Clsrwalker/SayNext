import { expect, test } from "bun:test";
import { EvenHubRuntime } from "../evenhub/runtime";
import { parseEvenHubClientMessage, type EvenHubServerMessage } from "../evenhub/protocol";
import type { EvenHubSttAdapter, EvenHubSttCallbacks } from "../evenhub/stt";
import type { ManualActionResult, ManualRuntimeState } from "../mastra/agents";

type TestManualHandler = NonNullable<ConstructorParameters<typeof EvenHubRuntime>[0]["manualHandler"]>;

function makeState(overrides: Partial<ManualRuntimeState> = {}): ManualRuntimeState {
  return {
    mode: "g2_manual",
    sessionId: "evenhub-test-session",
    transcriptCount: 0,
    lastGeneratedCursor: null,
    pending: null,
    currentAnswer: null,
    stateVersion: 1,
    ...overrides,
  };
}

function okResult(text = "A database index helps the database find rows faster."): ManualActionResult {
  return {
    status: "ok",
    sessionId: "evenhub-test-session",
    state: makeState({ stateVersion: 2 }),
    answer: {
      answerGroupId: "group-1",
      answerId: "answer-1",
      pageIndex: 0,
      totalPages: 1,
      text,
      output: text,
    },
  };
}

function makeManualHandler(transcripts: string[] = []): TestManualHandler {
  return {
    processTranscript: async (text: string) => {
      transcripts.push(text);
    },
    generateManualAnswer: async () => okResult(),
    regenerateManualAnswer: async () => okResult("Regenerated answer."),
    pageManualAnswer: () => okResult("Next page answer."),
    clearManualAnswer: (): ManualActionResult => ({ status: "cleared", sessionId: "evenhub-test-session", state: makeState({ stateVersion: 3 }) }),
    getManualState: () => makeState(),
    getRuntimeSessionId: () => "evenhub-test-session",
  };
}

class FakeSttAdapter implements EvenHubSttAdapter {
  started = false;
  stopped = false;
  chunks: Uint8Array[] = [];

  constructor(private readonly callbacks: EvenHubSttCallbacks) {}

  async start(): Promise<void> {
    this.started = true;
    this.callbacks.onStatus?.("fake stt connected");
  }

  pushAudio(chunk: Uint8Array): void {
    this.chunks.push(chunk);
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  close(): void {
    this.stopped = true;
  }

  async emit(text: string, isFinal: boolean): Promise<void> {
    await this.callbacks.onTranscript({ text, isFinal });
  }
}

test("parseEvenHubClientMessage accepts debug transcripts and control commands", () => {
  expect(parseEvenHubClientMessage(JSON.stringify({ type: "debug_transcript", text: "What is a GSI?" })))
    .toMatchObject({ type: "debug_transcript", text: "What is a GSI?" });
  expect(parseEvenHubClientMessage(JSON.stringify({ type: "control", action: "generate" })))
    .toMatchObject({ type: "control", action: "generate" });
  expect(parseEvenHubClientMessage(JSON.stringify({ type: "control", action: "bad" }))).toBeNull();
});

test("EvenHubRuntime commits debug transcript and emits generated answer", async () => {
  const sent: EvenHubServerMessage[] = [];
  const transcripts: string[] = [];
  const runtime = new EvenHubRuntime({
    userId: "test-user",
    send: (message) => sent.push(message),
    manualHandler: makeManualHandler(transcripts),
  });

  runtime.handleOpen();
  await runtime.handleClientMessage({ type: "debug_transcript", text: "What is a database index?", autoGenerate: true });

  expect(transcripts).toEqual(["What is a database index?"]);
  expect(sent.some((message) => message.type === "status" && message.status === "connected")).toBe(true);
  expect(sent.some((message) => message.type === "transcript_final" && message.text.includes("database index"))).toBe(true);
  expect(sent.some((message) => message.type === "answer_page" && message.text.includes("find rows faster"))).toBe(true);
  expect(sent.some((message) => message.type === "answer_done" && message.status === "ok")).toBe(true);
});

test("EvenHubRuntime reports audio chunk receipt before STT adapter is enabled", () => {
  const sent: EvenHubServerMessage[] = [];
  const runtime = new EvenHubRuntime({
    userId: "test-user",
    send: (message) => sent.push(message),
    manualHandler: makeManualHandler(),
    sttAdapterFactory: () => null,
  });

  runtime.handleAudioChunk(new Uint8Array([1, 2, 3, 4]));

  expect(sent).toContainEqual(expect.objectContaining({
    type: "status",
    status: "audio_received",
    sessionId: "evenhub-test-session",
    audioBytesReceived: 4,
    message: "Audio received while not listening; STT idle.",
  }));
});

test("EvenHubRuntime streams listening audio into STT and commits final transcripts", async () => {
  const sent: EvenHubServerMessage[] = [];
  const transcripts: string[] = [];
  const adapter = { current: null as FakeSttAdapter | null };
  const runtime = new EvenHubRuntime({
    userId: "test-user",
    send: (message) => sent.push(message),
    manualHandler: makeManualHandler(transcripts),
    sttAdapterFactory: (callbacks) => {
      adapter.current = new FakeSttAdapter(callbacks);
      return adapter.current;
    },
  });

  await runtime.handleClientMessage({ type: "control", action: "start_listening" });
  runtime.handleAudioChunk(new Uint8Array([10, 20, 30]));
  const fake = adapter.current;
  if (!fake) throw new Error("fake STT adapter was not created");
  await fake.emit("what is a database index", false);
  await fake.emit("what is a database index", true);
  await runtime.handleClientMessage({ type: "control", action: "stop_listening" });

  expect(fake?.started).toBe(true);
  expect(fake?.stopped).toBe(true);
  expect(fake?.chunks).toHaveLength(1);
  expect(transcripts).toEqual(["what is a database index"]);
  expect(sent.some((message) => message.type === "transcript_partial" && message.text.includes("database index"))).toBe(true);
  expect(sent.some((message) => message.type === "transcript_final" && message.text.includes("database index"))).toBe(true);
});

test("EvenHubRuntime commits the latest partial transcript before manual generate", async () => {
  const sent: EvenHubServerMessage[] = [];
  const transcripts: string[] = [];
  const adapter = { current: null as FakeSttAdapter | null };
  const runtime = new EvenHubRuntime({
    userId: "test-user",
    send: (message) => sent.push(message),
    manualHandler: makeManualHandler(transcripts),
    sttAdapterFactory: (callbacks) => {
      adapter.current = new FakeSttAdapter(callbacks);
      return adapter.current;
    },
  });

  await runtime.handleClientMessage({ type: "control", action: "start_listening" });
  await adapter.current?.emit("what is a database index", false);
  await runtime.handleClientMessage({ type: "control", action: "generate", clientEventId: "generate-from-partial" });

  expect(transcripts).toEqual(["what is a database index"]);
  expect(sent.some((message) => message.type === "transcript_partial" && message.text.includes("database index"))).toBe(true);
  expect(sent.some((message) => message.type === "answer_page")).toBe(true);
});

test("EvenHubRuntime can reattach a client and replay pinned answer", async () => {
  const firstClient: EvenHubServerMessage[] = [];
  const secondClient: EvenHubServerMessage[] = [];
  const runtime = new EvenHubRuntime({
    userId: "test-user",
    clientSessionId: "client-session-1",
    send: (message) => firstClient.push(message),
    manualHandler: makeManualHandler(),
  });

  await runtime.handleClientMessage({ type: "debug_transcript", text: "What is a database index?", autoGenerate: true });
  await runtime.detachClient();
  runtime.attachClient((message) => secondClient.push(message));
  runtime.handleOpen();

  expect(firstClient.some((message) => message.type === "answer_page" && message.text.includes("find rows faster"))).toBe(true);
  expect(secondClient.some((message) => message.type === "status" && message.status === "connected")).toBe(true);
  expect(secondClient.some((message) => message.type === "answer_page" && message.text.includes("find rows faster"))).toBe(true);
});
