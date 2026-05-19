import { expect, test } from "bun:test";
import {
  buildOpenAiConversationInput,
  buildOpenAiConversationPayload,
  extractOutputItemIds,
  extractResponseText,
  isOpenAiConversationStateEnabled,
  shouldCommitTranscriptToOpenAiConversation,
} from "../mastra/agents/openai-conversation-state";

test("commits only final transcripts to OpenAI conversation state", () => {
  expect(shouldCommitTranscriptToOpenAiConversation("final")).toBe(true);
  expect(shouldCommitTranscriptToOpenAiConversation("timeout")).toBe(false);
});

test("enables conversation state by default in travel mode for OpenAI", () => {
  const previousMode = process.env.SAYNEXT_RUNTIME_MODE;
  const previousFlag = process.env.OPENAI_CONVERSATION_STATE_ENABLED;
  process.env.SAYNEXT_RUNTIME_MODE = "travel";
  delete process.env.OPENAI_CONVERSATION_STATE_ENABLED;
  try {
    expect(isOpenAiConversationStateEnabled("openai")).toBe(true);
    expect(isOpenAiConversationStateEnabled("ollama")).toBe(false);
  } finally {
    if (previousMode === undefined) delete process.env.SAYNEXT_RUNTIME_MODE;
    else process.env.SAYNEXT_RUNTIME_MODE = previousMode;
    if (previousFlag === undefined) delete process.env.OPENAI_CONVERSATION_STATE_ENABLED;
    else process.env.OPENAI_CONVERSATION_STATE_ENABLED = previousFlag;
  }
});

test("explicit flag can disable conversation state in travel mode", () => {
  const previousMode = process.env.SAYNEXT_RUNTIME_MODE;
  const previousFlag = process.env.OPENAI_CONVERSATION_STATE_ENABLED;
  process.env.SAYNEXT_RUNTIME_MODE = "travel";
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = "false";
  try {
    expect(isOpenAiConversationStateEnabled("openai")).toBe(false);
  } finally {
    if (previousMode === undefined) delete process.env.SAYNEXT_RUNTIME_MODE;
    else process.env.SAYNEXT_RUNTIME_MODE = previousMode;
    if (previousFlag === undefined) delete process.env.OPENAI_CONVERSATION_STATE_ENABLED;
    else process.env.OPENAI_CONVERSATION_STATE_ENABLED = previousFlag;
  }
});

test("conversation input stores only the latest clean transcript", () => {
  expect(buildOpenAiConversationInput("  Could you explain Kubernetes?  "))
    .toBe('Transcript: "Could you explain Kubernetes?"');
});

test("conversation payload keeps history out of the request input", () => {
  const payload = buildOpenAiConversationPayload({
    model: "gpt-4.1-mini",
    conversationId: "conv_test",
    instructions: "Canonical rules.\n\n--- RECENT CONVERSATION ---\nThis should be in instructions only when explicitly supplied.",
    latestTranscript: "What project are you proud of?",
  });

  expect(payload.conversation).toBe("conv_test");
  expect(payload.input).toHaveLength(1);
  expect(payload.input[0].content[0].text).toBe('Transcript: "What project are you proud of?"');
  expect(payload.input[0].content[0].text).not.toContain("RECENT CONVERSATION");
  expect(payload.input[0].content[0].text).not.toContain("Previous suggestion");
});

test("extracts response text from Responses API output_text first", () => {
  expect(extractResponseText({ output_text: "  Sure, that makes sense. " })).toBe("Sure, that makes sense.");
});

test("extracts response text from Responses API output content fallback", () => {
  const text = extractResponseText({
    output: [
      { content: [{ text: "First line." }] },
      { content: [{ text: "Second line." }] },
    ],
  });

  expect(text).toBe("First line.\nSecond line.");
});

test("extracts output item ids for assistant cleanup", () => {
  expect(extractOutputItemIds({
    output: [
      { id: "msg_1", content: [{ text: "Hello" }] },
      { id: "rs_2", content: [] },
      { content: [{ text: "No id" }] },
    ],
  })).toEqual(["msg_1", "rs_2"]);
});
