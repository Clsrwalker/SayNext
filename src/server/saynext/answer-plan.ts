import { z } from "zod";
import type { AnswerIntent } from "./answer-intent";
import type { PromptMode } from "./process-router";

export const ANSWER_PLAN_SCENES = [
  "interview",
  "daily",
  "classroom",
  "meeting",
  "technical",
  "service",
  "general",
] as const;

export const ANSWER_PLAN_TASKS = [
  "daily_chat",
  "ordinary_practical",
  "personal_fact",
  "technical_mechanism",
  "technical_debug",
  "code_solution",
  "system_design",
  "project_experience",
  "behavioral_story",
  "interview_intro",
  "interview_concept",
  "classroom_answer",
  "classroom_question",
  "classroom_no_reply",
  "meeting_progress",
  "meeting_blocker",
  "meeting_decision",
  "meeting_clarification",
  "service_admin",
  "risk_boundary",
  "privacy_risk",
  "no_reply",
] as const;

export const ANSWER_PLAN_DIALOGUE_ACTS = [
  "answer_question",
  "clarify",
  "explain",
  "debug",
  "give_progress",
  "suggest_next_step",
  "soft_reaction",
  "decline",
  "ask_followup",
  "no_reply",
] as const;

export const ANSWER_PLAN_OUTPUT_SHAPES = [
  "one_sentence",
  "direct_answer",
  "mechanism_tradeoff",
  "debug_steps",
  "code_with_explanation",
  "project_role_challenge_lesson",
  "behavioral_story_lesson",
  "done_next_blocker",
  "soft_casual_reply",
  "clarifying_question",
  "no_reply",
] as const;

export const AnswerPlanSchema = z.object({
  scene: z.enum(ANSWER_PLAN_SCENES),
  task: z.enum(ANSWER_PLAN_TASKS),
  dialogueAct: z.enum(ANSWER_PLAN_DIALOGUE_ACTS),
  outputShape: z.enum(ANSWER_PLAN_OUTPUT_SHAPES),
  answerDepth: z.enum(["minimal", "short", "medium", "deep"]),
  shouldSpeak: z.boolean(),
  needsMemory: z.boolean(),
  memoryQuery: z.string().trim().optional(),
  needsIdentityFactCard: z.boolean(),
  needsCode: z.boolean(),
  needsFewShot: z.boolean(),
  riskLevel: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().max(600),
  transcriptQuality: z.enum(["clear", "partial", "noisy", "too_short"]).optional(),
  missingInfo: z.array(z.string().trim().max(120)).max(8).optional(),
  safeFallback: z.enum(["no_reply", "clarify", "short_general"]).optional(),
});

export type AnswerPlanScene = z.infer<typeof AnswerPlanSchema>["scene"];
export type AnswerPlanTask = z.infer<typeof AnswerPlanSchema>["task"];
export type AnswerPlanDialogueAct = z.infer<typeof AnswerPlanSchema>["dialogueAct"];
export type AnswerPlanOutputShape = z.infer<typeof AnswerPlanSchema>["outputShape"];
export type AnswerPlan = z.infer<typeof AnswerPlanSchema>;

export interface AnswerPlannerInput {
  activeScene: PromptMode | string;
  sceneLocked?: boolean;
  latestUtterance: string;
  recentTranscript?: string;
  outputLanguage?: "English" | "Chinese" | string;
  legacyAnswerIntent?: AnswerIntent | string;
  eventMemorySummary?: string;
  hasPreparedNote?: boolean;
  hasPersonalMemoryCandidates?: boolean;
}

export interface ParsedAnswerPlan {
  plan: AnswerPlan | null;
  error?: string;
}

function normalizeScene(activeScene: PromptMode | string): AnswerPlanScene {
  const normalized = String(activeScene || "general").toLowerCase();
  if (normalized === "casual") return "daily";
  if (normalized === "interview") return "interview";
  if (normalized === "classroom") return "classroom";
  if (normalized === "technical") return "technical";
  if (normalized === "service") return "service";
  return "general";
}

export function parseAnswerPlan(value: unknown): ParsedAnswerPlan {
  const parsed = AnswerPlanSchema.safeParse(value);
  if (parsed.success) return { plan: parsed.data };
  return {
    plan: null,
    error: parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; "),
  };
}

export function fallbackAnswerPlanFromIntent(
  intent: AnswerIntent | string,
  input: Pick<AnswerPlannerInput, "activeScene" | "latestUtterance">,
): AnswerPlan {
  const scene = normalizeScene(input.activeScene);
  const base: AnswerPlan = {
    scene,
    task: "daily_chat",
    dialogueAct: "answer_question",
    outputShape: "direct_answer",
    answerDepth: "short",
    shouldSpeak: true,
    needsMemory: scene === "interview",
    needsIdentityFactCard: false,
    needsCode: false,
    needsFewShot: false,
    riskLevel: "low",
    confidence: 0.42,
    reason: `Fallback from legacy intent: ${String(intent || "unknown")}`,
    transcriptQuality: input.latestUtterance.trim().length < 8 ? "too_short" : "clear",
    safeFallback: input.latestUtterance.trim() ? "short_general" : "no_reply",
  };

  switch (intent) {
    case "ordinary_practical":
      return {
        ...base,
        task: "ordinary_practical",
        outputShape: "one_sentence",
        answerDepth: "minimal",
        needsMemory: false,
      };
    case "personal_fact":
      return {
        ...base,
        task: "personal_fact",
        outputShape: "direct_answer",
        answerDepth: "minimal",
        needsMemory: false,
        needsIdentityFactCard: true,
        confidence: 0.55,
      };
    case "technical_debug":
      return {
        ...base,
        task: "technical_debug",
        dialogueAct: "debug",
        outputShape: "debug_steps",
        answerDepth: "medium",
      };
    case "technical_mechanism":
      return {
        ...base,
        task: "technical_mechanism",
        dialogueAct: "explain",
        outputShape: "mechanism_tradeoff",
        answerDepth: "medium",
        needsMemory: false,
      };
    case "interview_code_solution":
      return {
        ...base,
        scene: "interview",
        task: "code_solution",
        outputShape: "code_with_explanation",
        answerDepth: "deep",
        needsMemory: true,
        needsCode: true,
      };
    case "interview_debug_solution":
      return {
        ...base,
        scene: "interview",
        task: "technical_debug",
        dialogueAct: "debug",
        outputShape: "debug_steps",
        answerDepth: "deep",
        needsMemory: true,
      };
    case "interview_technical_solution":
      return {
        ...base,
        scene: "interview",
        task: "system_design",
        outputShape: "mechanism_tradeoff",
        answerDepth: "deep",
        needsMemory: true,
      };
    case "interview_project":
      return {
        ...base,
        scene: "interview",
        task: "project_experience",
        outputShape: "project_role_challenge_lesson",
        answerDepth: "medium",
        needsMemory: true,
      };
    case "interview_behavioral":
      return {
        ...base,
        scene: "interview",
        task: "behavioral_story",
        outputShape: "behavioral_story_lesson",
        answerDepth: "medium",
        needsMemory: true,
      };
    case "interview_intro":
      return {
        ...base,
        scene: "interview",
        task: "interview_intro",
        outputShape: "direct_answer",
        answerDepth: "short",
        needsMemory: true,
      };
    case "classroom_answer":
      return {
        ...base,
        scene: "classroom",
        task: "classroom_answer",
        dialogueAct: "explain",
        outputShape: "mechanism_tradeoff",
        answerDepth: "medium",
        needsMemory: false,
      };
    case "classroom_note":
      return {
        ...base,
        scene: "classroom",
        task: "classroom_question",
        dialogueAct: "explain",
        outputShape: "direct_answer",
        answerDepth: "short",
        needsMemory: false,
      };
    case "service_risk":
      return {
        ...base,
        task: "risk_boundary",
        dialogueAct: "decline",
        outputShape: "direct_answer",
        riskLevel: "high",
        needsMemory: false,
      };
    case "privacy_risk":
      return {
        ...base,
        task: "privacy_risk",
        outputShape: "direct_answer",
        riskLevel: "high",
        needsMemory: false,
      };
    case "service_admin":
      return {
        ...base,
        task: "service_admin",
        outputShape: "direct_answer",
        needsMemory: false,
      };
    case "casual_opinion":
      return {
        ...base,
        task: "daily_chat",
        outputShape: "soft_casual_reply",
        needsMemory: false,
      };
    default:
      return base;
  }
}
