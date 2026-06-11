import { buildMenuItems, shouldShowAutoCue } from "./glasses-state";
import type { AiCue, GlassRuntimeState, Prenote, TranscriptLine } from "./types";

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
export const GLASS_TRANSCRIPT_LINE_CHARS = 40;

const CUE_ID = 2;
const TRANSCRIPT_ID = 3;
const MENU_ID = 4;
const DETAIL_ID = 5;
const HEADER_RIGHT_ID = 7;

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

function latestTranscript(lines: TranscriptLine[]): string {
  return lines
    .slice(-GLASS_TRANSCRIPT_MAX_LINES)
    .map((line) => cleanText(`${line.partial ? "~" : ""}${line.text}`, GLASS_TRANSCRIPT_LINE_CHARS))
    .join("\n");
}

function cueContent(cue: AiCue | undefined): string {
  if (!cue) return "";
  return cleanText(cue.output, 360);
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
    id: TRANSCRIPT_ID,
    name: "transcript",
    x: 12,
    y: bounds.y ?? 204,
    width: 552,
    height: bounds.height ?? 84,
    content: content || "Listening...",
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
  now?: Date;
}): GlassPageSpec {
  const now = params.now || new Date();
  const latestCue = params.cues.find((cue) => cue.id === params.state.latestCueId) || params.cues[0];
  const activeCue = params.cues.find((cue) => cue.id === params.state.activeCueId) || latestCue;
  const transcript = latestTranscript(params.transcript);
  if (params.state.view === "root_idle") {
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        cueBox("SayNext ready.\nDouble click to exit confirmation.", true),
        transcriptBox("Start a conversation from the phone page.", false),
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
        transcriptBox(transcript, false, { y: 204, height: 84 }),
      ],
    };
  }

  if (params.state.view === "cue_detail") {
    return {
      view: params.state.view,
      containers: [
        ...headerContainers(now),
        cueBox(cueContent(activeCue) || "No cue selected.", true),
        transcriptBox(transcript, false),
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
      cueBox(cueContent(visibleCue), true),
      transcriptBox(transcript, false),
    ],
  };
}
