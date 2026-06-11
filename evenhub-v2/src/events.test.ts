import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import { describe, expect, test } from "vitest";
import { normalizeGlassGesture } from "./events";

describe("normalizeGlassGesture", () => {
  test("maps official click, double click, and scroll events", () => {
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.CLICK_EVENT } })).toBe("click");
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } })).toBe("double_click");
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } })).toBe("scroll_up");
    expect(normalizeGlassGesture({ listEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } })).toBe("scroll_down");
  });
});
