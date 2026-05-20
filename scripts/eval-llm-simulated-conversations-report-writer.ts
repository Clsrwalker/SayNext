import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyReview,
  countReviewClasses,
  countVerdicts,
  formatCountBreakdown,
  formatReviewBreakdown,
  reviewClassFor,
  summarizeProcessTaxonomy,
  summarizeReviewBy,
  verdictFor,
} from "./eval-llm-simulated-conversations-classifier";
import type { ScenarioResult, SceneKey, TurnResult } from "./eval-llm-simulated-conversations-types";

type RandomReportContext = {
  count: number;
  seed: string;
  distribution: string;
  asrRate: number;
  asrSeverity?: string;
  bankCounts: {
    scenes: number;
    personas: number;
    professions: number;
    topics: number;
    asrNoise: number;
  };
};

export type ConversationReportContext = {
  stamp: string;
  userId: string;
  sayNextProvider: string;
  sayNextModel?: string;
  simulatorProvider: string;
  simulatorModel: string;
  judgeProvider: string;
  judgeModel: string;
  skipJudge: boolean;
  random?: RandomReportContext;
  outDir?: string;
};

export type ConversationReportPaths = {
  mdPath: string;
  jsonPath: string;
};

function sceneName(scene: SceneKey): string {
  if (scene === "daily_chat") return "Daily Chat";
  if (scene === "classroom") return "Classroom";
  if (scene === "interview") return "Interview";
  if (scene === "meeting_group") return "Meeting / Group Discussion";
  return "Daily Chat";
}

export function writeConversationReport(
  scenarios: ScenarioResult[],
  flatResults: TurnResult[],
  context: ConversationReportContext,
): ConversationReportPaths {
  const outDir = context.outDir || join(process.cwd(), "data", "eval");
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, `llm-simulated-conversations-${context.stamp}.md`);
  const jsonPath = join(outDir, `llm-simulated-conversations-${context.stamp}.json`);

  const summary = countVerdicts(flatResults);
  const reviewSummary = countReviewClasses(flatResults);
  const domainSummary = summarizeReviewBy(flatResults, (result) => result.domain);
  const asrSummary = summarizeReviewBy(flatResults, (result) => result.asrSeverity);
  const interventionSummary = summarizeReviewBy(flatResults, (result) => result.interventionPolicy);
  const routeSummary = summarizeReviewBy(flatResults, (result) => result.processTrace?.route);
  const taxonomySummary = summarizeProcessTaxonomy(flatResults);

  const lines: string[] = [
    "# LLM Simulated Conversation Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `User: ${context.userId}`,
    `SayNext provider: ${context.sayNextProvider}`,
    `SayNext model: ${context.sayNextModel || ""}`,
    `Simulator provider: ${context.simulatorProvider}`,
    `Simulator model: ${context.simulatorModel}`,
    `Judge provider: ${context.skipJudge ? "skipped" : context.judgeProvider}`,
    `Judge model: ${context.judgeModel}`,
    `Scenario mode: ${context.random ? `random-${context.random.distribution}` : "static"}`,
    ...(context.random
      ? [
        `Random seed: ${context.random.seed}`,
        `Random ASR rate: ${context.random.asrRate}`,
        `Random ASR severity: ${context.random.asrSeverity || "mixed/default"}`,
        `Random bank counts: scenes=${context.random.bankCounts.scenes}, personas=${context.random.bankCounts.personas}, professions=${context.random.bankCounts.professions}, topics=${context.random.bankCounts.topics}, asr=${context.random.bankCounts.asrNoise}`,
      ]
      : []),
    `Scenarios: ${scenarios.length}`,
    `Turns: ${flatResults.length}`,
    `Legacy summary: good=${summary.good}, watch=${summary.watch}, bad=${summary.bad}`,
    `Process summary: good=${reviewSummary.good}, quality_watch=${reviewSummary.quality_watch}, judge_false_positive=${reviewSummary.judge_false_positive}, process_bad=${reviewSummary.process_bad}`,
    "",
    "Review policy: process_bad is the must-fix bucket. quality_watch is for naturalness, depth, length, or style review. judge_false_positive means the judge likely penalized grounded persona/memory or a subjective style choice.",
    "",
    "## Stratified Process Summary",
    "",
    "By domain:",
    ...formatReviewBreakdown(domainSummary),
    "",
    "By ASR severity:",
    ...formatReviewBreakdown(asrSummary),
    "",
    "By intervention policy:",
    ...formatReviewBreakdown(interventionSummary),
    "",
    "By process route:",
    ...formatReviewBreakdown(routeSummary),
    "",
    "By process_bad taxonomy:",
    ...formatCountBreakdown(taxonomySummary),
    "",
  ];

  for (const scenario of scenarios) {
    lines.push(`## ${scenario.spec.id}`);
    lines.push("");
    lines.push(`Scene: ${sceneName(scenario.spec.scene)}`);
    lines.push(`Other: ${scenario.spec.otherPerson}`);
    if (scenario.spec.domain || scenario.spec.asrSeverity || scenario.spec.interventionPolicy) {
      lines.push(`Tags: domain=${scenario.spec.domain || "unknown"}, technical=${scenario.spec.technicalLevel || "none"}, risk=${scenario.spec.riskLevel || "none"}, memory=${scenario.spec.memoryPolicy || "default"}, intervention=${scenario.spec.interventionPolicy || "respond"}, asr=${scenario.spec.asrSeverity || "unknown"}`);
    }
    lines.push(`Situation: ${scenario.spec.situation}`);
    lines.push("");
    for (const turn of scenario.turns) {
      const verdict = verdictFor(turn);
      const reviewClass = reviewClassFor(turn);
      lines.push(`### Turn ${turn.turn} - ${reviewClass.toUpperCase()} (${verdict.toUpperCase()})`);
      lines.push("");
      lines.push(`Other: ${turn.input}`);
      lines.push("");
      lines.push(`SayNext: ${turn.output || "(empty)"}`);
      lines.push("");
      lines.push(`Latency: ${turn.elapsedMs}ms`);
      lines.push(`Memory: ${turn.memoryRefs.join(" | ") || "none"}`);
      if (turn.processTrace) {
        lines.push(`Route: ${turn.processTrace.route || "unknown"}; source=${turn.processTrace.source || "unknown"}; rules=${turn.processTrace.rulesFired?.join(" | ") || "none"}`);
        if (turn.processTrace.processContract?.length) {
          lines.push(`Contract: ${turn.processTrace.processContract.join(" | ")}`);
        }
      }
      lines.push(`Flags: ${turn.flags.join(", ") || "none"}`);
      lines.push(`Review: ${reviewClass}, reason=${turn.reviewReason || classifyReview(turn).reason}`);
      if (turn.processTaxonomy) {
        lines.push(`Taxonomy: ${turn.processTaxonomy}`);
      }
      if (turn.judge) {
        lines.push(`Judge: ${turn.judge.verdict}, score=${turn.judge.score}, issues=${turn.judge.issues.join("; ") || "none"}`);
      }
      lines.push("");
    }
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({
    scenarios,
    results: flatResults,
    summary,
    reviewSummary,
    random: context.random
      ? {
        seed: context.random.seed,
        distribution: context.random.distribution,
        asrRate: context.random.asrRate,
        asrSeverity: context.random.asrSeverity || "mixed/default",
        bankCounts: context.random.bankCounts,
        stratified: {
          byDomain: domainSummary,
          byAsrSeverity: asrSummary,
          byInterventionPolicy: interventionSummary,
          byProcessRoute: routeSummary,
          byProcessBadTaxonomy: taxonomySummary,
        },
      }
      : undefined,
  }, null, 2), "utf8");

  return { mdPath, jsonPath };
}
