import { describe, expect, test } from "vitest";
import { commandForGesture, normalizeGlassEvent, summarizeRawEvent } from "./events";

describe("normalizeGlassEvent", () => {
  test("normalizes numeric EvenHub event types", () => {
    expect(normalizeGlassEvent({ sysEvent: { eventType: 0 } })).toBe("tap");
    expect(normalizeGlassEvent({ textEvent: { eventType: 1 } })).toBe("scroll_up");
    expect(normalizeGlassEvent({ textEvent: { eventType: 2 } })).toBe("scroll_down");
    expect(normalizeGlassEvent({ sysEvent: { eventType: 3 } })).toBe("double_tap");
  });

  test("normalizes string and jsonData event types", () => {
    expect(normalizeGlassEvent({ jsonData: { event_type: "SCROLL_TOP_EVENT" } })).toBe("scroll_up");
    expect(normalizeGlassEvent({ type: "DOUBLE_CLICK_EVENT" })).toBe("double_tap");
    expect(normalizeGlassEvent({ gesture: "long_press" })).toBe("hold");
  });

  test("returns unknown for unsupported events", () => {
    expect(normalizeGlassEvent({ sysEvent: { eventType: 99 } })).toBe("unknown");
    expect(normalizeGlassEvent({ type: "foreground_enter" })).toBe("unknown");
  });

  test("treats incomplete captured container events as tap", () => {
    expect(normalizeGlassEvent({ textEvent: { containerName: "saynext-body" } })).toBe("tap");
    expect(normalizeGlassEvent({ listEvent: { currentSelectItemIndex: 0 } })).toBe("tap");
  });
});

describe("commandForGesture", () => {
  test("maps tap based on recording and transcript state", () => {
    expect(commandForGesture("tap", false, false)).toBe("start_listening");
    expect(commandForGesture("tap", true, false)).toBe("generate");
    expect(commandForGesture("tap", true, true)).toBe("stop_listening");
  });

  test("maps direct control gestures", () => {
    expect(commandForGesture("double_tap", true, false)).toBe("regenerate");
    expect(commandForGesture("scroll_down", true, false)).toBe("page_next");
    expect(commandForGesture("scroll_up", true, false)).toBe("page_previous");
    expect(commandForGesture("hold", true, false)).toBe("clear");
    expect(commandForGesture("unknown", true, false)).toBeNull();
  });
});

describe("summarizeRawEvent", () => {
  test("summarizes event kind, source, and normalized gesture", () => {
    expect(summarizeRawEvent({
      sysEvent: { eventType: 3, eventSource: 2 },
      jsonData: { source: "ring" },
    })).toContain("kind=sys type=3 gesture=double_tap source=2");
  });
});
