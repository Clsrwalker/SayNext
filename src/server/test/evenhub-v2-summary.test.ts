import { expect, test } from "bun:test";
import {
  buildEvenHubV2SummaryPrompt,
  normalizeConversationSummaryOutput,
  type ConversationSummaryGenerator,
  type ConversationSummaryGeneratorInput,
  type ConversationSummaryGenerationResult,
} from "../evenhub-v2/summary-generator";
import { EvenHubV2SummaryRunner } from "../evenhub-v2/summary-runner";
import { EvenHubV2Store } from "../evenhub-v2/store";

function createConversation(store: EvenHubV2Store, conversationId = "conv-summary", title = "New Conversation") {
  store.createConversation({
    id: conversationId,
    userId: "test-user",
    clientSessionId: "client-1",
    title,
    startedAt: "2026-06-12T10:00:00.000Z",
    settings: {
      language: "english",
      cueDurationMs: 10000,
      autoPopup: true,
      showAiCue: true,
      showTranscript: true,
    },
    usedPrenote: {
      ids: ["pn-1"],
      text: "Prepared background only, not necessarily discussed.",
    },
  });
}

function addTranscript(store: EvenHubV2Store, conversationId: string, lines: string[]) {
  lines.forEach((text, index) => {
    store.addTranscriptLine({
      id: `${conversationId}-line-${index}`,
      conversationId,
      userId: "test-user",
      lineIndex: index,
      text,
      receivedAt: `2026-06-12T10:00:0${index}.000Z`,
      source: "debug",
    });
  });
}

class FakeSummaryGenerator implements ConversationSummaryGenerator {
  calls: ConversationSummaryGeneratorInput[] = [];

  constructor(private readonly result: ConversationSummaryGenerationResult) {}

  async generate(input: ConversationSummaryGeneratorInput): Promise<ConversationSummaryGenerationResult> {
    this.calls.push(input);
    return this.result;
  }
}

function validSummary(): ConversationSummaryGenerationResult {
  return {
    model: "fake-summary-model",
    rawText: JSON.stringify({
      title: "Batch Normalization Discussion",
      overview: "The conversation explains batch normalization and its training trade-offs.",
      keyPoints: [
        {
          title: "Batch statistics",
          details: ["Mean and variance are computed over a batch.", "Learned scale and shift are applied after normalization."],
        },
      ],
      actionItems: [
        { text: "Review batch normalization equations." },
      ],
    }),
    data: {
      title: "Batch Normalization Discussion",
      overview: "The conversation explains batch normalization and its training trade-offs.",
      keyPoints: [
        {
          title: "Batch statistics",
          details: ["Mean and variance are computed over a batch.", "Learned scale and shift are applied after normalization."],
        },
      ],
      actionItems: [
        { text: "Review batch normalization equations." },
      ],
    },
  };
}

test("EvenHubV2Store queues summaries idempotently and claims queued work atomically", () => {
  const store = new EvenHubV2Store(":memory:");
  createConversation(store);

  const first = store.queueSummary({
    id: "summary-1",
    conversationId: "conv-summary",
    userId: "test-user",
    queuedAt: "2026-06-12T10:01:00.000Z",
  });
  const second = store.queueSummary({
    id: "summary-2",
    conversationId: "conv-summary",
    userId: "test-user",
    queuedAt: "2026-06-12T10:02:00.000Z",
  });

  expect(first.id).toBe("summary-1");
  expect(second.id).toBe("summary-1");
  expect(store.listQueuedSummaries()).toHaveLength(1);
  expect(store.claimQueuedSummary("conv-summary", "2026-06-12T10:03:00.000Z")).toBe(true);
  expect(store.claimQueuedSummary("conv-summary", "2026-06-12T10:03:01.000Z")).toBe(false);
  expect(store.getSummary("conv-summary")?.attemptCount).toBe(1);
});

test("EvenHubV2Store resets stale running summaries without touching fresh running work", () => {
  const store = new EvenHubV2Store(":memory:");
  createConversation(store, "old-running");
  createConversation(store, "fresh-running");
  store.queueSummary({ id: "old-summary", conversationId: "old-running", userId: "test-user", queuedAt: "2026-06-12T10:00:00.000Z" });
  store.queueSummary({ id: "fresh-summary", conversationId: "fresh-running", userId: "test-user", queuedAt: "2026-06-12T10:00:00.000Z" });
  expect(store.claimQueuedSummary("old-running", "2026-06-12T10:01:00.000Z")).toBe(true);
  expect(store.claimQueuedSummary("fresh-running", "2026-06-12T10:09:30.000Z")).toBe(true);

  const reset = store.resetStaleRunningSummaries("2026-06-12T10:05:00.000Z");

  expect(reset.map((summary) => summary.conversationId)).toEqual(["old-running"]);
  expect(store.getSummary("old-running")?.status).toBe("queued");
  expect(store.getSummary("fresh-running")?.status).toBe("running");
});

test("EvenHubV2SummaryRunner completes short transcript as ready empty summary", async () => {
  const store = new EvenHubV2Store(":memory:");
  createConversation(store);
  addTranscript(store, "conv-summary", ["hi"]);
  store.endConversation({
    conversationId: "conv-summary",
    endedAt: "2026-06-12T10:02:00.000Z",
    durationMs: 120000,
  });
  store.queueSummary({ id: "summary-short", conversationId: "conv-summary", userId: "test-user", queuedAt: "2026-06-12T10:02:00.000Z" });
  const generator = new FakeSummaryGenerator(validSummary());
  const runner = new EvenHubV2SummaryRunner({ store, generator, minTranscriptChars: 80 });

  await runner.runSummaryJob("conv-summary");

  const summary = store.getSummary("conv-summary");
  expect(generator.calls).toHaveLength(0);
  expect(summary?.status).toBe("ready");
  expect(summary?.overview).toBe("-");
  expect(summary?.emptyReason).toBe("too_short");
});

test("EvenHubV2SummaryRunner sends full transcript to the generator and stores normalized output", async () => {
  const store = new EvenHubV2Store(":memory:");
  createConversation(store);
  const lines = [
    "The professor explained batch normalization using activation mean and variance.",
    "Then they discussed how scale and shift are learned after normalization.",
    "A useful follow-up is to review the equations before the next tutorial.",
  ];
  addTranscript(store, "conv-summary", lines);
  store.endConversation({
    conversationId: "conv-summary",
    endedAt: "2026-06-12T10:05:00.000Z",
    durationMs: 300000,
  });
  store.queueSummary({ id: "summary-full", conversationId: "conv-summary", userId: "test-user", queuedAt: "2026-06-12T10:05:00.000Z" });
  const generator = new FakeSummaryGenerator(validSummary());
  const runner = new EvenHubV2SummaryRunner({ store, generator, minTranscriptChars: 80 });

  await runner.runSummaryJob("conv-summary");

  const summary = store.getSummary("conv-summary");
  expect(generator.calls).toHaveLength(1);
  expect(generator.calls[0].transcriptText).toBe(lines.join("\n"));
  expect(summary?.status).toBe("ready");
  expect(summary?.title).toBe("Batch Normalization Discussion");
  expect(JSON.parse(summary?.keyPointsJson || "[]")[0].id).toBeString();
  expect(JSON.parse(summary?.actionItemsJson || "[]")[0]).toMatchObject({
    text: "Review batch normalization equations.",
    checked: true,
  });
  expect(summary?.inputTranscriptChars).toBe(lines.join("\n").length);
  expect(summary?.inputTruncated).toBe(false);
  expect(store.getConversation("conv-summary")?.title).toBe("Batch Normalization Discussion");
});

test("EvenHubV2SummaryRunner does not overwrite a non-default conversation title", async () => {
  const store = new EvenHubV2Store(":memory:");
  createConversation(store, "custom-title-conv", "Existing Custom Title");
  addTranscript(store, "custom-title-conv", [
    "The professor explained batch normalization using activation mean and variance.",
    "Then they discussed how scale and shift are learned after normalization.",
  ]);
  store.endConversation({
    conversationId: "custom-title-conv",
    endedAt: "2026-06-12T10:05:00.000Z",
    durationMs: 300000,
  });
  store.queueSummary({ id: "summary-custom-title", conversationId: "custom-title-conv", userId: "test-user", queuedAt: "2026-06-12T10:05:00.000Z" });
  const runner = new EvenHubV2SummaryRunner({
    store,
    generator: new FakeSummaryGenerator(validSummary()),
    minTranscriptChars: 80,
  });

  await runner.runSummaryJob("custom-title-conv");

  expect(store.getConversation("custom-title-conv")?.title).toBe("Existing Custom Title");
});

test("EvenHubV2SummaryRunner recovers queued and stale running summaries on startup", async () => {
  const store = new EvenHubV2Store(":memory:");
  createConversation(store, "queued-conv");
  createConversation(store, "stale-conv");
  addTranscript(store, "queued-conv", ["Queued conversation has enough transcript content to generate a useful summary after restart."]);
  addTranscript(store, "stale-conv", ["Stale running conversation has enough transcript content to be reset and summarized after restart."]);
  store.endConversation({ conversationId: "queued-conv", endedAt: "2026-06-12T10:05:00.000Z", durationMs: 300000 });
  store.endConversation({ conversationId: "stale-conv", endedAt: "2026-06-12T10:05:00.000Z", durationMs: 300000 });
  store.queueSummary({ id: "queued-summary", conversationId: "queued-conv", userId: "test-user", queuedAt: "2026-06-12T10:05:00.000Z" });
  store.queueSummary({ id: "stale-summary", conversationId: "stale-conv", userId: "test-user", queuedAt: "2026-06-12T10:05:00.000Z" });
  expect(store.claimQueuedSummary("stale-conv", "2026-06-12T10:06:00.000Z")).toBe(true);
  const generator = new FakeSummaryGenerator(validSummary());
  const runner = new EvenHubV2SummaryRunner({
    store,
    generator,
    minTranscriptChars: 80,
    staleRunningMs: 10 * 60 * 1000,
  });

  runner.recoverQueuedAndStale(new Date("2026-06-12T10:20:01.000Z").getTime());
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(store.getSummary("queued-conv")?.status).toBe("ready");
  expect(store.getSummary("stale-conv")?.status).toBe("ready");
  expect(generator.calls).toHaveLength(2);
});

test("normalizeConversationSummaryOutput rejects invalid summary payloads", () => {
  expect(() => normalizeConversationSummaryOutput({ title: "", overview: "", keyPoints: [], actionItems: [] }))
    .toThrow("summary_title_required");
  expect(() => normalizeConversationSummaryOutput({ title: "Title", overview: "", keyPoints: [], actionItems: [] }))
    .toThrow("summary_overview_required");
});

test("buildEvenHubV2SummaryPrompt treats transcript as facts and cues/prenote as non-factual context", () => {
  const prompt = buildEvenHubV2SummaryPrompt({
    transcriptText: "Transcript fact.",
    cueHistoryText: "AI cue hint.",
    prenoteText: "Prepared note.",
    language: "english",
  });

  expect(prompt).toContain("Transcript final lines are the primary facts");
  expect(prompt).toContain("AI cue history is not conversation fact");
  expect(prompt).toContain("Prenote is background material");
  expect(prompt).toContain("Transcript fact.");
});
