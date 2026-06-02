export const EVENHUB_WS_PATH = "/api/evenhub/ws";

export type EvenHubDisplayMode = "answer" | "transcript" | "split" | "teleprompt";
export type EvenHubDepth = "short" | "normal" | "deep";
export type EvenHubSceneMode = "auto" | "classroom" | "interview" | "discussion" | "daily" | "teleprompt";
export type EvenHubMicSource = "g2" | "phone";

export type EvenHubRuntimeSettings = {
  sceneMode: EvenHubSceneMode;
  depth: EvenHubDepth;
  displayMode: EvenHubDisplayMode;
  micSource: EvenHubMicSource;
  manualFirst: boolean;
};

export type EvenHubClientMessage =
  | {
      type: "hello";
      userId?: string;
      sessionId?: string;
      token?: string;
      settings?: Partial<EvenHubRuntimeSettings>;
      client?: {
        name?: string;
        version?: string;
      };
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
    }
  | {
      type: "settings";
      settings: Partial<EvenHubRuntimeSettings>;
    };

export type EvenHubControlAction = Extract<EvenHubClientMessage, { type: "control" }>["action"];

export type EvenHubServerMessage =
  | {
      type: "status";
      status: string;
      sessionId: string;
      clientSessionId?: string;
      message?: string;
      settings?: EvenHubRuntimeSettings;
      audioBytesReceived?: number;
    }
  | {
      type: "transcript_partial";
      text: string;
      sessionId: string;
    }
  | {
      type: "transcript_final";
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

export function defaultEvenHubSettings(): EvenHubRuntimeSettings {
  return {
    sceneMode: "auto",
    depth: "normal",
    displayMode: "answer",
    micSource: "g2",
    manualFirst: true,
  };
}

export function normalizeEvenHubSettings(
  value: Partial<EvenHubRuntimeSettings> | undefined,
  fallback: EvenHubRuntimeSettings = defaultEvenHubSettings(),
): EvenHubRuntimeSettings {
  const next = { ...fallback };
  if (value?.sceneMode && ["auto", "classroom", "interview", "discussion", "daily", "teleprompt"].includes(value.sceneMode)) {
    next.sceneMode = value.sceneMode;
  }
  if (value?.depth && ["short", "normal", "deep"].includes(value.depth)) {
    next.depth = value.depth;
  }
  if (value?.displayMode && ["answer", "transcript", "split", "teleprompt"].includes(value.displayMode)) {
    next.displayMode = value.displayMode;
  }
  if (value?.micSource && ["g2", "phone"].includes(value.micSource)) {
    next.micSource = value.micSource;
  }
  if (typeof value?.manualFirst === "boolean") {
    next.manualFirst = value.manualFirst;
  }
  return next;
}

export function parseEvenHubClientMessage(raw: string): EvenHubClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  const type = typeof value.type === "string" ? value.type : "";

  if (type === "hello") {
    return {
      type,
      userId: typeof value.userId === "string" ? value.userId : undefined,
      sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
      token: typeof value.token === "string" ? value.token : undefined,
      settings: typeof value.settings === "object" && value.settings !== null
        ? value.settings as Partial<EvenHubRuntimeSettings>
        : undefined,
      client: typeof value.client === "object" && value.client !== null
        ? value.client as { name?: string; version?: string }
        : undefined,
    };
  }

  if (type === "debug_transcript") {
    const text = typeof value.text === "string" ? value.text.trim() : "";
    if (!text) return null;
    return {
      type,
      text,
      isFinal: typeof value.isFinal === "boolean" ? value.isFinal : true,
      autoGenerate: typeof value.autoGenerate === "boolean" ? value.autoGenerate : false,
      clientEventId: typeof value.clientEventId === "string" ? value.clientEventId : undefined,
    };
  }

  if (type === "control") {
    const action = typeof value.action === "string" ? value.action : "";
    if (!["generate", "regenerate", "page_next", "page_previous", "clear", "start_listening", "stop_listening"].includes(action)) {
      return null;
    }
    return {
      type,
      action: action as EvenHubControlAction,
      clientEventId: typeof value.clientEventId === "string" ? value.clientEventId : undefined,
    };
  }

  if (type === "settings") {
    return {
      type,
      settings: typeof value.settings === "object" && value.settings !== null
        ? value.settings as Partial<EvenHubRuntimeSettings>
        : {},
    };
  }

  return null;
}
