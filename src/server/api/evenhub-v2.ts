import type { Context } from "hono";
import { defaultEvenHubV2Settings } from "../evenhub-v2/protocol";
import { evenHubV2Store, parseStoredJson } from "../evenhub-v2/store";

function getUserId(c: Context): string {
  if (process.env.EVENHUB_V2_ALLOW_QUERY_USER_ID === "true") {
    const queryUserId = c.req.query("userId")?.trim();
    if (queryUserId) return queryUserId;
  }
  return process.env.EVENHUB_DEFAULT_USER_ID || process.env.EVENHUB_V2_DEFAULT_USER_ID || "evenhub-v2-user";
}

function serializeConversation(record: ReturnType<typeof evenHubV2Store.listConversations>[number]) {
  const usedPrenote = parseStoredJson<{ ids?: string[]; text?: string }>(record.usedPrenoteJson, {});
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    usedPrenote,
  };
}

export const getEvenHubV2Bootstrap = (c: Context) => {
  const userId = getUserId(c);
  const conversations = evenHubV2Store.listConversations(userId, 20).map(serializeConversation);
  return c.json({
    userId,
    settings: defaultEvenHubV2Settings(),
    prenotes: [],
    conversations,
  });
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
  return c.json({
    conversation: serializeConversation(detail.conversation),
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
      output: cue.output,
      sourceTranscriptLineIds: parseStoredJson<string[]>(cue.sourceTranscriptLineIdsJson, []),
      createdAt: cue.createdAt,
    })),
  });
};

export const deleteEvenHubV2Conversation = (c: Context) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  const deleted = evenHubV2Store.deleteConversation(userId, id);
  if (!deleted) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  return c.json({ deleted: true, id });
};
