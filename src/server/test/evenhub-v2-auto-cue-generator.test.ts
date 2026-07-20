import { expect, test } from "bun:test";
import { normalizeAutoCueOutput, shouldDisplayAutoCue } from "../evenhub-v2/auto-cue-generator";

test("normalizeAutoCueOutput converts none into a displayable response fallback", () => {
  expect(normalizeAutoCueOutput({
    category: "none",
    confidence: 0.1,
    title: "",
    g2Title: "",
    output: "I would probably start by clarifying the requirement.",
    reason: "",
  })).toMatchObject({
    category: "response",
    title: "SayNext",
    g2Title: "SayNext",
  });
});

test("shouldDisplayAutoCue does not suppress a complete cue by confidence", () => {
  expect(shouldDisplayAutoCue({
    cue: normalizeAutoCueOutput({
      category: "response",
      confidence: 0.05,
      title: "Answer",
      g2Title: "Answer",
      output: "I would first clarify the expected scale and latency requirement.",
      reason: "",
    }),
    previousOutputHash: null,
    outputHash: "new-output",
    conversationActive: true,
  })).toEqual({ ok: true });
});
