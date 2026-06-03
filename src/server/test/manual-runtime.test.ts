import { expect, test } from "bun:test";
import type { AppSession } from "@mentra/sdk";
import { LocationManager } from "../manager/LocationManager";
import { MergeResponseHandler, paginateManualAnswer } from "../mastra/agents/response-handler";
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
  transcriptionHandler: ((event: any) => void) | null = null;

  simpleStorage = {
    get: async (key: string) => key === "interaction_mode" ? "g2_manual" : undefined,
    set: async () => undefined,
  };

  events = {
    onTranscriptionForLanguage: (_language: string, handler: (event: any) => void) => {
      this.transcriptionHandler = handler;
      return () => {
        this.transcriptionHandler = null;
      };
    },
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
  expect(session.displays.at(-1)?.text).toBe("SN | HEARD TAP\nNew speech captured. Tap R1 for the next reply.");
});

test("manual generate returns no_new_speech briefly then restores listening", async () => {
  const { session, handler } = makeManualHandler();

  const result = await handler.generateManualAnswer("same-event");
  const replay = await handler.generateManualAnswer("same-event");

  expect(result.status).toBe("no_new_speech");
  expect(replay).toEqual(result);
  expect(result.state.lastGeneratedCursor).toBeNull();
  expect(session.displays.at(-1)?.text).toBe("SN | NO SPEECH\nNo new speech yet.");
  await sleep(1450);
  expect(session.displays.at(-1)?.text).toBe("SN | LISTEN\nListening. Tap R1 after speech.");
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
  expect(session.displays.at(-1)?.text).toBe("SN | LISTEN\nListening. Tap R1 after speech.");
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

  expect(session.displays.at(-1)?.text).toBe("SN | HEARD TAP\nOld pinned answer.");
});

test("manual no_new_speech restores the pinned answer after the hint", async () => {
  const { session, handler } = makeManualHandler();

  (handler as any).currentManualAnswer = {
    answerGroupId: "manual_group_pinned",
    answerId: "manual_answer_pinned",
    requestId: "manual_req_pinned",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    output: "Pinned answer stays visible.",
    pages: ["Pinned answer stays visible."],
    pageIndex: 0,
    createdAt: Date.now(),
  };

  const result = await handler.generateManualAnswer("no-speech-with-pinned-answer");

  expect(result.status).toBe("no_new_speech");
  expect(session.displays.at(-1)?.text).toBe("SN | NO SPEECH\nPinned answer stays visible.");
  await sleep(1450);
  expect(session.displays.at(-1)?.text).toBe("SN | LISTEN\nPinned answer stays visible.");
});

test("manual generate can commit the current partial transcript before final ASR", async () => {
  const session = new MockUserSession();
  const user = new User("manual-partial-flush-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  session.transcriptionHandler?.({
    text: "Can you explain B-tree index trade",
    isFinal: false,
    language: "en",
  });

  const committed = await (user as any).flushPartialTranscriptForManualGenerate("test_partial");

  expect(committed).toBe(true);
  expect((user as any).responseHandler.getManualState().transcriptCount).toBe(1);
  expect(session.displays.at(-1)?.text).toBe("SN | HEARD TAP\nNew speech captured. Tap R1 for the next reply.");
  expect(events.some((event) => event.type === "manual_partial_committed" && event.trigger === "test_partial")).toBe(true);
  user.cleanup();
});

test("g2 single tap delays manual generation through gesture arbitration", async () => {
  const session = new MockUserSession();
  const user = new User("manual-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  expect(session.displays.at(-1)?.text).toBe("SN | LISTEN\nListening. Tap R1 after speech.");
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

test("g2 long press is ignored and restores the manual display after system confirmation", async () => {
  const session = new MockUserSession();
  const user = new User("manual-long-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  const initialDisplayCount = session.displays.length;
  session.touchHandler?.({ gesture: "long_press" });
  await sleep(20);

  expect(events.some((event) => event.type === "manual_gesture_ignored" && event.reason === "long_press_reserved")).toBe(true);
  expect(session.displays.length).toBe(initialDisplayCount);
  await sleep(1250);
  expect(session.displays.at(-1)?.text).toBe("SN | LISTEN\nListening. Tap R1 after speech.");
  expect(session.clearCount).toBe(0);
  user.cleanup();
});

test("g2 scroll gestures page the pinned manual answer on glasses", async () => {
  const session = new MockUserSession();
  const user = new User("manual-scroll-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  (user as any).responseHandler.currentManualAnswer = {
    answerGroupId: "manual_group_scroll",
    answerId: "manual_answer_scroll",
    requestId: "manual_req_scroll",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    output: "First page.\nSecond page.\nThird page.",
    pages: ["First page.", "Second page.", "Third page."],
    pageIndex: 0,
    createdAt: Date.now(),
  };

  session.touchHandler?.({ gesture: "swipe_down" });
  expect(session.displays.at(-1)?.text).toBe("ANS | LISTEN 2/3\nSecond page.");

  session.touchHandler?.({ gesture: "swipe_up" });
  await sleep(20);
  expect(session.displays.at(-1)?.text).toBe("ANS | LISTEN 1/3\nFirst page.");

  expect(events.some((event) => event.reason === "manual_page_ok")).toBe(true);
  user.cleanup();
});

test("manual answer pagination stays within visible lines and preserves text", () => {
  const input = [
    "Database indexes usually improve reads by giving the query planner a smaller search path.",
    "The trade-off is slower writes and extra storage, because every insert or update may also update the index.",
    "For deep interview answers, mention selectivity, access pattern fit, and whether the index matches the where and order by clauses.",
  ].join(" ");

  const pages = paginateManualAnswer(input);

  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) {
    expect(page.split("\n").length).toBeLessThanOrEqual(3);
  }
  expect(pages.join(" ").replace(/\s+/g, " ").trim()).toBe(input);
});

test("manual answer pagination does not drop continuous CJK text", () => {
  const input = "数据库索引的核心是让查询少扫描数据但是写入会变慢因为索引本身也要维护".repeat(4);
  const pages = paginateManualAnswer(input);
  const reconstructed = pages.join("").replace(/\s+/g, "");

  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) {
    expect(page.split("\n").length).toBeLessThanOrEqual(3);
  }
  expect(reconstructed).toBe(input);
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
