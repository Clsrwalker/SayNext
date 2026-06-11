import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeManualCue } from "./mock-data";

describe("makeManualCue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("uses a time-specific title so repeated manual cues are distinguishable in the G2 list", () => {
    vi.setSystemTime(new Date("2026-06-05T13:35:22-03:00"));
    const cue = makeManualCue("What is batch normalization?");
    expect(cue.title).toBe("SayNext 1:35:22 PM");
  });
});
