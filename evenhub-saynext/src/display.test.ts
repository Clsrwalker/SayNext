import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "./protocol";
import { formatGlassesText, INITIAL_DISPLAY_STATE, reduceServerMessage } from "./display";

describe("reduceServerMessage", () => {
  test("stores transcript and answer pages", () => {
    const withTranscript = reduceServerMessage(INITIAL_DISPLAY_STATE, {
      type: "transcript_final",
      text: "What is a database index?",
      sessionId: "s1",
    });
    expect(withTranscript.transcript).toBe("What is a database index?");

    const withAnswer = reduceServerMessage(withTranscript, {
      type: "answer_page",
      text: "An index is a lookup structure that helps the database find matching rows faster.",
      output: "full output",
      pageIndex: 0,
      totalPages: 2,
      sessionId: "s1",
    });
    expect(withAnswer.answerText).toContain("lookup structure");
    expect(withAnswer.totalPages).toBe(2);
  });

  test("tracks audio byte status", () => {
    const next = reduceServerMessage(INITIAL_DISPLAY_STATE, {
      type: "status",
      status: "audio_received",
      sessionId: "s1",
      audioBytesReceived: 3200,
    });
    expect(next.audioBytesReceived).toBe(3200);
  });
});

describe("formatGlassesText", () => {
  test("formats answer-first display with page status", () => {
    const state = {
      ...INITIAL_DISPLAY_STATE,
      status: "Answer",
      answerText: "Use a GSI when the query access pattern does not match the table primary key.",
      pageIndex: 1,
      totalPages: 3,
    };
    const text = formatGlassesText(state, { ...DEFAULT_SETTINGS, sceneMode: "classroom" });
    expect(text).toContain("CLASSROOM | ANSWER 2/3");
    expect(text).toContain("Use a GSI");
    expect(text).toContain("Scroll: page");
  });

  test("formats transcript mode without an answer", () => {
    const state = {
      ...INITIAL_DISPLAY_STATE,
      transcript: "The professor is explaining optimistic locking and version columns.",
    };
    const text = formatGlassesText(state, { ...DEFAULT_SETTINGS, displayMode: "transcript" });
    expect(text).toContain("optimistic locking");
    expect(text).toContain("Tap: answer");
  });
});
