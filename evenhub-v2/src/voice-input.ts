import type { VoiceInput } from "./types";
import { PHONE_MIC_SUPPORTED } from "./audio-source";

export { PHONE_MIC_SUPPORTED };

export function isVoiceInputSelectable(input: VoiceInput): boolean {
  return input !== "phone" || PHONE_MIC_SUPPORTED;
}

export function normalizeSupportedVoiceInput(input: VoiceInput): VoiceInput {
  return isVoiceInputSelectable(input) ? input : "glasses";
}
