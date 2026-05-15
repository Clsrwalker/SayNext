/**
 * API Route Definitions
 */

import { Hono } from "hono";
import { getHealth } from "../api/health";
import { insightStream } from "../api/insights";
import { getSettings, updateSettings } from "../api/settings";
import { listConversationEvents, listConversationSamples, updateConversationSample } from "../api/conversation-samples";
import {
  listPersonalMemoryItems,
  listPersonalizationPipelineRuns,
  processConversationEventForPersonalization,
  processConversationSampleForPersonalization,
} from "../api/personalization-pipeline";

export const api = new Hono();

// Health
api.get("/health", getHealth);

// SSE stream for insights
api.get("/insight-stream", insightStream);

// Settings (frequency, theme)
api.get("/settings", getSettings);
api.patch("/settings", updateSettings);

// Conversation samples for rating and future personalization datasets
api.get("/conversation-samples", listConversationSamples);
api.patch("/conversation-samples/:id", updateConversationSample);
api.get("/conversation-events", listConversationEvents);

// Offline/local-LLM personalization pipeline
api.get("/personalization-pipeline/runs", listPersonalizationPipelineRuns);
api.post("/personalization-pipeline/samples/:id", processConversationSampleForPersonalization);
api.post("/personalization-pipeline/events/:id", processConversationEventForPersonalization);
api.get("/personal-memory", listPersonalMemoryItems);
