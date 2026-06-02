export type SceneMode = "auto" | "classroom" | "interview" | "discussion" | "daily" | "teleprompt";
export type AnswerDepth = "short" | "normal" | "deep";
export type DisplayMode = "answer" | "transcript" | "split" | "teleprompt";

export type SayNextSettings = {
  sceneMode: SceneMode;
  depth: AnswerDepth;
  displayMode: DisplayMode;
  manualFirst: boolean;
};

export type ClientMessage =
  | {
      type: "hello";
      userId?: string;
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
  manualFirst: true,
};

export function defaultWsUrl(): string {
  const configured = import.meta.env.VITE_SAYNEXT_WS_URL;
  if (typeof configured === "string" && configured.trim()) return configured.trim();

  if (location.protocol === "https:") return `wss://${location.host}/api/evenhub/ws`;
  if (location.protocol === "http:") return `ws://${location.host}/api/evenhub/ws`;
  return "wss://saynext.167.172.153.109.sslip.io/api/evenhub/ws";
}
