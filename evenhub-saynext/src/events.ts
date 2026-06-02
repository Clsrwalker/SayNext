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

export function normalizeGlassEvent(event: unknown): GlassGesture {
  if (!event || typeof event !== "object") return "unknown";
  const eventLike = event as EventLike;
  const raw = readRawEventType(eventLike);

  if (typeof raw === "number") {
    if (raw === 0) return "tap";
    if (raw === 1) return "scroll_up";
    if (raw === 2) return "scroll_down";
    if (raw === 3) return "double_tap";
    return "unknown";
  }

  if (typeof raw !== "string") {
    if (eventLike.textEvent || eventLike.listEvent || eventLike.sysEvent) return "tap";
    return "unknown";
  }

  const value = raw.toLowerCase();
  if (value.includes("double")) return "double_tap";
  if (value.includes("hold") || value.includes("long")) return "hold";
  if (value.includes("scroll_top") || value.includes("scroll-up") || value.includes("up")) return "scroll_up";
  if (value.includes("scroll_bottom") || value.includes("scroll-down") || value.includes("down")) return "scroll_down";
  if (value.includes("click") || value.includes("tap")) return "tap";
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
