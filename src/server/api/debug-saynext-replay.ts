import type { Context } from "hono";
import { Action, type Conversation } from "../mastra/types";
import { processConversation, type OutputLanguage } from "../mastra/agents/initial-agent";
import { OpenAiConversationSession } from "../mastra/agents/openai-conversation-state";
import { conversationLogger } from "../data/conversation-logger";
import { EventMemoryManager } from "../memory/event-memory";
import { buildContextSignals } from "../saynext/context-signals";
import { getImmediateDecision } from "../saynext/immediate-rules";

const replayConversationSessions = new Map<string, OpenAiConversationSession>();

function isReplayApiEnabled(): boolean {
  return process.env.SAYNEXT_REPLAY_API_ENABLED === "true";
}

function asTranscriptTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(-8);
}

function asOutputLanguage(value: unknown): OutputLanguage {
  return value === "chinese" ? "chinese" : "english";
}

/**
 * POST /api/debug/saynext-replay
 *
 * Local replay/testing endpoint. It intentionally requires
 * SAYNEXT_REPLAY_API_ENABLED=true so production does not expose a transcript
 * generation endpoint outside the normal Mentra session flow.
 */
export const replaySayNextApi = async (c: Context) => {
  if (!isReplayApiEnabled()) {
    return c.json({ error: "Replay API is disabled" }, 404);
  }

  try {
    const body = await c.req.json();
    const userId = String(body.userId || "li2897283405@gmail.com");
    const transcript = String(body.transcript || "").trim();
    const previousTranscriptTexts = asTranscriptTexts(body.previousTranscriptTexts);
    const outputLanguage = asOutputLanguage(body.outputLanguage);
    const frequency = body.frequency === "low" || body.frequency === "medium" ? body.frequency : "high";
    const timestamp = Number(body.timestamp || Date.now());
    const sessionId = String(body.sessionId || `debug-replay-${timestamp}`);
    const useOpenAiConversationState = body.useOpenAiConversationState === true
      || body.useOpenAiConversationState === "true";

    if (!transcript) {
      return c.json({ error: "transcript is required" }, 400);
    }

    const transcripts = [...previousTranscriptTexts, transcript].filter(Boolean);
    const conversation: Conversation = transcripts.map((text, index) => ({
      type: "transcript",
      text,
      timestamp: timestamp - (transcripts.length - index) * 1000,
    }));
    const replayEventMemory = new EventMemoryManager(userId, sessionId, false);
    let eventSnapshot = replayEventMemory.getSnapshot();
    for (const item of conversation) {
      if (item.type === "transcript") {
        eventSnapshot = replayEventMemory.addTranscript(item.text, item.timestamp);
      }
    }

    const relevantPersonalMemoryContext =
      typeof body.relevantPersonalMemoryContext === "string"
        ? body.relevantPersonalMemoryContext
        : await conversationLogger.getRelevantPersonalMemoryContextAsync(userId, transcripts.slice(-4).join("\n"), 4);

    const immediateDecision = getImmediateDecision(transcript, timestamp, outputLanguage, {
      previousTranscriptTexts,
      hasPriorTranscript: previousTranscriptTexts.length > 0,
    });
    const signals = buildContextSignals({ latestTranscript: transcript, previousTranscriptTexts });
    const openAiConversationSession = useOpenAiConversationState
      ? (() => {
        const key = `${userId}:${sessionId}`;
        const existing = replayConversationSessions.get(key);
        if (existing) return existing;
        const created = new OpenAiConversationSession({ userId, sessionId });
        replayConversationSessions.set(key, created);
        return created;
      })()
      : undefined;

    const response = await processConversation(
      conversation,
      frequency,
      eventSnapshot,
      outputLanguage,
      String(body.activePrenoteContext || ""),
      String(body.activeSceneProfilePrompt || ""),
      relevantPersonalMemoryContext,
      openAiConversationSession
        ? {
          openAiConversationSession,
          transcriptCommitReason: "final",
        }
        : {},
    );

    const processTrace = response.type === Action.INSIGHT
      ? (response.metadata?.agentInput as any)?.processTrace
      : undefined;

    return c.json({
      userId,
      transcript,
      previousTranscriptTexts,
      sessionId,
      useOpenAiConversationState,
      openAiConversationId: openAiConversationSession?.id || undefined,
      response: {
        type: response.type,
        reasoning: response.reasoning,
        output: response.type === Action.INSIGHT ? response.output : "",
        confidence: response.type === Action.INSIGHT ? response.confidence : undefined,
      },
      routeHints: immediateDecision.routeHints,
      signals,
      processTrace,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : "Replay failed",
    }, 500);
  }
};
