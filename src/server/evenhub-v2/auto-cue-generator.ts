import { generateOpenAiJson } from "../local-llm/openai-json-client";
import type { CueOpportunityRouterResult } from "./cue-opportunity-router";
import type { AutoCueCategory, EvenHubV2Settings } from "./protocol";

export type AutoCueGeneratorInput = {
  triggerWindow: string;
  recentTranscript: string;
  contextSnapshot: string;
  settings: EvenHubV2Settings;
  router: CueOpportunityRouterResult | null;
};

export type AutoCueGeneratorOutput = {
  category: Exclude<AutoCueCategory, "none">;
  confidence: number;
  title: string;
  g2Title: string;
  output: string;
  reason: string;
};

export type AutoCueGenerationResult = {
  data: AutoCueGeneratorOutput;
  rawText: string;
  model: string;
};

export interface AutoCueGenerator {
  generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult>;
}

const DISPLAY_CATEGORIES = new Set<Exclude<AutoCueCategory, "none">>(["response", "concept", "suggestion", "person"]);

function cleanOneLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanOutput(value: unknown): string {
  return String(value ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 900);
}

export function normalizeAutoCueOutput(value: unknown): AutoCueGeneratorOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const category = DISPLAY_CATEGORIES.has(record.category as Exclude<AutoCueCategory, "none">)
    ? record.category as Exclude<AutoCueCategory, "none">
    : "response";
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;
  const title = cleanOneLine(record.title, 64) || "SayNext";
  const g2Title = cleanOneLine(record.g2Title || title, 28) || "SayNext";
  return {
    category,
    confidence,
    title,
    g2Title,
    output: cleanOutput(record.output),
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
  if (!params.cue.title) return { ok: false, reason: "empty_title" };
  if (!params.cue.g2Title) return { ok: false, reason: "empty_g2_title" };
  if (!params.cue.output) return { ok: false, reason: "empty_output" };
  if (params.cue.output.length > 900) return { ok: false, reason: "output_too_long" };
  if (params.previousOutputHash && params.previousOutputHash === params.outputHash) {
    return { ok: false, reason: "duplicate_output" };
  }
  return { ok: true };
}

export class OpenAiAutoCueGenerator implements AutoCueGenerator {
  constructor(private readonly model = process.env.EVENHUB_V2_AUTO_CUE_MODEL || process.env.SAYNEXT_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-nano") {}

  async generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult> {
    const routerInstruction = input.router?.decision === "cue_needed"
      ? `The local router detected an unresolved response opportunity with probability ${input.router.probability.toFixed(3)}. You must produce the exact useful words Xiang can say next; prefer category response.`
      : "No unresolved response was confirmed by the local router. Still produce the most useful concept, suggestion, person cue, or conversational response for the latest context.";
    const prompt = [
      "You are SayNext's automatic cue writer for live conversations.",
      "Always return one useful cue. Never return category none and never leave output empty.",
      "When there is a question or request, answering it is more important than adding background information.",
      routerInstruction,
      "",
      "Return exactly one JSON object:",
      '{ "category": "response|concept|suggestion|person", "confidence": 0.0, "title": "...", "g2Title": "...", "output": "...", "reason": "..." }',
      "",
      "Category definitions:",
      "- response: the latest speech clearly asks for or requires a reply.",
      "- concept: a useful concept or knowledge point from a lecture/explanation.",
      "- suggestion: a concrete next step, trade-off, or action guidance.",
      "- person: narrow use only; explicit person/role/speaker/responsibility information.",
      "",
      "Title rules: title <= 64 chars; g2Title <= 28 chars.",
      "Output rules: concise, directly useful, no markdown, no labels.",
      "",
      input.contextSnapshot,
    ].join("\n");

    let result = await generateOpenAiJson<AutoCueGeneratorOutput>({
      model: this.model,
      prompt,
      temperature: 0.05,
      timeoutMs: Number(process.env.EVENHUB_V2_AUTO_CUE_TIMEOUT_MS || 90000),
    });

    if (!normalizeAutoCueOutput(result.data).output) {
      result = await generateOpenAiJson<AutoCueGeneratorOutput>({
        model: this.model,
        prompt: `${prompt}\n\nThe previous result had no usable output. Return a response cue with concrete words Xiang can say now.`,
        temperature: 0.05,
        timeoutMs: Number(process.env.EVENHUB_V2_AUTO_CUE_TIMEOUT_MS || 90000),
      });
    }

    return {
      data: normalizeAutoCueOutput(result.data),
      rawText: result.rawText,
      model: result.model,
    };
  }
}
