export type CanonicalProjectId =
  | "saynext"
  | "joblens"
  | "elderalbum"
  | "dalparkaid"
  | "study_session_tracker"
  | "ai_meeting_monitor"
  | "cueflow"
  | "unknown";

export type MemoryOrigin =
  | "doc"
  | "xiang_update"
  | "redacted_project"
  | "xiang_behavioral"
  | "manual"
  | "import"
  | "unknown";

export type MemoryFacet =
  | "project_definition"
  | "positioning"
  | "architecture"
  | "runtime_flow"
  | "memory_personalization"
  | "deployment"
  | "technical_decision"
  | "behavioral_story"
  | "achievement_story"
  | "impact_story"
  | "debug_note"
  | "generic_knowledge"
  | "unknown";

export type MemoryQueryIntent =
  | "project_definition"
  | "architecture"
  | "runtime_flow"
  | "memory_personalization"
  | "deployment"
  | "technical_decision"
  | "behavioral_story"
  | "impact_story"
  | "generic_question"
  | "unknown";

export type MemoryPool = "factual" | "behavioral" | "generic";

export interface MemoryIdentityInput {
  sourceRef?: string | null;
  source?: string | null;
  title?: string | null;
  category?: string | null;
  content?: string | null;
  usageRule?: string | null;
  keywords?: readonly string[] | null;
}

export interface MemoryIdentityResolution {
  canonicalProjectId: CanonicalProjectId;
  origin: MemoryOrigin;
  facet: MemoryFacet;
  aliases: string[];
  reasons: string[];
}

export interface MemoryQueryClassification {
  intent: MemoryQueryIntent;
  preferredPool: MemoryPool;
  canonicalProjectId: CanonicalProjectId;
  reasons: string[];
}

export interface RerankableMemoryCandidate extends MemoryIdentityInput {
  id?: string | number;
  canonicalProjectId?: CanonicalProjectId;
  facet?: MemoryFacet;
  baseScore?: number;
  finalScore?: number;
  score?: number;
  vectorScore?: number;
  reasons?: readonly string[];
}

export interface RerankedMemoryCandidate<T extends RerankableMemoryCandidate = RerankableMemoryCandidate> {
  candidate: T;
  canonicalProjectId: CanonicalProjectId;
  origin: MemoryOrigin;
  facet: MemoryFacet;
  baseScore: number;
  finalScore: number;
  reasons: string[];
}

export interface RerankIntentOptions {
  factualRepairThreshold?: number;
}

export interface EvalMemoryResult {
  sourceRef?: string | null;
  canonicalProjectId?: CanonicalProjectId;
  facet?: MemoryFacet;
}

export interface EvalExpectedMemoryTarget {
  expectedCanonicalProjectId?: CanonicalProjectId;
  acceptedFacets?: readonly MemoryFacet[];
  acceptedSourceRefPatterns?: readonly RegExp[];
  disallowedTop1Facets?: readonly MemoryFacet[];
}

export interface EvalTop1Validation {
  ok: boolean;
  reason: "ok" | "project_mismatch" | "facet_mismatch" | "source_ref_mismatch" | "disallowed_top1_facet";
}

const FACTUAL_FACETS = new Set<MemoryFacet>([
  "project_definition",
  "positioning",
  "architecture",
  "runtime_flow",
  "memory_personalization",
  "deployment",
  "technical_decision",
  "debug_note",
]);

const BEHAVIORAL_FACETS = new Set<MemoryFacet>([
  "behavioral_story",
  "achievement_story",
  "impact_story",
]);

function normalizeText(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function normalizeSourceRef(value: unknown): string {
  return normalizeText(value).trim();
}

function joinedMemoryText(input: MemoryIdentityInput): string {
  return [
    input.sourceRef,
    input.source,
    input.title,
    input.category,
    input.usageRule,
    input.content,
    ...(input.keywords ?? []),
  ].map(normalizeText).join("\n");
}

function hasAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function resolveOrigin(input: MemoryIdentityInput): { origin: MemoryOrigin; reasons: string[] } {
  const sourceRef = normalizeSourceRef(input.sourceRef);
  const source = normalizeText(input.source);
  const reasons: string[] = [];

  if (sourceRef.startsWith("doc:")) {
    reasons.push("origin:source_ref_doc");
    return { origin: "doc", reasons };
  }
  if (sourceRef.startsWith("xiang-update:")) {
    reasons.push("origin:source_ref_xiang_update");
    return { origin: "xiang_update", reasons };
  }
  if (sourceRef.startsWith("redacted-project:")) {
    reasons.push("origin:source_ref_redacted_project");
    return { origin: "redacted_project", reasons };
  }
  if (sourceRef.startsWith("xiang-behavioral:")) {
    reasons.push("origin:source_ref_xiang_behavioral");
    return { origin: "xiang_behavioral", reasons };
  }
  if (source === "manual") {
    reasons.push("origin:source_manual");
    return { origin: "manual", reasons };
  }
  if (source === "import" || source === "knowledge" || source === "pipeline") {
    reasons.push(`origin:source_${source}`);
    return { origin: "import", reasons };
  }

  return { origin: "unknown", reasons: ["origin:unknown"] };
}

function resolveCanonicalProjectId(input: MemoryIdentityInput): {
  canonicalProjectId: CanonicalProjectId;
  aliases: string[];
  reasons: string[];
} {
  const sourceRef = normalizeSourceRef(input.sourceRef);
  const text = joinedMemoryText(input);
  const aliases: string[] = [];
  const reasons: string[] = [];

  if (sourceRef.startsWith("job:")) {
    return { canonicalProjectId: "unknown", aliases, reasons: ["alias:job_memory"] };
  }

  if (
    sourceRef.startsWith("cueflow-project:")
    || hasAny(text, ["cueflow", "cue flow"])
  ) {
    aliases.push("CueFlow", "Cue Flow");
    reasons.push("alias:cueflow");
    return { canonicalProjectId: "cueflow", aliases, reasons };
  }

  if (
    sourceRef.startsWith("doc:saynext")
    || sourceRef.includes("project-saynext")
    || sourceRef.includes("hybrid-search-memory-assistant")
    || sourceRef === "redacted-project:ai-context-engine-hybrid-search"
    || hasAny(text, ["saynext", "hybrid search memory assistant"])
    || (hasAny(text, ["ai context engine"]) && hasAny(text, ["g2", "r1", "saynext", "conversation assistant", "memory assistant"]))
  ) {
    aliases.push("SayNext", "Hybrid Search Memory Assistant", "G2/R1");
    reasons.push("alias:saynext");
    return { canonicalProjectId: "saynext", aliases, reasons };
  }

  if (hasAny(text, ["joblens", "job lens"])) {
    aliases.push("JobLens", "JobLens AI");
    reasons.push("alias:joblens");
    return { canonicalProjectId: "joblens", aliases, reasons };
  }

  if (hasAny(text, ["elderalbum", "elder album"])) {
    aliases.push("ElderAlbum", "Elder Album");
    reasons.push("alias:elderalbum");
    return { canonicalProjectId: "elderalbum", aliases, reasons };
  }

  if (hasAny(text, ["dalparkaid", "dal parking aid", "dal park aid"])) {
    aliases.push("DalParkAid", "Dal Parking Aid");
    reasons.push("alias:dalparkaid");
    return { canonicalProjectId: "dalparkaid", aliases, reasons };
  }

  if (hasAny(text, ["study session tracker", "study tracker", "study timer"])) {
    aliases.push("Study Session Tracker", "Study Tracker");
    reasons.push("alias:study_session_tracker");
    return { canonicalProjectId: "study_session_tracker", aliases, reasons };
  }

  if (hasAny(text, ["ai meeting monitor", "meeting monitor"])) {
    aliases.push("AI Meeting Monitor", "Meeting Monitor");
    reasons.push("alias:ai_meeting_monitor");
    return { canonicalProjectId: "ai_meeting_monitor", aliases, reasons };
  }

  return { canonicalProjectId: "unknown", aliases, reasons: ["alias:unknown"] };
}

function resolveFacet(input: MemoryIdentityInput, origin: MemoryOrigin): { facet: MemoryFacet; reasons: string[] } {
  const sourceRef = normalizeSourceRef(input.sourceRef);
  const text = joinedMemoryText(input);
  const reasons: string[] = [];

  if (origin === "xiang_behavioral" || hasAny(text, ["behavioral interview", "tell me about a time", "story about"])) {
    if (hasAny(text, ["impact", "user impact", "reliability"])) {
      reasons.push("facet:impact_story");
      return { facet: "impact_story", reasons };
    }
    if (hasAny(text, ["achievement", "proud", "above-and-beyond", "above and beyond"])) {
      reasons.push("facet:achievement_story");
      return { facet: "achievement_story", reasons };
    }
    reasons.push("facet:behavioral_story");
    return { facet: "behavioral_story", reasons };
  }

  if (sourceRef.includes("overview") || hasAny(text, ["project overview", "overview and scope", "what it is", "primary overview", "product definition", "primary factual definition"])) {
    reasons.push("facet:project_definition");
    return { facet: "project_definition", reasons };
  }
  if (sourceRef.includes("positioning") || hasAny(text, ["positioning", "public-facing", "interview wording"])) {
    reasons.push("facet:positioning");
    return { facet: "positioning", reasons };
  }
  if (sourceRef.includes("runtime") || sourceRef.includes("process") || hasAny(text, ["runtime flow", "process transcripts", "partial transcript", "stale response"])) {
    reasons.push("facet:runtime_flow");
    return { facet: "runtime_flow", reasons };
  }
  if (sourceRef.includes("memory-personalization") || sourceRef.includes("retrieval-architecture") || sourceRef.includes("hybrid-search") || hasAny(text, ["memory personalization", "hybrid retrieval", "memory retrieval", "context packing", "sqlite fts5", "bm25"])) {
    reasons.push("facet:memory_personalization");
    return { facet: "memory_personalization", reasons };
  }
  if (sourceRef.includes("deployment") || hasAny(text, ["deployment", "local mode", "travel mode", "openai", "llm deployment", "prompt cost"])) {
    reasons.push("facet:deployment");
    return { facet: "deployment", reasons };
  }
  if (hasAny(text, ["architecture", "data flow", "system design"])) {
    reasons.push("facet:architecture");
    return { facet: "architecture", reasons };
  }
  if (hasAny(text, ["workflow", "features", "api route", "api routes", "data model", "tables", "storage", "upload", "matching", "serverless", "lambda", "api gateway", "dynamodb", "s3"])) {
    reasons.push("facet:architecture");
    return { facet: "architecture", reasons };
  }
  if (sourceRef.includes("trial-error") || sourceRef.includes("hard-bug") || hasAny(text, ["technical decision", "trade-off", "debug", "hard bug", "trial and error"])) {
    reasons.push("facet:technical_decision");
    return { facet: "technical_decision", reasons };
  }
  if (hasAny(text, ["generic knowledge", "overview", "lecture"])) {
    reasons.push("facet:generic_knowledge");
    return { facet: "generic_knowledge", reasons };
  }
  if (hasAny(text, ["what is", "definition", "overview"])) {
    reasons.push("facet:project_definition");
    return { facet: "project_definition", reasons };
  }

  return { facet: "unknown", reasons: ["facet:unknown"] };
}

export function resolveMemoryIdentity(input: MemoryIdentityInput): MemoryIdentityResolution {
  const origin = resolveOrigin(input);
  const project = resolveCanonicalProjectId(input);
  const facet = resolveFacet(input, origin.origin);

  return {
    canonicalProjectId: project.canonicalProjectId,
    origin: origin.origin,
    facet: facet.facet,
    aliases: project.aliases,
    reasons: [...origin.reasons, ...project.reasons, ...facet.reasons],
  };
}

export function classifyMemoryQueryIntent(query: string): MemoryQueryClassification {
  const text = normalizeText(query);
  const project = resolveCanonicalProjectId({
    sourceRef: "",
    title: query,
    content: query,
    keywords: [],
  });

  if (hasAny(text, ["impact", "user impact", "made useful", "helped users"])) {
    return {
      intent: "impact_story",
      preferredPool: "behavioral",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:impact_story"],
    };
  }

  if (hasAny(text, ["tell me a time", "time you", "story", "achievement", "proud", "improved", "difficult", "hardest part", "under pressure", "conflict"])) {
    return {
      intent: "behavioral_story",
      preferredPool: "behavioral",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:behavioral_story"],
    };
  }

  if (
    hasAny(text, ["runtime", "process transcript", "process transcripts", "partial transcript", "stale response", "stale responses"])
    || /\bflow\b/.test(text)
  ) {
    return {
      intent: "runtime_flow",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:runtime_flow"],
    };
  }

  if (hasAny(text, ["retrieve memory", "memory retrieval", "personal memory", "memory work", "retrieval", "context packing", "prenote"])) {
    return {
      intent: "memory_personalization",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:memory_personalization"],
    };
  }

  if (hasAny(text, ["architecture", "system design", "data flow", "pipeline"])) {
    return {
      intent: "architecture",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:architecture"],
    };
  }

  if (
    project.canonicalProjectId !== "unknown"
    && hasAny(text, ["workflow", "feature", "features", "api route", "api routes", "table", "tables", "storage", "store", "stored", "upload", "matching", "how does", "how do", "how did"])
  ) {
    return {
      intent: "architecture",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:architecture"],
    };
  }

  if (hasAny(text, ["deployment", "local mode", "travel mode", "openai", "model", "prompt cost", "cost"])) {
    return {
      intent: "deployment",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:deployment"],
    };
  }

  if (
    project.canonicalProjectId !== "unknown"
    && hasAny(text, ["evaluation", "limitation", "limitations", "future improvement", "future improvements", "what did the user", "what did users", "find", "found"])
  ) {
    return {
      intent: "technical_decision",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:technical_decision"],
    };
  }

  if (hasAny(text, ["trade-off", "trade off", "technical decision", "why did you add", "why did you choose", "design choice"])) {
    return {
      intent: "technical_decision",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:technical_decision"],
    };
  }

  if (hasAny(text, ["what is", "what's", "overview", "explain", "define", "is it", "positioning"])) {
    return {
      intent: "project_definition",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:project_definition"],
    };
  }

  if (project.canonicalProjectId !== "unknown" && hasAny(text, ["is ", "what project", "why did i build", "why did you build", "built", "build"])) {
    return {
      intent: "project_definition",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:project_definition"],
    };
  }

  if (project.canonicalProjectId !== "unknown" && hasAny(text, ["problem", "problems", "run into", "developing", "hard part"])) {
    return {
      intent: "technical_decision",
      preferredPool: "factual",
      canonicalProjectId: project.canonicalProjectId,
      reasons: [...project.reasons, "query_intent:technical_decision"],
    };
  }

  return {
    intent: "generic_question",
    preferredPool: "generic",
    canonicalProjectId: project.canonicalProjectId,
    reasons: [...project.reasons, "query_intent:generic_question"],
  };
}

export function isFactualFacet(facet: MemoryFacet): boolean {
  return FACTUAL_FACETS.has(facet);
}

export function isBehavioralFacet(facet: MemoryFacet): boolean {
  return BEHAVIORAL_FACETS.has(facet);
}

export function isFactualQueryIntent(classification: MemoryQueryClassification): boolean {
  return classification.preferredPool === "factual";
}

export function scoreFacetForIntent(
  intentOrClassification: MemoryQueryIntent | MemoryQueryClassification,
  facet: MemoryFacet,
): number {
  const classification = typeof intentOrClassification === "string"
    ? { intent: intentOrClassification, preferredPool: "generic" as MemoryPool }
    : intentOrClassification;

  if (classification.preferredPool === "factual") {
    if (isBehavioralFacet(facet)) return -0.03;
    if (facet === classification.intent) return 0.05;
    if (isFactualFacet(facet)) return 0.03;
  }

  if (classification.preferredPool === "behavioral") {
    if (classification.intent === "impact_story" && facet === "impact_story") return 0.08;
    if (classification.intent === "behavioral_story" && isBehavioralFacet(facet)) return 0.06;
    if (isFactualFacet(facet)) return -0.02;
  }

  if (classification.preferredPool === "generic" && facet === "generic_knowledge") return 0.03;
  return 0;
}

function candidateBaseScore(candidate: RerankableMemoryCandidate): number {
  const value = candidate.baseScore ?? candidate.finalScore ?? candidate.score ?? candidate.vectorScore ?? 0;
  return Number.isFinite(value) ? Number(value) : 0;
}

function resolveCandidate(candidate: RerankableMemoryCandidate): MemoryIdentityResolution {
  const resolved = resolveMemoryIdentity(candidate);
  return {
    ...resolved,
    canonicalProjectId: candidate.canonicalProjectId ?? resolved.canonicalProjectId,
    facet: candidate.facet ?? resolved.facet,
  };
}

function withScores<T extends RerankableMemoryCandidate>(
  candidates: readonly T[],
  classification: MemoryQueryClassification,
): RerankedMemoryCandidate<T>[] {
  return candidates.map((candidate) => {
    const resolved = resolveCandidate(candidate);
    const baseScore = candidateBaseScore(candidate);
    const reasons = [...(candidate.reasons ?? []), ...resolved.reasons];
    let finalScore = baseScore;

    if (
      classification.canonicalProjectId !== "unknown"
      && resolved.canonicalProjectId === classification.canonicalProjectId
    ) {
      finalScore += 0.03;
      reasons.push("boost:project_match:+0.03");
    }

    const facetScore = scoreFacetForIntent(classification, resolved.facet);
    finalScore += facetScore;
    if (facetScore > 0) reasons.push(`boost:facet_match:+${facetScore.toFixed(2)}`);
    if (facetScore < 0) reasons.push(`penalty:facet_mismatch:${facetScore.toFixed(2)}`);

    return {
      candidate,
      canonicalProjectId: resolved.canonicalProjectId,
      origin: resolved.origin,
      facet: resolved.facet,
      baseScore,
      finalScore,
      reasons,
    };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

export function repairTopResultForIntent<T extends RerankableMemoryCandidate>(
  candidates: readonly RerankedMemoryCandidate<T>[],
  classification: MemoryQueryClassification,
  options: RerankIntentOptions = {},
): RerankedMemoryCandidate<T>[] {
  if (!isFactualQueryIntent(classification)) return [...candidates];
  if (candidates.length < 2) return [...candidates];

  const top = candidates[0];
  if (!top || !isBehavioralFacet(top.facet)) return [...candidates];

  const threshold = options.factualRepairThreshold ?? 0.18;
  const factual = candidates.find((candidate) => {
    if (!isFactualFacet(candidate.facet)) return false;
    if (top.canonicalProjectId === "unknown") return true;
    return candidate.canonicalProjectId === top.canonicalProjectId;
  });
  if (!factual) return [...candidates];

  if (top.finalScore - factual.finalScore >= threshold) return [...candidates];

  const repaired = candidates.filter((candidate) => candidate !== factual);
  return [
    {
      ...factual,
      finalScore: Math.max(factual.finalScore, top.finalScore + 0.000001),
      reasons: [...factual.reasons, "repair:factual_query_prefers_factual_memory"],
    },
    ...repaired,
  ];
}

export function rerankMemoryCandidatesForIntent<T extends RerankableMemoryCandidate>(
  candidates: readonly T[],
  classification: MemoryQueryClassification,
  options: RerankIntentOptions = {},
): RerankedMemoryCandidate<T>[] {
  return repairTopResultForIntent(withScores(candidates, classification), classification, options);
}

export function isEvalExpectedHit(result: EvalMemoryResult, expected: EvalExpectedMemoryTarget): boolean {
  const sourceRef = result.sourceRef || "";
  const sourceRefAccepted = expected.acceptedSourceRefPatterns?.some((pattern) => pattern.test(sourceRef)) ?? false;

  if (expected.expectedCanonicalProjectId && result.canonicalProjectId !== expected.expectedCanonicalProjectId) {
    if (!sourceRefAccepted) return false;
  }

  if (expected.acceptedFacets?.length && result.facet && !expected.acceptedFacets.includes(result.facet)) {
    return false;
  }

  if (expected.acceptedSourceRefPatterns?.length && !sourceRefAccepted && !expected.expectedCanonicalProjectId) {
    return false;
  }

  return true;
}

export function validateEvalTop1(result: EvalMemoryResult, expected: EvalExpectedMemoryTarget): EvalTop1Validation {
  if (result.facet && expected.disallowedTop1Facets?.includes(result.facet)) {
    return { ok: false, reason: "disallowed_top1_facet" };
  }
  if (expected.expectedCanonicalProjectId && result.canonicalProjectId !== expected.expectedCanonicalProjectId) {
    return { ok: false, reason: "project_mismatch" };
  }
  if (expected.acceptedFacets?.length && result.facet && !expected.acceptedFacets.includes(result.facet)) {
    return { ok: false, reason: "facet_mismatch" };
  }
  if (
    expected.acceptedSourceRefPatterns?.length
    && result.sourceRef
    && !expected.acceptedSourceRefPatterns.some((pattern) => pattern.test(result.sourceRef || ""))
  ) {
    return { ok: false, reason: "source_ref_mismatch" };
  }
  return { ok: true, reason: "ok" };
}
