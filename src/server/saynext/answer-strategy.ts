import type { AnswerIntent } from "./answer-intent";
import { buildAnswerIntentHint } from "./answer-intent";
import type { AnswerPlanOutputShape } from "./answer-plan";
import {
  shouldApplyAnswerPlannerShapePolicy,
  type AnswerPlannerShadowMetadata,
} from "./answer-planner-runtime";
import {
  buildResolvedAnswerPolicyHint,
  type ResolvedAnswerPolicy,
} from "./policy-resolver";

export type FinalAnswerStrategySource = "planner_policy" | "legacy_intent";

export interface FinalAnswerStrategy {
  source: FinalAnswerStrategySource;
  promptHint: string;
  conversationStrategy?: string;
  conversationIntent?: AnswerIntent;
  answerOutputShape?: AnswerPlanOutputShape;
  resolvedPolicy?: ResolvedAnswerPolicy;
}

export function summarizeResolvedPolicy(policy: ResolvedAnswerPolicy): string {
  return [
    "planner",
    `task=${policy.task}`,
    `shape=${policy.outputShape}`,
    `depth=${policy.answerDepth}`,
    `memory=${policy.needsMemory ? "yes" : "no"}`,
    `code=${policy.needsCode ? "yes" : "no"}`,
    `risk=${policy.riskLevel}`,
  ].join("; ");
}

export function resolveFinalAnswerStrategy(params: {
  legacyAnswerIntent: AnswerIntent;
  answerPlannerMetadata?: AnswerPlannerShadowMetadata;
  env?: NodeJS.ProcessEnv;
}): FinalAnswerStrategy {
  const plannerPolicy = params.answerPlannerMetadata?.resolvedPolicy;
  if (plannerPolicy && shouldApplyAnswerPlannerShapePolicy(params.answerPlannerMetadata, params.env)) {
    return {
      source: "planner_policy",
      promptHint: buildResolvedAnswerPolicyHint(plannerPolicy),
      conversationStrategy: summarizeResolvedPolicy(plannerPolicy),
      answerOutputShape: plannerPolicy.outputShape,
      resolvedPolicy: plannerPolicy,
    };
  }

  return {
    source: "legacy_intent",
    promptHint: buildAnswerIntentHint(params.legacyAnswerIntent),
    conversationIntent: params.legacyAnswerIntent,
  };
}
