import { describe, expect, test } from "vitest";
import { cueFromServer, partialTranscriptFromServer, recordFromConversationDetail, resolveBackendOrigin, transcriptFromServer } from "./evenhub-v2-client";

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

  test("preserves structured code cue fields from saved conversation detail", () => {
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

    expect(record.cueHistory[0]).toMatchObject({
      category: "code",
      language: "typescript",
      code,
      explanation: "This function returns the sum of two numbers.",
      output: code,
    });
  });
});

describe("server cue mapping", () => {
  test("preserves structured code from a live cue_created message", () => {
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
    expect(cue.explanation).toContain("multiply it by two");
  });
});
