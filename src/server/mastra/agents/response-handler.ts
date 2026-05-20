import { AppSession } from '@mentra/sdk';
import { Action, AgentType, type AgentResponse, type AgentInsight, type Conversation, type AgentRoute } from "../types";
import { generateOptionalContinuation, generateTelepromptScript, processConversation, type OutputLanguage } from "./initial-agent";
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
  ) {
    this.session = session;
    this.userId = userId;
    this.sessionId = `${userId}-${Date.now()}`;
    this.locationManager = locationManager;
    this.conversation = [];
    this.openAiConversationSession = new OpenAiConversationSession({ userId, sessionId: this.sessionId });
    if (isOpenAiConversationStateEnabled(process.env.LLM_PROVIDER || "openai")) {
      this.openAiConversationSession.warmup(Number(process.env.OPENAI_CONVERSATION_WARMUP_TIMEOUT_MS || 8000))
        .then((conversationId) => this.session.logger.info(`OpenAI conversation state warmed up: ${conversationId}`))
        .catch((error) => this.session.logger.warn(`OpenAI conversation warmup skipped: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.eventMemory = new EventMemoryManager(userId, this.sessionId);
    this.frequency = initialFrequency;
    this.outputLanguage = initialOutputLanguage;
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

    if (this.isPausedForReading) {
      this.session.logger.info(`Manual pause active, ignoring transcript: "${text}"`);
      this.onStatus?.({ type: "processing_done", reason: "paused" });
      return;
    }

    const suggestionEcho = !this.teleprompt.isActive()
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
    const eventSnapshot = this.eventMemory.addTranscript(text, timestamp);
    this.resetEventIdleTimer();

    // Add the transcript to conversation
    this.conversation.push({
      type: 'transcript',
      text,
      timestamp
    });

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
    const relevantPersonalMemoryContext = conversationLogger.getRelevantPersonalMemoryContext(this.userId, memoryQuery, 3);

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
    if (this.isPausedForReading || this.teleprompt.isActive()) return false;

    const suggestionEcho = this.getRecentDisplayedSuggestionEcho(text, timestamp);
    if (!suggestionEcho) return false;

    this.trackReadbackEchoAndMaybeScheduleContinuation(suggestionEcho, text, timestamp, {
      allowSchedule: false,
    });
    this.onStatus?.({ type: "readback_partial_echo" });
    return true;
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

  isTelepromptActive(): boolean {
    return this.teleprompt.isActive();
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
    this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
    this.session.logger.info("Current SayNext runtime state reset");
  }

  close(): void {
    this.cancelReadbackContinuation("close");
    this.teleprompt.cancel();
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
