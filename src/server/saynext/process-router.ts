export type PromptMode = "casual" | "classroom" | "interview" | "technical" | "service" | "general";

export type ProcessRoute =
  | "no_intervention"
  | "multi_intent"
  | "tech_debug"
  | "technical_concept"
  | "product_scope"
  | "privacy_risk"
  | "risk_boundary"
  | "career_pitch"
  | "meeting_process"
  | "memory_process"
  | "service_admin"
  | "casual"
  | "generator";

export type ProcessTraceSource = "immediate_rule" | "context_rule" | "model_generation" | "fallback";

export type ProcessRule = {
  id: string;
  priority: number;
  route: ProcessRoute;
  positive: RegExp[];
  requireAll?: boolean;
  negative?: RegExp[];
  owner: "process-router";
  description: string;
};

export type ProcessRuleMatch = {
  id: string;
  route: ProcessRoute;
  priority: number;
  owner: ProcessRule["owner"];
  matchedSignals: string[];
};

export type ProcessTrace = {
  route: ProcessRoute;
  source: ProcessTraceSource;
  rulesFired: string[];
  immediateRule?: {
    id: string;
    bank?: string;
    category?: string;
    priority?: number;
  };
  matchedRules?: ProcessRuleMatch[];
  ruleReasoning?: string;
  processContract: string[];
  promptMode?: PromptMode;
  riskLevel: "low" | "medium" | "high";
  shouldUseOldContext: boolean;
};

export const PROCESS_CONTRACTS: Record<ProcessRoute, string[]> = {
  no_intervention: ["do not answer unless Xiang is addressed", "avoid personal/project context"],
  multi_intent: ["address every active intent", "preserve any safety boundary", "do not let one template swallow another task"],
  tech_debug: ["state the likely failing boundary", "name the next concrete inspection", "include logs/request/response/status/auth/schema when relevant"],
  technical_concept: ["define the mechanism", "include one judgment path or trade-off", "avoid buzzword-only wording"],
  product_scope: ["separate must-have from nice-to-have", "name owner/test/acceptance boundary", "avoid promising unverified certainty"],
  privacy_risk: ["minimize data", "name owner/purpose/retention/audit trail", "avoid legal certainty unless verified"],
  risk_boundary: ["do not commit to unsafe action", "ask to verify in writing or official channel", "keep non-risk intent if present"],
  career_pitch: ["answer the career/interview ask directly", "use one grounded project or skill", "avoid fake seniority or generic corporate phrasing"],
  meeting_process: ["move the task forward", "name blocker/owner/decision/test", "do not answer with unrelated old context"],
  memory_process: ["use memory only when directly relevant", "stay grounded in retrieved support", "name uncertainty if support is missing"],
  service_admin: ["state the practical next step", "keep facts/receipts/timing clear", "avoid diagnosing or committing without confirmation"],
  casual: ["answer naturally", "avoid overtechnical project-dumping", "do not invent specific personal details"],
  generator: ["follow process hint", "answer latest transcript", "avoid unsupported facts"],
};

export const PROCESS_RULES: ProcessRule[] = [
  {
    id: "no-intervention-public-background",
    priority: 120,
    route: "no_intervention",
    positive: [/\b(no action needed|public dialogue|background dialogue|not addressed)\b/i],
    owner: "process-router",
    description: "Public/background transcript where Xiang is not directly addressed.",
  },
  {
    id: "multi-intent-risk-plus-tech-debug",
    priority: 110,
    route: "multi_intent",
    positive: [
      /\b(phishing|scam|password|credential|payment|deposit|lease|refund|bank|insurance|tax|medical|doctor|pharmacy|legal|lawful|immigration|unsafe|official channel)\b/i,
      /\b(debug|troubleshoot|api|cors|403|forbidden|request|response|status code|logs?|trace|request id|repro|bisect|regression|schema migration|endpoint|auth|payload)\b/i,
    ],
    requireAll: true,
    owner: "process-router",
    description: "One turn contains both a risk boundary and a technical debugging task.",
  },
  {
    id: "privacy-data-risk",
    priority: 100,
    route: "privacy_risk",
    positive: [/\b(privacy|consent|data controller|lawful basis|retention|audit trail|sensitive data|de-identif|personal data)\b/i],
    owner: "process-router",
    description: "Privacy, consent, retention, or personal-data handling.",
  },
  {
    id: "high-risk-boundary",
    priority: 90,
    route: "risk_boundary",
    positive: [/\b(phishing|scam|password|credential|payment|deposit|lease|contract|refund|bank|insurance|tax|medical|doctor|pharmacy|legal|lawful|immigration|unsafe|official channel)\b/i],
    negative: [
      /\b(api|interface|schema|downstream|service|integration|core)\s+contract\b/i,
      /\bcontract\s+(?:test|first|before integration|between services|for the endpoint|for the api)\b/i,
    ],
    owner: "process-router",
    description: "Legal, financial, medical, security, or other high-risk boundary.",
  },
  {
    id: "technical-debug-path",
    priority: 80,
    route: "tech_debug",
    positive: [/\b(debug|troubleshoot|api|cors|403|forbidden|request|response|status code|logs?|trace|request id|repro|bisect|regression|schema migration|endpoint|auth|payload)\b/i],
    negative: [
      /\b(api|interface|schema|downstream|service|integration|core)\s+contract\b/i,
      /\bcontract\s+(?:test|first|before integration|between services|for the endpoint|for the api)\b/i,
      /\b(linear regression|logistic regression|regression model|regression line|statistical regression)\b/i,
    ],
    owner: "process-router",
    description: "Debugging or failure-diagnosis question.",
  },
  {
    id: "api-contract-scope",
    priority: 75,
    route: "product_scope",
    positive: [
      /\b(api|interface|schema|downstream|service|integration|core)\s+contract\b/i,
      /\bcontract\s+(?:test|first|before integration|between services|for the endpoint|for the api)\b/i,
    ],
    owner: "process-router",
    description: "API/interface contract decisions are product or integration scope, not legal risk.",
  },
  {
    id: "product-scope-process",
    priority: 75,
    route: "product_scope",
    positive: [/\b(scope|demo|deliverables?|must-have|nice-to-have|acceptance test|owner|contract|deadline)\b/i],
    owner: "process-router",
    description: "Scope, demo, owner, acceptance, or deadline process.",
  },
  {
    id: "career-interview-pitch",
    priority: 60,
    route: "career_pitch",
    positive: [/\b(career|interview|recruiter|30-second|intro|full-stack|resume|feedback|booth|future job)\b/i],
    owner: "process-router",
    description: "Career, resume, recruiter, or interview positioning.",
  },
  {
    id: "memory-retrieval-process",
    priority: 50,
    route: "memory_process",
    positive: [/\b(memory|hybrid search|retrieval|retrieved chunks?|faithfulness|wrong-context|input tokens?)\b/i],
    negative: [
      /\bwhat is\s+rag\b/i,
      /\brag\b.*\b(reduce|reduces|hallucination|ground|grounding|retrieval augmented generation)\b/i,
    ],
    owner: "process-router",
    description: "Memory retrieval, grounding, or token-reduction process.",
  },
  {
    id: "meeting-workflow-process",
    priority: 40,
    route: "meeting_process",
    positive: [/\b(owner|blocker|decision|standup|handoff|meeting|team|teammate|action item)\b/i],
    owner: "process-router",
    description: "Meeting, team workflow, blocker, owner, or decision process.",
  },
  {
    id: "service-admin-practical-step",
    priority: 30,
    route: "service_admin",
    positive: [/\b(appointment|pickup|service counter|mechanic|symptom|receipt|address|order|support|front desk)\b/i],
    owner: "process-router",
    description: "Service desk, appointment, receipt, order, support, or practical admin exchange.",
  },
  {
    id: "technical-concept-explanation",
    priority: 55,
    route: "technical_concept",
    positive: [/\b(what is|define|explain|mechanism|trade-off|serverless|dynamodb|lambda|rag|database|algorithm|architecture)\b/i],
    owner: "process-router",
    description: "Technical concept, mechanism, trade-off, or architecture explanation.",
  },
  {
    id: "casual-daily-chat",
    priority: 10,
    route: "casual",
    positive: [/\b(food|restaurant|weather|windy|rainy|sunny|snowy|cold|friend|hobby|music|movie|travel|home|winter|city|small talk)\b/i],
    owner: "process-router",
    description: "Low-risk daily chat or casual preference topic.",
  },
];

function ruleIdFromReasoning(reasoning: string): string {
  const cleaned = reasoning
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return cleaned || "unknown-rule";
}

function inferRiskLevelFromText(text: string): ProcessTrace["riskLevel"] {
  if (/\b(password|credential|phishing|scam|bank|payment|deposit|lease|contract|legal|lawful|medical|doctor|pharmacy|medicine|immigration|tax|security|privacy|consent|data controller)\b/i.test(text)) {
    return "high";
  }
  if (/\b(risk|verify|receipt|official|policy|sensitive|personal data|health|finance|news|politic)\b/i.test(text)) {
    return "medium";
  }
  return "low";
}

export function matchSayNextProcessRules(params: {
  transcript?: string;
  reasoning?: string;
  output?: string;
}): ProcessRuleMatch[] {
  const text = `${params.transcript || ""}\n${params.reasoning || ""}\n${params.output || ""}`;
  return PROCESS_RULES
    .map((rule) => {
      const blocked = rule.negative?.some((pattern) => pattern.test(text)) ?? false;
      if (blocked) return undefined;

      const positiveMatches = rule.positive
        .map((pattern) => text.match(pattern)?.[0])
        .filter((match): match is string => Boolean(match));
      const matched = rule.requireAll
        ? positiveMatches.length === rule.positive.length
        : positiveMatches.length > 0;
      if (!matched) return undefined;

      return {
        id: rule.id,
        route: rule.route,
        priority: rule.priority,
        owner: rule.owner,
        matchedSignals: positiveMatches,
      };
    })
    .filter((match): match is ProcessRuleMatch => Boolean(match))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

export function inferProcessRoute(transcript: string, reasoning = "", output = ""): ProcessRoute {
  return matchSayNextProcessRules({ transcript, reasoning, output })[0]?.route || "generator";
}

export function buildProcessTrace(params: {
  transcript?: string;
  output?: string;
  reasoning?: string;
  source: ProcessTraceSource;
  promptMode?: PromptMode;
  ruleId?: string;
  rulesFired?: string[];
}): ProcessTrace {
  const transcript = params.transcript || "";
  const output = params.output || "";
  const reasoning = params.reasoning || "";
  const matchedRules = matchSayNextProcessRules({ transcript, reasoning, output });
  const route = matchedRules[0]?.route || "generator";
  const routeRuleIds = matchedRules.map((match) => `route:${match.id}`);
  const baseRulesFired = params.rulesFired?.length
    ? params.rulesFired
    : [params.ruleId || ruleIdFromReasoning(reasoning || params.source)];
  const rulesFired = [
    ...baseRulesFired,
    ...routeRuleIds.filter((id) => !baseRulesFired.includes(id)),
  ];
  const riskLevel = inferRiskLevelFromText(`${transcript}\n${output}\n${reasoning}`);
  const shouldUseOldContext = !/\b(no action needed|latest|current|right now|this exact|what exactly|ignore previous|not old)\b/i.test(`${transcript}\n${reasoning}`);

  return {
    route,
    source: params.source,
    rulesFired,
    matchedRules,
    ruleReasoning: reasoning || undefined,
    processContract: PROCESS_CONTRACTS[route],
    promptMode: params.promptMode,
    riskLevel,
    shouldUseOldContext,
  };
}

export function routeSayNextProcess(params: {
  transcript?: string;
  output?: string;
  reasoning?: string;
  source?: ProcessTraceSource;
  promptMode?: PromptMode;
  ruleId?: string;
  rulesFired?: string[];
}): ProcessTrace {
  return buildProcessTrace({
    transcript: params.transcript,
    output: params.output,
    reasoning: params.reasoning,
    source: params.source || "model_generation",
    promptMode: params.promptMode,
    ruleId: params.ruleId,
    rulesFired: params.rulesFired,
  });
}
