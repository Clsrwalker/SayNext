import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";

export const resetCurrentSession = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const userId = body.userId || c.req.query("userId");

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const user = sessions.get(userId);
    user?.resetCurrentSession();

    return c.json({
      ok: true,
      userId,
      active: Boolean(user?.appSession),
    });
  } catch (error) {
    console.error("[session.reset] Failed to reset current session:", error);
    return c.json({ error: "Failed to reset current session" }, 500);
  }
};

export const advanceTeleprompt = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const userId = body.userId || c.req.query("userId");

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const user = sessions.get(userId);
    const advanced = user?.advanceTeleprompt() || false;

    return c.json({
      ok: true,
      userId,
      active: Boolean(user?.appSession),
      advanced,
    });
  } catch (error) {
    console.error("[teleprompt.next] Failed to advance teleprompt:", error);
    return c.json({ error: "Failed to advance teleprompt" }, 500);
  }
};

export const rewindTeleprompt = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const userId = body.userId || c.req.query("userId");

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const user = sessions.get(userId);
    const rewound = user?.rewindTeleprompt() || false;

    return c.json({
      ok: true,
      userId,
      active: Boolean(user?.appSession),
      rewound,
    });
  } catch (error) {
    console.error("[teleprompt.previous] Failed to rewind teleprompt:", error);
    return c.json({ error: "Failed to rewind teleprompt" }, 500);
  }
};

export const cancelTeleprompt = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const userId = body.userId || c.req.query("userId");

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const user = sessions.get(userId);
    const cancelled = user?.cancelTeleprompt() || false;

    return c.json({
      ok: true,
      userId,
      active: Boolean(user?.appSession),
      cancelled,
    });
  } catch (error) {
    console.error("[teleprompt.cancel] Failed to cancel teleprompt:", error);
    return c.json({ error: "Failed to cancel teleprompt" }, 500);
  }
};
