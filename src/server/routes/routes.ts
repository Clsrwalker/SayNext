/**
 * API Route Definitions
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { conversationLogger } from "../data/conversation-logger";
import { authorizeEvenHubV2Request, createEvenHubV2WsTicket, isEvenHubV2OriginAllowed, requireEvenHubV2Authorization } from "../evenhub-v2/auth";
import { getHealth } from "../api/health";
import { insightStream } from "../api/insights";
import { getSettings, updateSettings } from "../api/settings";
import { clearManual, generateManual, getManualState, pageManual, regenerateManual } from "../api/manual";
import { advanceTeleprompt, cancelTeleprompt, resetCurrentSession, rewindTeleprompt } from "../api/session";
import { listConversationEvents, listConversationSamples, updateConversationSample } from "../api/conversation-samples";
import {
  listPersonalMemoryItems,
  listPersonalizationPipelineRuns,
  processConversationEventForPersonalization,
  processConversationSampleForPersonalization,
} from "../api/personalization-pipeline";
import {
  createPrenote,
  deletePrenote,
  getPrenote,
  listPrenoteChunksApi,
  listPrenotes,
  queuePrenoteKnowledgeReviewApi,
  reindexPrenoteChunksApi,
  updatePrenote,
} from "../api/prenotes";
import { getTranscriptExport, listTranscriptExports, summarizeTranscriptExport } from "../api/transcript-exports";
import { createSceneProfile, deleteSceneProfile, getSceneProfile, listSceneProfiles, updateSceneProfile } from "../api/scene-profiles";
import { createPersonalMemory, deletePersonalMemory, listPersonalMemories, searchPersonalMemories, updatePersonalMemory } from "../api/personal-memories";
import { replaySayNextApi } from "../api/debug-saynext-replay";
import {
  createEvenHubV2Prenote,
  deleteEvenHubV2Prenote,
  deleteEvenHubV2Conversation,
  getEvenHubV2Bootstrap,
  getEvenHubV2Conversation,
  listEvenHubV2Conversations,
  updateEvenHubV2Prenote,
  updateEvenHubV2Settings,
  retryEvenHubV2Summary,
} from "../api/evenhub-v2";
import {
  extractSessionMemoryCandidatesApi,
  deleteSessionMemoryCandidate,
  listSessionMemoryCandidates,
  promoteSessionMemoryCandidate,
  rejectSessionMemoryCandidate,
  updateSessionMemoryCandidate,
} from "../api/session-memory-candidates";

export const api = new Hono();

api.use("/evenhub/v2/*", async (c, next) => {
  if (!isEvenHubV2OriginAllowed(c.req.header("origin"))) {
    return c.json({ code: "origin_not_allowed", error: "Request origin is not allowed." }, 403);
  }
  await next();
});
api.use("/evenhub/v2/*", cors({
  origin: (origin) => isEvenHubV2OriginAllowed(origin) ? origin : "",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
api.use("/evenhub/v2/*", requireEvenHubV2Authorization);

// AppServer verifies Mentra tokens/cookies before mounting this router. Never
// accept an SDK uid, request userId, or an unverified cookie as proof of identity.
export const requireLegacyApiAuthorization: MiddlewareHandler = async (c, next) => {
  const path = c.req.path.replace(/^\/api(?=\/)/, "");
  if (path === "/health" || path.startsWith("/evenhub/v2/")) return next();
  const verifiedMentraOwner = c.get("authUserId") as string | undefined;
  let ownerId: string;
  if (verifiedMentraOwner) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin && !isEvenHubV2OriginAllowed(origin)) {
      return c.json({ code: "origin_not_allowed", error: "Request origin is not allowed." }, 403);
    }
    ownerId = verifiedMentraOwner;
  } else {
    const result = authorizeEvenHubV2Request(c.req.raw);
    if (!result.ok) return c.json({ code: result.code, error: result.error }, result.status);
    ownerId = result.principal.ownerId;
  }
  c.header("Cache-Control", "no-store");
  const suppliedOwners: unknown[] = new URL(c.req.url).searchParams.getAll("userId");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const type = c.req.header("content-type") || "";
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const body = await c.req.formData().catch(() => null);
      suppliedOwners.push(...(body?.getAll("userId") || []));
    } else {
      // Hono caches this parsed body for the existing handlers.
      const body = await c.req.json().catch(() => null);
      if (body && typeof body === "object" && Object.hasOwn(body, "userId")) suppliedOwners.push(body.userId);
    }
  }
  if (suppliedOwners.some((value) => typeof value !== "string" || value.trim() !== ownerId)) {
    return c.json({ code: "owner_mismatch", error: "Resource not found." }, 404);
  }
  // These legacy handlers address a row without a userId. Check the row before
  // the existing cached-read/update code can access another owner's data.
  const sampleMatch = path.match(/^\/(?:conversation-samples|personalization-pipeline\/samples)\/([^/]+)$/);
  const eventMatch = path.match(/^\/personalization-pipeline\/events\/([^/]+)$/);
  if (sampleMatch || eventMatch) {
    const row = sampleMatch
      ? conversationLogger.getSample(Number(sampleMatch[1]))
      : conversationLogger.getEvent(decodeURIComponent(eventMatch![1]!));
    if (!row || row.userId !== ownerId) return c.json({ error: "Resource not found." }, 404);
  } else if (!suppliedOwners.length) {
    return c.json({ error: "userId is required" }, 400);
  }
  await next();
};
api.use("*", requireLegacyApiAuthorization);

// Health
api.get("/health", getHealth);

// SSE stream for insights
api.get("/insight-stream", insightStream);

// Settings (frequency, theme)
api.get("/settings", getSettings);
api.patch("/settings", updateSettings);
api.post("/session/reset", resetCurrentSession);
api.post("/teleprompt/next", advanceTeleprompt);
api.post("/teleprompt/previous", rewindTeleprompt);
api.post("/teleprompt/cancel", cancelTeleprompt);
api.get("/manual/state", getManualState);
api.post("/manual/generate", generateManual);
api.post("/manual/regenerate", regenerateManual);
api.post("/manual/page", pageManual);
api.post("/manual/clear", clearManual);

// Conversation samples for rating and future personalization datasets
api.get("/conversation-samples", listConversationSamples);
api.patch("/conversation-samples/:id", updateConversationSample);
api.get("/conversation-events", listConversationEvents);

// Offline/local-LLM personalization pipeline
api.get("/personalization-pipeline/runs", listPersonalizationPipelineRuns);
api.post("/personalization-pipeline/samples/:id", processConversationSampleForPersonalization);
api.post("/personalization-pipeline/events/:id", processConversationEventForPersonalization);
api.get("/personal-memory", listPersonalMemoryItems);

// Personal memory library with local hybrid search
api.get("/personal-memories", listPersonalMemories);
api.post("/personal-memories", createPersonalMemory);
api.post("/personal-memories/search", searchPersonalMemories);
api.patch("/personal-memories/:id", updatePersonalMemory);
api.delete("/personal-memories/:id", deletePersonalMemory);

// Prenotes: prepared scene/context memory
api.get("/prenotes", listPrenotes);
api.post("/prenotes", createPrenote);
api.get("/prenotes/:id", getPrenote);
api.get("/prenotes/:id/chunks", listPrenoteChunksApi);
api.post("/prenotes/:id/reindex", reindexPrenoteChunksApi);
api.post("/prenotes/:id/review-candidate", queuePrenoteKnowledgeReviewApi);
api.patch("/prenotes/:id", updatePrenote);
api.delete("/prenotes/:id", deletePrenote);

// Scene profiles: user-selected behavior/prompt strategy
api.get("/scene-profiles", listSceneProfiles);
api.post("/scene-profiles", createSceneProfile);
api.get("/scene-profiles/:id", getSceneProfile);
api.patch("/scene-profiles/:id", updateSceneProfile);
api.delete("/scene-profiles/:id", deleteSceneProfile);

// Transcript/session export
api.get("/transcript-exports", listTranscriptExports);
api.get("/transcript-exports/:sessionId", getTranscriptExport);
api.post("/transcript-exports/:sessionId/summary", summarizeTranscriptExport);
api.get("/session-memory-candidates", listSessionMemoryCandidates);
api.post("/session-memory/:sessionId/extract", extractSessionMemoryCandidatesApi);
api.patch("/session-memory-candidates/:id", updateSessionMemoryCandidate);
api.post("/session-memory-candidates/:id/promote", promoteSessionMemoryCandidate);
api.post("/session-memory-candidates/:id/reject", rejectSessionMemoryCandidate);
api.delete("/session-memory-candidates/:id", deleteSessionMemoryCandidate);

// Local replay/debug endpoint. The handler returns 404 unless explicitly enabled.
api.post("/debug/saynext-replay", replaySayNextApi);

// EvenHub v2 app bootstrap/history. The websocket lives at /api/evenhub/v2/ws.
api.post("/evenhub/v2/auth/ws-ticket", createEvenHubV2WsTicket);
api.get("/evenhub/v2/bootstrap", getEvenHubV2Bootstrap);
api.patch("/evenhub/v2/settings", updateEvenHubV2Settings);
api.post("/evenhub/v2/prenotes", createEvenHubV2Prenote);
api.patch("/evenhub/v2/prenotes/:id", updateEvenHubV2Prenote);
api.delete("/evenhub/v2/prenotes/:id", deleteEvenHubV2Prenote);
api.get("/evenhub/v2/conversations", listEvenHubV2Conversations);
api.get("/evenhub/v2/conversations/:id", getEvenHubV2Conversation);
api.post("/evenhub/v2/conversations/:id/summary/retry", retryEvenHubV2Summary);
api.delete("/evenhub/v2/conversations/:id", deleteEvenHubV2Conversation);
