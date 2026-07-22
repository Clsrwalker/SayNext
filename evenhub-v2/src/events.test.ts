import { evenHubEventFromJson, OsEventTypeList } from "@evenrealities/even_hub_sdk";
import { describe, expect, test } from "vitest";
import { normalizeGlassGesture } from "./events";

describe("normalizeGlassGesture", () => {
  test("maps official click, double click, and scroll events", () => {
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.CLICK_EVENT } })).toBe("click");
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } })).toBe("double_click");
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } })).toBe("scroll_up");
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } })).toBe("scroll_down");
  });

  test("treats a list selection without eventType as a click", () => {
    expect(normalizeGlassGesture({
      listEvent: {
        currentSelectItemIndex: 0,
        currentSelectItemName: "Start conversation",
      },
    })).toBe("click");
    expect(normalizeGlassGesture({
      jsonData: {
        currentSelectItemIndex: 0,
        currentSelectItemName: "Start conversation",
      },
    })).toBe("click");
  });

  test("treats a sys event with omitted zero-valued eventType as a click", () => {
    const event = evenHubEventFromJson({ type: "sysEvent", jsonData: {} });

    expect(event.sysEvent).toBeDefined();
    expect(event.sysEvent?.eventType).toBeUndefined();
    expect(normalizeGlassGesture(event)).toBe("click");
  });

  test("does not treat empty or unknown host events as clicks", () => {
    expect(normalizeGlassGesture({})).toBeNull();
    expect(normalizeGlassGesture({ jsonData: {} })).toBeNull();
    expect(normalizeGlassGesture({ textEvent: {} })).toBeNull();
    expect(normalizeGlassGesture({ type: "unknown" })).toBeNull();
  });
});
