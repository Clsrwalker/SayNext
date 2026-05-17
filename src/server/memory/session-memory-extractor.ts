import {
  conversationLogger,
  type ConversationEventRecord,
  type ConversationSampleRecord,
  type PersonalMemoryRecord,
  type PersonalMemorySensitivity,
  type SessionMemoryCandidateRecord,
  type SessionMemoryCandidateStatus,
} from "../data/conversation-logger";
import { getSayNextRuntimeMode, getSessionMemoryProvider, isSessionMemoryBatchEnabled } from "../config";
import { generateLocalJson } from "../local-llm/ollama-client";
import { generateOpenAiJson } from "../local-llm/openai-json-client";

export type SessionMemoryCandidateType =
  | "personal_fact"
  | "preference"
  | "speaking_style"
  | "project_detail"
  | "knowledge_fact"
  | "event_summary"
  | "correction";

export interface SessionMemoryCandidateDraft {
  candidateType: SessionMemoryCandidateType;
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  evidence: string[];
  confidence: number;
  valueScore: number;
  riskScore: number;
  reason: string;
  mentionedDate?: string | null;
  dateSource?: SessionMemoryDateSource;
  dateConfidence?: number;
  dateEvidence?: string[];
}

export interface SessionMemoryExtractionResult {
  sessionSummary: string;
  candidates: SessionMemoryCandidateDraft[];
  rejected: Array<{
    reason: string;
    evidence?: string;
  }>;
}

export type SessionMemoryDateSource = "transcript" | "inferred_from_session_time" | "session_time_only";

export interface SessionMemoryDateMetadata {
  eventTime: string;
  mentionedDate: string | null;
  dateSource: SessionMemoryDateSource;
  dateConfidence: number;
  dateEvidence: string[];
}

export interface SessionMemoryValidation {
  valid: boolean;
  safeToPromote: boolean;
  flags: string[];
  groundedEvidence: string[];
  duplicateMemoryRefs: string[];
  dateMetadata: SessionMemoryDateMetadata;
  reason: string;
}

export interface ExtractSessionMemoryOptions {
  userId: string;
  sessionId: string;
  limitCandidates?: number;
  promoteSafe?: boolean;
  maxTranscriptChars?: number;
  reviewAll?: boolean;
}

export interface ExtractSessionMemoryFromTextOptions {
  userId: string;
  sessionId: string;
  sessionStartTimestamp: string;
  sessionLastTimestamp: string;
  transcriptText: string;
  aiOutputText?: string;
  limitCandidates?: number;
  provider?: "ollama" | "openai";
  trustFirstPersonTranscript?: boolean;
}

export interface ExtractedSessionMemoryCandidate {
  candidate: SessionMemoryCandidateDraft;
  validation: SessionMemoryValidation;
  status: SessionMemoryCandidateStatus;
}

export interface ExtractSessionMemoryOutput {
  sessionId: string;
  model: string;
  provider: "ollama" | "openai";
  runtimeMode: "local" | "travel";
  batchEnabled: boolean;
  rawModelOutput: string;
  sessionSummary: string;
  candidates: SessionMemoryCandidateRecord[];
  promoted: Array<{
    candidateId: number;
    memoryId: number;
    title: string;
  }>;
}

function clampUnit(value: unknown, fallback: number): number {
  const numberValue = Number(value ?? fallback);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(1, numberValue));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter((token) => token.length >= 2);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nextWeekday(base: Date, weekday: number): Date {
  const current = base.getUTCDay();
  const delta = (weekday - current + 7) % 7 || 7;
  return addDays(base, delta);
}

function previousWeekday(base: Date, weekday: number): Date {
  const current = base.getUTCDay();
  const delta = (current - weekday + 7) % 7 || 7;
  return addDays(base, -delta);
}

function hasDateExpression(text: string): boolean {
  return /\b(?:today|tomorrow|yesterday|tonight|this morning|this afternoon|this evening|this week|next week|last week|next month|last month|next year|last year|recently|currently|now|spring|summer|fall|autumn|winter)\b/i.test(text)
    || /\b(?:next|last|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)
    || /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i.test(text)
    || /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(text)
    || /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(text)
    || /\b(?:19|20)\d{2}\b/.test(text);
}

function contentHasUnstableTimeExpression(text: string): boolean {
  return /\b(?:today|tomorrow|yesterday|tonight|recently|currently|now|these days|this week|next week|last week|this month|next month|last month)\b/i.test(text);
}

function inferMentionedDate(text: string, eventTime: string): { date: string | null; source: SessionMemoryDateSource; confidence: number } {
  const base = new Date(eventTime);
  if (Number.isNaN(base.getTime())) {
    return { date: null, source: "session_time_only", confidence: 0.3 };
  }

  const normalized = text.toLowerCase();
  const iso = normalized.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    const parsed = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(parsed.getTime())) return { date: isoDateOnly(parsed), source: "transcript", confidence: 1 };
  }

  const slash = normalized.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    const parsed = new Date(Date.UTC(year, Number(slash[1]) - 1, Number(slash[2])));
    if (!Number.isNaN(parsed.getTime())) return { date: isoDateOnly(parsed), source: "transcript", confidence: 0.9 };
  }

  const monthDay = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i);
  if (monthDay) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = monthNames.findIndex((name) => monthDay[1].toLowerCase().startsWith(name));
    const year = Number(monthDay[3] || base.getUTCFullYear());
    const parsed = new Date(Date.UTC(year, month, Number(monthDay[2])));
    if (!Number.isNaN(parsed.getTime())) return { date: isoDateOnly(parsed), source: "transcript", confidence: monthDay[3] ? 1 : 0.85 };
  }

  if (/\btoday\b|\bthis morning\b|\bthis afternoon\b|\bthis evening\b|\btonight\b/i.test(text)) {
    return { date: isoDateOnly(base), source: "inferred_from_session_time", confidence: 0.75 };
  }
  if (/\byesterday\b/i.test(text)) {
    return { date: isoDateOnly(addDays(base, -1)), source: "inferred_from_session_time", confidence: 0.75 };
  }
  if (/\btomorrow\b/i.test(text)) {
    return { date: isoDateOnly(addDays(base, 1)), source: "inferred_from_session_time", confidence: 0.75 };
  }

  const weekday = text.match(/\b(next|last|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) {
    const day = WEEKDAY_INDEX[weekday[2].toLowerCase()];
    if (weekday[1].toLowerCase() === "next") return { date: isoDateOnly(nextWeekday(base, day)), source: "inferred_from_session_time", confidence: 0.7 };
    if (weekday[1].toLowerCase() === "last") return { date: isoDateOnly(previousWeekday(base, day)), source: "inferred_from_session_time", confidence: 0.7 };
    return { date: isoDateOnly(nextWeekday(addDays(base, -7), day)), source: "inferred_from_session_time", confidence: 0.65 };
  }

  const yearOnly = normalized.match(/\b((?:19|20)\d{2})\b/);
  if (yearOnly) {
    return { date: yearOnly[1], source: "transcript", confidence: 0.8 };
  }

  return { date: null, source: "session_time_only", confidence: 0.3 };
}

function buildTranscriptText(samples: ConversationSampleRecord[], events: ConversationEventRecord[]): string {
  if (samples.length > 0) {
    return samples
      .map((sample) => `[${formatTime(sample.timestamp)}] ${sample.transcript}`)
      .join("\n");
  }

  return events
    .map((event) => `# ${event.title}\n${event.rawTranscript}`)
    .join("\n\n");
}

function buildAiOutputText(samples: ConversationSampleRecord[]): string {
  return samples
    .filter((sample) => sample.aiReply?.trim())
    .map((sample) => `[${formatTime(sample.timestamp)}] ${sample.aiReply}`)
    .join("\n");
}

function hasGroundedEvidence(evidence: string, transcriptText: string): boolean {
  const normalizedEvidence = normalizeText(evidence);
  const normalizedTranscript = normalizeText(transcriptText);
  if (!normalizedEvidence || normalizedEvidence.length < 8) return false;
  if (normalizedTranscript.includes(normalizedEvidence)) return true;

  const evidenceTokens = tokenize(normalizedEvidence);
  if (evidenceTokens.length < 5) return false;

  for (let index = 0; index <= evidenceTokens.length - 5; index += 1) {
    const shingle = evidenceTokens.slice(index, index + 5).join(" ");
    if (normalizedTranscript.includes(shingle)) return true;
  }

  return false;
}

function isDuplicateCandidate(candidate: SessionMemoryCandidateDraft, memories: PersonalMemoryRecord[]): string[] {
  const candidateContent = normalizeText(candidate.content);
  if (!candidateContent) return [];

  return memories
    .filter((memory) => {
      const existing = normalizeText(memory.content);
      if (!existing) return false;
      if (existing === candidateContent) return true;
      if (candidateContent.length > 120 && existing.includes(candidateContent.slice(0, 120))) return true;
      if (existing.length > 120 && candidateContent.includes(existing.slice(0, 120))) return true;
      return false;
    })
    .slice(0, 5)
    .map((memory) => memory.sourceRef || `memory:${memory.id}`);
}

function candidateLooksLikeAiOutput(candidate: SessionMemoryCandidateDraft, aiOutputText: string, transcriptText: string): boolean {
  const content = normalizeText(candidate.content);
  if (content.length < 40) return false;

  const normalizedAi = normalizeText(aiOutputText);
  const normalizedTranscript = normalizeText(transcriptText);
  if (!normalizedAi || !normalizedAi.includes(content.slice(0, Math.min(80, content.length)))) return false;
  return !normalizedTranscript.includes(content.slice(0, Math.min(80, content.length)));
}

function includesAny(value: string, needles: string[]): boolean {
  const normalizedValue = ` ${normalizeText(value)} `;
  return needles.some((needle) => {
    const normalizedNeedle = normalizeText(needle);
    if (!normalizedNeedle) return false;
    if (normalizedNeedle.length <= 3 && /^[a-z0-9]+$/i.test(normalizedNeedle)) {
      return normalizedValue.includes(` ${normalizedNeedle} `);
    }
    return normalizedValue.includes(normalizedNeedle);
  });
}

function isQuestionEvidence(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?")
    || /^(?:what|where|when|why|how|do|does|did|are|is|can|could|would|should|tell me|have you|has xiang|did xiang)\b/i.test(trimmed);
}

function hasFirstPersonStatementEvidence(evidence: string[]): boolean {
  return evidence.some((item) => {
    if (isQuestionEvidence(item)) return false;
    return /\b(?:i|i'm|im|i've|ive|i'd|id|me|my|mine|we|we're|weve|our|ours)\b/i.test(item)
      || /(?:我|我的|我们|俺|咱)/.test(item);
  });
}

function deriveDateMetadata(input: {
  candidate: SessionMemoryCandidateDraft;
  groundedEvidence: string[];
  sessionStartTimestamp: string;
}): SessionMemoryDateMetadata {
  const eventTime = formatTime(input.sessionStartTimestamp);
  const groundedDateEvidence = [
    ...input.groundedEvidence,
    ...(input.candidate.dateEvidence ?? []),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .filter(hasDateExpression);

  const dateText = groundedDateEvidence.join("\n");
  const inferred = dateText
    ? inferMentionedDate(dateText, eventTime)
    : { date: null, source: "session_time_only" as const, confidence: 0.3 };

  const llmDate = typeof input.candidate.mentionedDate === "string" && input.candidate.mentionedDate.trim()
    ? input.candidate.mentionedDate.trim()
    : null;
  const llmConfidence = clampUnit(input.candidate.dateConfidence, inferred.confidence);

  if (groundedDateEvidence.length > 0) {
    return {
      eventTime,
      mentionedDate: inferred.date,
      dateSource: inferred.source,
      dateConfidence: inferred.date ? Math.max(inferred.confidence, Math.min(llmConfidence, 0.9)) : inferred.confidence,
      dateEvidence: groundedDateEvidence.slice(0, 5),
    };
  }

  return {
    eventTime,
    mentionedDate: null,
    dateSource: "session_time_only",
    dateConfidence: 0.3,
    dateEvidence: [],
  };
}

export interface ExtractSessionMemoryFromTextOutput {
  sessionId: string;
  model: string;
  provider: "ollama" | "openai";
  runtimeMode: "local" | "travel";
  batchEnabled: boolean;
  rawModelOutput: string;
  rawJson: string;
  sessionSummary: string;
  candidates: ExtractedSessionMemoryCandidate[];
  rejected: SessionMemoryExtractionResult["rejected"];
}

function validateCandidate(input: {
  candidate: SessionMemoryCandidateDraft;
  transcriptText: string;
  aiOutputText: string;
  existingMemories: PersonalMemoryRecord[];
  sessionStartTimestamp: string;
  trustFirstPersonTranscript?: boolean;
}): SessionMemoryValidation {
  const flags: string[] = [];
  const groundedEvidence = (input.candidate.evidence ?? [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => hasGroundedEvidence(item, input.transcriptText));
  const dateMetadata = deriveDateMetadata({
    candidate: input.candidate,
    groundedEvidence,
    sessionStartTimestamp: input.sessionStartTimestamp,
  });

  if (!input.candidate.content.trim()) flags.push("empty_content");
  if (input.candidate.content.trim().length < 30) flags.push("content_too_short");
  if (input.candidate.content.trim().length > 1800) flags.push("content_too_long");
  if (groundedEvidence.length === 0) flags.push("missing_grounded_evidence");
  if (input.candidate.confidence < 0.72) flags.push("low_confidence");
  if (input.candidate.valueScore < 0.45) flags.push("low_value");
  if (input.candidate.riskScore > 0.62) flags.push("high_risk");
  if (input.candidate.sensitivity === "high") flags.push("high_sensitivity_requires_review");
  if (candidateLooksLikeAiOutput(input.candidate, input.aiOutputText, input.transcriptText)) flags.push("looks_derived_from_ai_output");
  if (hasDateExpression(input.candidate.content) && dateMetadata.dateSource === "session_time_only") flags.push("unverified_date_in_content");
  if (contentHasUnstableTimeExpression(input.candidate.content) && dateMetadata.mentionedDate === null) flags.push("ambiguous_time_in_content");

  const candidateText = normalizeText([
    input.candidate.title,
    input.candidate.category,
    input.candidate.content,
    input.candidate.evidence.join(" "),
  ].join("\n"));
  const groundedText = normalizeText(groundedEvidence.join("\n"));
  const firstPersonStatementEvidence = hasFirstPersonStatementEvidence(groundedEvidence);
  const projectTerms = [
    "project", "app", "application", "software", "website", "mobile", "react",
    "aws", "cloud", "lambda", "dynamodb", "api", "database", "saynext",
    "joblens", "elderalbum", "dalparkaid", "parking", "resume", "transcript",
  ];
  const knownXiangProjectTerms = [
    "saynext", "joblens", "elderalbum", "dalparkaid", "aws", "lambda",
    "dynamodb", "firebase", "react", "react native", "mobile app",
  ];
  const knownXiangPersonalAnchorTerms = [
    "xiang", "li xiang", "dalhousie", "acadia", "halifax", "dartmouth",
    "chengdu", "shuangliu", "aubrey drive", "honda", "civic", "kentville",
    "genshin", "pokemon", "reddit", "anime", "saxophone", "swimming",
    "fried chicken", "coca cola", "pepsi", "saynext", "joblens", "elderalbum",
    "dalparkaid", "cloud architecting", "deep learning", "computer science",
  ];
  const styleTerms = [
    "speaking", "style", "tone", "wording", "answer", "reply", "english",
    "casual", "formal", "natural", "saynext", "phrase", "phrasing",
  ];
  const publicLectureTerms = [
    "criminal law", "law school", "actus reus", "mens rea", "people versus",
    "teaching cases", "read a case", "case reading",
  ];
  const coreKnowledgeTerms = [
    "computer", "software", "cloud", "aws", "serverless", "lambda", "dynamodb",
    "api", "database", "data", "network", "security", "algorithm", "system",
    "machine learning", "deep learning", "ai", "model", "react", "mobile",
    "web", "interview", "resume", "communication", "presentation", "ielts",
  ];

  if (input.candidate.candidateType === "project_detail" && !includesAny(candidateText, projectTerms)) {
    flags.push("project_detail_without_project_terms");
  }

  if (input.candidate.candidateType === "project_detail"
    && !includesAny(groundedText, knownXiangProjectTerms)
    && !/\b(?:xiang|my project|our project|i built|i made|i developed|i worked on)\b/i.test(groundedEvidence.join("\n"))) {
    flags.push(input.trustFirstPersonTranscript && firstPersonStatementEvidence
      ? "first_person_requires_review"
      : "project_detail_without_known_xiang_anchor");
  }

  if (["personal_fact", "preference", "speaking_style"].includes(input.candidate.candidateType)
    && !includesAny(groundedText, knownXiangPersonalAnchorTerms)
    && !/\b(?:my name is xiang|i am xiang|i'm xiang)\b/i.test(groundedEvidence.join("\n"))) {
    flags.push(input.trustFirstPersonTranscript && firstPersonStatementEvidence
      ? "first_person_requires_review"
      : "personal_candidate_without_xiang_anchor");
  }

  if (input.candidate.candidateType === "speaking_style" && !includesAny(candidateText, styleTerms)) {
    flags.push("speaking_style_without_expression_terms");
  }

  if (!["knowledge_fact", "event_summary"].includes(input.candidate.candidateType)
    && includesAny(candidateText, publicLectureTerms)) {
    flags.push("third_party_lecture_as_personal_memory");
  }

  if (input.candidate.candidateType === "event_summary") {
    flags.push("event_summary_review_only");
  }

  if (input.candidate.candidateType === "knowledge_fact" && !includesAny(candidateText, coreKnowledgeTerms)) {
    flags.push("outside_core_memory_domain_review_only");
  }

  if (["personal_fact", "preference", "speaking_style", "project_detail"].includes(input.candidate.candidateType)
    && groundedEvidence.length > 0
    && groundedEvidence.every(isQuestionEvidence)) {
    flags.push("question_only_evidence");
  }

  if (input.candidate.candidateType === "event_summary"
    && includesAny(candidateText, publicLectureTerms)
    && /\bxiang\s+(?:led|taught|co authored|co-authored|wrote|authored)\b/i.test(input.candidate.content)) {
    flags.push("third_party_lecture_as_personal_memory");
  }

  const duplicateMemoryRefs = isDuplicateCandidate(input.candidate, input.existingMemories);
  if (duplicateMemoryRefs.length > 0) flags.push("possible_duplicate");

  const hardRejectFlags = new Set([
    "empty_content",
    "content_too_short",
    "missing_grounded_evidence",
    "low_confidence",
    "low_value",
    "high_risk",
    "looks_derived_from_ai_output",
    "possible_duplicate",
    "project_detail_without_project_terms",
    "project_detail_without_known_xiang_anchor",
    "personal_candidate_without_xiang_anchor",
    "speaking_style_without_expression_terms",
    "third_party_lecture_as_personal_memory",
    "unverified_date_in_content",
    "ambiguous_time_in_content",
    "question_only_evidence",
  ]);
  const valid = !flags.some((flag) => hardRejectFlags.has(flag));
  const safeToPromote = valid
    && input.candidate.candidateType === "knowledge_fact"
    && input.candidate.confidence >= 0.86
    && input.candidate.valueScore >= 0.7
    && input.candidate.riskScore <= 0.25
    && input.candidate.sensitivity !== "high"
    && !flags.includes("first_person_requires_review")
    && !flags.includes("outside_core_memory_domain_review_only");

  return {
    valid,
    safeToPromote,
    flags,
    groundedEvidence,
    duplicateMemoryRefs,
    dateMetadata,
    reason: valid
      ? safeToPromote
        ? "Grounded, high-value, low-risk candidate."
        : "Grounded candidate, but keep pending until reviewed or batch validator approves it."
      : `Rejected by validation: ${flags.join(", ")}`,
  };
}

function normalizeCandidate(candidate: Partial<SessionMemoryCandidateDraft>): SessionMemoryCandidateDraft {
  const candidateType = [
    "personal_fact",
    "preference",
    "speaking_style",
    "project_detail",
    "knowledge_fact",
    "event_summary",
    "correction",
  ].includes(String(candidate.candidateType))
    ? candidate.candidateType as SessionMemoryCandidateType
    : "event_summary";

  const sensitivity = candidate.sensitivity === "low" || candidate.sensitivity === "high" ? candidate.sensitivity : "medium";

  return {
    candidateType,
    title: String(candidate.title || "Session memory candidate").trim().slice(0, 140),
    category: String(candidate.category || candidateType).trim().slice(0, 80),
    sensitivity,
    content: String(candidate.content || "").trim(),
    usageRule: String(candidate.usageRule || "").trim().slice(0, 600),
    keywords: Array.isArray(candidate.keywords)
      ? candidate.keywords.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 16)
      : [],
    evidence: Array.isArray(candidate.evidence)
      ? candidate.evidence.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8)
      : [],
    confidence: clampUnit(candidate.confidence, 0),
    valueScore: clampUnit(candidate.valueScore, 0),
    riskScore: clampUnit(candidate.riskScore, 1),
    reason: String(candidate.reason || "").trim().slice(0, 800),
    mentionedDate: typeof candidate.mentionedDate === "string" && candidate.mentionedDate.trim() ? candidate.mentionedDate.trim().slice(0, 40) : null,
    dateSource: candidate.dateSource === "transcript" || candidate.dateSource === "inferred_from_session_time"
      ? candidate.dateSource
      : "session_time_only",
    dateConfidence: clampUnit(candidate.dateConfidence, 0.3),
    dateEvidence: Array.isArray(candidate.dateEvidence)
      ? candidate.dateEvidence.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5)
      : [],
  };
}

function buildExtractionPrompt(input: {
  userId: string;
  sessionId: string;
  sessionStartTimestamp: string;
  sessionLastTimestamp: string;
  transcriptText: string;
  aiOutputText: string;
  limitCandidates: number;
}): string {
  return `You are SayNext's local session memory extractor.

Goal:
Read a full SayNext session transcript and propose durable memory candidates.
This is a staging step only. Bad candidates can pollute retrieval, so be conservative.

Critical source rules:
- Transcript text is what ASR heard in the real session.
- AI outputs are generated by SayNext. They are NOT Xiang's real speech.
- Do not use AI outputs as evidence for personal facts, preferences, project details, or memories.
- Only save a candidate when there is clear evidence in Transcript text.
- If something is a public lecture, public video, news, movie, or third-party conversation, do not turn it into Xiang personal memory. Save it only as "knowledge_fact" if it is reusable technical/academic knowledge.
- Do not save random greetings, ASR noise, one-off jokes, or temporary meeting details unless they are useful event summaries.
- If a fact is sensitive, uncertain, or could embarrass Xiang, mark sensitivity "high" and riskScore high enough that it stays pending.

Date rules:
- eventTime is the system session start time. It is metadata, not evidence.
- mentionedDate is only for a date mentioned in transcript or a relative date that can be inferred from session time.
- If transcript does not mention a date, set mentionedDate=null, dateSource="session_time_only", dateConfidence=0.3.
- Do not write dates like "today", "recently", "on May 17", "this week", or "currently" in content unless the date is supported by transcript evidence.
- If transcript says "today/tomorrow/yesterday/next Monday", infer the concrete date from session time and set dateSource="inferred_from_session_time".
- If a date is ambiguous and cannot become a concrete date, leave it out of content.

Candidate types:
- personal_fact: stable facts about Xiang.
- preference: stable likes/dislikes/habits.
- speaking_style: reusable style correction for how SayNext should phrase replies.
- project_detail: details about Xiang's real projects or development experience.
- knowledge_fact: reusable technical/classroom/interview knowledge not tied to Xiang.
- event_summary: important session event that may help future context.
- correction: correction to previous wrong memory or output behavior.

Good candidates:
- grounded in transcript evidence
- reusable in future conversations
- concise enough for retrieval
- have keywords that match likely future questions

Bad candidates:
- "Xiang said hello"
- "The AI suggested..."
- "Maybe Xiang likes X" without direct evidence
- facts only present in AI output
- vague summaries with no future retrieval value

Return valid JSON only with this shape:
{
  "sessionSummary": "short practical summary",
  "candidates": [
    {
      "candidateType": "personal_fact | preference | speaking_style | project_detail | knowledge_fact | event_summary | correction",
      "title": "short title",
      "category": "short category",
      "sensitivity": "low | medium | high",
      "content": "memory text to store if approved",
      "usageRule": "when to use this memory; when not to use it",
      "keywords": ["future", "search", "terms"],
      "evidence": ["short quote or close paraphrase from transcript only"],
      "mentionedDate": "YYYY-MM-DD, YYYY, or null",
      "dateSource": "transcript | inferred_from_session_time | session_time_only",
      "dateConfidence": 0.0,
      "dateEvidence": ["date-related quote from transcript only"],
      "confidence": 0.0,
      "valueScore": 0.0,
      "riskScore": 0.0,
      "reason": "why this is worth saving"
    }
  ],
  "rejected": [
    { "reason": "why not saved", "evidence": "optional short quote" }
  ]
}

Limits:
- Return at most ${input.limitCandidates} candidates.
- Prefer fewer, better candidates.
- content should be 1 short paragraph, not a full transcript.

Session:
- userId: ${input.userId}
- sessionId: ${input.sessionId}
- sessionStartTimestamp: ${input.sessionStartTimestamp}
- sessionLastTimestamp: ${input.sessionLastTimestamp}

Transcript text:
${input.transcriptText}

AI outputs for quality context only, not evidence:
${input.aiOutputText || "(none)"}`;
}

export function buildSessionMemorySource(userId: string, sessionId: string, maxTranscriptChars = 50000) {
  const session = conversationLogger.getTranscriptExportSession(userId, sessionId);
  if (!session) return null;

  const events = conversationLogger.listEventsForSession(userId, sessionId);
  const samples = conversationLogger.listSamplesForSessionWindow(
    userId,
    sessionId,
    session.startTimestamp,
    session.lastTimestamp,
  );
  const transcriptText = buildTranscriptText(samples, events).slice(0, maxTranscriptChars);
  const aiOutputText = buildAiOutputText(samples).slice(0, 20000);

  return {
    session,
    events,
    samples,
    transcriptText,
    aiOutputText,
  };
}

export async function extractSessionMemoryCandidatesFromText(
  options: ExtractSessionMemoryFromTextOptions,
): Promise<ExtractSessionMemoryFromTextOutput> {
  const limitCandidates = Math.max(1, Math.min(options.limitCandidates ?? 8, 20));
  const provider = getSessionMemoryProvider(options.provider);
  const runtimeMode = getSayNextRuntimeMode();
  const batchEnabled = isSessionMemoryBatchEnabled();
  const prompt = buildExtractionPrompt({
    userId: options.userId,
    sessionId: options.sessionId,
    sessionStartTimestamp: options.sessionStartTimestamp,
    sessionLastTimestamp: options.sessionLastTimestamp,
    transcriptText: options.transcriptText,
    aiOutputText: options.aiOutputText || "",
    limitCandidates,
  });

  const response = provider === "openai"
    ? await generateOpenAiJson<SessionMemoryExtractionResult>({
      prompt,
      temperature: 0.05,
      timeoutMs: Number(process.env.SESSION_MEMORY_OPENAI_TIMEOUT_MS || 180000),
    })
    : await generateLocalJson<SessionMemoryExtractionResult>({
      prompt,
      temperature: 0.05,
      numCtx: Number(process.env.SESSION_MEMORY_OLLAMA_NUM_CTX || 12000),
      numPredict: Number(process.env.SESSION_MEMORY_OLLAMA_NUM_PREDICT || 2500),
      timeoutMs: Number(process.env.SESSION_MEMORY_OLLAMA_TIMEOUT_MS || 120000),
    });

  const existingMemories = conversationLogger.listPersonalMemories(options.userId, { status: "active", limit: 1000 });
  const rawJson = JSON.stringify(response.data);
  const candidates: ExtractedSessionMemoryCandidate[] = [];

  for (const rawCandidate of Array.isArray(response.data.candidates) ? response.data.candidates : []) {
    const candidate = normalizeCandidate(rawCandidate);
    const validation = validateCandidate({
      candidate,
      transcriptText: options.transcriptText,
      aiOutputText: options.aiOutputText || "",
      existingMemories,
      sessionStartTimestamp: options.sessionStartTimestamp,
      trustFirstPersonTranscript: options.trustFirstPersonTranscript,
    });
    candidates.push({
      candidate,
      validation,
      status: validation.valid ? "pending" : "rejected",
    });
  }

  return {
    sessionId: options.sessionId,
    model: provider === "openai" ? `openai:${response.model}` : response.model,
    provider,
    runtimeMode,
    batchEnabled,
    rawModelOutput: response.rawText,
    rawJson,
    sessionSummary: String(response.data.sessionSummary || "").trim(),
    candidates,
    rejected: Array.isArray(response.data.rejected) ? response.data.rejected : [],
  };
}

export async function extractSessionMemoryCandidates(options: ExtractSessionMemoryOptions): Promise<ExtractSessionMemoryOutput> {
  const source = buildSessionMemorySource(options.userId, options.sessionId, options.maxTranscriptChars);
  if (!source) {
    throw new Error(`Session not found: ${options.sessionId}`);
  }

  const extraction = await extractSessionMemoryCandidatesFromText({
    userId: options.userId,
    sessionId: options.sessionId,
    sessionStartTimestamp: source.session.startTimestamp,
    sessionLastTimestamp: source.session.lastTimestamp,
    transcriptText: source.transcriptText,
    aiOutputText: source.aiOutputText,
    limitCandidates: options.limitCandidates,
    trustFirstPersonTranscript: true,
  });

  const existingMemories = conversationLogger.listPersonalMemories(options.userId, { status: "active", limit: 1000 });
  const storedCandidates: SessionMemoryCandidateRecord[] = [];
  const promoted: ExtractSessionMemoryOutput["promoted"] = [];
  const rawJson = extraction.rawJson;

  conversationLogger.supersedeSessionMemoryCandidates(options.userId, options.sessionId);

  for (const extracted of extraction.candidates) {
    const { candidate } = extracted;
    const validation = validateCandidate({
      candidate,
      transcriptText: source.transcriptText,
      aiOutputText: source.aiOutputText,
      existingMemories,
      sessionStartTimestamp: source.session.startTimestamp,
      trustFirstPersonTranscript: true,
    });
    const status: SessionMemoryCandidateStatus = options.reviewAll ? "pending" : validation.valid ? "pending" : "rejected";

    const record = conversationLogger.upsertSessionMemoryCandidate({
      userId: options.userId,
      sessionId: options.sessionId,
      candidateType: candidate.candidateType,
      title: candidate.title,
      category: candidate.category,
      sensitivity: candidate.sensitivity,
      content: candidate.content,
      usageRule: candidate.usageRule,
      keywords: candidate.keywords,
      evidence: validation.groundedEvidence.length > 0 ? validation.groundedEvidence : candidate.evidence,
      confidence: candidate.confidence,
      valueScore: candidate.valueScore,
      riskScore: candidate.riskScore,
      validation: {
        ...validation,
        extractorReason: candidate.reason,
      },
      status,
      model: extraction.model,
      rawJson,
      rejectionReason: validation.valid ? "" : validation.reason,
    });

    if (!record) continue;
    storedCandidates.push(record);

    if (options.promoteSafe && validation.safeToPromote) {
      const result = conversationLogger.promoteSessionMemoryCandidate(options.userId, record.id);
      if (result) {
        promoted.push({
          candidateId: record.id,
          memoryId: result.memory.id,
          title: result.memory.title,
        });
      }
    }
  }

  return {
    sessionId: options.sessionId,
    model: extraction.model,
    provider: extraction.provider,
    runtimeMode: extraction.runtimeMode,
    batchEnabled: extraction.batchEnabled,
    rawModelOutput: extraction.rawModelOutput,
    sessionSummary: extraction.sessionSummary,
    candidates: storedCandidates,
    promoted,
  };
}
