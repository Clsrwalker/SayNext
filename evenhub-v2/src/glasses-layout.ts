import { buildMenuItems, shouldShowAutoCue } from "./glasses-state";
import type { AiCue, GlassContentFlag, GlassRuntimeState, Prenote, TranscriptLine } from "./types";

export type GlassTextContainerSpec = {
  kind: "text";
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  borderWidth?: number;
  borderColor?: number;
  borderRadius?: number;
  padding?: number;
  eventCapture?: boolean;
};

export type GlassListContainerSpec = {
  kind: "list";
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  items: string[];
  selectedIndex: number;
  borderWidth?: number;
  borderColor?: number;
  borderRadius?: number;
  padding?: number;
  eventCapture?: boolean;
};

export type GlassPageSpec = {
  view: GlassRuntimeState["view"];
  containers: Array<GlassTextContainerSpec | GlassListContainerSpec>;
};

export const G2_WIDTH = 576;
export const G2_HEIGHT = 288;
export const GLASS_TRANSCRIPT_MAX_LINES = 3;
export const GLASS_TRANSCRIPT_LINE_CHARS = 48;
export const GLASS_TRANSCRIPT_ID = 3;
export const GLASS_TRANSCRIPT_NAME = "transcript";

const CUE_ID = 2;
const MENU_ID = 4;
const DETAIL_ID = 5;
const HEADER_RIGHT_ID = 7;
const START_ID = 8;
const IDLE_HELP_ID = 9;

function headerContainers(now: Date): GlassTextContainerSpec[] {
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return [
    {
      kind: "text",
      id: HEADER_RIGHT_ID,
      name: "h-right",
      x: 440,
      y: 0,
      width: 128,
      height: 28,
      content: time,
      padding: 0,
      eventCapture: false,
    },
  ];
}

function cleanText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 3).trimEnd()}...`;
}

export function normalizeGlassCode(value: string): string {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

function wrapSubtitleText(value: string, maxChars: number): string[] {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const lines: string[] = [];
  let current = "";

  function shouldBreakAtBoundary(line: string): boolean {
    if (/[.!?。？！]$/.test(line)) return line.length >= 14;
    if (/[,;:，；：]$/.test(line)) return line.length >= 24;
    return false;
  }

  for (const token of compact.split(" ")) {
    if (token.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < token.length; index += maxChars) {
        lines.push(token.slice(index, index + maxChars));
      }
      continue;
    }

    if (!current) {
      current = token;
      continue;
    }

    const next = `${current} ${token}`;
    if (next.length <= maxChars) {
      current = next;
    } else {
      lines.push(current);
      current = token;
    }

    if (shouldBreakAtBoundary(current)) {
      lines.push(current);
      current = "";
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function buildGlassTranscriptContent(lines: TranscriptLine[]): string {
  const subtitleText = lines
    .map((line) => `${line.partial ? "~" : ""}${line.text}`)
    .join(" ");
  const content = wrapSubtitleText(subtitleText, GLASS_TRANSCRIPT_LINE_CHARS)
    .slice(-GLASS_TRANSCRIPT_MAX_LINES)
    .join("\n");
  return content || "Listening...";
}

function cueContent(cue: AiCue | undefined, detail = false): string {
  if (!cue) return "";
  if (cue.category === "code") return normalizeGlassCode(cue.code || cue.output);
  return cleanText(detail ? cue.fullAnswer || cue.output : cue.preview || cue.output, detail ? 2400 : 360);
}

function cueBox(content: string, eventCapture = true): GlassTextContainerSpec {
  return {
    kind: "text",
    id: CUE_ID,
    name: "ai-cue",
    x: 12,
    y: 34,
    width: 552,
    height: 166,
    content,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    padding: 8,
    eventCapture,
  };
}

function transcriptBox(
  content: string,
  eventCapture = false,
  bounds: { y?: number; height?: number } = {},
): GlassTextContainerSpec {
  return {
    kind: "text",
    id: GLASS_TRANSCRIPT_ID,
    name: GLASS_TRANSCRIPT_NAME,
    x: 12,
    y: bounds.y ?? 204,
    width: 552,
    height: bounds.height ?? 84,
    content,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    padding: 0,
    eventCapture,
  };
}

export function buildGlassesPage(params: {
  state: GlassRuntimeState;
  cues: AiCue[];
  prenote: Prenote | null;
  transcript: TranscriptLine[];
  glassContent?: Partial<Record<GlassContentFlag, boolean>>;
  now?: Date;
}): GlassPageSpec {
  const now = params.now || new Date();
  const showAiCue = params.glassContent?.aiCue ?? true;
  const showTranscript = params.glassContent?.transcript ?? true;
  const latestCue = params.cues.find((cue) => cue.id === params.state.latestCueId) || params.cues[0];
  const activeCue = params.cues.find((cue) => cue.id === params.state.activeCueId) || latestCue;
  const transcript = buildGlassTranscriptContent(params.transcript);
  if (params.state.view === "root_idle") {
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        {
          kind: "text",
          id: CUE_ID,
          name: "idle-title",
          x: 12,
          y: 48,
          width: 552,
          height: 44,
          content: "SayNext ready",
          padding: 0,
          eventCapture: false,
        },
        {
          kind: "list",
          id: START_ID,
          name: "start-conversation",
          x: 64,
          y: 96,
          width: 448,
          height: 76,
          items: ["Start conversation"],
          selectedIndex: 0,
          borderWidth: 0,
          borderColor: 8,
          borderRadius: 6,
          padding: 4,
          eventCapture: true,
        },
        {
          kind: "text",
          id: IDLE_HELP_ID,
          name: "idle-help",
          x: 12,
          y: 204,
          width: 552,
          height: 56,
          content: "Click to start  |  Double click to exit",
          padding: 0,
          eventCapture: false,
        },
      ],
    };
  }

  if (params.state.view === "exit_confirm") {
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        {
          kind: "text",
          id: DETAIL_ID,
          name: "exit",
          x: 32,
          y: 58,
          width: 512,
          height: 176,
          content: "Exit SayNext?\n\nDouble click to confirm.\nClick to return.",
          borderWidth: 1,
          borderColor: 9,
          borderRadius: 8,
          padding: 12,
          eventCapture: true,
        },
      ],
    };
  }

  if (params.state.view === "menu") {
    const items = buildMenuItems({ prenote: params.prenote, cues: params.cues });
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        {
          kind: "list",
          id: MENU_ID,
          name: "cue-list",
          x: 12,
          y: 28,
          width: 552,
          height: 176,
          items: items.length ? items.map((item) => item.label) : ["No cue history yet."],
          selectedIndex: params.state.selectedIndex,
          borderWidth: 0,
          borderColor: 8,
          borderRadius: 6,
          padding: 4,
          eventCapture: true,
        },
        ...(showTranscript ? [transcriptBox(transcript, false, { y: 204, height: 84 })] : []),
      ],
    };
  }

  if (params.state.view === "cue_detail") {
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        cueBox(showAiCue ? cueContent(activeCue, true) || "No cue selected." : "", true),
        ...(showTranscript ? [transcriptBox(transcript, false)] : []),
      ],
    };
  }

  if (params.state.view === "prenote_detail") {
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        {
          kind: "text",
          id: DETAIL_ID,
          name: "prenote",
          x: 12,
          y: 34,
          width: 552,
          height: 242,
          content: cleanText(params.prenote?.text || "No selected prenote.", 920),
          borderWidth: 1,
          borderColor: 9,
          borderRadius: 6,
          padding: 8,
          eventCapture: true,
        },
      ],
    };
  }

  const visibleCue = shouldShowAutoCue(params.state, now.getTime()) ? latestCue : undefined;
  return {
    view: params.state.view,
    containers: [
      ...headerContainers(now),
      cueBox(showAiCue ? cueContent(visibleCue) : "", true),
      ...(showTranscript ? [transcriptBox(transcript, false)] : []),
    ],
  };
}
