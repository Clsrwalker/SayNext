import { expect, test } from "bun:test";
import type { AppSession } from "@mentra/sdk";
import { LocationManager } from "../manager/LocationManager";
import { MergeResponseHandler, buildManualTranscriptContextSinceCursorForTest, compactManualPromptSegmentsForTest, findManualSegmentsAfterSourceRangeForTest, paginateManualAnswer, promptModeOverrideForSceneBuiltinKey } from "../mastra/agents/response-handler";
import { User } from "../session/User";

type DisplayCall = {
  text: string;
  durationMs?: number;
  topText?: string;
  bottomText?: string;
  kind?: "text" | "double";
};

class MockSession {
  displays: DisplayCall[] = [];
  clearCount = 0;

  layouts = {
    showTextWall: (text: string, options: { durationMs?: number } = {}) => {
      this.displays.push({ text, durationMs: options.durationMs, kind: "text" });
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

class SplitMockSession extends MockSession {
  layouts = {
    showTextWall: (text: string, options: { durationMs?: number } = {}) => {
      this.displays.push({ text, durationMs: options.durationMs, kind: "text" });
    },
    showDoubleTextWall: (topText: string, bottomText: string, options: { durationMs?: number } = {}) => {
      this.displays.push({
        text: `${topText}\n---\n${bottomText}`,
        topText,
        bottomText,
        durationMs: options.durationMs,
        kind: "double",
      });
    },
    clearView: () => {
      this.clearCount += 1;
    },
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

function makeSplitManualHandler() {
  return withConversationStateDisabled(() => {
    const session = new SplitMockSession();
    const handler = new MergeResponseHandler(
      session as unknown as AppSession,
      "manual-split-test-user",
      new LocationManager("manual-split-test-user"),
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

test("selected scene profile maps to prompt mode override while auto stays dynamic", () => {
  expect(promptModeOverrideForSceneBuiltinKey("interview")).toBe("interview");
  expect(promptModeOverrideForSceneBuiltinKey("classroom")).toBe("classroom");
  expect(promptModeOverrideForSceneBuiltinKey("daily_chat")).toBe("casual");
  expect(promptModeOverrideForSceneBuiltinKey("meeting_group")).toBe("general");
  expect(promptModeOverrideForSceneBuiltinKey("auto")).toBeNull();
  expect(promptModeOverrideForSceneBuiltinKey(null)).toBeNull();
});

test("g2 manual mode commits transcript and shows heard status without automatic answer generation", async () => {
  const { session, handler } = makeManualHandler();

  await handler.processTranscript("Could you explain why database indexing changes query latency?", Date.now(), "isFinal");

  const state = handler.getManualState();
  expect(state.mode).toBe("g2_manual");
  expect(state.transcriptCount).toBe(1);
  expect(state.lastGeneratedCursor).toBeNull();
  expect(state.currentAnswer).toBeNull();
  expect(session.displays.at(-1)?.text).toBe(
    "SN | HEARD\nHeard: Could you explain why database indexing changes query latency?\nTap R1 to answer.",
  );
});

test("manual generate returns no_new_speech briefly then restores listening", async () => {
  const { session, handler } = makeManualHandler();

  const result = await handler.generateManualAnswer("same-event");
  const replay = await handler.generateManualAnswer("same-event");

  expect(result.status).toBe("no_new_speech");
  expect(replay).toEqual(result);
  expect(result.state.lastGeneratedCursor).toBeNull();
  expect(session.displays.at(-1)?.text).toBe(
    "SN | NO ASR\nNo speech reached SayNext.\nCheck mic/connection, then speak again.",
  );
  await sleep(1450);
  expect(session.displays.at(-1)?.text).toBe(
    "SN | LISTEN\nListening for speech.\nSay the question, then tap R1.",
  );
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
  expect(session.displays.at(-1)?.text).toBe(
    "SN | LISTEN\nListening for speech.\nSay the question, then tap R1.",
  );
});

test("g2 manual mode shows heard transcript status on glasses when new speech arrives", async () => {
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

  expect(session.displays.at(-1)?.text).toBe("SN | HEARD\nOld pinned answer.");
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
  expect(session.displays.at(-1)?.text).toBe("SN | NO ASR\nPinned answer stays visible.");
  await sleep(1450);
  expect(session.displays.at(-1)?.text).toBe("ANS | LISTEN\nPinned answer stays visible.");
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
  expect(session.displays.at(-1)?.text).toBe(
    "SN | HEARD\nHeard: Can you explain B-tree index trade\nTap R1 to answer.",
  );
  expect(events.some((event) => event.type === "manual_partial_committed" && event.trigger === "test_partial")).toBe(true);
  user.cleanup();
});

test("manual no_new_speech shows the last raw ASR when only low-value partial arrived", async () => {
  const { session, handler } = makeManualHandler();

  handler.handlePartialTranscript("And.", Date.now());
  const result = await handler.generateManualAnswer("low-value-partial");

  expect(result.status).toBe("no_new_speech");
  expect(session.displays.at(-1)?.text).toBe("SN | NO ASR\nNo new useful speech.\nLast ASR: And.");
});

test("manual split display keeps answer pinned while top area shows live transcript", () => {
  const { session, handler } = makeSplitManualHandler();
  const previousSplit = process.env.MENTRA_MANUAL_SPLIT_DISPLAY;
  process.env.MENTRA_MANUAL_SPLIT_DISPLAY = "true";

  try {
    (handler as any).currentManualAnswer = {
      answerGroupId: "manual_group_split",
      answerId: "manual_answer_split",
      requestId: "manual_req_split",
      sourceRange: {
        fromExclusive: null,
        toInclusive: "seg_1",
        segmentIds: ["seg_1"],
        textDigest: "digest",
      },
      output: "Pinned answer page one.",
      pages: ["Pinned answer page one.", "Pinned answer page two."],
      pageIndex: 0,
      createdAt: Date.now(),
    };

    handler.handlePartialTranscript("What is your biggest improvement area?", Date.now());

    const display = session.displays.at(-1);
    expect(display?.kind).toBe("double");
    expect(display?.topText).toBe("SN | HEARING 1/2\nHearing: What is your biggest improvement area?");
    expect(display?.bottomText).toBe("Pinned answer page one.");
  } finally {
    if (previousSplit === undefined) delete process.env.MENTRA_MANUAL_SPLIT_DISPLAY;
    else process.env.MENTRA_MANUAL_SPLIT_DISPLAY = previousSplit;
  }
});

test("g2 single tap generates after a short double-tap window", async () => {
  const session = new MockUserSession();
  const user = new User("manual-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  expect(session.displays.at(-1)?.text).toBe(
    "SN | LISTEN\nListening for speech.\nSay the question, then tap R1.",
  );
  session.touchHandler?.({ gesture: "single_tap" });

  expect(events.some((event) => event.type === "manual_gesture_pending")).toBe(true);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(false);

  await sleep(330);

  expect(events.some((event) => event.type === "manual_gesture_ignored" && event.reason === "single_tap_disabled")).toBe(false);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(true);
  user.cleanup();
});

test("g2 double tap regenerates the current pinned answer", async () => {
  const session = new MockUserSession();
  const user = new User("manual-double-gesture-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  (user as any).responseHandler.currentManualAnswer = {
    answerGroupId: "manual_group_double",
    answerId: "manual_answer_double",
    requestId: "manual_req_double",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    sourceText: "Explain this answer again.",
    output: "Old pinned answer.",
    pages: ["Old pinned answer."],
    pageIndex: 0,
    createdAt: Date.now(),
  };
  (user as any).regenerateManualAnswer = async () => ({
    status: "ok",
    sessionId: "manual-double-gesture-user",
    state: (user as any).responseHandler.getManualState(),
  });
  session.touchHandler?.({ gesture: "double_tap" });
  await sleep(20);

  expect(events.some((event) => event.reason === "manual_ok")).toBe(true);
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
  expect(session.displays.at(-1)?.text).toBe(
    "SN | LISTEN\nListening for speech.\nSay the question, then tap R1.",
  );
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

test("g2 single tap right after paging can still generate", async () => {
  const session = new MockUserSession();
  const user = new User("manual-scroll-tap-guard-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  (user as any).responseHandler.currentManualAnswer = {
    answerGroupId: "manual_group_scroll_tap_guard",
    answerId: "manual_answer_scroll_tap_guard",
    requestId: "manual_req_scroll_tap_guard",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    output: "First page.\nSecond page.",
    pages: ["First page.", "Second page."],
    pageIndex: 0,
    createdAt: Date.now(),
  };

  session.touchHandler?.({ gesture: "swipe_down" });
  session.touchHandler?.({ gesture: "single_tap" });
  await sleep(330);

  expect(events.some((event) => event.type === "manual_gesture_ignored" && event.reason === "single_tap_disabled")).toBe(false);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(true);
  user.cleanup();
});

test("g2 double tap after paging regenerates the previous pinned answer", async () => {
  const session = new MockUserSession();
  const user = new User("manual-scroll-tap-with-speech-user");
  const events: any[] = [];
  user.addSSEClient((data) => events.push(JSON.parse(data)));

  await withConversationStateDisabled(() => user.setAppSession(session as unknown as AppSession));
  (user as any).responseHandler.currentManualAnswer = {
    answerGroupId: "manual_group_scroll_tap_speech",
    answerId: "manual_answer_scroll_tap_speech",
    requestId: "manual_req_scroll_tap_speech",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    output: "First page.\nSecond page.",
    pages: ["First page.", "Second page."],
    pageIndex: 0,
    createdAt: Date.now(),
  };
  let generated = false;
  let regenerated = false;
  (user as any).generateManualAnswer = async () => {
    generated = true;
    return {
      status: "ok",
      sessionId: "manual-scroll-tap-with-speech-user",
      state: (user as any).responseHandler.getManualState(),
    };
  };
  (user as any).regenerateManualAnswer = async () => {
    regenerated = true;
    return {
    status: "ok",
    sessionId: "manual-scroll-tap-with-speech-user",
    state: (user as any).responseHandler.getManualState(),
    };
  };

  session.touchHandler?.({ gesture: "swipe_down" });
  session.touchHandler?.({ gesture: "single_tap" });
  session.touchHandler?.({ gesture: "single_tap" });
  await sleep(330);

  expect(events.some((event) => event.type === "manual_gesture_ignored" && event.reason === "single_tap_disabled")).toBe(false);
  expect(events.some((event) => event.reason === "manual_ok")).toBe(true);
  expect(generated).toBe(false);
  expect(regenerated).toBe(true);
  user.cleanup();
});

test("manual answer history stores full answers once and does not duplicate page changes", () => {
  const { handler } = makeManualHandler();
  const insights: any[] = [];
  handler.onInsight = (insight) => insights.push(insight);
  (handler as any).currentManualAnswer = {
    answerGroupId: "manual_group_history",
    answerId: "manual_answer_history",
    requestId: "manual_req_history",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "digest",
    },
    sourceText: "What is the best way to explain database indexes in an interview?",
    output: "Full answer first page.\nFull answer second page.",
    pages: ["Full answer first page.", "Full answer second page."],
    pageIndex: 0,
    createdAt: Date.now(),
  };

  (handler as any).renderManualAnswer("manual_answer");
  handler.pageManualAnswer("next", "history-page-next");

  expect(insights).toHaveLength(1);
  expect(insights[0]).toMatchObject({
    text: "Full answer first page.\nFull answer second page.",
    agentType: "Manual",
    reasoning: "manual_answer",
    sourceText: "What is the best way to explain database indexes in an interview?",
  });
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

test("manual answer pagination preserves code line breaks and indentation", () => {
  const input = [
    "I would start with the Book class.",
    "# Book owns ordered pages.",
    "class Book:",
    "    def __init__(self, book_id, title, pages):",
    "        self.book_id = book_id",
    "        self.title = title",
    "        self.pages = pages",
    "",
    "# Library tracks books by id.",
    "class Library:",
    "    def __init__(self):",
    "        self.books = {}",
    "        self.active_book_id = None",
  ].join("\n");

  const pages = paginateManualAnswer(input);
  const reconstructed = pages.join("\n").replace(/\n{2,}/g, "\n").trim();

  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) {
    expect(page.split("\n").length).toBeLessThanOrEqual(3);
  }
  expect(reconstructed).toContain("# Book owns ordered pages.\nclass Book:");
  expect(reconstructed).toContain("    def __init__(self, book_id, title, pages):");
  expect(reconstructed).toContain("        self.active_book_id = None");
  expect(reconstructed).not.toContain("class Book: def __init__");
});

test("manual prompt compaction removes repeated ASR revisions and filler before coding answer", () => {
  const compacted = compactManualPromptSegmentsForTest([
    { id: "seg_1", text: "You don't necessarily have to accomplish everything. Imagine that we're designing a book system", timestamp: 1, reason: "timeout", createdAt: 1, eventId: "event_interview" },
    { id: "seg_2", text: "You don't necessarily have to accomplish everything. Imagine that we're designing a book system, so an online cloud reading application similar to Kindle for short stories.", timestamp: 2, reason: "timeout", createdAt: 2, eventId: "event_interview" },
    { id: "seg_3", text: "Exactly.", timestamp: 3, reason: "isFinal", createdAt: 3, eventId: "event_interview" },
    { id: "seg_4", text: "Awesome.", timestamp: 4, reason: "isFinal", createdAt: 4, eventId: "event_interview" },
    { id: "seg_5", text: "I'm curious how you would structure the core classes and components for this object-oriented design question.", timestamp: 5, reason: "isFinal", createdAt: 5, eventId: "event_interview" },
    { id: "seg_6", text: "Right, right. So let me", timestamp: 6, reason: "timeout", createdAt: 6, eventId: "event_interview" },
  ]);

  const text = compacted.map((segment) => segment.text).join("\n");
  expect(compacted.map((segment) => segment.id)).toEqual(["seg_2", "seg_5"]);
  expect(text).toContain("online cloud reading application");
  expect(text).toContain("core classes and components");
  expect(text).not.toContain("Exactly");
  expect(text).not.toContain("Awesome");
  expect(text).not.toContain("Right, right. So let me");
  expect(text).not.toContain("book system\nYou don't necessarily");
});

test("manual transcript context carries all substantive speech since the last LLM request", () => {
  const context = buildManualTranscriptContextSinceCursorForTest([
    { id: "seg_1", text: "Previous answer already handled this part." },
    { id: "seg_2", text: "Imagine we're designing a book system similar to Kindle for short stories." },
    { id: "seg_3", text: "Users have a library of books, can set one active, and the app remembers the last page." },
    { id: "seg_4", text: "So I really want to think about what components would be important for this object-oriented design." },
    { id: "seg_5", text: "Right, right. So let me" },
  ], "seg_1");

  expect(context.toInclusive).toBe("seg_5");
  expect(context.text).toContain("book system similar to Kindle");
  expect(context.text).toContain("library of books");
  expect(context.text).toContain("components would be important");
  expect(context.text).not.toContain("Previous answer already handled");
  expect(context.text).not.toContain("Right, right. So let me");
});

test("manual generation detects newer speech that arrived after source range was chosen", () => {
  const newer = findManualSegmentsAfterSourceRangeForTest([
    { id: "seg_1", createdAt: 1000 },
    { id: "seg_2", createdAt: 1100 },
    { id: "seg_3", createdAt: 1500 },
  ], {
    segmentIds: ["seg_1", "seg_2"],
  }, 1200);

  expect(newer.map((segment) => segment.id)).toEqual(["seg_3"]);
});

test("manual regenerate uses the previous pinned answer even when newer speech exists", async () => {
  const { handler } = makeManualHandler();
  const captured: Array<{ kind: string; segmentIds: string[] }> = [];

  (handler as any).transcriptSegments = [
    { id: "seg_1", text: "How would you structure the core classes?", timestamp: 1, reason: "isFinal", createdAt: 1, eventId: "event_interview" },
    { id: "seg_2", text: "I would love to see some Python pseudocode to flesh out one of these classes.", timestamp: 2, reason: "isFinal", createdAt: 2, eventId: "event_interview" },
  ];
  (handler as any).lastGeneratedCursor = "seg_1";
  (handler as any).currentManualAnswer = {
    answerGroupId: "manual_group_old",
    answerId: "manual_answer_old",
    requestId: "manual_req_old",
    sourceRange: {
      fromExclusive: null,
      toInclusive: "seg_1",
      segmentIds: ["seg_1"],
      textDigest: "old",
    },
    output: "Old pinned answer.",
    pages: ["Old pinned answer."],
    pageIndex: 0,
    createdAt: 1,
  };
  (handler as any).runManualGeneration = async (kind: string, sourceRange: any) => {
    captured.push({ kind, segmentIds: sourceRange.segmentIds });
    return {
      status: "ok",
      sessionId: "manual-test-user",
      state: handler.getManualState(),
    };
  };

  await handler.regenerateManualAnswer("double-tap-after-new-speech");

  expect(captured[0]).toEqual({ kind: "regenerate", segmentIds: ["seg_1"] });
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
  expect(events.some((event) => event.reason === "manual_no_current_answer")).toBe(false);
  expect(events.some((event) => event.reason === "manual_no_new_speech")).toBe(true);
  user.cleanup();
});
