import { describe, expect, test, vi } from "vitest";
import type { GlassBridgeHandle } from "./glasses-bridge";
import { buildGlassesPage } from "./glasses-layout";
import { createGlassRenderer } from "./glasses-renderer";
import { startLiveGlasses } from "./glasses-state";
import { TEST_CUES, TEST_PRENOTES, TEST_TRANSCRIPT } from "./test-fixtures";

function makeBridge(): GlassBridgeHandle {
  return {
    bridge: {} as GlassBridgeHandle["bridge"],
    render: vi.fn(() => Promise.resolve()),
    updateTextContainer: vi.fn(() => Promise.resolve(true)),
    setAudioEnabled: vi.fn(() => Promise.resolve(true)),
  };
}

describe("glass renderer", () => {
  test("updates transcript text without rebuilding the current list page", async () => {
    const bridge = makeBridge();
    const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 1 };
    const initialPage = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      now: new Date("2026-06-05T13:35:00-03:00"),
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    const updatedTranscriptPage = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: [
        ...TEST_TRANSCRIPT,
        {
          id: "partial",
          time: "00:00:18",
          text: "This line should update only the transcript area.",
          partial: true,
        },
      ],
      now: new Date("2026-06-05T13:35:01-03:00"),
    });

    await renderer.render(updatedTranscriptPage);

    expect(bridge.render).not.toHaveBeenCalled();
    expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1);
    expect(bridge.updateTextContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: "transcript",
      content: expect.stringContaining("This line should update only"),
    }));
  });

  test("rebuilds when menu selection changes", async () => {
    const bridge = makeBridge();
    const baseState = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };
    const initialPage = buildGlassesPage({
      state: baseState,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    const selectedPage = buildGlassesPage({
      state: { ...baseState, selectedIndex: 1 },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });

    await renderer.render(selectedPage);

    expect(bridge.render).toHaveBeenCalledTimes(1);
    expect(bridge.updateTextContainer).not.toHaveBeenCalled();
  });

  test("ignores transcript changes on pages without a transcript container", async () => {
    const bridge = makeBridge();
    const initialPage = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "prenote_detail" },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    const updatedPage = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "prenote_detail" },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: [
        ...TEST_TRANSCRIPT,
        {
          id: "ignored",
          time: "00:00:20",
          text: "This should not be pushed because the page has no transcript container.",
          partial: true,
        },
      ],
    });

    await renderer.render(updatedPage);

    expect(bridge.render).not.toHaveBeenCalled();
    expect(bridge.updateTextContainer).not.toHaveBeenCalled();
  });
});
