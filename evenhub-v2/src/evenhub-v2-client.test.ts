import { describe, expect, test } from "vitest";
import { partialTranscriptFromServer, resolveBackendOrigin, transcriptFromServer } from "./evenhub-v2-client";

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
