import { afterEach, beforeEach, expect, test } from "bun:test";
import { DeepgramEvenHubSttAdapter, makeDeepgramUrl, type EvenHubSttConnectionEvent } from "../evenhub/stt";

const keys = ["DEEPGRAM_MODEL", "EVENHUB_STT_MODEL", "EVENHUB_STT_LANGUAGE", "EVENHUB_STT_SAMPLE_RATE",
  "DEEPGRAM_STT_CONNECT_TIMEOUT_MS", "DEEPGRAM_STT_RECONNECT_ATTEMPTS", "DEEPGRAM_STT_RECONNECT_BASE_MS",
  "DEEPGRAM_STT_RECONNECT_MAX_MS", "DEEPGRAM_STT_RECONNECT_BUFFER_MS", "EVENHUB_STT_FINALIZE_WAIT_MS"];
const originalEnv = new Map<string, string | undefined>();
const originalWebSocket = globalThis.WebSocket;
const adapters: DeepgramEvenHubSttAdapter[] = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: FakeSocket[] = [];
  static autoOpen = true;
  static constructorFailures = 0;
  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(readonly url: string, readonly options?: unknown) {
    if (FakeSocket.constructorFailures > 0) { FakeSocket.constructorFailures -= 1; throw new Error("constructor failed"); }
    FakeSocket.instances.push(this);
    if (FakeSocket.autoOpen) queueMicrotask(() => this.open());
  }
  open() { if (this.readyState !== FakeSocket.CONNECTING) return; this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  send(data: unknown) { this.sent.push(data); }
  close(code = 1000, reason = "") {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }
  message(text: string, isFinal = true) {
    this.onmessage?.({ data: JSON.stringify({ channel: { alternatives: [{ transcript: text }] }, is_final: isFinal }) });
  }
}
function setup() {
  const states: EvenHubSttConnectionEvent[] = [];
  const errors: Error[] = [];
  const transcripts: Array<{ text: string; isFinal: boolean }> = [];
  const adapter = new DeepgramEvenHubSttAdapter("test-key", {
    onConnectionState: (event) => states.push(event), onError: (error) => errors.push(error),
    onTranscript: (event) => { transcripts.push(event); },
  });
  adapters.push(adapter);
  return { adapter, states, errors, transcripts };
}
const sleep = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 500;
  while (!predicate() && Date.now() < end) await sleep(2);
  expect(predicate()).toBe(true);
}
beforeEach(() => {
  for (const key of keys) { originalEnv.set(key, process.env[key]); delete process.env[key]; }
  process.env.DEEPGRAM_STT_RECONNECT_BASE_MS = "1";
  process.env.DEEPGRAM_STT_RECONNECT_MAX_MS = "2";
  process.env.EVENHUB_STT_FINALIZE_WAIT_MS = "1";
  FakeSocket.instances = []; FakeSocket.autoOpen = true; FakeSocket.constructorFailures = 0;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
  globalThis.WebSocket = originalWebSocket;
  for (const key of keys) { const value = originalEnv.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("Deepgram uses explicit Nova-3 session languages, including multi for auto", () => {
  process.env.EVENHUB_STT_LANGUAGE = "fr";
  expect(new URL(makeDeepgramUrl()).searchParams.get("language")).toBe("fr");
  for (const [input, expected] of [["en", "en"], ["zh", "zh"], [null, "multi"], ["auto", "multi"]]) {
    const params = new URL(makeDeepgramUrl({ languageCode: input })).searchParams;
    expect(params.get("language")).toBe(expected);
    expect(params.get("model")).toBe("nova-3");
    expect(params.has("detect_language")).toBe(false);
  }
});

test("Deepgram streams audio, reports connection state, and preserves finalization tail", async () => {
  const { adapter, states, transcripts } = setup();
  await adapter.start({ languageCode: "zh" });
  const socket = FakeSocket.instances[0];
  adapter.pushAudio(new Uint8Array([1, 2]));
  socket.message("partial", false);
  const stop = adapter.stop();
  socket.message("final tail");
  adapter.pushAudio(new Uint8Array([3, 4]));
  await stop;
  expect(socket.sent).toEqual([new Uint8Array([1, 2]), JSON.stringify({ type: "Finalize" })]);
  expect(transcripts).toEqual([{ text: "partial", isFinal: false }, { text: "final tail", isFinal: true }]);
  expect(states.map((event) => event.status)).toEqual(["connecting", "connected", "stopped"]);
  await sleep();
  expect(FakeSocket.instances).toHaveLength(1);
});

test("Deepgram copies its language for reconnect and a later session may choose another language", async () => {
  const { adapter, states } = setup();
  const options = { languageCode: "zh" };
  await adapter.start(options);
  options.languageCode = "en";
  FakeSocket.instances[0].close(1011, "NET-0001");
  await waitFor(() => FakeSocket.instances.length === 2);
  expect(new URL(FakeSocket.instances[1].url).searchParams.get("language")).toBe("zh");
  expect(states.at(-1)?.status).toBe("connected");
  await adapter.stop();
  await adapter.start({ languageCode: null });
  expect(new URL(FakeSocket.instances[2].url).searchParams.get("language")).toBe("multi");
});

test("Deepgram caps replay at latest 500ms and reports dropped PCM", async () => {
  process.env.DEEPGRAM_STT_RECONNECT_BASE_MS = "20";
  process.env.DEEPGRAM_STT_RECONNECT_MAX_MS = "20";
  const { adapter, states } = setup();
  await adapter.start();
  FakeSocket.instances[0].close(1006, "network");
  const chunks = Array.from({ length: 20 }, (_, i) => new Uint8Array(1600).fill(i + 1));
  for (const chunk of chunks) adapter.pushAudio(chunk);
  await waitFor(() => FakeSocket.instances.length === 2);
  expect(FakeSocket.instances[1].sent).toEqual(chunks.slice(-10));
  expect(states.at(-1)).toMatchObject({ queuedAudioBytes: 16000, droppedAudioBytes: 16000, droppedAudioChunks: 10 });
});

test("Deepgram bounds oversized chunks and copies queued caller buffers", async () => {
  process.env.DEEPGRAM_STT_RECONNECT_BUFFER_MS = "1";
  process.env.DEEPGRAM_STT_RECONNECT_BASE_MS = "20";
  process.env.DEEPGRAM_STT_RECONNECT_MAX_MS = "20";
  const { adapter, states } = setup();
  await adapter.start();
  FakeSocket.instances[0].close(1006, "network");
  const chunk = Uint8Array.from({ length: 64 }, (_, i) => i);
  adapter.pushAudio(chunk);
  chunk.fill(0);
  await waitFor(() => FakeSocket.instances.length === 2);
  expect(FakeSocket.instances[1].sent).toEqual([Uint8Array.from({ length: 32 }, (_, i) => i + 32)]);
  expect(states.at(-1)?.droppedAudioBytes).toBe(32);
});

test("Deepgram audio send failure queues the rejected chunk and schedules one reconnect", async () => {
  const { adapter } = setup();
  await adapter.start();
  const first = FakeSocket.instances[0];
  const oldError = first.onerror;
  first.send = () => { throw new Error("write failed"); };
  adapter.pushAudio(new Uint8Array([1, 2]));
  oldError?.();
  await waitFor(() => FakeSocket.instances.length === 2);
  expect(FakeSocket.instances[1].sent).toEqual([new Uint8Array([1, 2])]);
});

test("Deepgram replay failure preserves all unsent chunks in order for the next socket", async () => {
  FakeSocket.autoOpen = false;
  const { adapter } = setup();
  const started = adapter.start();
  const result = started.catch((error) => error);
  adapter.pushAudio(new Uint8Array([1, 2]));
  adapter.pushAudio(new Uint8Array([3, 4]));
  adapter.pushAudio(new Uint8Array([5, 6]));
  const first = FakeSocket.instances[0];
  const send = first.send.bind(first);
  first.send = (data) => { if (first.sent.length === 1) throw new Error("second send failed"); send(data); };
  first.open();
  expect(await result).toBeInstanceOf(Error);
  await waitFor(() => FakeSocket.instances.length === 2);
  const second = FakeSocket.instances[1];
  second.open();
  expect(first.sent).toEqual([new Uint8Array([1, 2])]);
  expect(second.sent).toEqual([new Uint8Array([3, 4]), new Uint8Array([5, 6])]);
});

test("Deepgram ignores saved late event callbacks from a retired socket", async () => {
  const { adapter, states, transcripts } = setup();
  await adapter.start();
  const first = FakeSocket.instances[0];
  const old = { close: first.onclose, open: first.onopen, error: first.onerror, message: first.onmessage };
  first.close(1006, "network");
  await waitFor(() => FakeSocket.instances.length === 2);
  const before = states.length;
  old.close?.({ code: 1006, reason: "late close", wasClean: false });
  old.open?.(); old.error?.();
  old.message?.({ data: JSON.stringify({ channel: { alternatives: [{ transcript: "old text" }] }, is_final: true }) });
  adapter.pushAudio(new Uint8Array([7, 8]));
  await sleep();
  expect(states).toHaveLength(before);
  expect(transcripts).toHaveLength(0);
  expect(FakeSocket.instances).toHaveLength(2);
  expect(FakeSocket.instances[1].sent).toContainEqual(new Uint8Array([7, 8]));
});

for (const method of ["stop", "close"] as const) {
  test(`Deepgram ${method} during handshake settles all starts and prevents later retry`, async () => {
    FakeSocket.autoOpen = false;
    const { adapter, states } = setup();
    const first = adapter.start().catch((error) => error);
    const second = adapter.start().catch((error) => error);
    await adapter[method]();
    expect(await first).toHaveProperty("name", "AbortError");
    expect(await second).toHaveProperty("name", "AbortError");
    adapter.pushAudio(new Uint8Array([1, 2]));
    FakeSocket.instances[0].open();
    await sleep();
    expect(states.at(-1)?.status).toBe("stopped");
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].onmessage).toBeNull();
  });
  test(`Deepgram ${method} cancels a scheduled reconnect and drops stopped audio`, async () => {
    const { adapter } = setup();
    await adapter.start();
    FakeSocket.instances[0].close(1006, "network");
    await adapter[method]();
    adapter.pushAudio(new Uint8Array([1, 2]));
    await sleep();
    expect(FakeSocket.instances).toHaveLength(1);
    await adapter.start();
    expect(FakeSocket.instances[1].sent).toHaveLength(0);
  });
}

test("Deepgram handshake timeout retires transport, retries finitely, and leaves no hanging start", async () => {
  FakeSocket.autoOpen = false;
  process.env.DEEPGRAM_STT_CONNECT_TIMEOUT_MS = "5";
  process.env.DEEPGRAM_STT_RECONNECT_ATTEMPTS = "1";
  const { adapter, states, errors } = setup();
  await expect(adapter.start()).rejects.toThrow("handshake timed out");
  await waitFor(() => states.at(-1)?.status === "failed");
  expect(FakeSocket.instances).toHaveLength(2);
  expect(FakeSocket.instances.every((socket) => socket.readyState === FakeSocket.CLOSED)).toBe(true);
  expect(errors).toHaveLength(1);
  await sleep();
  expect(FakeSocket.instances).toHaveLength(2);
});

test("Deepgram synchronous constructor failure releases opening and can recover", async () => {
  FakeSocket.constructorFailures = 1;
  const { adapter, states } = setup();
  await expect(adapter.start()).rejects.toThrow("constructor failed");
  await waitFor(() => states.at(-1)?.status === "connected");
  await adapter.start();
  expect(FakeSocket.instances).toHaveLength(1);
});

test("Deepgram pre-open asynchronous error rejects start and reconnects", async () => {
  FakeSocket.autoOpen = false;
  const { adapter, states } = setup();
  const result = adapter.start().catch((error) => error);
  FakeSocket.instances[0].onerror?.();
  expect(await result).toBeInstanceOf(Error);
  await waitFor(() => FakeSocket.instances.length === 2);
  FakeSocket.instances[1].open();
  expect(states.at(-1)?.status).toBe("connected");
});

test("Deepgram nonretryable audio/auth failure reports failed and does not reconnect", async () => {
  const { adapter, states, errors } = setup();
  await adapter.start();
  FakeSocket.instances[0].close(1008, "DATA-0000");
  await sleep();
  expect(states.at(-1)?.status).toBe("failed");
  expect(errors).toHaveLength(1);
  expect(FakeSocket.instances).toHaveLength(1);
});

test("Deepgram finalization send/close failure still releases all ownership", async () => {
  const { adapter, states } = setup();
  await adapter.start();
  const first = FakeSocket.instances[0];
  first.send = () => { throw new Error("send failed"); };
  first.close = () => { throw new Error("close failed"); };
  await adapter.stop();
  expect(states.at(-1)?.status).toBe("stopped");
  await adapter.start();
  expect(FakeSocket.instances).toHaveLength(2);
});

test("Deepgram old stop cannot close the socket or queue of a subsequent start", async () => {
  process.env.EVENHUB_STT_FINALIZE_WAIT_MS = "10";
  const { adapter, states, transcripts } = setup();
  await adapter.start();
  const stop = adapter.stop();
  await adapter.start();
  const current = FakeSocket.instances[1];
  await stop;
  current.message("current final");
  adapter.pushAudio(new Uint8Array([1, 2]));
  expect(current.readyState).toBe(FakeSocket.OPEN);
  expect(states.at(-1)?.status).toBe("connected");
  expect(transcripts.at(-1)?.text).toBe("current final");
  expect(current.sent).toContainEqual(new Uint8Array([1, 2]));
});
