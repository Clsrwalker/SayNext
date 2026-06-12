import { describe, expect, test } from "vitest";
import { applyGlassGesture, buildMenuItems, INITIAL_GLASS_STATE, makeAutoCueVisibility, MAX_G2_LIST_ITEMS, startLiveGlasses } from "./glasses-state";
import { TEST_CUES, TEST_PRENOTES } from "./test-fixtures";
import type { AiCue } from "./types";

function manyCues(count: number): AiCue[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cue-${index}`,
    category: index % 2 === 0 ? "response" : "concept",
    title: `Cue ${index} with a title that may be long`,
    output: `Output ${index}`,
    createdAt: "2026-06-05T13:00:00-03:00",
    source: "auto",
  }));
}

describe("buildMenuItems", () => {
  test("keeps prenote first and caps list at official 20-item limit", () => {
    const items = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: manyCues(30) });
    expect(items).toHaveLength(MAX_G2_LIST_ITEMS);
    expect(items[0]).toMatchObject({ type: "prenote", label: "▤ Prenote" });
    expect(items.filter((item) => item.type === "cue")).toHaveLength(19);
  });

  test("uses all 20 slots for cues when no prenote is selected", () => {
    const items = buildMenuItems({ prenote: null, cues: manyCues(30) });
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ type: "cue", cueId: "cue-0" });
  });

  test("truncates each G2 list item to 64 characters", () => {
    const items = buildMenuItems({ prenote: null, cues: manyCues(1) });
    expect(items[0].label.length).toBeLessThanOrEqual(64);
  });
});

describe("applyGlassGesture", () => {
  test("initial state is idle until the phone starts a conversation", () => {
    expect(INITIAL_GLASS_STATE.view).toBe("root_idle");
    expect(INITIAL_GLASS_STATE.latestCueId).toBeNull();
  });

  test("foreground enter does not switch idle glasses into listening mode", () => {
    const menuItems = buildMenuItems({ prenote: null, cues: [] });
    expect(applyGlassGesture(INITIAL_GLASS_STATE, "foreground_enter", menuItems).state.view).toBe("root_idle");
  });

  test("main click opens menu and double click is idle while manual generation is disabled", () => {
    const state = startLiveGlasses(TEST_CUES[0].id);
    const menuItems = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES });

    expect(applyGlassGesture(state, "click", menuItems).state.view).toBe("menu");
    expect(applyGlassGesture(state, "double_click", menuItems).effect).toBe("none");
  });

  test("menu scroll direction follows official top/bottom events", () => {
    const menuItems = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES });
    const menu = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };

    const down = applyGlassGesture(menu, "scroll_down", menuItems).state;
    expect(down.selectedIndex).toBe(1);
    const up = applyGlassGesture(down, "scroll_up", menuItems).state;
    expect(up.selectedIndex).toBe(0);
  });

  test("menu click opens prenote or cue detail, and double click backs out", () => {
    const menuItems = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES });
    const menu = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };

    const prenote = applyGlassGesture(menu, "click", menuItems).state;
    expect(prenote.view).toBe("prenote_detail");
    expect(applyGlassGesture(prenote, "double_click", menuItems).state.view).toBe("menu");

    const cueMenu = { ...menu, selectedIndex: 1 };
    const cue = applyGlassGesture(cueMenu, "click", menuItems).state;
    expect(cue.view).toBe("cue_detail");
    expect(cue.activeCueId).toBe(TEST_CUES[0].id);
    expect(applyGlassGesture(cue, "double_click", menuItems).state.view).toBe("menu");
  });

  test("exit confirmation uses double click to confirm and click to return", () => {
    const menuItems = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES });
    const root = { ...startLiveGlasses(TEST_CUES[0].id), view: "root_idle" as const };
    const exit = applyGlassGesture(root, "double_click", menuItems).state;
    expect(exit.view).toBe("exit_confirm");
    expect(applyGlassGesture(exit, "click", menuItems).state.view).toBe("main");
    const confirmed = applyGlassGesture(exit, "double_click", menuItems);
    expect(confirmed.state.view).toBe("root_idle");
    expect(confirmed.effect).toBe("exit_confirm");
  });
});

describe("makeAutoCueVisibility", () => {
  test("uses exact duration for timed cues and null for forever", () => {
    expect(makeAutoCueVisibility(10000, 1000)).toBe(11000);
    expect(makeAutoCueVisibility("forever", 1000)).toBeNull();
  });
});
