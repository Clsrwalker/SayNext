import { AudioInputSource } from "@evenrealities/even_hub_sdk";
import type { VoiceInput } from "./types";

export const PHONE_MIC_SUPPORTED = true;
export type AudioEventSource = VoiceInput | "unknown";

export function toSdkAudioInputSource(input: VoiceInput): AudioInputSource {
  return input === "phone" ? AudioInputSource.Phone : AudioInputSource.Glasses;
}

export function normalizeAudioEventSource(source: unknown): AudioEventSource {
  const normalized = audioSourceText(source).toLowerCase();
  if (normalized.includes("phone")) return "phone";
  if (normalized.includes("glasses") || normalized.includes("glass")) return "glasses";
  return "unknown";
}

function audioSourceText(source: unknown, depth = 0): string {
  if (typeof source === "string") return source.trim();
  if (source && typeof source === "object" && depth < 2) {
    const record = source as Record<string, unknown>;
    for (const key of ["source", "value", "name", "type"]) {
      const value = record[key];
      const nested = audioSourceText(value, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

export function isExplicitAudioSourceMismatch(activeSource: VoiceInput, chunkSource: AudioEventSource): boolean {
  return chunkSource !== "unknown" && activeSource !== chunkSource;
}
