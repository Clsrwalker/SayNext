import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reviewClassFor } from "./eval-llm-simulated-conversations-classifier";
import type { TurnResult } from "./eval-llm-simulated-conversations-types";

export type ProcessCandidateWriterOptions = {
  outDir?: string;
  discoveredAt?: string;
};

export function writeProcessCandidates(
  flatResults: TurnResult[],
  options: ProcessCandidateWriterOptions = {},
): string {
  const outDir = options.outDir || join(process.cwd(), "data", "eval");
  mkdirSync(outDir, { recursive: true });
  const processCandidatesPath = join(outDir, "process-candidates.jsonl");
  const discoveredAt = options.discoveredAt || new Date().toISOString();

  const processCaseLines = flatResults
    .filter((result) => reviewClassFor(result) === "process_bad")
    .map((result) => JSON.stringify({
      id: `${result.scenarioId}#turn_${result.turn}`,
      taxonomy: result.processTaxonomy || "new_taxonomy_candidate",
      input: result.input,
      saynext_output: result.output,
      route_chosen: result.processTrace?.route || "unknown",
      rules_fired: result.processTrace?.rulesFired || [],
      rule_source: result.processTrace?.source || "unknown",
      process_contract: result.processTrace?.processContract || [],
      judge_label: result.judge?.verdict || "none",
      judge_issues: result.judge?.issues || [],
      flags: result.flags,
      scene: result.scene,
      domain: result.domain,
      risk_level: result.riskLevel,
      technical_level: result.technicalLevel,
      asr_severity: result.asrSeverity,
      candidate_source: "llm-simulated-conversations",
      discovered_at: discoveredAt,
      review_status: "candidate",
      expected_route: null,
      gold_process_contract: null,
    }));

  if (processCaseLines.length) {
    appendFileSync(processCandidatesPath, `${processCaseLines.join("\n")}\n`, "utf8");
  } else if (!existsSync(processCandidatesPath)) {
    writeFileSync(processCandidatesPath, "", "utf8");
  }

  return processCandidatesPath;
}
