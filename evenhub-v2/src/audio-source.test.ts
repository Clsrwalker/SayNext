import { AudioInputSource } from "@evenrealities/even_hub_sdk";
import { describe, expect, test } from "vitest";
import { isExplicitAudioSourceMismatch, normalizeAudioEventSource, PHONE_MIC_SUPPORTED, toSdkAudioInputSource } from "./audio-source";

describe("audio source mapping", () => {
  test("maps app voice input to EvenHub SDK audio source", () => {
    expect(toSdkAudioInputSource("glasses")).toBe(AudioInputSource.Glasses);
    expect(toSdkAudioInputSource("phone")).toBe(AudioInputSource.Phone);
  });

  test("normalizes event source defensively", () => {
    expect(normalizeAudioEventSource("phone")).toBe("phone");
    expect(normalizeAudioEventSource("glasses")).toBe("glasses");
    expect(normalizeAudioEventSource("Phone")).toBe("phone");
    expect(normalizeAudioEventSource("AudioInputSource.Glasses")).toBe("glasses");
    expect(normalizeAudioEventSource({ source: "phone" })).toBe("phone");
    expect(normalizeAudioEventSource({ name: "Glasses" })).toBe("glasses");
    expect(normalizeAudioEventSource(undefined)).toBe("unknown");
  });

  test("enables phone mic once SDK source selection is available", () => {
    expect(PHONE_MIC_SUPPORTED).toBe(true);
  });

  test("detects explicit mismatches without treating unknown source as mismatch", () => {
    expect(isExplicitAudioSourceMismatch("glasses", "glasses")).toBe(false);
    expect(isExplicitAudioSourceMismatch("phone", "phone")).toBe(false);
    expect(isExplicitAudioSourceMismatch("phone", "unknown")).toBe(false);
    expect(isExplicitAudioSourceMismatch("glasses", "unknown")).toBe(false);
    expect(isExplicitAudioSourceMismatch("glasses", "phone")).toBe(true);
    expect(isExplicitAudioSourceMismatch("phone", "glasses")).toBe(true);
  });
});
