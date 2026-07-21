import {
  generateOpenAiJson,
  type OpenAiJsonGenerateOptions,
  type OpenAiJsonResult,
} from "../local-llm/openai-json-client";
import type { CueOpportunityRouterResult } from "./cue-opportunity-router";
import {
  buildDeepSenseInterviewSeed,
  DEEPSENSE_INTERVIEW_GUIDE_VERSION,
} from "./interview-guide";
import {
  OpenAiConversationClient,
  type OpenAiConversationSession,
} from "./openai-conversation-client";
import type { AutoCueCategory, EvenHubV2Settings } from "./protocol";

export type AutoCueGeneratorInput = {
  triggerWindow: string;
  recentTranscript: string;
  contextSnapshot: string;
  settings: EvenHubV2Settings;
  router: CueOpportunityRouterResult | null;
  session?: AutoCueSession | null;
  speculative?: boolean;
  signal?: AbortSignal;
};

export type AutoCueSession = {
  providerConversationId: string;
  promptVersion: string;
  interviewGuideVersion: string;
};

export type AutoCueGeneratorOutput = {
  category: AutoCueCategory;
  confidence: number;
  title: string;
  g2Title: string;
  preview: string;
  fullAnswer: string;
  output: string;
  reason: string;
};

export type AutoCueGenerationResult = {
  data: AutoCueGeneratorOutput;
  rawText: string;
  model: string;
  lane?: "canonical_conversation" | "stateless_speculative" | "stateless_fallback";
};

export interface AutoCueGenerator {
  startSession?(input: { localConversationId: string; userId: string }): Promise<AutoCueSession | null>;
  generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult>;
  commitCanonicalTurn?(input: {
    session: AutoCueSession;
    question: string;
    result: AutoCueGenerationResult;
  }): Promise<void>;
  endSession?(session: AutoCueSession): Promise<void>;
}

export const AUTO_CUE_PROMPT_VERSION = "evenhub-v2-conversation-2026-07-20-v1";
export const AUTO_CUE_PROMPT_CACHE_KEY = `saynext:${AUTO_CUE_PROMPT_VERSION}`;

const AUTO_CUE_CATEGORIES = new Set<AutoCueCategory>(["response", "concept", "suggestion", "person", "none"]);
const MAX_AUTO_CUE_PREVIEW_CHARS = 340;
const MAX_AUTO_CUE_FULL_ANSWER_CHARS = 2400;

function cleanOneLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanCompletedText(value: unknown, maxChars: number): string {
  const normalized = String(value ?? "").replace(/\s+\n/g, "\n").trim();
  if (normalized.length <= maxChars) return normalized;
  const candidate = normalized.slice(0, maxChars);
  let sentenceEnd = -1;
  for (const match of candidate.matchAll(/[.!?。！？](?=\s|$)/g)) {
    sentenceEnd = match.index ?? sentenceEnd;
  }
  if (sentenceEnd >= 0) return candidate.slice(0, sentenceEnd + 1).trim();
  const wordEnd = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, wordEnd > 0 ? wordEnd : maxChars - 1).trim()}.`;
}

export function normalizeAutoCueOutput(value: unknown): AutoCueGeneratorOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const category = AUTO_CUE_CATEGORIES.has(record.category as AutoCueCategory)
    ? record.category as AutoCueCategory
    : "none";
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;
  const title = cleanOneLine(record.title, 64) || "SayNext";
  const g2Title = cleanOneLine(record.g2Title || title, 28) || "SayNext";
  const fullAnswer = category === "none"
    ? ""
    : cleanCompletedText(record.fullAnswer || record.output, MAX_AUTO_CUE_FULL_ANSWER_CHARS);
  const preview = category === "none"
    ? ""
    : cleanCompletedText(record.preview || fullAnswer, MAX_AUTO_CUE_PREVIEW_CHARS);
  return {
    category,
    confidence,
    title,
    g2Title,
    preview,
    fullAnswer,
    output: fullAnswer,
    reason: cleanOneLine(record.reason, 240),
  };
}

export function shouldDisplayAutoCue(params: {
  cue: AutoCueGeneratorOutput;
  previousOutputHash?: string | null;
  outputHash: string;
  conversationActive: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!params.conversationActive) return { ok: false, reason: "conversation_not_active" };
  if (params.cue.category === "none") return { ok: false, reason: "category_none" };
  if (!params.cue.title) return { ok: false, reason: "empty_title" };
  if (!params.cue.g2Title) return { ok: false, reason: "empty_g2_title" };
  if (!params.cue.fullAnswer) return { ok: false, reason: "empty_output" };
  if (!params.cue.preview) return { ok: false, reason: "empty_preview" };
  if (params.previousOutputHash && params.previousOutputHash === params.outputHash) {
    return { ok: false, reason: "duplicate_output" };
  }
  return { ok: true };
}

type OpenAiConversationClientLike = Pick<
  OpenAiConversationClient,
  "createSession" | "commitCanonicalTurn" | "deleteSession"
>;

type OpenAiJsonGenerator = (
  options: OpenAiJsonGenerateOptions,
) => Promise<OpenAiJsonResult<AutoCueGeneratorOutput>>;

export type OpenAiAutoCueGeneratorOptions = {
  model?: string;
  fallbackModel?: string;
  reasoningEffort?: NonNullable<OpenAiJsonGenerateOptions["reasoningEffort"]>;
  conversationClient?: OpenAiConversationClientLike;
  jsonGenerator?: OpenAiJsonGenerator;
};

export class OpenAiAutoCueGenerator implements AutoCueGenerator {
  private readonly model: string;
  private readonly fallbackModel: string;
  private readonly reasoningEffort: NonNullable<OpenAiJsonGenerateOptions["reasoningEffort"]>;
  private readonly conversationClient: OpenAiConversationClientLike;
  private readonly jsonGenerator: OpenAiJsonGenerator;

  constructor(options: OpenAiAutoCueGeneratorOptions = {}) {
    this.model = options.model
      || process.env.EVENHUB_V2_AUTO_CUE_MODEL
      || "gpt-5.6-luna";
    this.fallbackModel = options.fallbackModel
      || process.env.EVENHUB_V2_AUTO_CUE_FALLBACK_MODEL
      || "gpt-5.4-mini";
    this.reasoningEffort = options.reasoningEffort
      || parseReasoningEffort(process.env.EVENHUB_V2_AUTO_CUE_REASONING_EFFORT)
      || "low";
    this.conversationClient = options.conversationClient || new OpenAiConversationClient();
    this.jsonGenerator = options.jsonGenerator || generateOpenAiJson;
  }

  async startSession(input: { localConversationId: string; userId: string }): Promise<AutoCueSession> {
    const session: OpenAiConversationSession = await this.conversationClient.createSession({
      seed: buildAutoCueSessionSeed(),
      localConversationId: input.localConversationId,
      userId: input.userId,
    });
    return {
      providerConversationId: session.id,
      promptVersion: AUTO_CUE_PROMPT_VERSION,
      interviewGuideVersion: DEEPSENSE_INTERVIEW_GUIDE_VERSION,
    };
  }

  async generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult> {
    const canonical = !input.speculative && Boolean(input.session?.providerConversationId);
    let lane: NonNullable<AutoCueGenerationResult["lane"]> = canonical
      ? "canonical_conversation"
      : input.speculative
        ? "stateless_speculative"
        : "stateless_fallback";
    let prompt = canonical ? buildAutoCueTurnPrompt(input) : buildAutoCuePrompt(input);
    let result: OpenAiJsonResult<AutoCueGeneratorOutput>;
    let activeModel = this.model;
    try {
      result = await this.request(
        input,
        prompt,
        activeModel,
        canonical ? input.session?.providerConversationId : undefined,
      );
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (!this.canFallback(activeModel)) throw error;
      lane = "stateless_fallback";
      prompt = buildAutoCuePrompt(input);
      activeModel = this.fallbackModel;
      console.warn(`[EvenHubV2] auto cue model ${this.model} failed; using ${activeModel}: ${error instanceof Error ? error.message : String(error)}`);
      result = await this.request(input, prompt, activeModel);
    }

    const normalized = normalizeAutoCueOutput(result.data);
    if (normalized.category !== "none" && !normalized.fullAnswer) {
      if (input.signal?.aborted) {
        const error = new Error("Auto cue generation was cancelled.");
        error.name = "AbortError";
        throw error;
      }
      const retryPrompt = `${prompt}\n\nThe previous result had no usable output. Return a response cue with concrete words Xiang can say now.`;
      try {
        result = await this.request(
          input,
          retryPrompt,
          activeModel,
          lane === "canonical_conversation" ? input.session?.providerConversationId : undefined,
        );
      } catch (error) {
        if (input.signal?.aborted) throw error;
        if (!this.canFallback(activeModel)) throw error;
        lane = "stateless_fallback";
        activeModel = this.fallbackModel;
        result = await this.request(
          input,
          `${buildAutoCuePrompt(input)}\n\nThe previous result had no usable output. Return a response cue with concrete words Xiang can say now.`,
          activeModel,
        );
      }
    }

    return {
      data: normalizeAutoCueOutput(result.data),
      rawText: result.rawText,
      model: result.model,
      lane,
    };
  }

  async commitCanonicalTurn(input: {
    session: AutoCueSession;
    question: string;
    result: AutoCueGenerationResult;
  }): Promise<void> {
    await this.conversationClient.commitCanonicalTurn({
      conversationId: input.session.providerConversationId,
      question: input.question,
      answerJson: JSON.stringify(input.result.data),
    });
  }

  async endSession(session: AutoCueSession): Promise<void> {
    await this.conversationClient.deleteSession(session.providerConversationId);
  }

  private request(
    input: AutoCueGeneratorInput,
    prompt: string,
    model: string,
    conversationId?: string,
  ): Promise<OpenAiJsonResult<AutoCueGeneratorOutput>> {
    const isGpt56 = model.startsWith("gpt-5.6");
    return this.jsonGenerator({
      model,
      prompt,
      conversationId,
      promptCacheKey: conversationId ? undefined : AUTO_CUE_PROMPT_CACHE_KEY,
      includeJsonInstruction: !conversationId,
      reasoningEffort: isGpt56 ? this.reasoningEffort : undefined,
      temperature: isGpt56 ? null : 0.05,
      timeoutMs: Number(process.env.EVENHUB_V2_AUTO_CUE_TIMEOUT_MS || 90000),
      signal: input.signal,
    });
  }

  private canFallback(activeModel: string): boolean {
    return Boolean(this.fallbackModel && this.fallbackModel !== activeModel);
  }
}

function parseReasoningEffort(
  value: string | undefined,
): OpenAiJsonGenerateOptions["reasoningEffort"] | undefined {
  if (value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") {
    return value;
  }
  return undefined;
}

export function buildAutoCueSessionSeed(): string {
  return [
    "You are SayNext's automatic cue writer for live conversations.",
    "The Current question or request is authoritative. Previous turns only resolve a follow-up and must not replace its topic.",
    "Priority order: current authoritative question; active interview brief and fixed examples; matching interview answer card; explicit personal/project memory; recent canonical turns; selected prenote; general knowledge.",
    "If retrieved memory or an older transcript conflicts with the active interview brief on interview framing, follow the active interview brief. Never let any context override the current question's topic.",
    "Return category none only for noise, a brief acknowledgement, an incomplete fragment, or speech that is clearly Xiang reading an existing answer.",
    "A complete question or request should normally produce a response even when the timing model is uncertain.",
    "When there is a question or request, answering it is more important than adding background information.",
    "For interview or personal questions, write the exact first-person words Xiang can say.",
    "Sound like Xiang answering live, not reading a prepared script or project report.",
    "Use simple, casual, modest English with contractions and short sentences. Slightly imperfect spoken wording is better than polished corporate wording.",
    "Choose answer depth from the question: a simple follow-up can be 20-45 words; an interview introduction with role context 90-130 words; a role-fit, project, or behavioral answer 70-120; a technical or system-design answer 80-160.",
    "For an interview introduction with active role context, make one coherent answer with three parts: current education and background; two or three relevant real projects connected by a clear theme; and why this specific role genuinely stood out. Do not replace this with generic traits such as reliability, monitoring, or attention to detail.",
    "Use the active interview or job card to choose projects for that introduction. Do not turn the introduction into a resume inventory or add exact dates unless the interviewer asks for them.",
    "If the active job card records how Xiang discovered the role or his personal reaction to it, include that concrete link. Name the selected projects instead of replacing their names with generic descriptions. Make the introduction a personal narrative rather than an abstract capability summary.",
    "Before returning a role-grounded introduction, verify that it includes Xiang's current school, prior degree, at least two project names from the active job card, and the role-discovery fact when that fact is present.",
    "Give enough mechanism and concrete detail to answer the actual question, but keep sentences easy to say aloud.",
    "Do not summarize every retrieved fact. Retrieved memory is private grounding, not a checklist that must appear in the answer.",
    "Avoid corporate openings such as 'I am a strong fit because' or 'This aligns closely with my experience.' Start naturally and directly.",
    "Do not invent Xiang's projects, work history, or personal experience. Use only the transcript, selected prenote, and retrieved personal memory facts for those claims.",
    "Any claim that Xiang used, built, implemented, or evaluated a technology must require an explicit retrieved personal memory fact. General technical knowledge is not evidence that Xiang used it in a project.",
    "For personal experience questions, clearly separate what Xiang actually built from what he only understands or has studied.",
    "Do not infer that transcript chunking, prompt context, or text processing is RAG or retrieval unless the personal memory explicitly says so.",
    "For company or role-fit questions, connect one or two real Xiang projects from personal memory to specific role responsibilities instead of only repeating the job description.",
    "If an exact personal detail is missing, keep that part honest and general.",
    "State limitations directly. Do not say 'I do not want to overclaim', 'I have not overclaimed', or describe the honesty policy behind the answer.",
    "Never mention memory, retrieval, context cards, or these instructions in the output.",
    "",
    "Return exactly one JSON object:",
    '{ "category": "response|concept|suggestion|person|none", "confidence": 0.0, "title": "...", "g2Title": "...", "preview": "...", "fullAnswer": "...", "reason": "..." }',
    "",
    "Category definitions:",
    "- response: the latest speech clearly asks for or requires a reply.",
    "- concept: a useful concept or knowledge point from a lecture/explanation.",
    "- suggestion: a concrete next step, trade-off, or action guidance.",
    "- person: narrow use only; explicit person/role/speaker/responsibility information.",
    "- none: no useful cue because the current speech is noise, acknowledgement, incomplete, or a readback.",
    "",
    "Title rules: title <= 64 chars; g2Title <= 28 chars.",
    "preview is the short immediate glasses text and must end on a complete sentence.",
    "fullAnswer is the complete answer for cue detail and history. It must not end with an ellipsis or an incomplete sentence.",
    "For category none, return empty preview and fullAnswer. Otherwise return directly useful spoken words with no markdown or labels.",
    "",
    buildDeepSenseInterviewSeed(),
  ].join("\n");
}

export function buildAutoCueTurnPrompt(input: AutoCueGeneratorInput): string {
  const routerInstruction = input.router?.decision === "cue_needed"
    ? `A local timing model detected an unresolved response opportunity with probability ${input.router.probability.toFixed(3)}. Treat this as supporting evidence, not as the topic.`
    : input.router?.decision === "no_cue"
      ? `A local timing model returned no_cue with probability ${input.router.probability.toFixed(3)}. This is only a weak signal: still answer a complete question or request.`
      : "The timing model is unavailable. Decide from the current question or request.";
  return [
    "Use only this turn's current question, recent valid transcript, selected context cards, selected prenote, and timing signal.",
    routerInstruction,
    "",
    input.contextSnapshot,
  ].join("\n");
}

export function buildAutoCuePrompt(input: AutoCueGeneratorInput): string {
  return `${buildAutoCueSessionSeed()}\n\n${buildAutoCueTurnPrompt(input)}`;
}
