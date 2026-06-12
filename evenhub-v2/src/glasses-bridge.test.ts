import { describe, expect, test } from "vitest";
import { getRebuildPageContainer, REBUILD_UNAVAILABLE_CODE } from "./glasses-bridge";

describe("glasses bridge rebuild support", () => {
  test("returns rebuild function when the host exposes it", () => {
    const rebuildPageContainer = async () => undefined;
    expect(getRebuildPageContainer({ rebuildPageContainer })).toBe(rebuildPageContainer);
  });

  test("throws a clear error when rebuilding is unavailable after startup", () => {
    expect(() => getRebuildPageContainer({})).toThrow(REBUILD_UNAVAILABLE_CODE);
  });
});
