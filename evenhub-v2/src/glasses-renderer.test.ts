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
    dispose: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("glass renderer", () => {
  test("opens code detail by rebuilding an empty container before upgrading the full content", async () => {
    const bridge = makeBridge();
    const codeCue = {
      ...TEST_CUES[0],
      id: "cue-code-detail",
      category: "code" as const,
      title: "Book library classes",
      g2Title: "Book Library Classes",
      output: "class Book {\n  constructor(public title: string) {}\n}",
      code: "class Book {\n  constructor(public title: string) {}\n}",
    };
    const initialPage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "menu" },
      cues: [codeCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const detailPage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "cue_detail" },
      cues: [codeCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    await renderer.render(detailPage);

    expect(bridge.render).toHaveBeenCalledTimes(1);
    const rebuiltPage = vi.mocked(bridge.render).mock.calls[0][0];
    const rebuiltCue = rebuiltPage.containers.find(
      (container) => container.kind === "text" && container.deferContentUntilUpgrade,
    );
    expect(rebuiltCue?.kind === "text" ? rebuiltCue.content : null).toBe("");
    expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1);
    expect(bridge.updateTextContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: rebuiltCue?.name,
      content: expect.stringContaining("class Book"),
    }));
    expect(vi.mocked(bridge.render).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(bridge.updateTextContainer).mock.invocationCallOrder[0]);
  });

  test("retries one transient code detail upgrade failure without committing a stale snapshot", async () => {
    const bridge = makeBridge();
    bridge.updateTextContainer = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const codeCue = {
      ...TEST_CUES[0],
      id: "cue-code-retry",
      category: "code" as const,
      title: "Retry code detail",
      g2Title: "Retry Code",
      output: "def solve():\n  return True",
      code: "def solve():\n  return True",
    };
    const initialPage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "menu" },
      cues: [codeCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const detailPage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "cue_detail" },
      cues: [codeCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    await renderer.render(detailPage);

    expect(bridge.render).toHaveBeenCalledTimes(2);
    expect(bridge.updateTextContainer).toHaveBeenCalledTimes(2);

    await renderer.render(detailPage);
    expect(bridge.render).toHaveBeenCalledTimes(2);
    expect(bridge.updateTextContainer).toHaveBeenCalledTimes(2);
  });

  test("retries one transient native rebuild failure", async () => {
    const bridge = makeBridge();
    bridge.render = vi.fn()
      .mockRejectedValueOnce(new Error("rebuild_page_failed"))
      .mockResolvedValueOnce(undefined);
    const initialPage = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" },
      cues: TEST_CUES,
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const detailPage = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "cue_detail" },
      cues: TEST_CUES,
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    await renderer.render(detailPage);

    expect(bridge.render).toHaveBeenCalledTimes(2);

    await renderer.render(detailPage);
    expect(bridge.render).toHaveBeenCalledTimes(2);
  });

  test("surfaces a persistent native rebuild failure after one retry", async () => {
    const bridge = makeBridge();
    bridge.render = vi.fn().mockRejectedValue(new Error("rebuild_page_failed"));
    const initialPage = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" },
      cues: TEST_CUES,
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const detailPage = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "cue_detail" },
      cues: TEST_CUES,
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    await expect(renderer.render(detailPage)).rejects.toThrow("rebuild_page_failed");
    expect(bridge.render).toHaveBeenCalledTimes(2);
  });

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
      content: expect.stringContaining("should update only"),
    }));
  });

  test("does not rebuild when only the logical menu selection changes", async () => {
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

    expect(bridge.render).not.toHaveBeenCalled();
    expect(bridge.updateTextContainer).not.toHaveBeenCalled();
  });

  test("continues with the latest queued page when a code detail upgrade fails", async () => {
    const bridge = makeBridge();
    const codeUpgrade = deferred<boolean>();
    bridge.updateTextContainer = vi.fn()
      .mockImplementationOnce(() => codeUpgrade.promise);
    const codeCue = {
      ...TEST_CUES[0],
      id: "cue-code-queued-recovery",
      category: "code" as const,
      title: "Queued recovery code",
      g2Title: "Recovery Code",
      output: "class Queue:\n  pass",
      code: "class Queue:\n  pass",
    };
    const responseCue = {
      ...TEST_CUES[1],
      id: "cue-response-queued-recovery",
      title: "Queued recovery answer",
      g2Title: "Recovery Answer",
      output: "The queued response should render after code upgrade failure.",
    };
    const initialPage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "menu" },
      cues: [codeCue, responseCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const codePage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "cue_detail" },
      cues: [codeCue, responseCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const responsePage = buildGlassesPage({
      state: { ...startLiveGlasses(codeCue.id), view: "cue_detail", activeCueId: responseCue.id },
      cues: [codeCue, responseCue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);

    const openingCode = renderer.render(codePage);
    await vi.waitFor(() => expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1));
    const openingResponse = renderer.render(responsePage);
    codeUpgrade.resolve(false);

    await Promise.all([openingCode, openingResponse]);

    expect(bridge.render).toHaveBeenCalledTimes(2);
    expect(bridge.render).toHaveBeenLastCalledWith(expect.objectContaining({
      containers: expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("queued response should render"),
        }),
      ]),
    }));

    await renderer.render(responsePage);
    expect(bridge.render).toHaveBeenCalledTimes(2);
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

  test("forces a full rebuild after transcript upgrade fails", async () => {
    const bridge = makeBridge();
    bridge.updateTextContainer = vi.fn(() => Promise.resolve(false));
    const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 1 };
    const initialPage = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
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
          text: "This failed upgrade should mark the renderer dirty.",
          partial: true,
        },
      ],
    });

    await renderer.render(updatedTranscriptPage);
    await renderer.render(updatedTranscriptPage);

    expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1);
    expect(bridge.render).toHaveBeenCalledTimes(1);
  });

  test("coalesces queued transcript updates and sends only the latest pending content", async () => {
    const bridge = makeBridge();
    const firstUpgrade = deferred<boolean>();
    bridge.updateTextContainer = vi.fn()
      .mockImplementationOnce(() => firstUpgrade.promise)
      .mockResolvedValue(true);
    const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 1 };
    const initialPage = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const renderer = createGlassRenderer(bridge, initialPage);
    const pageWithPartial = (text: string) => buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: [
        ...TEST_TRANSCRIPT,
        {
          id: "partial",
          time: "00:00:18",
          text,
          partial: true,
        },
      ],
    });

    const first = renderer.render(pageWithPartial("first partial"));
    await vi.waitFor(() => expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1));
    const middle = renderer.render(pageWithPartial("middle partial that should be superseded"));
    const latest = renderer.render(pageWithPartial("latest partial that must reach the glasses"));

    firstUpgrade.resolve(true);
    await Promise.all([first, middle, latest]);

    expect(bridge.updateTextContainer).toHaveBeenCalledTimes(2);
    expect(bridge.updateTextContainer).toHaveBeenLastCalledWith(expect.objectContaining({
      content: expect.stringContaining("latest partial"),
    }));
    expect(bridge.updateTextContainer).not.toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("middle partial"),
    }));
  });

  test("recovers a stuck transcript upgrade with one full rebuild of the latest page", async () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge();
      bridge.updateTextContainer = vi.fn(() => new Promise<boolean>(() => undefined));
      const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 1 };
      const initialPage = buildGlassesPage({
        state,
        cues: TEST_CUES,
        prenote: TEST_PRENOTES[0],
        transcript: TEST_TRANSCRIPT,
      });
      const renderer = createGlassRenderer(bridge, initialPage, {
        transcriptUpgradeTimeoutMs: 100,
      });
      const pageWithPartial = (text: string) => buildGlassesPage({
        state,
        cues: TEST_CUES,
        prenote: TEST_PRENOTES[0],
        transcript: [
          ...TEST_TRANSCRIPT,
          {
            id: "partial",
            time: "00:00:18",
            text,
            partial: true,
          },
        ],
      });

      const first = renderer.render(pageWithPartial("stale transcript while the native upgrade is stuck"));
      await vi.waitFor(() => expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1));
      const latest = renderer.render(pageWithPartial(
        "latest transcript after the native upgrade stopped responding",
      ));
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all([first, latest]);

      expect(bridge.updateTextContainer).toHaveBeenCalledTimes(1);
      expect(bridge.render).toHaveBeenCalledTimes(1);
      expect(bridge.render).toHaveBeenCalledWith(expect.objectContaining({
        containers: expect.arrayContaining([
          expect.objectContaining({
            name: "transcript",
            content: expect.stringContaining("latest transcript"),
          }),
        ]),
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
