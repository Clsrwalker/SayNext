import { describe, expect, test } from "vitest";
import { updateGlassContentSetting } from "./glass-content-settings";
import type { ConversationSettings } from "./types";

const BASE_SETTINGS: ConversationSettings = {
  voiceInput: "glasses",
  language: "english",
  glassContent: {
    aiCue: true,
    transcript: true,
  },
  autoPopup: true,
  cueDuration: 10000,
};

describe("updateGlassContentSetting", () => {
  test("updates one glasses display flag without mutating the original settings", () => {
    const next = updateGlassContentSetting(BASE_SETTINGS, "transcript", false);

    expect(next.glassContent).toEqual({
      aiCue: true,
      transcript: false,
    });
    expect(BASE_SETTINGS.glassContent).toEqual({
      aiCue: true,
      transcript: true,
    });
  });
});
