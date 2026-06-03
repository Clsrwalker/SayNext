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
  buttonHandler: ((event: unknown) => void) | null = null;

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
    onButtonPress: (handler: (event: unknown) => void) => {
      this.buttonHandler = handler;
      return () => {
        this.buttonHandler = null;
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

test("g2 manual mode commits transcript and shows heard status without automatic answer generation", async () => {
  const { session, handler } = makeManualHandler();

  await handler.processTranscript("Could you explain why database indexing changes query latency?", Date.now(), "isFinal");

  const state = handler.getManualState();
  expect(state.mode).toBe("g2_manual");
  expect(state.transcriptCount).toBe(1);
  expect(state.lastGeneratedCursor).toBeNull();
  expect(state.currentAnswer).toBeNull();
  expect(session.displays.at(-1)?.text).toBe("SAYNEXT | HEARD / TAP R1\n\nNew speech captured. Tap R1 for the next reply.");
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
  expect(session.clearCount).toBe(0);
  expect(session.displays.at(-1)?.text).toBe("SAYNEXT | LISTENING\n\nListening. Tap R1 after speech.");
});

test("g2 manual mode shows heard status on glasses while preserving pinned answer text", async () => {
  const { session, handler } = makeManualHandler();

  (handler as any).currentManualAnswer = {
    answerGroupId: "manual_group_test",
    answerId: "manual_answer_test",
    requestId: "manual_req_test",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    output: "Old pinned answer.",
    pages: ["Old pinned answer."],
    pageIndex: 0,
    createdAt: Date.now(),
  };

  await handler.processTranscript("What should I answer next?", Date.now(), "isFinal");

  expect(session.displays.at(-1)?.text).toBe("SAYNEXT | HEARD / TAP R1\n\nOld pinned answer.");
});

test("g2 single tap delays manual generation through gesture arbitration", async () => {
  const session = new MockUserSession();
  const user = new User("manual-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  expect(session.displays.at(-1)?.text).toBe("SAYNEXT | LISTENING\n\nListening. Tap R1 after speech.");
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

test("g2 long press is ignored by SayNext because the system may reserve it", async () => {
  const session = new MockUserSession();
  const user = new User("manual-long-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  session.touchHandler?.({ gesture: "long_press" });
  await sleep(20);

  expect(events.some((event) => event.type === "manual_gesture_ignored" && event.reason === "long_press_reserved")).toBe(true);
  expect(session.clearCount).toBe(0);
  user.cleanup();
});

test("g2 scroll gestures do not page or refresh the pinned manual answer", async () => {
  const session = new MockUserSession();
  const user = new User("manual-scroll-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  session.touchHandler?.({ gesture: "swipe_down" });
  session.touchHandler?.({ gesture: "swipe_up" });
  await sleep(20);

  expect(events.some((event) => event.type === "manual_gesture_ignored" && event.reason === "manual_answer_is_single_scroll_box")).toBe(true);
  expect(events.some((event) => String(event.reason || "").startsWith("manual_page_"))).toBe(false);
  user.cleanup();
});

test("g2 two short button presses are treated as double tap", async () => {
  const session = new MockUserSession();
  const user = new User("manual-button-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  session.buttonHandler?.({ type: "button_press", buttonId: "r1", pressType: "short" });
  session.buttonHandler?.({ type: "button_press", buttonId: "r1", pressType: "short" });
  await sleep(330);

  expect(events.some((event) => event.type === "manual_gesture_payload" && event.source === "button")).toBe(true);
  expect(events.some((event) => event.reason === "manual_no_current_answer")).toBe(true);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(false);
  user.cleanup();
});
