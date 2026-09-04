import { expect, test } from "bun:test";
import {
  buildAutoCuePrompt,
  buildAutoCueSessionSeed,
  buildAutoCueTurnPrompt,
  AUTO_CUE_PROMPT_CACHE_KEY,
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

test("normalizeAutoCueOutput keeps one complete answer for every display surface", () => {
  const cue = normalizeAutoCueOutput({
    category: "response",
    confidence: 0.9,
    title: "Architecture",
    g2Title: "Architecture",
    fullAnswer: `This is a complete opening. ${"Useful implementation detail. ".repeat(24)}`,
    reason: "",
  });

  expect(cue.fullAnswer.length).toBeGreaterThan(340);
  expect(cue.preview).toBe(cue.fullAnswer);
  expect(cue.output).toBe(cue.fullAnswer);
});

test("normalizeAutoCueOutput preserves complete structured code without flattening or truncation", () => {
  const repeatedBody = Array.from(
    { length: 140 },
    (_, index) => `  const value${index} = nums[${index % 4}];`,
  ).join("\r\n");
  const rawCode = `\`\`\`typescript\r\nfunction collect(nums: number[]) {\r\n${repeatedBody}\r\n\r\n  return nums;\r\n}\r\n\`\`\``;
  const cue = normalizeAutoCueOutput({
    category: "code",
    confidence: 0.94,
    title: "Collect values",
    g2Title: "Collect values",
    language: "typescript",
    code: rawCode,
    explanation: "I use a small function and return the collected values.",
    reason: "explicit coding request",
  });

  expect(cue.category).toBe("code");
  expect(cue.language).toBe("typescript");
  expect(cue.code.startsWith("function collect(nums: number[]) {\n  const value0")).toBe(true);
  expect(cue.code.endsWith("\n\n  return nums;\n}")).toBe(true);
  expect(cue.code).not.toContain("```");
  expect(cue.code.length).toBeGreaterThan(2400);
  expect(cue.code).not.toContain("...");
  expect(cue.output).toBe(cue.code);
  expect(cue.fullAnswer).toBe(cue.code);
  expect(cue.preview).toBe(cue.code);
  expect(cue.explanation).toBe("");
});

test("auto cue prompt defines a complete readable code response contract", () => {
  const prompt = buildAutoCuePrompt({
    triggerWindow: "Can you write TypeScript for two sum?",
    recentTranscript: "Interviewer: Please code it now.",
    contextSnapshot: "No personal memory is needed.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  });

  expect(prompt).toContain("response|concept|suggestion|person|code|none");
  expect(prompt).toContain('"language"');
  expect(prompt).toContain('"code"');
  expect(prompt).toContain('"explanation"');
  expect(prompt).toContain("two-space indentation");
  expect(prompt).toContain("Do not use Markdown fences");
  expect(prompt).toContain("Never truncate code");
  expect(prompt).toContain("Any line longer than 48 characters will wrap on G2");
  expect(prompt).toContain("nums, i, seen, need, or curr");
  expect(prompt).toContain("put each parameter on its own line");
  expect(prompt).toContain("Do not add demo calls, console output, or sample data");
  expect(prompt).toContain("explanation must always be empty");
  expect(prompt).not.toContain("specific spoken walkthrough");
  expect(prompt).not.toContain("separate linked entries");
  expect(prompt).not.toContain("Explain this specific code");
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
  expect(prompt).not.toContain('"preview"');
  expect(prompt).toContain('"fullAnswer"');
  expect(prompt).toContain("single answer shown everywhere");
  expect(prompt).toContain("Complete means the current question is answered");
  expect(prompt).not.toContain("one complete answer used everywhere");
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
  expect(prompt).toContain("plain, casual, modest English");
  expect(prompt).toContain("Avoid polished corporate phrasing such as");
  expect(prompt).toContain("require an explicit retrieved personal memory fact");
  expect(prompt).toContain("separate what Xiang actually built");
  expect(prompt).toContain("Do not infer that transcript chunking");
  expect(prompt).toContain("connect one or two real Xiang projects");
  expect(prompt).toContain("State limitations directly");
  expect(prompt).not.toContain("about 30-55 words");
});

test("auto cue prompt keeps spoken rhythm while requiring applied depth for practical questions", () => {
  const prompt = buildAutoCuePrompt({
    triggerWindow: "How would you design the retrieval flow?",
    recentTranscript: "Interviewer: Keep the explanation practical.",
    contextSnapshot: "No personal memory is needed.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  });

  expect(prompt).toContain("For interview, personal, project, or behavioral questions, write in first person");
  expect(prompt).toContain("Never refer to Xiang by name or in the third person inside fullAnswer");
  expect(prompt).toContain("For general technical questions, first person is fine for Xiang's proposed approach or decision");
  expect(prompt).toContain("Natural spoken English should come from rhythm and word choice, not broken grammar");
  expect(prompt).toContain("Do not automatically begin with a filler phrase");
  expect(prompt).toContain("not the most comprehensive answer that could be written about the topic");
  expect(prompt).toContain("For simple or focused questions, use progressive disclosure");
  expect(prompt).toContain("Do not apply that one-or-two-detail limit");
  expect(prompt).toContain("prefer vertical depth over a flat survey");
  expect(prompt).toContain("make a concrete decision or working assumption");
  expect(prompt).toContain("show how the request, data, or control moves through the solution");
  expect(prompt).toContain("one important failure case or trade-off");
  expect(prompt).toContain("how to test or measure whether it works");
  expect(prompt).toContain("only definitions, product summaries, component names, or a list of metrics");
  expect(prompt).toContain("explain what decision or failure that metric reveals");
  expect(prompt).toContain("choose one for the stated scenario");
  expect(prompt).toContain("Prefer concrete actions over abstract capability language");
  expect(prompt).toContain("Keep one main idea per sentence when practical");
  expect(prompt).toContain("natural shorthand such as 'that part'");
  expect(prompt).toContain("Do not force every answer into the same structure");
  expect(prompt).toContain("Do not automatically end with a lesson");
  expect(prompt).toContain("Leave reasonable follow-up details for the interviewer to ask");
  expect(prompt).toContain("Definition or focused technical question: 40-90 words");
  expect(prompt).toContain("A detail can be true and useful but still be unnecessary for this turn");
  expect(prompt).toContain("choose fewer ideas before writing");
  expect(prompt).not.toContain("Do not remove useful detail just to stay short");
  expect(prompt).toContain("one main point that answers the question");
  expect(prompt).toContain("Most retrieved facts should remain unspoken");
  expect(prompt).toContain("easy to follow on the glasses");
  expect(prompt).not.toContain("direct answer -> reason or mechanism -> one concrete detail or result -> stop");
  expect(prompt).not.toContain("Use the shortest answer that fully answers the question");
  expect(prompt).toContain("fullAnswer contains only the words Xiang can say");
  expect(prompt).toContain("matching approved interview answer card for question-scoped facts");
  expect(prompt).toContain("Use facts from a reference answer only when the current question matches that answer's topic");
  expect(prompt).toContain("Reference answers are factual sources for matching questions, not scripts");
  expect(prompt).toContain("Do not copy their opening, sentence order, transitions, or conclusion");
  expect(prompt).toContain("answer the current ASR wording from scratch");
  expect(prompt).toContain("Before returning, do one spoken pass");
  expect(prompt).toContain("longer than about 22 spoken words");
  expect(prompt).toContain("remove a closing lesson or role-fit summary");
  expect(prompt).not.toContain("demonstrate speaking style and content order");
  expect(prompt).not.toContain("Preserve its approved facts, mechanism order");
  expect(prompt).not.toContain("fixed examples for Xiang's facts");

  expect(prompt).toContain("Return exactly one JSON object");
  expect(prompt).toContain('"category": "response|concept|suggestion|person|code|none"');
  expect(prompt).toContain("General technical knowledge is not evidence that Xiang used it");
  expect(prompt).toContain("For a code cue, language names the programming language");
});

test("fixed auto cue seed contains rules only, without DeepSense facts or few-shot answers", () => {
  const seed = buildAutoCueSessionSeed();

  expect(seed).toContain("Reusable interview answer rules:");
  expect(seed).not.toContain("DeepSense");
  expect(seed).not.toContain("Professor Lu");
  expect(seed).not.toContain("Dalhousie");
  expect(seed).not.toContain("Acadia");
  expect(seed).not.toContain("CueFlow");
  expect(seed).not.toContain("JobLens");
  expect(seed).not.toContain("ElderAlbum");
  expect(seed).not.toContain("AI Meeting Monitor");
  expect(seed).not.toContain("SayNext Context Router");
  expect(seed).not.toContain("Fall 2026");
  expect(seed).not.toContain("Representative answer examples");
  expect(seed).not.toContain("Spoken tone examples");
  expect(seed).not.toContain("Question:");
  expect(seed).not.toContain("Example answer:");
});

test("auto cue prompt cache key stays within the OpenAI limit", () => {
  expect(AUTO_CUE_PROMPT_CACHE_KEY.length).toBeLessThanOrEqual(64);
  expect(AUTO_CUE_PROMPT_CACHE_KEY).toContain("v7");
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

test("auto cue keeps selected prenote in the fixed session seed only", () => {
  const input = {
    triggerWindow: "Tell me about your SayNext project.",
    recentTranscript: "Interviewer: What have you built recently?",
    contextSnapshot: "Current question or request, this is the authoritative topic:\nTell me about SayNext.",
    settings: defaultEvenHubV2Settings(),
    router: null,
  };
  const selectedPrenote = "DeepSense interview prep: connect SayNext to the chatbot and RAG responsibilities.";

  const seed = buildAutoCueSessionSeed(selectedPrenote);
  const turn = buildAutoCueTurnPrompt(input);
  const stateless = buildAutoCuePrompt(input);

  expect(seed).not.toContain("DeepSense Full-Stack AI Developer Co-op");
  expect(seed).not.toContain("Representative answer examples");
  expect(seed).toContain("Reusable interview answer rules:");
  expect(seed).toContain("Return exactly one JSON object");
  expect(seed).toContain("Selected prenote for this conversation");
  expect(seed).toContain(selectedPrenote);
  expect(seed).not.toContain("Tell me about your SayNext project.");
  expect(turn).toContain("timing model is unavailable");
  expect(turn).toContain(input.contextSnapshot);
  expect(turn).not.toContain("Representative answer examples");
  expect(turn).not.toContain(selectedPrenote);
  expect(stateless).not.toContain(selectedPrenote);
  expect(stateless).toBe(`${buildAutoCueSessionSeed()}\n\n${turn}`);
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
          language: "",
          code: "",
          explanation: "",
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
    selectedPrenoteIds: ["pn-deepsense"],
    selectedPrenoteText: "Prepared DeepSense interview context.",
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
  expect(String(conversationCalls[0].seed)).toContain("Reusable interview answer rules:");
  expect(String(conversationCalls[0].seed)).not.toContain("DeepSense Full-Stack AI Developer Co-op");
  expect(String(conversationCalls[0].seed)).not.toContain("Professor Lu");
  expect(String(conversationCalls[0].seed)).toContain("Prepared DeepSense interview context.");
  expect(jsonCalls[0].conversationId).toBe("conv_openai_1");
  expect(jsonCalls[0].prompt).toBe(buildAutoCueTurnPrompt(input));
  expect(String(jsonCalls[0].prompt)).not.toContain("Prepared DeepSense interview context.");
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
          language: "",
          code: "",
          explanation: "",
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

test("OpenAI auto cue uses Luna low without priority processing and keeps fallback standard", async () => {
  const jsonCalls: Array<Record<string, unknown>> = [];
  const generator = new OpenAiAutoCueGenerator({
    model: "gpt-5.6-luna",
    fallbackModel: "gpt-5.4-mini",
    conversationClient: {
      async createSession() { return { id: "conv_openai_1" }; },
      async commitCanonicalTurn() {},
      async deleteSession() {},
    },
    jsonGenerator: async (options) => {
      jsonCalls.push(options as unknown as Record<string, unknown>);
      if (options.model === "gpt-5.6-luna") throw new Error("luna unavailable");
      return {
        data: {
          category: "response",
          confidence: 0.9,
          title: "Fallback",
          g2Title: "Fallback",
          preview: "Fallback answer.",
          fullAnswer: "Fallback answer.",
          output: "Fallback answer.",
          language: "",
          code: "",
          explanation: "",
          reason: "primary_failed",
        },
        rawText: "{}",
        model: "gpt-5.4-mini",
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
  expect(jsonCalls[0].model).toBe("gpt-5.6-luna");
  expect(jsonCalls[0].reasoningEffort).toBe("low");
  expect(jsonCalls[0].serviceTier).toBeUndefined();
  expect(jsonCalls[0].temperature).toBeNull();
  expect(jsonCalls[0].conversationId).toBe("conv_openai_1");
  expect(jsonCalls[1].model).toBe("gpt-5.4-mini");
  expect(jsonCalls[1].serviceTier).toBeUndefined();
  expect(jsonCalls[1].conversationId).toBeUndefined();
  expect(jsonCalls[1].prompt).toContain("You are SayNext's automatic cue writer");
  expect(result.model).toBe("gpt-5.4-mini");
  expect(result.lane).toBe("stateless_fallback");
});

test("OpenAI auto cue does not invoke the fallback after a request is cancelled", async () => {
  const jsonCalls: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  controller.abort();
  const generator = new OpenAiAutoCueGenerator({
    model: "gpt-5.6-luna",
    fallbackModel: "gpt-5.4-mini",
    jsonGenerator: async (options) => {
      jsonCalls.push(options as unknown as Record<string, unknown>);
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });

  let caught: unknown;
  try {
    await generator.generate({
      triggerWindow: "Can you walk me through your",
      recentTranscript: "",
      contextSnapshot: "Current partial question.",
      settings: defaultEvenHubV2Settings(),
      router: null,
      speculative: true,
      signal: controller.signal,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).name).toBe("AbortError");
  expect(jsonCalls).toHaveLength(1);
  expect(jsonCalls[0].signal).toBe(controller.signal);
});
