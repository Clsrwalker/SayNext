import { describe, expect, test } from "vitest";
import { buildMenuItems, startLiveGlasses } from "./glasses-state";
import { TEST_CUES, TEST_PRENOTES } from "./test-fixtures";
import { decideGlassEvent } from "./glasses-event-controller";

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
});
