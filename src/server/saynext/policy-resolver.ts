import type { AnswerPlan, AnswerPlannerInput } from "./answer-plan";

export interface ResolvedAnswerPolicy {
  scene: AnswerPlan["scene"];
  task: AnswerPlan["task"];
  dialogueAct: AnswerPlan["dialogueAct"];
  outputShape: AnswerPlan["outputShape"];
  answerDepth: AnswerPlan["answerDepth"];
  shouldSpeak: boolean;
  needsMemory: boolean;
  memoryQuery?: string;
  needsIdentityFactCard: boolean;
  needsCode: boolean;
  needsFewShot: boolean;
  riskLevel: AnswerPlan["riskLevel"];
  confidence: number;
  safeFallback?: AnswerPlan["safeFallback"];
  reasons: string[];
}

function isDirectProjectOrExperienceTask(task: AnswerPlan["task"]): boolean {
  return task === "project_experience"
    || task === "behavioral_story"
    || task === "interview_intro"
    || task === "system_design";
}

function isClassroomScene(scene: AnswerPlan["scene"]): boolean {
  return scene === "classroom";
}

function isDailyScene(scene: AnswerPlan["scene"]): boolean {
  return scene === "daily" || scene === "general";
}

export function resolveAnswerPolicy(plan: AnswerPlan, input: AnswerPlannerInput): ResolvedAnswerPolicy {
  const reasons: string[] = [];
  const policy: ResolvedAnswerPolicy = {
    scene: plan.scene,
    task: plan.task,
    dialogueAct: plan.dialogueAct,
    outputShape: plan.outputShape,
    answerDepth: plan.answerDepth,
    shouldSpeak: plan.shouldSpeak,
    needsMemory: plan.needsMemory,
    memoryQuery: plan.memoryQuery?.trim() || undefined,
    needsIdentityFactCard: plan.needsIdentityFactCard,
    needsCode: plan.needsCode,
    needsFewShot: plan.needsFewShot,
    riskLevel: plan.riskLevel,
    confidence: plan.confidence,
    safeFallback: plan.safeFallback,
    reasons,
  };

  if (input.sceneLocked) {
    const active = String(input.activeScene || "").toLowerCase();
    if (active === "interview" && policy.scene !== "interview") {
      policy.scene = "interview";
      reasons.push("scene_lock:interview");
    } else if (active === "classroom" && policy.scene !== "classroom") {
      policy.scene = "classroom";
      reasons.push("scene_lock:classroom");
    } else if ((active === "casual" || active === "general") && policy.scene !== "daily") {
      policy.scene = "daily";
      reasons.push("scene_lock:daily");
    } else if (active === "technical" && policy.scene !== "technical") {
      policy.scene = "technical";
      reasons.push("scene_lock:technical");
    } else if (active === "service" && policy.scene !== "service") {
      policy.scene = "service";
      reasons.push("scene_lock:service");
    }
  }

  if (policy.task === "personal_fact" || policy.needsIdentityFactCard) {
    policy.task = "personal_fact";
    policy.outputShape = "direct_answer";
    policy.answerDepth = "minimal";
    policy.needsMemory = false;
    policy.needsIdentityFactCard = true;
    policy.needsCode = false;
    policy.needsFewShot = false;
    reasons.push("hard:identity_fact_exact");
  }

  if (isClassroomScene(policy.scene) && policy.task !== "personal_fact") {
    if (policy.needsMemory) reasons.push("hard:classroom_drops_personal_memory");
    policy.needsMemory = false;
    policy.needsIdentityFactCard = false;
    if (policy.task === "no_reply") {
      policy.outputShape = "no_reply";
    } else if (!policy.task.startsWith("classroom_")) {
      policy.task = "classroom_answer";
      reasons.push("hard:classroom_task_normalized");
    }
  }

  if (isDailyScene(policy.scene) && !isDirectProjectOrExperienceTask(policy.task)) {
    if (policy.needsMemory) reasons.push("hard:daily_drops_project_memory");
    policy.needsMemory = false;
  }

  if (policy.task === "ordinary_practical") {
    policy.outputShape = "one_sentence";
    policy.answerDepth = "minimal";
    policy.needsMemory = false;
    policy.needsCode = false;
    reasons.push("hard:ordinary_practical_common_action");
  }

  if (policy.task === "code_solution" || policy.needsCode) {
    policy.task = "code_solution";
    policy.outputShape = "code_with_explanation";
    policy.answerDepth = "deep";
    policy.needsCode = true;
    reasons.push("hard:code_solution_requires_code");
  }

  if (policy.riskLevel === "high") {
    policy.needsMemory = false;
    policy.needsCode = false;
    if (policy.task !== "privacy_risk") policy.task = "risk_boundary";
    policy.outputShape = "direct_answer";
    reasons.push("hard:high_risk_boundary");
  }

  if (policy.confidence < 0.55) {
    policy.safeFallback ||= policy.shouldSpeak ? "short_general" : "no_reply";
    reasons.push("confidence:fallback_available");
  }

  if (!policy.shouldSpeak || policy.task === "no_reply") {
    policy.shouldSpeak = false;
    policy.outputShape = "no_reply";
    policy.needsMemory = false;
    policy.needsCode = false;
    policy.needsFewShot = false;
    reasons.push("hard:no_reply_no_context");
  }

  if (policy.needsMemory && !policy.memoryQuery) {
    const query = [
      policy.task,
      input.latestUtterance,
      input.recentTranscript,
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    policy.memoryQuery = query.slice(0, 260);
    reasons.push("memory:derived_query");
  }

  return policy;
}

export function buildResolvedAnswerPolicyHint(policy: ResolvedAnswerPolicy | undefined): string {
  if (!policy) return "";

  const lines = [
    "Planner policy, use this for output shape and depth:",
    `- Task: ${policy.task}`,
    `- Output shape: ${policy.outputShape}`,
    `- Depth: ${policy.answerDepth}`,
  ];

  switch (policy.outputShape) {
    case "one_sentence":
      lines.push("- Write one direct common-sense answer. Do not list alternatives unless safety requires it.");
      break;
    case "debug_steps":
      lines.push("- Give concrete debugging steps in priority order. Name the first inspection signal and likely failing boundary.");
      break;
    case "code_with_explanation":
      lines.push("- Include actual code or pseudocode plus a short explanation. Preserve readable line breaks and indentation.");
      break;
    case "mechanism_tradeoff":
      lines.push("- Explain the core mechanism first, then add one useful trade-off, edge case, or example.");
      break;
    case "project_role_challenge_lesson":
      lines.push("- Use a grounded project shape: what it is, Xiang's role, one technical choice or challenge, and the result/lesson.");
      break;
    case "behavioral_story_lesson":
      lines.push("- Use a natural story shape without STAR labels. Do not invent a past event if memory does not support one.");
      break;
    case "soft_casual_reply":
      lines.push("- Keep it casual and context-aware. Do not introduce projects or technical background unless asked.");
      break;
    case "clarifying_question":
      lines.push("- Ask one short clarification only.");
      break;
    case "no_reply":
      lines.push("- Do not generate an answer unless a minimal acknowledgement is clearly needed.");
      break;
    case "done_next_blocker":
      lines.push("- State done/current blocker/next step in normal teammate language.");
      break;
    case "direct_answer":
    default:
      lines.push("- Answer directly first, then add only the useful amount of context.");
      break;
  }

  if (policy.needsCode) {
    lines.push("- Code is required for this turn; do not give only a verbal plan.");
  }
  if (policy.riskLevel === "high") {
    lines.push("- High-risk boundary: be cautious, do not commit Xiang to unsafe, legal, medical, financial, or credential actions.");
  }
  if (policy.confidence < 0.55 && policy.safeFallback) {
    lines.push(`- Low planner confidence: safe fallback is ${policy.safeFallback}.`);
  }

  return lines.join("\n");
}
