import { expect, test } from "bun:test";
import {
  buildOpenAiConversationCreatePayload,
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
    .toBe("Transcript: Could you explain Kubernetes?");
});

test("conversation input carries only compact dynamic fields", () => {
  expect(buildOpenAiConversationInput("  Could you explain Kubernetes?  ", {
    outputLanguage: "English",
    promptMode: "classroom",
    preparedNote: "Exam focus: CAP theorem",
  })).toBe([
    "Language: English",
    "Mode: classroom",
    "Prepared note:",
    "Exam focus: CAP theorem",
    "Transcript: Could you explain Kubernetes?",
  ].join("\n"));
});

test("conversation input can carry relevant support context for personal modes", () => {
  expect(buildOpenAiConversationInput("  What is your major?  ", {
    outputLanguage: "English",
    promptMode: "interview",
    supportContext: "Xiang Li: Chinese international MACS student at Dalhousie.",
  })).toBe([
    "Language: English",
    "Mode: interview",
    "Relevant context candidates, use only if helpful:",
    "Xiang Li: Chinese international MACS student at Dalhousie.",
    "Transcript: What is your major?",
  ].join("\n"));
});

test("conversation input can carry transcript context before the latest trigger", () => {
  expect(buildOpenAiConversationInput("  What components would be important?  ", {
    outputLanguage: "English",
    promptMode: "interview",
    transcriptContext: [
      "Imagine we're designing a book system similar to Kindle for short stories.",
      "Users have a library of books, can set an active book, and the app remembers the last page.",
    ].join("\n"),
  })).toBe([
    "Language: English",
    "Mode: interview",
    "Transcript context since last request, use as background only:",
    "Imagine we're designing a book system similar to Kindle for short stories.",
    "Users have a library of books, can set an active book, and the app remembers the last page.",
    "Transcript: What components would be important?",
  ].join("\n"));
});

test("conversation create payload seeds fixed instructions once", () => {
  const payload = buildOpenAiConversationCreatePayload({
    userId: "xiang@example.com",
    sessionId: "session_1",
    seedInstructions: "Canonical live display rules.",
  });

  expect(payload.items).toEqual([
    {
      type: "message",
      role: "developer",
      content: "Canonical live display rules.",
    },
  ]);
  expect(payload.metadata.purpose).toBe("session_clean_transcript_state");
});

test("conversation payload keeps history and fixed instructions out of the per-turn request", () => {
  const payload = buildOpenAiConversationPayload({
    model: "gpt-5.4-nano",
    conversationId: "conv_test",
    latestTranscript: "What project are you proud of?",
    inputOptions: {
      outputLanguage: "English",
      promptMode: "interview",
    },
  });

  expect(payload.conversation).toBe("conv_test");
  expect("instructions" in payload).toBe(false);
  expect(payload.input).toHaveLength(1);
  expect(payload.input[0].content[0].text).toBe([
    "Language: English",
    "Mode: interview",
    "Transcript: What project are you proud of?",
  ].join("\n"));
  expect(payload.input[0].content[0].text).not.toContain("RECENT CONVERSATION");
  expect(payload.input[0].content[0].text).not.toContain("Previous suggestion");
});

test("conversation payload includes relevant support context when provided", () => {
  const payload = buildOpenAiConversationPayload({
    model: "gpt-5.4-nano",
    conversationId: "conv_test",
    latestTranscript: "What program are you in?",
    inputOptions: {
      outputLanguage: "English",
      promptMode: "interview",
      supportContext: "Xiang is a MACS student at Dalhousie.",
    },
  });

  expect(payload.input[0].content[0].text).toBe([
    "Language: English",
    "Mode: interview",
    "Relevant context candidates, use only if helpful:",
    "Xiang is a MACS student at Dalhousie.",
    "Transcript: What program are you in?",
  ].join("\n"));
});

test("conversation input exposes tagged top memory context for GPT selection", () => {
  const supportContext = [
    "Personal memory candidates:",
    "[1] sourceRef=project:joblens facet=architecture",
    "Title: JobLens backend architecture",
    "Facts:",
    "- JobLens used AWS Lambda, API Gateway, DynamoDB, S3, and resume/job matching workflow.",
    "- Xiang worked on backend integration, data flow, and debugging.",
    "[2] sourceRef=project:elderalbum facet=architecture",
    "Title: ElderAlbum serverless backend",
    "Facts:",
    "- ElderAlbum used upload-triggered Lambda and metadata storage.",
  ].join("\n");

  const input = buildOpenAiConversationInput("How would you explain your backend experience?", {
    outputLanguage: "English",
    promptMode: "interview",
    answerIntent: "personal_fact",
    supportContext,
    taskHint: "Personal fact question: use supported memory facts directly.",
  });

  expect(input).toContain("Intent: personal_fact");
  expect(input).toContain("Relevant context candidates, use only if helpful:");
  expect(input).toContain("JobLens backend architecture");
  expect(input).toContain("AWS Lambda, API Gateway, DynamoDB, S3");
  expect(input).toContain("ElderAlbum serverless backend");
  expect(input).toContain("Transcript: How would you explain your backend experience?");
});

test("conversation input prefers planner strategy over legacy intent when both are present", () => {
  const input = buildOpenAiConversationInput("Could you write the class skeleton?", {
    outputLanguage: "English",
    promptMode: "interview",
    answerIntent: "ordinary_practical",
    answerStrategy: "planner; task=code_solution; shape=code_with_explanation; depth=deep; memory=yes; code=yes; risk=low",
    taskHint: "Planner policy: include code.",
  });

  expect(input).toContain("Strategy: planner; task=code_solution; shape=code_with_explanation");
  expect(input).toContain("Task: Planner policy: include code.");
  expect(input).not.toContain("Intent: ordinary_practical");
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
