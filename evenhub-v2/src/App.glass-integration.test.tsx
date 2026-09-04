// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const glassHarness = vi.hoisted(() => ({
  onEvent: null as ((event: unknown) => void) | null,
  onAudio: null as ((audio: { pcm: Uint8Array; source: "glasses" | "phone" }) => void) | null,
  failDetailRender: false,
  detailRenderGate: null as Promise<void> | null,
  menuRenderGate: null as Promise<void> | null,
  renderedViews: [] as string[],
  render: vi.fn<(page: { view: string }) => Promise<void>>(),
  updateTextContainer: vi.fn(async () => true),
  setAudioEnabled: vi.fn(async () => true),
  dispose: vi.fn(),
}));

vi.mock("./glasses-bridge", () => ({
  connectGlassBridge: vi.fn(async (params: {
    initialPage: { view: string };
    onEvent: (event: unknown) => void;
    onAudio: (audio: { pcm: Uint8Array; source: "glasses" | "phone" }) => void;
  }) => {
    glassHarness.onEvent = params.onEvent;
    glassHarness.onAudio = params.onAudio;
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
    glassHarness.detailRenderGate = null;
    glassHarness.menuRenderGate = null;
    glassHarness.renderedViews = [];
    glassHarness.render.mockReset();
    glassHarness.render.mockImplementation(async (page) => {
      glassHarness.renderedViews.push(page.view);
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
  });

  test("does not commit cue_detail when the native detail render fails", async () => {
    const socket = await mountStartedAppWithCue();

    glassHarness.failDetailRender = true;
    await emitGlassEvent({
      listEvent: {
        eventType: 0,
        currentSelectItemIndex: 0,
        currentSelectItemName: "? Project answer",
      },
    });
    await waitFor(() => {
      expect(glassHarness.renderedViews.filter((view) => view === "cue_detail")).toHaveLength(2);
    });

    glassHarness.failDetailRender = false;
    await emitGlassEvent({
      listEvent: { eventType: 3 },
    });

    const doubleClickDiagnostic = glassDiagnostics(socket)
      .filter((message) => message.payload?.operation === "r1_event")
      .reverse()
      .find((message) => message.payload?.gesture === "double_click");

    expect(doubleClickDiagnostic?.payload).toMatchObject({
      view: "menu",
      targetView: "main",
      gesture: "double_click",
    });
  });

  test("uses the menu items that actually finished rendering when a new cue arrives", async () => {
    const socket = await mountStartedAppWithCue("cue-visible");
    let releaseMenuRender = () => {};
    glassHarness.menuRenderGate = new Promise<void>((resolve) => {
      releaseMenuRender = resolve;
    });

    await act(async () => {
      socket.receive(serverMessage("cue_created", {
        cueId: "cue-not-rendered-yet",
        category: "response",
        title: "Newer answer",
        g2Title: "Newer answer",
        output: "This cue has arrived on the phone but its menu rebuild is still pending.",
        fullAnswer: "This cue has arrived on the phone but its menu rebuild is still pending.",
        createdAt: "2026-07-24T12:00:02.000Z",
      }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(glassHarness.renderedViews.filter((view) => view === "menu").length).toBeGreaterThan(1);
    });

    await emitGlassEvent({
      listEvent: {
        eventType: 0,
        currentSelectItemIndex: 0,
        currentSelectItemName: "? Project answer",
      },
    });

    const detailDiagnostic = glassDiagnostics(socket)
      .filter((message) => message.payload?.operation === "r1_event")
      .reverse()
      .find((message) => message.payload?.targetView === "cue_detail");

    expect(detailDiagnostic?.payload).toMatchObject({
      view: "menu",
      targetView: "cue_detail",
      selectedCueId: "cue-visible",
    });

    glassHarness.menuRenderGate = null;
    releaseMenuRender();
  });

  test("processes a second gesture from the last rendered view while detail rendering is pending", async () => {
    const socket = await mountStartedAppWithCue();
    let releaseDetailRender = () => {};
    glassHarness.detailRenderGate = new Promise<void>((resolve) => {
      releaseDetailRender = resolve;
    });

    await emitGlassEvent({
      listEvent: {
        eventType: 0,
        currentSelectItemIndex: 0,
        currentSelectItemName: "? Project answer",
      },
    });
    await waitFor(() => expect(glassHarness.renderedViews).toContain("cue_detail"));

    await emitGlassEvent({
      listEvent: { eventType: 3 },
    });

    const doubleClickDiagnostic = glassDiagnostics(socket)
      .filter((message) => message.payload?.operation === "r1_event")
      .reverse()
      .find((message) => message.payload?.gesture === "double_click");

    expect(doubleClickDiagnostic?.payload).toMatchObject({
      view: "menu",
      targetView: "main",
      gesture: "double_click",
    });

    glassHarness.detailRenderGate = null;
    releaseDetailRender();
  });

  test("keeps each code cue bound to its own detail container and complete source", async () => {
    const firstCode = [
      "class LruCache {",
      "  private readonly values = new Map<string, number>();",
      "",
      "  get(key: string): number | undefined {",
      "    return this.values.get(key);",
      "  }",
      "}",
    ].join("\n");
    const secondCode = [
      "function binarySearch(values: number[], target: number): number {",
      "  let left = 0;",
      "  let right = values.length - 1;",
      "",
      "  while (left <= right) {",
      "    const middle = Math.floor((left + right) / 2);",
      "    if (values[middle] === target) return middle;",
      "    if (values[middle] < target) left = middle + 1;",
      "    else right = middle - 1;",
      "  }",
      "",
      "  return -1;",
      "}",
    ].join("\n");
    const socket = await mountStartedAppWithCue("cue-code-lru", {
      category: "code",
      title: "Implement an LRU cache",
      g2Title: "LRU cache",
      output: firstCode,
      code: firstCode,
      language: "typescript",
      fullAnswer: firstCode,
    });

    await act(async () => {
      socket.receive(serverMessage("cue_created", {
        cueId: "cue-code-search",
        category: "code",
        title: "Implement binary search",
        g2Title: "Binary search",
        output: secondCode,
        code: secondCode,
        language: "typescript",
        fullAnswer: secondCode,
        createdAt: "2026-07-24T12:00:02.000Z",
      }));
    });
    await waitFor(() => {
      expect(glassHarness.renderedViews.filter((view) => view === "menu").length).toBeGreaterThan(1);
    });

    await emitGlassEvent({
      listEvent: {
        eventType: 0,
        currentSelectItemIndex: 0,
      },
    });
    await waitFor(() => {
      expect(glassHarness.updateTextContainer).toHaveBeenCalledWith(expect.objectContaining({
        name: "code-detail-cue-code-search",
        content: secondCode,
      }));
    });

    await emitGlassEvent({
      listEvent: { eventType: 3 },
    });
    await waitFor(() => {
      const latestDiagnostic = glassDiagnostics(socket)
        .filter((message) => message.payload?.operation === "r1_event")
        .at(-1);
      expect(latestDiagnostic?.payload).toMatchObject({
        view: "cue_detail",
        targetView: "menu",
      });
    });

    await emitGlassEvent({
      listEvent: {
        eventType: 0,
        currentSelectItemIndex: 1,
      },
    });
    await waitFor(() => {
      expect(glassHarness.updateTextContainer).toHaveBeenCalledWith(expect.objectContaining({
        name: "code-detail-cue-code-lru",
        content: firstCode,
      }));
    });

    const openedCodeIds = glassDiagnostics(socket)
      .filter((message) => (
        message.payload?.operation === "r1_event"
        && message.payload?.targetView === "cue_detail"
      ))
      .map((message) => message.payload?.selectedCueId);
    expect(openedCodeIds).toEqual(["cue-code-search", "cue-code-lru"]);
  });

  test("runs start, transcript, cue, end, and history recovery as one App lifecycle", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/conversations/conversation-lifecycle")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            conversation: {
              id: "conversation-lifecycle",
              title: "Lifecycle interview",
              startedAt: "2026-07-25T00:00:00.000Z",
              endedAt: "2026-07-25T00:01:00.000Z",
              durationMs: 60_000,
              usedPrenote: { ids: [], text: "" },
            },
            summary: {
              status: "ready",
              title: "Lifecycle interview",
              overview: "The interviewer asked about API integration.",
              keyPoints: [],
              actionItems: [],
            },
            transcript: [{
              id: "line-lifecycle",
              index: 0,
              text: "How did you integrate the API?",
              receivedAt: "2026-07-25T00:00:05.000Z",
            }],
            cues: [{
              id: "cue-lifecycle",
              category: "response",
              title: "Explain API integration",
              g2Title: "API integration",
              preview: "I first aligned the API contract.",
              fullAnswer: "I first aligned the API contract, then tested the full flow.",
              output: "I first aligned the API contract, then tested the full flow.",
              createdAt: "2026-07-25T00:00:06.000Z",
            }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => {
      expect(glassHarness.onEvent).not.toBeNull();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    await emitGlassEvent({ listEvent: { eventType: 0 } });
    await waitFor(() => {
      expect(clientMessages(socket).some((message) => message.type === "conversation_start")).toBe(true);
    });

    await act(async () => {
      socket.receive(serverMessage("conversation_started", {
        conversationId: "conversation-lifecycle",
      }));
    });
    await waitFor(() => {
      expect(clientMessages(socket).some((message) => message.type === "audio_start")).toBe(true);
    });
    await act(async () => {
      socket.receive(serverMessage("audio_status", {
        audioStatus: "listening",
        audioSource: "glasses",
      }));
      socket.receive(serverMessage("transcript_partial", {
        text: "How did you integrate",
        offsetMs: 4_000,
      }));
      socket.receive(serverMessage("transcript_final", {
        lineId: "line-lifecycle",
        index: 0,
        text: "How did you integrate the API?",
        receivedAt: "2026-07-25T00:00:05.000Z",
        offsetMs: 5_000,
      }));
      socket.receive(serverMessage("cue_created", {
        cueId: "cue-lifecycle",
        category: "response",
        title: "Explain API integration",
        g2Title: "API integration",
        output: "I first aligned the API contract, then tested the full flow.",
        fullAnswer: "I first aligned the API contract, then tested the full flow.",
        createdAt: "2026-07-25T00:00:06.000Z",
      }));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("How did you integrate the API?");
      expect(glassHarness.render.mock.calls.some(([page]) => (
        JSON.stringify(page).includes("I first aligned the API contract")
      ))).toBe(true);
    });

    const endButton = document.querySelector<HTMLButtonElement>("footer.live-actions button:last-child");
    expect(endButton).not.toBeNull();
    fireEvent.click(endButton!);
    await waitFor(() => {
      expect(clientMessages(socket).filter((message) => message.type === "conversation_end")).toHaveLength(1);
    });

    await act(async () => {
      socket.receive(serverMessage("conversation_saved", {
        conversationId: "conversation-lifecycle",
      }));
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => (
        String(url).includes("/api/evenhub/v2/conversations/conversation-lifecycle")
      ))).toBe(true);
      expect(document.body.textContent).toContain("The interviewer asked about API integration.");
    });
    await waitFor(() => {
      expect(glassHarness.renderedViews.at(-1)).toBe("root_idle");
    });
  });

  test("polls a queued summary until the history page receives the ready result", async () => {
    let detailRequestCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/conversations/conversation-summary-poll")) {
        detailRequestCount += 1;
        const ready = detailRequestCount > 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            conversation: {
              id: "conversation-summary-poll",
              title: ready ? "Ready summary title" : "Conversation",
              startedAt: "2026-07-25T00:00:00.000Z",
              endedAt: "2026-07-25T00:00:30.000Z",
              durationMs: 30_000,
              usedPrenote: { ids: [], text: "" },
            },
            summary: ready
              ? {
                  status: "ready",
                  title: "Ready summary title",
                  overview: "The final asynchronous summary is now visible.",
                  keyPoints: [],
                  actionItems: [],
                }
              : {
                  status: "queued",
                  title: "",
                  overview: "",
                  keyPoints: [],
                  actionItems: [],
                },
            transcript: [],
            cues: [],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => {
      expect(glassHarness.onEvent).not.toBeNull();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());
    await emitGlassEvent({ listEvent: { eventType: 0 } });
    await act(async () => {
      socket.receive(serverMessage("conversation_started", {
        conversationId: "conversation-summary-poll",
      }));
    });

    const endButton = document.querySelector<HTMLButtonElement>("footer.live-actions button:last-child");
    expect(endButton).not.toBeNull();
    fireEvent.click(endButton!);
    await act(async () => {
      socket.receive(serverMessage("conversation_saved", {
        conversationId: "conversation-summary-poll",
      }));
    });

    await waitFor(() => {
      expect(detailRequestCount).toBe(1);
      expect(document.body.textContent).not.toContain("The final asynchronous summary is now visible.");
    });
    await waitFor(() => {
      expect(detailRequestCount).toBeGreaterThanOrEqual(2);
      expect(document.body.textContent).toContain("The final asynchronous summary is now visible.");
    }, { timeout: 4_000 });
  });

  test("persists a changed glasses display setting through the real App request path", async () => {
    const savedSettings: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/settings") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { settings: Record<string, unknown> };
        savedSettings.push(body.settings);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const settingsButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(settingsButton);
    const aiCueToggle = await waitFor(() => {
      const toggles = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(toggles.length).toBeGreaterThanOrEqual(2);
      return toggles[0]!;
    });
    expect(aiCueToggle.checked).toBe(true);
    fireEvent.click(aiCueToggle);

    await waitFor(() => {
      expect(savedSettings.some((settings) => settings.showAiCue === false)).toBe(true);
    }, { timeout: 2_000 });
  });

  test("keeps a changed setting locally when server synchronization fails", async () => {
    let failedPatchCount = 0;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/settings") && init?.method === "PATCH") {
        failedPatchCount += 1;
        return { ok: false, status: 503, json: async () => ({ error: "offline" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const settingsButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(settingsButton);
    const aiCueToggle = await waitFor(() => {
      const toggles = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(toggles.length).toBeGreaterThanOrEqual(2);
      return toggles[0]!;
    });
    fireEvent.click(aiCueToggle);

    await waitFor(() => expect(failedPatchCount).toBeGreaterThan(0), { timeout: 2_000 });
    expect(aiCueToggle.checked).toBe(false);
    expect(JSON.parse(localStorage.getItem("saynext.evenhub.v2.settings") || "{}")).toMatchObject({
      glassContent: {
        aiCue: false,
        transcript: true,
      },
    });
  });

  test("creates a prenote through the editor and renders the server result on home", async () => {
    let savedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/prenotes") && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            prenote: {
              id: "prenote-server",
              title: "Interview facts",
              text: "Interview facts\nCueFlow uses a candidate buffer.",
              selected: true,
              files: [],
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const addButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button.add-note-card");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(addButton);
    const editor = await waitFor(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
      expect(textarea).not.toBeNull();
      return textarea!;
    });
    fireEvent.change(editor, {
      target: { value: "Interview facts\nCueFlow uses a candidate buffer." },
    });
    const saveButton = document.querySelector<HTMLButtonElement>("footer.bottom-actions button:last-child");
    expect(saveButton).not.toBeNull();
    expect(saveButton!.disabled).toBe(false);
    fireEvent.click(saveButton!);

    await waitFor(() => {
      expect(savedBody).toMatchObject({
        title: "Interview facts",
        text: "Interview facts\nCueFlow uses a candidate buffer.",
        selected: true,
      });
      expect(document.body.textContent).toContain("CueFlow uses a candidate buffer.");
    });
  });

  test("preserves a prenote draft when the server rejects the save", async () => {
    let failedSaveCount = 0;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/prenotes") && init?.method === "POST") {
        failedSaveCount += 1;
        return { ok: false, status: 500, json: async () => ({ error: "write_failed" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const addButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button.add-note-card");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(addButton);
    const editor = await waitFor(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
      expect(textarea).not.toBeNull();
      return textarea!;
    });
    fireEvent.change(editor, {
      target: { value: "Keep this draft if saving fails." },
    });
    const saveButton = document.querySelector<HTMLButtonElement>("footer.bottom-actions button:last-child");
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton!);

    await waitFor(() => expect(failedSaveCount).toBe(1));
    const retainedEditor = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(retainedEditor).not.toBeNull();
    expect(retainedEditor!.value).toBe("Keep this draft if saving fails.");
  });

  test("edits a saved prenote through the v2 patch endpoint", async () => {
    let patchedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/prenotes/108") && init?.method === "PATCH") {
        patchedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            prenote: {
              id: "108",
              title: "Updated interview facts",
              text: "Use the updated project result.",
              selected: true,
              files: [],
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [{
            id: "108",
            title: "Interview facts",
            text: "Use the old project result.",
            selected: true,
            files: [],
          }],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const editButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button.prenote-edit-button");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(editButton);

    const titleInput = await waitFor(() => document.querySelector<HTMLInputElement>("input.note-title-input"));
    const editor = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(titleInput).not.toBeNull();
    expect(editor).not.toBeNull();
    fireEvent.change(titleInput!, { target: { value: "Updated interview facts" } });
    fireEvent.change(editor!, { target: { value: "Use the updated project result." } });
    fireEvent.click(document.querySelector<HTMLButtonElement>("footer.bottom-actions button:last-child")!);

    await waitFor(() => {
      expect(patchedBody).toMatchObject({
        title: "Updated interview facts",
        text: "Use the updated project result.",
        selected: true,
      });
      expect(document.body.textContent).toContain("Use the updated project result.");
      expect(document.body.textContent).not.toContain("Use the old project result.");
    });
  });

  test("persists prenote selection and rolls the checkbox back when patching fails", async () => {
    let selectionPatchCount = 0;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/prenotes/109") && init?.method === "PATCH") {
        selectionPatchCount += 1;
        return { ok: false, status: 503, json: async () => ({ error: "offline" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [{
            id: "109",
            title: "Selection note",
            text: "Selection should survive reload after a successful request.",
            selected: false,
            files: [],
          }],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const selectButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button.prenote-select-button");
      expect(button).not.toBeNull();
      return button!;
    });
    expect(document.querySelector(".note-checkbox.checked")).toBeNull();
    fireEvent.click(selectButton);

    await waitFor(() => expect(selectionPatchCount).toBe(1));
    await waitFor(() => expect(document.querySelector(".note-checkbox.checked")).toBeNull());
  });

  test("deletes a saved prenote only after the v2 delete endpoint succeeds", async () => {
    let deleteCount = 0;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/prenotes/110") && init?.method === "DELETE") {
        deleteCount += 1;
        return { ok: true, status: 200, json: async () => ({ deleted: true, id: "110" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [{
            id: "110",
            title: "Delete this prenote",
            text: "This prenote should disappear.",
            selected: false,
            files: [],
          }],
          conversations: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);
    const editButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button.prenote-edit-button");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(editButton);
    const deleteButton = await waitFor(() => document.querySelector<HTMLButtonElement>("footer.bottom-actions button:first-child"));
    expect(deleteButton).not.toBeNull();
    fireEvent.click(deleteButton!);

    await waitFor(() => {
      expect(deleteCount).toBe(1);
      expect(document.body.textContent).not.toContain("Delete this prenote");
    });
  });

  test("removes a conversation only after the delete endpoint succeeds", async () => {
    let deleteCount = 0;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/conversations/conversation-delete") && init?.method === "DELETE") {
        deleteCount += 1;
        return { ok: true, status: 200, json: async () => ({ deleted: true }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [{
            id: "conversation-delete",
            title: "Delete this conversation",
            startedAt: "2026-07-25T00:00:00.000Z",
            endedAt: "2026-07-25T00:01:00.000Z",
            durationMs: 60_000,
            summaryStatus: "ready",
          }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(document.body.textContent).toContain("Delete this conversation"));
    const deleteButton = document.querySelector<HTMLButtonElement>("button.record-delete-button");
    expect(deleteButton).not.toBeNull();
    fireEvent.click(deleteButton!);

    await waitFor(() => {
      expect(deleteCount).toBe(1);
      expect(document.body.textContent).not.toContain("Delete this conversation");
    });
  });

  test("keeps a conversation visible when the delete endpoint fails", async () => {
    let deleteCount = 0;
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("/api/evenhub/v2/conversations/conversation-delete-failure") && init?.method === "DELETE") {
        deleteCount += 1;
        return { ok: false, status: 503, json: async () => ({ error: "offline" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          settingsSource: "default",
          prenotes: [],
          conversations: [{
            id: "conversation-delete-failure",
            title: "Keep this conversation",
            startedAt: "2026-07-25T00:00:00.000Z",
            endedAt: "2026-07-25T00:01:00.000Z",
            durationMs: 60_000,
            summaryStatus: "ready",
          }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(document.body.textContent).toContain("Keep this conversation"));
    const deleteButton = document.querySelector<HTMLButtonElement>("button.record-delete-button");
    expect(deleteButton).not.toBeNull();
    fireEvent.click(deleteButton!);

    await waitFor(() => expect(deleteCount).toBe(1));
    expect(document.body.textContent).toContain("Keep this conversation");
  });

  test("recovers one active conversation after a websocket disconnect without starting a duplicate", async () => {
    render(<App />);
    await waitFor(() => {
      expect(glassHarness.onEvent).not.toBeNull();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const firstSocket = FakeWebSocket.instances[0]!;
    await act(async () => firstSocket.open());
    await emitGlassEvent({ listEvent: { eventType: 0 } });

    await act(async () => {
      firstSocket.receive(serverMessage("conversation_started", {
        conversationId: "conversation-reconnect",
      }));
    });
    await waitFor(() => {
      expect(clientMessages(firstSocket).some((message) => message.type === "audio_start")).toBe(true);
    });
    await act(async () => {
      firstSocket.receive(serverMessage("audio_status", {
        audioStatus: "listening",
        audioSource: "glasses",
      }));
      firstSocket.disconnect();
    });

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(2);
    }, { timeout: 3_000 });
    const reconnectSocket = FakeWebSocket.instances[1]!;
    expect(reconnectSocket.url).toBe(firstSocket.url);
    await act(async () => reconnectSocket.open());
    await act(async () => {
      reconnectSocket.receive(serverMessage("ready", {
        conversationId: "conversation-reconnect",
        conversationStatus: "active",
        audioStatus: "stopped",
      }));
    });

    await waitFor(() => {
      expect(clientMessages(reconnectSocket).filter((message) => message.type === "audio_start")).toHaveLength(1);
    });
    expect(clientMessages(reconnectSocket).filter((message) => message.type === "conversation_start")).toHaveLength(0);

    await act(async () => {
      reconnectSocket.receive(serverMessage("ready", {
        conversationId: "conversation-reconnect",
        conversationStatus: "active",
        audioStatus: "listening",
      }));
    });
    expect(clientMessages(reconnectSocket).filter((message) => message.type === "audio_start")).toHaveLength(1);
  });

  test("forwards SDK PCM to the websocket only after the server activates audio", async () => {
    render(<App />);
    await waitFor(() => {
      expect(glassHarness.onEvent).not.toBeNull();
      expect(glassHarness.onAudio).not.toBeNull();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());
    await emitGlassEvent({ listEvent: { eventType: 0 } });

    const pcmBeforeStart = new Uint8Array([1, 2, 3, 4]);
    await act(async () => {
      glassHarness.onAudio?.({ pcm: pcmBeforeStart, source: "glasses" });
    });
    expect(socket.sent.filter((message) => typeof message !== "string")).toHaveLength(0);

    await act(async () => {
      socket.receive(serverMessage("conversation_started", {
        conversationId: "conversation-audio",
      }));
      socket.receive(serverMessage("audio_status", {
        audioStatus: "listening",
        audioSource: "glasses",
      }));
    });

    const pcm = new Uint8Array([10, 20, 30, 40, 50, 60]);
    await act(async () => {
      glassHarness.onAudio?.({ pcm, source: "glasses" });
    });
    const binaryMessages = socket.sent.filter((message) => typeof message !== "string");
    expect(binaryMessages).toHaveLength(1);
    expect(Array.from(binaryMessages[0] as Uint8Array)).toEqual([10, 20, 30, 40, 50, 60]);
  });
});
