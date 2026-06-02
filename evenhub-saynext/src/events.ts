import { OsEventTypeList } from "@evenrealities/even_hub_sdk";

export type GlassGesture = "tap" | "double_tap" | "scroll_up" | "scroll_down" | "hold" | "unknown";

type EventLike = {
  audioEvent?: unknown;
  textEvent?: { eventType?: unknown; containerName?: unknown };
  sysEvent?: { eventType?: unknown; eventSource?: unknown; systemExitReasonCode?: unknown };
  listEvent?: {
    eventType?: unknown;
    currentSelectItemName?: unknown;
    currentSelectItemIndex?: unknown;
    containerName?: unknown;
  };
  jsonData?: Record<string, unknown>;
  eventType?: unknown;
  type?: unknown;
  gesture?: unknown;
  gestureName?: unknown;
  gesture_name?: unknown;
};

function readRawEventType(event: EventLike): unknown {
  return (
    event.textEvent?.eventType ??
    event.sysEvent?.eventType ??
    event.listEvent?.eventType ??
    event.eventType ??
    event.jsonData?.eventType ??
    event.jsonData?.event_type ??
    event.jsonData?.Event_Type ??
    event.type ??
    event.gesture ??
    event.gestureName ??
    event.gesture_name
  );
}

function readOfficialEventType(raw: unknown): OsEventTypeList | null {
  if (typeof raw === "number") {
    if (raw >= OsEventTypeList.CLICK_EVENT && raw <= OsEventTypeList.IMU_DATA_REPORT) {
      return raw as OsEventTypeList;
    }
    return null;
  }

  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;

  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= OsEventTypeList.CLICK_EVENT && numeric <= OsEventTypeList.IMU_DATA_REPORT) {
    return numeric as OsEventTypeList;
  }

  if (normalized === "CLICK" || normalized === "CLICK_EVENT" || normalized === "TAP") return OsEventTypeList.CLICK_EVENT;
  if (normalized === "DOUBLE_CLICK" || normalized === "DOUBLE_CLICK_EVENT" || normalized === "DOUBLE_TAP") return OsEventTypeList.DOUBLE_CLICK_EVENT;
  if (normalized === "SCROLL_TOP" || normalized === "SCROLL_TOP_EVENT" || normalized === "SCROLL_UP") return OsEventTypeList.SCROLL_TOP_EVENT;
  if (normalized === "SCROLL_BOTTOM" || normalized === "SCROLL_BOTTOM_EVENT" || normalized === "SCROLL_DOWN") return OsEventTypeList.SCROLL_BOTTOM_EVENT;
  return null;
}

export function normalizeGlassEvent(event: unknown): GlassGesture {
  if (!event || typeof event !== "object") return "unknown";
  const eventLike = event as EventLike;
  const raw = readRawEventType(eventLike);
  const officialType = readOfficialEventType(raw);

  if (officialType === OsEventTypeList.CLICK_EVENT) return "tap";
  if (officialType === OsEventTypeList.DOUBLE_CLICK_EVENT) return "double_tap";
  if (officialType === OsEventTypeList.SCROLL_TOP_EVENT) return "scroll_up";
  if (officialType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return "scroll_down";
  if (officialType !== null) return "unknown";

  if (typeof raw !== "string") {
    return "unknown";
  }

  const value = raw.toLowerCase();
  if (value.includes("hold") || value.includes("long")) return "hold";
  return "unknown";
}

export function commandForGesture(
  gesture: GlassGesture,
  _hasTranscript: boolean,
  _isRecording: boolean,
): "generate" | "regenerate" | "page_next" | "page_previous" | "clear" | "start_listening" | "stop_listening" | null {
  if (gesture === "tap") return "generate";
  if (gesture === "double_tap") return "regenerate";
  if (gesture === "scroll_down") return "page_next";
  if (gesture === "scroll_up") return "page_previous";
  if (gesture === "hold") return "clear";
  return null;
}

function compact(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (lower.includes("token") || lower.includes("secret") || lower.includes("apikey") || lower.includes("api_key") || lower.includes("authorization")) {
    return "<redacted>";
  }
  if (lower.includes("audio") || lower.includes("pcm") || lower.includes("buffer")) {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer || Array.isArray(value)) return "<binary>";
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}...`;
  return value;
}

export function redactEventPayload(value: unknown, depth = 0): unknown {
  if (depth > 5) return "<max-depth>";
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "<binary>";
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redactEventPayload(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactEventPayload(redactValue(key, raw), depth + 1);
  }
  return output;
}

export function summarizeRawEvent(event: unknown): string {
  if (!event || typeof event !== "object") return "event: unknown";
  const eventLike = event as EventLike;
  const kind = eventLike.audioEvent
    ? "audio"
    : eventLike.textEvent
      ? "text"
      : eventLike.listEvent
        ? "list"
        : eventLike.sysEvent
          ? "sys"
          : "raw";
  const raw = readRawEventType(eventLike);
  const source = eventLike.sysEvent?.eventSource ?? eventLike.jsonData?.eventSource ?? eventLike.jsonData?.event_source ?? eventLike.jsonData?.source;
  const container = eventLike.textEvent?.containerName ?? eventLike.listEvent?.containerName ?? eventLike.jsonData?.containerName ?? eventLike.jsonData?.container_name;
  const item = eventLike.listEvent?.currentSelectItemName ?? eventLike.listEvent?.currentSelectItemIndex ?? eventLike.jsonData?.currentSelectItemName ?? eventLike.jsonData?.currentSelectItemIndex;
  return [
    `kind=${kind}`,
    `type=${compact(raw)}`,
    `gesture=${normalizeGlassEvent(event)}`,
    `source=${compact(source)}`,
    `container=${compact(container)}`,
    `item=${compact(item)}`,
  ].join(" ");
}
