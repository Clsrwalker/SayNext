import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";
import type { ManualActionResult } from "../mastra/agents";

type ManualBody = {
  userId?: string;
  sessionId?: string;
  clientEventId?: string;
  direction?: string;
};

async function readBody(c: Context): Promise<ManualBody> {
  return c.req.json().catch(() => ({}));
}

function getUserId(c: Context, body: ManualBody): string | null {
  const value = body.userId || c.req.query("userId");
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeClientEventId(body: ManualBody): string | undefined {
  return typeof body.clientEventId === "string" && body.clientEventId.trim()
    ? body.clientEventId.trim()
    : undefined;
}

function getSessionId(c: Context, body: ManualBody): string | undefined {
  const value = body.sessionId || c.req.query("sessionId");
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validateSessionId(user: ReturnType<typeof sessions.get>, sessionId?: string): string | null {
  if (!sessionId) return null;
  const current = user?.getRuntimeSessionId();
  if (!current) return "No active runtime session";
  if (current !== sessionId) return "Stale runtime session";
  return null;
}

function inactiveResult(userId: string): ManualActionResult {
  return {
    status: "error",
    sessionId: "",
    state: {
      mode: process.env.SAYNEXT_INTERACTION_MODE === "g1_auto" ? "g1_auto" : "g2_manual",
      sessionId: "",
      transcriptCount: 0,
      lastGeneratedCursor: null,
      pending: null,
      currentAnswer: null,
      stateVersion: 0,
    },
    error: `No active user session for ${userId}`,
  };
}

function statusFor(result: ManualActionResult): 200 | 409 | 404 {
  if (result.status === "busy") return 409;
  if (result.status === "error" && !result.sessionId) return 404;
  return 200;
}

export const getManualState = async (c: Context) => {
  const body = await readBody(c);
  const userId = getUserId(c, body);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) {
    return c.json({
      userId,
      active: false,
      state: inactiveResult(userId).state,
    }, 404);
  }

  return c.json({
    userId,
    active: Boolean(user.appSession),
    sessionId: user.getRuntimeSessionId(),
    interactionMode: user.getInteractionMode(),
    state: user.getManualState(),
  });
};

export const generateManual = async (c: Context) => {
  const body = await readBody(c);
  const userId = getUserId(c, body);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) {
    const result = inactiveResult(userId);
    return c.json(result, statusFor(result));
  }

  const sessionError = validateSessionId(user, getSessionId(c, body));
  if (sessionError) return c.json({ error: sessionError }, 409);

  const result = await user.generateManualAnswer(normalizeClientEventId(body));
  return c.json(result, statusFor(result));
};

export const regenerateManual = async (c: Context) => {
  const body = await readBody(c);
  const userId = getUserId(c, body);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) {
    const result = inactiveResult(userId);
    return c.json(result, statusFor(result));
  }

  const sessionError = validateSessionId(user, getSessionId(c, body));
  if (sessionError) return c.json({ error: sessionError }, 409);

  const result = await user.regenerateManualAnswer(normalizeClientEventId(body));
  return c.json(result, statusFor(result));
};

export const pageManual = async (c: Context) => {
  const body = await readBody(c);
  const userId = getUserId(c, body);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) {
    const result = inactiveResult(userId);
    return c.json(result, statusFor(result));
  }

  const sessionError = validateSessionId(user, getSessionId(c, body));
  if (sessionError) return c.json({ error: sessionError }, 409);

  const rawDirection = String(body.direction || c.req.query("direction") || "next").toLowerCase();
  const direction = rawDirection.includes("prev") || rawDirection.includes("up")
    ? "previous"
    : "next";
  const result = user.pageManualAnswer(direction, normalizeClientEventId(body));
  return c.json(result, statusFor(result));
};

export const clearManual = async (c: Context) => {
  const body = await readBody(c);
  const userId = getUserId(c, body);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) {
    const result = inactiveResult(userId);
    return c.json(result, statusFor(result));
  }

  const sessionError = validateSessionId(user, getSessionId(c, body));
  if (sessionError) return c.json({ error: sessionError }, 409);

  const result = user.clearManualAnswer(normalizeClientEventId(body));
  return c.json(result, statusFor(result));
};
