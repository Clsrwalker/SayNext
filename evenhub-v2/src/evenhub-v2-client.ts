import type { BootstrapSettingsSource } from "./settings-storage";
import type { AiCue, ConversationRecord, ConversationSettings, ConversationSummary, CueDuration, Prenote, SummaryStatus, TranscriptLine } from "./types";

const PROTOCOL_VERSION = "evenhub-v2.1";
const DEFAULT_BACKEND_ORIGIN = "https://saynext.167.172.153.109.sslip.io";

type Envelope<TType extends string, TPayload = unknown> = {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageId: string;
  requestId?: string;
  conversationId?: string;
  clientSeq?: number;
  serverSeq?: number;
  timestamp: string;
  type: TType;
  payload?: TPayload;
};

export type EvenHubV2ServerMessage =
  | Envelope<"ready", { settings: ServerSettings }>
  | Envelope<"conversation_started", { conversationId: string }>
  | Envelope<"audio_status", { audioStatus: string; detail?: string; audioBytesReceived?: number; audioSource?: "glasses" | "phone" }>
  | Envelope<"transcript_partial", { text: string; offsetMs?: number }>
  | Envelope<"transcript_final", { lineId: string; index: number; text: string; receivedAt: string; offsetMs?: number }>
  | Envelope<"cue_created", {
      cueId: string;
      attemptId: string;
      category: AiCue["category"];
      title: string;
      g2Title: string;
      preview?: string;
      fullAnswer?: string;
      output: string;
      language?: string;
      code?: string;
      explanation?: string;
      sourceTranscriptLineIds: string[];
      createdAt: string;
    }>
  | Envelope<"conversation_saved", { conversationId: string; transcriptCount: number; cueCount: number; endedAt: string }>
  | Envelope<"status", { status: string; detail?: string }>
  | Envelope<"error", { code: string; message: string; recoverable?: boolean }>;

type ServerSettings = {
  language: "english" | "chinese" | "auto";
  cueDurationMs: 5000 | 10000 | 15000 | "forever";
  autoPopup: boolean;
  showAiCue: boolean;
  showTranscript: boolean;
};

type BootstrapResponse = {
  settings?: ServerSettings;
  settingsSource?: BootstrapSettingsSource;
  settingsUpdatedAt?: string;
  prenotes?: Prenote[];
  conversations?: Array<{
    id: string;
    title: string;
    startedAt: string;
    endedAt: string;
    durationMs: number | null;
    summaryStatus?: SummaryStatus;
    usedPrenote?: { ids?: string[]; text?: string };
  }>;
};

type ServerConversationSummary = {
  status: SummaryStatus;
  title: string;
  overview: string;
  keyPoints: ConversationSummary["keyPoints"];
  actionItems: ConversationSummary["actionItems"];
  emptyReason?: string;
  generatedAt?: string;
  error?: string;
};

type ConversationDetailResponse = {
  conversation: {
    id: string;
    title: string;
    startedAt: string;
    endedAt: string;
    durationMs: number | null;
    usedPrenote?: { ids?: string[]; text?: string };
  };
  summary?: ServerConversationSummary;
  transcript: Array<{ id: string; text: string; index: number; receivedAt: string }>;
  cues: Array<{
    id: string;
    category: AiCue["category"];
    title: string;
    g2Title?: string;
    preview?: string;
    fullAnswer?: string;
    output: string;
    language?: string;
    code?: string;
    explanation?: string;
    createdAt: string;
  }>;
};

let clientSeq = 0;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function durationToServer(duration: CueDuration): ServerSettings["cueDurationMs"] {
  return duration;
}

function durationFromMs(durationMs: number | null | undefined): string {
  const total = Math.max(0, Math.floor((durationMs || 0) / 1000));
  const hours = Math.floor(total / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((total % 3600) / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function offsetLabel(offsetMs: number | null | undefined): string | null {
  if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs)) return null;
  return durationFromMs(offsetMs);
}

function timeFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "00:00:00";
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `00:${minutes}:${seconds}`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return `${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isPrivateLanHost(hostname: string): boolean {
  return /^192\.168\./.test(hostname)
    || /^10\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isSayNextBackendHost(hostname: string): boolean {
  return hostname === "saynext.167.172.153.109.sslip.io" || hostname.includes("saynext.");
}

export function resolveBackendOrigin(locationUrl: URL, envBase?: string, isDev = import.meta.env.DEV): string {
  const explicit = envBase?.trim();
  if (explicit) return trimTrailingSlash(explicit);

  if (isSayNextBackendHost(locationUrl.hostname) || locationUrl.port === "3000") {
    return locationUrl.origin;
  }

  if (isDev && (locationUrl.hostname === "localhost" || locationUrl.hostname === "127.0.0.1" || isPrivateLanHost(locationUrl.hostname))) {
    return `${locationUrl.protocol}//${locationUrl.hostname}:3000`;
  }

  return DEFAULT_BACKEND_ORIGIN;
}

function backendOrigin(): string {
  return resolveBackendOrigin(new URL(window.location.href), import.meta.env.VITE_SAYNEXT_API_BASE);
}

function apiUrl(path: string): string {
  return `${backendOrigin()}${path}`;
}

function serverSettings(settings: ConversationSettings): ServerSettings {
  return {
    language: settings.language,
    cueDurationMs: durationToServer(settings.cueDuration),
    autoPopup: settings.autoPopup,
    showAiCue: settings.glassContent.aiCue,
    showTranscript: settings.glassContent.transcript,
  };
}

export function createClientMessage<TType extends string>(
  type: TType,
  payload: unknown,
  conversationId?: string | null,
): Envelope<TType> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: makeId("client_msg"),
    requestId: makeId("req"),
    conversationId: conversationId || undefined,
    clientSeq: ++clientSeq,
    timestamp: new Date().toISOString(),
    type,
    payload,
  };
}

export function wsUrl(): string {
  const origin = backendOrigin();
  const wsOrigin = origin.startsWith("https:") ? origin.replace(/^https:/, "wss:") : origin.replace(/^http:/, "ws:");
  return `${wsOrigin}/api/evenhub/v2/ws`;
}

export async function loadBootstrap(): Promise<{
  settings?: Partial<ConversationSettings>;
  settingsSource?: BootstrapSettingsSource;
  settingsUpdatedAt?: string;
  prenotes: Prenote[];
  records: ConversationRecord[];
}> {
  const response = await fetch(apiUrl("/api/evenhub/v2/bootstrap"));
  if (!response.ok) throw new Error(`bootstrap failed: ${response.status}`);
  const data = await response.json() as BootstrapResponse;
  return {
    settings: data.settings ? {
      language: data.settings.language,
      autoPopup: data.settings.autoPopup,
      cueDuration: data.settings.cueDurationMs,
      glassContent: {
        aiCue: data.settings.showAiCue,
        transcript: data.settings.showTranscript,
      },
    } : undefined,
    settingsSource: data.settingsSource,
    settingsUpdatedAt: data.settingsUpdatedAt,
    prenotes: data.prenotes || [],
    records: (data.conversations || []).map((conversation) => ({
      id: conversation.id,
      title: conversation.title || "Conversation",
      startedAt: dateLabel(conversation.startedAt),
      location: "-",
      duration: durationToServerLabel(conversation.durationMs),
      summary: emptyConversationSummary(conversation.summaryStatus || "not_started"),
      transcript: [],
      cueHistory: [],
      usedPrenote: conversation.usedPrenote?.text ? {
        id: conversation.usedPrenote.ids?.join(",") || "used-prenote",
        title: "Used Prenote",
        text: conversation.usedPrenote.text,
        selected: false,
        files: [],
      } : undefined,
    })),
  };
}

export async function saveServerSettings(settings: ConversationSettings): Promise<void> {
  const response = await fetch(apiUrl("/api/evenhub/v2/settings"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: serverSettings(settings) }),
  });
  if (!response.ok) throw new Error(`settings save failed: ${response.status}`);
}

function durationToServerLabel(durationMs: number | null | undefined): string {
  return durationFromMs(durationMs);
}

export function emptyConversationSummary(status: SummaryStatus = "not_started"): ConversationSummary {
  return {
    status,
    title: "",
    overview: "",
    keyPoints: [],
    actionItems: [],
    emptyReason: "",
    generatedAt: "",
    error: "",
  };
}

function summaryFromServer(summary: ServerConversationSummary | undefined): ConversationSummary {
  if (!summary) return emptyConversationSummary();
  return {
    status: summary.status || "not_started",
    title: summary.title || "",
    overview: summary.overview || "",
    keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints : [],
    actionItems: Array.isArray(summary.actionItems) ? summary.actionItems : [],
    emptyReason: summary.emptyReason || "",
    generatedAt: summary.generatedAt || "",
    error: summary.error || "",
  };
}

function displayConversationTitle(conversationTitle: string | undefined, summaryTitle: string | undefined): string {
  const rawTitle = (conversationTitle || "").trim();
  const generatedTitle = (summaryTitle || "").trim();
  if (rawTitle && !["Conversation", "New Conversation", "Empty Conversation"].includes(rawTitle)) return rawTitle;
  return generatedTitle || rawTitle || "Conversation";
}

export function recordFromConversationDetail(data: ConversationDetailResponse): ConversationRecord {
  const startedAt = new Date(data.conversation.startedAt).getTime();
  return {
    id: data.conversation.id,
    title: displayConversationTitle(data.conversation.title, data.summary?.title),
    startedAt: dateLabel(data.conversation.startedAt),
    location: "-",
    duration: durationFromMs(data.conversation.durationMs),
    summary: summaryFromServer(data.summary),
    transcript: data.transcript.map((line): TranscriptLine => ({
      id: line.id,
      time: offsetLabel(new Date(line.receivedAt).getTime() - startedAt) || timeFromIso(line.receivedAt),
      text: line.text,
    })),
    cueHistory: data.cues.map((cue): AiCue => {
      const output = cue.category === "code" ? cue.code || cue.output : cue.fullAnswer || cue.output;
      return {
        id: cue.id,
        category: cue.category,
        title: cue.title,
        g2Title: cue.g2Title,
        preview: cue.preview || cue.explanation || output,
        fullAnswer: cue.fullAnswer || cue.explanation || output,
        output,
        language: cue.language,
        code: cue.code,
        explanation: cue.explanation,
        createdAt: cue.createdAt,
        source: "auto",
      };
    }),
    usedPrenote: data.conversation.usedPrenote?.text ? {
      id: data.conversation.usedPrenote.ids?.join(",") || "used-prenote",
      title: "Used Prenote",
      text: data.conversation.usedPrenote.text,
      selected: false,
      files: [],
    } : undefined,
  };
}

export async function loadConversationDetail(id: string): Promise<ConversationRecord> {
  const response = await fetch(apiUrl(`/api/evenhub/v2/conversations/${encodeURIComponent(id)}`));
  if (!response.ok) throw new Error(`conversation detail failed: ${response.status}`);
  const data = await response.json() as ConversationDetailResponse;
  return recordFromConversationDetail(data);
}

export async function deleteConversationRecord(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/evenhub/v2/conversations/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`conversation delete failed: ${response.status}`);
}

export async function savePrenoteDraft(note: Prenote): Promise<Prenote> {
  const response = await fetch(apiUrl("/api/evenhub/v2/prenotes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: note.title,
      text: note.text,
      selected: note.selected,
    }),
  });
  if (!response.ok) throw new Error(`prenote save failed: ${response.status}`);
  const data = await response.json() as { prenote?: Prenote };
  if (!data.prenote) throw new Error("prenote save failed: missing prenote");
  return data.prenote;
}

export function conversationStartPayload(settings: ConversationSettings, prenote: Prenote | null) {
  return {
    settings: serverSettings(settings),
    selectedPrenoteIds: prenote ? [prenote.id] : [],
    selectedPrenoteText: prenote?.text || "",
  };
}

export function cueFromServer(message: Extract<EvenHubV2ServerMessage, { type: "cue_created" }>): AiCue {
  const payload = message.payload;
  const output = payload?.category === "code"
    ? payload.code || payload.output || ""
    : payload?.fullAnswer || payload?.output || "";
  return {
    id: payload?.cueId || makeId("cue"),
    category: payload?.category || "concept",
    title: payload?.title || payload?.g2Title || "Cue",
    g2Title: payload?.g2Title,
    preview: payload?.preview || payload?.explanation || output,
    fullAnswer: payload?.fullAnswer || payload?.explanation || output,
    output,
    language: payload?.language,
    code: payload?.code,
    explanation: payload?.explanation,
    createdAt: payload?.createdAt || new Date().toISOString(),
    source: "auto",
  };
}

export function transcriptFromServer(message: Extract<EvenHubV2ServerMessage, { type: "transcript_final" }>): TranscriptLine {
  return {
    id: message.payload?.lineId || makeId("line"),
    time: offsetLabel(message.payload?.offsetMs) || timeFromIso(message.payload?.receivedAt || message.timestamp),
    text: message.payload?.text || "",
  };
}

export function partialTranscriptFromServer(message: Extract<EvenHubV2ServerMessage, { type: "transcript_partial" }>): TranscriptLine {
  return {
    id: "partial-transcript",
    time: offsetLabel(message.payload?.offsetMs) || timeFromIso(message.timestamp),
    text: message.payload?.text || "",
    partial: true,
  };
}

export { serverSettings };
