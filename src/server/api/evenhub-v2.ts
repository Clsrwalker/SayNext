import type { Context } from "hono";
import { defaultEvenHubV2Settings, normalizeEvenHubV2Settings, type EvenHubV2Settings } from "../evenhub-v2/protocol";
import { evenHubV2SummaryRunner } from "../evenhub-v2/summary-runner";
import { evenHubV2Store, parseStoredJson, type EvenHubV2Store, type EvenHubV2SummaryRecord } from "../evenhub-v2/store";
import { conversationLogger, type PrenoteRecord } from "../data/conversation-logger";
import { getEvenHubV2Principal } from "../evenhub-v2/auth";
import { getEvenHubV2RuntimeSnapshot } from "../evenhub-v2/ws";

type ConversationDetail = NonNullable<ReturnType<EvenHubV2Store["getConversationDetail"]>>;
type SummaryQueueRunner = Pick<typeof evenHubV2SummaryRunner, "queueSummary" | "enqueue">;
type SettingsSource = "saved" | "default";
const MAX_PRENOTE_TEXT_LENGTH = 5000;
const MAX_PRENOTE_TITLE_LENGTH = 80;

function getUserId(c: Context): string {
  return getEvenHubV2Principal(c).ownerId;
}

export function serializeSummary(summary: EvenHubV2SummaryRecord | null) {
  if (!summary) {
    return {
      status: "not_started",
      title: "",
      overview: "",
      keyPoints: [],
      actionItems: [],
      emptyReason: "",
      generatedAt: "",
      error: "",
    };
  }

  return {
    status: summary.status,
    title: summary.title,
    overview: summary.overview,
    keyPoints: parseStoredJson<Array<{ id: string; title: string; details: string[] }>>(summary.keyPointsJson, []),
    actionItems: parseStoredJson<Array<{ id: string; text: string; checked: boolean }>>(summary.actionItemsJson, []),
    emptyReason: summary.emptyReason,
    generatedAt: summary.completedAt,
    error: summary.error,
  };
}

export function serializeEvenHubV2Prenote(prenote: PrenoteRecord) {
  return {
    id: String(prenote.id),
    title: prenote.title,
    text: prenote.runtimeContext || prenote.sourceText || prenote.description || "",
    selected: prenote.isActive,
    files: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getEvenHubV2SettingsBootstrap(
  userId: string,
  store: Pick<EvenHubV2Store, "getUserSettings"> = evenHubV2Store,
): {
  settings: EvenHubV2Settings;
  settingsSource: SettingsSource;
  settingsUpdatedAt: string;
} {
  const saved = store.getUserSettings(userId);
  if (!saved) {
    return {
      settings: defaultEvenHubV2Settings(),
      settingsSource: "default",
      settingsUpdatedAt: "",
    };
  }

  return {
    settings: normalizeEvenHubV2Settings(
      parseStoredJson<Partial<EvenHubV2Settings>>(saved.settingsJson, {}),
      defaultEvenHubV2Settings(),
    ),
    settingsSource: "saved",
    settingsUpdatedAt: saved.updatedAt,
  };
}

function inferPrenoteTitle(text: string, fallback = "新笔记"): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || fallback).replace(/^#+\s*/, "").slice(0, MAX_PRENOTE_TITLE_LENGTH) || fallback;
}

function parsePrenoteId(c: Context): number | null {
  const id = Number(c.req.param("id"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function readJsonBody(c: Context): Promise<Record<string, any> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

export function ensureSummaryForEndedConversation(
  detail: ConversationDetail,
  options: {
    store?: Pick<EvenHubV2Store, "getSummary">;
    summaryRunner?: SummaryQueueRunner;
    now?: () => string;
  } = {},
): EvenHubV2SummaryRecord | null {
  if (detail.summary || detail.conversation.status !== "ended") return detail.summary;

  const summaryRunner = options.summaryRunner || evenHubV2SummaryRunner;
  const store = options.store || evenHubV2Store;
  summaryRunner.queueSummary({
    conversationId: detail.conversation.id,
    userId: detail.conversation.userId,
    queuedAt: options.now?.() || new Date().toISOString(),
  });
  summaryRunner.enqueue(detail.conversation.id);
  return store.getSummary(detail.conversation.id);
}

function serializeConversation(record: ReturnType<typeof evenHubV2Store.listConversations>[number]) {
  const usedPrenote = parseStoredJson<{ ids?: string[]; text?: string }>(record.usedPrenoteJson, {});
  const summary = evenHubV2Store.getSummary(record.id);
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    summaryStatus: summary?.status || "not_started",
    usedPrenote,
  };
}

export const getEvenHubV2Bootstrap = (c: Context) => {
  const userId = getUserId(c);
  const settings = getEvenHubV2SettingsBootstrap(userId);
  const conversations = evenHubV2Store.listConversations(userId, 20).map(serializeConversation);
  return c.json({
    userId,
    ...settings,
    prenotes: conversationLogger.listPrenotes(userId).map(serializeEvenHubV2Prenote),
    conversations,
  });
};

export const updateEvenHubV2Settings = async (c: Context) => {
  const userId = getUserId(c);
  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const current = getEvenHubV2SettingsBootstrap(userId).settings;
  const rawSettings = isRecord(body.settings) ? body.settings : body;
  const settings = normalizeEvenHubV2Settings(rawSettings as Partial<EvenHubV2Settings>, current);
  const saved = evenHubV2Store.upsertUserSettings({ userId, settings });

  return c.json({
    settings,
    settingsSource: "saved" satisfies SettingsSource,
    settingsUpdatedAt: saved.updatedAt,
  });
};

export const createEvenHubV2Prenote = async (c: Context) => {
  const userId = getUserId(c);
  const body = await readJsonBody(c);
  if (!body || !isRecord(body)) return c.json({ error: "Invalid JSON body" }, 400);

  if (typeof body.text !== "string") return c.json({ error: "Prenote text is required" }, 400);
  const text = body.text.trim();
  if (!text) return c.json({ error: "Prenote text is required" }, 400);
  if (text.length > MAX_PRENOTE_TEXT_LENGTH) {
    return c.json({ error: `Prenote text must be ${MAX_PRENOTE_TEXT_LENGTH} characters or fewer` }, 400);
  }
  if (body.selected !== undefined && typeof body.selected !== "boolean") {
    return c.json({ error: "selected must be a boolean" }, 400);
  }

  const title = (typeof body.title === "string" ? body.title.trim() : "") || inferPrenoteTitle(text);
  const prenote = conversationLogger.createPrenote({
    userId,
    title: title.slice(0, MAX_PRENOTE_TITLE_LENGTH),
    description: "EvenHub v2 prepared note",
    sourceText: text,
  });
  if (!prenote) return c.json({ error: "Prenote storage is disabled" }, 503);

  const updated = conversationLogger.updatePrenoteProcessing(prenote.id, {
    status: "ready",
    runtimeContext: text,
    extractedText: "",
    processedJson: "{}",
    model: "manual",
    contentHash: "",
    error: "",
  }) ?? prenote;

  if (body.selected !== false) {
    conversationLogger.setPrenoteActive(userId, updated.id, true);
  }

  return c.json({ prenote: serializeEvenHubV2Prenote(conversationLogger.getPrenote(updated.id) ?? updated) }, 201);
};

export const updateEvenHubV2Prenote = async (c: Context) => {
  const userId = getUserId(c);
  const id = parsePrenoteId(c);
  if (id === null) return c.json({ error: "Invalid prenote id" }, 400);

  const body = await readJsonBody(c);
  if (!body || !isRecord(body)) return c.json({ error: "Invalid JSON body" }, 400);

  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasText = Object.prototype.hasOwnProperty.call(body, "text");
  const hasSelected = Object.prototype.hasOwnProperty.call(body, "selected");
  if (!hasTitle && !hasText && !hasSelected) {
    return c.json({ error: "Provide title, text, or selected" }, 400);
  }
  if (hasTitle && typeof body.title !== "string") return c.json({ error: "title must be a string" }, 400);
  if (hasText && typeof body.text !== "string") return c.json({ error: "text must be a string" }, 400);
  if (hasSelected && typeof body.selected !== "boolean") return c.json({ error: "selected must be a boolean" }, 400);

  const text = typeof body.text === "string" ? body.text.trim() : undefined;
  if (hasText && !text) return c.json({ error: "Prenote text is required" }, 400);
  if (text && text.length > MAX_PRENOTE_TEXT_LENGTH) {
    return c.json({ error: `Prenote text must be ${MAX_PRENOTE_TEXT_LENGTH} characters or fewer` }, 400);
  }

  const requestedTitle = typeof body.title === "string" ? body.title.trim() : undefined;
  const title = hasTitle
    ? (requestedTitle || (text ? inferPrenoteTitle(text) : ""))
    : undefined;
  if (hasTitle && !title) return c.json({ error: "Prenote title is required" }, 400);

  const prenote = conversationLogger.updateManualPrenote(userId, id, {
    title: title?.slice(0, MAX_PRENOTE_TITLE_LENGTH),
    text,
    selected: typeof body.selected === "boolean" ? body.selected : undefined,
  });
  if (!prenote) return c.json({ error: "Prenote not found" }, 404);
  return c.json({ prenote: serializeEvenHubV2Prenote(prenote) });
};

export const deleteEvenHubV2Prenote = (c: Context) => {
  const userId = getUserId(c);
  const id = parsePrenoteId(c);
  if (id === null) return c.json({ error: "Invalid prenote id" }, 400);

  if (!conversationLogger.deletePrenote(userId, id)) {
    return c.json({ error: "Prenote not found" }, 404);
  }
  return c.json({ deleted: true, id: String(id) });
};

export const listEvenHubV2Conversations = (c: Context) => {
  const userId = getUserId(c);
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") || 20) || 20));
  return c.json({
    conversations: evenHubV2Store.listConversations(userId, limit).map(serializeConversation),
  });
};

export const getEvenHubV2Conversation = (c: Context) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  const detail = evenHubV2Store.getConversationDetail(id);
  if (!detail || detail.conversation.userId !== userId) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  const summary = ensureSummaryForEndedConversation(detail);
  return c.json({
    conversation: serializeConversation(detail.conversation),
    runtimeSnapshot: getEvenHubV2RuntimeSnapshot(userId, id),
    summary: serializeSummary(summary),
    transcript: detail.transcript.map((line) => ({
      id: line.id,
      text: line.text,
      index: line.lineIndex,
      receivedAt: line.receivedAt,
    })),
    cues: detail.cues.map((cue) => ({
      id: cue.id,
      attemptId: cue.attemptId,
      category: cue.category,
      title: cue.title,
      g2Title: cue.g2Title,
      preview: cue.preview,
      fullAnswer: cue.category === "code" ? cue.explanation : cue.output,
      output: cue.output,
      language: cue.language,
      code: cue.code,
      explanation: cue.explanation,
      sourceTranscriptLineIds: parseStoredJson<string[]>(cue.sourceTranscriptLineIdsJson, []),
      createdAt: cue.createdAt,
    })),
  });
};

export const deleteEvenHubV2Conversation = (c: Context) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  const detail = evenHubV2Store.getConversationDetail(id);
  if (!detail || detail.conversation.userId !== userId) return c.json({ error: "Conversation not found" }, 404);
  if (detail.conversation.status === "active" || detail.conversation.status === "ending") {
    return c.json({ code: "conversation_active", error: "End the conversation before deleting it." }, 409);
  }
  const deleted = evenHubV2Store.deleteConversation(userId, id);
  if (!deleted) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  return c.json({ deleted: true, id });
};

export const retryEvenHubV2Summary = (c: Context) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  const result = evenHubV2SummaryRunner.retry(id, userId);
  if (result === "not_found") return c.json({ error: "Conversation not found" }, 404);
  if (result === "active") return c.json({ code: "conversation_active", error: "End the conversation before generating a summary." }, 409);
  if (result === "not_failed") return c.json({ code: "summary_not_failed", error: "This summary does not require a retry." }, 409);
  return c.json({ status: result, summary: serializeSummary(evenHubV2Store.getSummary(id)) }, result === "queued" ? 202 : 200);
};
