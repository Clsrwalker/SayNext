// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";

const glassHarness = vi.hoisted(() => ({
  onEvent: null as ((event: unknown) => void) | null,
  onAudio: null as ((audio: { pcm: Uint8Array; source: "glasses" | "phone" }) => void) | null,
  failDetailRender: false,
  initialGate: null as Promise<void> | null,
  mainGate: null as Promise<void> | null,
  detailRenderGate: null as Promise<void> | null,
  menuRenderGate: null as Promise<void> | null,
  renderedViews: [] as string[],
  render: vi.fn<(page: { view: string }) => Promise<void>>(),
  updateTextContainer: vi.fn(async () => true),
  setAudioEnabled: vi.fn(async () => true),
  dispose: vi.fn(),
}));

vi.mock("../src/glasses-bridge", () => ({
  connectGlassBridge: vi.fn(async (params: {
    initialPage: { view: string };
    onEvent: (event: unknown) => void;
    onAudio: (audio: { pcm: Uint8Array; source: "glasses" | "phone" }) => void;
  }) => {
    glassHarness.onEvent = params.onEvent;
    glassHarness.onAudio = params.onAudio;
    if (glassHarness.initialGate) await glassHarness.initialGate;
    await glassHarness.render(params.initialPage);
    return {
      bridge: {},
      render: glassHarness.render,
      updateTextContainer: glassHarness.updateTextContainer,
      setAudioEnabled: glassHarness.setAudioEnabled,
      dispose: glassHarness.dispose,
    };
  }),
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(message: Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent("message", {
      data: JSON.stringify(message),
    }));
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  disconnect(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", {
      code: 1006,
      reason: "network_lost",
      wasClean: false,
    }));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

function serverMessage(type: string, payload: Record<string, unknown> = {}) {
  return {
    protocolVersion: "evenhub-v2.1",
    messageId: `server-${type}`,
    serverSeq: 1,
    timestamp: "2026-07-24T12:00:00.000Z",
    type,
    payload,
  };
}

function glassDiagnostics(socket: FakeWebSocket) {
  return socket.sent
    .filter((message): message is string => typeof message === "string")
    .map((message) => JSON.parse(message) as {
      type?: string;
      payload?: Record<string, unknown>;
    })
    .filter((message) => message.type === "glass_diagnostic");
}

function clientMessages(socket: FakeWebSocket) {
  return socket.sent
    .filter((message): message is string => typeof message === "string")
    .map((message) => JSON.parse(message) as {
      type?: string;
      payload?: Record<string, unknown>;
    });
}

async function emitGlassEvent(event: unknown): Promise<void> {
  await act(async () => {
    glassHarness.onEvent?.(event);
    await Promise.resolve();
  });
}

async function mountStartedAppWithCue(
  cueId = "cue-response-1",
  cueOverrides: Record<string, unknown> = {},
): Promise<FakeWebSocket> {
  render(<App />);

  await waitFor(() => {
    expect(glassHarness.onEvent).not.toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  const socket = FakeWebSocket.instances[0]!;
  await act(async () => socket.open());

  await emitGlassEvent({
    listEvent: { eventType: 0 },
  });
  await waitFor(() => expect(glassHarness.renderedViews).toContain("main"));

  await act(async () => {
    socket.receive(serverMessage("conversation_started", {
      conversationId: "conversation-1",
    }));
    socket.receive(serverMessage("cue_created", {
      cueId,
      category: "response",
      title: "Answer the project question",
      g2Title: "Project answer",
      output: "I focused on the integration work and made the demo reliable.",
      fullAnswer: "I focused on the integration work and made the demo reliable.",
      createdAt: "2026-07-24T12:00:01.000Z",
      ...cueOverrides,
    }));
  });

  await emitGlassEvent({
    listEvent: { eventType: 0 },
  });
  await waitFor(() => expect(glassHarness.renderedViews).toContain("menu"));
  return socket;
}

describe("App glasses interaction contract", () => {
  beforeEach(() => {
    localStorage.clear();
    FakeWebSocket.instances = [];
    glassHarness.onEvent = null;
    glassHarness.onAudio = null;
    glassHarness.failDetailRender = false;
    glassHarness.initialGate = null;
    glassHarness.mainGate = null;
    glassHarness.detailRenderGate = null;
    glassHarness.menuRenderGate = null;
    glassHarness.renderedViews = [];
    glassHarness.render.mockReset();
    glassHarness.render.mockImplementation(async (page) => {
      glassHarness.renderedViews.push(page.view);
      if (page.view === "main" && glassHarness.mainGate) await glassHarness.mainGate;
      if (page.view === "menu" && glassHarness.menuRenderGate) {
        await glassHarness.menuRenderGate;
      }
      if (page.view === "cue_detail" && glassHarness.detailRenderGate) {
        await glassHarness.detailRenderGate;
      }
      if (glassHarness.failDetailRender && page.view === "cue_detail") {
        throw new Error("rebuild_page_failed");
      }
    });
    glassHarness.updateTextContainer.mockClear();
    glassHarness.setAudioEnabled.mockClear();
    glassHarness.dispose.mockClear();

    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        settingsSource: "default",
        prenotes: [],
        conversations: [],
      }),
    })));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("AUDIT: disabled autoPopup still renders received cue on main", async () => {
    localStorage.setItem("saynext.evenhub.v2.settings", JSON.stringify({autoPopup:false,cueDuration:5000}));
    const socket = await mountStartedAppWithCue("audit-popup");
    await emitGlassEvent({listEvent:{eventType:3}});
    const mainPages = glassHarness.render.mock.calls.map(call=>call[0] as any).filter(page=>page.view === "main");
    expect(mainPages.at(-1).containers.find((c:any)=>c.name === "ai-cue").content).toContain("I focused");
    expect(JSON.parse(localStorage.getItem("saynext.evenhub.v2.settings")!).autoPopup).toBe(false);
  });

  test("AUDIT: finite cueDuration does not clear without another transcript/gesture", async () => {
    localStorage.setItem("saynext.evenhub.v2.settings", JSON.stringify({cueDuration:5000}));
    await mountStartedAppWithCue("audit-expiry");
    await emitGlassEvent({listEvent:{eventType:3}});
    const callCount=glassHarness.render.mock.calls.length;
    vi.useFakeTimers();
    await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
    expect(glassHarness.render.mock.calls.length).toBe(callCount);
    const last=glassHarness.render.mock.calls.at(-1)![0] as any;
    expect(last.containers.find((c:any)=>c.name === "ai-cue").content).toContain("I focused");
  });

  test("AUDIT: cancel exit from idle leaves main without any conversation start", async()=>{
    render(<App/>);
    await waitFor(()=>expect(glassHarness.onEvent).not.toBeNull());
    const socket=FakeWebSocket.instances[0]!;
    await act(async()=>socket.open());
    await emitGlassEvent({sysEvent:{eventType:3}});
    await waitFor(()=>expect(glassHarness.renderedViews.at(-1)).toBe("exit_confirm"));
    await emitGlassEvent({sysEvent:{eventType:0}});
    await waitFor(()=>expect(glassHarness.renderedViews.at(-1)).toBe("main"));
    expect(clientMessages(socket).filter(m=>m.type === "conversation_start")).toHaveLength(0);
    expect(glassHarness.setAudioEnabled).not.toHaveBeenCalled();
  });

  test("AUDIT: startup catchup loses the page received while catchup rebuild is pending", async()=>{
    let resolveInitial!:()=>void;
    let resolveMain!:()=>void;
    glassHarness.initialGate=new Promise<void>(resolve=>{resolveInitial=resolve;});
    glassHarness.mainGate=new Promise<void>(resolve=>{resolveMain=resolve;});
    const app=render(<App/>);
    await waitFor(()=>expect(glassHarness.onEvent).not.toBeNull());
    const socket=FakeWebSocket.instances[0]!;
    await act(async()=>socket.open());
    fireEvent.click(app.getByRole("button",{name:/开始/}));
    await act(async()=>{resolveInitial();await Promise.resolve();});
    await waitFor(()=>expect(glassHarness.renderedViews).toContain("main"));
    await act(async()=>{
      socket.receive(serverMessage("conversation_started",{conversationId:"startup-audit"}));
      socket.receive(serverMessage("cue_created",{cueId:"late-cue",category:"response",title:"Late cue",output:"MISSING DURING STARTUP",fullAnswer:"MISSING DURING STARTUP"}));
    });
    await act(async()=>{glassHarness.mainGate=null;resolveMain();await Promise.resolve();});
    const pages=glassHarness.render.mock.calls.map(call=>call[0] as any);
    expect(pages.some(page=>page.containers.some((c:any)=>c.content?.includes("MISSING DURING STARTUP")))).toBe(false);
    // A phone navigation render cannot flush the lost glass update either.
    fireEvent.click(app.getByRole("button",{name:"Conversation settings"}));
    expect(glassHarness.render.mock.calls.length).toBe(pages.length);
  });

  test("AUDIT: pause during foreground restart still re-enables native microphone after stop resolves", async()=>{
    await mountStartedAppWithCue("restart-audit");
    let releaseStop!: (value:boolean)=>void;
    const stopped=new Promise<boolean>(resolve=>{releaseStop=resolve;});
    glassHarness.setAudioEnabled.mockImplementationOnce(async()=>stopped);
    vi.useFakeTimers();
    await emitGlassEvent({sysEvent:{eventType:4}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(1100);});
    expect(glassHarness.setAudioEnabled.mock.calls.at(-1)?.[0]).toBe(false);
    const pause=Array.from(document.querySelectorAll("button")).find(el=>el.textContent?.includes("暂停"))!;
    fireEvent.click(pause);
    await act(async()=>{releaseStop(true);await Promise.resolve();});
    expect(glassHarness.setAudioEnabled.mock.calls.at(-1)?.[0]).toBe(true);
    expect(document.body.textContent).toContain("继续");
  });

  test("AUDIT: PCM received after first-chunk timeout never clears no-audio error", async()=>{
    await mountStartedAppWithCue("late-audio");
    const pause=Array.from(document.querySelectorAll("button")).find(el=>el.textContent?.includes("暂停"))!;
    fireEvent.click(pause);
    vi.useFakeTimers();
    fireEvent.click(pause);
    await act(async()=>{await vi.advanceTimersByTimeAsync(3100);});
    expect(document.body.textContent).toContain("g2_mic_no_audio");
    await act(async()=>{glassHarness.onAudio?.({source:"glasses",pcm:new Uint8Array([1,2])});});
    expect(document.body.textContent).toContain("g2_mic_no_audio");
    const socket=FakeWebSocket.instances[0]!;
    expect(socket.sent.some(value=>value instanceof Uint8Array)).toBe(true);
  });
});
