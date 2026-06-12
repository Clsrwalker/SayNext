import type { VoiceInput } from "./types";

export const PHONE_MIC_SUPPORTED = false;

export function isVoiceInputSelectable(input: VoiceInput): boolean {
  return input !== "phone" || PHONE_MIC_SUPPORTED;
}

export function normalizeSupportedVoiceInput(input: VoiceInput): VoiceInput {
  return isVoiceInputSelectable(input) ? input : "glasses";
}
