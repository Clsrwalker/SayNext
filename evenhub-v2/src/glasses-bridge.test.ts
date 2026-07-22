import { StartUpPageCreateResult } from "@evenrealities/even_hub_sdk";
import { describe, expect, test, vi } from "vitest";
import {
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
