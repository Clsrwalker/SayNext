export const EVENHUB_V2_WS_PATH = "/api/evenhub/v2/ws";
export const EVENHUB_V2_PROTOCOL_VERSION = "evenhub-v2.1";

export type ConversationStatus = "idle" | "active" | "ending" | "ended";
export type AudioStatus = "stopped" | "starting" | "listening" | "reconnecting" | "failed";
export type AutoCueJobStatus = "queued" | "running" | "created" | "skipped" | "failed" | "stale";
export type AutoCueCategory = "response" | "concept" | "suggestion" | "person" | "none";

export type EvenHubV2Settings = {
  language: "english" | "chinese" | "auto";
  cueDurationMs: 5000 | 10000 | 15000 | "forever";
  autoPopup: boolean;
  showAiCue: boolean;
  showTranscript: boolean;
};

export type EvenHubV2Envelope<TType extends string = string, TPayload = unknown> = {
  protocolVersion: typeof EVENHUB_V2_PROTOCOL_VERSION;
  messageId: string;
  requestId?: string;
  conversationId?: string;
  clientSeq?: number;
  serverSeq?: number;
  timestamp: string;
  type: TType;
  payload?: TPayload;
};

export type EvenHubV2ClientMessage =
  | EvenHubV2Envelope<"hello", {
      client?: { name?: string; version?: string };
      settings?: Partial<EvenHubV2Settings>;
    }>
  | EvenHubV2Envelope<"conversation_start", {
      settings?: Partial<EvenHubV2Settings>;
      selectedPrenoteIds?: string[];
      selectedPrenoteText?: string;
    }>
  | EvenHubV2Envelope<"audio_start", {
      codec?: "linear16";
      sampleRate?: number;
      channels?: number;
    }>
  | EvenHubV2Envelope<"audio_stop", Record<string, never>>
  | EvenHubV2Envelope<"conversation_end", Record<string, never>>
  | EvenHubV2Envelope<"ack", { messageId: string }>
  | EvenHubV2Envelope<"debug_transcript", { text: string; isFinal?: boolean }>;

export type EvenHubV2CuePayload = {
  cueId: string;
  attemptId: string;
  category: Exclude<AutoCueCategory, "none">;
  title: string;
  g2Title: string;
  output: string;
  sourceTranscriptLineIds: string[];
  createdAt: string;
};

export type EvenHubV2ServerMessage =
  | EvenHubV2Envelope<"ready", {
      conversationStatus: ConversationStatus;
      audioStatus: AudioStatus;
      settings: EvenHubV2Settings;
    }>
  | EvenHubV2Envelope<"conversation_started", {
      conversationId: string;
      conversationStatus: ConversationStatus;
      audioStatus: AudioStatus;
    }>
  | EvenHubV2Envelope<"audio_status", {
      audioStatus: AudioStatus;
      detail?: string;
      audioBytesReceived?: number;
    }>
  | EvenHubV2Envelope<"transcript_partial", {
      text: string;
      offsetMs: number;
    }>
  | EvenHubV2Envelope<"transcript_final", {
      lineId: string;
      index: number;
      text: string;
      receivedAt: string;
      offsetMs: number;
    }>
  | EvenHubV2Envelope<"cue_created", EvenHubV2CuePayload>
  | EvenHubV2Envelope<"conversation_saved", {
      conversationId: string;
      transcriptCount: number;
      cueCount: number;
      endedAt: string;
    }>
  | EvenHubV2Envelope<"status", {
      status: string;
      detail?: string;
    }>
  | EvenHubV2Envelope<"error", {
      code: string;
      message: string;
      recoverable?: boolean;
    }>;

export type ParseEvenHubV2Result =
  | { ok: true; message: EvenHubV2ClientMessage }
  | { ok: false; code: string; message: string };

export function defaultEvenHubV2Settings(): EvenHubV2Settings {
  return {
    language: "english",
    cueDurationMs: 10000,
    autoPopup: true,
    showAiCue: true,
    showTranscript: true,
  };
}

export function normalizeEvenHubV2Settings(
  value: Partial<EvenHubV2Settings> | undefined,
  fallback: EvenHubV2Settings = defaultEvenHubV2Settings(),
): EvenHubV2Settings {
  const next = { ...fallback };
  if (value?.language && ["english", "chinese", "auto"].includes(value.language)) next.language = value.language;
  if (value?.cueDurationMs === 5000 || value?.cueDurationMs === 10000 || value?.cueDurationMs === 15000 || value?.cueDurationMs === "forever") {
    next.cueDurationMs = value.cueDurationMs;
  }
  if (typeof value?.autoPopup === "boolean") next.autoPopup = value.autoPopup;
  if (typeof value?.showAiCue === "boolean") next.showAiCue = value.showAiCue;
  if (typeof value?.showTranscript === "boolean") next.showTranscript = value.showTranscript;
  return next;
}

export function makeEvenHubV2Id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isEnvelope(value: Record<string, unknown>): value is EvenHubV2Envelope {
  return value.protocolVersion === EVENHUB_V2_PROTOCOL_VERSION
    && typeof value.messageId === "string"
    && value.messageId.trim().length > 0
    && typeof value.timestamp === "string"
    && typeof value.type === "string";
}

function parseClientSeq(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

export function parseEvenHubV2ClientMessage(raw: string): ParseEvenHubV2Result {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json", message: "Invalid JSON message." };
  }

  if (!isRecord(parsed) || !isEnvelope(parsed)) {
    return { ok: false, code: "invalid_envelope", message: "Invalid EvenHub v2 message envelope." };
  }

  const payload = isRecord(parsed.payload) ? parsed.payload : {};
  const base = {
    protocolVersion: EVENHUB_V2_PROTOCOL_VERSION as typeof EVENHUB_V2_PROTOCOL_VERSION,
    messageId: parsed.messageId.trim(),
    requestId: typeof parsed.requestId === "string" ? parsed.requestId.trim() : undefined,
    conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId.trim() : undefined,
    clientSeq: parseClientSeq(parsed.clientSeq),
    timestamp: parsed.timestamp,
  };

  if (parsed.type === "hello") {
    return {
      ok: true,
      message: {
        ...base,
        type: "hello",
        payload: {
          client: isRecord(payload.client) ? payload.client as { name?: string; version?: string } : undefined,
          settings: isRecord(payload.settings) ? payload.settings as Partial<EvenHubV2Settings> : undefined,
        },
      },
    };
  }

  if (parsed.type === "conversation_start") {
    return {
      ok: true,
      message: {
        ...base,
        type: "conversation_start",
        payload: {
          settings: isRecord(payload.settings) ? payload.settings as Partial<EvenHubV2Settings> : undefined,
          selectedPrenoteIds: normalizeStringArray(payload.selectedPrenoteIds),
          selectedPrenoteText: typeof payload.selectedPrenoteText === "string" ? payload.selectedPrenoteText : undefined,
        },
      },
    };
  }

  if (parsed.type === "audio_start") {
    const sampleRate = typeof payload.sampleRate === "number" && Number.isFinite(payload.sampleRate)
      ? Math.trunc(payload.sampleRate)
      : undefined;
    const channels = typeof payload.channels === "number" && Number.isFinite(payload.channels)
      ? Math.trunc(payload.channels)
      : undefined;
    return {
      ok: true,
      message: {
        ...base,
        type: "audio_start",
        payload: {
          codec: payload.codec === "linear16" ? "linear16" : undefined,
          sampleRate,
          channels,
        },
      },
    };
  }

  if (parsed.type === "audio_stop" || parsed.type === "conversation_end") {
    return { ok: true, message: { ...base, type: parsed.type, payload: {} } as EvenHubV2ClientMessage };
  }

  if (parsed.type === "ack") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId.trim() : "";
    if (!messageId) return { ok: false, code: "invalid_ack", message: "ack.payload.messageId is required." };
    return { ok: true, message: { ...base, type: "ack", payload: { messageId } } };
  }

  if (parsed.type === "debug_transcript") {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return { ok: false, code: "invalid_transcript", message: "debug_transcript.payload.text is required." };
    return {
      ok: true,
      message: {
        ...base,
        type: "debug_transcript",
        payload: {
          text,
          isFinal: typeof payload.isFinal === "boolean" ? payload.isFinal : true,
        },
      },
    };
  }

  return { ok: false, code: "unknown_type", message: `Unknown EvenHub v2 message type: ${parsed.type}` };
}

export function createEvenHubV2ClientMessage<TType extends EvenHubV2ClientMessage["type"]>(
  type: TType,
  payload: Extract<EvenHubV2ClientMessage, { type: TType }>["payload"],
  options: Partial<Omit<EvenHubV2Envelope, "protocolVersion" | "type" | "payload" | "timestamp">> = {},
): Extract<EvenHubV2ClientMessage, { type: TType }> {
  return {
    protocolVersion: EVENHUB_V2_PROTOCOL_VERSION,
    messageId: options.messageId || makeEvenHubV2Id("client_msg"),
    requestId: options.requestId,
    conversationId: options.conversationId,
    clientSeq: options.clientSeq,
    timestamp: new Date().toISOString(),
    type,
    payload,
  } as Extract<EvenHubV2ClientMessage, { type: TType }>;
}
