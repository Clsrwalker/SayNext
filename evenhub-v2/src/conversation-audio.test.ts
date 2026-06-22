import { describe, expect, test } from "vitest";
import { planPauseToggle } from "./conversation-audio";

describe("planPauseToggle", () => {
  test("pauses by stopping backend audio and bridge audio", () => {
    expect(planPauseToggle({
      isListening: true,
      wsOpen: true,
      voiceInput: "glasses",
    })).toEqual({
      nextListening: false,
      bridgeAudio: { enabled: false },
      wsType: "audio_stop",
      offlineStatus: null,
    });
  });

  test("resumes by starting backend audio and glasses audio", () => {
    expect(planPauseToggle({
      isListening: false,
      wsOpen: true,
      voiceInput: "glasses",
    })).toEqual({
      nextListening: true,
      bridgeAudio: { enabled: true, source: "glasses" },
      wsType: "audio_start",
      offlineStatus: null,
    });
  });

  test("resumes by starting backend audio and phone audio", () => {
    expect(planPauseToggle({
      isListening: false,
      wsOpen: true,
      voiceInput: "phone",
    })).toEqual({
      nextListening: true,
      bridgeAudio: { enabled: true, source: "phone" },
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
      bridgeAudio: { enabled: false },
      wsType: null,
      offlineStatus: "pause_offline",
    });
  });
});
