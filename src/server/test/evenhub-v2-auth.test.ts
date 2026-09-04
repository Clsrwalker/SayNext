import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { authorizeEvenHubV2Request, consumeEvenHubV2WsTicket, createEvenHubV2WsTicket, hashDeviceToken, isEvenHubV2OriginAllowed, isEvenHubV2PrincipalValid, issueEvenHubV2WsTicket, requireEvenHubV2Authorization } from "../evenhub-v2/auth";

const token = "test-only-device-credential-32-bytes-minimum";
const now = Date.parse("2026-09-04T10:00:00.000Z");
const device = { deviceId: "test-phone", ownerId: "existing-owner", tokenSha256: hashDeviceToken(token), expiresAt: "2099-01-01T00:00:00.000Z" };
const originals = { devices: process.env.EVENHUB_V2_DEVICES_JSON, origins: process.env.EVENHUB_V2_ALLOWED_ORIGINS };
function request(authorization: string | undefined = `Bearer ${token}`, origin: string | undefined = "https://app.test") {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  if (origin) headers.set("Origin", origin);
  return new Request("https://api.test/api/evenhub/v2/bootstrap?userId=attacker", { headers });
}
beforeEach(() => {
  process.env.EVENHUB_V2_DEVICES_JSON = JSON.stringify([device]);
  process.env.EVENHUB_V2_ALLOWED_ORIGINS = "https://app.test";
});
afterEach(() => {
  if (originals.devices === undefined) delete process.env.EVENHUB_V2_DEVICES_JSON;
  else process.env.EVENHUB_V2_DEVICES_JSON = originals.devices;
  if (originals.origins === undefined) delete process.env.EVENHUB_V2_ALLOWED_ORIGINS;
  else process.env.EVENHUB_V2_ALLOWED_ORIGINS = originals.origins;
});

test("device authentication fails closed for absent or malformed configuration", () => {
  for (const config of [undefined, "", "[]", "{bad", JSON.stringify([{ ...device, tokenSha256: "raw-secret" }]), JSON.stringify([device, device])]) {
    if (config === undefined) delete process.env.EVENHUB_V2_DEVICES_JSON;
    else process.env.EVENHUB_V2_DEVICES_JSON = config;
    expect(authorizeEvenHubV2Request(request(), now)).toMatchObject({ ok: false, status: 503, code: "auth_unavailable" });
  }
});

test("only a valid Bearer device credential resolves the configured owner", () => {
  expect(authorizeEvenHubV2Request(request(), now)).toMatchObject({ ok: true, principal: { ownerId: "existing-owner", deviceId: "test-phone" } });
  for (const authorization of ["", "Bearer wrong-credential-with-sufficient-length", `Basic ${token}`, `Bearer ${token} extra`]) {
    expect(authorizeEvenHubV2Request(request(authorization), now)).toMatchObject({ ok: false, status: 401 });
  }
  expect(authorizeEvenHubV2Request(new Request(`https://api.test/?token=${token}&userId=existing-owner`), now)).toMatchObject({ ok: false, status: 401 });
});

test("credential rotation, revocation, and expiry invalidate previously authenticated connections", () => {
  const result = authorizeEvenHubV2Request(request(), now);
  if (!result.ok) throw new Error("test setup auth failed");
  for (const changed of [{ ...device, revoked: true }, { ...device, tokenSha256: "a".repeat(64) }, { ...device, expiresAt: "2026-09-04T09:00:00.000Z" }, { ...device, ownerId: "other-owner" }]) {
    process.env.EVENHUB_V2_DEVICES_JSON = JSON.stringify([changed]);
    expect(isEvenHubV2PrincipalValid(result.principal, now)).toBe(false);
  }
  process.env.EVENHUB_V2_DEVICES_JSON = JSON.stringify([device]);
  expect(isEvenHubV2PrincipalValid(result.principal, Date.parse(device.expiresAt))).toBe(false);
});

test("origin policy requires exact configured origins and explicitly opts in to null", () => {
  expect(isEvenHubV2OriginAllowed(undefined)).toBe(true);
  expect(isEvenHubV2OriginAllowed("https://app.test")).toBe(true);
  for (const origin of ["null", "https://app.test.attacker.test", "http://app.test", "https://app.test:3000"]) {
    expect(authorizeEvenHubV2Request(request(`Bearer ${token}`, origin), now)).toMatchObject({ ok: false, status: 403 });
  }
  process.env.EVENHUB_V2_ALLOWED_ORIGINS = "https://app.test,null";
  expect(isEvenHubV2OriginAllowed("null")).toBe(true);
});

test("WS tickets bind owner, device, origin, and session and are consumed once", () => {
  const auth = authorizeEvenHubV2Request(request(), now);
  if (!auth.ok) throw new Error("test setup auth failed");
  const issued = issueEvenHubV2WsTicket(auth.principal, "session-1", "https://app.test", now)!;
  const wsRequest = new Request(`https://api.test/ws?ticket=${issued.ticket}&sessionId=forged&userId=attacker`, { headers: { Origin: "https://app.test" } });
  expect(consumeEvenHubV2WsTicket(wsRequest, now + 1)).toMatchObject({ ok: true, clientSessionId: "session-1", principal: { deviceId: "test-phone", ownerId: "existing-owner" } });
  expect(consumeEvenHubV2WsTicket(wsRequest, now + 2)).toMatchObject({ ok: false, status: 401 });
  const expired = issueEvenHubV2WsTicket(auth.principal, "session-1", null, now)!;
  expect(consumeEvenHubV2WsTicket(new Request(`https://api.test/ws?ticket=${expired.ticket}`), now + 30_000)).toMatchObject({ ok: false, status: 401 });
  const wrongOrigin = issueEvenHubV2WsTicket(auth.principal, "session-1", "https://app.test", now)!;
  expect(consumeEvenHubV2WsTicket(new Request(`https://api.test/ws?ticket=${wrongOrigin.ticket}`), now + 1)).toMatchObject({ ok: false, status: 401 });
  const revoked = issueEvenHubV2WsTicket(auth.principal, "session-1", null, now)!;
  process.env.EVENHUB_V2_DEVICES_JSON = JSON.stringify([{ ...device, revoked: true }]);
  expect(consumeEvenHubV2WsTicket(new Request(`https://api.test/ws?ticket=${revoked.ticket}`), now + 1)).toMatchObject({ ok: false, status: 401 });
});

test("outstanding per-device tickets are bounded", () => {
  const auth = authorizeEvenHubV2Request(request(), now);
  if (!auth.ok) throw new Error("test setup auth failed");
  const first = issueEvenHubV2WsTicket(auth.principal, "session-1", null, now)!;
  for (let index = 0; index < 8; index++) issueEvenHubV2WsTicket(auth.principal, `session-${index}`, null, now);
  expect(consumeEvenHubV2WsTicket(new Request(`https://api.test/ws?ticket=${first.ticket}`), now + 1)).toMatchObject({ ok: false, status: 401 });
});

test("ticket endpoint authenticates and validates the session without disclosing credentials", async () => {
  const app = new Hono();
  app.use("*", requireEvenHubV2Authorization);
  app.post("/ticket", createEvenHubV2WsTicket);
  expect((await app.request("/ticket", { method: "POST" })).status).toBe(401);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  expect((await app.request("/ticket", { method: "POST", headers, body: JSON.stringify({ clientSessionId: "a:b" }) })).status).toBe(400);
  const response = await app.request("/ticket", { method: "POST", headers, body: JSON.stringify({ clientSessionId: "client-1", userId: "attacker" }) });
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(JSON.parse(body)).toMatchObject({ clientSessionId: "client-1", ticket: expect.any(String), expiresAt: expect.any(String) });
  expect(body).not.toContain(token);
  expect(body).not.toContain(device.tokenSha256);
});
