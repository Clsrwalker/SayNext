import { createEvenHubRuntime, EvenHubRuntime } from "./runtime";
import { EVENHUB_WS_PATH, parseEvenHubClientMessage, type EvenHubServerMessage } from "./protocol";

type EvenHubSocketData = {
  userId: string;
  clientSessionId: string;
  connId: string;
  runtime?: EvenHubRuntime;
};

type EvenHubServer = {
  upgrade(request: Request, options?: { data?: EvenHubSocketData }): boolean;
};

type EvenHubWebSocket = {
  data: EvenHubSocketData;
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

function toAudioChunk(message: Buffer | ArrayBuffer | Uint8Array): Uint8Array {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getExpectedToken(): string {
  return String(process.env.EVENHUB_RELAY_TOKEN || process.env.EVENHUB_TOKEN || "").trim();
}

function getProvidedToken(request: Request, url: URL): string {
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer?.[1]) return bearer[1].trim();

  return request.headers.get("x-evenhub-token")?.trim() || "";
}

function getUserId(url: URL): string {
  return url.searchParams.get("userId")?.trim() || process.env.EVENHUB_DEFAULT_USER_ID || "evenhub-user";
}

function getClientSessionId(url: URL): string {
  return url.searchParams.get("sessionId")?.trim() || makeId("evenhub_session");
}

function sendJson(ws: EvenHubWebSocket, message: EvenHubServerMessage): void {
  ws.send(JSON.stringify(message));
}

type RuntimeCacheEntry = {
  runtime: EvenHubRuntime;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const RUNTIME_RESUME_TTL_MS = Number(process.env.EVENHUB_SESSION_RESUME_TTL_MS || 10 * 60 * 1000);
const runtimeCache = new Map<string, RuntimeCacheEntry>();

function runtimeKey(userId: string, clientSessionId: string): string {
  return `${userId}:${clientSessionId}`;
}

function getOrCreateRuntime(ws: EvenHubWebSocket): EvenHubRuntime {
  const key = runtimeKey(ws.data.userId, ws.data.clientSessionId);
  const cached = runtimeCache.get(key);
  if (cached) {
    if (cached.cleanupTimer) {
      clearTimeout(cached.cleanupTimer);
      cached.cleanupTimer = null;
    }
    cached.runtime.attachClient((message) => sendJson(ws, message));
    return cached.runtime;
  }

  const runtime = createEvenHubRuntime({
    userId: ws.data.userId,
    clientSessionId: ws.data.clientSessionId,
    send: (message) => sendJson(ws, message),
  });
  runtimeCache.set(key, { runtime, cleanupTimer: null });
  return runtime;
}

function scheduleRuntimeCleanup(data: EvenHubSocketData): void {
  const key = runtimeKey(data.userId, data.clientSessionId);
  const cached = runtimeCache.get(key);
  if (!cached) return;
  if (cached.cleanupTimer) clearTimeout(cached.cleanupTimer);
  cached.cleanupTimer = setTimeout(() => {
    const entry = runtimeCache.get(key);
    if (!entry) return;
    void entry.runtime.close();
    runtimeCache.delete(key);
  }, RUNTIME_RESUME_TTL_MS);
}

export function tryUpgradeEvenHubWebSocket(request: Request, server: EvenHubServer): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== EVENHUB_WS_PATH) return null;

  const expectedToken = getExpectedToken();
  if (expectedToken && getProvidedToken(request, url) !== expectedToken) {
    return new Response("Invalid EvenHub token", { status: 401 });
  }

  const upgraded = server.upgrade(request, {
    data: {
      userId: getUserId(url),
      clientSessionId: getClientSessionId(url),
      connId: makeId("evenhub_conn"),
    },
  });

  if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
  return new Response(null, { status: 101 });
}

export const evenHubWebSocket = {
  open(ws: EvenHubWebSocket) {
    console.log(`[EvenHub] open conn=${ws.data.connId} user=${ws.data.userId} session=${ws.data.clientSessionId}`);
    ws.data.runtime = getOrCreateRuntime(ws);
    ws.data.runtime.handleOpen();
  },

  message(ws: EvenHubWebSocket, message: string | Buffer | ArrayBuffer | Uint8Array) {
    const runtime = ws.data.runtime;
    if (!runtime) {
      ws.close(1011, "runtime_not_ready");
      return;
    }

    if (typeof message !== "string") {
      runtime.handleAudioChunk(toAudioChunk(message));
      return;
    }

    const parsed = parseEvenHubClientMessage(message);
    if (!parsed) {
      sendJson(ws, {
        type: "error",
        code: "invalid_message",
        message: "Invalid EvenHub client message.",
        sessionId: runtime.sessionId,
      });
      return;
    }

    void runtime.handleClientMessage(parsed).catch((error) => {
      sendJson(ws, {
        type: "error",
        code: "runtime_error",
        message: error instanceof Error ? error.message : String(error),
        sessionId: runtime.sessionId,
      });
    });
  },

  close(ws: EvenHubWebSocket, code: number, reason: string) {
    console.log(`[EvenHub] close conn=${ws.data.connId} code=${code} reason=${reason || ""}`);
    void ws.data.runtime?.detachClient();
    scheduleRuntimeCleanup(ws.data);
  },
};
