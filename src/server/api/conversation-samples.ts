import type { Context } from "hono";
import { z } from "zod";
import { conversationLogger } from "../data/conversation-logger";

const updateSampleSchema = z.object({
  natural: z.number().int().min(1).max(5).nullable().optional(),
  short: z.number().int().min(1).max(5).nullable().optional(),
  fitsXiang: z.number().int().min(1).max(5).nullable().optional(),
  tooOfficial: z.boolean().nullable().optional(),
  directlySayable: z.boolean().nullable().optional(),
  inventedInfo: z.boolean().nullable().optional(),
  idealReply: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
});

export const listConversationSamples = (c: Context) => {
  const userId = c.req.query("userId");
  const limit = Number(c.req.query("limit") || 50);

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  return c.json({
    enabled: conversationLogger.isEnabled(),
    samples: conversationLogger.listSamples(userId, limit),
  });
};

export const updateConversationSample = async (c: Context) => {
  const id = Number(c.req.param("id"));

  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "valid sample id is required" }, 400);
  }

  const parsed = updateSampleSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "invalid rating payload", issues: parsed.error.issues }, 400);
  }

  const sample = conversationLogger.updateSample(id, parsed.data);
  if (!sample) {
    return c.json({ error: "sample not found or logging disabled" }, 404);
  }

  return c.json({ sample });
};

export const listConversationEvents = (c: Context) => {
  const userId = c.req.query("userId");
  const limit = Number(c.req.query("limit") || 50);

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  return c.json({
    enabled: conversationLogger.isEnabled(),
    events: conversationLogger.listEvents(userId, limit),
  });
};
