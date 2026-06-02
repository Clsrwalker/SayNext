import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";
import type { InteractionMode } from "../mastra/agents";

function defaultInteractionMode(): InteractionMode {
  return process.env.SAYNEXT_INTERACTION_MODE === "g1_auto" ? "g1_auto" : "g2_manual";
}

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
    outputLanguage: user?.getOutputLanguage() || 'english',
    interactionMode: user?.getInteractionMode() || defaultInteractionMode(),
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
    const { userId, frequency, outputLanguage, interactionMode, theme, pausedForReading, control, displayText } = body;

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const user = sessions.get(userId);

    if (frequency && ['low', 'medium', 'high'].includes(frequency)) {
      if (user) {
        user.setFrequency(frequency);
      }
    }

    if (outputLanguage && ['english', 'chinese'].includes(outputLanguage)) {
      if (user) {
        user.setOutputLanguage(outputLanguage);
      }
    }

    if (interactionMode && ['g1_auto', 'g2_manual'].includes(interactionMode)) {
      if (user) {
        user.setInteractionMode(interactionMode as InteractionMode);
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
      outputLanguage: user?.getOutputLanguage() || outputLanguage || 'english',
      interactionMode: user?.getInteractionMode() || interactionMode || defaultInteractionMode(),
      pausedForReading: user?.isPausedForReading() || false,
      theme: theme || 'light',
    });
  } catch (err) {
    return c.json({ error: "Invalid request body" }, 400);
  }
};
