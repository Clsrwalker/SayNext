export type KnownAsrTermCategory = "project" | "technology" | "school";

export interface KnownTermAsrCandidate {
  observed: string;
  canonical: string;
  category: KnownAsrTermCategory;
  confidence: number;
  reason: string;
  searchExpansion: string;
}

interface KnownTermDefinition {
  canonical: string;
  category: KnownAsrTermCategory;
  directAliases: string[];
  fuzzyAliases: string[];
  contextPattern?: RegExp;
  searchExpansion: string;
}

const PROJECT_CONTEXT_PATTERN = /\b(ai|project|app|application|platform|cloud|aws|serverless|resume|matching|explain|detail|details|worked|built|made|your|my|use|used|talk|memory|retrieval|prompt|token|tokens|reduce|reduced)\b/i;
const AMBIGUOUS_PROJECT_CONTEXT_PATTERN = /\b(your|my|project|app|application|platform|cloud|aws|serverless|lambda|dynamodb|s3|architecture|built|made|use|used|services|tech stack)\b/i;

const KNOWN_TERMS: KnownTermDefinition[] = [
  {
    canonical: "JobLens AI",
    category: "project",
    directAliases: [
      "job lens ai",
      "joblens ai",
      "job lens",
      "joblens",
      "job less ai",
      "jobless ai",
      "job len ai",
      "job lense ai",
    ],
    fuzzyAliases: [
      "job level ai",
      "job levels ai",
      "job lev ai",
      "job level",
      "job levels",
      "job lev",
      "jobless",
    ],
    contextPattern: PROJECT_CONTEXT_PATTERN,
    searchExpansion: "JobLens AI job matching resume matching cloud AWS Lambda API Gateway DynamoDB S3 FastAPI",
  },
  {
    canonical: "ElderAlbum",
    category: "project",
    directAliases: [
      "elderalbum",
      "elder album",
      "elder album app",
    ],
    fuzzyAliases: [
      "older album",
      "elder albums",
      "older albums",
      "elder albam",
    ],
    contextPattern: PROJECT_CONTEXT_PATTERN,
    searchExpansion: "ElderAlbum AWS serverless photo album Lambda API Gateway DynamoDB S3 SAM CloudFormation",
  },
  {
    canonical: "AI Meeting Monitor",
    category: "project",
    directAliases: [
      "ai meeting monitor",
      "meeting monitor project",
    ],
    fuzzyAliases: [
      "meeting monitor",
      "ai meeting model",
      "ai meeting moniter",
      "meeting model",
      "meeting moniter",
    ],
    contextPattern: PROJECT_CONTEXT_PATTERN,
    searchExpansion: "AI Meeting Monitor meeting transcript recording Discord bot Faster Whisper Gemini Flask PostgreSQL React dashboard",
  },
  {
    canonical: "DalParkAid",
    category: "project",
    directAliases: [
      "dal parking aid",
      "dalparkaid",
      "dal park aid",
      "dal parking app",
    ],
    fuzzyAliases: [
      "dell parking aid",
      "dal parking eight",
      "dal parking aide",
      "dell park aid",
    ],
    contextPattern: PROJECT_CONTEXT_PATTERN,
    searchExpansion: "DalParkAid React Native Dalhousie parking app campus weather timetable reports",
  },
  {
    canonical: "Hybrid Search Memory Assistant",
    category: "project",
    directAliases: [
      "hybrid search memory assistant",
      "hybrid search assistant",
      "hybrid memory assistant",
    ],
    fuzzyAliases: [
      "hybird search memory assistant",
      "hybrid search memory assistance",
      "hybrid search memory system",
    ],
    contextPattern: PROJECT_CONTEXT_PATTERN,
    searchExpansion: "Hybrid Search Memory Assistant hybrid retrieval prompt engineering input token reduction personal memory FTS5 BM25",
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string): RegExp {
  const pattern = escapeRegex(alias.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${pattern}\\b`, "gi");
}

function aliasPatternSource(alias: string): string {
  return escapeRegex(alias.trim()).replace(/\s+/g, "\\s+");
}

function normalizeSpaces(text: string): string {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function compactPhrase(text: string): string {
  return normalizeSpaces(text).replace(/\s+/g, "");
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function charSimilarity(left: string, right: string): number {
  const a = compactPhrase(left);
  const b = compactPhrase(right);
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function hasContext(term: KnownTermDefinition, text: string): boolean {
  return !term.contextPattern || term.contextPattern.test(text);
}

function shouldAllowFuzzyCandidate(term: KnownTermDefinition, observed: string, raw: string): boolean {
  const phrase = normalizeSpaces(observed);
  const normalizedRaw = normalizeSpaces(raw);

  if (term.canonical === "JobLens AI" && /^(job level|job levels|job lev|jobless)/.test(phrase)) {
    if (/\b(ai|project|app|cloud|aws|lambda|dynamodb|s3|architecture|platform)\b/.test(phrase)) return true;
    return AMBIGUOUS_PROJECT_CONTEXT_PATTERN.test(raw);
  }

  if (term.canonical === "ElderAlbum" && /^(older album|older albums|elder albums|elder albam)$/.test(phrase)) {
    if (/\b(found|childhood|photos?|general|family|cousin|from my|my older)\b/i.test(raw)) return false;
    if (AMBIGUOUS_PROJECT_CONTEXT_PATTERN.test(raw)) return true;
    return /^(can you |could you )?(explain|talk about|tell me about) (older album|older albums|elder albam)[? ]*$/.test(normalizedRaw);
  }

  return true;
}

function addCandidate(
  candidates: KnownTermAsrCandidate[],
  term: KnownTermDefinition,
  observed: string,
  confidence: number,
  reason: string,
): void {
  const normalizedObserved = normalizeSpaces(observed);
  if (!normalizedObserved) return;
  const duplicate = candidates.some((candidate) =>
    candidate.canonical === term.canonical && normalizeSpaces(candidate.observed) === normalizedObserved
  );
  if (duplicate) return;
  candidates.push({
    observed: observed.trim(),
    canonical: term.canonical,
    category: term.category,
    confidence,
    reason,
    searchExpansion: term.searchExpansion,
  });
}

function findExplicitAliasCandidates(raw: string): KnownTermAsrCandidate[] {
  const candidates: KnownTermAsrCandidate[] = [];

  for (const term of KNOWN_TERMS) {
    for (const alias of term.directAliases) {
      const matches = raw.match(aliasPattern(alias)) ?? [];
      for (const match of matches) {
        addCandidate(candidates, term, match, 0.98, "known alias");
      }
    }

    if (!hasContext(term, raw)) continue;
    for (const alias of term.fuzzyAliases) {
      const matches = raw.match(aliasPattern(alias)) ?? [];
      for (const match of matches) {
        if (!shouldAllowFuzzyCandidate(term, match, raw)) continue;
        addCandidate(candidates, term, match, 0.84, "known ASR-like phrase");
      }
    }
  }

  return candidates;
}

function findSimilarityCandidates(raw: string): KnownTermAsrCandidate[] {
  const tokens = normalizeSpaces(raw).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const candidates: KnownTermAsrCandidate[] = [];
  for (const term of KNOWN_TERMS) {
    if (!hasContext(term, raw)) continue;

    const targets = [term.canonical, ...term.directAliases]
      .map(normalizeSpaces)
      .filter((value) => value.split(/\s+/).length >= 2);

    for (const target of targets) {
      const targetTokens = target.split(/\s+/);
      const minSize = Math.max(2, targetTokens.length - 1);
      const maxSize = Math.min(tokens.length, targetTokens.length + 1);

      for (let size = minSize; size <= maxSize; size += 1) {
        for (let start = 0; start <= tokens.length - size; start += 1) {
          const phraseTokens = tokens.slice(start, start + size);
          const phrase = phraseTokens.join(" ");
          if (phrase === target) continue;
          const hasAnchor = phraseTokens.some((token) => targetTokens.includes(token));
          if (!hasAnchor) continue;

          const score = charSimilarity(phrase, target);
          if (score < 0.78) continue;
          if (!shouldAllowFuzzyCandidate(term, phrase, raw)) continue;
          addCandidate(candidates, term, phrase, Math.min(0.82, score), "similar to known term");
        }
      }
    }
  }

  return candidates;
}

export function normalizeKnownProjectAsrAliases(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return raw;

  let corrected = raw;
  for (const term of KNOWN_TERMS) {
    const aliases = [...term.directAliases]
      .sort((a, b) => b.length - a.length)
      .map(aliasPatternSource)
      .join("|");
    if (!aliases) continue;
    corrected = corrected.replace(new RegExp(`\\b(?:${aliases})\\b`, "gi"), term.canonical);
  }

  return corrected;
}

export function getKnownTermAsrCandidates(text: string): KnownTermAsrCandidate[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];

  const explicit = findExplicitAliasCandidates(raw);
  const similarity = findSimilarityCandidates(raw);
  return [...explicit, ...similarity]
    .sort((a, b) => b.confidence - a.confidence || b.observed.length - a.observed.length)
    .filter((candidate, index, all) =>
      all.findIndex((item) => item.canonical === candidate.canonical) === index
    );
}

export function getBestKnownTermAsrCandidate(text: string): KnownTermAsrCandidate | null {
  return getKnownTermAsrCandidates(text)[0] ?? null;
}

export function expandKnownTermAsrAliasesForSearch(text: string): string[] {
  const expansions: string[] = [];
  const normalized = normalizeKnownProjectAsrAliases(text);
  if (normalized !== text) expansions.push(normalized);

  for (const candidate of getKnownTermAsrCandidates(text)) {
    expansions.push(candidate.canonical, candidate.searchExpansion);
  }

  return Array.from(new Set(expansions.filter((value) => value.trim())));
}

export function buildKnownTermAsrPromptHint(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return "";

  const normalized = normalizeKnownProjectAsrAliases(raw);
  const candidates = getKnownTermAsrCandidates(raw);
  if (normalized === raw && !candidates.length) return "";

  const lines: string[] = [];
  if (normalized !== raw) {
    lines.push(`High-confidence ASR normalization: treat "${raw}" as "${normalized}".`);
  }

  for (const candidate of candidates.slice(0, 2)) {
    if (normalized.includes(candidate.canonical) && candidate.confidence >= 0.95) continue;
    lines.push(`Possible ASR correction: "${candidate.observed}" may mean "${candidate.canonical}" (${candidate.reason}). Use it only if it fits the surrounding context; otherwise ask a short clarification.`);
  }

  return lines.join("\n");
}
