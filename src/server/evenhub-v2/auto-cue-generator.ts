import { generateOpenAiJson } from "../local-llm/openai-json-client";
import type { AutoCueCategory, EvenHubV2Settings } from "./protocol";

export type AutoCueGeneratorInput = {
  triggerWindow: string;
  recentTranscript: string;
  contextSnapshot: string;
  settings: EvenHubV2Settings;
};

export type AutoCueGeneratorOutput = {
  category: AutoCueCategory;
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

const CATEGORIES = new Set<AutoCueCategory>(["response", "concept", "suggestion", "person", "none"]);

function cleanOneLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanOutput(value: unknown): string {
  return String(value ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 900);
}

export function normalizeAutoCueOutput(value: unknown): AutoCueGeneratorOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const category = CATEGORIES.has(record.category as AutoCueCategory)
    ? record.category as AutoCueCategory
    : "none";
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;
  const title = cleanOneLine(record.title, 64);
  const g2Title = cleanOneLine(record.g2Title || title, 28);
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
  confidenceThreshold: number;
  previousOutputHash?: string | null;
  outputHash: string;
  conversationActive: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!params.conversationActive) return { ok: false, reason: "conversation_not_active" };
  if (params.cue.category === "none") return { ok: false, reason: "category_none" };
  if (params.cue.confidence < params.confidenceThreshold) return { ok: false, reason: "low_confidence" };
  if (!params.cue.title) return { ok: false, reason: "empty_title" };
  if (!params.cue.g2Title) return { ok: false, reason: "empty_g2_title" };
  if (!params.cue.output) return { ok: false, reason: "empty_output" };
  if (params.cue.output.length < 8) return { ok: false, reason: "output_too_short" };
  if (params.cue.output.length > 900) return { ok: false, reason: "output_too_long" };
  if (params.previousOutputHash && params.previousOutputHash === params.outputHash) {
    return { ok: false, reason: "duplicate_output" };
  }
  return { ok: true };
}

export class OpenAiAutoCueGenerator implements AutoCueGenerator {
  constructor(private readonly model = process.env.EVENHUB_V2_AUTO_CUE_MODEL || process.env.SAYNEXT_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-nano") {}

  async generate(input: AutoCueGeneratorInput): Promise<AutoCueGenerationResult> {
    const prompt = [
      "You are SayNext's high-precision automatic cue generator for live conversations.",
      "Goal: create a cue only when it is clearly useful. Prefer category none when uncertain.",
      "Do not chase coverage. A skipped cue is better than a wrong or noisy cue.",
      "",
      "Return exactly one JSON object:",
      '{ "category": "response|concept|suggestion|person|none", "confidence": 0.0, "title": "...", "g2Title": "...", "output": "...", "reason": "..." }',
      "",
      "Category definitions:",
      "- response: the latest speech clearly asks for or requires a reply.",
      "- concept: a useful concept or knowledge point from a lecture/explanation.",
      "- suggestion: a concrete next step, trade-off, or action guidance.",
      "- person: narrow use only; explicit person/role/speaker/responsibility information.",
      "- none: greetings, noise, incomplete fragments, weak context, or anything uncertain.",
      "",
      "Title rules: title <= 64 chars; g2Title <= 28 chars.",
      "Output rules: concise, directly useful, no markdown, no labels.",
      "",
      input.contextSnapshot,
    ].join("\n");

    const result = await generateOpenAiJson<AutoCueGeneratorOutput>({
      model: this.model,
      prompt,
      temperature: 0.05,
      timeoutMs: Number(process.env.EVENHUB_V2_AUTO_CUE_TIMEOUT_MS || 90000),
    });

    return {
      data: normalizeAutoCueOutput(result.data),
      rawText: result.rawText,
      model: result.model,
    };
  }
}
