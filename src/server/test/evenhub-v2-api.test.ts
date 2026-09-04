import { expect, test } from "bun:test";
import { ensureSummaryForEndedConversation, getEvenHubV2SettingsBootstrap, serializeEvenHubV2Prenote, serializeSummary } from "../api/evenhub-v2";
import { EvenHubV2Store, type EvenHubV2SummaryRecord } from "../evenhub-v2/store";

function summary(overrides: Partial<EvenHubV2SummaryRecord> = {}): EvenHubV2SummaryRecord {
  return {
    id: "summary-1",
    conversationId: "conv-1",
    userId: "user-1",
    status: "ready",
    attemptCount: 1,
    title: "Discussion title",
    overview: "Useful overview.",
    keyPointsJson: JSON.stringify([{ id: "kp-1", title: "Point", details: ["Detail"] }]),
    actionItemsJson: JSON.stringify([{ id: "act-1", text: "Follow up", checked: true }]),
    model: "gpt-5.5",
    promptVersion: "v1",
    rawOutput: "sensitive raw output",
    error: "",
    emptyReason: "",
    traceJson: JSON.stringify({ prompt: "private trace" }),
    inputTranscriptChars: 200,
    inputLineCount: 3,
    inputTruncated: false,
    queuedAt: "2026-06-12T10:00:00.000Z",
    startedAt: "2026-06-12T10:00:01.000Z",
    completedAt: "2026-06-12T10:00:02.000Z",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:02.000Z",
    ...overrides,
  };
}

test("serializeSummary returns not_started for missing summary rows", () => {
  expect(serializeSummary(null)).toEqual({
    status: "not_started",
    title: "",
    overview: "",
    keyPoints: [],
    actionItems: [],
    emptyReason: "",
    generatedAt: "",
    error: "",
  });
});

test("serializeSummary exposes structured result without raw debug fields", () => {
  const serialized = serializeSummary(summary());

  expect(serialized).toEqual({
    status: "ready",
    title: "Discussion title",
    overview: "Useful overview.",
    keyPoints: [{ id: "kp-1", title: "Point", details: ["Detail"] }],
    actionItems: [{ id: "act-1", text: "Follow up", checked: true }],
    emptyReason: "",
    generatedAt: "2026-06-12T10:00:02.000Z",
    error: "",
  });
  expect(JSON.stringify(serialized)).not.toContain("sensitive raw output");
  expect(JSON.stringify(serialized)).not.toContain("private trace");
});

test("serializeEvenHubV2Prenote maps stored prenotes to phone app shape", () => {
  const prenote = serializeEvenHubV2Prenote({
    id: 42,
    userId: "user-1",
    title: "Interview notes",
    description: "",
    status: "ready",
    isActive: true,
    sourceText: "raw source text",
    extractedText: "",
    processedJson: "{}",
    runtimeContext: "usable note text",
    model: null,
    contentHash: "",
    error: "",
    createdAt: "2026-06-22T10:00:00.000Z",
    updatedAt: "2026-06-22T10:00:00.000Z",
  });

  expect(prenote).toEqual({
    id: "42",
    title: "Interview notes",
    text: "usable note text",
    selected: true,
    files: [],
  });
});

test("getEvenHubV2SettingsBootstrap distinguishes default and saved settings", () => {
  const store = new EvenHubV2Store(":memory:");

  expect(getEvenHubV2SettingsBootstrap("user-1", store)).toMatchObject({
    settingsSource: "default",
    settings: {
      language: "english",
      showAiCue: true,
      showTranscript: true,
    },
  });

  store.upsertUserSettings({
    userId: "user-1",
    settings: {
      language: "chinese",
      cueDurationMs: "forever",
      autoPopup: false,
      showAiCue: false,
      showTranscript: true,
    },
  });

  expect(getEvenHubV2SettingsBootstrap("user-1", store)).toMatchObject({
    settingsSource: "saved",
    settings: {
      language: "chinese",
      cueDurationMs: "forever",
      autoPopup: false,
      showAiCue: false,
      showTranscript: true,
    },
  });
});

test("ensureSummaryForEndedConversation lazily queues ended conversations without summary", () => {
  const store = new EvenHubV2Store(":memory:");
  store.createConversation({
    id: "ended-conv",
    userId: "user-1",
    clientSessionId: "client-1",
    title: "New Conversation",
    startedAt: "2026-06-19T03:00:00.000Z",
    settings: {
      language: "english",
      cueDurationMs: 10000,
      autoPopup: true,
      showAiCue: true,
      showTranscript: true,
    },
    usedPrenote: { ids: [], text: "" },
  });
  store.endConversation({
    conversationId: "ended-conv",
    endedAt: "2026-06-19T03:05:00.000Z",
    durationMs: 300000,
  });
  const events: string[] = [];
  const detail = store.getConversationDetail("ended-conv");
  if (!detail) throw new Error("detail missing");

  const summary = ensureSummaryForEndedConversation(detail, {
    store,
    now: () => "2026-06-19T03:06:00.000Z",
    summaryRunner: {
      queueSummary(input) {
        events.push("queue");
        store.queueSummary({
          id: "summary-ended",
          conversationId: input.conversationId,
          userId: input.userId,
          queuedAt: input.queuedAt || "2026-06-19T03:06:00.000Z",
        });
      },
      enqueue(conversationId) {
        events.push(`enqueue:${conversationId}`);
      },
    },
  });

  expect(summary?.status).toBe("queued");
  expect(events).toEqual(["queue", "enqueue:ended-conv"]);
});

test("ensureSummaryForEndedConversation does not queue active conversations", () => {
  const store = new EvenHubV2Store(":memory:");
  store.createConversation({
    id: "active-conv",
    userId: "user-1",
    clientSessionId: "client-1",
    title: "New Conversation",
    startedAt: "2026-06-19T03:00:00.000Z",
    settings: {
      language: "english",
      cueDurationMs: 10000,
      autoPopup: true,
      showAiCue: true,
      showTranscript: true,
    },
    usedPrenote: { ids: [], text: "" },
  });
  const detail = store.getConversationDetail("active-conv");
  if (!detail) throw new Error("detail missing");

  const summary = ensureSummaryForEndedConversation(detail, {
    store,
    summaryRunner: {
      queueSummary() {
        throw new Error("should_not_queue");
      },
      enqueue() {
        throw new Error("should_not_enqueue");
      },
    },
  });

  expect(summary).toBeNull();
  expect(store.getSummary("active-conv")).toBeNull();
});
