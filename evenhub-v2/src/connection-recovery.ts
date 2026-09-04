type ConversationStatus = "idle" | "active" | "ending" | "ended";
type AudioStatus = "stopped" | "starting" | "listening" | "reconnecting" | "failed";

type ReadyRecoveryInput = {
  isReconnect: boolean;
  localConversationId: string | null;
  localListening: boolean;
  serverConversationId?: string | null;
  serverConversationStatus?: ConversationStatus;
  serverAudioStatus?: AudioStatus;
};

export type ReadyRecoveryPlan = {
  nextConversationId: string | null;
  shouldSendAudioStart: boolean;
  shouldRearmAudio: boolean;
  sessionLost: boolean;
};

export function planReadyRecovery(input: ReadyRecoveryInput): ReadyRecoveryPlan {
  if (!input.isReconnect) {
    return {
      nextConversationId: input.localConversationId,
      shouldSendAudioStart: false,
      shouldRearmAudio: false,
      sessionLost: false,
    };
  }

  const serverConversationId = input.serverConversationId?.trim() || null;
  if (input.serverConversationStatus === "active" && serverConversationId) {
    return {
      nextConversationId: serverConversationId,
      shouldSendAudioStart: input.localListening,
      // The SDK audio source belongs to the phone page, not the websocket.
      // Reopening it here can create a second PCM subscription after reconnect.
      shouldRearmAudio: false,
      sessionLost: false,
    };
  }

  const expectedActiveSession = Boolean(input.localConversationId || input.localListening);
  return {
    nextConversationId: expectedActiveSession ? null : input.localConversationId,
    shouldSendAudioStart: false,
    shouldRearmAudio: false,
    sessionLost: expectedActiveSession,
  };
}

export function shouldRearmForegroundAudio(input: {
  conversationId: string | null;
  isListening: boolean;
}): boolean {
  return Boolean(input.conversationId && input.isListening);
}

export function shouldRestartStalledForegroundAudio(input: {
  conversationId: string | null;
  isListening: boolean;
  recoveryStartedAt: number;
  lastAudioChunkAt: number;
}): boolean {
  return Boolean(
    input.conversationId
    && input.isListening
    && input.lastAudioChunkAt < input.recoveryStartedAt,
  );
}

export async function restartAudioControlOnce(
  setEnabled: (enabled: boolean) => Promise<boolean>,
): Promise<boolean> {
  const stopped = await setEnabled(false);
  if (!stopped) return false;
  return setEnabled(true);
}
