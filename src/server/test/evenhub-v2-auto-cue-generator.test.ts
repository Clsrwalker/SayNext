import { expect, test } from "bun:test";
import {
  buildAutoCuePrompt,
  buildAutoCueSessionSeed,
  buildAutoCueTurnPrompt,
  normalizeAutoCueOutput,
  OpenAiAutoCueGenerator,
  shouldDisplayAutoCue,
} from "../evenhub-v2/auto-cue-generator";
import { defaultEvenHubV2Settings } from "../evenhub-v2/protocol";

test("normalizeAutoCueOutput preserves none for noise or incomplete speech", () => {
  expect(normalizeAutoCueOutput({
    category: "none",
    confidence: 0.1,
    title: "",
    g2Title: "",
    preview: "",
    fullAnswer: "",
    reason: "",
  })).toMatchObject({
    category: "none",
    title: "SayNext",
    g2Title: "SayNext",
    preview: "",
    fullAnswer: "",
  });
});

test("shouldDisplayAutoCue suppresses an explicit none decision", () => {
  expect(shouldDisplayAutoCue({
    cue: normalizeAutoCueOutput({ category: "none", reason: "acknowledgement" }),
    previousOutputHash: null,
    outputHash: "none",
    conversationActive: true,
  })).toEqual({ ok: false, reason: "category_none" });
});

test("shouldDisplayAutoCue does not suppress a complete cue by confidence", () => {
  expect(shouldDisplayAutoCue({
    cue: normalizeAutoCueOutput({
      category: "response",
      confidence: 0.05,
      title: "Answer",
      g2Title: "Answer",
      output: "I would first clarify the expected scale and latency requirement.",
      reason: "",
    }),
    previousOutputHash: null,
    outputHash: "new-output",
    conversationActive: true,
  })).toEqual({ ok: true });
});

test("normalizeAutoCueOutput keeps the full answer and derives a bounded preview", () => {
  const cue = normalizeAutoCueOutput({
    category: "response",
    confidence: 0.9,
    title: "Architecture",
    g2Title: "Architecture",
    fullAnswer: `This is a complete opening. ${"Useful implementation detail. ".repeat(24)}`,
    reason: "",
  });

  expect(cue.fullAnswer.length).toBeGreaterThan(340);
  expect(cue.preview.length).toBeLessThanOrEqual(340);
  expect(cue.preview.endsWith("...")).toBe(false);
  expect(cue.output).toBe(cue.fullAnswer);
});

test("auto cue prompt treats retrieved memory as grounding without inventing experience", () => {
  const prompt = buildAutoCuePrompt({
    triggerWindow: "What AWS services did you use in JobLens AI?",
    recentTranscript: "Interviewer: Tell me about your cloud experience.",
    contextSnapshot: "Relevant private memory facts for Xiang:\n[personal-memory:36] JobLens uses Lambda and DynamoDB.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  });

  expect(prompt).toContain("Do not invent Xiang's projects, work history, or personal experience");
  expect(prompt).toContain("General technical knowledge is not evidence that Xiang used it");
  expect(prompt).toContain("Current question or request is authoritative");
  expect(prompt).toContain('"preview"');
  expect(prompt).toContain('"fullAnswer"');
  expect(prompt).toContain("[personal-memory:36] JobLens uses Lambda and DynamoDB");
});

test("auto cue prompt asks for a natural spoken answer instead of a memory summary", () => {
  const prompt = buildAutoCuePrompt({
    triggerWindow: "Can you explain your CueFlow project?",
    recentTranscript: "Interviewer: Tell me about CueFlow.",
    contextSnapshot: "CueFlow uses several AWS services and an asynchronous worker flow.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  });

  expect(prompt).toContain("Sound like Xiang answering live, not reading a prepared script");
  expect(prompt).toContain("Do not summarize every retrieved fact");
  expect(prompt).toContain("simple, casual, modest English");
  expect(prompt).toContain("Avoid corporate openings such as");
  expect(prompt).toContain("require an explicit retrieved personal memory fact");
  expect(prompt).toContain("separate what Xiang actually built");
  expect(prompt).toContain("Do not infer that transcript chunking");
  expect(prompt).toContain("connect one or two real Xiang projects");
  expect(prompt).toContain("State limitations directly");
  expect(prompt).not.toContain("about 30-55 words");
});

test("auto cue prompt gives a role-grounded structure for interview introductions", () => {
  const prompt = buildAutoCuePrompt({
    triggerWindow: "So tell me a little bit about yourself, okay?",
    recentTranscript: "",
    contextSnapshot: [
      "[personal-memory:32] Xiang is a MACS student at Dalhousie and completed his BCS at Acadia.",
      "[personal-memory:4724] Professor Lu shared the DeepSense role with Xiang. Relevant projects include CueFlow, SayNext, and AI Meeting Monitor.",
    ].join("\n"),
    settings: defaultEvenHubV2Settings(),
    router: null,
  });

  expect(prompt).toContain("For an interview introduction with active role context");
  expect(prompt).toContain("current education and background");
  expect(prompt).toContain("two or three relevant real projects");
  expect(prompt).toContain("why this specific role genuinely stood out");
  expect(prompt).toContain("90-130 words");
  expect(prompt).toContain("Use the active interview or job card to choose projects");
  expect(prompt).toContain("Do not turn the introduction into a resume inventory");
  expect(prompt).toContain("how Xiang discovered the role");
  expect(prompt).toContain("Name the selected projects");
  expect(prompt).toContain("personal narrative rather than an abstract capability summary");
  expect(prompt).toContain("Before returning a role-grounded introduction, verify");
  expect(prompt).toContain("at least two project names");
});

test("auto cue separates the fixed DeepSense seed from the per-turn context", () => {
  const input = {
    triggerWindow: "Tell me about your SayNext project.",
    recentTranscript: "Interviewer: What have you built recently?",
    contextSnapshot: "Current question or request, this is the authoritative topic:\nTell me about SayNext.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  };

  const seed = buildAutoCueSessionSeed();
  const turn = buildAutoCueTurnPrompt(input);
  const stateless = buildAutoCuePrompt(input);

  expect(seed).toContain("DeepSense Full-Stack AI Developer Co-op");
  expect(seed).toContain("Representative answer examples");
  expect(seed).toContain("Return exactly one JSON object");
  expect(seed).not.toContain("Tell me about your SayNext project.");
  expect(turn).toContain("timing model is unavailable");
  expect(turn).toContain(input.contextSnapshot);
  expect(turn).not.toContain("Representative answer examples");
  expect(stateless).toBe(`${seed}\n\n${turn}`);
});

test("OpenAI auto cue uses the conversation for canonical finals and stateless cached prompts for partials", async () => {
  const jsonCalls: Array<Record<string, unknown>> = [];
  const conversationCalls: Array<Record<string, unknown>> = [];
  const generator = new OpenAiAutoCueGenerator({
    model: "gpt-test",
    conversationClient: {
      async createSession(input) {
        conversationCalls.push({ type: "create", ...input });
        return { id: "conv_openai_1" };
      },
      async commitCanonicalTurn(input) {
        conversationCalls.push({ type: "commit", ...input });
      },
      async deleteSession(conversationId) {
        conversationCalls.push({ type: "delete", conversationId });
      },
    },
    jsonGenerator: async (options) => {
      jsonCalls.push(options as unknown as Record<string, unknown>);
      return {
        data: {
          category: "response",
          confidence: 0.9,
          title: "Answer",
          g2Title: "Answer",
          preview: "A short answer.",
          fullAnswer: "A short answer.",
          output: "A short answer.",
          reason: "question",
        },
        rawText: "{}",
        model: "gpt-test",
      };
    },
  });
  const session = await generator.startSession?.({
    localConversationId: "conv-local",
    userId: "xiang",
  });
  const input = {
    triggerWindow: "Tell me about yourself.",
    recentTranscript: "",
    contextSnapshot: "Current question or request:\nTell me about yourself.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  };

  await generator.generate({ ...input, session, speculative: false });
  await generator.generate({ ...input, session, speculative: true });

  expect(conversationCalls[0].type).toBe("create");
  expect(String(conversationCalls[0].seed)).toContain("DeepSense Full-Stack AI Developer Co-op");
  expect(jsonCalls[0].conversationId).toBe("conv_openai_1");
  expect(jsonCalls[0].prompt).toBe(buildAutoCueTurnPrompt(input));
  expect(jsonCalls[0].includeJsonInstruction).toBe(false);
  expect(jsonCalls[1].conversationId).toBeUndefined();
  expect(jsonCalls[1].prompt).toBe(buildAutoCuePrompt(input));
  expect(jsonCalls[1].promptCacheKey).toContain("saynext:");
});

test("OpenAI auto cue falls back to stateless generation when a conversation request fails", async () => {
  const jsonCalls: Array<Record<string, unknown>> = [];
  const generator = new OpenAiAutoCueGenerator({
    model: "gpt-test",
    conversationClient: {
      async createSession() { return { id: "conv_openai_1" }; },
      async commitCanonicalTurn() {},
      async deleteSession() {},
    },
    jsonGenerator: async (options) => {
      jsonCalls.push(options as unknown as Record<string, unknown>);
      if (options.conversationId) throw new Error("conversation unavailable");
      return {
        data: {
          category: "response",
          confidence: 0.9,
          title: "Answer",
          g2Title: "Answer",
          preview: "Fallback answer.",
          fullAnswer: "Fallback answer.",
          output: "Fallback answer.",
          reason: "question",
        },
        rawText: "{}",
        model: "gpt-test",
      };
    },
  });

  const result = await generator.generate({
    triggerWindow: "Tell me about yourself.",
    recentTranscript: "",
    contextSnapshot: "Current question or request:\nTell me about yourself.",
    settings: defaultEvenHubV2Settings(),
    router: null,
    session: {
      providerConversationId: "conv_openai_1",
      promptVersion: "test",
      interviewGuideVersion: "test",
    },
    speculative: false,
  });

  expect(jsonCalls).toHaveLength(2);
  expect(jsonCalls[0].conversationId).toBe("conv_openai_1");
  expect(jsonCalls[1].conversationId).toBeUndefined();
  expect(result.lane).toBe("stateless_fallback");
});
