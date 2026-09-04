import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEEPSENSE_INTERVIEW_GUIDE_ID = "deepsense-full-stack-ai-developer-2026";
export const DEEPSENSE_INTERVIEW_GUIDE_VERSION = "2026-07-23-live-v5";

const GUIDE_PATH = join(dirname(fileURLToPath(import.meta.url)), "deepsense-interview-guide.md");

export type InterviewAnswerCard = {
  id: string;
  question: string;
  guidance: string;
  exampleAnswer: string;
  section: string;
};

function compact(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "question";
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bpipe line\b/g, "pipeline")
    .replace(/\bdeep sense\b/g, "deepsense")
    .replace(/\bnarrowed down what was wrong\b/g, "found the root cause")
    .replace(/\bintegration broke\b/g, "difficult bug")
    .replace(/\s+/g, " ")
    .trim();
}

const MATCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "between", "can", "could", "difference", "do", "does", "for", "have", "how",
  "i", "in", "is", "it", "me", "of", "on", "or", "our", "the", "this", "to", "we", "what",
  "when", "why", "with", "would", "you", "your",
  "walk", "through",
]);

function terms(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((term) => term.length > 1 && !MATCH_STOP_WORDS.has(term));
}

function bigrams(value: string): Set<string> {
  const normalized = normalizeForMatch(value).replace(/\s+/g, " ");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

function diceSimilarity(left: string, right: string): number {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return 0;
  let overlap = 0;
  for (const value of leftBigrams) if (rightBigrams.has(value)) overlap += 1;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

type InterviewMatchIntent =
  | "background"
  | "company_fit"
  | "rag_design"
  | "rag_testing"
  | "rag_explain"
  | "debugging"
  | "code_walkthrough"
  | "none";

function detectMatchIntent(value: string): InterviewMatchIntent {
  const normalized = normalizeForMatch(value);
  if (/\b(?:code|function|algorithm)\b/.test(normalized) && /\b(?:walk|explain|complexity)\b/.test(normalized)) {
    return "code_walkthrough";
  }
  if (/\b(?:deep sense|deepsense|company|role|co op)\b/.test(normalized) && /\b(?:why|interested|fit|work)\b/.test(normalized)) {
    return "company_fit";
  }
  if (/\b(?:about yourself|your background|my background|introduce yourself)\b/.test(normalized)) {
    return "background";
  }
  if (/\b(?:bug|root cause|debug|broke|broken|narrowed down|what was wrong|integration failed)\b/.test(normalized)) {
    return "debugging";
  }
  const ragDomain = /\b(?:rag|retrieval augmented|retrieval pipeline)\b/.test(normalized);
  if (ragDomain && /\b(?:test|testing|evaluate|evaluation|validate|quality)\b/.test(normalized)) {
    return "rag_testing";
  }
  if (
    /\b(?:design|build|architecture|implement)\b/.test(normalized)
    && (
      ragDomain
      || (/\bchatbot\b/.test(normalized) && /\b(?:website|internal docs|internal documents|knowledge base)\b/.test(normalized))
    )
  ) return "rag_design";
  if (ragDomain && /\b(?:explain|pipeline|typical|work|works)\b/.test(normalized)) return "rag_explain";
  return "none";
}

function cardScore(query: string, question: string): number {
  const normalizedQuery = normalizeForMatch(query);
  const normalizedQuestion = normalizeForMatch(question);
  if (!normalizedQuery || !normalizedQuestion) return 0;
  if (normalizedQuery.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedQuery)) return 1;

  const queryIntent = detectMatchIntent(query);
  const questionIntent = detectMatchIntent(question);
  if (queryIntent === "code_walkthrough") return 0;
  if (queryIntent !== "none" && queryIntent !== questionIntent) return 0;

  const queryTerms = new Set(terms(query));
  const questionTerms = new Set(terms(question));
  let overlap = 0;
  for (const term of questionTerms) if (queryTerms.has(term)) overlap += 1;
  if (overlap === 0 && queryIntent === "none") return 0;
  const questionCoverage = questionTerms.size ? overlap / questionTerms.size : 0;
  const queryCoverage = queryTerms.size ? overlap / queryTerms.size : 0;
  const tokenDice = queryTerms.size + questionTerms.size
    ? (2 * overlap) / (queryTerms.size + questionTerms.size)
    : 0;
  const intentBoost = queryIntent !== "none" && queryIntent === questionIntent ? 0.3 : 0;
  const namedCompanyAdjustment = /\b(?:deep sense|deepsense)\b/.test(normalizedQuery)
    ? (/\b(?:deep sense|deepsense)\b/.test(normalizedQuestion) ? 0.16 : -0.12)
    : 0;
  return tokenDice * 0.4
    + questionCoverage * 0.2
    + queryCoverage * 0.15
    + diceSimilarity(query, question) * 0.25
    + intentBoost
    + namedCompanyAdjustment;
}

export function loadDeepSenseInterviewGuide(): string {
  return readFileSync(GUIDE_PATH, "utf8");
}

export function parseDeepSenseInterviewGuide(markdown: string): InterviewAnswerCard[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const cards: InterviewAnswerCard[] = [];
  let activeSection = "";
  let question = "";
  let body: string[] = [];

  const flush = () => {
    if (!activeSection || !question) return;
    const quoted = body
      .filter((line) => /^>\s?/.test(line))
      .map((line) => line.replace(/^>\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
    const guidance = body
      .filter((line) => !/^>\s?/.test(line) && !/^---\s*$/.test(line))
      .join("\n");
    cards.push({
      id: `${DEEPSENSE_INTERVIEW_GUIDE_ID}:${slugify(question)}`,
      question: question.trim(),
      guidance: compact(guidance).slice(0, 1800),
      exampleAnswer: compact(quoted).slice(0, 2200),
      section: activeSection,
    });
  };

  for (const line of lines) {
    const section = line.match(/^#\s+([A-J])\.\s+(.+)$/);
    if (section) {
      flush();
      question = "";
      body = [];
      activeSection = `${section[1]}. ${section[2].trim()}`;
      continue;
    }
    if (/^#\s+/.test(line)) {
      flush();
      question = "";
      body = [];
      activeSection = "";
      continue;
    }
    const heading = line.match(/^##\s+(.+)$/);
    if (activeSection && heading) {
      flush();
      question = heading[1].trim();
      body = [];
      continue;
    }
    if (activeSection && question) body.push(line);
  }
  flush();
  return cards;
}

let cachedCards: InterviewAnswerCard[] | null = null;

export function getDeepSenseInterviewCards(): InterviewAnswerCard[] {
  if (!cachedCards) cachedCards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());
  return cachedCards;
}

export function findDeepSenseInterviewCard(
  query: string,
  cards: InterviewAnswerCard[] = getDeepSenseInterviewCards(),
): InterviewAnswerCard | null {
  if (detectMatchIntent(query) === "code_walkthrough") return null;
  let best: { card: InterviewAnswerCard; score: number } | null = null;
  for (const card of cards) {
    const score = cardScore(query, card.question);
    if (!best || score > best.score) best = { card, score };
  }
  const threshold = detectMatchIntent(query) === "none" ? 0.52 : 0.45;
  return best && best.score >= threshold ? best.card : null;
}

export function buildDeepSenseInterviewSeed(
  _cards: InterviewAnswerCard[] = getDeepSenseInterviewCards(),
): string {
  return `Reusable interview answer rules:
1. Personal/fit: current background -> recent work -> concrete connection to this role.
2. Definition: plain explanation -> one example -> one limitation.
3. System design and application: clarify the important constraint -> make a concrete decision -> show the request or data flow -> handle one important failure -> explain how to verify the result.
4. Experience: actual problem -> Xiang's action -> result -> what changed afterward.
5. Comparison: choose one option for the stated scenario -> explain the decisive trade-off -> say what evidence would change the choice.
6. Debugging: reproduce -> inspect the failing boundary and evidence -> isolate the cause -> fix -> regression test.
7. Behavioral: use a real low-drama technical example; never invent a colleague, conflict, user, or production incident.

Reference-answer rule:
Reference answers are factual sources for matching questions, not scripts. Use facts from a reference answer only when the current question matches that answer's topic. When it matches, select only the facts, mechanisms, results, and limitations needed for the current question. Do not copy their opening, sentence order, transitions, or conclusion; answer the current ASR wording from scratch. Never add a project mechanism that is absent from all approved context. Never transfer a project detail, result, technology, or experience into an unrelated answer.
`.trim();
}

export function formatInterviewAnswerCard(card: InterviewAnswerCard): string {
  return [
    `[interview-answer:${card.id}] Approved interview answer context | ${card.question} | ${card.section}`,
    "This card contains approved answer direction and question-scoped facts. Use those facts only when the current question matches this card; never transfer them to another topic.",
    "The current question controls answer depth. If it asks for application, implementation, an end-to-end flow, trade-offs, or evaluation, expand beyond a simpler reference answer and include a decision, execution path, failure response, and verification.",
    card.guidance ? `Answer guidance:\n${card.guidance}` : "",
    card.exampleAnswer ? `Natural example, adapt rather than copy:\n${card.exampleAnswer}` : "",
  ].filter(Boolean).join("\n");
}
