import type { Context } from "hono";
import { conversationLogger, createPersonalMemoryRetrievalDebug, type PersonalMemoryRecord } from "../data/conversation-logger";

function serializeMemory(memory: PersonalMemoryRecord) {
  return {
    id: memory.id,
    userId: memory.userId,
    title: memory.title,
    category: memory.category,
    sensitivity: memory.sensitivity,
    content: memory.content,
    usageRule: memory.usageRule,
    keywords: memory.keywords,
    embeddingProvider: memory.embeddingProvider,
    embeddingModel: memory.embeddingModel,
    embeddingDimensions: memory.embeddingDimensions,
    embeddingInputVersion: memory.embeddingInputVersion,
    embeddingUpdatedAt: memory.embeddingUpdatedAt,
    embeddingStatus: memory.embeddingStatus,
    embeddingError: memory.embeddingError,
    status: memory.status,
    source: memory.source,
    sourceRef: memory.sourceRef,
    contentHash: memory.contentHash,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    contentLength: memory.content.length,
  };
}

async function readJsonBody(c: Context): Promise<Record<string, any> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

function userIdFrom(c: Context, body?: Record<string, any> | null): string {
  return String(body?.userId || c.req.query("userId") || "").trim();
}

function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export const listPersonalMemories = (c: Context) => {
  const userId = userIdFrom(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const status = c.req.query("status") || "all";
  const memories = conversationLogger.listPersonalMemories(userId, { status }).map(serializeMemory);
  return c.json({ memories });
};

export const createPersonalMemory = async (c: Context) => {
  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const userId = userIdFrom(c, body);
  const title = String(body.title || "").trim();
  const category = String(body.category || "general").trim();
  const content = String(body.content || "").trim();
  const sensitivity = String(body.sensitivity || "medium");

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!content) return c.json({ error: "content is required" }, 400);

  let memory: PersonalMemoryRecord | null;
  try {
    memory = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: title || "Personal memory",
      category,
      sensitivity: sensitivity === "low" || sensitivity === "high" ? sensitivity : "medium",
      content,
      usageRule: String(body.usageRule || "").trim(),
      keywords: normalizeKeywords(body.keywords),
      status: body.status === "disabled" ? "disabled" : "active",
      source: ["pipeline", "import", "knowledge"].includes(body.source) ? body.source : "manual",
      sourceRef: typeof body.sourceRef === "string" ? body.sourceRef.trim() : "",
      upsertBySource: body.upsertBySource === true,
    });
  } catch (error) {
    return c.json({
      error: "Personal memory embedding failed",
      detail: error instanceof Error ? error.message : String(error),
    }, 503);
  }

  if (!memory) return c.json({ error: "Personal memory storage is disabled" }, 503);
  return c.json({ memory: serializeMemory(memory) }, 201);
};

export const updatePersonalMemory = async (c: Context) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid memory id" }, 400);

  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const userId = userIdFrom(c, body);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  let memory: PersonalMemoryRecord | null;
  try {
    memory = await conversationLogger.updatePersonalMemoryAsync(userId, id, {
      title: typeof body.title === "string" ? body.title : undefined,
      category: typeof body.category === "string" ? body.category : undefined,
      sensitivity: body.sensitivity === "low" || body.sensitivity === "medium" || body.sensitivity === "high" ? body.sensitivity : undefined,
      content: typeof body.content === "string" ? body.content : undefined,
      usageRule: typeof body.usageRule === "string" ? body.usageRule : undefined,
      keywords: body.keywords !== undefined ? normalizeKeywords(body.keywords) : undefined,
      status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
      sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : undefined,
    });
  } catch (error) {
    return c.json({
      error: "Personal memory embedding failed",
      detail: error instanceof Error ? error.message : String(error),
    }, 503);
  }

  if (!memory) return c.json({ error: "Personal memory not found" }, 404);
  return c.json({ memory: serializeMemory(memory) });
};

export const deletePersonalMemory = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = (await readJsonBody(c)) ?? {};
  const userId = userIdFrom(c, body);

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid memory id" }, 400);

  const deleted = conversationLogger.deletePersonalMemory(userId, id);
  if (!deleted) return c.json({ error: "Personal memory not found" }, 404);

  return c.json({ ok: true });
};

export const searchPersonalMemories = async (c: Context) => {
  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const userId = userIdFrom(c, body);
  const query = String(body.query || "").trim();
  const limit = Number(body.limit || 5);
  const debugEnabled = body.debug === true || body.debug === "true";
  const rerankRequested = body.rerank === true || body.rerank === "true";

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!query) return c.json({ error: "query is required" }, 400);

  const debug = debugEnabled ? createPersonalMemoryRetrievalDebug(query) : undefined;
  const memories = (await conversationLogger.searchPersonalMemoriesHybridAsync(userId, query, limit, debug)).map((memory) => ({
    ...serializeMemory(memory),
    score: memory.score,
    lexicalRank: memory.lexicalRank,
    vectorRank: memory.vectorRank,
    keywordScore: memory.keywordScore,
  }));

  if (debug) {
    if (rerankRequested) {
      debug.rerankFallbackReason = "rerank_not_enabled_in_debug_trace_v1";
    }
    return c.json({ memories, debug });
  }

  return c.json({ memories });
};
