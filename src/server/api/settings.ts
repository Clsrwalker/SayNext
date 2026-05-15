import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";

/**
 * GET /api/settings — get current settings for a user
 */
export const getSettings = (c: Context) => {
  const userId = c.req.query("userId");

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  const user = sessions.get(userId);

  return c.json({
    userId,
    frequency: user?.getFrequency() || 'high',
    pausedForReading: user?.isPausedForReading() || false,
    theme: 'light', // Default, frontend manages theme via localStorage
  });
};

/**
 * PATCH /api/settings — update settings for a user
 */
export const updateSettings = async (c: Context) => {
  try {
    const body = await c.req.json();
    const { userId, frequency, theme, pausedForReading, control, displayText } = body;

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const user = sessions.get(userId);

    if (frequency && ['low', 'medium', 'high'].includes(frequency)) {
      if (user) {
        user.setFrequency(frequency);
      }
    }

    if (user) {
      if (control === 'display' && typeof displayText === 'string' && displayText.trim()) {
        user.showInsightForReading(displayText.trim());
      } else if (control === 'pause' || pausedForReading === true) {
        user.pauseForReading();
      } else if (control === 'resume' || control === 'auto' || pausedForReading === false) {
        user.resumeAutomatic();
      }
    }

    return c.json({
      userId,
      frequency: user?.getFrequency() || frequency || 'high',
      pausedForReading: user?.isPausedForReading() || false,
      theme: theme || 'light',
    });
  } catch (err) {
    return c.json({ error: "Invalid request body" }, 400);
  }
};
