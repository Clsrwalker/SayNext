import { generateOpenAiJson } from "../local-llm/openai-json-client";
import {
  AnswerPlanSchema,
  fallbackAnswerPlanFromIntent,
  parseAnswerPlan,
  type AnswerPlan,
  type AnswerPlannerInput,
} from "./answer-plan";
import { ANSWER_PLANNER_SYSTEM, buildAnswerPlannerPrompt } from "./answer-planner-prompt";
import { resolveAnswerPolicy, type ResolvedAnswerPolicy } from "./policy-resolver";

const DEFAULT_PLANNER_TIMEOUT_MS = 1800;
export type AnswerPlannerRuntimeMode = "off" | "shadow" | "shape" | "policy";

export interface AnswerPlannerShadowMetadata {
  enabled: boolean;
  mode?: AnswerPlannerRuntimeMode;
  skippedReason?: string;
  model?: string;
  latencyMs?: number;
  plan?: AnswerPlan;
  resolvedPolicy?: ResolvedAnswerPolicy;
  fallbackPlan?: AnswerPlan;
  error?: string;
  rawTextPreview?: string;
}

export function getAnswerPlannerMode(env: NodeJS.ProcessEnv = process.env): AnswerPlannerRuntimeMode {
  const raw = String(env.SAYNEXT_PLANNER_MODE || env.SAYNEXT_PLANNER_CONTROL_MODE || "").trim().toLowerCase();
  if (raw === "policy" || raw === "control" || raw === "memory" || raw === "full") return "policy";
  if (raw === "shape") return "shape";
  if (raw === "shadow") return "shadow";
  if (/^(1|true|yes|on)$/i.test(String(env.SAYNEXT_PLANNER_SHADOW_ENABLED || ""))) return "shadow";
  return "off";
}

export function isAnswerPlannerShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAnswerPlannerMode(env) !== "off";
}

export function getAnswerPlannerModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.SAYNEXT_PLANNER_MODEL
    || env.OPENAI_PLANNER_MODEL
    || env.OPENAI_MODEL
    || env.MODEL_NAME
    || "gpt-5.4-nano";
}

export function getAnswerPlannerTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SAYNEXT_PLANNER_TIMEOUT_MS || DEFAULT_PLANNER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PLANNER_TIMEOUT_MS;
}

function previewRawText(text: string): string | undefined {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;
}

export async function generateAnswerPlanShadow(input: AnswerPlannerInput): Promise<AnswerPlannerShadowMetadata | undefined> {
  const mode = getAnswerPlannerMode();
  if (mode === "off") return undefined;

  const startedAt = Date.now();
  const fallbackPlan = fallbackAnswerPlanFromIntent(input.legacyAnswerIntent || "unknown", input);

  try {
    const result = await generateOpenAiJson<unknown>({
      model: getAnswerPlannerModel(),
      system: ANSWER_PLANNER_SYSTEM,
      prompt: buildAnswerPlannerPrompt(input),
      temperature: 0.01,
      timeoutMs: getAnswerPlannerTimeoutMs(),
    });

    const parsed = parseAnswerPlan(result.data);
    if (!parsed.plan) {
      const resolvedPolicy = resolveAnswerPolicy(fallbackPlan, input);
      return {
        enabled: true,
        mode,
        model: result.model,
        latencyMs: Date.now() - startedAt,
        fallbackPlan,
        resolvedPolicy,
        error: `planner_schema_error:${parsed.error || "unknown"}`,
        rawTextPreview: previewRawText(result.rawText),
      };
    }

    const normalizedPlan = AnswerPlanSchema.parse(parsed.plan);
    const resolvedPolicy = resolveAnswerPolicy(normalizedPlan, input);
    return {
      enabled: true,
      mode,
      model: result.model,
      latencyMs: Date.now() - startedAt,
      plan: normalizedPlan,
      resolvedPolicy,
      rawTextPreview: previewRawText(result.rawText),
    };
  } catch (error) {
    const resolvedPolicy = resolveAnswerPolicy(fallbackPlan, input);
    return {
      enabled: true,
      mode,
      model: getAnswerPlannerModel(),
      latencyMs: Date.now() - startedAt,
      fallbackPlan,
      resolvedPolicy,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function shouldApplyAnswerPlannerShapePolicy(
  metadata: AnswerPlannerShadowMetadata | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = getAnswerPlannerMode(env);
  return (mode === "shape" || mode === "policy")
    && Boolean(metadata?.resolvedPolicy)
    && !metadata?.error;
}

export function shouldApplyAnswerPlannerMemoryPolicy(
  metadata: AnswerPlannerShadowMetadata | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getAnswerPlannerMode(env) === "policy"
    && Boolean(metadata?.resolvedPolicy)
    && !metadata?.error;
}
