import type { SayNextSettings, ServerMessage } from "./protocol";

export type DisplayState = {
  status: string;
  recording: boolean;
  transcript: string;
  answerText: string;
  answerOutput: string;
  pageIndex: number;
  totalPages: number;
  error: string;
  audioBytesReceived: number;
};

export const INITIAL_DISPLAY_STATE: DisplayState = {
  status: "Disconnected",
  recording: false,
  transcript: "",
  answerText: "",
  answerOutput: "",
  pageIndex: 0,
  totalPages: 0,
  error: "",
  audioBytesReceived: 0,
};

const TRANSCRIPT_TAIL_CHARS = 420;
const BODY_MAX_CHARS = 520;

function tail(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `...${compact.slice(-maxChars)}`;
}

function trimBody(text: string): string {
  const compact = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (compact.length <= BODY_MAX_CHARS) return compact;
  return `${compact.slice(0, BODY_MAX_CHARS - 3).trim()}...`;
}

export function reduceServerMessage(state: DisplayState, message: ServerMessage): DisplayState {
  if (message.type === "status") {
    return {
      ...state,
      status: message.message || message.status,
      recording: message.status === "listening" ? true : message.status === "cleared" ? false : state.recording,
      audioBytesReceived: message.audioBytesReceived ?? state.audioBytesReceived,
      error: "",
    };
  }

  if (message.type === "transcript_partial" || message.type === "transcript_final") {
    return {
      ...state,
      transcript: message.text,
      status: message.type === "transcript_final" ? "Transcript ready" : "Listening",
      error: "",
    };
  }

  if (message.type === "answer_page") {
    return {
      ...state,
      answerText: message.text,
      answerOutput: message.output || message.text,
      pageIndex: message.pageIndex,
      totalPages: message.totalPages,
      status: "Answer",
      error: "",
    };
  }

  if (message.type === "answer_done") {
    return {
      ...state,
      status: message.status === "ok" ? "Ready" : message.status.replace(/_/g, " "),
    };
  }

  return {
    ...state,
    status: "Error",
    error: message.message,
  };
}

export function formatGlassesText(state: DisplayState, settings: SayNextSettings): string {
  const scene = settings.sceneMode.toUpperCase();
  const page = state.totalPages > 1 ? ` ${state.pageIndex + 1}/${state.totalPages}` : "";
  const normalizedStatus = state.status.toLowerCase().replace(/\s+/g, "_");
  const attentionStatus = ["generating", "regenerating", "busy", "no_new_speech", "no_current_answer", "error"].includes(normalizedStatus)
    ? normalizedStatus.replace(/_/g, " ").toUpperCase()
    : "";
  const status = attentionStatus || (state.answerText && !state.recording
    ? "ANSWER"
    : state.recording && state.answerText
      ? "ANSWER+LISTEN"
      : state.recording
        ? "LISTENING"
        : state.status.toUpperCase());
  const header = `${scene} | ${status}${page}`;

  if (state.error && !state.answerText) {
    return `${header}\n\n${trimBody(state.error)}\n\nTap: retry  Hold: clear`;
  }

  if (settings.displayMode === "transcript") {
    return `${header}\n\n${tail(state.transcript, TRANSCRIPT_TAIL_CHARS) || "No transcript yet."}\n\nTap: answer  Scroll: page`;
  }

  if (settings.displayMode === "split" && state.transcript && state.answerText) {
    return `${header}\n\n${trimBody(state.answerText)}\n\nHeard: ${tail(state.transcript, 160)}`;
  }

  if (state.answerText) {
    const notice = attentionStatus === "NO NEW SPEECH"
      ? "\n\nNo new speech committed yet."
      : attentionStatus === "BUSY"
        ? "\n\nStill generating. Wait a moment."
        : "";
    return `${header}\n\n${trimBody(state.answerText)}${notice}\n\nTap/R1: next answer  Double: retry  Scroll: page`;
  }

  if (state.transcript) {
    return `${header}\n\n${tail(state.transcript, TRANSCRIPT_TAIL_CHARS)}\n\nTap: answer`;
  }

  if (state.recording) {
    return `${header}\n\nListening...\n\nTap/R1 generates from new speech.`;
  }

  return `${header}\n\nConnect G2 to listen.\nTap/R1 generates from new speech.\nScroll changes pages.`;
}
