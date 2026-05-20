/**
 * API Route Definitions
 */

import { Hono } from "hono";
import { getHealth } from "../api/health";
import { insightStream } from "../api/insights";
import { getSettings, updateSettings } from "../api/settings";
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
  extractSessionMemoryCandidatesApi,
  deleteSessionMemoryCandidate,
  listSessionMemoryCandidates,
  promoteSessionMemoryCandidate,
  rejectSessionMemoryCandidate,
  updateSessionMemoryCandidate,
} from "../api/session-memory-candidates";

export const api = new Hono();

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
