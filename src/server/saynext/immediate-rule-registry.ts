import type { AgentResponse } from "../mastra/types";
import type { OutputLanguage } from "./output-postprocess";
import { createInsight } from "./response-factory";

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

export type ImmediateRuleContext = {
  transcript: string;
  normalized: string;
  lower: string;
  timestamp: number;
  outputLanguage: OutputLanguage;
};

export type ImmediateRule = {
  id: string;
  priority: number;
  category: ImmediateRuleCategory;
  include?: RegExp[];
  includeAny?: RegExp[];
  exclude?: RegExp[];
  when?: (context: ImmediateRuleContext) => boolean;
  output: string | ((context: ImmediateRuleContext) => string);
  reasoning: string;
  confidence?: number;
};

function matchesRule(rule: ImmediateRule, context: ImmediateRuleContext): boolean {
  const text = context.normalized;
  if (rule.include?.some((pattern) => !pattern.test(text))) return false;
  if (rule.includeAny?.length && !rule.includeAny.some((pattern) => pattern.test(text))) return false;
  if (rule.exclude?.some((pattern) => pattern.test(text))) return false;
  return rule.when ? rule.when(context) : true;
}

export function runImmediateRules(rules: ImmediateRule[], context: ImmediateRuleContext): AgentResponse | null {
  const orderedRules = rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => (right.rule.priority - left.rule.priority) || (left.index - right.index));

  for (const { rule } of orderedRules) {
    if (!matchesRule(rule, context)) continue;
    const output = typeof rule.output === "function" ? rule.output(context) : rule.output;
    return createInsight(output, rule.reasoning, context.timestamp, rule.confidence ?? 0.9, rule.id);
  }

  return null;
}
