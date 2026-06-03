import { createHash } from "node:crypto";
import { AppSession } from '@mentra/sdk';
import { Action, AgentType, type AgentResponse, type AgentInsight, type Conversation, type AgentRoute } from "../types";
import { generateOptionalContinuation, generateTelepromptScript, processConversation, type OutputLanguage, type PromptMode } from "./initial-agent";
import { routeToSpecialist } from "./specialist-agents";
import { INSIGHTS_HISTORY_LENGTH, TRANSCRIPT_HISTORY_LENGTH, INSIGHT_CACHE_SIZE, SIMILARITY_THRESHOLD, INSIGHT_DISPLAY_DURATION_MS, MANUAL_PAUSE_DISPLAY_DURATION_MS, TELEPROMPT_DISPLAY_DURATION_MS } from '../../config';
import { findBestMatch } from 'string-similarity';
import { LocationManager } from '../../manager/LocationManager';
import { conversationLogger } from '../../data/conversation-logger';
import { EventMemoryManager, type EventMemorySnapshot } from '../../memory/event-memory';
import { routeFastScene, type SceneBuiltinKey } from '../../scene/fast-scene-router';
import { makeTelepromptOpeningLine, shouldStartTeleprompt, TelepromptRuntime, type TelepromptDisplay } from '../../teleprompt/teleprompt-runtime';
import { OpenAiConversationSession, isOpenAiConversationStateEnabled } from './openai-conversation-state';
import { normalizeKnownProjectAsrAliases } from '../../text/asr-corrections';
import { detectPromptMode } from '../../saynext/context-builder';
import { sayNextConversationStateInstructions } from '../../saynext/prompts';
import { evenHubConversationStateInstructions } from '../../evenhub/prompts';
import { renderManualBitmapDisplay } from './manual-bitmap-display';

const EVENT_IDLE_CLOSE_MS = 8 * 60 * 1000;
const SUGGESTION_ECHO_WINDOW_MS = 45 * 1000;
const SUGGESTION_ECHO_REFRESH_MS = 45 * 1000;
const SUGGESTION_ECHO_REDRAW_THRESHOLD_MS = 5 * 1000;
const READBACK_CONTINUATION_SILENCE_MS = Number(process.env.READBACK_CONTINUATION_SILENCE_MS || 850);
const READBACK_CONTINUATION_MIN_COVERAGE = Number(process.env.READBACK_CONTINUATION_MIN_COVERAGE || 0.78);
const READBACK_CONTINUATION_COOLDOWN_MS = Number(process.env.READBACK_CONTINUATION_COOLDOWN_MS || 20_000);
const RESPONSE_STALE_GRACE_MS = Number(process.env.RESPONSE_STALE_GRACE_MS || 120);
const TELEPROMPT_REFRESH_REDRAW_THRESHOLD_MS = Number(process.env.TELEPROMPT_REFRESH_REDRAW_THRESHOLD_MS || 8_000);
const TELEPROMPT_READY_MIN_DISPLAY_MS = Number(process.env.TELEPROMPT_READY_MIN_DISPLAY_MS || 90_000);
const TELEPROMPT_READY_MAX_DISPLAY_MS = Number(process.env.TELEPROMPT_READY_MAX_DISPLAY_MS || 180_000);
const AUTO_SCENE_SWITCH_CONFIDENCE = Number(process.env.AUTO_SCENE_SWITCH_CONFIDENCE || 0.75);
const AUTO_SCENE_REPEAT_CONFIDENCE = Number(process.env.AUTO_SCENE_REPEAT_CONFIDENCE || 0.65);
const AUTO_SCENE_FORCE_CONFIDENCE = Number(process.env.AUTO_SCENE_FORCE_CONFIDENCE || 0.9);
const AUTO_SCENE_SWITCH_COOLDOWN_MS = Number(process.env.AUTO_SCENE_SWITCH_COOLDOWN_MS || 20_000);
const MAX_DISPLAYED_SUGGESTIONS = 12;
const MIN_ECHO_WORDS = 3;
const MANUAL_MAX_SEGMENTS = 500;
const MANUAL_ACTION_TTL_MS = 2 * 60 * 1000;
const MANUAL_GENERATION_TIMEOUT_MS = Number(process.env.MANUAL_GENERATION_TIMEOUT_MS || 35_000);
const MANUAL_TRANSIENT_STATUS_MS = Number(process.env.MENTRA_MANUAL_TRANSIENT_STATUS_MS || 1400);
const MANUAL_TEXTWALL_BODY_LINES = Number(process.env.MENTRA_MANUAL_PAGE_LINES || 3);
const MANUAL_TEXTWALL_LINE_UNITS = Number(process.env.MENTRA_MANUAL_LINE_UNITS || 56);
const MANUAL_PARTIAL_DISPLAY_INTERVAL_MS = Number(process.env.MENTRA_MANUAL_PARTIAL_DISPLAY_INTERVAL_MS || 700);
const MANUAL_RECENT_ASR_WINDOW_MS = Number(process.env.MENTRA_MANUAL_RECENT_ASR_WINDOW_MS || 60_000);
function isManualBitmapDisplayEnabled(): boolean {
  return process.env.MENTRA_MANUAL_BITMAP_DISPLAY === "true";
}
function isManualSplitDisplayEnabled(): boolean {
  return process.env.MENTRA_MANUAL_SPLIT_DISPLAY === "true";
}
const MANUAL_LISTENING_TEXT = "Listening for speech.\nSay the question, then tap R1.";
const MANUAL_GENERATING_TEXT = "Generating from the latest speech.";
const MANUAL_BUSY_TEXT = "Still generating. Wait a moment.";
const MANUAL_NO_ANSWER_TEXT = "No pinned answer yet.\nSay something, then tap R1.";
const SAYNEXT_PERSONAL_MEMORY_TOP_K = Number(process.env.SAYNEXT_PERSONAL_MEMORY_TOP_K || 5);
const STRONG_ECHO_SIMILARITY = 0.82;
const MEDIUM_ECHO_SIMILARITY = 0.68;
const STRONG_ECHO_TRANSCRIPT_COVERAGE = 0.75;
const MEDIUM_ECHO_TRANSCRIPT_COVERAGE = 0.55;
const PARTIAL_ECHO_TRANSCRIPT_COVERAGE = 0.45;
const PARTIAL_ECHO_SUGGESTION_COVERAGE = 0.38;
const LOOSE_PARTIAL_ECHO_SIMILARITY = 0.46;
const LOOSE_PARTIAL_ECHO_TRANSCRIPT_COVERAGE = 0.42;
const LOOSE_PARTIAL_ECHO_SUGGESTION_COVERAGE = 0.26;
const SHORT_PARTIAL_ECHO_SIMILARITY = 0.41;
const SHORT_PARTIAL_ECHO_TRANSCRIPT_COVERAGE = 0.24;
const SHORT_PARTIAL_ECHO_SUGGESTION_COVERAGE = 0.42;
const SUGGESTION_ECHO_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "so",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "that",
  "this",
  "it",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  "they",
  "their",
  "yeah",
  "uh",
  "um",
  "like",
  "kind",
  "sort",
  "just",
  "really",
  "probably",
  "maybe",
]);

type DisplayedSuggestion = {
  text: string;
  candidates: string[];
  shownAt: number;
  expiresAt: number;
};

type DisplayedSuggestionEcho = {
  displayText: string;
  match: SuggestionEchoMatch;
};

type LastDisplayedAnswerContext = {
  displayText: string;
  sourceTranscript: string;
  context: Conversation;
  eventSnapshot: EventMemorySnapshot;
  activePrenoteContext: string;
  activeSceneProfilePrompt: string;
  relevantPersonalMemoryContext: string;
  timestamp: number;
};

type ReadbackContinuationPrefetch = {
  key: string;
  promise: Promise<string | null>;
};

export type InteractionMode = "g1_auto" | "g2_manual";
type PromptPreset = "saynext" | "evenhub";

type TranscriptSegment = {
  id: string;
  text: string;
  timestamp: number;
  reason: "isFinal" | "timeout";
  createdAt: number;
};

type SourceRange = {
  fromExclusive: string | null;
  toInclusive: string;
  segmentIds: string[];
  textDigest: string;
};

type ManualAnswer = {
  answerGroupId: string;
  answerId: string;
  requestId: string;
  sourceRange: SourceRange;
  output: string;
  pages: string[];
  pageIndex: number;
  createdAt: number;
};

type PendingManualRequest = {
  requestId: string;
  kind: "generate" | "regenerate";
  sourceRange: SourceRange;
  cancelled: boolean;
};

export type ManualActionResult = {
  status:
    | "ok"
    | "busy"
    | "no_new_speech"
    | "no_current_answer"
    | "cleared"
    | "noop"
    | "error";
  sessionId: string;
  state: ManualRuntimeState;
  answer?: {
    answerGroupId: string;
    answerId: string;
    pageIndex: number;
    totalPages: number;
    text: string;
    output: string;
  };
  error?: string;
};

export type ManualRuntimeState = {
  mode: InteractionMode;
  sessionId: string;
  transcriptCount: number;
  lastGeneratedCursor: string | null;
  pending: null | {
    requestId: string;
    kind: "generate" | "regenerate";
    sourceRange: SourceRange;
  };
  currentAnswer: null | {
    answerGroupId: string;
    answerId: string;
    pageIndex: number;
    totalPages: number;
    sourceRange: SourceRange;
    outputDigest: string;
  };
  stateVersion: number;
};

export type SuggestionEchoMatch = {
  matched: boolean;
  similarity: number;
  transcriptCoverage: number;
  suggestionCoverage: number;
  candidate: string;
};

function normalizeSuggestionEchoText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/\b(uh|um|erm|hmm|mm|ah|like|you know|i mean|sort of|kind of|actually|basically|honestly)\b/g, " ")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInterruptionText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasEmbeddedInterruptionMarker(text: string): boolean {
  const normalized = normalizeInterruptionText(text);
  if (!normalized) return false;

  const markers = [
    /\bactually\s+(?:i already|we are|we already|we changed|user|backend|deadline|api|schema|cost|main issue|blocker|requirement|database|endpoint)\b/g,
    /\bactually\s+the\s+(?:deadline|backend|api|schema|cost|main issue|blocker|requirement|database|endpoint)\b/g,
    /\bno\s+(?:the|we|it|this|that)\b/g,
    /\bbut\s+(?:i think the|i already|user|mobile|requirement|backend|api)\b/g,
    /\bbut\s+the\s+(?:requirement|mobile screen|schema|backend|api|database|deadline|user flow|cost|blocker)\b/g,
    /\bbut\s+we\s+(?:already|changed|are using|need|cannot|can't)\b/g,
    /\bsorry\s+(?:the|meeting|to interrupt)\b/g,
    /\bone more thing\b/g,
    /\balso\s+(?:user|we|i)\b/g,
    /\balso\s+the\s+user\b/g,
    /\bthe\s+(?:blocker|requirement|deadline|database query|api response|dataset|cost limit)\b/g,
    /\bthe main issue\s+(?:is|was)\b/g,
    /\bwe changed\b/g,
    /\bi already\b/g,
    /\bthis is not for\b/g,
  ];

  for (const marker of markers) {
    marker.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(normalized)) !== null) {
      const prefixWords = normalized.slice(0, match.index).split(/\s+/).filter(Boolean);
      if (prefixWords.length >= 4) return true;
    }
  }

  return false;
}

function echoTokens(text: string): string[] {
  return normalizeSuggestionEchoText(text)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !SUGGESTION_ECHO_STOP_WORDS.has(token));
}

function wordCountForEcho(text: string): number {
  return normalizeSuggestionEchoText(text).split(/\s+/).filter(Boolean).length;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenCoverage(source: string, target: string): number {
  const sourceTokens = new Set(echoTokens(source));
  const targetTokens = echoTokens(target);
  if (!sourceTokens.size || !targetTokens.length) return 0;

  let matches = 0;
  for (const token of targetTokens) {
    if (sourceTokens.has(token)) matches += 1;
  }
  return matches / targetTokens.length;
}

function suggestionCoverage(source: string, target: string): number {
  const sourceTokens = echoTokens(source);
  const targetTokens = new Set(echoTokens(target));
  if (!sourceTokens.length || !targetTokens.size) return 0;

  let matches = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token)) matches += 1;
  }
  if (matches < 3) return 0;
  return matches / sourceTokens.length;
}

function isLikelyFreshQuestionOrInterruption(text: string): boolean {
  const normalized = normalizeSuggestionEchoText(text);
  if (!normalized) return false;
  if (/\?\s*$/.test(text.trim())) return true;
  if (/^(what|why|how|when|where|who|which|tell me|describe|explain)\b/.test(normalized)) {
    return true;
  }
  if (/^(can|could|would|do|does|did)\s+(?:you|we|they|i|it|this|that|the)\b/.test(normalized)) {
    return true;
  }
  if (/^(is)\s+(?:it|that|this|there|your|the|a|an)\b/.test(normalized)) {
    return true;
  }
  if (/^(are)\s+(?:you|we|they|there|the)\b/.test(normalized)) {
    return true;
  }
  if (/^(have|has)\s+(?:you|we|they|it|this|that|the)\b/.test(normalized)) {
    return true;
  }
  if (hasEmbeddedInterruptionMarker(text)) {
    return true;
  }
  return (
    /\b(hold on|wait|stop there|sorry to interrupt|before you continue|quick question|another question|next question|move on|switch topic|different topic)\b/.test(normalized)
    || /\b(can you|could you|would you|do you|did you|does that|does it|does this|is it|are you|have you|has it|what about|how about|tell me|describe this|describe that|explain this|explain that)\b/.test(normalized)
    || /\bis that\s+(?:for|a|an|the|your|because|like|possible|true|right|okay|clear)\b/.test(normalized)
    || /\bwhat\s+(?:class|tech stack|stack|game|project|model|course|happens|do you|did you|would you|is it|is that|are you|was|is|are|kind of|type of)\b/.test(normalized)
    || /\bwhy\s+(?:not|did|do|does|is|are|would|should)\b/.test(normalized)
    || /\bhow\s+(?:long|did|do|does|would|can|could|is|are)\b/.test(normalized)
    || /\bhow\s+(?:much|many)\s+(?:does|did|do|is|are|was|were|would|can|could)\b/.test(normalized)
  );
}

function isQuestionLikeDisplayedCandidate(text: string): boolean {
  const normalized = normalizeSuggestionEchoText(text);
  if (!normalized) return false;
  return /\?\s*$/.test(text.trim())
    || /^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|should)\b/.test(normalized);
}

function computeTelepromptDisplayDuration(display: TelepromptDisplay): number {
  if (display.status !== "ready") {
    return TELEPROMPT_DISPLAY_DURATION_MS;
  }

  const readableWords = wordCountForEcho(display.text);
  const estimatedMs = Math.ceil((readableWords / 105) * 60_000) + 25_000;
  return Math.min(
    TELEPROMPT_READY_MAX_DISPLAY_MS,
    Math.max(TELEPROMPT_READY_MIN_DISPLAY_MS, TELEPROMPT_DISPLAY_DURATION_MS, estimatedMs),
  );
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function makeRuntimeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function compactManualStatus(status: string): string {
  switch (status) {
    case "ANSWER / LISTENING":
      return "ANS | LISTEN";
    case "HEARING":
      return "SN | HEARING";
    case "HEARD / TAP R1":
      return "SN | HEARD";
    case "LISTENING":
      return "SN | LISTEN";
    case "GENERATING":
      return "SN | GEN";
    case "BUSY":
      return "SN | BUSY";
    case "NO NEW SPEECH":
      return "SN | NO ASR";
    case "READY":
      return "SN | READY";
    default:
      return `SN | ${status}`;
  }
}

function formatManualDisplay(status: string, body: string, pageIndex?: number, totalPages?: number): string {
  const header = formatManualHeader(status, pageIndex, totalPages);
  const normalizedBody = normalizeManualDisplayBody(body);
  return `${header}\n${normalizedBody || "Ready."}`;
}

function formatManualHeader(status: string, pageIndex?: number, totalPages?: number): string {
  const page = totalPages && totalPages > 1 && pageIndex !== undefined
    ? ` ${pageIndex + 1}/${totalPages}`
    : "";
  return `${compactManualStatus(status)}${page}`;
}

function formatManualBitmapAnswerHeader(pageIndex?: number, totalPages?: number): string {
  const page = totalPages && totalPages > 1 && pageIndex !== undefined
    ? ` ${pageIndex + 1}/${totalPages}`
    : "";
  return `ANSWER${page}`;
}

function normalizeManualDisplayBody(body: string): string {
  return String(body || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactManualStatusSnippet(text: string, maxChars = 118): string {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function manualHeardStatusText(text: string): string {
  const snippet = compactManualStatusSnippet(text);
  return snippet ? `Heard: ${snippet}\nTap R1 to answer.` : "Speech captured.\nTap R1 to answer.";
}

function manualHearingStatusText(text: string): string {
  const snippet = compactManualStatusSnippet(text);
  return snippet ? `Hearing: ${snippet}` : "Receiving speech...";
}

function manualDisplayCharUnits(char: string): number {
  return /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af\uff00-\uffef]/u.test(char) ? 2 : 1;
}

function manualDisplayUnits(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + manualDisplayCharUnits(char), 0);
}

function splitManualDisplayToken(token: string, maxUnits: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentUnits = 0;

  for (const char of Array.from(token)) {
    const charUnits = manualDisplayCharUnits(char);
    if (current && currentUnits + charUnits > maxUnits) {
      chunks.push(current);
      current = char;
      currentUnits = charUnits;
    } else {
      current += char;
      currentUnits += charUnits;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function wrapManualDisplayText(text: string, maxUnits: number): string[] {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const lines: string[] = [];
  let current = "";

  for (const token of normalized.split(" ").filter(Boolean)) {
    const candidate = current ? `${current} ${token}` : token;
    if (manualDisplayUnits(candidate) <= maxUnits) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (manualDisplayUnits(token) <= maxUnits) {
      current = token;
      continue;
    }

    const chunks = splitManualDisplayToken(token, maxUnits);
    lines.push(...chunks.slice(0, -1));
    current = chunks.at(-1) || "";
  }

  if (current) lines.push(current);
  return lines;
}

export function paginateManualAnswer(text: string): string[] {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const maxBodyLines = Math.max(1, Math.min(4, MANUAL_TEXTWALL_BODY_LINES));
  const maxLineUnits = Math.max(24, Math.min(80, MANUAL_TEXTWALL_LINE_UNITS));
  const wrappedLines = wrapManualDisplayText(cleaned, maxLineUnits);
  const pages: string[] = [];

  for (let index = 0; index < wrappedLines.length; index += maxBodyLines) {
    pages.push(wrappedLines.slice(index, index + maxBodyLines).join("\n"));
  }

  return pages.map((page) => page.trim()).filter(Boolean);
}


async function withManualGenerationTimeout<T>(promise: Promise<T>, requestId: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Manual generation timed out after ${MANUAL_GENERATION_TIMEOUT_MS}ms (${requestId})`)),
          MANUAL_GENERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isLikelyQuestionSuggestionPartialEcho(transcript: string, candidate: string, transcriptCoverage: number, candidateCoverage: number): boolean {
  if (!isQuestionLikeDisplayedCandidate(candidate)) return false;

  const normalizedTranscript = normalizeSuggestionEchoText(transcript);
  const normalizedCandidate = normalizeSuggestionEchoText(candidate);
  if (!normalizedTranscript || !normalizedCandidate) return false;

  const transcriptWordCount = wordCountForEcho(normalizedTranscript);
  const prefixLike = normalizedCandidate.startsWith(normalizedTranscript) && transcriptWordCount >= 5;
  return prefixLike || (
    transcriptWordCount >= 4
    && transcriptCoverage >= 0.72
    && candidateCoverage >= 0.2
  );
}

function extractDisplayedSuggestionCandidates(text: string): string[] {
  const cleaned = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\d+\s*\/\s*\d+$/.test(line) && !/^next:?$/i.test(line))
    .join("\n")
    .replace(/^done\.\s*saynext is listening\.?$/i, "")
    .trim();

  if (!cleaned) return [];

  const chunks = [
    cleaned,
    ...cleaned.split(/\n+next:\n+/i),
    ...cleaned.split(/(?<=[.!?])\s+/),
  ]
    .map((item) => item.replace(/^next:\s*/i, "").trim())
    .filter((item) => wordCountForEcho(item) >= MIN_ECHO_WORDS);

  return Array.from(new Set(chunks));
}

export function detectSuggestionEcho(transcript: string, displayedCandidates: string[]): SuggestionEchoMatch {
  const normalizedTranscript = normalizeSuggestionEchoText(transcript);
  if (wordCountForEcho(normalizedTranscript) < MIN_ECHO_WORDS) {
    return { matched: false, similarity: 0, transcriptCoverage: 0, suggestionCoverage: 0, candidate: "" };
  }

  const freshQuestionOrInterruption = isLikelyFreshQuestionOrInterruption(transcript);
  let best: SuggestionEchoMatch = { matched: false, similarity: 0, transcriptCoverage: 0, suggestionCoverage: 0, candidate: "" };
  for (const candidate of displayedCandidates) {
    const normalizedCandidate = normalizeSuggestionEchoText(candidate);
    if (!normalizedCandidate) continue;

    const similarity = findBestMatch(normalizedTranscript, [normalizedCandidate]).bestMatch.rating;
    const transcriptCoverage = tokenCoverage(normalizedCandidate, normalizedTranscript);
    const candidateCoverage = suggestionCoverage(normalizedCandidate, normalizedTranscript);
    const normalEchoMatch = similarity >= STRONG_ECHO_SIMILARITY
      || transcriptCoverage >= STRONG_ECHO_TRANSCRIPT_COVERAGE
      || (similarity >= MEDIUM_ECHO_SIMILARITY && transcriptCoverage >= MEDIUM_ECHO_TRANSCRIPT_COVERAGE)
      || (candidateCoverage >= PARTIAL_ECHO_SUGGESTION_COVERAGE && transcriptCoverage >= PARTIAL_ECHO_TRANSCRIPT_COVERAGE)
      || (
        similarity >= LOOSE_PARTIAL_ECHO_SIMILARITY
        && transcriptCoverage >= LOOSE_PARTIAL_ECHO_TRANSCRIPT_COVERAGE
        && candidateCoverage >= LOOSE_PARTIAL_ECHO_SUGGESTION_COVERAGE
      )
      || (
        similarity >= SHORT_PARTIAL_ECHO_SIMILARITY
        && transcriptCoverage >= SHORT_PARTIAL_ECHO_TRANSCRIPT_COVERAGE
        && candidateCoverage >= SHORT_PARTIAL_ECHO_SUGGESTION_COVERAGE
      )
      || (
        similarity >= 0.48
        && transcriptCoverage >= 0.35
        && candidateCoverage >= 0.28
      )
      || (
        similarity >= 0.42
        && transcriptCoverage >= 0.39
        && candidateCoverage >= 0.35
      );
    const strongWholeEcho = similarity >= 0.84
      || (transcriptCoverage >= 0.84 && candidateCoverage >= 0.55)
      || (transcriptCoverage >= 0.92 && candidateCoverage >= 0.5);
    const questionSuggestionPartialEcho = freshQuestionOrInterruption
      && isLikelyQuestionSuggestionPartialEcho(transcript, candidate, transcriptCoverage, candidateCoverage);
    const matched = freshQuestionOrInterruption ? (strongWholeEcho || questionSuggestionPartialEcho) : normalEchoMatch;

    const candidateResult = { matched, similarity, transcriptCoverage, suggestionCoverage: candidateCoverage, candidate };
    const candidateScore = similarity + transcriptCoverage + candidateCoverage;
    const bestScore = best.similarity + best.transcriptCoverage + best.suggestionCoverage;
    if (
      (candidateResult.matched && !best.matched)
      || (candidateResult.matched === best.matched && candidateScore > bestScore)
    ) {
      best = candidateResult;
    }
  }

  return best;
}

export class MergeResponseHandler {
  private session: AppSession;
  private userId: string;
  private sessionId: string;
  private locationManager: LocationManager;
  private conversation: Conversation;
  private openAiConversationSession: OpenAiConversationSession;
  private eventMemory: EventMemoryManager;
  private eventIdleTimer: NodeJS.Timeout | null = null;
  private isDisplaying: boolean = false;
  private displayTimer: NodeJS.Timeout | null = null;
  private pausedDisplayRefreshTimer: NodeJS.Timeout | null = null;
  private currentDisplayText: string | null = null;
  private currentDisplayExpiresAt: number = 0;
  private lastInsightText: string | null = null;
  private isPausedForReading: boolean = false;
  private processingSeq: number = 0;
  private recentInsightCache: string[] = [];
  private recentDisplayedSuggestions: DisplayedSuggestion[] = [];
  private teleprompt: TelepromptRuntime = new TelepromptRuntime();
  private lastDisplayedAnswerContext: LastDisplayedAnswerContext | null = null;
  private readbackContinuationTimer: NodeJS.Timeout | null = null;
  private readbackContinuationSeq: number = 0;
  private readbackContinuationPrefetch: ReadbackContinuationPrefetch | null = null;
  private lastContinuationAt: number = 0;
  private readbackTokenCoverageByDisplay: Map<string, Set<string>> = new Map();
  private autoSceneKey: SceneBuiltinKey = "daily_chat";
  private autoScenePendingKey: SceneBuiltinKey | null = null;
  private autoScenePendingCount: number = 0;
  private autoSceneLastSwitchAt: number = 0;
  private interactionMode: InteractionMode;
  private transcriptSegments: TranscriptSegment[] = [];
  private transcriptSeq: number = 0;
  private lastGeneratedCursor: string | null = null;
  private pendingManualRequest: PendingManualRequest | null = null;
  private currentManualAnswer: ManualAnswer | null = null;
  private manualStateVersion: number = 0;
  private manualActionResults: Map<string, { expiresAt: number; result: ManualActionResult }> = new Map();
  private manualPromptModeOverride: PromptMode | null = null;
  private lastManualPartialText: string = "";
  private lastManualPartialAt: number = 0;
  private lastManualPartialDisplayAt: number = 0;
  private lastManualCommittedText: string = "";
  private lastManualCommittedAt: number = 0;
  private promptPreset: PromptPreset;
  public frequency: 'low' | 'medium' | 'high';
  public outputLanguage: OutputLanguage;

  // Callback for when an insight is generated (for webview SSE broadcasting)
  public onInsight?: (insight: { text: string; timestamp: number; agentType: string; reasoning: string }) => void;
  public onStatus?: (event: { type: string; [key: string]: unknown }) => void;

  constructor(
    session: AppSession,
    userId: string,
    locationManager: LocationManager,
    initialFrequency: 'low' | 'medium' | 'high' = 'high',
    initialOutputLanguage: OutputLanguage = "english",
    initialInteractionMode: InteractionMode = "g1_auto",
    promptPreset: PromptPreset = "saynext",
  ) {
    this.session = session;
    this.userId = userId;
    this.sessionId = `${userId}-${Date.now()}`;
    this.locationManager = locationManager;
    this.conversation = [];
    this.openAiConversationSession = new OpenAiConversationSession({ userId, sessionId: this.sessionId });
    this.promptPreset = promptPreset;
    const seedInstructions = promptPreset === "evenhub"
      ? evenHubConversationStateInstructions
      : sayNextConversationStateInstructions;
    if (isOpenAiConversationStateEnabled(process.env.LLM_PROVIDER || "openai")) {
      this.openAiConversationSession.warmup(Number(process.env.OPENAI_CONVERSATION_WARMUP_TIMEOUT_MS || 8000), seedInstructions)
        .then((conversationId) => this.session.logger.info(`OpenAI conversation state warmed up: ${conversationId}`))
        .catch((error) => this.session.logger.warn(`OpenAI conversation warmup skipped: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.eventMemory = new EventMemoryManager(userId, this.sessionId);
    this.frequency = initialFrequency;
    this.outputLanguage = initialOutputLanguage;
    this.interactionMode = initialInteractionMode;
  }

  /**
   * Process a new transcript and update the conversation
   */
  async processTranscript(text: string, timestamp: number, reason: "isFinal" | "timeout" = "isFinal"): Promise<void> {
    const originalText = text;
    text = normalizeKnownProjectAsrAliases(text);
    if (text !== originalText) {
      this.session.logger.info(`Corrected known ASR alias: "${originalText}" -> "${text}"`);
    }

    if (this.isPausedForReading && this.interactionMode !== "g2_manual") {
      this.session.logger.info(`Manual pause active, ignoring transcript: "${text}"`);
      this.onStatus?.({ type: "processing_done", reason: "paused" });
      return;
    }

    const suggestionEcho = this.interactionMode === "g1_auto" && !this.teleprompt.isActive()
      ? this.getRecentDisplayedSuggestionEcho(text, timestamp)
      : null;
    if (suggestionEcho) {
      this.session.logger.info(`Ignoring self-read suggestion echo: "${text}"`);
      this.refreshDisplayedSuggestionEcho(suggestionEcho.displayText);
      this.trackReadbackEchoAndMaybeScheduleContinuation(suggestionEcho, text, timestamp);
      this.onStatus?.({ type: "processing_done", reason: "suggestion_echo" });
      return;
    }

    this.cancelReadbackContinuation("new_transcript");
    const requestSeq = ++this.processingSeq;
    const { eventSnapshot } = this.commitTranscriptSegment(text, timestamp, reason);

    if (this.interactionMode === "g2_manual") {
      this.logManualTranscriptSample(text, timestamp, reason);
      this.lastManualCommittedText = text;
      this.lastManualCommittedAt = timestamp;
      this.lastManualPartialText = text;
      this.lastManualPartialAt = timestamp;
      this.showManualDisplay("HEARD / TAP R1", manualHeardStatusText(text), { preserveAnswer: true });
      this.onStatus?.({
        type: "manual_status",
        reason: "transcript_committed",
        transcript: text,
        state: this.getManualState(),
      });
      this.onStatus?.({ type: "processing_done", reason: "manual_transcript_committed" });
      this.trimConversationHistory();
      return;
    }

    const telepromptResult = this.teleprompt.isActive()
      ? this.teleprompt.handleTranscript(text, timestamp, reason === "timeout" ? "timeout" : "final")
      : null;

    if (telepromptResult) {
      if (telepromptResult.action === "advance" || telepromptResult.action === "finish") {
        this.showTelepromptDisplay(telepromptResult.display);
        this.onStatus?.({ type: "processing_done", reason: `teleprompt_${telepromptResult.action}` });
        this.trimConversationHistory();
        return;
      }

      if (telepromptResult.action === "hold" && telepromptResult.consumed) {
        const display = this.teleprompt.getDisplay();
        if (display) {
          this.showTelepromptDisplay(display, undefined, "refresh");
        }
        this.onStatus?.({ type: "processing_done", reason: "teleprompt_hold" });
        this.trimConversationHistory();
        return;
      }

      if (telepromptResult.action === "cancel") {
        this.session.logger.info(`Teleprompt cancelled: ${telepromptResult.reason}`);
        this.onStatus?.({ type: "teleprompt_cancelled", reason: telepromptResult.reason });
      }
    }

    // --- CONTEXT ASSEMBLY ---
    const recentTranscripts = this.conversation
      .filter(item => item.type === 'transcript' || item.type === 'silent')
      .slice(-TRANSCRIPT_HISTORY_LENGTH);

    const recentInsights = this.conversation
      .filter(item => item.type === 'insight' || item.type === 'route')
      .slice(-INSIGHTS_HISTORY_LENGTH);

    // Combine and sort them by timestamp to create the context
    const context: Conversation = [...recentTranscripts, ...recentInsights]
      .sort((a, b) => a.timestamp - b.timestamp);

    const activeSceneProfilePrompt = this.resolveActiveSceneProfilePrompt(
      text,
      timestamp,
      recentTranscripts
        .filter((item) => item.type === "transcript")
        .map((item) => item.text),
    );
    const promptMode = detectPromptMode(text, eventSnapshot);
    const isClassroomMode = promptMode === "classroom";
    const memoryQuery = eventSnapshot.recentTranscripts.slice(-4).join("\n") || text;
    const telepromptNeed = shouldStartTeleprompt(text, `${eventSnapshot.scene} ${activeSceneProfilePrompt}`);
    const prenoteRetrievalMode = telepromptNeed === "none" ? "fast" : "semantic";
    const prenoteQuery = prenoteRetrievalMode === "fast"
      ? [
        text,
        eventSnapshot.recentTranscripts.slice(-2).join("\n"),
      ].filter(Boolean).join("\n")
      : [
        text,
        eventSnapshot.title,
        eventSnapshot.summary,
        eventSnapshot.recentTranscripts.slice(-4).join("\n"),
        activeSceneProfilePrompt,
      ].filter(Boolean).join("\n");
    const activePrenoteContext = await conversationLogger.getActivePrenoteRuntimeContextForQuery(
      this.userId,
      prenoteQuery,
      prenoteRetrievalMode,
    );
    const relevantPersonalMemoryContext = isClassroomMode
      ? ""
      : await conversationLogger.getRelevantPersonalMemoryContextAsync(this.userId, memoryQuery, SAYNEXT_PERSONAL_MEMORY_TOP_K);

    if (telepromptNeed !== "none") {
      this.startTelepromptAnswer({
        text,
        timestamp,
        context,
        eventSnapshot,
        activePrenoteContext,
        activeSceneProfilePrompt,
        relevantPersonalMemoryContext,
        targetMode: telepromptNeed,
      });
      this.onStatus?.({ type: "processing_done", reason: `teleprompt_${telepromptNeed}` });
      this.trimConversationHistory();
      return;
    }

    // Get Initial Agent's decision, passing the current frequency
    const response = await processConversation(
      context,
      this.frequency,
      eventSnapshot,
      this.outputLanguage,
      activePrenoteContext,
      activeSceneProfilePrompt,
      relevantPersonalMemoryContext,
      {
        openAiConversationSession: this.openAiConversationSession,
        transcriptCommitReason: reason === "timeout" ? "timeout" : "final",
      },
    );

    if (requestSeq !== this.processingSeq) {
      this.session.logger.info(`Dropping stale AI response for older transcript: "${text}"`);
      this.onStatus?.({ type: "processing_done", reason: "stale_response" });
      return;
    }

    if (RESPONSE_STALE_GRACE_MS > 0 && response.type === Action.INSIGHT) {
      await sleepMs(RESPONSE_STALE_GRACE_MS);
      if (requestSeq !== this.processingSeq) {
        this.session.logger.info(`Dropping stale AI response during display grace window for older transcript: "${text}"`);
        this.onStatus?.({ type: "processing_done", reason: "stale_response" });
        return;
      }
    }

    // Add the response to conversation history
    this.conversation.push(response);
    this.eventMemory.addResponse(response);
    this.logConversationSample(text, timestamp, response);
    if (response.type === Action.INSIGHT) {
      this.lastDisplayedAnswerContext = {
        displayText: response.output,
        sourceTranscript: text,
        context,
        eventSnapshot,
        activePrenoteContext,
        activeSceneProfilePrompt,
        relevantPersonalMemoryContext,
        timestamp,
      };
    }

    // Handle the response based on action type
    await this.handleAgentResponse(response);
    this.onStatus?.({ type: "processing_done", reason: response.type });
    this.session.logger.info({conversation: this.conversation}, `Conversation`);

    // Trim conversation history if it gets too long
    this.trimConversationHistory();
  }

  handlePartialTranscript(text: string, timestamp: number): boolean {
    if (this.interactionMode === "g2_manual") {
      const normalized = this.noteManualRawAsr(text, timestamp, "partial");
      if (!normalized) return false;

      const now = Date.now();
      if (!this.pendingManualRequest && now - this.lastManualPartialDisplayAt >= MANUAL_PARTIAL_DISPLAY_INTERVAL_MS) {
        this.lastManualPartialDisplayAt = now;
        this.showManualDisplay("HEARING", manualHearingStatusText(normalized), { preserveAnswer: true });
      }
      return false;
    }

    if (this.isPausedForReading || this.teleprompt.isActive()) return false;

    const suggestionEcho = this.getRecentDisplayedSuggestionEcho(text, timestamp);
    if (!suggestionEcho) return false;

    this.trackReadbackEchoAndMaybeScheduleContinuation(suggestionEcho, text, timestamp, {
      allowSchedule: false,
    });
    this.onStatus?.({ type: "readback_partial_echo" });
    return true;
  }

  noteManualRawAsr(text: string, timestamp: number, reason: string): string {
    if (this.interactionMode !== "g2_manual") return "";
    const normalized = normalizeKnownProjectAsrAliases(text).trim();
    if (!normalized) return "";

    this.lastManualPartialText = normalized;
    this.lastManualPartialAt = timestamp;
    this.onStatus?.({
      type: "manual_asr_raw",
      reason,
      transcript: normalized,
      state: this.getManualState(),
    });
    return normalized;
  }

  private resolveActiveSceneProfilePrompt(latestTranscript: string, timestamp: number, recentTranscripts: string[]): string {
    const activeProfile = conversationLogger.getActiveSceneProfile(this.userId);
    if (activeProfile?.builtinKey !== "auto") {
      return conversationLogger.formatSceneProfilePrompt(activeProfile);
    }

    const route = routeFastScene({
      latestTranscript,
      recentTranscripts,
      previousSceneKey: this.autoSceneKey,
    });
    const previousSceneKey = this.autoSceneKey;
    let switched = false;

    if (route.sceneKey === this.autoSceneKey) {
      this.autoScenePendingKey = null;
      this.autoScenePendingCount = 0;
    } else {
      if (this.autoScenePendingKey === route.sceneKey) {
        this.autoScenePendingCount += 1;
      } else {
        this.autoScenePendingKey = route.sceneKey;
        this.autoScenePendingCount = 1;
      }

      const inCooldown = timestamp - this.autoSceneLastSwitchAt < AUTO_SCENE_SWITCH_COOLDOWN_MS;
      const forceSwitch = route.confidence >= AUTO_SCENE_FORCE_CONFIDENCE;
      const confidentSwitch = route.confidence >= AUTO_SCENE_SWITCH_CONFIDENCE && !inCooldown;
      const repeatedSwitch = route.confidence >= AUTO_SCENE_REPEAT_CONFIDENCE && this.autoScenePendingCount >= 2 && !inCooldown;
      if (forceSwitch || confidentSwitch || repeatedSwitch) {
        this.autoSceneKey = route.sceneKey;
        this.autoSceneLastSwitchAt = timestamp;
        this.autoScenePendingKey = null;
        this.autoScenePendingCount = 0;
        switched = true;
      }
    }

    const selectedProfile = conversationLogger.getSceneProfileByBuiltinKey(this.userId, this.autoSceneKey)
      || conversationLogger.getSceneProfileByBuiltinKey(this.userId, "daily_chat");
    this.onStatus?.({
      type: "auto_scene",
      sceneKey: this.autoSceneKey,
      candidateSceneKey: route.sceneKey,
      previousSceneKey,
      confidence: route.confidence,
      reason: route.reason,
      switched,
    });

    return selectedProfile
      ? `Active scene profile: Auto -> ${selectedProfile.name}\n${selectedProfile.prompt.trim()}`
      : "";
  }

  private logConversationSample(text: string, timestamp: number, response: AgentResponse): void {
    try {
      const metadata = response.type === Action.INSIGHT ? response.metadata?.agentInput : undefined;
      conversationLogger.createSample({
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp,
        language: this.outputLanguage,
        transcript: text,
        aiReply: response.type === Action.INSIGHT ? response.output : null,
        actionType: response.type,
        reasoning: response.reasoning,
        model: metadata?.model ?? null,
        profileVersion: metadata?.profileVersion ?? null,
        retrievedSampleIds: metadata?.retrievedSampleIds ?? [],
      });
    } catch (error) {
      this.session.logger.error(`Failed to log conversation sample: ${error}`);
    }
  }

  private commitTranscriptSegment(text: string, timestamp: number, reason: "isFinal" | "timeout"): {
    segment: TranscriptSegment;
    eventSnapshot: EventMemorySnapshot;
  } {
    const eventSnapshot = this.eventMemory.addTranscript(text, timestamp);
    this.resetEventIdleTimer();

    const segment: TranscriptSegment = {
      id: `seg_${++this.transcriptSeq}`,
      text,
      timestamp,
      reason,
      createdAt: Date.now(),
    };
    this.transcriptSegments.push(segment);
    if (this.transcriptSegments.length > MANUAL_MAX_SEGMENTS) {
      const removable = this.transcriptSegments.length - MANUAL_MAX_SEGMENTS;
      this.transcriptSegments.splice(0, removable);
    }

    this.conversation.push({
      type: "transcript",
      text,
      timestamp,
    });

    return { segment, eventSnapshot };
  }

  private logManualTranscriptSample(text: string, timestamp: number, reason: "isFinal" | "timeout"): void {
    try {
      conversationLogger.createSample({
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp,
        language: this.outputLanguage,
        transcript: text,
        aiReply: null,
        actionType: "manual_transcript",
        reasoning: `G2 manual mode committed transcript (${reason}) without automatic generation`,
        model: null,
        profileVersion: "g2-manual-v1",
        retrievedSampleIds: [],
      });
    } catch (error) {
      this.session.logger.error(`Failed to log manual transcript sample: ${error}`);
    }
  }

  private createTelepromptInsight(output: string, timestamp: number, reasoning: string): AgentInsight {
    return {
      type: Action.INSIGHT,
      reasoning,
      timestamp,
      output,
      confidence: 0.82,
      metadata: {
        agentType: AgentType.Initial,
        agentInput: {
          model: "teleprompt",
          profileVersion: "teleprompt-v1",
          retrievedSampleIds: [],
        },
      },
    };
  }

  private createReadbackContinuationInsight(output: string, timestamp: number): AgentInsight {
    return {
      type: Action.INSIGHT,
      reasoning: "Optional continuation after Xiang finished reading the previous answer and the room stayed silent",
      timestamp,
      output,
      confidence: 0.72,
      metadata: {
        agentType: AgentType.Initial,
        agentInput: {
          model: "readback-continuation",
          profileVersion: "readback-continuation-v1",
          retrievedSampleIds: [],
        },
      },
    };
  }

  private startTelepromptAnswer(params: {
    text: string;
    timestamp: number;
    context: Conversation;
    eventSnapshot: EventMemorySnapshot;
    activePrenoteContext: string;
    activeSceneProfilePrompt: string;
    relevantPersonalMemoryContext: string;
    targetMode: "expandable" | "long";
  }): void {
    const openingLine = makeTelepromptOpeningLine(params.text);
    const display = this.teleprompt.startPending(params.text, openingLine, params.timestamp);
    const openingInsight = this.createTelepromptInsight(openingLine, params.timestamp, `Started ${params.targetMode} teleprompt`);

    this.conversation.push(openingInsight);
    this.eventMemory.addResponse(openingInsight);
    this.logConversationSample(params.text, params.timestamp, openingInsight);
    this.showTelepromptDisplay(display, openingInsight);
    this.session.logger.info(`Teleprompt ${params.targetMode} started for: "${params.text}"`);

    void generateTelepromptScript({
      conversation: params.context,
      eventMemory: params.eventSnapshot,
      outputLanguage: this.outputLanguage,
      activePrenoteContext: params.activePrenoteContext,
      activeSceneProfilePrompt: params.activeSceneProfilePrompt,
      relevantPersonalMemoryContext: params.relevantPersonalMemoryContext,
      openingLine,
      targetMode: params.targetMode,
    }).then((script) => {
      const readyDisplay = this.teleprompt.setScript(script);
      if (!readyDisplay) return;
      this.showTelepromptDisplay(readyDisplay);
      this.onStatus?.({
        type: "teleprompt_ready",
        text: readyDisplay.text,
        currentIndex: readyDisplay.currentIndex,
        total: readyDisplay.total,
      });
    }).catch((error) => {
      this.session.logger.error(`Teleprompt generation failed: ${error}`);
      this.teleprompt.cancel();
      this.onStatus?.({ type: "teleprompt_cancelled", reason: "generation_failed" });
    });
  }

  private showTelepromptDisplay(display: TelepromptDisplay, agentResponse?: AgentInsight, mode: "replace" | "refresh" = "replace"): void {
    this.tryShowInsight(
      display.text,
      computeTelepromptDisplayDuration(display),
      {
        skipCache: true,
        keepSameDisplayThresholdMs: mode === "refresh" ? TELEPROMPT_REFRESH_REDRAW_THRESHOLD_MS : undefined,
        keepSameDisplayReason: mode === "refresh" ? "teleprompt_refresh" : undefined,
      },
      agentResponse,
    );
    this.onStatus?.({
      type: "teleprompt",
      text: display.text,
      currentIndex: display.currentIndex,
      total: display.total,
      status: display.status,
    });
  }

  advanceTelepromptManually(): boolean {
    const result = this.teleprompt.advanceManual(Date.now());

    if (result.action === "advance" || result.action === "finish") {
      this.showTelepromptDisplay(result.display);
      this.onStatus?.({ type: "processing_done", reason: `teleprompt_manual_${result.action}` });
      return true;
    }

    if (result.action === "cancel") {
      this.session.logger.info(`Teleprompt cancelled by manual advance: ${result.reason}`);
      this.onStatus?.({ type: "teleprompt_cancelled", reason: result.reason });
      this.onStatus?.({ type: "processing_done", reason: "teleprompt_manual_cancel" });
      return false;
    }

    this.onStatus?.({
      type: "processing_done",
      reason: result.action === "hold" && result.consumed ? "teleprompt_manual_waiting" : "teleprompt_manual_inactive",
    });
    return false;
  }

  rewindTelepromptManually(): boolean {
    const result = this.teleprompt.rewindManual(Date.now());

    if (result.action === "rewind") {
      this.showTelepromptDisplay(result.display);
      this.onStatus?.({ type: "processing_done", reason: "teleprompt_manual_rewind" });
      return true;
    }

    if (result.action === "cancel") {
      this.session.logger.info(`Teleprompt cancelled by manual rewind: ${result.reason}`);
      this.onStatus?.({ type: "teleprompt_cancelled", reason: result.reason });
      this.onStatus?.({ type: "processing_done", reason: "teleprompt_manual_cancel" });
      return false;
    }

    this.onStatus?.({
      type: "processing_done",
      reason: result.action === "hold" && result.consumed ? "teleprompt_manual_waiting" : "teleprompt_manual_inactive",
    });
    return false;
  }

  cancelTelepromptManually(): boolean {
    const result = this.teleprompt.cancelManual();

    if (result.action === "cancel") {
      this.onStatus?.({ type: "teleprompt_cancelled", reason: result.reason });
      this.onStatus?.({ type: "processing_done", reason: "teleprompt_manual_cancel" });
      this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
      return true;
    }

    this.onStatus?.({ type: "processing_done", reason: "teleprompt_manual_inactive" });
    return false;
  }

  /**
   * Handle the agent's response based on its action type
   */
  private async handleAgentResponse(response: AgentResponse): Promise<void> {
    this.session.logger.info(`Agent action: ${response.type}, reasoning: ${response.reasoning}`);

    switch (response.type) {
      case Action.INSIGHT:
        this.tryShowInsight(response.output, INSIGHT_DISPLAY_DURATION_MS, {}, response);
        break;

      case Action.SILENT:
        // Do nothing - agent decided to stay quiet
        this.session.logger.info("Agent staying silent");
        break;

      case Action.ROUTE:
        // If routing to web search, show a loading message first
        if (response.targetAgent === AgentType.WebSearch) {
          this.tryShowInsight("web searching...", 10000, { skipCache: true });
        } else if (response.targetAgent === AgentType.PlacesAgent) {
          this.tryShowInsight("locating...", 10000, { skipCache: true });
        }
        // Route to specialist agent
        this.session.logger.info(`Routing to ${response.targetAgent}`);
        await this.handleRouting(response);
        break;
    }
  }

  /**
   * Handle routing to specialist agents
   */
  private async handleRouting(routeResponse: AgentRoute): Promise<void> {
    try {
      // Get specialist response
      const specialistResponse = await routeToSpecialist(
        this.session,
        routeResponse.targetAgent,
        routeResponse.payload,
        routeResponse.timestamp,
        this.locationManager
      );

      // Add specialist response to conversation
      this.conversation.push(specialistResponse);

      // --- THE SCALPEL ---
      if (this.currentDisplayText === "web searching..." || this.currentDisplayText === "locating...") {
        if (this.displayTimer) {
          clearTimeout(this.displayTimer);
          this.displayTimer = null;
        }
        this.isDisplaying = false;
        this.currentDisplayText = null;
        this.tryShowInsight(specialistResponse.output, INSIGHT_DISPLAY_DURATION_MS, {}, specialistResponse);
      } else if (!this.isDisplaying) {
        this.tryShowInsight(specialistResponse.output, INSIGHT_DISPLAY_DURATION_MS, {}, specialistResponse);
      } else {
        this.session.logger.info(`Display is busy with a final result, dropping insight: "${specialistResponse.output}"`);
      }

    } catch (error) {
      this.session.logger.error(`Routing error: ${error}`);
    }
  }

  /**
   * Shows an insight on the display if it's not already busy.
   */
  private tryShowInsight(
    output: string,
    durationMs: number,
    options: {
      skipCache?: boolean;
      keepSameDisplayThresholdMs?: number;
      keepSameDisplayReason?: string;
    } = {},
    agentResponse?: AgentInsight
  ): void {
    this.cancelReadbackContinuation("new_display");
    this.readbackTokenCoverageByDisplay.delete(this.readbackDisplayKey(output));

    const sameActiveDisplay = this.isDisplaying && this.currentDisplayText === output;
    const keepSameDisplayThresholdMs = options.keepSameDisplayThresholdMs;
    if (sameActiveDisplay && keepSameDisplayThresholdMs !== undefined) {
      const remainingMs = this.currentDisplayExpiresAt - Date.now();
      if (remainingMs > keepSameDisplayThresholdMs) {
        this.startDisplayReleaseTimer(remainingMs);
        this.onStatus?.({
          type: "display_kept",
          reason: options.keepSameDisplayReason || "same_display",
          remainingMs,
        });
        this.session.logger.info(
          `Kept displayed text without redraw; reason=${options.keepSameDisplayReason || "same_display"} remaining=${Math.round(remainingMs)}ms`,
        );
        return;
      }
    }

    if (this.isDisplaying) {
      this.session.logger.info(`Replacing displayed suggestion with: "${output}"`);
      if (this.displayTimer) {
        clearTimeout(this.displayTimer);
        this.displayTimer = null;
      }
      this.isDisplaying = false;
      this.currentDisplayText = null;
      this.currentDisplayExpiresAt = 0;
    }

    // --- DUPLICATION CHECK ---
    if (!options.skipCache && this.recentInsightCache.length > 0) {
      const { bestMatch } = findBestMatch(output, this.recentInsightCache);
      if (bestMatch.rating > SIMILARITY_THRESHOLD) {
        this.session.logger.info(`Duplicate insight detected (Similarity: ${bestMatch.rating.toFixed(2)}). Dropping: "${output}"`);
        this.onStatus?.({ type: "processing_done", reason: "duplicate_insight" });
        return;
      }
    }


    this.isDisplaying = true;
    this.currentDisplayText = output;
    this.currentDisplayExpiresAt = Date.now() + durationMs;
    this.rememberDisplayedSuggestion(output, durationMs);
    if (!options.skipCache) {
      this.lastInsightText = output;
    }
    const formattedOutput = output;
    this.session.logger.info(`Showing insight: "${formattedOutput}" for ${durationMs}ms`);
    this.session.layouts.showTextWall(formattedOutput, { durationMs });

    // Broadcast to webview via callback
    if (!options.skipCache && this.onInsight) {
      this.onInsight({
        text: output,
        timestamp: Date.now(),
        agentType: agentResponse?.metadata?.agentType || 'Initial',
        reasoning: agentResponse?.reasoning || '',
      });
    }

    // Add to cache and trim if necessary
    if (!options.skipCache) {
      this.recentInsightCache.push(output);
      if (this.recentInsightCache.length > INSIGHT_CACHE_SIZE) {
        this.recentInsightCache.shift();
      }
    }

    this.startDisplayReleaseTimer(durationMs);
  }

  pauseForReading(): void {
    this.isPausedForReading = true;
    this.cancelReadbackContinuation("manual_pause");

    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }

    const pinnedText = this.currentDisplayText || this.lastInsightText;
    if (pinnedText) {
      this.showPinnedText(pinnedText);
    } else {
      this.showPinnedText("Paused.");
    }

    this.session.logger.info("Manual reading pause enabled");
  }

  showPinnedText(text: string): void {
    if (!this.isPausedForReading) {
      this.isPausedForReading = true;
    }

    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.pausedDisplayRefreshTimer) {
      clearTimeout(this.pausedDisplayRefreshTimer);
      this.pausedDisplayRefreshTimer = null;
    }

    this.isDisplaying = true;
    this.currentDisplayText = text;
    this.currentDisplayExpiresAt = Date.now() + MANUAL_PAUSE_DISPLAY_DURATION_MS;
    this.lastInsightText = text;
    this.rememberDisplayedSuggestion(text, MANUAL_PAUSE_DISPLAY_DURATION_MS);
    this.session.layouts.showTextWall(text, { durationMs: MANUAL_PAUSE_DISPLAY_DURATION_MS });

    this.pausedDisplayRefreshTimer = setTimeout(() => {
      if (this.isPausedForReading && this.currentDisplayText) {
        this.showPinnedText(this.currentDisplayText);
      }
    }, Math.max(1000, MANUAL_PAUSE_DISPLAY_DURATION_MS - 5000));

    this.session.logger.info(`Pinned reading text: "${text}"`);
  }

  resumeAutomatic(): void {
    this.isPausedForReading = false;
    this.cancelReadbackContinuation("manual_resume");

    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.pausedDisplayRefreshTimer) {
      clearTimeout(this.pausedDisplayRefreshTimer);
      this.pausedDisplayRefreshTimer = null;
    }

    this.isDisplaying = false;
    this.currentDisplayText = null;
    this.currentDisplayExpiresAt = 0;
    this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
    this.session.logger.info("Automatic response mode enabled");
  }

  getManualPauseState(): boolean {
    return this.isPausedForReading;
  }

  getInteractionMode(): InteractionMode {
    return this.interactionMode;
  }

  showManualListeningStatus(): void {
    if (this.interactionMode !== "g2_manual") return;
    this.showManualDisplay(
      this.currentManualAnswer ? "ANSWER / LISTENING" : "LISTENING",
      MANUAL_LISTENING_TEXT,
      { preserveAnswer: true },
    );
  }

  private manualNoNewSpeechText(): string {
    const now = Date.now();
    const recentPartial = this.lastManualPartialText && now - this.lastManualPartialAt <= MANUAL_RECENT_ASR_WINDOW_MS
      ? this.lastManualPartialText
      : "";
    const recentCommitted = this.lastManualCommittedText && now - this.lastManualCommittedAt <= MANUAL_RECENT_ASR_WINDOW_MS
      ? this.lastManualCommittedText
      : "";
    const recentAsr = recentPartial || recentCommitted;

    if (recentAsr) {
      return `No new useful speech.\nLast ASR: ${compactManualStatusSnippet(recentAsr, 90)}`;
    }

    return "No speech reached SayNext.\nCheck mic/connection, then speak again.";
  }

  restoreManualDisplayAfterSystemPrompt(delayMs = 1200): void {
    if (this.interactionMode !== "g2_manual") return;
    setTimeout(() => {
      if (this.interactionMode === "g2_manual") {
        this.showManualListeningStatus();
      }
    }, delayMs);
  }

  setInteractionMode(mode: InteractionMode): void {
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    this.cancelReadbackContinuation("interaction_mode_change");
    if (mode === "g2_manual") {
      this.teleprompt.cancel();
      this.isPausedForReading = false;
      this.pendingManualRequest = null;
      this.currentManualAnswer = null;
      this.lastGeneratedCursor = this.transcriptSegments.at(-1)?.id ?? this.lastGeneratedCursor;
      if (this.displayTimer) {
        clearTimeout(this.displayTimer);
        this.displayTimer = null;
      }
      this.isDisplaying = false;
      this.currentDisplayText = null;
      this.currentDisplayExpiresAt = 0;
      this.showManualListeningStatus();
    } else {
      this.pendingManualRequest = null;
      this.currentManualAnswer = null;
      this.isDisplaying = false;
      this.currentDisplayText = null;
      this.currentDisplayExpiresAt = 0;
      this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
    }
    this.bumpManualState();
    this.onStatus?.({ type: "interaction_mode", mode, state: this.getManualState() });
  }

  getRuntimeSessionId(): string {
    return this.sessionId;
  }

  setManualPromptModeOverride(mode: PromptMode | null): void {
    this.manualPromptModeOverride = mode;
    this.bumpManualState();
    this.onStatus?.({ type: "manual_status", reason: "prompt_mode_override_updated", state: this.getManualState() });
  }

  getManualState(): ManualRuntimeState {
    return {
      mode: this.interactionMode,
      sessionId: this.sessionId,
      transcriptCount: this.transcriptSegments.length,
      lastGeneratedCursor: this.lastGeneratedCursor,
      pending: this.pendingManualRequest
        ? {
          requestId: this.pendingManualRequest.requestId,
          kind: this.pendingManualRequest.kind,
          sourceRange: this.pendingManualRequest.sourceRange,
        }
        : null,
      currentAnswer: this.currentManualAnswer
        ? {
          answerGroupId: this.currentManualAnswer.answerGroupId,
          answerId: this.currentManualAnswer.answerId,
          pageIndex: this.currentManualAnswer.pageIndex,
          totalPages: this.currentManualAnswer.pages.length,
          sourceRange: this.currentManualAnswer.sourceRange,
          outputDigest: shortHash(this.currentManualAnswer.output),
        }
        : null,
      stateVersion: this.manualStateVersion,
    };
  }

  async generateManualAnswer(clientEventId?: string): Promise<ManualActionResult> {
    const cached = this.getCachedManualAction(clientEventId);
    if (cached) return cached;

    if (this.pendingManualRequest) {
      console.log(`[SayNext] Manual generate ignored busy pending=${this.pendingManualRequest.requestId} kind=${this.pendingManualRequest.kind}`);
      this.showManualDisplay("BUSY", MANUAL_BUSY_TEXT, { preserveAnswer: true });
      return this.cacheManualAction(clientEventId, {
        status: "busy",
        sessionId: this.sessionId,
        state: this.getManualState(),
      });
    }

    const sourceRange = this.buildNewManualSourceRange();
    if (!sourceRange) {
      console.log(`[SayNext] Manual generate has no new speech transcriptCount=${this.transcriptSegments.length} lastGeneratedCursor=${this.lastGeneratedCursor ?? "-"}`);
      this.showManualTransientDisplay("NO NEW SPEECH", this.manualNoNewSpeechText(), {
        preserveAnswer: Boolean(this.currentManualAnswer),
      });
      return this.cacheManualAction(clientEventId, {
        status: "no_new_speech",
        sessionId: this.sessionId,
        state: this.getManualState(),
      });
    }

    return this.runManualGeneration("generate", sourceRange, clientEventId);
  }

  async regenerateManualAnswer(clientEventId?: string): Promise<ManualActionResult> {
    const cached = this.getCachedManualAction(clientEventId);
    if (cached) return cached;

    if (this.pendingManualRequest) {
      console.log(`[SayNext] Manual regenerate ignored busy pending=${this.pendingManualRequest.requestId} kind=${this.pendingManualRequest.kind}`);
      this.showManualDisplay("BUSY", MANUAL_BUSY_TEXT, { preserveAnswer: true });
      return this.cacheManualAction(clientEventId, {
        status: "busy",
        sessionId: this.sessionId,
        state: this.getManualState(),
      });
    }

    if (!this.currentManualAnswer) {
      console.log("[SayNext] Manual regenerate has no current answer");
      this.showManualDisplay("READY", MANUAL_NO_ANSWER_TEXT);
      return this.cacheManualAction(clientEventId, {
        status: "no_current_answer",
        sessionId: this.sessionId,
        state: this.getManualState(),
      });
    }

    return this.runManualGeneration("regenerate", this.currentManualAnswer.sourceRange, clientEventId);
  }

  pageManualAnswer(direction: "next" | "previous", clientEventId?: string): ManualActionResult {
    const cached = this.getCachedManualAction(clientEventId);
    if (cached) return cached;

    if (!this.currentManualAnswer) {
      this.showManualDisplay("READY", MANUAL_NO_ANSWER_TEXT);
      return this.cacheManualAction(clientEventId, {
        status: "no_current_answer",
        sessionId: this.sessionId,
        state: this.getManualState(),
      });
    }

    const current = this.currentManualAnswer;
    const nextIndex = direction === "next"
      ? Math.min(current.pages.length - 1, current.pageIndex + 1)
      : Math.max(0, current.pageIndex - 1);

    if (nextIndex === current.pageIndex) {
      return this.cacheManualAction(clientEventId, {
        status: "noop",
        sessionId: this.sessionId,
        state: this.getManualState(),
        answer: this.manualAnswerPayload(current),
      });
    }

    current.pageIndex = nextIndex;
    this.renderManualAnswer("manual_page");
    return this.cacheManualAction(clientEventId, {
      status: "ok",
      sessionId: this.sessionId,
      state: this.getManualState(),
      answer: this.manualAnswerPayload(current),
    });
  }

  clearManualAnswer(clientEventId?: string): ManualActionResult {
    const cached = this.getCachedManualAction(clientEventId);
    if (cached) return cached;

    if (this.pendingManualRequest) {
      this.pendingManualRequest.cancelled = true;
      this.pendingManualRequest = null;
    }
    this.currentManualAnswer = null;
    this.isDisplaying = false;
    this.currentDisplayText = null;
    this.currentDisplayExpiresAt = 0;
    this.cancelReadbackContinuation("manual_clear");
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.pausedDisplayRefreshTimer) {
      clearTimeout(this.pausedDisplayRefreshTimer);
      this.pausedDisplayRefreshTimer = null;
    }
    this.bumpManualState();
    this.showManualDisplay("LISTENING", MANUAL_LISTENING_TEXT);
    this.onStatus?.({ type: "manual_cleared", state: this.getManualState() });

    return this.cacheManualAction(clientEventId, {
      status: "cleared",
      sessionId: this.sessionId,
      state: this.getManualState(),
    });
  }

  isTelepromptActive(): boolean {
    return this.teleprompt.isActive();
  }

  private showManualDisplay(
    status: string,
    body: string,
    options: { preserveAnswer?: boolean; durationMs?: number; pageIndex?: number; totalPages?: number } = {},
  ): void {
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }

    const statusBody = normalizeManualDisplayBody(body);
    let displayBody = statusBody;
    let pageIndex = options.pageIndex;
    let totalPages = options.totalPages;
    let hasPinnedAnswerBody = false;
    if (options.preserveAnswer && this.currentManualAnswer) {
      const answer = this.currentManualAnswer;
      displayBody = normalizeManualDisplayBody(answer.pages[answer.pageIndex] || answer.output);
      pageIndex = answer.pageIndex;
      totalPages = answer.pages.length;
      hasPinnedAnswerBody = true;
    }

    const header = formatManualHeader(status, pageIndex, totalPages);
    const displayText = `${header}\n${displayBody || "Ready."}`;
    this.isDisplaying = true;
    this.currentDisplayText = displayText;
    this.currentDisplayExpiresAt = options.durationMs ? Date.now() + options.durationMs : Number.POSITIVE_INFINITY;
    this.lastInsightText = displayText;

    const layouts = this.session.layouts as typeof this.session.layouts & {
      showBitmapView?: (base64Bitmap: string, options?: { padding?: { left: number; top: number } }) => Promise<void>;
      showDoubleTextWall?: (topText: string, bottomText: string, options?: { durationMs?: number }) => void;
    };
    const canBitmapDisplay = isManualBitmapDisplayEnabled() && typeof layouts.showBitmapView === "function";
    if (canBitmapDisplay) {
      const answerHeader = hasPinnedAnswerBody
        ? formatManualBitmapAnswerHeader(pageIndex, totalPages)
        : "SAYNEXT";
      const answerBody = displayBody || "Ready.";
      const statusPanelBody = statusBody || header;
      const bitmap = renderManualBitmapDisplay({
        statusHeader: header,
        statusBody: statusPanelBody,
        answerHeader,
        answerBody,
      });
      console.log(
        `[SayNext] Manual display mode=bitmap status=${status} bytes=${Buffer.from(bitmap, "base64").length}`,
      );
      void layouts.showBitmapView?.(bitmap, { padding: { left: 0, top: 0 } }).catch((error) => {
        console.error("[SayNext] Manual bitmap display failed; falling back to text wall", error);
        if (options.durationMs) {
          this.session.layouts.showTextWall(displayText, { durationMs: options.durationMs });
        } else {
          this.session.layouts.showTextWall(displayText);
        }
      });
      return;
    }

    const canSplitDisplay = isManualSplitDisplayEnabled() && typeof layouts.showDoubleTextWall === "function";
    if (canSplitDisplay) {
      const topText = hasPinnedAnswerBody && statusBody ? `${header}\n${statusBody}` : header;
      const bottomText = displayBody || "Ready.";
      console.log(
        `[SayNext] Manual display mode=split status=${status} topChars=${topText.length} bottomChars=${bottomText.length}`,
      );
      if (options.durationMs) {
        layouts.showDoubleTextWall?.(topText, bottomText, { durationMs: options.durationMs });
      } else {
        layouts.showDoubleTextWall?.(topText, bottomText);
      }
      return;
    }

    console.log(`[SayNext] Manual display mode=text status=${status} chars=${displayText.length}`);
    if (options.durationMs) {
      this.session.layouts.showTextWall(displayText, { durationMs: options.durationMs });
      return;
    }

    this.session.layouts.showTextWall(displayText);
  }

  private showManualTransientDisplay(
    status: string,
    body: string,
    options: { preserveAnswer?: boolean; durationMs?: number } = {},
  ): void {
    const durationMs = options.durationMs ?? MANUAL_TRANSIENT_STATUS_MS;
    this.showManualDisplay(status, body, { ...options, durationMs });
    const transientDisplayText = this.currentDisplayText;
    this.displayTimer = setTimeout(() => {
      this.displayTimer = null;
      if (this.interactionMode !== "g2_manual") return;
      if (this.currentDisplayText !== transientDisplayText) return;
      this.showManualListeningStatus();
    }, durationMs);
  }

  private buildNewManualSourceRange(): SourceRange | null {
    let startIndex = 0;
    if (this.lastGeneratedCursor) {
      const cursorIndex = this.transcriptSegments.findIndex((segment) => segment.id === this.lastGeneratedCursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }
    const segments = this.transcriptSegments.slice(startIndex);
    if (!segments.length) return null;

    const text = segments.map((segment) => segment.text).join("\n");
    return {
      fromExclusive: this.lastGeneratedCursor,
      toInclusive: segments[segments.length - 1].id,
      segmentIds: segments.map((segment) => segment.id),
      textDigest: shortHash(text),
    };
  }

  private segmentsForSourceRange(sourceRange: SourceRange): TranscriptSegment[] {
    const wanted = new Set(sourceRange.segmentIds);
    return this.transcriptSegments.filter((segment) => wanted.has(segment.id));
  }

  private textForSourceRange(sourceRange: SourceRange): string {
    return this.segmentsForSourceRange(sourceRange).map((segment) => segment.text).join("\n").trim();
  }

  private async runManualGeneration(
    kind: "generate" | "regenerate",
    sourceRange: SourceRange,
    clientEventId?: string,
  ): Promise<ManualActionResult> {
    const requestId = makeRuntimeId("manual_req");
    const pending: PendingManualRequest = {
      requestId,
      kind,
      sourceRange,
      cancelled: false,
    };
    const startedAt = Date.now();
    this.pendingManualRequest = pending;
    this.bumpManualState();
    console.log(`[SayNext] Manual generation start request=${requestId} kind=${kind} segments=${sourceRange.segmentIds.length} digest=${sourceRange.textDigest}`);
    this.onStatus?.({ type: "manual_generating", requestId, kind, sourceRange, state: this.getManualState() });
    this.showManualDisplay("GENERATING", MANUAL_GENERATING_TEXT, { preserveAnswer: true });

    try {
      const segments = this.segmentsForSourceRange(sourceRange);
      const sourceText = this.textForSourceRange(sourceRange);
      if (!segments.length || !sourceText) {
        if (this.pendingManualRequest?.requestId === requestId) {
          this.pendingManualRequest = null;
          this.bumpManualState();
        }
        this.showManualTransientDisplay("NO NEW SPEECH", this.manualNoNewSpeechText(), {
          preserveAnswer: Boolean(this.currentManualAnswer),
        });
        return this.cacheManualAction(clientEventId, {
          status: "no_new_speech",
          sessionId: this.sessionId,
          state: this.getManualState(),
        });
      }

      const latestText = segments[segments.length - 1].text;
      const timestamp = Date.now();
      const context: Conversation = segments.map((segment) => ({
        type: "transcript",
        text: segment.text,
        timestamp: segment.timestamp,
      }));
      const eventSnapshot = this.eventMemory.getSnapshot();
      const activeSceneProfilePrompt = this.resolveActiveSceneProfilePrompt(
        latestText,
        timestamp,
        segments.map((segment) => segment.text),
      );
      const promptMode = this.manualPromptModeOverride || detectPromptMode(latestText, eventSnapshot);
      const isClassroomMode = promptMode === "classroom";
      const telepromptNeed = "none";
      const prenoteQuery = [
        sourceText,
        eventSnapshot.title,
        eventSnapshot.summary,
        activeSceneProfilePrompt,
      ].filter(Boolean).join("\n");
      const activePrenoteContext = await conversationLogger.getActivePrenoteRuntimeContextForQuery(
        this.userId,
        prenoteQuery,
        telepromptNeed === "none" ? "fast" : "semantic",
      );
      const relevantPersonalMemoryContext = isClassroomMode
        ? ""
        : await conversationLogger.getRelevantPersonalMemoryContextAsync(this.userId, sourceText, SAYNEXT_PERSONAL_MEMORY_TOP_K);

      const response = await withManualGenerationTimeout(
        processConversation(
          context,
          this.frequency,
          eventSnapshot,
          this.outputLanguage,
          activePrenoteContext,
          activeSceneProfilePrompt,
          relevantPersonalMemoryContext,
          {
            openAiConversationSession: this.openAiConversationSession,
            transcriptCommitReason: "final",
            responseStyle: "manual",
            promptModeOverride: this.manualPromptModeOverride || undefined,
            promptPreset: this.promptPreset,
          },
        ),
        requestId,
      );

      if (pending.cancelled || this.pendingManualRequest?.requestId !== requestId) {
        console.log(`[SayNext] Manual generation ignored request=${requestId} kind=${kind} reason=${pending.cancelled ? "cancelled" : "stale"} ms=${Date.now() - startedAt}`);
        return {
          status: "noop",
          sessionId: this.sessionId,
          state: this.getManualState(),
        };
      }

      this.pendingManualRequest = null;
      if (response.type !== Action.INSIGHT) {
        this.bumpManualState();
        const result: ManualActionResult = {
          status: "error",
          sessionId: this.sessionId,
          state: this.getManualState(),
          error: `Manual generation returned ${response.type}`,
        };
        this.onStatus?.({ type: "manual_error", requestId, error: result.error, state: result.state });
        this.showManualDisplay("ERROR", result.error || "Manual generation failed.");
        console.log(`[SayNext] Manual generation error request=${requestId} kind=${kind} reason=${result.error} ms=${Date.now() - startedAt}`);
        return this.cacheManualAction(clientEventId, result);
      }

      const answerGroupId = kind === "regenerate" && this.currentManualAnswer
        ? this.currentManualAnswer.answerGroupId
        : makeRuntimeId("manual_group");
      const answer: ManualAnswer = {
        answerGroupId,
        answerId: makeRuntimeId("manual_answer"),
        requestId,
        sourceRange,
        output: response.output,
        pages: paginateManualAnswer(response.output),
        pageIndex: 0,
        createdAt: timestamp,
      };

      this.currentManualAnswer = answer;
      if (kind === "generate") {
        this.lastGeneratedCursor = sourceRange.toInclusive;
      }
      this.conversation.push(response);
      this.eventMemory.addResponse(response);
      this.logConversationSample(sourceText, timestamp, response);
      this.renderManualAnswer("manual_answer");

      const result: ManualActionResult = {
        status: "ok",
        sessionId: this.sessionId,
        state: this.getManualState(),
        answer: this.manualAnswerPayload(answer),
      };
      this.onStatus?.({ type: "manual_answer", requestId, state: result.state, answer: result.answer });
      console.log(`[SayNext] Manual generation done request=${requestId} kind=${kind} words=${wordCountForEcho(response.output)} ms=${Date.now() - startedAt}`);
      return this.cacheManualAction(clientEventId, result);
    } catch (error) {
      if (this.pendingManualRequest?.requestId === requestId) {
        this.pendingManualRequest = null;
      }
      this.bumpManualState();
      const result: ManualActionResult = {
        status: "error",
        sessionId: this.sessionId,
        state: this.getManualState(),
        error: error instanceof Error ? error.message : String(error),
      };
      this.onStatus?.({ type: "manual_error", requestId, error: result.error, state: result.state });
      this.showManualDisplay("ERROR", result.error || "Manual generation failed.");
      console.log(`[SayNext] Manual generation failed request=${requestId} kind=${kind} error=${result.error} ms=${Date.now() - startedAt}`);
      return this.cacheManualAction(clientEventId, result);
    }
  }

  private manualAnswerPayload(answer: ManualAnswer): NonNullable<ManualActionResult["answer"]> {
    return {
      answerGroupId: answer.answerGroupId,
      answerId: answer.answerId,
      pageIndex: answer.pageIndex,
      totalPages: answer.pages.length,
      text: answer.pages[answer.pageIndex] || answer.output,
      output: answer.output,
    };
  }

  private renderManualAnswer(eventType: "manual_answer" | "manual_page"): void {
    if (!this.currentManualAnswer) return;
    this.cancelReadbackContinuation(eventType);
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    const answer = this.currentManualAnswer;
    const pageText = answer.pages[answer.pageIndex] || answer.output;
    this.showManualDisplay("ANSWER / LISTENING", pageText, {
      pageIndex: answer.pageIndex,
      totalPages: answer.pages.length,
    });
    this.bumpManualState();
    if (this.onInsight) {
      this.onInsight({
        text: pageText,
        timestamp: Date.now(),
        agentType: "Manual",
        reasoning: eventType,
      });
    }
    this.onStatus?.({ type: eventType, state: this.getManualState(), answer: this.manualAnswerPayload(answer) });
  }

  private bumpManualState(): void {
    this.manualStateVersion += 1;
  }

  private getCachedManualAction(clientEventId?: string): ManualActionResult | null {
    if (!clientEventId) return null;
    this.cleanupManualActionCache();
    return this.manualActionResults.get(`${this.sessionId}:${clientEventId}`)?.result ?? null;
  }

  private cacheManualAction(clientEventId: string | undefined, result: ManualActionResult): ManualActionResult {
    if (clientEventId) {
      this.manualActionResults.set(`${this.sessionId}:${clientEventId}`, {
        expiresAt: Date.now() + MANUAL_ACTION_TTL_MS,
        result,
      });
      this.cleanupManualActionCache();
    }
    return result;
  }

  private cleanupManualActionCache(): void {
    const now = Date.now();
    for (const [key, value] of this.manualActionResults.entries()) {
      if (value.expiresAt <= now) {
        this.manualActionResults.delete(key);
      }
    }
  }

  private startDisplayReleaseTimer(durationMs: number): void {
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
    }

    this.displayTimer = setTimeout(() => {
      if (this.isPausedForReading) {
        return;
      }
      this.isDisplaying = false;
      this.displayTimer = null;
      this.currentDisplayText = null;
      this.currentDisplayExpiresAt = 0;
      this.session.logger.info(`Display is now free.`);
    }, durationMs);
  }

  private trimConversationHistory(): void {
    if (this.conversation.length > (TRANSCRIPT_HISTORY_LENGTH + INSIGHTS_HISTORY_LENGTH)) {
      this.conversation = this.conversation.slice(-(TRANSCRIPT_HISTORY_LENGTH + INSIGHTS_HISTORY_LENGTH));
    }
  }

  /**
   * Get the current conversation for debugging/testing
   */
  getConversation(): Conversation {
    return [...this.conversation];
  }

  /**
   * Clear the conversation history
   */
  clearConversation(): void {
    this.cancelReadbackContinuation("clear_conversation");
    this.eventMemory.closeActiveEvent();
    if (this.eventIdleTimer) {
      clearTimeout(this.eventIdleTimer);
      this.eventIdleTimer = null;
    }
    this.conversation = [];
    this.transcriptSegments = [];
    this.transcriptSeq = 0;
    this.lastGeneratedCursor = null;
    this.pendingManualRequest = null;
    this.currentManualAnswer = null;
    this.manualActionResults.clear();
    this.bumpManualState();
    this.openAiConversationSession.reset();
  }

  resetRuntimeState(): void {
    this.processingSeq++;
    this.teleprompt.cancel();
    this.conversation = [];
    this.openAiConversationSession.reset();
    this.recentInsightCache = [];
    this.recentDisplayedSuggestions = [];
    this.readbackTokenCoverageByDisplay.clear();
    this.lastDisplayedAnswerContext = null;
    this.lastInsightText = null;
    this.currentDisplayText = null;
    this.currentDisplayExpiresAt = 0;
    this.isDisplaying = false;
    this.isPausedForReading = false;
    this.transcriptSegments = [];
    this.transcriptSeq = 0;
    this.lastGeneratedCursor = null;
    this.pendingManualRequest = null;
    this.currentManualAnswer = null;
    this.manualActionResults.clear();
    this.bumpManualState();

    this.eventMemory.closeActiveEvent();
    if (this.eventIdleTimer) {
      clearTimeout(this.eventIdleTimer);
      this.eventIdleTimer = null;
    }
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.pausedDisplayRefreshTimer) {
      clearTimeout(this.pausedDisplayRefreshTimer);
      this.pausedDisplayRefreshTimer = null;
    }
    this.cancelReadbackContinuation("runtime_reset");

    this.onStatus?.({ type: "processing_done", reason: "manual_reset" });
    if (this.interactionMode === "g2_manual") {
      this.showManualListeningStatus();
    } else {
      this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
    }
    this.session.logger.info("Current SayNext runtime state reset");
  }

  close(): void {
    this.cancelReadbackContinuation("close");
    this.teleprompt.cancel();
    if (this.pendingManualRequest) {
      this.pendingManualRequest.cancelled = true;
      this.pendingManualRequest = null;
    }
    this.openAiConversationSession.reset();
    this.eventMemory.closeActiveEvent();
    if (this.eventIdleTimer) {
      clearTimeout(this.eventIdleTimer);
      this.eventIdleTimer = null;
    }
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.pausedDisplayRefreshTimer) {
      clearTimeout(this.pausedDisplayRefreshTimer);
      this.pausedDisplayRefreshTimer = null;
    }
  }

  private resetEventIdleTimer(): void {
    if (this.eventIdleTimer) {
      clearTimeout(this.eventIdleTimer);
    }

    this.eventIdleTimer = setTimeout(() => {
      this.eventMemory.closeActiveEvent();
      this.eventIdleTimer = null;
      this.session.logger.info("Closed active conversation event after idle timeout");
    }, EVENT_IDLE_CLOSE_MS);
  }

  private rememberDisplayedSuggestion(text: string, durationMs: number): void {
    const candidates = extractDisplayedSuggestionCandidates(text);
    if (!candidates.length) return;

    const now = Date.now();
    const windowMs = Math.max(durationMs, SUGGESTION_ECHO_WINDOW_MS);
    this.recentDisplayedSuggestions = this.recentDisplayedSuggestions.filter((item) => item.text !== text);
    this.recentDisplayedSuggestions.push({
      text,
      candidates,
      shownAt: now,
      expiresAt: now + windowMs,
    });

    this.pruneDisplayedSuggestions(now);
  }

  private pruneDisplayedSuggestions(now = Date.now()): void {
    this.recentDisplayedSuggestions = this.recentDisplayedSuggestions
      .filter((item) => item.expiresAt >= now)
      .slice(-MAX_DISPLAYED_SUGGESTIONS);
  }

  private readbackDisplayKey(text: string): string {
    return normalizeSuggestionEchoText(text).slice(0, 500);
  }

  private isReadbackContinuationEligible(displayText: string, sourceTranscript: string): boolean {
    const display = displayText.trim();
    if (!display || this.teleprompt.isActive()) return false;
    if (wordCountForEcho(display) < 6) return false;
    if (/[?？]\s*$/.test(display)) return false;

    const normalizedDisplay = normalizeSuggestionEchoText(display);
    const normalizedSource = normalizeSuggestionEchoText(sourceTranscript);
    if (!normalizedDisplay || !normalizedSource) return false;

    if (/^(sorry|could you repeat|what do you mean|nice to meet you|thank you|thanks|sure could you repeat|i am not sure|i'm not sure)/i.test(normalizedDisplay)) {
      return false;
    }

    const highRisk = /\b(id|passport|permit|sin|bank|insurance|lease|contract|payment|credit card|doctor|medicine|medication|legal|lawyer|police|border|immigration|non refundable|deposit|sign|signature|advisor|front desk|maintenance)\b/;
    if (highRisk.test(normalizedDisplay) || highRisk.test(normalizedSource)) {
      return false;
    }

    return true;
  }

  private trackReadbackEchoAndMaybeScheduleContinuation(
    echo: DisplayedSuggestionEcho,
    transcript: string,
    timestamp: number,
    options: { allowSchedule?: boolean } = {},
  ): void {
    const allowSchedule = options.allowSchedule ?? true;
    const context = this.lastDisplayedAnswerContext;
    if (!context || context.displayText !== echo.displayText) return;
    if (!this.isReadbackContinuationEligible(echo.displayText, context.sourceTranscript)) {
      this.cancelReadbackContinuation("readback_not_eligible");
      return;
    }
    if (Date.now() - this.lastContinuationAt < READBACK_CONTINUATION_COOLDOWN_MS) {
      this.onStatus?.({ type: "readback_continuation_skipped", reason: "cooldown" });
      return;
    }

    this.ensureReadbackContinuationPrefetch(context);

    const sourceTokens = new Set(echoTokens(echo.displayText));
    if (sourceTokens.size < 4) return;

    const key = this.readbackDisplayKey(echo.displayText);
    const seen = this.readbackTokenCoverageByDisplay.get(key) ?? new Set<string>();
    for (const token of echoTokens(transcript)) {
      if (sourceTokens.has(token)) {
        seen.add(token);
      }
    }
    this.readbackTokenCoverageByDisplay.set(key, seen);

    const aggregateCoverage = seen.size / sourceTokens.size;
    const completionCoverage = Math.max(
      aggregateCoverage,
      echo.match.suggestionCoverage,
      echo.match.similarity >= 0.9 ? 1 : 0,
    );
    const sourceTokenList = Array.from(sourceTokens);
    const tailTokenCount = Math.max(3, Math.ceil(sourceTokenList.length * 0.35));
    const tailTokens = sourceTokenList.slice(-tailTokenCount);
    const tailCoverage = tailTokens.length
      ? tailTokens.filter((token) => seen.has(token)).length / tailTokens.length
      : 0;
    const needsTailEvidence = wordCountForEcho(echo.displayText) >= 14;

    this.onStatus?.({
      type: "readback_progress",
      coverage: Number(completionCoverage.toFixed(3)),
      aggregateCoverage: Number(aggregateCoverage.toFixed(3)),
      tailCoverage: Number(tailCoverage.toFixed(3)),
      suggestionCoverage: Number(echo.match.suggestionCoverage.toFixed(3)),
      similarity: Number(echo.match.similarity.toFixed(3)),
    });

    if (
      completionCoverage < READBACK_CONTINUATION_MIN_COVERAGE
      || (needsTailEvidence && tailCoverage < 0.5)
    ) {
      this.cancelReadbackContinuation("readback_incomplete");
      return;
    }

    if (allowSchedule) {
      this.scheduleReadbackContinuation(echo.displayText, timestamp);
    }
  }

  private ensureReadbackContinuationPrefetch(context: LastDisplayedAnswerContext): void {
    const key = this.readbackDisplayKey(context.displayText);
    if (this.readbackContinuationPrefetch?.key === key) return;

    const promise = generateOptionalContinuation({
      conversation: context.context,
      eventMemory: context.eventSnapshot,
      outputLanguage: this.outputLanguage,
      activePrenoteContext: context.activePrenoteContext,
      activeSceneProfilePrompt: context.activeSceneProfilePrompt,
      relevantPersonalMemoryContext: context.relevantPersonalMemoryContext,
      displayedAnswer: context.displayText,
      sourceTranscript: context.sourceTranscript,
    });

    this.readbackContinuationPrefetch = { key, promise };
    this.onStatus?.({ type: "readback_continuation_prefetch_started" });

    promise
      .then((continuation) => {
        if (this.readbackContinuationPrefetch?.key !== key) return;
        this.onStatus?.({
          type: continuation ? "readback_continuation_prefetch_ready" : "readback_continuation_prefetch_declined",
        });
      })
      .catch(() => {
        if (this.readbackContinuationPrefetch?.key === key) {
          this.onStatus?.({ type: "readback_continuation_prefetch_failed" });
        }
      });
  }

  private scheduleReadbackContinuation(displayText: string, timestamp: number): void {
    if (this.readbackContinuationTimer) {
      clearTimeout(this.readbackContinuationTimer);
      this.readbackContinuationTimer = null;
    }

    const seq = ++this.readbackContinuationSeq;
    this.readbackContinuationTimer = setTimeout(() => {
      this.readbackContinuationTimer = null;
      void this.runReadbackContinuation(seq, displayText, timestamp);
    }, READBACK_CONTINUATION_SILENCE_MS);

    this.onStatus?.({
      type: "readback_continuation_scheduled",
      delayMs: READBACK_CONTINUATION_SILENCE_MS,
    });
  }

  private cancelReadbackContinuation(reason: string): void {
    this.readbackContinuationSeq++;
    if (this.readbackContinuationTimer) {
      clearTimeout(this.readbackContinuationTimer);
      this.readbackContinuationTimer = null;
      this.onStatus?.({ type: "readback_continuation_cancelled", reason });
    }
    if ([
      "new_transcript",
      "new_display",
      "clear_conversation",
      "runtime_reset",
      "manual_pause",
      "manual_resume",
      "close",
    ].includes(reason)) {
      this.readbackContinuationPrefetch = null;
    }
  }

  private async runReadbackContinuation(seq: number, displayText: string, timestamp: number): Promise<void> {
    if (seq !== this.readbackContinuationSeq) return;
    if (this.isPausedForReading || this.teleprompt.isActive()) return;
    if (Date.now() - this.lastContinuationAt < READBACK_CONTINUATION_COOLDOWN_MS) return;
    if (!this.isDisplaying || this.currentDisplayText !== displayText) {
      this.onStatus?.({ type: "readback_continuation_skipped", reason: "display_changed" });
      return;
    }

    const context = this.lastDisplayedAnswerContext;
    if (!context || context.displayText !== displayText) {
      this.onStatus?.({ type: "readback_continuation_skipped", reason: "missing_context" });
      return;
    }

    this.onStatus?.({ type: "readback_continuation_generating" });
    const key = this.readbackDisplayKey(displayText);
    const prefetch = this.readbackContinuationPrefetch?.key === key
      ? this.readbackContinuationPrefetch
      : null;
    const continuation = prefetch
      ? await prefetch.promise
      : await generateOptionalContinuation({
        conversation: context.context,
        eventMemory: context.eventSnapshot,
        outputLanguage: this.outputLanguage,
        activePrenoteContext: context.activePrenoteContext,
        activeSceneProfilePrompt: context.activeSceneProfilePrompt,
        relevantPersonalMemoryContext: context.relevantPersonalMemoryContext,
        displayedAnswer: context.displayText,
        sourceTranscript: context.sourceTranscript,
      });
    if (prefetch && this.readbackContinuationPrefetch?.key === key) {
      this.readbackContinuationPrefetch = null;
    }

    if (seq !== this.readbackContinuationSeq) return;
    if (!continuation) {
      this.onStatus?.({ type: "readback_continuation_skipped", reason: "model_declined" });
      return;
    }

    if (this.recentInsightCache.length > 0) {
      const { bestMatch } = findBestMatch(continuation, this.recentInsightCache);
      if (bestMatch.rating > SIMILARITY_THRESHOLD) {
        this.onStatus?.({ type: "readback_continuation_skipped", reason: "duplicate" });
        return;
      }
    }

    if (!this.isDisplaying || this.currentDisplayText !== displayText) {
      this.onStatus?.({ type: "readback_continuation_skipped", reason: "display_changed_after_model" });
      return;
    }

    const response = this.createReadbackContinuationInsight(continuation, Date.now());
    this.conversation.push(response);
    this.eventMemory.addResponse(response);
    this.lastContinuationAt = Date.now();
    this.tryShowInsight(response.output, INSIGHT_DISPLAY_DURATION_MS, {}, response);
    this.onStatus?.({ type: "readback_continuation_shown", sourceTimestamp: timestamp });
    this.trimConversationHistory();
  }

  private getRecentDisplayedSuggestionEcho(text: string, timestamp: number): DisplayedSuggestionEcho | null {
    this.pruneDisplayedSuggestions(timestamp);
    if (!this.recentDisplayedSuggestions.length) return null;

    let best: DisplayedSuggestionEcho | null = null;
    for (const item of this.recentDisplayedSuggestions) {
      const match = detectSuggestionEcho(text, item.candidates);
      if (!match.matched) continue;

      const score = match.similarity + match.transcriptCoverage + match.suggestionCoverage;
      const bestScore = best
        ? best.match.similarity + best.match.transcriptCoverage + best.match.suggestionCoverage
        : -1;
      if (score > bestScore) {
        best = { displayText: item.text, match };
      }
    }

    if (!best) return null;

    this.session.logger.info(
      `Suggestion echo detected similarity=${best.match.similarity.toFixed(2)} transcriptCoverage=${best.match.transcriptCoverage.toFixed(2)} suggestionCoverage=${best.match.suggestionCoverage.toFixed(2)} candidate="${best.match.candidate}"`,
    );
    return best;
  }

  private refreshDisplayedSuggestionEcho(displayText: string): void {
    const text = displayText.trim();
    if (!text) return;

    const sameActiveDisplay = this.isDisplaying && this.currentDisplayText === text;
    const remainingMs = this.currentDisplayExpiresAt - Date.now();

    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }

    this.isDisplaying = true;
    this.currentDisplayText = text;
    this.lastInsightText = text;
    this.rememberDisplayedSuggestion(text, SUGGESTION_ECHO_REFRESH_MS);
    if (sameActiveDisplay && remainingMs > SUGGESTION_ECHO_REDRAW_THRESHOLD_MS) {
      this.startDisplayReleaseTimer(remainingMs);
      this.onStatus?.({ type: "display_extended", reason: "suggestion_echo", remainingMs });
      this.session.logger.info(`Kept displayed suggestion without redraw after self-read echo; remaining=${Math.round(remainingMs)}ms`);
      return;
    }

    this.currentDisplayExpiresAt = Date.now() + SUGGESTION_ECHO_REFRESH_MS;
    this.session.layouts.showTextWall(text, { durationMs: SUGGESTION_ECHO_REFRESH_MS });
    this.startDisplayReleaseTimer(SUGGESTION_ECHO_REFRESH_MS);
    this.onStatus?.({ type: "display_refreshed", reason: "suggestion_echo" });
    this.session.logger.info(`Refreshed displayed suggestion after self-read echo for ${SUGGESTION_ECHO_REFRESH_MS}ms`);
  }
}
