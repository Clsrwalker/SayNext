import { describe, expect, test } from "vitest";
import { CUE_CATEGORY_ORDER, groupCuesByCategory } from "./cue-groups";
import type { AiCue } from "./types";

function cue(id: string, category: AiCue["category"]): AiCue {
  return {
    id,
    category,
    title: id,
    output: id,
    createdAt: "2026-06-12T10:00:00.000Z",
    source: "auto",
  };
}

describe("cue groups", () => {
  test("keeps the official category order", () => {
    expect(CUE_CATEGORY_ORDER).toEqual(["concept", "response", "suggestion", "person", "code"]);
  });

  test("groups cue history by category", () => {
    const groups = groupCuesByCategory([
      cue("one", "response"),
      cue("two", "concept"),
      cue("three", "response"),
    ]);

    expect(groups.concept.map((item) => item.id)).toEqual(["two"]);
    expect(groups.response.map((item) => item.id)).toEqual(["one", "three"]);
    expect(groups.suggestion).toEqual([]);
    expect(groups.person).toEqual([]);
    expect(groups.code).toEqual([]);
  });
});
