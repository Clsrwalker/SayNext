import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import type { GlassGesture } from "./types";

type EventLike = {
  textEvent?: { eventType?: unknown };
  listEvent?: {
    eventType?: unknown;
    currentSelectItemIndex?: unknown;
    currentSelectItemName?: unknown;
  };
  sysEvent?: { eventType?: unknown };
  jsonData?: Record<string, unknown>;
  eventType?: unknown;
  type?: unknown;
};

export type GlassListSelection = {
  index: number | null;
  name: string | null;
};

function rawEventType(event: EventLike): unknown {
  return event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType ?? event.eventType ?? event.type;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeGlassGesture(event: unknown): GlassGesture | null {
  if (!event || typeof event !== "object") return null;
  const raw = rawEventType(event as EventLike);
  if (raw === undefined) return "click";
  if (raw === OsEventTypeList.CLICK_EVENT || raw === 0 || raw === "CLICK_EVENT") return "click";
  if (raw === OsEventTypeList.DOUBLE_CLICK_EVENT || raw === 3 || raw === "DOUBLE_CLICK_EVENT") return "double_click";
  if (raw === OsEventTypeList.SCROLL_TOP_EVENT || raw === 1 || raw === "SCROLL_TOP_EVENT") return "scroll_up";
  if (raw === OsEventTypeList.SCROLL_BOTTOM_EVENT || raw === 2 || raw === "SCROLL_BOTTOM_EVENT") return "scroll_down";
  if (raw === OsEventTypeList.FOREGROUND_ENTER_EVENT || raw === 4 || raw === "FOREGROUND_ENTER_EVENT") return "foreground_enter";
  if (raw === OsEventTypeList.FOREGROUND_EXIT_EVENT || raw === 5 || raw === "FOREGROUND_EXIT_EVENT") return "foreground_exit";
  if (raw === OsEventTypeList.ABNORMAL_EXIT_EVENT || raw === 6 || raw === "ABNORMAL_EXIT_EVENT") return "abnormal_exit";
  return null;
}

export function readGlassListSelection(event: unknown): GlassListSelection {
  if (!event || typeof event !== "object") return { index: null, name: null };
  const typed = event as EventLike;
  return {
    index: readNumber(typed.listEvent?.currentSelectItemIndex ?? typed.jsonData?.currentSelectItemIndex),
    name: readString(typed.listEvent?.currentSelectItemName ?? typed.jsonData?.currentSelectItemName),
  };
}
