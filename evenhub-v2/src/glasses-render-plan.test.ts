import { describe, expect, test } from "vitest";
import { buildGlassesPage } from "./glasses-layout";
import { glassPageStructureKey, hasGlassTranscriptContainer, shouldUseGlassTranscriptUpgrade } from "./glasses-render-plan";
import { startLiveGlasses } from "./glasses-state";
import { TEST_CUES, TEST_PRENOTES, TEST_TRANSCRIPT } from "./test-fixtures";

describe("glasses render plan", () => {
  test("transcript-only updates keep the same structure key", () => {
    const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };
    const first = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      now: new Date("2026-06-05T13:35:00-03:00"),
    });
    const second = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: [
        ...TEST_TRANSCRIPT,
        {
          id: "tr-4",
          time: "00:00:17",
          text: "A new transcript line should update only the transcript container.",
          partial: true,
        },
      ],
      now: new Date("2026-06-05T13:36:00-03:00"),
    });

    expect(hasGlassTranscriptContainer(first)).toBe(true);
    expect(glassPageStructureKey(second)).toBe(glassPageStructureKey(first));
  });

  test("cue list updates change the structure key", () => {
    const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };
    const first = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      now: new Date("2026-06-05T13:35:00-03:00"),
    });
    const second = buildGlassesPage({
      state,
      cues: [
        {
          ...TEST_CUES[0],
          id: "cue-new",
          title: "New cue",
          g2Title: "New cue",
        },
        ...TEST_CUES,
      ],
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      now: new Date("2026-06-05T13:35:00-03:00"),
    });

    expect(glassPageStructureKey(second)).not.toBe(glassPageStructureKey(first));
  });

  test("native transcript upgrade is allowed for any page with a transcript container", () => {
    const baseState = startLiveGlasses(TEST_CUES[0].id);
    const menu = buildGlassesPage({
      state: { ...baseState, view: "menu", selectedIndex: 0 },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const main = buildGlassesPage({
      state: { ...baseState, view: "main" },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const detail = buildGlassesPage({
      state: { ...baseState, view: "cue_detail" },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });

    expect(shouldUseGlassTranscriptUpgrade(menu)).toBe(true);
    expect(shouldUseGlassTranscriptUpgrade(main)).toBe(true);
    expect(shouldUseGlassTranscriptUpgrade(detail)).toBe(true);
  });
});
