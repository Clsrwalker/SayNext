export type SceneMode = "auto" | "classroom" | "interview" | "discussion" | "daily";
export type AnswerDepth = "short" | "normal" | "deep";
export type DisplayMode = "answer" | "transcript" | "split";
export type MicSource = "g2" | "phone";
export type OutputLanguage = "english" | "chinese";

export type SayNextSettings = {
  sceneMode: SceneMode;
  depth: AnswerDepth;
  displayMode: DisplayMode;
  micSource: MicSource;
  outputLanguage: OutputLanguage;
  manualFirst: boolean;
};

export type ClientMessage =
  | {
      type: "hello";
      userId?: string;
      sessionId?: string;
      token?: string;
      settings: SayNextSettings;
      client: {
        name: "evenhub-saynext";
        version: string;
      };
    }
  | {
      type: "settings";
      settings: Partial<SayNextSettings>;
    }
  | {
      type: "client_event_log";
      summary: string;
      payload?: unknown;
      clientEventId?: string;
    }
  | {
      type: "debug_transcript";
      text: string;
      isFinal?: boolean;
      autoGenerate?: boolean;
      clientEventId?: string;
    }
  | {
      type: "control";
      action: "generate" | "regenerate" | "page_next" | "page_previous" | "clear" | "start_listening" | "stop_listening";
      clientEventId?: string;
    };

export type ServerMessage =
  | {
      type: "status";
      status: string;
      sessionId: string;
      clientSessionId?: string;
      message?: string;
      settings?: SayNextSettings;
      audioBytesReceived?: number;
    }
  | {
      type: "transcript_partial" | "transcript_final";
      text: string;
      sessionId: string;
    }
  | {
      type: "answer_page";
      text: string;
      output?: string;
      pageIndex: number;
      totalPages: number;
      sessionId: string;
    }
  | {
      type: "answer_done";
      status: string;
      sessionId: string;
      stateVersion?: number;
    }
  | {
      type: "error";
      sessionId: string;
      code: string;
      message: string;
    };

export const DEFAULT_SETTINGS: SayNextSettings = {
  sceneMode: "auto",
  depth: "normal",
  displayMode: "answer",
  micSource: "g2",
  outputLanguage: "english",
  manualFirst: true,
};

export const APP_VERSION = "0.1.11";
export const REMOTE_SAYNEXT_WS_URL = "wss://saynext.167.172.153.109.sslip.io/api/evenhub/ws";

type LocationLike = Pick<Location, "protocol" | "hostname" | "host" | "port">;

export function defaultWsUrlForLocation(currentLocation: LocationLike | undefined): string {
  if (!currentLocation) return REMOTE_SAYNEXT_WS_URL;

  const { protocol, hostname, host, port } = currentLocation;
  if (protocol !== "https:" && protocol !== "http:") return REMOTE_SAYNEXT_WS_URL;

  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  const isKnownSayNextHost = hostname === "saynext.167.172.153.109.sslip.io";
  const isLocalBackend = port === "3000";

  if (isKnownSayNextHost || isLocalBackend) {
    return `${wsProtocol}://${host}/api/evenhub/ws`;
  }

  return REMOTE_SAYNEXT_WS_URL;
}

export function normalizeSavedWsUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return defaultWsUrl();
  const trimmed = value.trim();

  try {
    const parsed = new URL(trimmed);
    const isOldViteProxy = parsed.port === "5173" && parsed.pathname === "/api/evenhub/ws";
    if (isOldViteProxy) return REMOTE_SAYNEXT_WS_URL;
  } catch {
    return defaultWsUrl();
  }

  return trimmed;
}

export function defaultWsUrl(): string {
  const configured = import.meta.env.VITE_SAYNEXT_WS_URL;
  if (typeof configured === "string" && configured.trim()) return configured.trim();

  return defaultWsUrlForLocation(globalThis.location);
}

export function defaultRelayToken(): string {
  const configured = import.meta.env.VITE_SAYNEXT_RELAY_TOKEN;
  return typeof configured === "string" ? configured.trim() : "";
}

export function makeClientSessionId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `evenhub-${random}`;
}

export function normalizeSettings(value: Partial<SayNextSettings> | undefined): SayNextSettings {
  const next = { ...DEFAULT_SETTINGS };
  if (value?.sceneMode && ["auto", "classroom", "interview", "discussion", "daily"].includes(value.sceneMode)) {
    next.sceneMode = value.sceneMode;
  }
  if (value?.depth && ["short", "normal", "deep"].includes(value.depth)) {
    next.depth = value.depth;
  }
  if (value?.displayMode && ["answer", "transcript", "split"].includes(value.displayMode)) {
    next.displayMode = value.displayMode;
  }
  if (value?.micSource && ["g2", "phone"].includes(value.micSource)) {
    next.micSource = value.micSource;
  }
  if (value?.outputLanguage && ["english", "chinese"].includes(value.outputLanguage)) {
    next.outputLanguage = value.outputLanguage;
  }
  if (typeof value?.manualFirst === "boolean") {
    next.manualFirst = value.manualFirst;
  }
  return next;
}
