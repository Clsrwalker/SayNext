import { expect, test } from "bun:test";
import {
  createEvenHubV2ClientMessage,
  defaultEvenHubV2Settings,
  EVENHUB_V2_PROTOCOL_VERSION,
  parseEvenHubV2ClientMessage,
} from "../evenhub-v2/protocol";

test("EvenHub v2 keeps automatic cues visible by default", () => {
  expect(defaultEvenHubV2Settings().cueDurationMs).toBe("forever");
});

test("parseEvenHubV2ClientMessage requires the v2 envelope", () => {
  expect(parseEvenHubV2ClientMessage(JSON.stringify({ type: "hello" }))).toMatchObject({
    ok: false,
    code: "invalid_envelope",
  });
});

test("parseEvenHubV2ClientMessage accepts conversation_start and debug transcript", () => {
  const start = createEvenHubV2ClientMessage("conversation_start", {
    selectedPrenoteIds: ["pn-1"],
    selectedPrenoteText: "Prepared context",
  }, { clientSeq: 1 });
  expect(start.protocolVersion).toBe(EVENHUB_V2_PROTOCOL_VERSION);

  const parsedStart = parseEvenHubV2ClientMessage(JSON.stringify(start));
  expect(parsedStart).toMatchObject({
    ok: true,
    message: {
      type: "conversation_start",
      clientSeq: 1,
      payload: {
        selectedPrenoteIds: ["pn-1"],
      },
    },
  });

  const debug = createEvenHubV2ClientMessage("debug_transcript", {
    text: "What is batch normalization?",
    isFinal: true,
  });
  expect(parseEvenHubV2ClientMessage(JSON.stringify(debug))).toMatchObject({
    ok: true,
    message: {
      type: "debug_transcript",
      payload: { text: "What is batch normalization?", isFinal: true },
    },
  });
});

test("parseEvenHubV2ClientMessage accepts audio source metadata", () => {
  const audioStart = createEvenHubV2ClientMessage("audio_start", {
    codec: "linear16",
    sampleRate: 16000,
    channels: 1,
    audioSource: "phone",
  });

  expect(parseEvenHubV2ClientMessage(JSON.stringify(audioStart))).toMatchObject({
    ok: true,
    message: {
      type: "audio_start",
      payload: {
        codec: "linear16",
        sampleRate: 16000,
        channels: 1,
        audioSource: "phone",
      },
    },
  });
});

test("parseEvenHubV2ClientMessage accepts audio diagnostics", () => {
  const diagnostic = createEvenHubV2ClientMessage("audio_diagnostics", {
    selectedSource: "phone",
    chunkCount: 20,
    byteCount: 64_000,
    sourceCounts: {
      phone: 19,
      glasses: 1,
      unknown: 0,
    },
    mismatchCount: 1,
  });

  expect(parseEvenHubV2ClientMessage(JSON.stringify(diagnostic))).toMatchObject({
    ok: true,
    message: {
      type: "audio_diagnostics",
      payload: {
        selectedSource: "phone",
        chunkCount: 20,
        byteCount: 64_000,
        sourceCounts: {
          phone: 19,
          glasses: 1,
          unknown: 0,
        },
        mismatchCount: 1,
      },
    },
  });
});

test("parseEvenHubV2ClientMessage accepts bounded glass diagnostics without rendered content", () => {
  const diagnostic = createEvenHubV2ClientMessage("glass_diagnostic", {
    phase: "render",
    operation: "page_rebuild",
    result: "false",
    view: "cue_detail",
    selectedCueId: "cue-1",
    renderSeq: 12,
    durationMs: 43,
    textContainerCount: 3,
    listItemCount: 0,
    totalTextBytes: 1240,
    maxTextBytes: 1104,
    error: "x".repeat(400),
  });

  const parsed = parseEvenHubV2ClientMessage(JSON.stringify(diagnostic));
  expect(parsed).toMatchObject({
    ok: true,
    message: {
      type: "glass_diagnostic",
      payload: {
        phase: "render",
        operation: "page_rebuild",
        result: "false",
        view: "cue_detail",
        selectedCueId: "cue-1",
        renderSeq: 12,
        maxTextBytes: 1104,
      },
    },
  });
  if (!parsed.ok || parsed.message.type !== "glass_diagnostic") throw new Error("glass diagnostic was not parsed");
  expect(parsed.message.payload?.error).toHaveLength(240);
  expect("content" in (parsed.message.payload || {})).toBe(false);
});
