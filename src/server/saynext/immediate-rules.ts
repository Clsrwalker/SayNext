import type { AgentResponse } from "../mastra/types";
import { buildContextSignals, decideDisplay } from "./context-signals";
import { IMMEDIATE_RULES } from "./immediate-rule-bank";
import {
  runImmediateRuleDecision,
  type ImmediateRuleContext,
  type ImmediateRuleDecision,
  type ImmediateRuleHint,
} from "./immediate-rule-registry";
import type { OutputLanguage } from "./output-postprocess";
import { createSilent } from "./response-factory";

type ImmediateResponseContext = Partial<Pick<
  ImmediateRuleContext,
  "previousTranscriptTexts" | "hasPriorTranscript" | "hasRecentAgentOutput"
>>;

export function formatImmediateRouteHints(hints: ImmediateRuleHint[]): string {
  if (!hints.length) return "";

  const lines = [
    "Matched route/guard hints. Use these as constraints and reference points only; do not copy them as the final answer.",
  ];

  for (const hint of hints) {
    lines.push(`- ${hint.id}${hint.route ? ` route=${hint.route}` : ""} category=${hint.category}`);
    for (const instruction of hint.instructions) lines.push(`  - instruction: ${instruction}`);
    if (hint.mustInclude?.length) lines.push(`  - must include: ${hint.mustInclude.join("; ")}`);
    if (hint.mustAvoid?.length) lines.push(`  - must avoid: ${hint.mustAvoid.join("; ")}`);
  }

  return lines.join("\n");
}

export function getImmediateDecision(
  transcript: string,
  timestamp: number,
  outputLanguage: OutputLanguage,
  context: ImmediateResponseContext = {},
): ImmediateRuleDecision {
  const normalized = transcript.trim();
  const lower = normalized.toLowerCase();
  const previousTranscriptTexts = context.previousTranscriptTexts || [];
  const signals = buildContextSignals({
    latestTranscript: transcript,
    previousTranscriptTexts,
    hasRecentAgentOutput: context.hasRecentAgentOutput,
  });
  const displayDecision = decideDisplay(signals);

  if (displayDecision.action === "silent") {
    return {
      response: createSilent(`Fast display decision: ${displayDecision.reason}`, timestamp),
      routeHints: [],
    };
  }

  return runImmediateRuleDecision(IMMEDIATE_RULES, {
    transcript,
    normalized,
    lower,
    timestamp,
    outputLanguage,
    ...context,
    signals,
    previousTranscriptTexts,
    hasPriorTranscript: signals.hasPriorTranscript,
    hasRecentAgentOutput: signals.hasRecentAgentOutput,
  });
}

export function getImmediateResponse(
  transcript: string,
  timestamp: number,
  outputLanguage: OutputLanguage,
  context: ImmediateResponseContext = {},
): AgentResponse | null {
  return getImmediateDecision(transcript, timestamp, outputLanguage, context).response;
}
