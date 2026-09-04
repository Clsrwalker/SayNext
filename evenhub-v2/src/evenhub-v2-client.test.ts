import { describe, expect, test } from "vitest";
import {
  conversationStartPayload,
  cueFromServer,
  getOrCreateClientSessionId,
  partialTranscriptFromServer,
  recordFromConversationDetail,
  resolveBackendOrigin,
  resolveWebSocketUrl,
  transcriptFromServer,
} from "./evenhub-v2-client";

describe("conversation start prenotes", () => {
  test("sends real ids and combined text for every selected prenote", () => {
    const payload = conversationStartPayload({
      voiceInput: "glasses",
      language: "english",
      glassContent: { aiCue: true, transcript: true },
      autoPopup: true,
      cueDuration: "forever",
    }, [
      { id: "108", title: "Project", text: "Project facts", selected: true, files: [] },
      { id: "109", title: "Role", text: "Role facts", selected: true, files: [] },
      { id: "110", title: "Unused", text: "Do not send", selected: false, files: [] },
    ]);

    expect(payload.selectedPrenoteIds).toEqual(["108", "109"]);
    expect(payload.selectedPrenoteText).toBe("# Project\nProject facts\n\n---\n\n# Role\nRole facts");
  });
});

describe("stable websocket session", () => {
  test("keeps one session id for websocket reconnects in the current app lifetime", () => {
    expect(getOrCreateClientSessionId()).toBe(getOrCreateClientSessionId());
  });

  test("reuses the same client session id across reconnects", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };

    const first = getOrCreateClientSessionId(storage);
    const second = getOrCreateClientSessionId(storage);

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  test("includes the stable session id in the websocket URL", () => {
    expect(resolveWebSocketUrl("https://api.example.com", "session / one"))
      .toBe("wss://api.example.com/api/evenhub/v2/ws?sessionId=session+%2F+one");
  });
});

describe("resolveBackendOrigin", () => {
  test("uses env override when provided", () => {
    expect(resolveBackendOrigin(new URL("https://example.com/app"), "https://api.example.com/"))
      .toBe("https://api.example.com");
  });

  test("uses localhost port 3000 for local dev", () => {
    expect(resolveBackendOrigin(new URL("http://localhost:5174"), undefined, true))
      .toBe("http://localhost:3000");
  });

  test("uses LAN host port 3000 for phone browser dev", () => {
    expect(resolveBackendOrigin(new URL("http://192.168.2.10:5174"), undefined, true))
      .toBe("http://192.168.2.10:3000");
  });

  test("uses the VPS origin for packaged localhost webviews", () => {
    expect(resolveBackendOrigin(new URL("http://localhost/app"), undefined, false))
      .toBe("https://saynext.167.172.153.109.sslip.io");
  });

  test("uses the VPS origin for packaged LAN webviews", () => {
    expect(resolveBackendOrigin(new URL("http://192.168.2.10/app"), undefined, false))
      .toBe("https://saynext.167.172.153.109.sslip.io");
  });

  test("uses the VPS origin when packaged under a non-backend host", () => {
    expect(resolveBackendOrigin(new URL("https://evenhub.local/app"), undefined, false))
      .toBe("https://saynext.167.172.153.109.sslip.io");
  });
});

describe("server transcript mapping", () => {
  test("uses conversation-relative offset for final transcript time", () => {
    const line = transcriptFromServer({
      protocolVersion: "evenhub-v2.1",
      messageId: "server_msg_1",
      timestamp: "2026-06-11T13:23:33.073Z",
      type: "transcript_final",
      payload: {
        lineId: "line_1",
        index: 0,
        text: "hello",
        receivedAt: "2026-06-11T13:23:33.073Z",
        offsetMs: 65_432,
      },
    });
    expect(line.time).toBe("00:01:05");
  });

  test("uses conversation-relative offset for partial transcript time", () => {
    const line = partialTranscriptFromServer({
      protocolVersion: "evenhub-v2.1",
      messageId: "server_msg_2",
      timestamp: "2026-06-11T13:23:33.073Z",
      type: "transcript_partial",
      payload: {
        text: "hello",
        offsetMs: 4_200,
      },
    });
    expect(line.time).toBe("00:00:04");
    expect(line.partial).toBe(true);
  });
});

describe("conversation detail mapping", () => {
  test("maps structured summary and cue history from the detail response", () => {
    const record = recordFromConversationDetail({
      conversation: {
        id: "conv-1",
        title: "Raw title",
        startedAt: "2026-06-12T10:00:00.000Z",
        endedAt: "2026-06-12T10:10:00.000Z",
        durationMs: 600000,
      },
      summary: {
        status: "ready",
        title: "Summary title",
        overview: "A useful summary.",
        keyPoints: [{ id: "kp-1", title: "Point", details: ["Detail"] }],
        actionItems: [{ id: "act-1", text: "Follow up", checked: true }],
        emptyReason: "",
        generatedAt: "2026-06-12T10:11:00.000Z",
        error: "",
      },
      transcript: [
        { id: "line-1", index: 0, text: "hello", receivedAt: "2026-06-12T10:00:05.000Z" },
      ],
      cues: [
        {
          id: "cue-1",
          category: "concept",
          title: "Concept",
          g2Title: "Concept",
          preview: "Cue preview.",
          fullAnswer: "Cue preview. Complete cue answer.",
          output: "Cue preview. Complete cue answer.",
          createdAt: "2026-06-12T10:01:00.000Z",
        },
      ],
    });

    expect(record.summary.status).toBe("ready");
    expect(record.summary.keyPoints[0].details).toEqual(["Detail"]);
    expect(record.summary.actionItems[0].checked).toBe(true);
    expect(record.cueHistory[0].title).toBe("Concept");
    expect(record.cueHistory[0].preview).toBe("Cue preview.");
    expect(record.cueHistory[0].fullAnswer).toBe("Cue preview. Complete cue answer.");
  });

  test("uses summary title when conversation title is still default", () => {
    const record = recordFromConversationDetail({
      conversation: {
        id: "conv-2",
        title: "New Conversation",
        startedAt: "2026-06-12T10:00:00.000Z",
        endedAt: "2026-06-12T10:10:00.000Z",
        durationMs: 600000,
      },
      summary: {
        status: "ready",
        title: "Generated Summary Title",
        overview: "A useful summary.",
        keyPoints: [],
        actionItems: [],
      },
      transcript: [],
      cues: [],
    });

    expect(record.title).toBe("Generated Summary Title");
  });

  test("restores one complete code entry and ignores legacy explanation text", () => {
    const code = "function add(a: number, b: number) {\n  return a + b;\n}";
    const record = recordFromConversationDetail({
      conversation: {
        id: "conv-code",
        title: "Code interview",
        startedAt: "2026-07-21T10:00:00.000Z",
        endedAt: "2026-07-21T10:01:00.000Z",
        durationMs: 60_000,
      },
      transcript: [],
      cues: [{
        id: "cue-code",
        category: "code",
        title: "Add numbers",
        g2Title: "Add numbers",
        preview: "Return the sum.",
        fullAnswer: "This function returns the sum of two numbers.",
        output: code,
        language: "typescript",
        code,
        explanation: "This function returns the sum of two numbers.",
        createdAt: "2026-07-21T10:00:30.000Z",
      }],
    });

    expect(record.cueHistory).toHaveLength(1);
    expect(record.cueHistory[0]).toMatchObject({
      id: "cue-code",
      category: "code",
      language: "typescript",
      code,
      output: code,
      preview: code,
      fullAnswer: code,
    });
    expect(record.cueHistory[0]).not.toHaveProperty("explanation");
  });
});

describe("server cue mapping", () => {
  test("preserves one structured code cue and ignores legacy explanation text", () => {
    const code = "const result = values.map((value) => value * 2);";
    const cue = cueFromServer({
      protocolVersion: "evenhub-v2.1",
      messageId: "server-code-1",
      timestamp: "2026-07-21T10:00:00.000Z",
      type: "cue_created",
      payload: {
        cueId: "cue-live-code",
        attemptId: "attempt-code",
        category: "code",
        title: "Double values",
        g2Title: "Double values",
        preview: "Map each value.",
        fullAnswer: "I map each value and multiply it by two.",
        output: code,
        language: "typescript",
        code,
        explanation: "I map each value and multiply it by two.",
        sourceTranscriptLineIds: [],
        createdAt: "2026-07-21T10:00:00.000Z",
      },
    });

    expect(cue.code).toBe(code);
    expect(cue.output).toBe(code);
    expect(cue.preview).toBe(code);
    expect(cue.fullAnswer).toBe(code);
    expect(cue).not.toHaveProperty("explanation");
  });
});
