import type { GlassListSelection } from "./events";
import { applyGlassGesture } from "./glasses-state";
import type { GlassEffect, GlassGesture, GlassRuntimeState } from "./types";

export type GlassMenuItem = {
  id: string;
  type: "prenote" | "cue";
  label: string;
  cueId?: string;
};

export type GlassEventDecision = {
  state: GlassRuntimeState;
  effect: GlassEffect;
  shouldRender: boolean;
};

export const DETAIL_BACK_DOUBLE_CLICK_SUPPRESS_MS = 450;

export function shouldSuppressDuplicateMenuDoubleClick(params: {
  state: GlassRuntimeState;
  gesture: GlassGesture;
  nowMs: number;
  suppressUntilMs: number;
}): boolean {
  return params.state.view === "menu"
    && params.gesture === "double_click"
    && params.nowMs < params.suppressUntilMs;
}

export function resolveSelectedMenuIndex(menuItems: GlassMenuItem[], selection: GlassListSelection): number | null {
  const byName = selection.name
    ? menuItems.findIndex((item) => item.label === selection.name)
    : -1;

  if (selection.index !== null) {
    const index = Math.trunc(selection.index);
    if (index >= 0 && index < menuItems.length) {
      return index;
    }
  }
  if (byName >= 0) return byName;
  return null;
}

export function decideGlassEvent(params: {
  state: GlassRuntimeState;
  gesture: GlassGesture;
  selection: GlassListSelection;
  menuItems: GlassMenuItem[];
}): GlassEventDecision {
  const selectedIndex = params.state.view === "menu"
    ? resolveSelectedMenuIndex(params.menuItems, params.selection)
    : null;

  const stateWithOfficialSelection = params.state.view === "menu" && selectedIndex !== null
    ? { ...params.state, selectedIndex }
    : params.state;

  if (params.state.view === "menu" && (params.gesture === "scroll_up" || params.gesture === "scroll_down")) {
    return {
      state: stateWithOfficialSelection,
      effect: "none",
      shouldRender: false,
    };
  }

  const transition = applyGlassGesture(stateWithOfficialSelection, params.gesture, params.menuItems);
  return {
    state: transition.state,
    effect: transition.effect,
    shouldRender: true,
  };
}
