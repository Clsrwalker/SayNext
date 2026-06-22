import { AudioInputSource } from "@evenrealities/even_hub_sdk";
import type { VoiceInput } from "./types";

export const PHONE_MIC_SUPPORTED = true;

export function toSdkAudioInputSource(input: VoiceInput): AudioInputSource {
  return input === "phone" ? AudioInputSource.Phone : AudioInputSource.Glasses;
}

export function normalizeAudioEventSource(source: unknown): VoiceInput {
  return String(source || "").toLowerCase() === "phone" ? "phone" : "glasses";
}
