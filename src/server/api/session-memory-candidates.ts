import type { Context } from "hono";
import { conversationLogger, type SessionMemoryCandidateRecord } from "../data/conversation-logger";
import { extractSessionMemoryCandidates } from "../memory/session-memory-extractor";

function serializeCandidate(candidate: SessionMemoryCandidateRecord) {
  let validation: Record<string, unknown> = {};
  try {
    validation = JSON.parse(candidate.validationJson || "{}");
  } catch {
    validation = {};
  }

  return {
    id: candidate.id,
    userId: candidate.userId,
    sessionId: candidate.sessionId,
    candidateType: candidate.candidateType,
    title: candidate.title,
    category: candidate.category,
    sensitivity: candidate.sensitivity,
    content: candidate.content,
    usageRule: candidate.usageRule,
    keywords: candidate.keywords,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    valueScore: candidate.valueScore,
    riskScore: candidate.riskScore,
    validation,
    dateMetadata: (validation as any).dateMetadata ?? null,
    status: candidate.status,
    model: candidate.model,
    contentHash: candidate.contentHash,
    promotedMemoryId: candidate.promotedMemoryId,
    rejectionReason: candidate.rejectionReason,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

async function readJsonBody(c: Context): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
}

function getUserId(c: Context, body?: Record<string, any>): string {
  return String(body?.userId || c.req.query("userId") || "").trim();
}

export const listSessionMemoryCandidates = (c: Context) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const candidates = conversationLogger.listSessionMemoryCandidates(userId, {
    sessionId: c.req.query("sessionId") || undefined,
    status: c.req.query("status") || "all",
    limit: Number(c.req.query("limit") || 100),
  });

  return c.json({ candidates: candidates.map(serializeCandidate) });
};

export const extractSessionMemoryCandidatesApi = async (c: Context) => {
  const body = await readJsonBody(c);
  const userId = getUserId(c, body);
  const sessionId = c.req.param("sessionId");
  const reviewMode = String(body.reviewMode || c.req.query("reviewMode") || "manual_only");
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  try {
    const result = await extractSessionMemoryCandidates({
      userId,
      sessionId,
      limitCandidates: Number(body.limitCandidates || c.req.query("limit") || 8),
      promoteSafe: reviewMode === "auto_safe_knowledge" || body.promoteSafe === true || c.req.query("promoteSafe") === "true",
      reviewAll: reviewMode === "review_all",
    });

    return c.json({
      sessionId: result.sessionId,
      model: result.model,
      provider: result.provider,
      runtimeMode: result.runtimeMode,
      batchEnabled: result.batchEnabled,
      sessionSummary: result.sessionSummary,
      candidates: result.candidates.map(serializeCandidate),
      promoted: result.promoted,
      reviewMode,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to extract session memory candidates" }, 500);
  }
};

export const promoteSessionMemoryCandidate = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await readJsonBody(c);
  const userId = getUserId(c, body);

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "valid candidate id is required" }, 400);

  if (body.edit && typeof body.edit === "object") {
    const edited = conversationLogger.updateSessionMemoryCandidate(userId, id, {
      title: typeof body.edit.title === "string" ? body.edit.title : undefined,
      category: typeof body.edit.category === "string" ? body.edit.category : undefined,
      sensitivity: body.edit.sensitivity === "low" || body.edit.sensitivity === "medium" || body.edit.sensitivity === "high"
        ? body.edit.sensitivity
        : undefined,
      content: typeof body.edit.content === "string" ? body.edit.content : undefined,
      usageRule: typeof body.edit.usageRule === "string" ? body.edit.usageRule : undefined,
      keywords: Array.isArray(body.edit.keywords) ? body.edit.keywords.map(String) : undefined,
      evidence: Array.isArray(body.edit.evidence) ? body.edit.evidence.map(String) : undefined,
      status: "pending",
      rejectionReason: "",
    });
    if (!edited) return c.json({ error: "candidate not found" }, 404);
  }

  const result = conversationLogger.promoteSessionMemoryCandidate(userId, id);
  if (!result) return c.json({ error: "candidate not found or rejected" }, 404);

  return c.json({
    candidate: serializeCandidate(result.candidate),
    memory: result.memory,
  });
};

export const updateSessionMemoryCandidate = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await readJsonBody(c);
  const userId = getUserId(c, body);

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "valid candidate id is required" }, 400);

  const candidate = conversationLogger.updateSessionMemoryCandidate(userId, id, {
    title: typeof body.title === "string" ? body.title : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    sensitivity: body.sensitivity === "low" || body.sensitivity === "medium" || body.sensitivity === "high"
      ? body.sensitivity
      : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    usageRule: typeof body.usageRule === "string" ? body.usageRule : undefined,
    keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : undefined,
    evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : undefined,
    status: body.status === "pending" || body.status === "approved" || body.status === "rejected" ? body.status : undefined,
    rejectionReason: typeof body.rejectionReason === "string" ? body.rejectionReason : undefined,
  });

  if (!candidate) return c.json({ error: "candidate not found" }, 404);
  return c.json({ candidate: serializeCandidate(candidate) });
};

export const rejectSessionMemoryCandidate = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await readJsonBody(c);
  const userId = getUserId(c, body);
  const reason = String(body.reason || "Rejected by user").trim();

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "valid candidate id is required" }, 400);

  const candidate = conversationLogger.updateSessionMemoryCandidateStatus(userId, id, "rejected", reason);
  if (!candidate) return c.json({ error: "candidate not found" }, 404);

  return c.json({ candidate: serializeCandidate(candidate) });
};

export const deleteSessionMemoryCandidate = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await readJsonBody(c);
  const userId = getUserId(c, body);

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "valid candidate id is required" }, 400);

  const deleted = conversationLogger.deleteSessionMemoryCandidate(userId, id);
  if (!deleted) return c.json({ error: "candidate not found" }, 404);

  return c.json({ ok: true });
};
