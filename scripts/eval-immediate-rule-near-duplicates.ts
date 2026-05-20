import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMMEDIATE_RULES } from "../src/server/saynext/immediate-rule-bank";

type Rule = typeof IMMEDIATE_RULES[number];

type RuleVector = {
  rule: Rule;
  outputTokens: Set<string>;
  patternTokens: Set<string>;
  includeTokens: Set<string>;
  excludeTokens: Set<string>;
  outputPreview: string;
  patternPreview: string;
};

type CandidatePair = {
  left: RuleVector;
  right: RuleVector;
  score: number;
  outputScore: number;
  patternScore: number;
  sameBank: boolean;
  sameCategory: boolean;
  priorityDistance: number;
  sharedOutput: string[];
  sharedPattern: string[];
};

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from",
  "have", "i", "if", "in", "is", "it", "not", "of", "on", "or", "rather", "so", "that", "the",
  "then", "there", "this", "to", "too", "use", "we", "what", "when", "where", "with", "would",
  "you", "your",
]);

function argValue(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeToken(token: string): string {
  let value = token.toLowerCase();
  if (value.length > 5) value = value.replace(/(?:ing|ed|ly)$/i, "");
  if (value.length > 4) value = value.replace(/s$/i, "");
  return value;
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/\\b|\\s|\\d|\\w|\\W|\\S|\\./g, " ")
    .replace(/[()?:+*{}[\]^$|/\\.,;!"'`_-]+/g, " ")
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
  return new Set(tokens);
}

function regexListTokens(patterns: RegExp[] | undefined): Set<string> {
  return tokenize((patterns || []).map((pattern) => pattern.source).join(" "));
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((token) => right.has(token)).sort();
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const overlap = intersect(left, right).length;
  return overlap / (left.size + right.size - overlap);
}

function outputText(rule: Rule): string {
  const output = typeof rule.output === "string" ? rule.output : "";
  const hint = Array.isArray(rule.hint) ? rule.hint.join(" ") : rule.hint || "";
  return [output, hint].filter(Boolean).join(" ");
}

function preview(value: string, maxLength = 160): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

function patternPreview(rule: Rule): string {
  const parts = [
    ...(rule.include || []).map((pattern) => `+${pattern.toString()}`),
    ...(rule.includeAny || []).map((pattern) => `?${pattern.toString()}`),
    ...(rule.exclude || []).map((pattern) => `-${pattern.toString()}`),
  ];
  return preview(parts.join(" "), 180);
}

function vectorize(rule: Rule): RuleVector {
  const includeTokens = regexListTokens(rule.include);
  const includeAnyTokens = regexListTokens(rule.includeAny);
  const excludeTokens = regexListTokens(rule.exclude);
  return {
    rule,
    outputTokens: tokenize(outputText(rule)),
    patternTokens: new Set([...includeTokens, ...includeAnyTokens]),
    includeTokens: new Set([...includeTokens, ...includeAnyTokens]),
    excludeTokens,
    outputPreview: preview(outputText(rule)),
    patternPreview: patternPreview(rule),
  };
}

function similarity(left: RuleVector, right: RuleVector): CandidatePair | null {
  const sameBank = left.rule.bank === right.rule.bank;
  const sameCategory = left.rule.category === right.rule.category;
  const priorityDistance = Math.abs(left.rule.priority - right.rule.priority);
  const outputScore = jaccard(left.outputTokens, right.outputTokens);
  const patternScore = jaccard(left.patternTokens, right.patternTokens);
  const excludeOverlap = jaccard(left.excludeTokens, right.excludeTokens);
  const priorityBoost = Math.max(0, 1 - priorityDistance / 150) * 0.08;
  const domainBoost = (sameBank ? 0.14 : 0) + (sameCategory ? 0.1 : 0);
  const score = (outputScore * 0.58) + (patternScore * 0.28) + (excludeOverlap * 0.04) + priorityBoost + domainBoost;

  const isCandidate = (sameBank && sameCategory && score >= 0.54)
    || (sameBank && outputScore >= 0.42 && patternScore >= 0.18)
    || (sameCategory && outputScore >= 0.58 && patternScore >= 0.16)
    || (outputScore >= 0.72 && patternScore >= 0.18);

  if (!isCandidate) return null;

  return {
    left,
    right,
    score,
    outputScore,
    patternScore,
    sameBank,
    sameCategory,
    priorityDistance,
    sharedOutput: intersect(left.outputTokens, right.outputTokens).slice(0, 16),
    sharedPattern: intersect(left.patternTokens, right.patternTokens).slice(0, 16),
  };
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function formatPair(pair: CandidatePair, index: number): string[] {
  return [
    `### ${index}. ${pair.left.rule.id} <> ${pair.right.rule.id}`,
    "",
    `score=${formatScore(pair.score)} output=${formatScore(pair.outputScore)} pattern=${formatScore(pair.patternScore)} same_bank=${pair.sameBank} same_category=${pair.sameCategory} priority_delta=${pair.priorityDistance}`,
    "",
    `- left: bank=${pair.left.rule.bank || "missing"} category=${pair.left.rule.category} priority=${pair.left.rule.priority}`,
    `  - output: ${pair.left.outputPreview || "[function output]"}`,
    `  - patterns: ${pair.left.patternPreview || "[custom when/no regex]"}`,
    `- right: bank=${pair.right.rule.bank || "missing"} category=${pair.right.rule.category} priority=${pair.right.rule.priority}`,
    `  - output: ${pair.right.outputPreview || "[function output]"}`,
    `  - patterns: ${pair.right.patternPreview || "[custom when/no regex]"}`,
    `- shared_output_tokens: ${pair.sharedOutput.join(", ") || "none"}`,
    `- shared_pattern_tokens: ${pair.sharedPattern.join(", ") || "none"}`,
    "",
  ];
}

function main(): void {
  const limit = Number(argValue("--limit") || "80");
  const bankFilter = argValue("--bank");
  const categoryFilter = argValue("--category");
  const outputPath = argValue("--out") || join("data", "eval", `immediate-rule-near-duplicates-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);

  const vectors = IMMEDIATE_RULES
    .filter((rule) => !bankFilter || rule.bank === bankFilter)
    .filter((rule) => !categoryFilter || rule.category === categoryFilter)
    .map(vectorize);

  const candidates: CandidatePair[] = [];
  for (let leftIndex = 0; leftIndex < vectors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < vectors.length; rightIndex += 1) {
      const pair = similarity(vectors[leftIndex], vectors[rightIndex]);
      if (pair) candidates.push(pair);
    }
  }

  candidates.sort((left, right) => right.score - left.score
    || Number(right.sameBank) - Number(left.sameBank)
    || Number(right.sameCategory) - Number(left.sameCategory)
    || left.priorityDistance - right.priorityDistance
    || left.left.rule.id.localeCompare(right.left.rule.id));

  const selected = candidates.slice(0, limit);
  const lines = [
    "# Immediate Rule Near-Duplicate Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Rules scanned: ${vectors.length}`,
    `Candidate pairs: ${candidates.length}`,
    `Shown: ${selected.length}`,
    `Bank filter: ${bankFilter || "none"}`,
    `Category filter: ${categoryFilter || "none"}`,
    "",
    "Interpretation: this is a review aid, not a failure gate. Merge only when the two rules share a domain boundary and the combined trigger stays narrow.",
    "",
  ];

  selected.forEach((pair, index) => lines.push(...formatPair(pair, index + 1)));

  writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

  const byBank = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const pair of candidates) {
    const bankKey = pair.left.rule.bank === pair.right.rule.bank ? pair.left.rule.bank || "missing" : "cross_bank";
    const categoryKey = pair.left.rule.category === pair.right.rule.category ? pair.left.rule.category : "cross_category";
    byBank.set(bankKey, (byBank.get(bankKey) || 0) + 1);
    byCategory.set(categoryKey, (byCategory.get(categoryKey) || 0) + 1);
  }

  const topCounts = (map: Map<string, number>) => [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([key, count]) => `${key}=${count}`)
    .join(" ") || "none";

  console.log(`[immediate-rule-near-duplicates] scanned=${vectors.length} candidates=${candidates.length} shown=${selected.length}`);
  console.log(`[immediate-rule-near-duplicates] top_banks=${topCounts(byBank)}`);
  console.log(`[immediate-rule-near-duplicates] top_categories=${topCounts(byCategory)}`);
  console.log(`[immediate-rule-near-duplicates] report=${outputPath}`);
}

main();
