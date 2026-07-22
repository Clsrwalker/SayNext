import { describe, expect, test } from "vitest";
import { cueCodeText, cueExplanationText, cueFullText } from "./cue-display";
import type { AiCue } from "./types";

function makeCue(overrides: Partial<AiCue> = {}): AiCue {
  return {
    id: "cue-1",
    category: "response",
    title: "Answer",
    preview: "Short preview.",
    fullAnswer: "This is the complete answer with the useful detail.",
    output: "This is the complete answer with the useful detail.",
    createdAt: "2026-07-22T12:00:00.000Z",
    source: "auto",
    ...overrides,
  };
}

describe("cue display content", () => {
  test("uses the complete answer instead of preview", () => {
    expect(cueFullText(makeCue())).toBe("This is the complete answer with the useful detail.");
  });

  test("combines the method explanation and complete code", () => {
    const cue = makeCue({
      category: "code",
      explanation: "I use a map so each lookup is constant time on average.",
      fullAnswer: "I use a map so each lookup is constant time on average.",
      code: "function twoSum(nums: number[]) {\r\n  return nums;\r\n}",
      output: "function twoSum(nums: number[]) {\r\n  return nums;\r\n}",
    });

    expect(cueExplanationText(cue)).toContain("I use a map");
    expect(cueCodeText(cue)).toBe("function twoSum(nums: number[]) {\n  return nums;\n}");
    expect(cueFullText(cue)).toBe(
      "I use a map so each lookup is constant time on average.\n\nfunction twoSum(nums: number[]) {\n  return nums;\n}",
    );
  });

  test("uses legacy preview only when no complete answer exists", () => {
    expect(cueFullText(makeCue({ fullAnswer: "", output: "", preview: "Legacy answer." }))).toBe("Legacy answer.");
  });
});
