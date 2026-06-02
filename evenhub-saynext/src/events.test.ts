import { describe, expect, test } from "vitest";
import { commandForGesture, normalizeGlassEvent, redactEventPayload, summarizeRawEvent } from "./events";

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
  test("maps tap to manual generate regardless of recording state", () => {
    expect(commandForGesture("tap", false, false)).toBe("generate");
    expect(commandForGesture("tap", true, false)).toBe("generate");
    expect(commandForGesture("tap", true, true)).toBe("generate");
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

describe("redactEventPayload", () => {
  test("redacts tokens and binary audio payloads", () => {
    expect(redactEventPayload({
      token: "secret",
      audioEvent: { audioPcm: [1, 2, 3] },
      sysEvent: { eventType: 1 },
    })).toEqual({
      token: "<redacted>",
      audioEvent: { audioPcm: "<binary>" },
      sysEvent: { eventType: 1 },
    });
  });
});
