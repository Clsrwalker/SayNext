import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export type EvenHubV2Principal = {
  deviceId: string;
  ownerId: string;
  tokenSha256: string;
  expiresAt: number;
};

type Device = EvenHubV2Principal & { revoked: boolean };
type AuthFailure = { ok: false; status: 401 | 403 | 503; code: string; error: string };
type AuthResult = { ok: true; principal: EvenHubV2Principal } | AuthFailure;
const DEFAULT_ORIGIN = "https://saynext.167.172.153.109.sslip.io";
const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 256;
const MAX_DEVICE_TICKETS = 8;
const tickets = new Map<string, { principal: EvenHubV2Principal; clientSessionId: string; expiresAt: number; origin: string | null }>();

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function configuredDevices(): Device[] | null {
  try {
    const parsed: unknown = JSON.parse(process.env.EVENHUB_V2_DEVICES_JSON || "null");
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) return null;
    const ids = new Set<string>();
    const hashes = new Set<string>();
    return parsed.map((value): Device => {
      if (!value || typeof value !== "object") throw new Error("invalid_device");
      const { deviceId, ownerId, tokenSha256, expiresAt, revoked } = value;
      if (typeof deviceId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(deviceId)
        || typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 200 || ownerId !== ownerId.trim()
        || typeof tokenSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(tokenSha256)
        || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
        || (revoked !== undefined && typeof revoked !== "boolean")
        || ids.has(deviceId) || hashes.has(tokenSha256.toLowerCase())) throw new Error("invalid_device");
      ids.add(deviceId);
      hashes.add(tokenSha256.toLowerCase());
      return { deviceId, ownerId, tokenSha256: tokenSha256.toLowerCase(), expiresAt: Date.parse(expiresAt), revoked: revoked === true };
    });
  } catch {
    // Configuration and credentials are deliberately excluded from error output.
    return null;
  }
}

export function isEvenHubV2OriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return true; // Native/CLI clients still require authentication.
  const allowed = (process.env.EVENHUB_V2_ALLOWED_ORIGINS ?? DEFAULT_ORIGIN).split(",").map((item) => item.trim());
  return allowed.some((item) => {
    if (item === "null") return origin === "null";
    try {
      const url = new URL(item);
      return ["http:", "https:"].includes(url.protocol) && url.origin === item && item === origin;
    } catch { return false; }
  });
}

function unavailable(): AuthFailure {
  return { ok: false, status: 503, code: "auth_unavailable", error: "Device authorization is not configured." };
}

function unauthorized(): AuthFailure {
  return { ok: false, status: 401, code: "authorization_required", error: "A valid device authorization is required." };
}

export function authorizeEvenHubV2Request(request: Request, now = Date.now()): AuthResult {
  if (!isEvenHubV2OriginAllowed(request.headers.get("origin"))) {
    return { ok: false, status: 403, code: "origin_not_allowed", error: "Request origin is not allowed." };
  }
  const devices = configuredDevices();
  if (!devices) return unavailable();
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length < 32 || token.length > 512) return unauthorized();
  const hash = Buffer.from(hashDeviceToken(token), "hex");
  const device = devices.find((item) => timingSafeEqual(hash, Buffer.from(item.tokenSha256, "hex")));
  if (!device || device.revoked || device.expiresAt <= now) return unauthorized();
  const { revoked: _revoked, ...principal } = device;
  return { ok: true, principal };
}

export function isEvenHubV2PrincipalValid(principal: EvenHubV2Principal | undefined, now = Date.now()): boolean {
  if (!principal || principal.expiresAt <= now) return false;
  return configuredDevices()?.some((item) => !item.revoked && item.expiresAt > now
    && item.deviceId === principal.deviceId && item.ownerId === principal.ownerId
    && item.tokenSha256 === principal.tokenSha256 && item.expiresAt === principal.expiresAt) === true;
}

export const requireEvenHubV2Authorization: MiddlewareHandler = async (c, next) => {
  const result = authorizeEvenHubV2Request(c.req.raw);
  c.header("Cache-Control", "no-store");
  if (!result.ok) return c.json({ code: result.code, error: result.error }, result.status);
  c.set("evenHubV2Principal", result.principal);
  await next();
};

export function getEvenHubV2Principal(c: Context): EvenHubV2Principal {
  const principal = c.get("evenHubV2Principal") as EvenHubV2Principal | undefined;
  if (!principal) throw new HTTPException(401, { message: "Device authorization required" });
  return principal;
}

export function issueEvenHubV2WsTicket(principal: EvenHubV2Principal, clientSessionId: string, origin: string | null, now = Date.now()) {
  if (!isEvenHubV2PrincipalValid(principal, now)) return null;
  for (const [key, value] of tickets) {
    if (value.expiresAt <= now || !isEvenHubV2PrincipalValid(value.principal, now)) tickets.delete(key);
  }
  const ownTickets = [...tickets].filter(([, value]) => value.principal.deviceId === principal.deviceId);
  if (ownTickets.length >= MAX_DEVICE_TICKETS) tickets.delete(ownTickets[0]![0]);
  if (tickets.size >= MAX_TICKETS) return null;
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = Math.min(now + TICKET_TTL_MS, principal.expiresAt);
  tickets.set(hashDeviceToken(ticket), { principal, clientSessionId, expiresAt, origin });
  return { ticket, expiresAt: new Date(expiresAt).toISOString(), clientSessionId };
}

export function consumeEvenHubV2WsTicket(request: Request, now = Date.now()): (AuthResult & { clientSessionId?: string }) {
  const origin = request.headers.get("origin");
  if (!isEvenHubV2OriginAllowed(origin)) return { ok: false, status: 403, code: "origin_not_allowed", error: "Request origin is not allowed." };
  if (!configuredDevices()) return unavailable();
  const token = new URL(request.url).searchParams.get("ticket");
  if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return unauthorized();
  const key = hashDeviceToken(token);
  const stored = tickets.get(key);
  // Every presented ticket is consumed, including an attempted wrong-origin use.
  tickets.delete(key);
  if (!stored || stored.expiresAt <= now || stored.origin !== origin || !isEvenHubV2PrincipalValid(stored.principal, now)) return unauthorized();
  return { ok: true, principal: stored.principal, clientSessionId: stored.clientSessionId };
}

export const createEvenHubV2WsTicket = async (c: Context) => {
  const body: unknown = await c.req.json().catch(() => null);
  const clientSessionId = body && typeof body === "object" && "clientSessionId" in body ? body.clientSessionId : undefined;
  if (typeof clientSessionId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(clientSessionId)) {
    return c.json({ code: "invalid_session_id", error: "A valid clientSessionId is required." }, 400);
  }
  const ticket = issueEvenHubV2WsTicket(getEvenHubV2Principal(c), clientSessionId, c.req.header("origin") || null);
  if (!ticket) return c.json({ code: "ticket_unavailable", error: "WebSocket authorization is temporarily unavailable." }, 503);
  return c.json(ticket);
};
