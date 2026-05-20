import type { Context } from "hono";
import { Action, type Conversation } from "../mastra/types";
import { processConversation, type OutputLanguage } from "../mastra/agents/initial-agent";
import { conversationLogger } from "../data/conversation-logger";
import { buildContextSignals } from "../saynext/context-signals";
import { getImmediateDecision } from "../saynext/immediate-rules";

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

    if (!transcript) {
      return c.json({ error: "transcript is required" }, 400);
    }

    const transcripts = [...previousTranscriptTexts, transcript].filter(Boolean);
    const conversation: Conversation = transcripts.map((text, index) => ({
      type: "transcript",
      text,
      timestamp: timestamp - (transcripts.length - index) * 1000,
    }));

    const relevantPersonalMemoryContext =
      typeof body.relevantPersonalMemoryContext === "string"
        ? body.relevantPersonalMemoryContext
        : conversationLogger.getRelevantPersonalMemoryContext(userId, transcripts.slice(-4).join("\n"), 4);

    const immediateDecision = getImmediateDecision(transcript, timestamp, outputLanguage, {
      previousTranscriptTexts,
      hasPriorTranscript: previousTranscriptTexts.length > 0,
    });
    const signals = buildContextSignals({ latestTranscript: transcript, previousTranscriptTexts });

    const response = await processConversation(
      conversation,
      frequency,
      undefined,
      outputLanguage,
      String(body.activePrenoteContext || ""),
      String(body.activeSceneProfilePrompt || ""),
      relevantPersonalMemoryContext,
    );

    const processTrace = response.type === Action.INSIGHT
      ? (response.metadata?.agentInput as any)?.processTrace
      : undefined;

    return c.json({
      userId,
      transcript,
      previousTranscriptTexts,
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
