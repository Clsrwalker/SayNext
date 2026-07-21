import { expect, test } from "bun:test";
import { isLikelyCueReadback, sameSpokenText } from "../evenhub-v2/cue-turn";

test("sameSpokenText ignores casing and terminal punctuation but not missing words", () => {
  expect(sameSpokenText(
    "Could you tell me a little bit about yourself",
    "Could you tell me a little bit about yourself?",
  )).toBe(true);
  expect(sameSpokenText(
    "Could you tell me a little bit about",
    "Could you tell me a little bit about yourself?",
  )).toBe(false);
});

test("isLikelyCueReadback recognizes an ASR variation of the active answer", () => {
  expect(isLikelyCueReadback(
    "I am a max student focused on full stack AI and cloud applications",
    "I am a MACS student focused on full-stack AI and cloud applications.",
  )).toBe(true);
});

test("isLikelyCueReadback does not suppress a distinct follow-up question", () => {
  expect(isLikelyCueReadback(
    "Can you explain what part of that project was the hardest?",
    "I am a MACS student focused on full-stack AI and cloud applications.",
  )).toBe(false);
});
