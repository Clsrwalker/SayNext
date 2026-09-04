import { describe, expect, test } from "vitest";
import {
  planReadyRecovery,
  restartAudioControlOnce,
  shouldRearmForegroundAudio,
  shouldRestartStalledForegroundAudio,
} from "./connection-recovery";

describe("ready recovery", () => {
  test("resumes the existing active conversation after a websocket reconnect", () => {
    expect(planReadyRecovery({
      isReconnect: true,
      localConversationId: "conversation-1",
      localListening: true,
      serverConversationId: "conversation-1",
      serverConversationStatus: "active",
      serverAudioStatus: "listening",
    })).toEqual({
      nextConversationId: "conversation-1",
      shouldSendAudioStart: true,
      shouldRearmAudio: false,
      sessionLost: false,
    });
  });

  test("does not restart audio for the duplicate ready sent during a normal connection", () => {
    expect(planReadyRecovery({
      isReconnect: false,
      localConversationId: "conversation-1",
      localListening: true,
      serverConversationId: "conversation-1",
      serverConversationStatus: "active",
      serverAudioStatus: "listening",
    })).toMatchObject({
      shouldSendAudioStart: false,
      shouldRearmAudio: false,
      sessionLost: false,
    });
  });

  test("reports a lost server session instead of keeping a stale local conversation", () => {
    expect(planReadyRecovery({
      isReconnect: true,
      localConversationId: "conversation-1",
      localListening: true,
      serverConversationId: null,
      serverConversationStatus: "idle",
      serverAudioStatus: "stopped",
    })).toEqual({
      nextConversationId: null,
      shouldSendAudioStart: false,
      shouldRearmAudio: false,
      sessionLost: true,
    });
  });
});

describe("foreground audio recovery", () => {
  test("schedules a recovery check only for an active listening conversation", () => {
    expect(shouldRearmForegroundAudio({
      conversationId: "conversation-1",
      isListening: true,
    })).toBe(true);
    expect(shouldRearmForegroundAudio({
      conversationId: null,
      isListening: true,
    })).toBe(false);
    expect(shouldRearmForegroundAudio({
      conversationId: "conversation-1",
      isListening: false,
    })).toBe(false);
  });

  test("restarts the mic only when no PCM arrived during the foreground grace period", () => {
    expect(shouldRestartStalledForegroundAudio({
      conversationId: "conversation-1",
      isListening: true,
      recoveryStartedAt: 1_000,
      lastAudioChunkAt: 999,
    })).toBe(true);
    expect(shouldRestartStalledForegroundAudio({
      conversationId: "conversation-1",
      isListening: true,
      recoveryStartedAt: 1_000,
      lastAudioChunkAt: 1_001,
    })).toBe(false);
    expect(shouldRestartStalledForegroundAudio({
      conversationId: null,
      isListening: true,
      recoveryStartedAt: 1_000,
      lastAudioChunkAt: 0,
    })).toBe(false);
  });

  test("performs a controlled restart by closing the current source before reopening it", async () => {
    const calls: boolean[] = [];

    const restarted = await restartAudioControlOnce(async (enabled) => {
      calls.push(enabled);
      return true;
    });

    expect(restarted).toBe(true);
    expect(calls).toEqual([false, true]);
  });

  test("does not open a second source when closing the current source fails", async () => {
    const calls: boolean[] = [];

    const restarted = await restartAudioControlOnce(async (enabled) => {
      calls.push(enabled);
      return false;
    });

    expect(restarted).toBe(false);
    expect(calls).toEqual([false]);
  });
});
