import { IMMEDIATE_RULES } from "../src/server/saynext/immediate-rule-bank";
import { IMMEDIATE_RULE_BANK_PRIORITY_RANGES } from "../src/server/saynext/immediate-rule-registry";

const failOnDuplicateOutput = process.argv.includes("--fail-on-duplicate-output");
const failOnRange = process.argv.includes("--fail-on-range");
const failOnDirectOutput = process.argv.includes("--fail-on-direct-output");

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "").trim();
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function formatCounts(map: Map<string, number>): string {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}=${count}`)
    .join(" ") || "none";
}

function regexSignature(patterns: RegExp[] | undefined): string {
  return (patterns || []).map((pattern) => pattern.toString()).join(" && ");
}

function rulePatternSignature(rule: typeof IMMEDIATE_RULES[number]): string {
  return [
    `include:${regexSignature(rule.include)}`,
    `includeAny:${regexSignature(rule.includeAny)}`,
    `exclude:${regexSignature(rule.exclude)}`,
  ].join(" | ");
}

function resolvedEffect(rule: typeof IMMEDIATE_RULES[number]): string {
  if (rule.action === "silent") return "silent";
  return rule.effect || "route_hint";
}

function main(): void {
  const bankCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const effectCounts = new Map<string, number>();
  const duplicateOutputs = new Map<string, string[]>();
  const duplicatePatternSignatures = new Map<string, string[]>();
  const outOfRange: string[] = [];
  const directOutputs: string[] = [];

  for (const rule of IMMEDIATE_RULES) {
    increment(bankCounts, rule.bank || "missing");
    increment(categoryCounts, rule.category);
    const effect = resolvedEffect(rule);
    increment(effectCounts, effect);
    if (effect === "direct_response") directOutputs.push(`${rule.id}:${rule.bank || "missing"}:${rule.category}`);

    if (rule.bank) {
      const range = IMMEDIATE_RULE_BANK_PRIORITY_RANGES[rule.bank];
      if (!range || rule.priority < range.min || rule.priority > range.max) {
        outOfRange.push(`${rule.id}:${rule.bank}:${rule.priority}`);
      }
    }

    if (typeof rule.output === "string") {
      const key = normalizeText(rule.output);
      if (key) duplicateOutputs.set(key, [...(duplicateOutputs.get(key) || []), rule.id]);
    }

    const patternKey = rulePatternSignature(rule);
    if (patternKey !== "include: | includeAny: | exclude:") {
      duplicatePatternSignatures.set(patternKey, [...(duplicatePatternSignatures.get(patternKey) || []), rule.id]);
    }
  }

  const repeatedOutputs = [...duplicateOutputs.entries()].filter(([, ids]) => ids.length > 1);
  const repeatedPatterns = [...duplicatePatternSignatures.entries()].filter(([, ids]) => ids.length > 1);

  console.log(`[immediate-rule-audit] total=${IMMEDIATE_RULES.length}`);
  console.log(`[immediate-rule-audit] banks=${formatCounts(bankCounts)}`);
  console.log(`[immediate-rule-audit] categories=${formatCounts(categoryCounts)}`);
  console.log(`[immediate-rule-audit] effects=${formatCounts(effectCounts)}`);
  console.log(`[immediate-rule-audit] out_of_range=${outOfRange.length}`);
  console.log(`[immediate-rule-audit] direct_outputs=${directOutputs.length}`);
  console.log(`[immediate-rule-audit] duplicate_string_outputs=${repeatedOutputs.length}`);
  console.log(`[immediate-rule-audit] duplicate_pattern_signatures=${repeatedPatterns.length}`);

  if (outOfRange.length) {
    console.log("");
    console.log("[out_of_range]");
    for (const item of outOfRange) console.log(`  ${item}`);
  }

  if (directOutputs.length) {
    console.log("");
    console.log("[direct_outputs]");
    for (const item of directOutputs) console.log(`  ${item}`);
  }

  if (repeatedOutputs.length) {
    console.log("");
    console.log("[duplicate_string_outputs]");
    for (const [output, ids] of repeatedOutputs) {
      console.log(`  ids=${ids.join(" | ")}`);
      console.log(`  output=${output}`);
    }
  }

  if (repeatedPatterns.length) {
    console.log("");
    console.log("[duplicate_pattern_signatures]");
    for (const [signature, ids] of repeatedPatterns) {
      console.log(`  ids=${ids.join(" | ")}`);
      console.log(`  signature=${signature}`);
    }
  }

  if ((failOnRange && outOfRange.length)
    || (failOnDuplicateOutput && repeatedOutputs.length)
    || (failOnDirectOutput && directOutputs.length)) {
    process.exitCode = 1;
  }
}

main();
