import type { VoiceInput } from "./types";

export type AudioTogglePlan = {
  nextListening: boolean;
  enableGlassAudio: boolean;
  wsType: "audio_start" | "audio_stop" | null;
  offlineStatus: "pause_offline" | "resume_offline" | null;
};

export function planPauseToggle(params: {
  isListening: boolean;
  wsOpen: boolean;
  voiceInput: VoiceInput;
}): AudioTogglePlan {
  if (params.isListening) {
    return {
      nextListening: false,
      enableGlassAudio: false,
      wsType: params.wsOpen ? "audio_stop" : null,
      offlineStatus: params.wsOpen ? null : "pause_offline",
    };
  }

  return {
    nextListening: true,
    enableGlassAudio: params.voiceInput === "glasses",
    wsType: params.wsOpen ? "audio_start" : null,
    offlineStatus: params.wsOpen ? null : "resume_offline",
  };
}
