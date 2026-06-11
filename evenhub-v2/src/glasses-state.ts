import { formatG2CueTitle } from "./cue-icons";
import type {
  AiCue,
  CueDuration,
  GlassGesture,
  GlassRuntimeState,
  GlassTransition,
  Prenote,
} from "./types";

export const MAX_G2_LIST_ITEMS = 20;

export const INITIAL_GLASS_STATE: GlassRuntimeState = {
  view: "root_idle",
  selectedIndex: 0,
  activeCueId: null,
  latestCueId: null,
  autoCueVisibleUntil: null,
};

export function startLiveGlasses(latestCueId: string | null = null): GlassRuntimeState {
  return {
    ...INITIAL_GLASS_STATE,
    view: "main",
    latestCueId,
    activeCueId: latestCueId,
  };
}

export function makeAutoCueVisibility(duration: CueDuration, nowMs: number): number | null {
  if (duration === "forever") return null;
  return nowMs + duration;
}

export function shouldShowAutoCue(state: GlassRuntimeState, nowMs: number): boolean {
  if (!state.latestCueId) return false;
  if (state.autoCueVisibleUntil === null) return true;
  return nowMs < state.autoCueVisibleUntil;
}

export function buildMenuItems(params: {
  prenote: Prenote | null;
  cues: AiCue[];
}): Array<{ id: string; type: "prenote" | "cue"; label: string; cueId?: string }> {
  const items: Array<{ id: string; type: "prenote" | "cue"; label: string; cueId?: string }> = [];
  if (params.prenote?.text.trim()) {
    items.push({
      id: params.prenote.id,
      type: "prenote",
      label: "▤ Prenote",
    });
  }

  const cueLimit = MAX_G2_LIST_ITEMS - items.length;
  for (const cue of params.cues.slice(0, Math.max(0, cueLimit))) {
    items.push({
      id: cue.id,
      type: "cue",
      cueId: cue.id,
      label: truncateListItem(formatG2CueTitle(cue.category, cue.title)),
    });
  }
  return items;
}

export function truncateListItem(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 64) return compact;
  return `${compact.slice(0, 61).trimEnd()}...`;
}

export function applyGlassGesture(
  state: GlassRuntimeState,
  gesture: GlassGesture,
  menuItems: Array<{ id: string; type: "prenote" | "cue"; cueId?: string }>,
): GlassTransition {
  if (gesture === "foreground_exit" || gesture === "abnormal_exit") {
    return { state: { ...state, view: "root_idle" }, effect: "none" };
  }

  if (state.view === "root_idle") {
    if (gesture === "double_click") {
      return { state: { ...state, view: "exit_confirm" }, effect: "exit_confirm" };
    }
    if (gesture === "click" || gesture === "foreground_enter") {
      return { state: { ...state, view: "main" }, effect: "none" };
    }
    return { state, effect: "none" };
  }

  if (state.view === "main") {
    if (gesture === "click") {
      return {
        state: {
          ...state,
          view: "menu",
          selectedIndex: 0,
        },
        effect: "none",
      };
    }
    if (gesture === "double_click") {
      return { state, effect: "manual_generate" };
    }
    return { state, effect: "none" };
  }

  if (state.view === "menu") {
    if (gesture === "double_click") {
      return { state: { ...state, view: "main" }, effect: "none" };
    }
    if (gesture === "scroll_down") {
      if (!menuItems.length) return { state: { ...state, selectedIndex: 0 }, effect: "none" };
      return {
        state: {
          ...state,
          selectedIndex: Math.min(menuItems.length - 1, state.selectedIndex + 1),
        },
        effect: "none",
      };
    }
    if (gesture === "scroll_up") {
      if (!menuItems.length) return { state: { ...state, selectedIndex: 0 }, effect: "none" };
      return {
        state: {
          ...state,
          selectedIndex: Math.max(0, state.selectedIndex - 1),
        },
        effect: "none",
      };
    }
    if (gesture === "click") {
      const selected = menuItems[state.selectedIndex];
      if (!selected) return { state, effect: "none" };
      if (selected.type === "prenote") {
        return { state: { ...state, view: "prenote_detail" }, effect: "none" };
      }
      return {
        state: {
          ...state,
          view: "cue_detail",
          activeCueId: selected.cueId || state.activeCueId,
        },
        effect: "none",
      };
    }
    return { state, effect: "none" };
  }

  if (state.view === "cue_detail" || state.view === "prenote_detail") {
    if (gesture === "double_click") {
      return { state: { ...state, view: "menu" }, effect: "none" };
    }
    return { state, effect: "none" };
  }

  if (state.view === "exit_confirm") {
    if (gesture === "click") {
      return { state: { ...state, view: "main" }, effect: "none" };
    }
    if (gesture === "double_click") {
      return { state: { ...state, view: "root_idle" }, effect: "exit_confirm" };
    }
  }

  return { state, effect: "none" };
}
