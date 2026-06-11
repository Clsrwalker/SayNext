export type CueCategory = "response" | "concept" | "suggestion" | "person";
export type CueDuration = 5000 | 10000 | 15000 | "forever";
export type VoiceInput = "glasses" | "phone";
export type SpeechLanguage = "english" | "chinese" | "auto";
export type GlassContentFlag = "aiCue" | "transcript";
export type ConversationTab = "summary" | "transcript" | "prenote";
export type GlassView = "root_idle" | "main" | "menu" | "cue_detail" | "prenote_detail" | "exit_confirm";
export type GlassGesture = "click" | "double_click" | "scroll_up" | "scroll_down" | "foreground_enter" | "foreground_exit" | "abnormal_exit";

export type AiCue = {
  id: string;
  category: CueCategory;
  title: string;
  output: string;
  createdAt: string;
  source: "manual" | "auto";
};

export type Prenote = {
  id: string;
  title: string;
  text: string;
  selected: boolean;
  files: PrenoteFile[];
};

export type PrenoteFile = {
  id: string;
  name: string;
  sizeBytes: number;
  status: "mock_ready" | "pending" | "error";
};

export type TranscriptLine = {
  id: string;
  time: string;
  text: string;
  partial?: boolean;
};

export type ConversationRecord = {
  id: string;
  title: string;
  startedAt: string;
  location: string;
  duration: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  transcript: TranscriptLine[];
  cueHistory: AiCue[];
  usedPrenote?: Prenote;
};

export type ConversationSettings = {
  voiceInput: VoiceInput;
  language: SpeechLanguage;
  glassContent: Record<GlassContentFlag, boolean>;
  autoPopup: boolean;
  cueDuration: CueDuration;
};

export type GlassRuntimeState = {
  view: GlassView;
  selectedIndex: number;
  activeCueId: string | null;
  latestCueId: string | null;
  autoCueVisibleUntil: number | null;
};

export type GlassEffect = "manual_generate" | "exit_confirm" | "none";

export type GlassTransition = {
  state: GlassRuntimeState;
  effect: GlassEffect;
};
