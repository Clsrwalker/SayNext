import {
  conversationLogger,
  type PersonalMemorySearchResult,
} from "../data/conversation-logger";
import {
  classifyMemoryQueryIntent,
  resolveMemoryIdentity,
} from "../data/memory-taxonomy";
import type { EvenHubV2Settings } from "./protocol";
import {
  findDeepSenseInterviewCard,
  formatInterviewAnswerCard,
  type InterviewAnswerCard,
} from "./interview-guide";

export type EvenHubV2ContextInput = {
  userId: string;
  conversationId: string;
  currentQuestion?: string;
  triggerWindow: string;
  recentTranscript: string;
  selectedPrenoteIds: string[];
  selectedPrenoteText: string;
  settings: EvenHubV2Settings;
};

export type EvenHubV2ContextSnapshot = {
  contextSnapshot: string;
  memoryUsedIds: string[];
  interviewAnswerCardIds: string[];
  prenoteUsedIds: string[];
};

export interface EvenHubV2ContextAdapter {
  build(input: EvenHubV2ContextInput): Promise<EvenHubV2ContextSnapshot>;
}

export type EvenHubV2MemoryCandidate = Pick<
  PersonalMemorySearchResult,
  "id" | "title" | "category" | "content" | "score"
> & { sourceRef?: string; keywords?: string[] };

export interface EvenHubV2MemoryRetriever {
  search(userId: string, query: string, limit: number): Promise<EvenHubV2MemoryCandidate[]>;
}

export type LightweightEvenHubV2ContextAdapterOptions = {
  memoryRetriever?: EvenHubV2MemoryRetriever;
  memoryUserId?: string;
  memoryLimit?: number;
  memoryMaxChars?: number;
  memorySearchMode?: EvenHubV2MemorySearchMode;
  activeInterviewQuery?: string;
  interviewCards?: InterviewAnswerCard[] | null;
};

export type EvenHubV2MemorySearchMode = "lexical" | "semantic";

export function resolveEvenHubV2MemorySearchMode(value: string | undefined): EvenHubV2MemorySearchMode {
  return value === "semantic" ? "semantic" : "lexical";
}

class PersonalMemoryRetriever implements EvenHubV2MemoryRetriever {
  constructor(private readonly mode: EvenHubV2MemorySearchMode) {}

  async search(userId: string, query: string, limit: number): Promise<EvenHubV2MemoryCandidate[]> {
    const hybrid = this.mode === "semantic"
      ? await conversationLogger.searchPersonalMemoriesHybridAsync(userId, query, limit)
      : conversationLogger.searchPersonalMemoriesHybrid(userId, query, limit);
    const normalizedQuery = query.toLowerCase();
    const activeMemories = conversationLogger
      .listPersonalMemories(userId, { status: "active", limit: 1000 });
    const directJobMemories = activeMemories
      .filter((memory) => memory.category === "interview_job")
      .filter((memory) => {
        const companyToken = memory.title.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0] || "";
        return companyToken.length >= 3 && normalizedQuery.includes(companyToken);
      })
      .map((memory) => ({ ...memory, score: 2 }));
    const directProjectMemories = selectDirectProjectMemories(
      query,
      activeMemories.map((memory) => ({ ...memory, score: 0 })),
    );
    const directExperienceMemories = selectDirectExperienceMemories(
      query,
      activeMemories.map((memory) => ({ ...memory, score: 0 })),
    );

    const merged: EvenHubV2MemoryCandidate[] = [];
    const seen = new Set<number>();
    for (const candidate of [
      ...directJobMemories,
      ...directProjectMemories,
      ...directExperienceMemories,
      ...hybrid,
    ]) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      merged.push(candidate);
      if (merged.length >= limit) break;
    }
    return merged;
  }
}

export function selectDirectProjectMemories(
  query: string,
  candidates: EvenHubV2MemoryCandidate[],
): EvenHubV2MemoryCandidate[] {
  const projectId = classifyMemoryQueryIntent(query).canonicalProjectId;
  if (projectId === "unknown") return [];
  return candidates
    .filter((candidate) => resolveMemoryIdentity(candidate).canonicalProjectId === projectId)
    .map((candidate) => ({ ...candidate, score: Math.max(2, candidate.score) }));
}

const EXPERIENCE_QUERY_STOP_WORDS = new Set([
  "what", "which", "kind", "of", "experience", "do", "does", "did", "you", "your",
  "have", "with", "using", "used", "build", "built", "work", "worked", "on", "and", "the",
  "a", "an", "to", "in", "for", "tell", "me", "about", "can", "could", "xiang", "personal",
  "project",
]);

function normalizedSearchTerms(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}+#.-]+/gu) || [])
    .map((term) => term.endsWith("s") && term.length > 4 ? term.slice(0, -1) : term)
    .filter((term) => term.length >= 2 && !EXPERIENCE_QUERY_STOP_WORDS.has(term));
}

export function selectDirectExperienceMemories(
  query: string,
  candidates: EvenHubV2MemoryCandidate[],
): EvenHubV2MemoryCandidate[] {
  const asksAboutXiang = /\b(?:you|your|yourself|xiang)\b/i.test(query);
  const asksAboutExperience = /\b(?:experience|built|build|worked|used|implemented|developed)\b/i.test(query);
  if (!asksAboutXiang || !asksAboutExperience) return [];

  const queryTerms = new Set(normalizedSearchTerms(query));
  if (!queryTerms.size) return [];
  return candidates
    .filter((candidate) => (
      !candidate.category.startsWith("knowledge_")
      && candidate.category !== "interview_job"
      && /^(?:technical_|project_|career_profile|developer_identity|ai_workflow)/.test(candidate.category)
    ))
    .map((candidate) => {
      const candidateTerms = new Set(normalizedSearchTerms([
        candidate.title,
        candidate.content,
        ...(candidate.keywords || []),
      ].join(" ")));
      const overlap = [...queryTerms].filter((term) => candidateTerms.has(term)).length;
      return { candidate, overlap };
    })
    .filter(({ overlap }) => overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || right.candidate.score - left.candidate.score)
    .slice(0, 2)
    .map(({ candidate, overlap }) => ({ ...candidate, score: Math.max(candidate.score, 1 + overlap / 10) }));
}

const INTERVIEW_PROFILE_QUERY = "Resume Xiang skills profile selected project list interview answer style";

type MemoryLane = "intro" | "named_project" | "company_fit" | "technical" | "general";

function classifyMemoryLane(query: string): MemoryLane {
  const normalized = query.toLowerCase();
  if (
    /\b(?:tell me (?:a little bit )?about yourself|introduce yourself|walk me through your background|who are you)\b/.test(normalized)
  ) return "intro";
  if (classifyMemoryQueryIntent(query).canonicalProjectId !== "unknown") return "named_project";
  if (/\b(?:why (?:this|our)|fit for|hire you|this role|this company)\b/.test(normalized)) return "company_fit";
  if (/\b(?:what is|what's|explain|how does|difference between|trade-?off)\b/.test(normalized)) return "technical";
  return "general";
}

function isPersonalMemory(candidate: EvenHubV2MemoryCandidate): boolean {
  return !candidate.category.startsWith("knowledge_");
}

function needsInterviewProfile(query: string, candidates: EvenHubV2MemoryCandidate[]): boolean {
  if (classifyMemoryLane(query) === "intro") return true;
  if (candidates.some((candidate) => candidate.category === "interview_job")) return false;
  if (candidates.some((candidate) => isPersonalMemory(candidate) && candidate.score >= 1)) return false;
  if (candidates.filter(isPersonalMemory).length >= 2) return false;
  const normalized = query.toLowerCase();
  const hasPersonalSubject = /\b(?:you|your|yourself|xiang)\b/.test(normalized);
  const hasInterviewTopic = /\b(?:experience|background|skills?|strengths?|weakness(?:es)?|projects?|built|worked|contribut(?:e|ed|ion)|fit|hire|resume|behavioral|challenge|conflict|failure|proud)\b/.test(normalized);
  return hasPersonalSubject && hasInterviewTopic;
}

function filterCandidatesForLane(query: string, candidates: EvenHubV2MemoryCandidate[]): EvenHubV2MemoryCandidate[] {
  const lane = classifyMemoryLane(query);
  if (lane === "intro") return candidates.filter(isPersonalMemory);
  if (lane === "named_project") {
    const projectId = classifyMemoryQueryIntent(query).canonicalProjectId;
    return candidates.filter((candidate) => {
      const identity = resolveMemoryIdentity(candidate);
      return identity.canonicalProjectId === projectId || identity.canonicalProjectId === "unknown";
    });
  }
  if (lane === "technical" && !/\b(?:you|your|xiang)\b/i.test(query)) {
    const knowledge = candidates.filter((candidate) => !isPersonalMemory(candidate));
    return knowledge;
  }
  return candidates;
}

function prioritizeExplicitProject(
  query: string,
  candidates: EvenHubV2MemoryCandidate[],
): EvenHubV2MemoryCandidate[] {
  const projectId = classifyMemoryQueryIntent(query).canonicalProjectId;
  if (projectId === "unknown") return candidates;
  const matching: EvenHubV2MemoryCandidate[] = [];
  const rest: EvenHubV2MemoryCandidate[] = [];
  for (const candidate of candidates) {
    const identity = resolveMemoryIdentity(candidate);
    if (identity.canonicalProjectId === projectId) {
      matching.push(candidate);
    } else if (identity.canonicalProjectId === "unknown") {
      rest.push(candidate);
    }
  }
  return [...matching, ...rest];
}

function mergeMemoryCandidates(
  preferred: EvenHubV2MemoryCandidate[],
  primary: EvenHubV2MemoryCandidate[],
  limit: number,
): EvenHubV2MemoryCandidate[] {
  const merged: EvenHubV2MemoryCandidate[] = [];
  const seen = new Set<number>();
  for (const candidate of [...preferred.slice(0, 3), ...primary]) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    merged.push(candidate);
    if (merged.length >= limit) break;
  }
  return merged;
}

function cleanMemoryText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildMemoryQuery(input: EvenHubV2ContextInput): string {
  return (input.currentQuestion || input.triggerWindow).trim();
}

function packMemoryCandidates(
  candidates: EvenHubV2MemoryCandidate[],
  maxChars: number,
): { text: string; ids: string[] } {
  if (!candidates.length) return { text: "", ids: [] };
  const heading = [
    "Relevant private memory facts for Xiang. Use only when directly relevant.",
    "The cards are ordered by relevance. Prefer the first card that directly answers the current question.",
    "Knowledge memories can explain a concept, but do not prove Xiang used that technology or had that experience.",
  ].join("\n");
  const blocks: string[] = [];
  const ids: string[] = [];
  let usedChars = heading.length;
  const perCandidateLimit = Math.max(360, Math.floor((maxChars - heading.length) / candidates.length));

  for (const candidate of candidates) {
    const id = `personal-memory:${candidate.id}`;
    const prefix = `[${id}] ${candidate.title} | ${candidate.category}\n`;
    const content = cleanMemoryText(candidate.content).slice(0, Math.max(160, perCandidateLimit - prefix.length));
    const block = `${prefix}${content}`.trim();
    const separatorChars = blocks.length ? 6 : 2;
    if (usedChars + separatorChars + block.length > maxChars) break;
    blocks.push(block);
    ids.push(id);
    usedChars += separatorChars + block.length;
  }

  return blocks.length
    ? { text: `${heading}\n\n${blocks.join("\n\n---\n\n")}`, ids }
    : { text: "", ids: [] };
}

export class LightweightEvenHubV2ContextAdapter implements EvenHubV2ContextAdapter {
  private readonly memoryRetriever: EvenHubV2MemoryRetriever;
  private readonly memoryUserId: string;
  private readonly memoryLimit: number;
  private readonly memoryMaxChars: number;
  private readonly activeInterviewQuery: string;
  private readonly interviewCards: InterviewAnswerCard[];

  constructor(options: LightweightEvenHubV2ContextAdapterOptions = {}) {
    this.memoryRetriever = options.memoryRetriever || new PersonalMemoryRetriever(
      options.memorySearchMode
        || resolveEvenHubV2MemorySearchMode(process.env.EVENHUB_V2_MEMORY_SEARCH_MODE),
    );
    this.memoryUserId = options.memoryUserId?.trim()
      || process.env.EVENHUB_V2_MEMORY_USER_ID?.trim()
      || "";
    this.memoryLimit = Math.max(1, Math.min(8, options.memoryLimit
      ?? Number(process.env.EVENHUB_V2_MEMORY_TOP_K || 5)));
    this.memoryMaxChars = Math.max(600, options.memoryMaxChars
      ?? Number(process.env.EVENHUB_V2_MEMORY_CONTEXT_MAX_CHARS || 5200));
    this.activeInterviewQuery = options.activeInterviewQuery?.trim()
      || process.env.EVENHUB_V2_ACTIVE_INTERVIEW_QUERY?.trim()
      || "";
    this.interviewCards = options.interviewCards || [];
  }

  async build(input: EvenHubV2ContextInput): Promise<EvenHubV2ContextSnapshot> {
    const memoryUserId = this.memoryUserId || input.userId;
    let memoryText = "";
    let memoryUsedIds: string[] = [];
    const memoryQuery = buildMemoryQuery(input);
    const interviewAnswerCard = memoryQuery
      ? findDeepSenseInterviewCard(memoryQuery, this.interviewCards)
      : null;
    const dynamicMemoryCardLimit = Math.max(0, 3 - (interviewAnswerCard ? 1 : 0));
    if (memoryQuery) {
      try {
        const lane = classifyMemoryLane(memoryQuery);
        const primaryMemories = prioritizeExplicitProject(
          memoryQuery,
          await this.memoryRetriever.search(memoryUserId, memoryQuery, this.memoryLimit),
        );
        const activeInterviewMemories = this.activeInterviewQuery
          && (lane === "intro" || lane === "company_fit")
          ? (await this.memoryRetriever.search(
              memoryUserId,
              this.activeInterviewQuery,
              this.memoryLimit,
            )).filter((memory) => memory.category === "interview_job")
          : [];
        const primaryWithInterview = mergeMemoryCandidates(
          activeInterviewMemories,
          primaryMemories,
          this.memoryLimit,
        );
        const profileMemories = needsInterviewProfile(memoryQuery, primaryWithInterview)
          ? await this.memoryRetriever.search(memoryUserId, INTERVIEW_PROFILE_QUERY, this.memoryLimit)
          : [];
        const orderedMemories = lane === "intro"
          ? mergeMemoryCandidates(
              activeInterviewMemories.length
                ? [...profileMemories.slice(0, 1), ...activeInterviewMemories.slice(0, 1)]
                : profileMemories,
              primaryMemories,
              this.memoryLimit,
            )
          : lane === "company_fit" && activeInterviewMemories.length
            ? primaryWithInterview
            : lane === "company_fit"
              ? mergeMemoryCandidates(profileMemories, primaryMemories, this.memoryLimit)
              : mergeMemoryCandidates(primaryMemories, profileMemories, this.memoryLimit);
        const memories = filterCandidatesForLane(
          memoryQuery,
          orderedMemories,
        ).slice(0, dynamicMemoryCardLimit);
        const packed = packMemoryCandidates(memories, this.memoryMaxChars);
        memoryText = packed.text;
        memoryUsedIds = packed.ids;
      } catch (error) {
        console.warn(`[EvenHubV2] memory retrieval failed open: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const sections = [
      `Settings: language=${input.settings.language}; autoPopup=${input.settings.autoPopup ? "on" : "off"}`,
      interviewAnswerCard ? formatInterviewAnswerCard(interviewAnswerCard) : "",
      input.selectedPrenoteText.trim()
        ? `Selected prenote, use only if directly relevant:\n${input.selectedPrenoteText.trim().slice(0, 2500)}`
        : "",
      memoryText,
      input.recentTranscript.trim()
        ? `Previous canonical turns, use only to resolve a follow-up:\n${input.recentTranscript.trim().slice(-1800)}`
        : "",
      `Current question or request, this is the authoritative topic:\n${(input.currentQuestion || input.triggerWindow).trim()}`,
    ].filter(Boolean);

    return {
      contextSnapshot: sections.join("\n\n"),
      memoryUsedIds,
      interviewAnswerCardIds: interviewAnswerCard
        ? [`interview-answer:${interviewAnswerCard.id}`]
        : [],
      prenoteUsedIds: input.selectedPrenoteIds,
    };
  }
}
