import { createEvenHubV2Runtime, type EvenHubV2Runtime } from "./runtime";
import {
  EVENHUB_V2_WS_PATH,
  parseEvenHubV2ClientMessage,
  type EvenHubV2ServerMessage,
} from "./protocol";

export type EvenHubV2SocketData = {
  kind: "evenhub-v2";
  userId: string;
  clientSessionId: string;
  connId: string;
  runtime?: EvenHubV2Runtime;
};

type EvenHubServer = {
  upgrade(request: Request, options?: { data?: EvenHubV2SocketData }): boolean;
};

type EvenHubV2WebSocket = {
  data: EvenHubV2SocketData;
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

type RuntimeCacheEntry = {
  runtime: EvenHubV2Runtime;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const RUNTIME_RESUME_TTL_MS = Number(process.env.EVENHUB_V2_SESSION_RESUME_TTL_MS || 10 * 60 * 1000);
const runtimeCache = new Map<string, RuntimeCacheEntry>();

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toAudioChunk(message: Buffer | ArrayBuffer | Uint8Array): Uint8Array {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

function getExpectedToken(): string {
  return String(process.env.EVENHUB_V2_RELAY_TOKEN || "").trim();
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
  if (process.env.EVENHUB_V2_ALLOW_QUERY_USER_ID === "true") {
    const queryUserId = url.searchParams.get("userId")?.trim();
    if (queryUserId) return queryUserId;
  }
  return process.env.EVENHUB_DEFAULT_USER_ID || process.env.EVENHUB_V2_DEFAULT_USER_ID || "evenhub-v2-user";
}

function getClientSessionId(url: URL): string {
  return url.searchParams.get("sessionId")?.trim() || makeId("evenhub_v2_session");
}

function runtimeKey(userId: string, clientSessionId: string): string {
  return `${userId}:${clientSessionId}`;
}

function sendJson(ws: EvenHubV2WebSocket, message: EvenHubV2ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function getOrCreateRuntime(ws: EvenHubV2WebSocket): EvenHubV2Runtime {
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

  const runtime = createEvenHubV2Runtime({
    userId: ws.data.userId,
    clientSessionId: ws.data.clientSessionId,
    send: (message) => sendJson(ws, message),
  });
  runtimeCache.set(key, { runtime, cleanupTimer: null });
  return runtime;
}

function scheduleRuntimeCleanup(data: EvenHubV2SocketData): void {
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

export function tryUpgradeEvenHubV2WebSocket(request: Request, server: EvenHubServer): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== EVENHUB_V2_WS_PATH) return null;

  const expectedToken = getExpectedToken();
  if (expectedToken && getProvidedToken(request, url) !== expectedToken) {
    return new Response("Invalid EvenHub v2 token", { status: 401 });
  }

  const upgraded = server.upgrade(request, {
    data: {
      kind: "evenhub-v2",
      userId: getUserId(url),
      clientSessionId: getClientSessionId(url),
      connId: makeId("evenhub_v2_conn"),
    },
  });

  if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
  return new Response(null, { status: 101 });
}

export const evenHubV2WebSocket = {
  open(ws: EvenHubV2WebSocket) {
    ws.data.runtime = getOrCreateRuntime(ws);
    ws.data.runtime.handleOpen();
  },

  message(ws: EvenHubV2WebSocket, message: string | Buffer | ArrayBuffer | Uint8Array) {
    const runtime = ws.data.runtime;
    if (!runtime) {
      ws.close(1011, "runtime_not_ready");
      return;
    }

    if (typeof message !== "string") {
      runtime.handleAudioChunk(toAudioChunk(message));
      return;
    }

    const parsed = parseEvenHubV2ClientMessage(message);
    if (!parsed.ok) {
      ws.send(JSON.stringify({
        protocolVersion: "evenhub-v2.1",
        messageId: makeId("server_msg"),
        serverSeq: 0,
        timestamp: new Date().toISOString(),
        type: "error",
        payload: {
          code: parsed.code,
          message: parsed.message,
          recoverable: true,
        },
      }));
      return;
    }

    void runtime.handleClientMessage(parsed.message).catch((error) => {
      ws.send(JSON.stringify({
        protocolVersion: "evenhub-v2.1",
        messageId: makeId("server_msg"),
        serverSeq: 0,
        timestamp: new Date().toISOString(),
        type: "error",
        payload: {
          code: "runtime_error",
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      }));
    });
  },

  close(ws: EvenHubV2WebSocket) {
    void ws.data.runtime?.detachClient();
    scheduleRuntimeCleanup(ws.data);
  },
};
