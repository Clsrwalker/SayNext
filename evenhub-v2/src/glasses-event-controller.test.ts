import { describe, expect, test } from "vitest";
import { buildMenuItems, startLiveGlasses } from "./glasses-state";
import { TEST_CUES, TEST_PRENOTES } from "./test-fixtures";
import { decideGlassEvent, shouldSuppressDuplicateMenuDoubleClick } from "./glasses-event-controller";

describe("decideGlassEvent", () => {
  test("does not request a render on menu scroll, so the official ListContainer keeps its internal scroll state", () => {
    const menuItems = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES });
    const menuState = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };

    const decision = decideGlassEvent({
      state: menuState,
      gesture: "scroll_down",
      selection: { index: 3, name: null },
      menuItems,
    });

    expect(decision.shouldRender).toBe(false);
    expect(decision.effect).toBe("none");
    expect(decision.state.view).toBe("menu");
    expect(decision.state.selectedIndex).toBe(3);
  });

  test("uses the official list selection when opening a cue detail", () => {
    const menuItems = buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES });
    const menuState = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };

    const decision = decideGlassEvent({
      state: menuState,
      gesture: "click",
      selection: { index: 3, name: menuItems[3].label },
      menuItems,
    });

    expect(decision.shouldRender).toBe(true);
    expect(decision.state.view).toBe("cue_detail");
    expect(decision.state.activeCueId).toBe(TEST_CUES[2].id);
  });

  test("prefers a valid list index when the SDK name is stale after a new cue is prepended", () => {
    const menuItems = [
      { id: "cue-new", type: "cue" as const, cueId: "cue-new", label: "? New API answer" },
      { id: "cue-code", type: "cue" as const, cueId: "cue-code", label: "<> TaskManager code" },
      { id: "cue-old", type: "cue" as const, cueId: "cue-old", label: "? Previous answer" },
    ];
    const menuState = {
      ...startLiveGlasses("cue-code"),
      view: "menu" as const,
      selectedIndex: 1,
    };

    const decision = decideGlassEvent({
      state: menuState,
      gesture: "click",
      selection: {
        index: 0,
        name: "<> TaskManager code",
      },
      menuItems,
    });

    expect(decision.state.view).toBe("cue_detail");
    expect(decision.state.activeCueId).toBe("cue-new");
  });

  test("uses a valid index even when the SDK name points at another cue", () => {
    const menuItems = [
      { id: "cue-code", type: "cue" as const, cueId: "cue-code", label: "<> TaskManager code" },
      { id: "cue-answer", type: "cue" as const, cueId: "cue-answer", label: "? Explain TaskManager" },
    ];
    const menuState = {
      ...startLiveGlasses("cue-code"),
      view: "menu" as const,
      selectedIndex: 0,
    };

    const decision = decideGlassEvent({
      state: menuState,
      gesture: "click",
      selection: {
        index: 1,
        name: "<> TaskManager code",
      },
      menuItems,
    });

    expect(decision.state.activeCueId).toBe("cue-answer");
  });

  test("suppresses the duplicate menu double click immediately after backing out of detail", () => {
    const menuState = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 1 };

    expect(shouldSuppressDuplicateMenuDoubleClick({
      state: menuState,
      gesture: "double_click",
      nowMs: 1200,
      suppressUntilMs: 1500,
    })).toBe(true);

    expect(shouldSuppressDuplicateMenuDoubleClick({
      state: menuState,
      gesture: "double_click",
      nowMs: 1600,
      suppressUntilMs: 1500,
    })).toBe(false);

    expect(shouldSuppressDuplicateMenuDoubleClick({
      state: menuState,
      gesture: "click",
      nowMs: 1200,
      suppressUntilMs: 1500,
    })).toBe(false);
  });
});
