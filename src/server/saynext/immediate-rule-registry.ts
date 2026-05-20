import type { AgentResponse } from "../mastra/types";
import type { ContextSignals } from "./context-signals";
import type { OutputLanguage } from "./output-postprocess";
import type { ProcessRoute } from "./process-router";
import { createInsight, createSilent } from "./response-factory";

export type ImmediateRuleCategory =
  | "no_intervention"
  | "asr_correction"
  | "risk_boundary"
  | "multi_intent"
  | "tech_process"
  | "meeting_process"
  | "service_admin"
  | "career_pitch"
  | "casual";

export type ImmediateRuleBank =
  | "core"
  | "localized"
  | "conversation"
  | "current_affairs"
  | "productivity"
  | "open_topics"
  | "open_topics_casual"
  | "open_topics_risk"
  | "open_topics_service"
  | "open_topics_process"
  | "service_life"
  | "service_food"
  | "risk"
  | "risk_evidence"
  | "tech"
  | "tech_classroom"
  | "process_debug"
  | "process"
  | "project_profile"
  | "profile"
  | "personal"
  | "personal_memory"
  | "casual";

export const IMMEDIATE_RULE_PRIORITY_BANDS = {
  absolute: { min: 900, max: 1000, description: "format, no-intervention, and high-risk hard stops" },
  high: { min: 700, max: 899, description: "strong process/risk/technical overrides" },
  targeted: { min: 500, max: 699, description: "narrow debug, evidence, and domain-specific overrides" },
  profile: { min: 350, max: 499, description: "project, profile, localized, service, and career answers" },
  general: { min: 200, max: 349, description: "general technical, current-affairs, risk, and open-topic answers" },
  low: { min: 1, max: 199, description: "low-risk casual, personal-memory, and generic fallback rules" },
} as const;

export const IMMEDIATE_RULE_PRIORITY_MIN = IMMEDIATE_RULE_PRIORITY_BANDS.low.min;
export const IMMEDIATE_RULE_PRIORITY_MAX = IMMEDIATE_RULE_PRIORITY_BANDS.absolute.max;

export const IMMEDIATE_RULE_BANK_PRIORITY_RANGES: Record<ImmediateRuleBank, { min: number; max: number }> = {
  core: { min: 900, max: 1000 },
  localized: { min: 350, max: 550 },
  conversation: { min: 150, max: 300 },
  current_affairs: { min: 90, max: 450 },
  productivity: { min: 100, max: 420 },
  open_topics: { min: 90, max: 390 },
  open_topics_casual: { min: 100, max: 220 },
  open_topics_risk: { min: 120, max: 360 },
  open_topics_service: { min: 150, max: 240 },
  open_topics_process: { min: 100, max: 240 },
  service_life: { min: 330, max: 460 },
  service_food: { min: 140, max: 310 },
  risk: { min: 200, max: 1000 },
  risk_evidence: { min: 500, max: 560 },
  tech: { min: 220, max: 860 },
  tech_classroom: { min: 260, max: 360 },
  process_debug: { min: 490, max: 650 },
  process: { min: 150, max: 920 },
  project_profile: { min: 380, max: 500 },
  profile: { min: 390, max: 480 },
  personal: { min: 100, max: 280 },
  personal_memory: { min: 70, max: 140 },
  casual: { min: 100, max: 950 },
};

export type ImmediateRuleContext = {
  transcript: string;
  normalized: string;
  lower: string;
  timestamp: number;
  outputLanguage: OutputLanguage;
  signals: ContextSignals;
  previousTranscriptTexts?: string[];
  hasPriorTranscript?: boolean;
  hasRecentAgentOutput?: boolean;
};

export type ImmediateRuleEffect = "direct_response" | "route_hint" | "guard";

export type ImmediateRuleHint = {
  id: string;
  bank?: ImmediateRuleBank;
  category: ImmediateRuleCategory;
  priority: number;
  effect: Extract<ImmediateRuleEffect, "route_hint" | "guard">;
  route?: ProcessRoute;
  title?: string;
  instructions: string[];
  mustInclude?: string[];
  mustAvoid?: string[];
};

export type ImmediateRuleDecision = {
  response: AgentResponse | null;
  routeHints: ImmediateRuleHint[];
  matchedRule?: ImmediateRule;
};

export type ImmediateRule = {
  id: string;
  bank?: ImmediateRuleBank;
  priority: number;
  category: ImmediateRuleCategory;
  action?: "insight" | "silent";
  effect?: ImmediateRuleEffect;
  route?: ProcessRoute;
  hint?: string | string[];
  mustInclude?: string[];
  mustAvoid?: string[];
  include?: RegExp[];
  includeAny?: RegExp[];
  exclude?: RegExp[];
  when?: (context: ImmediateRuleContext) => boolean;
  output?: string | ((context: ImmediateRuleContext) => string);
  reasoning: string;
  confidence?: number;
};

function resolveRuleEffect(rule: ImmediateRule): ImmediateRuleEffect {
  return rule.effect || "route_hint";
}

function defaultRouteForCategory(category: ImmediateRuleCategory): ProcessRoute {
  switch (category) {
    case "no_intervention":
      return "no_intervention";
    case "asr_correction":
      return "generator";
    case "risk_boundary":
      return "risk_boundary";
    case "multi_intent":
      return "multi_intent";
    case "tech_process":
      return "technical_concept";
    case "meeting_process":
      return "meeting_process";
    case "service_admin":
      return "service_admin";
    case "career_pitch":
      return "career_pitch";
    case "casual":
    default:
      return "casual";
  }
}

export function withImmediateRuleBank(bank: ImmediateRuleBank, rules: ImmediateRule[]): ImmediateRule[] {
  return rules.map((rule) => ({ ...rule, bank }));
}

function matchesRule(rule: ImmediateRule, context: ImmediateRuleContext): boolean {
  const text = context.normalized;
  if (rule.include?.some((pattern) => !pattern.test(text))) return false;
  if (rule.includeAny?.length && !rule.includeAny.some((pattern) => pattern.test(text))) return false;
  if (rule.exclude?.some((pattern) => pattern.test(text))) return false;
  return rule.when ? rule.when(context) : true;
}

function buildRouteHint(rule: ImmediateRule, context: ImmediateRuleContext): ImmediateRuleHint {
  const referenceOutput = rule.output
    ? typeof rule.output === "function" ? rule.output(context) : rule.output
    : "";
  const rawInstructions = rule.hint
    ? Array.isArray(rule.hint) ? rule.hint : [rule.hint]
    : [
      `${rule.reasoning}. This matched an immediate rule, but the final answer should be generated from the latest transcript and recent context, not copied from a fixed template.`,
      ...(referenceOutput
        ? [`Reference facts only, rewrite naturally if still relevant: ${referenceOutput}`]
        : []),
    ];

  return {
    id: rule.id,
    bank: rule.bank,
    category: rule.category,
    priority: rule.priority,
    effect: rule.effect === "guard" ? "guard" : "route_hint",
    route: rule.route || defaultRouteForCategory(rule.category),
    title: rule.reasoning,
    instructions: rawInstructions,
    mustInclude: rule.mustInclude,
    mustAvoid: rule.mustAvoid,
  };
}

export function runImmediateRuleDecision(rules: ImmediateRule[], context: ImmediateRuleContext): ImmediateRuleDecision {
  const orderedRules = rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => (right.rule.priority - left.rule.priority) || (left.index - right.index));

  for (const { rule } of orderedRules) {
    if (!matchesRule(rule, context)) continue;
    if (rule.action === "silent") {
      return {
        response: createSilent(rule.reasoning, context.timestamp),
        routeHints: [],
        matchedRule: rule,
      };
    }

    const effect = resolveRuleEffect(rule);
    if (effect === "route_hint" || effect === "guard") {
      return {
        response: null,
        routeHints: [buildRouteHint(rule, context)],
        matchedRule: rule,
      };
    }

    if (!rule.output) {
      return {
        response: null,
        routeHints: [],
        matchedRule: rule,
      };
    }
    const output = typeof rule.output === "function" ? rule.output(context) : rule.output;
    const response = createInsight(output, rule.reasoning, context.timestamp, rule.confidence ?? 0.9, rule.id);
    if (response.type === "insight") {
      const trace = (response.metadata.agentInput as any)?.processTrace;
      if (trace) {
        trace.immediateRule = {
          id: rule.id,
          bank: rule.bank,
          category: rule.category,
          priority: rule.priority,
        };
      }
    }
    return {
      response,
      routeHints: [],
      matchedRule: rule,
    };
  }

  return {
    response: null,
    routeHints: [],
  };
}

export function runImmediateRules(rules: ImmediateRule[], context: ImmediateRuleContext): AgentResponse | null {
  return runImmediateRuleDecision(rules, context).response;
}
