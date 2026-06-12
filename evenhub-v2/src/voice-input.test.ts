import { describe, expect, test } from "vitest";
import { isVoiceInputSelectable, normalizeSupportedVoiceInput } from "./voice-input";

describe("voice input support", () => {
  test("keeps glasses input selectable", () => {
    expect(isVoiceInputSelectable("glasses")).toBe(true);
    expect(normalizeSupportedVoiceInput("glasses")).toBe("glasses");
  });

  test("falls phone input back to glasses until phone mic is implemented", () => {
    expect(isVoiceInputSelectable("phone")).toBe(false);
    expect(normalizeSupportedVoiceInput("phone")).toBe("glasses");
  });
});
