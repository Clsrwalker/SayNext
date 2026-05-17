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
