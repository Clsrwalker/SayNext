import { describe, expect, test } from "vitest";
import { isVoiceInputSelectable, normalizeSupportedVoiceInput } from "./voice-input";

describe("voice input support", () => {
  test("keeps glasses input selectable", () => {
    expect(isVoiceInputSelectable("glasses")).toBe(true);
    expect(normalizeSupportedVoiceInput("glasses")).toBe("glasses");
  });

  test("keeps phone input selectable when SDK source selection is available", () => {
    expect(isVoiceInputSelectable("phone")).toBe(true);
    expect(normalizeSupportedVoiceInput("phone")).toBe("phone");
  });
});
