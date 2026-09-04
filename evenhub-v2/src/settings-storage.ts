import { normalizeSupportedVoiceInput } from "./voice-input";
import type { ConversationSettings, CueDuration, SpeechLanguage } from "./types";

const SETTINGS_STORAGE_KEY = "saynext.evenhub.v2.settings";
export type BootstrapSettingsSource = "saved" | "default";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeLanguage(value: unknown, fallback: SpeechLanguage): SpeechLanguage {
  return value === "english" || value === "chinese" || value === "auto" ? value : fallback;
}

function normalizeCueDuration(value: unknown, fallback: CueDuration): CueDuration {
  return value === 5000 || value === 10000 || value === 15000 || value === "forever" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeConversationSettings(
  value: unknown,
  fallback: ConversationSettings,
): ConversationSettings {
  if (!isRecord(value)) return fallback;
  const glassContent = isRecord(value.glassContent) ? value.glassContent : {};
  return {
    voiceInput: normalizeSupportedVoiceInput(value.voiceInput === "phone" ? "phone" : "glasses"),
    language: normalizeLanguage(value.language, fallback.language),
    glassContent: {
      aiCue: normalizeBoolean(glassContent.aiCue, fallback.glassContent.aiCue),
      transcript: normalizeBoolean(glassContent.transcript, fallback.glassContent.transcript),
    },
    autoPopup: normalizeBoolean(value.autoPopup, fallback.autoPopup),
    cueDuration: normalizeCueDuration(value.cueDuration, fallback.cueDuration),
  };
}

export function loadStoredConversationSettings(fallback: ConversationSettings): ConversationSettings | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return normalizeConversationSettings(JSON.parse(raw), fallback);
  } catch {
    return null;
  }
}

export function saveConversationSettings(settings: ConversationSettings): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function resolveBootstrapConversationSettings(input: {
  current: ConversationSettings;
  bootstrap?: Partial<ConversationSettings>;
  bootstrapSource?: BootstrapSettingsSource;
  hasLocalSettings: boolean;
}): ConversationSettings {
  if (!input.bootstrap) return input.current;
  if (input.bootstrapSource === "default" && input.hasLocalSettings) return input.current;

  return normalizeConversationSettings({
    ...input.current,
    ...input.bootstrap,
    glassContent: {
      ...input.current.glassContent,
      ...input.bootstrap.glassContent,
    },
  }, input.current);
}
