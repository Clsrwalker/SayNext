import { AudioInputSource } from "@evenrealities/even_hub_sdk";
import { describe, expect, test } from "vitest";
import { normalizeAudioEventSource, PHONE_MIC_SUPPORTED, toSdkAudioInputSource } from "./audio-source";

describe("audio source mapping", () => {
  test("maps app voice input to EvenHub SDK audio source", () => {
    expect(toSdkAudioInputSource("glasses")).toBe(AudioInputSource.Glasses);
    expect(toSdkAudioInputSource("phone")).toBe(AudioInputSource.Phone);
  });

  test("normalizes event source defensively", () => {
    expect(normalizeAudioEventSource("phone")).toBe("phone");
    expect(normalizeAudioEventSource("glasses")).toBe("glasses");
    expect(normalizeAudioEventSource(undefined)).toBe("glasses");
  });

  test("enables phone mic once SDK source selection is available", () => {
    expect(PHONE_MIC_SUPPORTED).toBe(true);
  });
});
