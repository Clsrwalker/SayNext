export type PendingControl = {
  protocolVersion: "evenhub-v2.1";
  messageId: string;
  requestId?: string;
  conversationId?: string;
  clientSeq?: number;
  timestamp: string;
  type: string;
  payload?: unknown;
};

export type SavedSession = {
  conversationId: string | null;
  pendingStart: PendingControl | null;
  pendingEnd: PendingControl | null;
  cancelStart: boolean;
};

const KEY = "saynext.evenhub-v2.session-recovery";
export function safeSessionStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

export function loadSessionRecovery(): SavedSession | null {
  try {
    const raw = safeSessionStorage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const validControl = (control: PendingControl | null, type: string) => control?.type === type
      && control.protocolVersion === "evenhub-v2.1" && typeof control.requestId === "string"
      && typeof control.messageId === "string";
    return {
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      pendingStart: validControl(parsed.pendingStart, "conversation_start") ? parsed.pendingStart : null,
      pendingEnd: validControl(parsed.pendingEnd, "conversation_end") ? parsed.pendingEnd : null,
      // Page reconstruction restores capture as paused. An unfinished start is cancelled.
      cancelStart: Boolean(parsed.cancelStart || parsed.pendingStart),
    };
  } catch { return null; }
}

export function saveSessionRecovery(value: SavedSession | null): void {
  try {
    const storage = safeSessionStorage();
    if (value) storage?.setItem(KEY, JSON.stringify(value));
    else storage?.removeItem(KEY);
  } catch { /* Keep the current in-memory session usable when storage is denied. */ }
}
