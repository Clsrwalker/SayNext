import { StartUpPageCreateResult } from "@evenrealities/even_hub_sdk";
import { describe, expect, test, vi } from "vitest";
import {
  connectResolvedGlassBridge,
  createStartupPage,
  getRebuildPageContainer,
  readAudioChunk,
  rebuildGlassPage,
  REBUILD_PAGE_FAILED_CODE,
  REBUILD_UNAVAILABLE_CODE,
  STARTUP_PAGE_CREATE_FAILED_CODE,
} from "./glasses-bridge";

describe("glasses bridge rebuild support", () => {
  test("returns rebuild function when the host exposes it", () => {
    const rebuildPageContainer = async () => undefined;
    expect(getRebuildPageContainer({ rebuildPageContainer })).toBe(rebuildPageContainer);
  });

  test("throws a clear error when rebuilding is unavailable after startup", () => {
    expect(() => getRebuildPageContainer({})).toThrow(REBUILD_UNAVAILABLE_CODE);
  });

  test("rejects a false rebuild result instead of treating it as rendered", async () => {
    const bridge = {
      rebuildPageContainer: vi.fn(async () => false),
    };

    await expect(rebuildGlassPage(bridge as any, {} as any)).rejects.toThrow(REBUILD_PAGE_FAILED_CODE);
  });
});

describe("glasses bridge startup support", () => {
  test("accepts only the SDK startup success result", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => StartUpPageCreateResult.success),
    };

    await expect(createStartupPage(bridge as any, {} as any)).resolves.toBeUndefined();
  });

  test("surfaces the SDK startup failure code", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => StartUpPageCreateResult.invalid),
    };

    await expect(createStartupPage(bridge as any, {} as any)).rejects.toThrow(
      `${STARTUP_PAGE_CREATE_FAILED_CODE}:invalid`,
    );
  });
});

describe("glasses bridge audio parsing", () => {
  test("reads Uint8Array audio chunks with source", () => {
    const audio = readAudioChunk({
      audioEvent: {
        audioPcm: new Uint8Array([1, 2, 3]),
        source: "phone",
      },
    } as any);

    expect(audio?.source).toBe("phone");
    expect(Array.from(audio?.pcm || [])).toEqual([1, 2, 3]);
  });

  test("reads base64 audio chunks when host serializes PCM as a string", () => {
    const audio = readAudioChunk({
      audioEvent: {
        audioPcm: "AQID",
        source: "glasses",
      },
    } as any);

    expect(audio?.source).toBe("glasses");
    expect(Array.from(audio?.pcm || [])).toEqual([1, 2, 3]);
  });
});

describe("glasses bridge event subscription lifecycle", () => {
  function makeBridge(
    startupResult = StartUpPageCreateResult.success,
    rebuildResult = true,
  ) {
    const listeners = new Set<(event: any) => void>();
    const unsubscribe = vi.fn((listener: (event: any) => void) => {
      listeners.delete(listener);
    });
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => startupResult),
      rebuildPageContainer: vi.fn(async () => rebuildResult),
      textContainerUpgrade: vi.fn(async () => true),
      audioControl: vi.fn(async () => true),
      onEvenHubEvent: vi.fn((listener: (event: any) => void) => {
        listeners.add(listener);
        return () => unsubscribe(listener);
      }),
    };
    return { bridge, listeners, unsubscribe };
  }

  const page = { containers: [] } as any;

  test("adopts an existing native page when startup returns invalid but rebuild succeeds", async () => {
    const { bridge, listeners } = makeBridge(StartUpPageCreateResult.invalid, true);

    const handle = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
    });

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.onEvenHubEvent).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    handle.dispose();
  });

  test("reconnects after the JS handle is disposed while the native page remains", async () => {
    const { bridge, listeners } = makeBridge();
    bridge.createStartUpPageContainer
      .mockResolvedValueOnce(StartUpPageCreateResult.success)
      .mockResolvedValueOnce(StartUpPageCreateResult.invalid);
    const firstEvent = vi.fn();
    const latestEvent = vi.fn();

    const first = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: firstEvent,
    });
    first.dispose();
    expect(listeners.size).toBe(0);

    const latest = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: latestEvent,
    });
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);

    for (const listener of listeners) {
      listener({ listEvent: { eventType: 0 } });
    }
    expect(firstEvent).not.toHaveBeenCalled();
    expect(latestEvent).toHaveBeenCalledTimes(1);
    latest.dispose();
  });

  test("does not register an event listener when invalid startup cannot be adopted", async () => {
    const { bridge } = makeBridge(StartUpPageCreateResult.invalid, false);

    await expect(connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
    })).rejects.toThrow(STARTUP_PAGE_CREATE_FAILED_CODE);

    expect(bridge.onEvenHubEvent).not.toHaveBeenCalled();
  });

  test("does not use rebuild to hide an oversize startup page", async () => {
    const { bridge } = makeBridge(StartUpPageCreateResult.oversize, true);

    await expect(connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
    })).rejects.toThrow(`${STARTUP_PAGE_CREATE_FAILED_CODE}:oversize`);

    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    expect(bridge.onEvenHubEvent).not.toHaveBeenCalled();
  });

  test("recreates the startup page when a later rebuild finds no native page", async () => {
    const { bridge } = makeBridge();
    const diagnostics: any[] = [];
    bridge.createStartUpPageContainer
      .mockResolvedValueOnce(StartUpPageCreateResult.success)
      .mockResolvedValueOnce(StartUpPageCreateResult.success);
    bridge.rebuildPageContainer.mockResolvedValueOnce(false);

    const handle = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(handle.render(page)).resolves.toBeUndefined();
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(2);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "page_rebuild",
        result: "false",
      }),
      expect.objectContaining({
        operation: "startup_recreate",
        result: "success",
      }),
    ]));
    handle.dispose();
  });

  test("preserves rebuild failure when recreating the native page also fails", async () => {
    const { bridge } = makeBridge();
    bridge.createStartUpPageContainer
      .mockResolvedValueOnce(StartUpPageCreateResult.success)
      .mockResolvedValueOnce(StartUpPageCreateResult.invalid);
    bridge.rebuildPageContainer.mockResolvedValueOnce(false);

    const handle = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
    });

    await expect(handle.render(page)).rejects.toThrow(REBUILD_PAGE_FAILED_CODE);
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(2);
    handle.dispose();
  });

  test("replaces the previous listener and delivers each audio chunk once", async () => {
    const { bridge, listeners, unsubscribe } = makeBridge();
    bridge.createStartUpPageContainer
      .mockResolvedValueOnce(StartUpPageCreateResult.success)
      .mockResolvedValueOnce(StartUpPageCreateResult.invalid);
    const firstAudio = vi.fn();
    const latestAudio = vi.fn();
    const first = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
      onAudio: firstAudio,
    });
    const latest = await connectResolvedGlassBridge(bridge as any, {
      initialPage: page,
      onEvent: vi.fn(),
      onAudio: latestAudio,
    });

    expect(listeners.size).toBe(1);
    for (const listener of listeners) {
      listener({
        audioEvent: {
          audioPcm: new Uint8Array([1, 2, 3]),
          source: "glasses",
        },
      });
    }

    expect(firstAudio).not.toHaveBeenCalled();
    expect(latestAudio).toHaveBeenCalledTimes(1);

    first.dispose();
    expect(listeners.size).toBe(1);

    latest.dispose();
    latest.dispose();
    expect(listeners.size).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
