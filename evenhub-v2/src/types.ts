export type CueCategory = "response" | "concept" | "suggestion" | "person" | "code";
export type CueDuration = 5000 | 10000 | 15000 | "forever";
export type VoiceInput = "glasses" | "phone";
export type SpeechLanguage = "english" | "chinese" | "auto";
export type GlassContentFlag = "aiCue" | "transcript";
export type ConversationTab = "summary" | "transcript" | "prenote";
export type GlassView = "root_idle" | "main" | "menu" | "cue_detail" | "prenote_detail" | "exit_confirm";
export type GlassGesture = "click" | "double_click" | "scroll_up" | "scroll_down" | "foreground_enter" | "foreground_exit" | "abnormal_exit";
export type SummaryStatus = "not_started" | "queued" | "running" | "ready" | "failed";

export type AiCue = {
  id: string;
  category: CueCategory;
  title: string;
  g2Title?: string;
  preview?: string;
  fullAnswer?: string;
  output: string;
  language?: string;
  code?: string;
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
  status: "ready" | "pending" | "error";
};

export type TranscriptLine = {
  id: string;
  time: string;
  text: string;
  partial?: boolean;
};

export type ConversationSummaryKeyPoint = {
  id: string;
  title: string;
  details: string[];
};

export type ConversationSummaryActionItem = {
  id: string;
  text: string;
  checked: boolean;
};

export type ConversationSummary = {
  status: SummaryStatus;
  title: string;
  overview: string;
  keyPoints: ConversationSummaryKeyPoint[];
  actionItems: ConversationSummaryActionItem[];
  emptyReason?: string;
  generatedAt?: string;
  error?: string;
};

export type ConversationRecord = {
  id: string;
  title: string;
  startedAt: string;
  location: string;
  duration: string;
  summary: ConversationSummary;
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

export type GlassEffect = "start_conversation" | "manual_generate" | "exit_confirm" | "none";

export type GlassTransition = {
  state: GlassRuntimeState;
  effect: GlassEffect;
};
