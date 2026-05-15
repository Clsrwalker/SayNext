import { AppSession } from '@mentra/sdk';
import { Action, AgentType, type AgentResponse, type AgentInsight, type Conversation, type AgentRoute } from "../types";
import { processConversation } from "./initial-agent";
import { routeToSpecialist } from "./specialist-agents";
import { INSIGHTS_HISTORY_LENGTH, TRANSCRIPT_HISTORY_LENGTH, INSIGHT_CACHE_SIZE, SIMILARITY_THRESHOLD, INSIGHT_DISPLAY_DURATION_MS, MANUAL_PAUSE_DISPLAY_DURATION_MS } from '../../config';
import { findBestMatch } from 'string-similarity';
import { LocationManager } from '../../manager/LocationManager';
import { conversationLogger } from '../../data/conversation-logger';
import { EventMemoryManager } from '../../memory/event-memory';

const EVENT_IDLE_CLOSE_MS = 8 * 60 * 1000;

export class MergeResponseHandler {
  private session: AppSession;
  private userId: string;
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
  public frequency: 'low' | 'medium' | 'high';

  // Callback for when an insight is generated (for webview SSE broadcasting)
  public onInsight?: (insight: { text: string; timestamp: number; agentType: string; reasoning: string }) => void;
  public onStatus?: (event: { type: string; [key: string]: unknown }) => void;

  constructor(session: AppSession, userId: string, locationManager: LocationManager, initialFrequency: 'low' | 'medium' | 'high' = 'high') {
    this.session = session;
    this.userId = userId;
    this.locationManager = locationManager;
    this.conversation = [];
    this.eventMemory = new EventMemoryManager(userId);
    this.frequency = initialFrequency;
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

    const requestSeq = ++this.processingSeq;
    const eventSnapshot = this.eventMemory.addTranscript(text, timestamp);
    this.resetEventIdleTimer();

    // Add the transcript to conversation
    this.conversation.push({
      type: 'transcript',
      text,
      timestamp
    });

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

    // Get Initial Agent's decision, passing the current frequency
    const response = await processConversation(context, this.frequency, eventSnapshot);

    if (requestSeq !== this.processingSeq && this.currentDisplayText) {
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
    this.session.logger.info({conversation: this.conversation}, `Conversation`);

    // Trim conversation history if it gets too long
    if (this.conversation.length > (TRANSCRIPT_HISTORY_LENGTH + INSIGHTS_HISTORY_LENGTH)) {
      this.conversation = this.conversation.slice(-(TRANSCRIPT_HISTORY_LENGTH + INSIGHTS_HISTORY_LENGTH));
    }
  }

  private logConversationSample(text: string, timestamp: number, response: AgentResponse): void {
    try {
      const metadata = response.type === Action.INSIGHT ? response.metadata?.agentInput : undefined;
      conversationLogger.createSample({
        userId: this.userId,
        sessionId: `${this.userId}-${Math.floor(timestamp / 1000)}`,
        timestamp,
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

  close(): void {
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
}
