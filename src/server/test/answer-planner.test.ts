import { expect, test } from "bun:test";
import { createAgentInputMetadata } from "../saynext/response-factory";
import { buildProcessTrace } from "../saynext/process-router";
import {
  fallbackAnswerPlanFromIntent,
  parseAnswerPlan,
  type AnswerPlan,
} from "../saynext/answer-plan";
import { buildAnswerPlannerPrompt } from "../saynext/answer-planner-prompt";
import {
  getAnswerPlannerMode,
  getAnswerPlannerModel,
  getAnswerPlannerTimeoutMs,
  isAnswerPlannerShadowEnabled,
  shouldApplyAnswerPlannerMemoryPolicy,
  shouldApplyAnswerPlannerShapePolicy,
} from "../saynext/answer-planner-runtime";
import {
  resolveFinalAnswerStrategy,
  summarizeResolvedPolicy,
} from "../saynext/answer-strategy";
import { resolvePlannerMemoryRetrievalDecision } from "../saynext/planner-memory-policy";
import { buildResolvedAnswerPolicyHint, resolveAnswerPolicy } from "../saynext/policy-resolver";
import { buildSayNextLiveTaskPrompt } from "../saynext/prompts";

const validPlan: AnswerPlan = {
  scene: "interview",
  task: "code_solution",
  dialogueAct: "answer_question",
  outputShape: "code_with_explanation",
  answerDepth: "deep",
  shouldSpeak: true,
  needsMemory: true,
  memoryQuery: "library design active book pagination",
  needsIdentityFactCard: false,
  needsCode: true,
  needsFewShot: true,
  riskLevel: "low",
  confidence: 0.91,
  reason: "The interviewer is asking for code structure and implementation details.",
  transcriptQuality: "clear",
};

test("planner schema accepts the semantic plan shape instead of final answer text", () => {
  const parsed = parseAnswerPlan(validPlan);

  expect(parsed.error).toBeUndefined();
  expect(parsed.plan?.task).toBe("code_solution");
  expect(parsed.plan?.outputShape).toBe("code_with_explanation");
  expect(parsed.plan?.needsCode).toBe(true);
});

test("planner schema rejects answer-like malformed objects", () => {
  const parsed = parseAnswerPlan({
    output: "I would create a Book class and a Library class.",
  });

  expect(parsed.plan).toBeNull();
  expect(parsed.error).toContain("scene");
  expect(parsed.error).toContain("task");
});

test("planner prompt asks for context planning, not a final SayNext reply", () => {
  const prompt = buildAnswerPlannerPrompt({
    activeScene: "interview",
    sceneLocked: true,
    outputLanguage: "English",
    latestUtterance: "Could you write the class skeleton for the library design?",
    recentTranscript: "The interviewer is discussing a Kindle-like library system with active book and pagination.",
    legacyAnswerIntent: "interview_code_solution",
    hasPersonalMemoryCandidates: true,
  });

  expect(prompt).toContain("Plan the response. Do not answer the user.");
  expect(prompt).toContain("Scene locked by user/app: yes");
  expect(prompt).toContain("Latest transcript: Could you write the class skeleton");
  expect(prompt).toContain("Recent transcript context:");
  expect(prompt).toContain('"task"');
  expect(prompt).toContain('"outputShape"');
  expect(prompt).not.toContain("Return only the answer");
  expect(prompt).not.toContain("Legacy fallback intent");
  expect(prompt).not.toContain("interview_code_solution");
});

test("legacy fallback maps coding interview to code plan without adding new regex behavior", () => {
  const plan = fallbackAnswerPlanFromIntent("interview_code_solution", {
    activeScene: "interview",
    latestUtterance: "Can you implement the pagination method?",
  });

  expect(plan.scene).toBe("interview");
  expect(plan.task).toBe("code_solution");
  expect(plan.outputShape).toBe("code_with_explanation");
  expect(plan.answerDepth).toBe("deep");
  expect(plan.needsCode).toBe(true);
});

test("policy resolver makes identity facts harder than interview style or memory", () => {
  const policy = resolveAnswerPolicy({
    ...validPlan,
    task: "personal_fact",
    outputShape: "project_role_challenge_lesson",
    needsMemory: true,
    needsIdentityFactCard: false,
    needsCode: true,
  }, {
    activeScene: "interview",
    sceneLocked: true,
    latestUtterance: "Where did you study before Dalhousie?",
  });

  expect(policy.task).toBe("personal_fact");
  expect(policy.outputShape).toBe("direct_answer");
  expect(policy.answerDepth).toBe("minimal");
  expect(policy.needsMemory).toBe(false);
  expect(policy.needsIdentityFactCard).toBe(true);
  expect(policy.needsCode).toBe(false);
  expect(policy.reasons).toContain("hard:identity_fact_exact");
});

test("policy resolver blocks personal memory in classroom unless it is an identity fact", () => {
  const policy = resolveAnswerPolicy({
    ...validPlan,
    scene: "classroom",
    task: "technical_mechanism",
    outputShape: "mechanism_tradeoff",
    needsMemory: true,
    needsCode: false,
  }, {
    activeScene: "classroom",
    sceneLocked: true,
    latestUtterance: "Why does dropout reduce overfitting?",
  });

  expect(policy.scene).toBe("classroom");
  expect(policy.task).toBe("classroom_answer");
  expect(policy.needsMemory).toBe(false);
  expect(policy.reasons).toContain("hard:classroom_drops_personal_memory");
  expect(policy.reasons).toContain("hard:classroom_task_normalized");
});

test("policy resolver prevents daily small talk from pulling project memory", () => {
  const policy = resolveAnswerPolicy({
    ...validPlan,
    scene: "daily",
    task: "daily_chat",
    outputShape: "soft_casual_reply",
    needsMemory: true,
    needsCode: false,
  }, {
    activeScene: "casual",
    sceneLocked: true,
    latestUtterance: "How is your day going?",
  });

  expect(policy.scene).toBe("daily");
  expect(policy.needsMemory).toBe(false);
  expect(policy.reasons).toContain("hard:daily_drops_project_memory");
});

test("planner shadow mode is opt-in and configurable", () => {
  expect(isAnswerPlannerShadowEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  expect(isAnswerPlannerShadowEnabled({ SAYNEXT_PLANNER_SHADOW_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  expect(isAnswerPlannerShadowEnabled({ SAYNEXT_PLANNER_MODE: "shape" } as NodeJS.ProcessEnv)).toBe(true);
  expect(isAnswerPlannerShadowEnabled({ SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv)).toBe(true);
  expect(getAnswerPlannerMode({} as NodeJS.ProcessEnv)).toBe("off");
  expect(getAnswerPlannerMode({ SAYNEXT_PLANNER_SHADOW_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe("shadow");
  expect(getAnswerPlannerMode({ SAYNEXT_PLANNER_MODE: "shape" } as NodeJS.ProcessEnv)).toBe("shape");
  expect(getAnswerPlannerMode({ SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv)).toBe("policy");
  expect(getAnswerPlannerMode({ SAYNEXT_PLANNER_CONTROL_MODE: "control" } as NodeJS.ProcessEnv)).toBe("policy");
  expect(getAnswerPlannerModel({ OPENAI_MODEL: "gpt-test" } as NodeJS.ProcessEnv)).toBe("gpt-test");
  expect(getAnswerPlannerTimeoutMs({ SAYNEXT_PLANNER_TIMEOUT_MS: "1200" } as NodeJS.ProcessEnv)).toBe(1200);
  expect(getAnswerPlannerTimeoutMs({ SAYNEXT_PLANNER_TIMEOUT_MS: "bad" } as NodeJS.ProcessEnv)).toBe(1800);
});

test("shape control applies planner output shape in shape and policy modes", () => {
  const resolvedPolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Could you write the class skeleton?",
  });
  const metadata = {
    enabled: true,
    mode: "shape" as const,
    plan: validPlan,
    resolvedPolicy,
  };

  expect(shouldApplyAnswerPlannerShapePolicy(metadata, { SAYNEXT_PLANNER_MODE: "shape" } as NodeJS.ProcessEnv)).toBe(true);
  expect(shouldApplyAnswerPlannerShapePolicy(metadata, { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv)).toBe(true);
  expect(shouldApplyAnswerPlannerShapePolicy(metadata, { SAYNEXT_PLANNER_MODE: "shadow" } as NodeJS.ProcessEnv)).toBe(false);
  expect(shouldApplyAnswerPlannerShapePolicy({ ...metadata, error: "timeout" }, { SAYNEXT_PLANNER_MODE: "shape" } as NodeJS.ProcessEnv)).toBe(false);
});

test("memory control only applies in explicit policy mode", () => {
  const resolvedPolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Could you write the class skeleton?",
  });
  const metadata = {
    enabled: true,
    mode: "policy" as const,
    plan: validPlan,
    resolvedPolicy,
  };

  expect(shouldApplyAnswerPlannerMemoryPolicy(metadata, { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv)).toBe(true);
  expect(shouldApplyAnswerPlannerMemoryPolicy(metadata, { SAYNEXT_PLANNER_MODE: "shape" } as NodeJS.ProcessEnv)).toBe(false);
  expect(shouldApplyAnswerPlannerMemoryPolicy(metadata, { SAYNEXT_PLANNER_MODE: "shadow" } as NodeJS.ProcessEnv)).toBe(false);
  expect(shouldApplyAnswerPlannerMemoryPolicy({ ...metadata, error: "timeout" }, { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv)).toBe(false);
});

test("planner memory retrieval decision keeps shape mode from changing memory", () => {
  const dailyNoMemoryPolicy = resolveAnswerPolicy({
    ...validPlan,
    scene: "daily",
    task: "daily_chat",
    outputShape: "soft_casual_reply",
    needsMemory: true,
    needsCode: false,
  }, {
    activeScene: "casual",
    latestUtterance: "How is your day going?",
  });

  const decision = resolvePlannerMemoryRetrievalDecision({
    isClassroomMode: false,
    fallbackQuery: "How is your day going?",
    answerPlannerMetadata: {
      enabled: true,
      mode: "shape",
      resolvedPolicy: dailyNoMemoryPolicy,
    },
    env: { SAYNEXT_PLANNER_MODE: "shape" } as NodeJS.ProcessEnv,
  });

  expect(decision.shouldRetrieve).toBe(true);
  expect(decision.query).toBe("How is your day going?");
  expect(decision.reason).toBe("fallback:memory_query");
});

test("planner memory retrieval decision skips daily small talk in policy mode", () => {
  const dailyNoMemoryPolicy = resolveAnswerPolicy({
    ...validPlan,
    scene: "daily",
    task: "daily_chat",
    outputShape: "soft_casual_reply",
    needsMemory: true,
    needsCode: false,
  }, {
    activeScene: "casual",
    latestUtterance: "How is your day going?",
  });

  const decision = resolvePlannerMemoryRetrievalDecision({
    isClassroomMode: false,
    fallbackQuery: "How is your day going?",
    answerPlannerMetadata: {
      enabled: true,
      mode: "policy",
      resolvedPolicy: dailyNoMemoryPolicy,
    },
    env: { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv,
  });

  expect(decision.shouldRetrieve).toBe(false);
  expect(decision.query).toBe("");
  expect(decision.reason).toBe("planner:no_memory_needed");
});

test("planner memory retrieval decision uses planner query for interview code memory", () => {
  const codePolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Can you implement the library class design?",
    recentTranscript: "The interviewer asks for Library, Book, active book, pagination.",
  });

  const decision = resolvePlannerMemoryRetrievalDecision({
    isClassroomMode: false,
    fallbackQuery: "latest transcript only",
    answerPlannerMetadata: {
      enabled: true,
      mode: "policy",
      resolvedPolicy: codePolicy,
    },
    env: { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv,
  });

  expect(decision.shouldRetrieve).toBe(true);
  expect(decision.query).toBe("library design active book pagination");
  expect(decision.reason).toBe("planner:memory_query");
});

test("planner memory retrieval decision keeps classroom as a hard no-memory boundary", () => {
  const codePolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Can you implement the library class design?",
  });

  const decision = resolvePlannerMemoryRetrievalDecision({
    isClassroomMode: true,
    fallbackQuery: "library design",
    answerPlannerMetadata: {
      enabled: true,
      mode: "policy",
      resolvedPolicy: codePolicy,
    },
    env: { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv,
  });

  expect(decision.shouldRetrieve).toBe(false);
  expect(decision.reason).toBe("hard:classroom_no_personal_memory");
});

test("policy hint translates planner output into final prompt shape instructions", () => {
  const codePolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Could you write the class skeleton?",
  });
  const codeHint = buildResolvedAnswerPolicyHint(codePolicy);

  expect(codeHint).toContain("Planner policy");
  expect(codeHint).toContain("Output shape: code_with_explanation");
  expect(codeHint).toContain("Include actual code or pseudocode");
  expect(codeHint).toContain("Code is required");

  const ordinaryPolicy = resolveAnswerPolicy({
    ...validPlan,
    scene: "daily",
    task: "ordinary_practical",
    outputShape: "one_sentence",
    answerDepth: "minimal",
    needsMemory: false,
    needsCode: false,
  }, {
    activeScene: "casual",
    latestUtterance: "How do I stop shoes from smelling?",
  });

  expect(buildResolvedAnswerPolicyHint(ordinaryPolicy)).toContain("one direct common-sense answer");
});

test("final answer strategy uses planner policy as the main prompt brain when planner is active", () => {
  const resolvedPolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Could you write the class skeleton?",
  });
  const strategy = resolveFinalAnswerStrategy({
    legacyAnswerIntent: "ordinary_practical",
    answerPlannerMetadata: {
      enabled: true,
      mode: "policy",
      plan: validPlan,
      resolvedPolicy,
    },
    env: { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv,
  });

  expect(strategy.source).toBe("planner_policy");
  expect(strategy.answerOutputShape).toBe("code_with_explanation");
  expect(strategy.conversationIntent).toBeUndefined();
  expect(strategy.conversationStrategy).toBe(summarizeResolvedPolicy(resolvedPolicy));
  expect(strategy.promptHint).toContain("Planner policy");
  expect(strategy.promptHint).toContain("Code is required");
  expect(strategy.promptHint).not.toContain("Ordinary practical question");
});

test("final answer strategy falls back to legacy intent only when planner is unavailable", () => {
  const strategy = resolveFinalAnswerStrategy({
    legacyAnswerIntent: "ordinary_practical",
    env: { SAYNEXT_PLANNER_MODE: "off" } as NodeJS.ProcessEnv,
  });

  expect(strategy.source).toBe("legacy_intent");
  expect(strategy.conversationIntent).toBe("ordinary_practical");
  expect(strategy.conversationStrategy).toBeUndefined();
  expect(strategy.promptHint).toContain("Ordinary practical question");
});

test("planner prompt assembly does not include legacy fallback strategy when planner is active", () => {
  const resolvedPolicy = resolveAnswerPolicy(validPlan, {
    activeScene: "interview",
    latestUtterance: "Could you write the class skeleton?",
  });
  const strategy = resolveFinalAnswerStrategy({
    legacyAnswerIntent: "ordinary_practical",
    answerPlannerMetadata: {
      enabled: true,
      mode: "policy",
      plan: validPlan,
      resolvedPolicy,
    },
    env: { SAYNEXT_PLANNER_MODE: "policy" } as NodeJS.ProcessEnv,
  });
  const prompt = buildSayNextLiveTaskPrompt({
    promptMode: "interview",
    answerIntentHint: strategy.promptHint,
    formattedSceneProfile: "Scene: Interview",
  });

  expect(prompt).toContain("Planner policy");
  expect(prompt).toContain("code_with_explanation");
  expect(prompt).not.toContain("Legacy fallback");
  expect(prompt).not.toContain("Ordinary practical question");
});

test("agent input metadata can carry planner shadow output without changing process trace", () => {
  const memoryRetrievalDecision = {
    shouldRetrieve: true,
    query: "library design active book pagination",
    reason: "planner:memory_query",
  };
  const metadata = createAgentInputMetadata({
    retrievedSampleIds: [],
    answerPlanner: {
      enabled: true,
      plan: validPlan,
      resolvedPolicy: resolveAnswerPolicy(validPlan, {
        activeScene: "interview",
        latestUtterance: "Write the class skeleton.",
      }),
      memoryRetrievalDecision,
    },
    processTrace: buildProcessTrace({
      transcript: "Write the class skeleton.",
      output: "class Book { }",
      reasoning: "Generated SayNext reply with OpenAI",
      source: "model_generation",
      promptMode: "interview",
    }),
  });

  expect((metadata.answerPlanner as any).enabled).toBe(true);
  expect((metadata.answerPlanner as any).plan.task).toBe("code_solution");
  expect((metadata.answerPlanner as any).memoryRetrievalDecision).toEqual(memoryRetrievalDecision);
  expect((metadata.processTrace as any).promptMode).toBe("interview");
});
