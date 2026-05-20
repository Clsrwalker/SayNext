import { existsSync, readFileSync } from "node:fs";
import { matchSayNextProcessRules, type ProcessRuleMatch, type ProcessRoute } from "../src/server/saynext/process-router";

type RouteCategory = "no_intervention" | "technical" | "risk" | "career" | "process" | "service" | "casual" | "generator";

type Probe = {
  id: string;
  transcript: string;
  output?: string;
  expectedTopRoute?: ProcessRoute;
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
const casesPath = args.get("file") || positionalFile;
const failOnConflict = process.argv.includes("--fail-on-conflict");
const failOnMismatch = process.argv.includes("--fail-on-mismatch");

const ROUTE_CATEGORY: Record<ProcessRoute, RouteCategory> = {
  no_intervention: "no_intervention",
  multi_intent: "process",
  tech_debug: "technical",
  technical_concept: "technical",
  product_scope: "process",
  privacy_risk: "risk",
  risk_boundary: "risk",
  career_pitch: "career",
  meeting_process: "process",
  memory_process: "process",
  service_admin: "service",
  casual: "casual",
  generator: "generator",
};

const BUILTIN_PROBES: Probe[] = [
  {
    id: "api_contract_scope_not_legal",
    transcript: "Before integration, what API contract should we expose to the downstream service?",
    expectedTopRoute: "product_scope",
  },
  {
    id: "legal_rights_risk",
    transcript: "What legal rights do tenants usually have before signing a lease?",
    expectedTopRoute: "risk_boundary",
  },
  {
    id: "right_now_not_legal",
    transcript: "Right now, what should I say to the recruiter about my career direction?",
    expectedTopRoute: "career_pitch",
  },
  {
    id: "deposit_plus_cors_multi_intent",
    transcript: "Can you confirm the deposit, and also fix that CORS error in the API?",
    expectedTopRoute: "multi_intent",
  },
  {
    id: "rag_concept",
    transcript: "What is RAG, and why does it reduce hallucination?",
    expectedTopRoute: "technical_concept",
  },
  {
    id: "casual_weather",
    transcript: "It is so windy today. What do you usually do on days like this?",
    expectedTopRoute: "casual",
  },
];

function loadProbesFromJsonl(path: string): Probe[] {
  if (!existsSync(path)) {
    throw new Error(`Case file not found: ${path}`);
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const value = JSON.parse(line) as Record<string, unknown>;
      return {
        id: String(value.id || `case_${index + 1}`),
        transcript: String(value.input || value.transcript || ""),
        output: String(value.saynext_output || value.output || ""),
        expectedTopRoute: typeof value.expected_route === "string" && value.expected_route
          ? value.expected_route as ProcessRoute
          : undefined,
      };
    });
}

function routeSet(matches: ProcessRuleMatch[]): Set<ProcessRoute> {
  return new Set(matches.map((match) => match.route));
}

function routePrioritySet(matches: ProcessRuleMatch[]): Set<string> {
  return new Set(matches.map((match) => `${match.route}:${match.priority}`));
}

function isExpectedCompositeMatch(matches: ProcessRuleMatch[]): boolean {
  const top = matches[0];
  if (top?.route !== "multi_intent") return false;
  const lowerRoutes = new Set(matches.slice(1).map((match) => match.route));
  return lowerRoutes.size > 0
    && [...lowerRoutes].every((route) => route === "risk_boundary" || route === "privacy_risk" || route === "tech_debug");
}

function describeMatches(matches: ProcessRuleMatch[]): string {
  return matches.map((match) => `${match.id}:${match.route}:${match.priority}`).join(" | ") || "none";
}

function categoryOf(route?: ProcessRoute): RouteCategory {
  return route ? ROUTE_CATEGORY[route] : "generator";
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

function matchCategorySummary(matches: ProcessRuleMatch[]): string {
  const counts = new Map<string, number>();
  for (const match of matches) increment(counts, categoryOf(match.route));
  return formatCounts(counts);
}

function main(): void {
  const probes = casesPath ? loadProbesFromJsonl(casesPath) : BUILTIN_PROBES;
  let conflicts = 0;
  let mismatches = 0;
  const topRouteCounts = new Map<string, number>();
  const topCategoryCounts = new Map<string, number>();
  const conflictCategoryCounts = new Map<string, number>();
  const mismatchCategoryCounts = new Map<string, number>();

  console.log(`[process-rule-conflicts] source=${casesPath || "builtin-probes"} total=${probes.length}`);

  for (const probe of probes) {
    const matches = matchSayNextProcessRules({
      transcript: probe.transcript,
    });
    const routes = routeSet(matches);
    const routePriorities = routePrioritySet(matches);
    const top = matches[0];
    const hasRouteConflict = routes.size > 1 && routePriorities.size > 1 && !isExpectedCompositeMatch(matches);
    const hasMismatch = Boolean(probe.expectedTopRoute && top?.route !== probe.expectedTopRoute);
    const topRoute = top?.route || "generator";
    const topCategory = categoryOf(top?.route);

    if (hasRouteConflict) conflicts += 1;
    if (hasMismatch) mismatches += 1;
    increment(topRouteCounts, topRoute);
    increment(topCategoryCounts, topCategory);
    if (hasRouteConflict) increment(conflictCategoryCounts, topCategory);
    if (hasMismatch) increment(mismatchCategoryCounts, `${categoryOf(probe.expectedTopRoute)}->${topCategory}`);

    if (!hasRouteConflict && !hasMismatch) continue;

    console.log("");
    console.log(`[${hasMismatch ? "mismatch" : "conflict"}] ${probe.id}`);
    console.log(`  expected_top_route=${probe.expectedTopRoute || "none"} actual_top_route=${top?.route || "generator"}`);
    console.log(`  expected_category=${categoryOf(probe.expectedTopRoute)} actual_category=${topCategory}`);
    console.log(`  match_categories=${matchCategorySummary(matches)}`);
    console.log(`  matches=${describeMatches(matches)}`);
    if (hasRouteConflict) {
      console.log("  suggestion: inspect rule priority and negative patterns; do not add an output patch until the winning route is intentional.");
    }
    if (hasMismatch) {
      console.log("  suggestion: either relabel expected_route or adjust the declarative route rule that should own this case.");
    }
  }

  console.log("");
  console.log(`[process-rule-conflicts] top_routes=${formatCounts(topRouteCounts)}`);
  console.log(`[process-rule-conflicts] top_categories=${formatCounts(topCategoryCounts)}`);
  if (conflictCategoryCounts.size) console.log(`[process-rule-conflicts] conflict_categories=${formatCounts(conflictCategoryCounts)}`);
  if (mismatchCategoryCounts.size) console.log(`[process-rule-conflicts] mismatch_category_flows=${formatCounts(mismatchCategoryCounts)}`);
  console.log(`[process-rule-conflicts] conflicts=${conflicts} mismatches=${mismatches}`);

  if ((failOnConflict && conflicts > 0) || (failOnMismatch && mismatches > 0)) {
    process.exitCode = 1;
  }
}

main();
