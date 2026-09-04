import { createEvenHubV2Runtime, type EvenHubV2Runtime } from "./runtime";
import { consumeEvenHubV2WsTicket, isEvenHubV2PrincipalValid, type EvenHubV2Principal } from "./auth";
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
  principal: EvenHubV2Principal;
  authorizationTimer?: ReturnType<typeof setTimeout>;
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
  ownerId: string;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  socket: EvenHubV2WebSocket | null;
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

function runtimeKey(data: EvenHubV2SocketData): string {
  return JSON.stringify([data.principal.deviceId, data.userId, data.clientSessionId]);
}

function sendJson(ws: EvenHubV2WebSocket, message: EvenHubV2ServerMessage): void {
  if (!validateAuthorization(ws)) return;
  ws.send(JSON.stringify(message));
}

function validateAuthorization(ws: EvenHubV2WebSocket): boolean {
  if (isEvenHubV2PrincipalValid(ws.data.principal)) return true;
  evenHubV2WebSocket.close(ws);
  ws.close(4401, "authorization_required");
  return false;
}

function scheduleAuthorizationCheck(ws: EvenHubV2WebSocket): void {
  if (ws.data.authorizationTimer) clearTimeout(ws.data.authorizationTimer);
  ws.data.authorizationTimer = setTimeout(() => {
    if (validateAuthorization(ws)) scheduleAuthorizationCheck(ws);
  }, Math.max(1, Math.min(30_000, ws.data.principal.expiresAt - Date.now())));
  ws.data.authorizationTimer.unref?.();
}

function getOrCreateRuntime(ws: EvenHubV2WebSocket): EvenHubV2Runtime {
  const key = runtimeKey(ws.data);
  const cached = runtimeCache.get(key);
  if (cached) {
    if (cached.cleanupTimer) {
      clearTimeout(cached.cleanupTimer);
      cached.cleanupTimer = null;
    }
    const oldSocket = cached.socket;
    cached.socket = ws;
    cached.runtime.attachClient((message) => sendJson(ws, message), ws.data.connId);
    if (oldSocket && oldSocket !== ws) {
      if (oldSocket.data.authorizationTimer) clearTimeout(oldSocket.data.authorizationTimer);
      oldSocket.close(4409, "connection_replaced");
    }
    return cached.runtime;
  }

  const runtime = createEvenHubV2Runtime({
    userId: ws.data.userId,
    clientSessionId: ws.data.clientSessionId,
    send: (message) => sendJson(ws, message),
  });
  runtime.attachClient((message) => sendJson(ws, message), ws.data.connId);
  runtimeCache.set(key, { runtime, ownerId: ws.data.userId, cleanupTimer: null, socket: ws });
  return runtime;
}

function scheduleRuntimeCleanup(data: EvenHubV2SocketData): void {
  const key = runtimeKey(data);
  const cached = runtimeCache.get(key);
  if (!cached || cached.socket?.data.connId !== data.connId) return;
  cached.socket = null;
  if (cached.cleanupTimer) clearTimeout(cached.cleanupTimer);
  cached.cleanupTimer = setTimeout(() => {
    const entry = runtimeCache.get(key);
    if (entry !== cached || entry.socket) return;
    runtimeCache.delete(key);
    void entry.runtime.close().catch(() => console.error("[EvenHubV2] Runtime cleanup failed."));
  }, RUNTIME_RESUME_TTL_MS);
  cached.cleanupTimer.unref?.();
}

export function getEvenHubV2RuntimeSnapshot(userId: string, conversationId: string) {
  for (const entry of runtimeCache.values()) {
    if (entry.ownerId !== userId) continue;
    const snapshot = entry.runtime.captureSnapshot(conversationId);
    if (snapshot) return snapshot;
  }
  return null;
}

export async function shutdownEvenHubV2Runtimes(): Promise<void> {
  const entries = [...runtimeCache.values()];
  runtimeCache.clear();
  await Promise.all(entries.map(async (entry) => {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    if (entry.socket?.data.authorizationTimer) clearTimeout(entry.socket.data.authorizationTimer);
    entry.socket?.close(1001, "server_shutdown");
    await entry.runtime.close();
  }));
}

export function tryUpgradeEvenHubV2WebSocket(request: Request, server: EvenHubServer): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== EVENHUB_V2_WS_PATH) return null;

  const authorization = consumeEvenHubV2WsTicket(request);
  if (!authorization.ok) return Response.json({ code: authorization.code, error: authorization.error }, { status: authorization.status, headers: { "Cache-Control": "no-store" } });

  const upgraded = server.upgrade(request, {
    data: {
      kind: "evenhub-v2",
      userId: authorization.principal.ownerId,
      principal: authorization.principal,
      clientSessionId: authorization.clientSessionId!,
      connId: makeId("evenhub_v2_conn"),
    },
  });

  if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
  return new Response(null, { status: 101 });
}

export const evenHubV2WebSocket = {
  open(ws: EvenHubV2WebSocket) {
    if (!validateAuthorization(ws)) return;
    ws.data.runtime = getOrCreateRuntime(ws);
    scheduleAuthorizationCheck(ws);
    ws.data.runtime.handleOpen();
  },

  message(ws: EvenHubV2WebSocket, message: string | Buffer | ArrayBuffer | Uint8Array) {
    if (!validateAuthorization(ws)) return;
    const runtime = ws.data.runtime;
    if (!runtime) {
      ws.close(1011, "runtime_not_ready");
      return;
    }
    if (!runtime.isCurrentConnection(ws.data.connId)) {
      ws.close(4409, "connection_replaced");
      return;
    }

    if (typeof message !== "string") {
      runtime.handleAudioChunk(toAudioChunk(message), ws.data.connId);
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

    void runtime.handleClientMessage(parsed.message, ws.data.connId).catch((_error) => {
      if (!validateAuthorization(ws) || !runtime.isCurrentConnection(ws.data.connId)) return;
      ws.send(JSON.stringify({
        protocolVersion: "evenhub-v2.1",
        messageId: makeId("server_msg"),
        serverSeq: 0,
        timestamp: new Date().toISOString(),
        requestId: parsed.message.requestId || parsed.message.messageId,
        conversationId: parsed.message.conversationId,
        type: "error",
        payload: {
          code: "runtime_error",
          message: "The conversation operation failed. Please reconnect and check its saved state.",
          recoverable: false,
        },
      }));
    });
  },

  close(ws: EvenHubV2WebSocket) {
    if (ws.data.authorizationTimer) clearTimeout(ws.data.authorizationTimer);
    ws.data.authorizationTimer = undefined;
    if (ws.data.runtime?.detachClient(ws.data.connId)) {
      scheduleRuntimeCleanup(ws.data);
    }
  },
};
