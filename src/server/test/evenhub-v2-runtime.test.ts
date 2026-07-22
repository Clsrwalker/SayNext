import { expect, test } from "bun:test";
import type {
  AutoCueGenerationResult,
  AutoCueGenerator,
  AutoCueGeneratorInput,
  AutoCueSession,
} from "../evenhub-v2/auto-cue-generator";
import type {
  CueOpportunityRouter,
  CueOpportunityRouterInput,
  CueOpportunityRouterResult,
} from "../evenhub-v2/cue-opportunity-router";
import type { EvenHubV2ContextAdapter } from "../evenhub-v2/context-adapter";
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

class LifecycleAutoCueGenerator implements AutoCueGenerator {
  calls: AutoCueGeneratorInput[] = [];
  started: Array<{
    localConversationId: string;
    userId: string;
    selectedPrenoteIds?: string[];
    selectedPrenoteText?: string;
  }> = [];
  committed: Array<{ session: AutoCueSession; question: string; result: AutoCueGenerationResult }> = [];
  ended: AutoCueSession[] = [];
  readonly session: AutoCueSession = {
    providerConversationId: "conv_provider_1",
    promptVersion: "prompt-v1",
    interviewGuideVersion: "guide-v1",
  };

  async startSession(input: {
    localConversationId: string;
    userId: string;
    selectedPrenoteIds?: string[];
    selectedPrenoteText?: string;
  }): Promise<AutoCueSession> {
    this.started.push(input);
    return this.session;
  }

  async generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult> {
    this.calls.push(input);
    return {
      ...validCue(),
      lane: input.speculative ? "stateless_speculative" : "canonical_conversation",
    };
  }

  async commitCanonicalTurn(input: {
    session: AutoCueSession;
    question: string;
    result: AutoCueGenerationResult;
  }): Promise<void> {
    this.committed.push(input);
  }

  async endSession(session: AutoCueSession): Promise<void> {
    this.ended.push(session);
  }
}

class FakeCueOpportunityRouter implements CueOpportunityRouter {
  calls: CueOpportunityRouterInput[] = [];

  constructor(private readonly result: CueOpportunityRouterResult | Error) {}

  async predict(input: CueOpportunityRouterInput): Promise<CueOpportunityRouterResult> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function cueNeededRouterResult(): CueOpportunityRouterResult {
  return {
    probability: 0.998,
    decision: "cue_needed",
    threshold: 0.519233227,
    model: "saynext_context_router_v2",
    latencyMs: 8,
  };
}

function noCueRouterResult(): CueOpportunityRouterResult {
  return {
    probability: 0.18,
    decision: "no_cue",
    threshold: 0.519233227,
    model: "saynext_context_router_v2",
    latencyMs: 8,
  };
}

function validCue(overrides: Partial<AutoCueGenerationResult["data"]> = {}): AutoCueGenerationResult {
  const answer = overrides.fullAnswer || overrides.output
    || "Batch normalization normalizes activations with batch statistics, then learns scale and shift.";
  const data: AutoCueGenerationResult["data"] = {
    category: "concept",
    confidence: 0.92,
    title: "Batch norm idea",
    g2Title: "Batch norm",
    preview: overrides.preview || answer,
    fullAnswer: answer,
    output: answer,
    language: "",
    code: "",
    explanation: "",
    reason: "clear concept explanation",
    ...overrides,
  };
  return {
    model: "fake-model",
    rawText: JSON.stringify(data),
    data,
  };
}

const noMemoryContextAdapter: EvenHubV2ContextAdapter = {
  async build(input) {
    return {
      contextSnapshot: `Trigger window:\n${input.triggerWindow}`,
      memoryUsedIds: [],
      interviewAnswerCardIds: [],
      answerPolicyCardIds: [],
      prenoteUsedIds: input.selectedPrenoteIds,
    };
  },
};

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
      contextAdapter: noMemoryContextAdapter,
      sttAdapterFactory: () => null,
      debounceMs: 60_000,
      finalFlushTimeoutMs: 0,
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
  const generatedCue = validCue({
    preview: "Batch normalization uses batch statistics.",
    fullAnswer: "Batch normalization uses batch statistics, then learns a scale and shift for each activation.",
  });
  const generator = new FakeAutoCueGenerator(generatedCue);
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
  expect(sent.some((message) => message.type === "cue_created"
    && message.payload?.g2Title === "Batch norm"
    && message.payload?.preview === generatedCue.data.fullAnswer
    && message.payload?.fullAnswer === generatedCue.data.fullAnswer)).toBe(true);
  expect(store.listTranscriptLines(conversationId)).toHaveLength(1);
  expect(store.listCues(conversationId)).toHaveLength(1);
  const attempt = store.getDb().query(
    "SELECT trace_json FROM evenhub_v2_auto_cue_attempts WHERE conversation_id = ? LIMIT 1",
  ).get(conversationId) as { trace_json: string };
  expect(JSON.parse(attempt.trace_json).contextLatencyMs).toBeGreaterThanOrEqual(0);
});

test("EvenHubV2Runtime starts routing and memory context work concurrently", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const events: string[] = [];
  let releaseRouter!: () => void;
  let releaseContext!: () => void;
  const routerGate = new Promise<void>((resolve) => { releaseRouter = resolve; });
  const contextGate = new Promise<void>((resolve) => { releaseContext = resolve; });
  const router: CueOpportunityRouter = {
    async predict() {
      events.push("router:start");
      await routerGate;
      return cueNeededRouterResult();
    },
  };
  const contextAdapter: EvenHubV2ContextAdapter = {
    async build(input) {
      events.push("context:start");
      await contextGate;
      return {
        contextSnapshot: input.triggerWindow,
        memoryUsedIds: [],
        interviewAnswerCardIds: [],
        answerPolicyCardIds: [],
        prenoteUsedIds: [],
      };
    },
  };
  const { runtime } = makeRuntime(new FakeAutoCueGenerator(validCue()), sent, new EvenHubV2Store(":memory:"), {
    cueOpportunityRouter: router,
    contextAdapter,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Can you explain your experience building a RAG chatbot?",
    isFinal: true,
  }));
  const flush = runtime.flushCueBufferNow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(events).toEqual(expect.arrayContaining(["router:start", "context:start"]));
  releaseRouter();
  releaseContext();
  await flush;
});

test("EvenHubV2Runtime publishes and stores a structured code cue without flattening it", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const code = [
    "function firstPair(nums: number[], target: number) {",
    "  const seen = new Map<number, number>();",
    "",
    "  for (let i = 0; i < nums.length; i++) {",
    "    const need = target - nums[i];",
    "    if (seen.has(need)) return [seen.get(need), i];",
    "    seen.set(nums[i], i);",
    "  }",
    "",
    "  return [];",
    "}",
  ].join("\n");
  const generator = new FakeAutoCueGenerator(validCue({
    category: "code",
    title: "First matching pair",
    g2Title: "First pair",
    preview: "Use a map to find the complement in one pass.",
    fullAnswer: "I keep previously seen values in a map, so each complement lookup is constant time on average.",
    output: code,
    language: "typescript",
    code,
    explanation: "I keep previously seen values in a map, so each complement lookup is constant time on average.",
  }));
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Can you write a TypeScript function that returns the first pair of indexes whose values add up to a target?",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  const message = sent.find((item) => item.type === "cue_created");
  expect(message?.payload).toMatchObject({
    category: "code",
    language: "typescript",
    code,
    output: code,
    explanation: "I keep previously seen values in a map, so each complement lookup is constant time on average.",
  });
  expect(store.listCues(conversationId)[0]).toMatchObject({ code, language: "typescript" });
});

test("EvenHubV2Runtime creates one provider conversation and passes it to canonical final generation", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new LifecycleAutoCueGenerator();
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Tell me a little bit about yourself.",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.started).toEqual([{
    localConversationId: conversationId,
    userId: "test-user",
    selectedPrenoteIds: ["pn-1"],
    selectedPrenoteText: "Use batch norm notes if relevant.",
  }]);
  expect(generator.calls).toHaveLength(1);
  expect(generator.calls[0].speculative).toBe(false);
  expect(generator.calls[0].session).toEqual(generator.session);
  expect(store.getConversation(conversationId)).toMatchObject({
    openAiConversationId: "conv_provider_1",
    openAiConversationStatus: "active",
  });
});

test("EvenHubV2Runtime fails open to stateless generation when provider conversation creation fails", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const calls: AutoCueGeneratorInput[] = [];
  const generator: AutoCueGenerator = {
    async startSession() {
      throw new Error("conversation create unavailable");
    },
    async generate(input) {
      calls.push(input);
      return { ...validCue(), lane: "stateless_fallback" };
    },
  };
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "What experience do you have with RAG?",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(calls).toHaveLength(1);
  expect(calls[0].session).toBeNull();
  expect(sent.some((message) => message.type === "cue_created")).toBe(true);
  expect(store.getConversation(conversationId)?.openAiConversationStatus).toBe("failed");
});

test("EvenHubV2Runtime commits an accepted speculative cue to the canonical conversation once", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new LifecycleAutoCueGenerator();
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Tell me a little bit about yourself",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Tell me a little bit about yourself",
    isFinal: true,
  }));
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(generator.calls).toHaveLength(1);
  expect(generator.calls[0].speculative).toBe(true);
  expect(generator.committed).toHaveLength(1);
  expect(generator.committed[0].question).toBe("Tell me a little bit about yourself");
  expect(generator.ended).toEqual([generator.session]);
});

test("EvenHubV2Runtime displays a complete cue without using confidence as a gate", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue({ confidence: 0.2 }));
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "so um yeah",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(sent.some((message) => message.type === "cue_created")).toBe(true);
  expect(store.listCues(conversationId)).toHaveLength(1);
  const attempts = store.getDb().query("SELECT * FROM evenhub_v2_auto_cue_attempts WHERE conversation_id = ?").all(conversationId) as any[];
  expect(attempts).toHaveLength(1);
  expect(attempts[0].status).toBe("created");
});

test("EvenHubV2Runtime does not rate-limit or cool down consecutive useful cues", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  let cueNumber = 0;
  const generator = new FakeAutoCueGenerator(async () => {
    cueNumber += 1;
    return validCue({
      title: `Cue ${cueNumber}`,
      g2Title: `Cue ${cueNumber}`,
      output: `Useful answer number ${cueNumber}.`,
    });
  });
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  for (let index = 1; index <= 4; index += 1) {
    await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
      text: `Question number ${index} needs a direct answer.`,
      isFinal: true,
    }));
    await runtime.flushCueBufferNow();
  }

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.calls).toHaveLength(4);
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(4);
  expect(store.listCues(conversationId)).toHaveLength(4);
});

test("EvenHubV2Runtime sends the current turn with the previous two canonical turns to the router", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const router = new FakeCueOpportunityRouter(cueNeededRouterResult());
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    cueOpportunityRouter: router,
  });

  await start(runtime);
  for (const text of ["Older context.", "The interviewer asks about the database.", "Could you explain the trade-off?"]) {
    await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", { text, isFinal: true }));
    await runtime.flushCueBufferNow();
  }

  expect(router.calls.at(-1)).toEqual({
    segmentMinus2: "Older context.",
    segmentMinus1: "The interviewer asks about the database.",
    current: "Could you explain the trade-off?",
  });
  expect(generator.calls).toHaveLength(3);
  expect(generator.calls.at(-1)?.router).toEqual(cueNeededRouterResult());
});

test("EvenHubV2Runtime treats router no_cue as a soft signal for a completed turn", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const router = new FakeCueOpportunityRouter(noCueRouterResult());
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    cueOpportunityRouter: router,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Yeah I am Xiang and lately I have been working on SayNext.",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.calls).toHaveLength(1);
  expect(generator.calls[0].router).toEqual(noCueRouterResult());
  expect(sent.some((message) => message.type === "cue_created")).toBe(true);
  expect(store.listCues(conversationId)).toHaveLength(1);
  const attempts = store.getDb().query(
    "SELECT status, skipped_reason, trace_json FROM evenhub_v2_auto_cue_attempts WHERE conversation_id = ?",
  ).all(conversationId) as Array<{ status: string; skipped_reason: string; trace_json: string }>;
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ status: "created", skipped_reason: "" });
  expect(JSON.parse(attempts[0].trace_json).router).toMatchObject({ decision: "no_cue" });
});

test("EvenHubV2Runtime does not let router no_cue block speculative generation", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const router = new FakeCueOpportunityRouter(noCueRouterResult());
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    cueOpportunityRouter: router,
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you tell me about the architecture of SayNext",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));

  expect(router.calls).toHaveLength(1);
  expect(generator.calls).toHaveLength(1);
  expect(generator.calls[0].router?.decision).toBe("no_cue");
  expect(sent.some((message) => message.type === "cue_created")).toBe(true);
});

test("EvenHubV2Runtime fails open when the router is unavailable", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const router = new FakeCueOpportunityRouter(new Error("router unavailable"));
  const { runtime } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    cueOpportunityRouter: router,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "What should I say next in this interview?",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  expect(router.calls).toHaveLength(1);
  expect(generator.calls).toHaveLength(1);
  expect(generator.calls[0].router).toBeNull();
  expect(sent.some((message) => message.type === "cue_created")).toBe(true);
});

test("EvenHubV2Runtime publishes a stable partial immediately and does not duplicate it on matching final", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you explain the deployment trade-off",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(store.listTranscriptLines(conversationId)).toHaveLength(0);
  expect(generator.calls).toHaveLength(1);
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you explain the deployment trade-off",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  expect(store.listTranscriptLines(conversationId)).toHaveLength(1);
  expect(generator.calls).toHaveLength(1);
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);
});

test("EvenHubV2Runtime keeps an in-flight speculative job when the final still matches", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const calls: AutoCueGeneratorInput[] = [];
  let resolveSpeculative!: (value: AutoCueGenerationResult) => void;
  const generator: AutoCueGenerator = {
    generate(input) {
      calls.push(input);
      return new Promise<AutoCueGenerationResult>((resolve) => {
        resolveSpeculative = resolve;
      });
    },
  };
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
    cueOpportunityRouter: null,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you explain the deployment trade-off",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(calls).toHaveLength(1);
  expect(calls[0].speculative).toBe(true);

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you explain the deployment trade-off",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();
  expect(calls).toHaveLength(1);

  resolveSpeculative(validCue({
    category: "response",
    output: "I would start with the simpler deployment and scale it only after measuring the bottleneck.",
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(store.listCues(conversationId)).toHaveLength(1);
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);
});

test("EvenHubV2Runtime lets a revised final preempt an in-flight speculative job", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const calls: AutoCueGeneratorInput[] = [];
  const resolvers: Array<(value: AutoCueGenerationResult) => void> = [];
  const generator: AutoCueGenerator = {
    generate(input) {
      calls.push(input);
      return new Promise<AutoCueGenerationResult>((resolve) => {
        resolvers.push(resolve);
      });
    },
  };
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
    cueOpportunityRouter: null,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Can you walk me through your",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(calls).toHaveLength(1);
  expect(calls[0].speculative).toBe(true);

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Can you walk me through your background?",
    isFinal: true,
  }));
  const canonicalFlush = runtime.flushCueBufferNow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toHaveLength(2);
  expect(calls[1].speculative).toBe(false);
  expect(calls[1].triggerWindow).toBe("Can you walk me through your background?");

  resolvers[0](validCue({
    title: "Incomplete question",
    g2Title: "Incomplete",
    output: "What part would you like me to explain?",
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(runtime.snapshot.activeAutoJobs.size).toBe(1);

  resolvers[1](validCue({
    category: "response",
    title: "Background",
    g2Title: "Background",
    output: "I am a MACS student focused on practical full-stack AI and cloud applications.",
  }));
  await canonicalFlush;

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  const cues = store.listCues(conversationId);
  expect(cues).toHaveLength(1);
  expect(cues[0].output).toContain("MACS student");
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);

  const attempts = store.getDb().query(`
    SELECT status, skipped_reason
    FROM evenhub_v2_auto_cue_attempts
    WHERE conversation_id = ?
    ORDER BY created_at
  `).all(conversationId) as Array<{ status: string; skipped_reason: string }>;
  expect(attempts.some((attempt) => (
    attempt.status === "stale" && attempt.skipped_reason === "final_preempted"
  ))).toBe(true);
});

test("EvenHubV2Runtime keeps partial revisions out of canonical transcript and publishes only one immediate cue", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you tell me a little bit",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await runtime.flushCueBufferNow();
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you tell me a little bit about yourself",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(store.listTranscriptLines(conversationId)).toHaveLength(0);
  expect(generator.calls).toHaveLength(1);
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you tell me a little bit about yourself",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const lines = store.listTranscriptLines(conversationId);
  expect(lines).toHaveLength(1);
  expect(lines[0].text).toBe("Could you tell me a little bit about yourself");
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);
});

test("EvenHubV2Runtime waits for the final when an incomplete speculative turn returns none", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  let call = 0;
  const generator = new FakeAutoCueGenerator(async () => {
    call += 1;
    return call === 1
      ? validCue({
          category: "none",
          title: "",
          g2Title: "",
          preview: "",
          fullAnswer: "",
          output: "",
          reason: "incomplete question",
        })
      : validCue({
          category: "response",
          title: "Background",
          g2Title: "Background",
          output: "I am a MACS student focused on full-stack AI and cloud applications.",
        });
  });
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Can you walk me through your",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await runtime.flushCueBufferNow();
  expect(sent.some((message) => message.type === "cue_created")).toBe(false);

  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Can you walk me through your background?",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.calls).toHaveLength(2);
  expect(store.listCues(conversationId)).toHaveLength(1);
  expect(store.listCues(conversationId)[0].output).toContain("MACS student");
  expect(sent.filter((message) => message.type === "cue_created")).toHaveLength(1);
});

test("EvenHubV2Runtime does not generate another cue while Xiang reads the active cue", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const spokenAnswer = "I am a MACS student focused on full-stack AI and cloud applications.";
  const generator = new FakeAutoCueGenerator(validCue({
    category: "response",
    title: "Introduction",
    g2Title: "Introduction",
    output: spokenAnswer,
  }));
  const { runtime, store } = makeRuntime(generator, sent);

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Tell me a little bit about yourself.",
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: spokenAnswer,
    isFinal: true,
  }));
  await runtime.flushCueBufferNow();

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.calls).toHaveLength(1);
  expect(store.listCues(conversationId)).toHaveLength(1);
  const attempts = store.getDb().query(
    "SELECT skipped_reason FROM evenhub_v2_auto_cue_attempts WHERE conversation_id = ? ORDER BY created_at",
  ).all(conversationId) as Array<{ skipped_reason: string }>;
  expect(attempts.some((attempt) => attempt.skipped_reason === "cue_readback")).toBe(true);
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

test("EvenHubV2Runtime does not save a pending partial as a canonical transcript on end", async () => {
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
  expect(lines).toHaveLength(0);
  expect(sent.some((message) => message.type === "conversation_saved")).toBe(true);
});

test("EvenHubV2Runtime keeps an immediately published speculative cue when the conversation ends", async () => {
  const sent: EvenHubV2ServerMessage[] = [];
  const generator = new FakeAutoCueGenerator(validCue());
  const { runtime, store } = makeRuntime(generator, sent, new EvenHubV2Store(":memory:"), {
    partialCommitMs: 5,
    partialCommitMinChars: 4,
    partialCommitMinWords: 2,
  });

  await start(runtime);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("debug_transcript", {
    text: "Could you explain your most relevant project",
    isFinal: false,
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));

  const conversationId = runtime.activeConversationId;
  if (!conversationId) throw new Error("conversation id missing");
  expect(generator.calls).toHaveLength(1);
  await runtime.handleClientMessage(createEvenHubV2ClientMessage("conversation_end", {}));

  const attempts = store.getDb().query(`
    SELECT status, skipped_reason
    FROM evenhub_v2_auto_cue_attempts
    WHERE conversation_id = ?
  `).all(conversationId) as Array<{ status: string; skipped_reason: string }>;
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toEqual({ status: "created", skipped_reason: "" });
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
    preview: "A saved cue.",
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

test("EvenHubV2Store persists structured code cue fields exactly", () => {
  const store = new EvenHubV2Store(":memory:");
  const conversationId = "conv-code";
  const code = [
    "function twoSum(nums: number[], target: number) {",
    "  const seen = new Map<number, number>();",
    "",
    "  for (let i = 0; i < nums.length; i++) {",
    "    const need = target - nums[i];",
    "    if (seen.has(need)) return [seen.get(need), i];",
    "    seen.set(nums[i], i);",
    "  }",
    "",
    "  return [];",
    "}",
  ].join("\n");
  store.createConversation({
    id: conversationId,
    userId: "test-user",
    clientSessionId: "client-code",
    title: "Code interview",
    startedAt: "2026-07-21T00:00:00.000Z",
    settings: {
      language: "english",
      cueDurationMs: "forever",
      autoPopup: true,
      showAiCue: true,
      showTranscript: true,
    },
    usedPrenote: { ids: [], text: "" },
  });
  store.createAutoCueAttempt({
    id: "attempt-code",
    conversationId,
    userId: "test-user",
    requestId: "req-code",
    status: "running",
    inputHash: "hash-code",
    inputWindow: "Write two sum",
    sourceTranscriptLineIds: [],
    promptContextSnapshot: "",
  });

  store.createCue({
    id: "cue-code",
    conversationId,
    userId: "test-user",
    attemptId: "attempt-code",
    category: "code",
    title: "Two sum",
    g2Title: "Two sum",
    preview: "Use a map for complements.",
    output: code,
    language: "typescript",
    code,
    explanation: "I store each value and look up its complement in one pass.",
    sourceTranscriptLineIds: [],
    createdAt: "2026-07-21T00:00:01.000Z",
  });

  expect(store.getCue("cue-code")).toMatchObject({
    category: "code",
    language: "typescript",
    code,
    explanation: "I store each value and look up its complement in one pass.",
    output: code,
  });
});

test("EvenHubV2Store persists the OpenAI conversation lifecycle", () => {
  const store = new EvenHubV2Store(":memory:");
  store.createConversation({
    id: "conv-openai-state",
    userId: "test-user",
    clientSessionId: "client-1",
    title: "OpenAI state",
    startedAt: "2026-07-20T00:00:00.000Z",
    settings: {
      language: "english",
      cueDurationMs: 10000,
      autoPopup: true,
      showAiCue: true,
      showTranscript: true,
    },
    usedPrenote: { ids: [], text: "" },
  });

  store.updateOpenAiConversationState({
    conversationId: "conv-openai-state",
    providerConversationId: "conv_provider_1",
    status: "active",
    promptVersion: "prompt-v1",
    interviewGuideVersion: "guide-v1",
  });
  store.updateOpenAiConversationState({
    conversationId: "conv-openai-state",
    status: "deleted",
  });

  expect(store.getConversation("conv-openai-state")).toMatchObject({
    openAiConversationId: "conv_provider_1",
    openAiConversationStatus: "deleted",
    openAiPromptVersion: "prompt-v1",
    interviewGuideVersion: "guide-v1",
  });
});
