import { describe, expect, test } from "vitest";
import { shouldAutoFollowTranscriptScroll } from "./transcript-scroll";

describe("transcript scroll follow", () => {
  test("follows when the transcript is already near the bottom", () => {
    expect(shouldAutoFollowTranscriptScroll({
      scrollHeight: 1000,
      scrollTop: 430,
      clientHeight: 500,
    })).toBe(true);
  });

  test("does not follow after the user scrolls away from the bottom", () => {
    expect(shouldAutoFollowTranscriptScroll({
      scrollHeight: 1000,
      scrollTop: 250,
      clientHeight: 500,
    })).toBe(false);
  });
});
