import {
  conversationLogger,
  type PersonalMemorySearchResult,
} from "../data/conversation-logger";
import {
  classifyMemoryQueryIntent,
  resolveMemoryIdentity,
  scoreFacetForIntent,
} from "../data/memory-taxonomy";
import type { EvenHubV2Settings } from "./protocol";
import {
  findDeepSenseInterviewCard,
  formatInterviewAnswerCard,
  type InterviewAnswerCard,
} from "./interview-guide";
import {
  findAnswerPolicyCard,
  formatAnswerPolicyCard,
  getAnswerPolicyCards,
  type AnswerPolicyCard,
} from "./answer-policy-cards";
import {
  buildMemoryRouterInput,
  evenHubV2MemoryRouter,
  fallbackMemoryLane,
  type MemoryLane,
  type MemoryRouter,
} from "./memory-router";

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
  answerPolicyCardIds: string[];
  prenoteUsedIds: string[];
};

export interface EvenHubV2ContextAdapter {
  build(input: EvenHubV2ContextInput): Promise<EvenHubV2ContextSnapshot>;
}

export type EvenHubV2MemoryCandidate = Pick<
  PersonalMemorySearchResult,
  "id" | "title" | "category" | "content" | "score" | "vectorScore"
> & {
  usageRule?: PersonalMemorySearchResult["usageRule"];
  source?: string;
  sourceRef?: string;
  keywords?: string[];
};

export type EvenHubV2MemorySearchOptions = {
  semantic?: boolean;
  lane?: MemoryLane;
};

export interface EvenHubV2MemoryRetriever {
  search(
    userId: string,
    query: string,
    limit: number,
    options?: EvenHubV2MemorySearchOptions,
  ): Promise<EvenHubV2MemoryCandidate[]>;
}

export type LightweightEvenHubV2ContextAdapterOptions = {
  memoryRetriever?: EvenHubV2MemoryRetriever;
  memoryRouter?: MemoryRouter | null;
  memoryUserId?: string;
  memoryLimit?: number;
  memoryMaxChars?: number;
  memorySearchMode?: EvenHubV2MemorySearchMode;
  activeInterviewQuery?: string;
  interviewCards?: InterviewAnswerCard[] | null;
  answerPolicyCards?: AnswerPolicyCard[] | null;
};

export type EvenHubV2MemorySearchMode = "adaptive" | "lexical" | "semantic";

export function resolveEvenHubV2MemorySearchMode(value: string | undefined): EvenHubV2MemorySearchMode {
  return value === "lexical" || value === "semantic" ? value : "adaptive";
}

class PersonalMemoryRetriever implements EvenHubV2MemoryRetriever {
  constructor(private readonly mode: EvenHubV2MemorySearchMode) {}

  async search(
    userId: string,
    query: string,
    limit: number,
    options: EvenHubV2MemorySearchOptions = {},
  ): Promise<EvenHubV2MemoryCandidate[]> {
    const useSemantic = this.mode === "semantic"
      || (this.mode === "adaptive" && options.semantic === true);
    const vector = useSemantic
      ? await conversationLogger.searchPersonalMemoriesVectorAsync(userId, query, 1000)
      : [];
    const ranked = vector.length
      ? vector
      : useSemantic
        ? await conversationLogger.searchPersonalMemoriesHybridAsync(userId, query, 1000)
        : conversationLogger.searchPersonalMemoriesHybrid(userId, query, 1000);
    const activeMemories = conversationLogger
      .listPersonalMemories(userId, { status: "active", limit: 1000 });
    const directProjectMemories = selectDirectProjectMemories(
      query,
      activeMemories.map((memory) => ({ ...memory, score: 0 })),
    );
    const scoped = options.lane
      ? filterCandidatesForLane(query, options.lane, ranked)
      : ranked;
    const directExperienceMemories = vector.length
      ? []
      : selectDirectExperienceMemories(
        query,
        activeMemories.map((memory) => ({ ...memory, score: 0 })),
      );

    const merged: EvenHubV2MemoryCandidate[] = [];
    const seen = new Set<number>();
    for (const candidate of [
      ...directProjectMemories,
      ...directExperienceMemories,
      ...scoped,
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
  const classification = classifyMemoryQueryIntent(query);
  const projectId = classification.canonicalProjectId;
  if (projectId === "unknown") return [];
  const queryTerms = new Set(normalizedSearchTerms(query));
  return candidates
    .filter((candidate) => (
      resolveProjectOwnership(candidate) === projectId
      && (
        candidate.sourceRef?.startsWith(`project:${projectId}`)
        || /^(?:technical_projects(?:_|$)|project_experience$)/.test(candidate.category)
      )
    ))
    .map((candidate) => {
      const candidateTerms = new Set(normalizedSearchTerms([
        candidate.title,
        candidate.sourceRef || "",
        candidate.content,
        ...(candidate.keywords || []),
      ].join(" ")));
      const overlap = [...queryTerms].filter((term) => candidateTerms.has(term)).length;
      const facet = resolveMemoryIdentity(candidate).facet;
      return {
        ...candidate,
        score: Math.max(
          candidate.score,
          1 + Math.min(0.6, overlap * 0.12) + scoreFacetForIntent(classification, facet),
        ),
      };
    })
    .sort((left, right) => right.score - left.score || left.id - right.id);
}

function resolveProjectOwnership(candidate: EvenHubV2MemoryCandidate) {
  return resolveMemoryIdentity({
    sourceRef: candidate.sourceRef,
    source: candidate.source,
    title: candidate.title,
    category: candidate.category,
    content: "",
    usageRule: "",
    keywords: [],
  }).canonicalProjectId;
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

function isPersonalMemory(candidate: EvenHubV2MemoryCandidate): boolean {
  const categoryAllowed = (
    candidate.source !== "knowledge"
    && !candidate.category.startsWith("knowledge_")
    && candidate.category !== "interview_job"
    && candidate.category !== "interview_profile"
    && Boolean(candidate.content.trim())
  );
  if (!categoryAllowed) return false;
  if (!/^(?:technical_projects(?:_|$)|project_experience$)/.test(candidate.category)) return true;

  const content = candidate.content.trim();
  if (/^(?:selected|relevant|known) projects? include\b/i.test(content)) return false;
  return (
    content.length >= 120
    || /\b(?:built|implemented|integrated|debugged|tested|fixed|deployed|designed|trained|evaluated|uses?|using|lambda|api|database|retrieval|transcript|frontend|backend|result|received)\b/i.test(content)
  );
}

function filterCandidatesForLane(
  query: string,
  lane: MemoryLane,
  candidates: EvenHubV2MemoryCandidate[],
): EvenHubV2MemoryCandidate[] {
  const personalFacts = candidates.filter(isPersonalMemory);
  if (lane === "none") return [];
  if (lane === "profile" || lane === "company_fit") {
    return personalFacts.filter((candidate) => (
      /^(?:career_profile|technical_profile|technical_skills|identity_education|education_history|developer_identity|speaking_style|ai_workflow)/.test(candidate.category)
      || /resume.+(?:profile|project list)/i.test(candidate.title)
    ));
  }
  if (lane === "named_project") {
    const projectId = classifyMemoryQueryIntent(query).canonicalProjectId;
    return personalFacts.filter((candidate) => (
      projectId === "unknown"
        ? /^(?:technical_projects(?:_|$)|project_experience$)/.test(candidate.category)
        : resolveProjectOwnership(candidate) === projectId
    ));
  }
  return personalFacts;
}

function acceptRelevantCandidates(
  lane: MemoryLane,
  candidates: EvenHubV2MemoryCandidate[],
): EvenHubV2MemoryCandidate[] {
  if (lane === "none") return [];
  const deduped = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    .sort((left, right) => right.score - left.score);
  if (lane === "profile" || lane === "company_fit" || lane === "named_project") {
    return deduped.slice(0, 2);
  }

  const top = deduped[0];
  if (!top) return [];
  const hasSignal = (candidate: EvenHubV2MemoryCandidate) => (
    candidate.score >= 0.12 || (candidate.vectorScore ?? 0) >= 0.28
  );
  if (!hasSignal(top)) return [];
  const accepted = [top];
  const second = deduped[1];
  if (
    second
    && hasSignal(second)
    && (
      second.score >= top.score * 0.65
      || (second.vectorScore ?? 0) >= Math.max(0.28, (top.vectorScore ?? 0) * 0.85)
    )
  ) accepted.push(second);
  return accepted;
}

function cleanMemoryText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const GENERATED_MEMORY_SECTION = /^(?:a natural(?: spoken)? answer|good answer|suggested answer(?: direction)?|good resume(?:\/interview)? wording|xiang-style(?: spoken)? answer|safe answer|answer structure|what interviewers want|what not to claim)\s*:/i;

function factOnlyMemoryText(value: string): string {
  const factLines: string[] = [];
  for (const line of cleanMemoryText(value).split("\n")) {
    if (GENERATED_MEMORY_SECTION.test(line.trim())) break;
    factLines.push(line);
  }
  return factLines.join("\n").trim();
}

function buildMemoryQuery(input: EvenHubV2ContextInput): string {
  const current = (input.currentQuestion || input.triggerWindow).trim();
  if (!current) return "";
  if (classifyMemoryQueryIntent(current).canonicalProjectId !== "unknown") return current;
  if (/\b(?:code|function|algorithm|complexity|edge cases?)\b/i.test(current)) return current;
  if (!/\b(?:that|it|this|the project|hardest part|trade-?off|why did you|how did you|what happened)\b/i.test(current)) {
    return current;
  }

  const recentProject = classifyMemoryQueryIntent(input.recentTranscript).canonicalProjectId;
  const labels = {
    saynext: "SayNext",
    joblens: "JobLens AI",
    elderalbum: "ElderAlbum",
    dalparkaid: "DalParkAid",
    study_session_tracker: "Study Session Tracker",
    ai_meeting_monitor: "AI Meeting Monitor",
    cueflow: "CueFlow",
  } as const;
  if (recentProject === "unknown") return current;
  return `${current}\nProject context: ${labels[recentProject]}`;
}

function normalizedMemoryCacheKey(value: string): string {
  const terms = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const leadingAsrFillers = new Set(["uh", "um", "erm", "okay", "ok", "so", "well", "yeah"]);
  while (terms.length && leadingAsrFillers.has(terms[0])) terms.shift();
  return terms.join(" ");
}

function retrievalQueryForLane(query: string, lane: MemoryLane): string {
  if (lane === "profile") {
    return `${query}\nRetrieval target: verified Xiang identity, education, skills, background, or current work facts that directly answer the question.`;
  }
  if (lane === "company_fit") {
    return `${query}\nRetrieval target: verified Xiang career preferences, technical strengths, work style, and relevant applied experience.`;
  }
  if (lane === "behavioral") {
    return `${query}\nRetrieval target: a verified Xiang-specific incident with concrete actions, debugging steps, decisions, and results.`;
  }
  return query;
}

function packMemoryCandidates(
  candidates: EvenHubV2MemoryCandidate[],
  maxChars: number,
): { text: string; ids: string[] } {
  if (!candidates.length) return { text: "", ids: [] };
  const heading = [
    "Verified detailed personal memory facts for Xiang. Use only when directly relevant.",
    "The cards are ordered by relevance. Prefer the first card that directly answers the current question.",
    "These cards contain Xiang-specific evidence. Generic knowledge, job descriptions, generated advice, and answer templates are not memory and are excluded.",
  ].join("\n");
  const blocks: string[] = [];
  const ids: string[] = [];
  let usedChars = heading.length;
  const perCandidateLimit = Math.max(360, Math.floor((maxChars - heading.length) / candidates.length));

  for (const candidate of candidates) {
    const id = `personal-memory:${candidate.id}`;
    const prefix = `[${id}] ${candidate.title} | ${candidate.category}\n`;
    const content = factOnlyMemoryText(candidate.content)
      .slice(0, Math.max(160, perCandidateLimit - prefix.length));
    if (!content) continue;
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
  private readonly memoryRouter: MemoryRouter | null;
  private readonly memoryUserId: string;
  private readonly memoryLimit: number;
  private readonly memoryMaxChars: number;
  private readonly interviewCards: InterviewAnswerCard[];
  private readonly answerPolicyCards: AnswerPolicyCard[];
  private readonly retrievalCache = new Map<string, Promise<EvenHubV2MemoryCandidate[]>>();
  private readonly routeCache = new Map<string, Promise<MemoryLane>>();

  constructor(options: LightweightEvenHubV2ContextAdapterOptions = {}) {
    this.memoryRetriever = options.memoryRetriever || new PersonalMemoryRetriever(
      options.memorySearchMode
        || resolveEvenHubV2MemorySearchMode(process.env.EVENHUB_V2_MEMORY_SEARCH_MODE),
    );
    this.memoryRouter = options.memoryRouter === undefined
      ? evenHubV2MemoryRouter
      : options.memoryRouter;
    this.memoryUserId = options.memoryUserId?.trim()
      || process.env.EVENHUB_V2_MEMORY_USER_ID?.trim()
      || "";
    this.memoryLimit = Math.max(1, Math.min(8, options.memoryLimit
      ?? Number(process.env.EVENHUB_V2_MEMORY_TOP_K || 5)));
    this.memoryMaxChars = Math.max(600, options.memoryMaxChars
      ?? Number(process.env.EVENHUB_V2_MEMORY_CONTEXT_MAX_CHARS || 5200));
    this.interviewCards = options.interviewCards || [];
    this.answerPolicyCards = options.answerPolicyCards ?? getAnswerPolicyCards();
  }

  private retrieveMemories(
    memoryUserId: string,
    conversationId: string,
    memoryQuery: string,
    lane: MemoryLane,
  ): Promise<EvenHubV2MemoryCandidate[]> {
    if (lane === "none") return Promise.resolve([]);
    const query = retrievalQueryForLane(memoryQuery, lane);
    const retrievalKey = [
      memoryUserId,
      conversationId,
      lane,
      normalizedMemoryCacheKey(query),
    ].join("\n");
    const cached = this.retrievalCache.get(retrievalKey);
    if (cached) return cached;

    const retrieval = this.memoryRetriever
      .search(memoryUserId, query, this.memoryLimit, { semantic: true, lane })
      .then((raw) => {
        const ordered = lane === "named_project"
          ? selectDirectProjectMemories(memoryQuery, raw)
          : raw;
        return acceptRelevantCandidates(
          lane,
          filterCandidatesForLane(memoryQuery, lane, ordered),
        );
      })
      .catch((error) => {
        this.retrievalCache.delete(retrievalKey);
        throw error;
      });
    this.retrievalCache.set(retrievalKey, retrieval);
    if (this.retrievalCache.size > 64) {
      const oldestKey = this.retrievalCache.keys().next().value;
      if (oldestKey) this.retrievalCache.delete(oldestKey);
    }
    return retrieval;
  }

  private resolveMemoryLane(input: EvenHubV2ContextInput, memoryQuery: string): Promise<MemoryLane> {
    if (!memoryQuery) return Promise.resolve("none");
    if (classifyMemoryQueryIntent(memoryQuery).canonicalProjectId !== "unknown") {
      return Promise.resolve("named_project");
    }
    const routerInput = buildMemoryRouterInput({
      recentTranscript: input.recentTranscript,
      current: input.currentQuestion || input.triggerWindow,
    });
    const cacheKey = [
      normalizedMemoryCacheKey(routerInput.segmentMinus2),
      normalizedMemoryCacheKey(routerInput.segmentMinus1),
      normalizedMemoryCacheKey(routerInput.current),
    ].join("\n");
    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;

    const routed = this.memoryRouter
      ? this.memoryRouter.predict(routerInput)
        .then((result) => result.lane)
        .catch((error) => {
          console.warn(`[EvenHubV2] memory router failed open: ${error instanceof Error ? error.message : String(error)}`);
          return fallbackMemoryLane(routerInput);
        })
      : Promise.resolve(fallbackMemoryLane(routerInput));
    this.routeCache.set(cacheKey, routed);
    if (this.routeCache.size > 64) {
      const oldestKey = this.routeCache.keys().next().value;
      if (oldestKey) this.routeCache.delete(oldestKey);
    }
    return routed;
  }

  async build(input: EvenHubV2ContextInput): Promise<EvenHubV2ContextSnapshot> {
    const memoryUserId = this.memoryUserId || input.userId;
    let memoryText = "";
    let memoryUsedIds: string[] = [];
    const currentQuestion = (input.currentQuestion || input.triggerWindow).trim();
    const memoryQuery = buildMemoryQuery(input);
    const interviewAnswerCard = currentQuestion
      ? findDeepSenseInterviewCard(currentQuestion, this.interviewCards)
      : null;
    const answerPolicyCard = currentQuestion
      ? findAnswerPolicyCard(currentQuestion, this.answerPolicyCards)
      : null;
    const lane = await this.resolveMemoryLane(input, memoryQuery);
    const dynamicMemoryCardLimit = lane === "profile" && interviewAnswerCard ? 1 : 2;
    if (memoryQuery && lane !== "none") {
      try {
        const memories = (await this.retrieveMemories(
          memoryUserId,
          input.conversationId,
          memoryQuery,
          lane,
        )).slice(0, dynamicMemoryCardLimit);
        const packed = packMemoryCandidates(memories, this.memoryMaxChars);
        memoryText = packed.text;
        memoryUsedIds = packed.ids;
      } catch (error) {
        console.warn(`[EvenHubV2] memory retrieval failed open: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const sections = [
      `Settings: language=${input.settings.language}; autoPopup=${input.settings.autoPopup ? "on" : "off"}`,
      [
        "Context authority:",
        "- The current question decides what to answer; no context may replace its topic.",
        "- For Xiang's personal facts, project positioning, and preferred interview direction, approved interview context overrides retrieved memory and ordinary ASR transcript wording.",
        "- Retrieved memory may add only verified Xiang-specific detail. It may not add generic knowledge, generated advice, or inferred experience.",
        "- Reusable answer-policy cards may shape organization and caution, but they can never supply a personal fact or story.",
      ].join("\n"),
      interviewAnswerCard ? formatInterviewAnswerCard(interviewAnswerCard) : "",
      memoryText,
      answerPolicyCard ? formatAnswerPolicyCard(answerPolicyCard) : "",
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
      answerPolicyCardIds: answerPolicyCard
        ? [`answer-policy:${answerPolicyCard.id}`]
        : [],
      prenoteUsedIds: input.selectedPrenoteIds,
    };
  }
}
