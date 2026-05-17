export const TRANSCRIPT_HISTORY_LENGTH = 10;
export const INSIGHTS_HISTORY_LENGTH = 100;
export const UTTERANCE_TIMEOUT_MS = 1800;
export const INSIGHT_CACHE_SIZE = 10;
export const SIMILARITY_THRESHOLD = 0.7;
export const INSIGHT_DISPLAY_DURATION_MS = 8000;
export const MANUAL_PAUSE_DISPLAY_DURATION_MS = 10 * 60 * 1000;
export const TELEPROMPT_DISPLAY_DURATION_MS = 60 * 1000;

// Insight history settings (for webview persistence)
export const MAX_INSIGHT_HISTORY = 50;
export const MAX_INSIGHT_AGE_MS = 60 * 60 * 1000; // 1 hour

// Session grace period
export const SESSION_GRACE_PERIOD_MS = 60000; // 60 seconds

export type SayNextRuntimeMode = "local" | "travel";
export type SessionMemoryProvider = "ollama" | "openai";

export function getSayNextRuntimeMode(): SayNextRuntimeMode {
  const raw = String(process.env.SAYNEXT_RUNTIME_MODE || process.env.SAYNEXT_MODE || "local").toLowerCase();
  return raw === "travel" || raw === "vps" || raw === "remote" ? "travel" : "local";
}

export function getSessionMemoryProvider(explicitProvider?: SessionMemoryProvider): SessionMemoryProvider {
  // Travel mode must be synchronous and self-contained on the VPS.
  // Do not leave async batch jobs or local-Ollama dependencies behind.
  if (getSayNextRuntimeMode() === "travel") return "openai";

  if (explicitProvider === "ollama" || explicitProvider === "openai") return explicitProvider;

  const raw = String(process.env.SESSION_MEMORY_PROVIDER || "").toLowerCase();
  if (raw === "openai" || raw === "ollama") return raw;

  return "ollama";
}

export function isSessionMemoryBatchEnabled(): boolean {
  if (getSayNextRuntimeMode() === "travel") return false;
  return String(process.env.SESSION_MEMORY_BATCH_ENABLED || "false").toLowerCase() === "true";
}
