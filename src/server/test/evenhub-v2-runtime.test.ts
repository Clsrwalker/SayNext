import { expect, test } from "bun:test";
import type { AutoCueGenerationResult, AutoCueGenerator, AutoCueGeneratorInput } from "../evenhub-v2/auto-cue-generator";
import { createEvenHubV2ClientMessage, type EvenHubV2ServerMessage } from "../evenhub-v2/protocol";
import { EvenHubV2Runtime } from "../evenhub-v2/runtime";
import { EvenHubV2Store } from "../evenhub-v2/store";

class FakeSummaryRunner {
  events: string[] = [];

  constructor(private readonly store: EvenHubV2Store) {}

  queueSummary(input: { conversationId: string; userId: string; queuedAt?: string }): void {
    this.events.push("queue");
    this.store.queueSummary({
      id: `summary-${input.conversationId}`,
      conversationId: input.conversationId,
      userId: input.userId,
      queuedAt: input.queuedAt || "2026-06-12T00:00:00.000Z",
    });
  }

  enqueue(conversationId: string): void {
    this.events.push(`enqueue:${conversationId}`);
  }
}

class FakeAutoCueGenerator implements AutoCueGenerator {
  calls: AutoCueGeneratorInput[] = [];

  constructor(private readonly result: AutoCueGenerationResult | (() => Promise<AutoCueGenerationResult>)) {}

  async generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult> {
    this.calls.push(input);
    return typeof this.result === "function" ? this.result() : this.result;
  }
}

function validCue(overrides: Partial<AutoCueGenerationResult["data"]> = {}): AutoCueGenerationResult {
  return {
    model: "fake-model",
    rawText: JSON.stringify({
      category: "concept",
      confidence: 0.92,
      title: "Batch norm idea",
      g2Title: "Batch norm",
      output: "Batch normalization normalizes activations with batch statistics, then learns scale and shift.",
      reason: "clear concept explanation",
      ...overrides,
    }),
    data: {
      category: "concept",
      confidence: 0.92,
      title: "Batch norm idea",
      g2Title: "Batch norm",
      output: "Batch normalization normalizes activations with batch statistics, then learns scale and shift.",
      reason: "clear concept explanation",
      ...overrides,
    },
  };
}

function makeRuntime(
  generator: AutoCueGenerator,
  sent: EvenHubV2ServerMessage[],
  store = new EvenHubV2Store(":memory:"),
  overrides: Partial<ConstructorParameters<typeof EvenHubV2Runtime>[0]> = {},
) {
  const summaryRunner = new FakeSummaryRunner(store);
  return {
    store,
    summaryRunner,
    runtime: new EvenHubV2Runtime({
      userId: "test-user",
      clientSessionId: "client-1",
      send: (message) => {
        if (message.type === "conversation_saved") summaryRunner.events.push("saved");
        sent.push(message);
      },
      store,
      summaryRunner,
      autoCueGenerator: generator,
      sttAdapterFactory: () => null,
      debounceMs: 60_000,
      cooldownMs: 0,
      finalFlushTimeoutMs: 0,
      confidenceThreshold: 0.75,
      ...overrides,
    }),
  };
}

async function start(runtime: EvenHubV2Runtime) {
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_start", {
    selectedPrenoteIds: ["pn-1"],
    selectedPrenoteText: "Use batch norm notes if relevant.",
  }));
}

test("EvenHubV2Runtime creates a cue from final transcript through the auto pipeline", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "The professor is explaining batch normalization and activation statistics.",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.calls).toHaveLength(1);
  expect(sent.some((message) => message.type === "transcript_final")).toBe(true);
  expect(sent.some((message) => message.type === "cue_created" && message.payload?.g2Title === "Batch norm")).toBe(true);
  expect(store.listTranscriptLines(conversationId)).toHaveLength(1);
  expect(store.listCues(conversationId)).toHaveLength(1);
});

test("EvenHubV2Runtime stores low-confidence attempts without pushing cue_created", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue({ category: "none", confidence: 0.2, title: "", g2Title: "", output: "" }));
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "so um yeah",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(sent.some((message) => message.type === "cue_created")).toBe(false);
  expect(store.listCues(conversationId)).toHaveLength(0);
  const attempts = store.getDb().query("SELECT * FROM evenhub_v2_auto_cue_attempts WHERE conversation_id = ?").all(conversationId) as any[];
  expect(attempts).toHaveLength(1);
  expect(attempts[0].status).toBe("skipped");
});

test("EvenHubV2Runtime keeps accepting transcript while an auto job is running", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  let resolveJob!: (value: AutoCueGenerationResult) => void;
  const generator = new FakeAutoCueGenerator(() => new Promise<AutoCueGenerationResult>((resolve) => {
    resolveJob = resolve;
  }));
  const { runtime } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "First final transcript about batch normalization.",
    isFinal: true,
  }));
  const flush = runtime.flushCueBufferNow();
  await Promise.resolve();
  expect(runtime.snapshot.activeAutoJobs.size).toBe(1);

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Second final transcript arrives while generation is running.",
    isFinal: true,
  }));
  expect(sent.filter((message) => message.type === "transcript_final")).toHaveLength(2);

  resolveJob(validCue());
  await flush;
});

test("EvenHubV2Runtime saves pending partial transcript as partial_timeout on end", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "this is only a partial",
    isFinal: false,
  }));
  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));

  const lines = store.listTranscriptLines(conversationId);
  expect(lines).toHaveLength(1);
  expect(lines[0].source).toBe("partial_timeout");
  expect(lines[0].text).toBe("this is only a partial");
  expect(sent.some((message) => message.type === "conversation_saved")).toBe(true);
});

test("EvenHubV2Runtime does not save very short partial_timeout fragments", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Is",
    isFinal: false,
  }));
  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));

  expect(store.listTranscriptLines(conversationId)).toHaveLength(0);
  expect(sent.some((message) => message.type === "conversation_saved")).toBe(true);
});

test("EvenHubV2Runtime clears stale partial text after a different final arrives", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "the old partial wording that should not be saved",
    isFinal: false,
  }));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "the final wording arrived from deepgram",
    isFinal: true,
  }));
  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));

  const lines = store.listTranscriptLines(conversationId);
  expect(lines).toHaveLength(1);
  expect(lines[0].source).toBe("debug");
  expect(lines[0].text).toBe("the final wording arrived from deepgram");
});

test("EvenHubV2Runtime labels STT transcript lines with the active provider", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  let emitTranscript!: (input: { text: string; isFinal: boolean }) => Promise<void> | void;
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    sttAdapterFactory: (callbacks) => {
      emitTranscript = callbacks.onTranscript;
      return {
        provider: "assemblyai",
        start: async () => undefined,
        pushAudio: () => undefined,
        stop: async () => undefined,
        close: () => undefined,
      };
    },
  });

  await start(runtime);
  await emitTranscript({
    text: "AssemblyAI final transcript should keep provider source.",
    isFinal: true,
  });

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  const lines = store.listTranscriptLines(conversationId);
  expect(lines).toHaveLength(1);
  expect(lines[0].source).toBe("assemblyai");
});

test("EvenHubV2Runtime ignores duplicate conversation_end while already ending", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    finalFlushTimeoutMs: 25,
  });

  await start(runtime);
  const firstEnd = runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));
  await firstEnd;

  expect(sent.filter((message) => message.type === "conversation_saved")).toHaveLength(1);
  expect(sent.some((message) => message.type === "error" && message.payload?.code === "conversation_not_active")).toBe(false);
});

test("EvenHubV2Runtime includes aggregate audio stats and client source diagnostics when saved", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    sttAdapterFactory: () => ({
      start: async () => undefined,
      pushAudio: () => undefined,
      stop: async () => undefined,
      close: () => undefined,
    }),
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("audio_start", {
    audioSource: "phone",
  }));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("audio_diagnostics", {
    selectedSource: "phone",
    chunkCount: 2,
    byteCount: 8,
    sourceCounts: { phone: 1, glasses: 1, unknown: 0 },
    mismatchCount: 1,
  }));
  runtime.handleAudioChunk(new Uint8Array([0, 0, 0, 0]));
  runtime.handleAudioChunk(new Uint8Array([232, 3, 24, 252]));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));

  const saved = sent.find((message) => message.type === "conversation_saved");
  expect(saved?.payload).toMatchObject({
    audioStats: {
      chunkCount: 2,
      byteCount: 8,
      selectedSource: "phone",
      clientSourceCounts: {
        phone: 1,
        glasses: 1,
        unknown: 0,
      },
      clientMismatchCount: 1,
    },
  });
  expect((saved?.payload as any).audioStats.avgRms).toBeGreaterThan(0);
});

test("EvenHubV2Runtime queues summary before conversation_saved and enqueues after saved", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store, summaryRunner } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "The final transcript should be saved before summary generation starts.",
    isFinal: true,
  }));
  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));

  expect(store.getSummary(conversationId)?.status).toBe("queued");
  expect(summaryRunner.events).toEqual(["queue", "saved", `enqueue:${conversationId}`]);
});

test("EvenHubV2Runtime sends realtime transcript offsets for partial and final text", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "partial transcript should show immediately",
    isFinal: false,
  }));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "final transcript should keep a stable relative time",
    isFinal: true,
  }));

  const partial = sent.find((message) => message.type === "transcript_partial");
  const final = sent.find((message) => message.type === "transcript_final");
  expect(partial?.payload).toMatchObject({
    text: "partial transcript should show immediately",
    offsetMs: expect.any(Number),
  });
  expect(final?.payload).toMatchObject({
    text: "final transcript should keep a stable relative time",
    offsetMs: expect.any(Number),
  });
});

test("EvenHubV2Runtime queues audio chunks while STT is starting", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const pushed: Uint8Array[] = [];
  let resolveStart!: () => void;
  const startPromise = new Promise<void>((resolve) => {
    resolveStart = resolve;
  });
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    sttAdapterFactory: () => ({
      start: () => startPromise,
      pushAudio: (chunk) => pushed.push(chunk),
      stop: async () => undefined,
      close: () => undefined,
    }),
  });

  await start(runtime);
  const audioStart = runtime.handleClientMessage(createEvenHubV2ClientMessage("audio_start", {}));
  await Promise.resolve();
  runtime.handleAudioChunk(new Uint8Array([1, 2, 3]));
  expect(pushed).toHaveLength(1);

  resolveStart();
  await audioStart;
});

test("EvenHubV2Runtime includes selected audio source in audio status", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    sttAdapterFactory: () => ({
      start: async () => undefined,
      pushAudio: () => undefined,
      stop: async () => undefined,
      close: () => undefined,
    }),
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("audio_start", {
    audioSource: "phone",
  }));

  const audioStatuses = sent.filter((message) => message.type === "audio_status");
  expect(audioStatuses.at(-1)).toMatchObject({
    payload: {
      audioStatus: "listening",
      audioSource: "phone",
    },
  });
});

test("EvenHubV2Store deletes a conversation with transcript and cues", () => {
  const store = new EvenHubV2Store(":memory:");
  const conversationId = "conv-delete";
  store.createConversation({
    id: conversationId,
    userId: "test-user",
    clientSessionId: "client-1",
    title: "Delete me",
    startedAt: "2026-06-11T00:00:00.000Z",
    settings: {
      language: "english",
      cueDurationMs: 10000,
      autoPopup: true,
      showAiCue: true,
      showTranscript: true,
    },
    usedPrenote: { ids: [], text: "" },
  });
  store.addTranscriptLine({
    id: "line-delete",
    conversationId,
    userId: "test-user",
    lineIndex: 0,
    text: "Saved transcript",
    receivedAt: "2026-06-11T00:00:01.000Z",
    source: "debug",
  });
  store.createAutoCueAttempt({
    id: "attempt-delete",
    conversationId,
    userId: "test-user",
    requestId: "req-delete",
    status: "running",
    inputHash: "hash-delete",
    inputWindow: "Saved transcript",
    sourceTranscriptLineIds: ["line-delete"],
    promptContextSnapshot: "",
  });
  store.createCue({
    id: "cue-delete",
    conversationId,
    userId: "test-user",
    attemptId: "attempt-delete",
    category: "concept",
    title: "Saved cue",
    g2Title: "Cue",
    output: "A saved cue.",
    sourceTranscriptLineIds: ["line-delete"],
    createdAt: "2026-06-11T00:00:02.000Z",
  });

  expect(store.deleteConversation("other-user", conversationId)).toBe(false);
  expect(store.getConversation(conversationId)).not.toBeNull();

  expect(store.deleteConversation("test-user", conversationId)).toBe(true);
  expect(store.getConversation(conversationId)).toBeNull();
  expect(store.listTranscriptLines(conversationId)).toHaveLength(0);
  expect(store.listCues(conversationId)).toHaveLength(0);
  const attempts = store.getDb().query("SELECT * FROM evenhub_v2_auto_cue_attempts WHERE conversation_id = ?").all(conversationId) as any[];
  expect(attempts).toHaveLength(0);
});
