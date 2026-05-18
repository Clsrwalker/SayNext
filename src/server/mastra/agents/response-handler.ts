import { AppSession } from '@mentra/sdk';
import { Action, AgentType, type AgentResponse, type AgentInsight, type Conversation, type AgentRoute } from "../types";
import { generateTelepromptScript, processConversation, type OutputLanguage } from "./initial-agent";
import { routeToSpecialist } from "./specialist-agents";
import { INSIGHTS_HISTORY_LENGTH, TRANSCRIPT_HISTORY_LENGTH, INSIGHT_CACHE_SIZE, SIMILARITY_THRESHOLD, INSIGHT_DISPLAY_DURATION_MS, MANUAL_PAUSE_DISPLAY_DURATION_MS, TELEPROMPT_DISPLAY_DURATION_MS } from '../../config';
import { findBestMatch } from 'string-similarity';
import { LocationManager } from '../../manager/LocationManager';
import { conversationLogger } from '../../data/conversation-logger';
import { EventMemoryManager, type EventMemorySnapshot } from '../../memory/event-memory';
import { makeTelepromptOpeningLine, shouldStartTeleprompt, TelepromptRuntime, type TelepromptDisplay } from '../../teleprompt/teleprompt-runtime';

const EVENT_IDLE_CLOSE_MS = 8 * 60 * 1000;
const SUGGESTION_ECHO_WINDOW_MS = 45 * 1000;
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

function echoTokens(text: string): string[] {
  return normalizeSuggestionEchoText(text)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !SUGGESTION_ECHO_STOP_WORDS.has(token));
}

function wordCountForEcho(text: string): number {
  return normalizeSuggestionEchoText(text).split(/\s+/).filter(Boolean).length;
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
  return (
    /\b(hold on|wait|stop there|sorry to interrupt|before you continue|quick question|another question|next question|move on|switch topic|different topic)\b/.test(normalized)
    || /\b(can you|could you|would you|do you|did you|does that|does it|does this|is it|is that|are you|have you|has it|what about|how about|tell me|describe this|describe that|explain this|explain that)\b/.test(normalized)
    || /\bwhat\s+(?:class|tech stack|stack|game|project|model|course|happens|do you|did you|would you|is it|is that|are you|was|is|are|kind of|type of)\b/.test(normalized)
    || /\bwhy\s+(?:not|did|do|does|is|are|would|should)\b/.test(normalized)
    || /\bhow\s+(?:long|did|do|does|would|can|could|is|are)\b/.test(normalized)
    || /\bhow\s+(?:much|many)\s+(?:does|did|do|is|are|was|were|would|can|could)\b/.test(normalized)
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
    const strongWholeEcho = similarity >= 0.86 || (transcriptCoverage >= 0.88 && candidateCoverage >= 0.65);
    const matched = freshQuestionOrInterruption ? strongWholeEcho : normalEchoMatch;

    if (similarity + transcriptCoverage + candidateCoverage > best.similarity + best.transcriptCoverage + best.suggestionCoverage) {
      best = { matched, similarity, transcriptCoverage, suggestionCoverage: candidateCoverage, candidate };
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
  private eventMemory: EventMemoryManager;
  private eventIdleTimer: NodeJS.Timeout | null = null;
  private isDisplaying: boolean = false;
  private displayTimer: NodeJS.Timeout | null = null;
  private pausedDisplayRefreshTimer: NodeJS.Timeout | null = null;
  private currentDisplayText: string | null = null;
  private lastInsightText: string | null = null;
  private isPausedForReading: boolean = false;
  private processingSeq: number = 0;
  private recentInsightCache: string[] = [];
  private recentDisplayedSuggestions: DisplayedSuggestion[] = [];
  private teleprompt: TelepromptRuntime = new TelepromptRuntime();
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
    this.eventMemory = new EventMemoryManager(userId, this.sessionId);
    this.frequency = initialFrequency;
    this.outputLanguage = initialOutputLanguage;
  }

  /**
   * Process a new transcript and update the conversation
   */
  async processTranscript(text: string, timestamp: number): Promise<void> {
    if (this.isPausedForReading) {
      this.session.logger.info(`Manual pause active, ignoring transcript: "${text}"`);
      this.onStatus?.({ type: "processing_done", reason: "paused" });
      return;
    }

    if (!this.teleprompt.isActive() && this.isRecentDisplayedSuggestionEcho(text, timestamp)) {
      this.session.logger.info(`Ignoring self-read suggestion echo: "${text}"`);
      this.onStatus?.({ type: "processing_done", reason: "suggestion_echo" });
      return;
    }

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
      ? this.teleprompt.handleTranscript(text, timestamp)
      : null;

    if (telepromptResult) {
      if (telepromptResult.action === "advance" || telepromptResult.action === "finish") {
        this.showTelepromptDisplay(telepromptResult.display);
        this.onStatus?.({ type: "processing_done", reason: `teleprompt_${telepromptResult.action}` });
        this.trimConversationHistory();
        return;
      }

      if (telepromptResult.action === "hold" && telepromptResult.consumed) {
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

    const activePrenoteContext = conversationLogger.getActivePrenoteRuntimeContext(this.userId);
    const activeSceneProfilePrompt = conversationLogger.getActiveSceneProfilePrompt(this.userId);
    const memoryQuery = eventSnapshot.recentTranscripts.slice(-4).join("\n") || text;
    const relevantPersonalMemoryContext = conversationLogger.getRelevantPersonalMemoryContext(this.userId, memoryQuery, 3);

    const telepromptNeed = shouldStartTeleprompt(text, `${eventSnapshot.scene} ${activeSceneProfilePrompt}`);
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
    );

    if (requestSeq !== this.processingSeq) {
      this.session.logger.info(`Dropping stale AI response for older transcript: "${text}"`);
      this.onStatus?.({ type: "processing_done", reason: "stale_response" });
      return;
    }

    // Add the response to conversation history
    this.conversation.push(response);
    this.eventMemory.addResponse(response);
    this.logConversationSample(text, timestamp, response);

    // Handle the response based on action type
    await this.handleAgentResponse(response);
    this.onStatus?.({ type: "processing_done", reason: response.type });
    this.session.logger.info({conversation: this.conversation}, `Conversation`);

    // Trim conversation history if it gets too long
    this.trimConversationHistory();
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

  private showTelepromptDisplay(display: TelepromptDisplay, agentResponse?: AgentInsight): void {
    this.tryShowInsight(display.text, TELEPROMPT_DISPLAY_DURATION_MS, { skipCache: true }, agentResponse);
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
    options: { skipCache?: boolean } = {},
    agentResponse?: AgentInsight
  ): void {
    if (this.isDisplaying) {
      this.session.logger.info(`Replacing displayed suggestion with: "${output}"`);
      if (this.displayTimer) {
        clearTimeout(this.displayTimer);
        this.displayTimer = null;
      }
      this.isDisplaying = false;
      this.currentDisplayText = null;
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
    this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
    this.session.logger.info("Automatic response mode enabled");
  }

  getManualPauseState(): boolean {
    return this.isPausedForReading;
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
    this.eventMemory.closeActiveEvent();
    if (this.eventIdleTimer) {
      clearTimeout(this.eventIdleTimer);
      this.eventIdleTimer = null;
    }
    this.conversation = [];
  }

  resetRuntimeState(): void {
    this.processingSeq++;
    this.teleprompt.cancel();
    this.conversation = [];
    this.recentInsightCache = [];
    this.recentDisplayedSuggestions = [];
    this.lastInsightText = null;
    this.currentDisplayText = null;
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

    this.onStatus?.({ type: "processing_done", reason: "manual_reset" });
    this.session.layouts.showTextWall("SayNext is listening.", { durationMs: 1500 });
    this.session.logger.info("Current SayNext runtime state reset");
  }

  close(): void {
    this.teleprompt.cancel();
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

  private isRecentDisplayedSuggestionEcho(text: string, timestamp: number): boolean {
    this.pruneDisplayedSuggestions(timestamp);
    if (!this.recentDisplayedSuggestions.length) return false;

    const candidates = this.recentDisplayedSuggestions.flatMap((item) => item.candidates);
    const match = detectSuggestionEcho(text, candidates);
    if (!match.matched) return false;

    this.session.logger.info(
      `Suggestion echo detected similarity=${match.similarity.toFixed(2)} transcriptCoverage=${match.transcriptCoverage.toFixed(2)} suggestionCoverage=${match.suggestionCoverage.toFixed(2)} candidate="${match.candidate}"`,
    );
    return true;
  }
}
