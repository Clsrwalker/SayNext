import type { Context } from "hono";
import { conversationLogger } from "../data/conversation-logger";
import { runPersonalizationPipeline, sampleToPipelineInput, type PipelineRunInput } from "../personalization/pipeline";

function shouldForce(c: Context): boolean {
  return c.req.query("force") === "true";
}

async function processPipelineInput(input: PipelineRunInput) {
  try {
    const pipeline = await runPersonalizationPipeline(input);
    const result = pipeline.result;

    const run = conversationLogger.upsertPipelineRun({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      userId: input.userId,
      status: "processed",
      model: pipeline.model,
      rawTranscript: input.rawTranscript,
      rawOutput: input.rawOutput ?? null,
      cleanedTranscript: result.cleanedTranscript,
      cleanedOutput: result.cleanedOutput,
      segmentsJson: JSON.stringify(result.segments),
      contextJson: JSON.stringify(result.context),
      eventJson: JSON.stringify(result.event),
      outputIntentJson: JSON.stringify(result.outputIntent),
      qualityJson: JSON.stringify(result.quality),
      pseudoLabel: result.pseudoLabel.idealReply,
      reviewPriority: result.review.priority,
      needsReview: result.review.needsXiangReview,
      memoryJson: JSON.stringify(result.memory),
    });

    let memoryItem = null;
    if (run && result.memory.shouldAddToPersonalMemory && result.memory.content && result.memory.memoryType !== "none") {
      memoryItem = conversationLogger.createPersonalMemoryItem({
        userId: input.userId,
        sourceRunId: run.id,
        memoryType: result.memory.memoryType,
        content: result.memory.content,
        tags: result.memory.tags,
        confidence: result.memory.confidence,
      });
    }

    return { run, result, memoryItem };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const run = conversationLogger.upsertPipelineRun({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      userId: input.userId,
      status: "failed",
      rawTranscript: input.rawTranscript,
      rawOutput: input.rawOutput ?? null,
      error: message,
    });

    throw Object.assign(new Error(message), { run });
  }
}

export const processConversationSampleForPersonalization = async (c: Context) => {
  const id = Number(c.req.param("id"));

  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "valid sample id is required" }, 400);
  }

  const existing = conversationLogger.getPipelineRunBySource("sample", String(id));
  if (existing && !shouldForce(c)) {
    return c.json({ enabled: conversationLogger.isEnabled(), run: existing, cached: true });
  }

  const sample = conversationLogger.getSample(id);
  if (!sample) {
    return c.json({ error: "sample not found or logging disabled" }, 404);
  }

  try {
    const processed = await processPipelineInput(sampleToPipelineInput(sample));
    return c.json({ enabled: conversationLogger.isEnabled(), ...processed, cached: false });
  } catch (error) {
    return c.json({
      error: "personalization pipeline failed",
      message: error instanceof Error ? error.message : String(error),
      run: (error as any)?.run ?? null,
    }, 500);
  }
};

export const processConversationEventForPersonalization = async (c: Context) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "event id is required" }, 400);
  }

  const existing = conversationLogger.getPipelineRunBySource("event", id);
  if (existing && !shouldForce(c)) {
    return c.json({ enabled: conversationLogger.isEnabled(), run: existing, cached: true });
  }

  const event = conversationLogger.getEvent(id);
  if (!event) {
    return c.json({ error: "event not found or logging disabled" }, 404);
  }

  try {
    const processed = await processPipelineInput({
      sourceType: "event",
      sourceId: event.id,
      userId: event.userId,
      rawTranscript: event.rawTranscript,
      rawOutput: null,
      timestamp: event.lastTimestamp,
    });
    return c.json({ enabled: conversationLogger.isEnabled(), ...processed, cached: false });
  } catch (error) {
    return c.json({
      error: "personalization pipeline failed",
      message: error instanceof Error ? error.message : String(error),
      run: (error as any)?.run ?? null,
    }, 500);
  }
};

export const listPersonalizationPipelineRuns = (c: Context) => {
  const userId = c.req.query("userId");
  const limit = Number(c.req.query("limit") || 50);

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  return c.json({
    enabled: conversationLogger.isEnabled(),
    runs: conversationLogger.listPipelineRuns(userId, limit),
  });
};

export const listPersonalMemoryItems = (c: Context) => {
  const userId = c.req.query("userId");
  const limit = Number(c.req.query("limit") || 50);

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  return c.json({
    enabled: conversationLogger.isEnabled(),
    memories: conversationLogger.listPersonalMemoryItems(userId, limit),
  });
};
