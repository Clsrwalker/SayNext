import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  routeSayNextProcess,
  type ProcessTrace,
  type ProcessTraceSource,
} from "../src/server/saynext/process-router";

type ProcessCase = {
  id?: string;
  taxonomy?: string | null;
  expected_taxonomy?: string | null;
  input?: string;
  transcript?: string;
  saynext_output?: string;
  output?: string;
  route_chosen?: string | null;
  expected_route?: string | null;
  rules_fired?: string[] | null;
  required_rules?: string[] | null;
  expected_rules?: string[] | null;
  forbidden_rules?: string[] | null;
  rule_source?: string | null;
  process_contract?: string[] | null;
  gold_process_contract?: string[] | null;
  expected_contract?: string[] | null;
  must_include?: string[] | null;
  must_include_all?: string[] | null;
  must_include_any?: string[] | null;
  must_not_include?: string[] | null;
  reject_any?: string[] | null;
  expected_risk_level?: string | null;
  expected_should_use_old_context?: boolean | null;
};

type CaseStatus = "pass" | "fail" | "needs_label";

type CaseResult = {
  id: string;
  status: CaseStatus;
  currentTrace: ProcessTrace;
  snapshotRoute?: string;
  failures: string[];
  suggestions: string[];
  snapshotDrift: boolean;
};

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

const positionalFile = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const defaultPath = join(process.cwd(), "data", "eval", "process-regression-cases.jsonl");
const casesPath = args.get("file") || positionalFile || defaultPath;
const failOnNeedsLabel = process.argv.includes("--fail-on-needs-label");
const failOnSnapshotDrift = process.argv.includes("--fail-on-snapshot-drift");

function normalizeList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isExplicitString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasExplicitGate(testCase: ProcessCase): boolean {
  return Boolean(
    isExplicitString(testCase.expected_route)
    || isExplicitString(testCase.expected_taxonomy)
    || isExplicitString(testCase.expected_risk_level)
    || typeof testCase.expected_should_use_old_context === "boolean"
    || normalizeList(testCase.required_rules).length
    || normalizeList(testCase.expected_rules).length
    || normalizeList(testCase.forbidden_rules).length
    || normalizeList(testCase.gold_process_contract).length
    || normalizeList(testCase.expected_contract).length
    || normalizeList(testCase.must_include).length
    || normalizeList(testCase.must_include_all).length
    || normalizeList(testCase.must_include_any).length
    || normalizeList(testCase.must_not_include).length
    || normalizeList(testCase.reject_any).length
  );
}

function parseSource(value: unknown): ProcessTraceSource {
  if (value === "immediate_rule" || value === "context_rule" || value === "model_generation" || value === "fallback") {
    return value;
  }
  return "model_generation";
}

function patternMatches(text: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  const regexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2]).test(text);
    } catch {
      return normalize(text).includes(normalize(trimmed));
    }
  }
  return normalize(text).includes(normalize(trimmed));
}

function contractSatisfies(contract: string[], requirement: string): boolean {
  const wanted = normalize(requirement);
  return contract.some((line) => {
    const actual = normalize(line);
    return actual.includes(wanted) || wanted.includes(actual);
  });
}

function includesRule(trace: ProcessTrace, observedRules: string[], rule: string): boolean {
  const wanted = normalize(rule);
  return [...trace.rulesFired, ...observedRules].some((item) => normalize(item).includes(wanted));
}

function loadJsonl(path: string): ProcessCase[] {
  if (!existsSync(path)) {
    if (path === defaultPath) return [];
    throw new Error(`Process case file not found: ${path}`);
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ProcessCase;
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function addSuggestion(result: CaseResult, message: string): void {
  if (!result.suggestions.includes(message)) result.suggestions.push(message);
}

function evaluateCase(testCase: ProcessCase, index: number): CaseResult {
  const id = testCase.id || `case_${index + 1}`;
  const transcript = testCase.input || testCase.transcript || "";
  const output = testCase.saynext_output || testCase.output || "";
  const observedRules = normalizeList(testCase.rules_fired);
  const currentTrace = routeSayNextProcess({
    transcript,
    output,
    source: parseSource(testCase.rule_source),
  });
  const snapshotRoute = testCase.route_chosen || undefined;
  const result: CaseResult = {
    id,
    status: "pass",
    currentTrace,
    snapshotRoute,
    failures: [],
    suggestions: [],
    snapshotDrift: Boolean(snapshotRoute && snapshotRoute !== currentTrace.route),
  };

  if (!hasExplicitGate(testCase)) {
    result.status = "needs_label";
    addSuggestion(result, "Add expected_route, gold_process_contract, must_include, or forbidden_rules before using this case as a gate.");
    return result;
  }

  if (isExplicitString(testCase.expected_route) && currentTrace.route !== testCase.expected_route) {
    result.failures.push(`expected_route=${testCase.expected_route}, current_route=${currentTrace.route}`);
    addSuggestion(result, "Route mismatch: inspect router priority and negative patterns before adding output patches.");
  }

  if (isExplicitString(testCase.expected_taxonomy) && normalize(testCase.taxonomy || "") !== normalize(testCase.expected_taxonomy)) {
    result.failures.push(`expected_taxonomy=${testCase.expected_taxonomy}, taxonomy=${testCase.taxonomy || "missing"}`);
    addSuggestion(result, "Taxonomy mismatch: adjust classifier labels or relabel the case; do not patch product behavior from this alone.");
  }

  if (isExplicitString(testCase.expected_risk_level) && currentTrace.riskLevel !== testCase.expected_risk_level) {
    result.failures.push(`expected_risk_level=${testCase.expected_risk_level}, current_risk_level=${currentTrace.riskLevel}`);
    addSuggestion(result, "Risk level mismatch: narrow or expand risk keywords, then add both positive and negative examples.");
  }

  if (
    typeof testCase.expected_should_use_old_context === "boolean"
    && currentTrace.shouldUseOldContext !== testCase.expected_should_use_old_context
  ) {
    result.failures.push(`expected_should_use_old_context=${testCase.expected_should_use_old_context}, current=${currentTrace.shouldUseOldContext}`);
    addSuggestion(result, "Context precedence mismatch: check latest-turn guards and stale-context suppression.");
  }

  for (const rule of [...normalizeList(testCase.required_rules), ...normalizeList(testCase.expected_rules)]) {
    if (!includesRule(currentTrace, observedRules, rule)) {
      result.failures.push(`missing_required_rule=${rule}`);
      addSuggestion(result, "Required rule not observed: once rules are registry-backed, verify rule id and route ownership.");
    }
  }

  for (const rule of normalizeList(testCase.forbidden_rules)) {
    if (includesRule(currentTrace, observedRules, rule)) {
      result.failures.push(`forbidden_rule_hit=${rule}`);
      addSuggestion(result, "Forbidden rule hit: likely over_trigger; prefer narrowing the existing rule over adding a later patch.");
    }
  }

  for (const requirement of [...normalizeList(testCase.gold_process_contract), ...normalizeList(testCase.expected_contract)]) {
    if (!contractSatisfies(currentTrace.processContract, requirement)) {
      result.failures.push(`missing_contract=${requirement}`);
      addSuggestion(result, "Contract mismatch: route may be wrong, or PROCESS_CONTRACTS no longer encodes the required process.");
    }
  }

  for (const term of [...normalizeList(testCase.must_include), ...normalizeList(testCase.must_include_all)]) {
    if (!patternMatches(output, term)) {
      result.failures.push(`missing_output_term=${term}`);
      addSuggestion(result, "Output misses required process element; fix generator contract only after route is correct.");
    }
  }

  const anyTerms = normalizeList(testCase.must_include_any);
  if (anyTerms.length && !anyTerms.some((term) => patternMatches(output, term))) {
    result.failures.push(`missing_any_output_term=${anyTerms.join("|")}`);
    addSuggestion(result, "Output misses all acceptable alternatives; add a contract-level test instead of a single phrase patch.");
  }

  for (const term of [...normalizeList(testCase.must_not_include), ...normalizeList(testCase.reject_any)]) {
    if (patternMatches(output, term)) {
      result.failures.push(`forbidden_output_term=${term}`);
      addSuggestion(result, "Forbidden output term: classify as grounding/risk/style before deciding whether product code or evaluator should change.");
    }
  }

  result.status = result.failures.length ? "fail" : "pass";
  return result;
}

function main(): void {
  const cases = loadJsonl(casesPath);
  const results = cases.map(evaluateCase);
  const counts = results.reduce((acc, result) => {
    acc[result.status] += 1;
    if (result.snapshotDrift) acc.snapshotDrift += 1;
    return acc;
  }, { pass: 0, fail: 0, needs_label: 0, snapshotDrift: 0 });

  console.log(`[process-cases] file=${casesPath}`);
  console.log(`[process-cases] total=${results.length} pass=${counts.pass} fail=${counts.fail} needs_label=${counts.needs_label} snapshot_drift=${counts.snapshotDrift}`);

  for (const result of results) {
    if (result.status === "pass" && !result.snapshotDrift) continue;
    console.log("");
    console.log(`[${result.status}] ${result.id}`);
    console.log(`  route: current=${result.currentTrace.route}${result.snapshotRoute ? ` snapshot=${result.snapshotRoute}` : ""}`);
    console.log(`  rules: ${result.currentTrace.rulesFired.join(", ") || "none"}`);
    if (result.currentTrace.matchedRules?.length) {
      console.log(`  matched_route_rules: ${result.currentTrace.matchedRules.map((rule) => `${rule.id}:${rule.matchedSignals.join("+")}`).join(" | ")}`);
    }
    if (result.failures.length) console.log(`  failures: ${result.failures.join("; ")}`);
    if (result.suggestions.length) console.log(`  suggestions: ${result.suggestions.join(" | ")}`);
    if (result.snapshotDrift) console.log("  note: snapshot drift is informational unless --fail-on-snapshot-drift is set.");
  }

  if (counts.fail > 0 || (failOnNeedsLabel && counts.needs_label > 0) || (failOnSnapshotDrift && counts.snapshotDrift > 0)) {
    process.exitCode = 1;
  }
}

main();
