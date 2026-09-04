import { afterEach, expect, test } from "bun:test";
import { evenHubV2WebSocket, tryUpgradeEvenHubV2WebSocket } from "../evenhub-v2/ws";

const originalRelayToken = process.env.EVENHUB_V2_RELAY_TOKEN;
const originalAllowQueryUser = process.env.EVENHUB_V2_ALLOW_QUERY_USER_ID;
const originalDefaultUser = process.env.EVENHUB_V2_DEFAULT_USER_ID;
const originalSharedDefaultUser = process.env.EVENHUB_DEFAULT_USER_ID;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv("EVENHUB_V2_RELAY_TOKEN", originalRelayToken);
  restoreEnv("EVENHUB_V2_ALLOW_QUERY_USER_ID", originalAllowQueryUser);
  restoreEnv("EVENHUB_V2_DEFAULT_USER_ID", originalDefaultUser);
  restoreEnv("EVENHUB_DEFAULT_USER_ID", originalSharedDefaultUser);
});

test("EvenHub v2 websocket rejects an invalid relay token before attempting an upgrade", async () => {
  process.env.EVENHUB_V2_RELAY_TOKEN = "expected-secret";
  let upgradeCalls = 0;
  const server = {
    upgrade() {
      upgradeCalls += 1;
      return true;
    },
  };

  const response = tryUpgradeEvenHubV2WebSocket(
    new Request("https://saynext.test/api/evenhub/v2/ws?token=wrong-secret"),
    server,
  );

  expect(response?.status).toBe(401);
  expect(await response?.text()).toBe("Invalid EvenHub v2 token");
  expect(upgradeCalls).toBe(0);
});

test("EvenHub v2 websocket reports upgrade failure without creating a successful session", async () => {
  delete process.env.EVENHUB_V2_RELAY_TOKEN;
  let receivedData: Record<string, unknown> | undefined;
  const server = {
    upgrade(_request: Request, options?: { data?: Record<string, unknown> }) {
      receivedData = options?.data;
      return false;
    },
  };

  const response = tryUpgradeEvenHubV2WebSocket(
    new Request("https://saynext.test/api/evenhub/v2/ws?sessionId=session-1"),
    server,
  );

  expect(response?.status).toBe(400);
  expect(await response?.text()).toBe("WebSocket upgrade failed");
  expect(receivedData).toMatchObject({
    kind: "evenhub-v2",
    clientSessionId: "session-1",
  });
});

test("EvenHub v2 websocket ignores a query user id unless the explicit development switch is enabled", () => {
  delete process.env.EVENHUB_V2_RELAY_TOKEN;
  process.env.EVENHUB_DEFAULT_USER_ID = "trusted-user";
  delete process.env.EVENHUB_V2_ALLOW_QUERY_USER_ID;
  const upgradeData: Array<Record<string, unknown>> = [];
  const server = {
    upgrade(_request: Request, options?: { data?: Record<string, unknown> }) {
      if (options?.data) upgradeData.push(options.data);
      return true;
    },
  };

  const response = tryUpgradeEvenHubV2WebSocket(
    new Request("https://saynext.test/api/evenhub/v2/ws?sessionId=session-2&userId=attacker"),
    server,
  );

  expect(response?.status).toBe(101);
  expect(upgradeData).toHaveLength(1);
  expect(upgradeData[0]).toMatchObject({
    userId: "trusted-user",
    clientSessionId: "session-2",
  });
  expect(upgradeData[0]?.connId).toBeString();
});

test("EvenHub v2 websocket forwards the exact binary view to the active runtime", () => {
  const receivedChunks: number[][] = [];
  const backingBuffer = new Uint8Array([99, 10, 20, 30, 88]);
  const audioView = backingBuffer.subarray(1, 4);
  const ws = {
    data: {
      kind: "evenhub-v2",
      userId: "user-1",
      clientSessionId: "session-1",
      connId: "connection-1",
      runtime: {
        handleAudioChunk(chunk: Uint8Array) {
          receivedChunks.push(Array.from(chunk));
        },
      },
    },
    send() {},
    close() {},
  };

  evenHubV2WebSocket.message(ws as any, audioView);

  expect(receivedChunks).toEqual([[10, 20, 30]]);
});

test("EvenHub v2 websocket returns a protocol error without invoking the runtime", () => {
  const sent: string[] = [];
  let runtimeCalls = 0;
  const ws = {
    data: {
      kind: "evenhub-v2",
      userId: "user-1",
      clientSessionId: "session-1",
      connId: "connection-1",
      runtime: {
        async handleClientMessage() {
          runtimeCalls += 1;
        },
      },
    },
    send(message: string) {
      sent.push(message);
    },
    close() {},
  };

  evenHubV2WebSocket.message(ws as any, JSON.stringify({
    type: "conversation_start",
    payload: {},
  }));

  expect(runtimeCalls).toBe(0);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]!)).toMatchObject({
    type: "error",
    payload: {
      recoverable: true,
    },
  });
});
