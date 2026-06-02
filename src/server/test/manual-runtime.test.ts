import { expect, test } from "bun:test";
import type { AppSession } from "@mentra/sdk";
import { LocationManager } from "../manager/LocationManager";
import { MergeResponseHandler } from "../mastra/agents/response-handler";
import { User } from "../session/User";

type DisplayCall = {
  text: string;
  durationMs?: number;
};

class MockSession {
  displays: DisplayCall[] = [];
  clearCount = 0;

  layouts = {
    showTextWall: (text: string, options: { durationMs?: number } = {}) => {
      this.displays.push({ text, durationMs: options.durationMs });
    },
    clearView: () => {
      this.clearCount += 1;
    },
  };

  logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

class MockUserSession extends MockSession {
  touchHandler: ((event: unknown) => void) | null = null;

  simpleStorage = {
    get: async (key: string) => key === "interaction_mode" ? "g2_manual" : undefined,
    set: async () => undefined,
  };

  events = {
    onTranscriptionForLanguage: () => () => undefined,
    onDisconnected: () => () => undefined,
    onPermissionDenied: () => () => undefined,
    onPermissionError: () => () => undefined,
    onTouchEvent: (handler: (event: unknown) => void) => {
      this.touchHandler = handler;
      return () => {
        this.touchHandler = null;
      };
    },
  };
}

function withConversationStateDisabled<T>(run: () => T): T {
  const previous = process.env.OPENAI_CONVERSATION_STATE_ENABLED;
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = "false";
  const restore = () => {
    if (previous === undefined) delete process.env.OPENAI_CONVERSATION_STATE_ENABLED;
    else process.env.OPENAI_CONVERSATION_STATE_ENABLED = previous;
  };

  try {
    const result = run();
    if (result && typeof (result as any).finally === "function") {
      return ((result as unknown) as Promise<unknown>).finally(restore) as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function makeManualHandler() {
  return withConversationStateDisabled(() => {
    const session = new MockSession();
    const handler = new MergeResponseHandler(
      session as unknown as AppSession,
      "manual-test-user",
      new LocationManager("manual-test-user"),
      "high",
      "english",
      "g2_manual",
    );
    return { session, handler };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("g2 manual mode commits transcript without automatic display generation", async () => {
  const { session, handler } = makeManualHandler();

  await handler.processTranscript("Could you explain why database indexing changes query latency?", Date.now(), "isFinal");

  const state = handler.getManualState();
  expect(state.mode).toBe("g2_manual");
  expect(state.transcriptCount).toBe(1);
  expect(state.lastGeneratedCursor).toBeNull();
  expect(state.currentAnswer).toBeNull();
  expect(session.displays).toEqual([]);
});

test("manual generate returns no_new_speech before any committed transcript", async () => {
  const { handler } = makeManualHandler();

  const result = await handler.generateManualAnswer("same-event");
  const replay = await handler.generateManualAnswer("same-event");

  expect(result.status).toBe("no_new_speech");
  expect(replay).toEqual(result);
  expect(result.state.lastGeneratedCursor).toBeNull();
});

test("manual clear cancels display state without advancing transcript cursor", async () => {
  const { session, handler } = makeManualHandler();

  await handler.processTranscript("What is the difference between optimistic and pessimistic locking?", Date.now(), "isFinal");
  const before = handler.getManualState();
  const result = handler.clearManualAnswer("clear-event");
  const replay = handler.clearManualAnswer("clear-event");

  expect(before.transcriptCount).toBe(1);
  expect(result.status).toBe("cleared");
  expect(replay).toEqual(result);
  expect(result.state.transcriptCount).toBe(1);
  expect(result.state.lastGeneratedCursor).toBeNull();
  expect(session.clearCount).toBe(1);
});

test("g2 single tap delays manual generation through gesture arbitration", async () => {
  const session = new MockUserSession();
  const user = new User("manual-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  session.touchHandler?.({ gesture: "single_tap" });

  expect(events.some((event) => event.type === "manual_gesture_pending")).toBe(true);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(false);

  await sleep(330);

  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(true);
  user.cleanup();
});

test("g2 double tap cancels pending single tap generation", async () => {
  const session = new MockUserSession();
  const user = new User("manual-double-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  session.touchHandler?.({ gesture: "single_tap" });
  session.touchHandler?.({ gesture: "double_tap" });
  await sleep(330);

  expect(events.some((event) => event.type === "manual_gesture_cancelled")).toBe(true);
  expect(events.some((event) => event.reason === "manual_no_current_answer")).toBe(true);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(false);
  user.cleanup();
});
