import { describe, expect, test } from "vitest";
import { planPauseToggle } from "./conversation-audio";

describe("planPauseToggle", () => {
  test("pauses by stopping backend audio and G2 audio", () => {
    expect(planPauseToggle({
      isListening: true,
      wsOpen: true,
      voiceInput: "glasses",
    })).toEqual({
      nextListening: false,
      enableGlassAudio: false,
      wsType: "audio_stop",
      offlineStatus: null,
    });
  });

  test("resumes by starting backend audio and G2 audio", () => {
    expect(planPauseToggle({
      isListening: false,
      wsOpen: true,
      voiceInput: "glasses",
    })).toEqual({
      nextListening: true,
      enableGlassAudio: true,
      wsType: "audio_start",
      offlineStatus: null,
    });
  });

  test("keeps local pause state when backend is offline", () => {
    expect(planPauseToggle({
      isListening: true,
      wsOpen: false,
      voiceInput: "glasses",
    })).toMatchObject({
      nextListening: false,
      enableGlassAudio: false,
      wsType: null,
      offlineStatus: "pause_offline",
    });
  });
});
