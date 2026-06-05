import {
  shouldApplyAnswerPlannerMemoryPolicy,
  type AnswerPlannerShadowMetadata,
} from "./answer-planner-runtime";

export interface PlannerMemoryRetrievalDecision {
  shouldRetrieve: boolean;
  query: string;
  reason: string;
}

export function resolvePlannerMemoryRetrievalDecision(params: {
  isClassroomMode: boolean;
  fallbackQuery: string;
  answerPlannerMetadata?: AnswerPlannerShadowMetadata;
  env?: NodeJS.ProcessEnv;
}): PlannerMemoryRetrievalDecision {
  const fallbackQuery = params.fallbackQuery.replace(/\s+/g, " ").trim();
  if (params.isClassroomMode) {
    return {
      shouldRetrieve: false,
      query: "",
      reason: "hard:classroom_no_personal_memory",
    };
  }

  const applyPlannerMemoryPolicy = shouldApplyAnswerPlannerMemoryPolicy(
    params.answerPlannerMetadata,
    params.env,
  );
  const plannerPolicy = params.answerPlannerMetadata?.resolvedPolicy;
  if (applyPlannerMemoryPolicy && !plannerPolicy?.needsMemory) {
    return {
      shouldRetrieve: false,
      query: "",
      reason: "planner:no_memory_needed",
    };
  }

  const plannerQuery = applyPlannerMemoryPolicy ? plannerPolicy?.memoryQuery?.trim() : "";
  return {
    shouldRetrieve: true,
    query: plannerQuery || fallbackQuery,
    reason: plannerQuery ? "planner:memory_query" : "fallback:memory_query",
  };
}
