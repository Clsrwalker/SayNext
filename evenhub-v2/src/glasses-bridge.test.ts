import { describe, expect, test } from "vitest";
import { getRebuildPageContainer, readAudioChunk, REBUILD_UNAVAILABLE_CODE } from "./glasses-bridge";

describe("glasses bridge rebuild support", () => {
  test("returns rebuild function when the host exposes it", () => {
    const rebuildPageContainer = async () => undefined;
    expect(getRebuildPageContainer({ rebuildPageContainer })).toBe(rebuildPageContainer);
  });

  test("throws a clear error when rebuilding is unavailable after startup", () => {
    expect(() => getRebuildPageContainer({})).toThrow(REBUILD_UNAVAILABLE_CODE);
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
