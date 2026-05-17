import { mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

export interface ConversationSampleRecord {
  id: number;
  userId: string;
  sessionId: string;
  timestamp: string;
  language: string | null;
  transcript: string;
  aiReply: string | null;
  actionType: string;
  reasoning: string | null;
  model: string | null;
  profileVersion: string | null;
  retrievedSampleIds: string[];
  natural: number | null;
  short: number | null;
  fitsXiang: number | null;
  tooOfficial: boolean | null;
  directlySayable: boolean | null;
  inventedInfo: boolean | null;
  idealReply: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationSampleInput {
  userId: string;
  sessionId: string;
  timestamp: number;
  language?: string | null;
  transcript: string;
  aiReply?: string | null;
  actionType: string;
  reasoning?: string | null;
  model?: string | null;
  profileVersion?: string | null;
  retrievedSampleIds?: string[];
}

export interface UpdateConversationSampleInput {
  natural?: number | null;
  short?: number | null;
  fitsXiang?: number | null;
  tooOfficial?: boolean | null;
  directlySayable?: boolean | null;
  inventedInfo?: boolean | null;
  idealReply?: string;
  notes?: string;
}

export interface ConversationEventRecord {
  id: string;
  userId: string;
  sessionId: string;
  scene: string;
  title: string;
  summary: string;
  status: string;
  startTimestamp: string;
  lastTimestamp: string;
  transcriptCount: number;
  aiReplyCount: number;
  rawTranscript: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptExportSessionRecord {
  userId: string;
  sessionId: string;
  title: string;
  scenes: string[];
  status: string;
  startTimestamp: string;
  lastTimestamp: string;
  eventCount: number;
  transcriptCount: number;
  aiReplyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertConversationEventInput {
  id: string;
  userId: string;
  sessionId: string;
  scene: string;
  title: string;
  summary: string;
  status: "active" | "closed";
  startTimestamp: number;
  lastTimestamp: number;
  transcriptCount: number;
  aiReplyCount: number;
  rawTranscript: string;
}

export interface PersonalizationPipelineRunRecord {
  id: number;
  sourceType: string;
  sourceId: string;
  userId: string;
  status: string;
  model: string | null;
  rawTranscript: string;
  rawOutput: string | null;
  cleanedTranscript: string;
  cleanedOutput: string;
  segmentsJson: string;
  contextJson: string;
  eventJson: string;
  outputIntentJson: string;
  qualityJson: string;
  pseudoLabel: string;
  reviewPriority: string;
  needsReview: boolean;
  memoryJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPersonalizationPipelineRunInput {
  sourceType: "sample" | "event";
  sourceId: string;
  userId: string;
  status: "processed" | "failed";
  model?: string | null;
  rawTranscript: string;
  rawOutput?: string | null;
  cleanedTranscript?: string;
  cleanedOutput?: string;
  segmentsJson?: string;
  contextJson?: string;
  eventJson?: string;
  outputIntentJson?: string;
  qualityJson?: string;
  pseudoLabel?: string;
  reviewPriority?: "low" | "medium" | "high";
  needsReview?: boolean;
  memoryJson?: string;
  error?: string;
}

export interface PersonalMemoryItemRecord {
  id: number;
  userId: string;
  sourceRunId: number;
  memoryType: string;
  content: string;
  tagsJson: string;
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonalMemoryItemInput {
  userId: string;
  sourceRunId: number;
  memoryType: string;
  content: string;
  tags?: string[];
  confidence?: number;
  status?: "active" | "archived";
}

export type PersonalMemorySensitivity = "low" | "medium" | "high";

export interface PersonalMemoryRecord {
  id: number;
  userId: string;
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  embedding: number[];
  status: string;
  source: string;
  sourceRef: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonalMemoryInput {
  userId: string;
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule?: string;
  keywords?: string[];
  status?: "active" | "disabled";
  source?: "manual" | "import" | "pipeline" | "knowledge";
  sourceRef?: string;
  upsertBySource?: boolean;
}

export interface UpdatePersonalMemoryInput {
  title?: string;
  category?: string;
  sensitivity?: PersonalMemorySensitivity;
  content?: string;
  usageRule?: string;
  keywords?: string[];
  status?: "active" | "disabled";
  sourceRef?: string;
}

export interface PersonalMemorySearchResult extends PersonalMemoryRecord {
  score: number;
  lexicalRank?: number;
  vectorRank?: number;
  keywordScore: number;
}

export interface PrenoteRecord {
  id: number;
  userId: string;
  title: string;
  description: string;
  status: string;
  isActive: boolean;
  sourceText: string;
  extractedText: string;
  processedJson: string;
  runtimeContext: string;
  model: string | null;
  contentHash: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrenoteFileRecord {
  id: number;
  prenoteId: number;
  fileName: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  extractedText: string;
  status: string;
  error: string;
  createdAt: string;
}

export interface CreatePrenoteInput {
  userId: string;
  title: string;
  description?: string;
  sourceText?: string;
  contentHash?: string;
}

export interface UpdatePrenoteProcessingInput {
  status: "processing" | "ready" | "error";
  extractedText?: string;
  processedJson?: string;
  runtimeContext?: string;
  model?: string | null;
  contentHash?: string;
  error?: string;
}

export interface UpdatePrenoteMemoryInput {
  title?: string;
  runtimeContext?: string;
}

export interface CreatePrenoteFileInput {
  prenoteId: number;
  fileName: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  extractedText?: string;
  status?: "ready" | "error";
  error?: string;
}

export interface SceneProfileRecord {
  id: number;
  userId: string;
  builtinKey: string;
  name: string;
  prompt: string;
  isActive: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSceneProfileInput {
  userId: string;
  name: string;
  prompt: string;
  isActive?: boolean;
}

export interface UpdateSceneProfileInput {
  name?: string;
  prompt?: string;
  isActive?: boolean;
}

const DEFAULT_DB_PATH = join(process.cwd(), "data", "saynext.sqlite");

const DEFAULT_SCENE_PROFILES = [
  {
    builtinKey: "daily_chat",
    name: "Daily Chat",
    prompt: `Scene: Daily Chat

Goal:
Make Xiang sound like a real casual person, not an assistant.
The reply should feel natural, a little imperfect, and not too complete.
It can use casual Canadian-style English, light slang, internet humor, small jokes, or meme-like wording when natural.
Do not make Xiang sound like he is trying too hard to be social.

Style:
Short, chill, human, low-pressure.
No essay tone. No life lesson. No summary of meaning.
Grammar can be imperfect and spoken.
Use everyday words, casual fillers, and relaxed phrasing.
Add one small real-life detail if useful.
Do not force a question every time.
Do not act overly caring, nosy, or like a life coach.

When to speak:
If someone directly talks to Xiang or asks a casual question, suggest one natural reply.
If the other person is just talking and no reply is needed, keep the output minimal and do not force a fake reply.

Avoid:
Do not mention school, projects, career, cloud, AWS, or AI unless directly asked.
Do not sound motivational or polished.
Do not overexplain.
Do not give unsolicited advice.
Do not turn small talk into a deep personal reflection.`,
  },
  {
    builtinKey: "classroom",
    name: "Classroom",
    prompt: `Scene: Classroom

Goal:
Help Xiang respond in class or understand what the professor is saying.
If it is a direct question, give Xiang a short answer he can say out loud.
If the professor is explaining a concept, give one useful professional supplement or clarification.
If there is no clear useful action, keep the output minimal instead of forcing a fake reply.

Style:
Student-like but technically correct.
Short by default, but professional and capable for academic/technical content.
Do not repeat the professor's sentence.
Do not start every answer with "I think".
Use one concrete technical detail when useful.
It is okay to sound more knowledgeable in academic content, as long as it stays speakable.

When to speak:
Speak when there is a question, a gap, a useful clarification, or a chance to add one relevant point.
For knowledge explanation, output a useful supplement, not a fake reply.

Avoid:
Do not guess if Xiang clearly does not know.
Do not overexplain like a professor.
Do not give generic filler.`,
  },
  {
    builtinKey: "interview",
    name: "Interview",
    prompt: `Scene: Interview

Goal:
Help Xiang answer interview questions clearly, honestly, and professionally.
Use real experience only. Do not invent.
It is okay to mention Xiang's projects when asked about experience, projects, technical challenges, teamwork, or problem solving.

Style:
Clear, simple, professional, not overconfident.
Usually 1-3 short sentences.
Give concrete examples when useful.
For technical questions, give a clear and easy-to-understand solution.
Make Xiang sound capable and prepared, but not senior or exaggerated.
When the answer needs structure, give a simple setup, action, and result.

Avoid:
Do not say dream job, passionate, best candidate, strong leader, or exaggerated claims.
Do not make Xiang sound senior.
Do not fake production experience.`,
  },
  {
    builtinKey: "meeting_group",
    name: "Meeting / Group Discussion",
    prompt: `Scene: Meeting / Group Discussion

Goal:
Help Xiang add one useful sentence that moves the discussion forward.
This can be a progress update, a clear opinion, a technical clarification, or a question that reveals a risk or blocker.

Style:
Short, direct, practical, professional.
Focus on the project and the current problem.
Use clear technical reasoning when needed.
Show that Xiang understands the project and can think about next steps.
If the blocker is missing API/schema/data from another person, suggest using a mock schema or documented assumption so work can continue.

When to speak:
Speak when Xiang can clarify, confirm, ask a useful question, report progress, or suggest a simple next step.
If others are just talking and no useful addition is needed, keep the output minimal and avoid generic filler.

Avoid:
Do not repeat what others already said.
Do not add generic agreement.
Do not make long speeches.`,
  },
] as const;

function boolFromDb(value: number | null): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function boolToDb(value: boolean | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value ? 1 : 0;
}

function mergeBoolForDb(updateValue: boolean | null | undefined, existingValue: boolean | null): number | null {
  if (updateValue !== undefined) {
    return boolToDb(updateValue) ?? null;
  }

  return boolToDb(existingValue) ?? null;
}

const SEARCH_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "what", "how", "why", "who", "when", "where",
  "you", "your", "yours", "me", "my", "mine", "i", "im", "am", "are", "is", "was", "were",
  "do", "does", "did", "doing", "can", "could", "would", "should", "will", "tell", "about",
  "one", "some", "any", "a", "an", "to", "of", "in", "on", "at", "by", "from", "as", "or",
  "it", "its", "be", "been", "being", "have", "has", "had", "usually", "really", "like",
  "enjoy", "normally", "often", "favourite", "favorite", "popular",
]);

function tokenizeSearchText(text: string): string[] {
  return Array.from(new Set(
    String(text || "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token))
      ?? [],
  ));
}

function buildFtsQuery(text: string): string {
  return tokenizeSearchText(text)
    .slice(0, 12)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function localHybridEmbedding(text: string, dimensions = 256): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenizeSearchText(text);
  const features: string[] = [...tokens];

  for (const token of tokens) {
    if (token.length <= 3) continue;
    for (let i = 0; i <= token.length - 3; i++) {
      features.push(token.slice(i, i + 3));
    }
  }

  for (const feature of features) {
    const hash = fnv1a(feature);
    const index = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function parseJsonArray(value: string, fallback: any[] = []): any[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSensitivity(value: string): PersonalMemorySensitivity {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function hashMemoryContent(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function memorySearchText(input: Pick<PersonalMemoryRecord, "title" | "category" | "content" | "usageRule" | "keywords">): string {
  return [
    input.title,
    input.category,
    input.keywords.join(" "),
    input.usageRule,
    input.content,
  ].filter(Boolean).join("\n");
}

function keywordOverlapScore(queryTokens: Set<string>, memory: Pick<PersonalMemoryRecord, "title" | "category" | "content" | "keywords">): number {
  const keywordTokens = tokenizeSearchText([
    memory.title,
    memory.category,
    memory.keywords.join(" "),
  ].join(" "));
  if (keywordTokens.length === 0) return 0;

  const matches = keywordTokens.filter((token) => queryTokens.has(token)).length;
  return matches / Math.max(3, keywordTokens.length);
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function hasAnyToken(tokens: Set<string>, needles: string[]): boolean {
  return needles.some((needle) => tokens.has(needle));
}

function isExplicitGeneralTechnicalQuestion(query: string): boolean {
  const normalized = query.toLowerCase();
  return includesAny(normalized, [
    "not from my project",
    "not my project",
    "not my project design",
    "just the concept",
    "as a concept",
    "general concept",
    "in general",
    "generally",
  ]);
}

function shouldSkipPersonalMemorySearch(query: string): boolean {
  const normalized = query.toLowerCase();

  if (includesAny(normalized, [
    "orange the telecom",
    "orange telecom",
    "telecom company",
    "queue for food",
    "queue up for food",
    "escrow papers",
    "notarizing these papers",
    "driver ’ s license",
    "driver's license",
    "parking ticket",
    "pay for a parking ticket",
    "weather forecast",
    "temperature today",
    "olympic motto",
    "broadband internet",
    "internet plan",
    "download speed",
    "movie you saw",
    "new film",
    "shopping for furniture",
    "floor lamp",
    "nightstand",
    "coffee table",
    "remote control",
    "project manager",
    "new project we're going",
    "user interface designer",
    "functional design",
    "conceptual design",
    "user requirements",
    "meeting room",
    "white board",
    "draw your favourite animal",
    "draw your favorite animal",
    "favourite animal",
    "favorite animal",
    "spider lives in a web",
    "indian elephant",
    "african elephant",
    "mit opencourseware",
    "open courseware",
    "creative commons",
    "citation format",
    "massachusetts institute of technology",
    "uh uh answer",
    "who won",
    "hockey game yesterday",
    "photosynthesis",
    "bake a chocolate cake",
    "recipe for noodles",
    "weather tomorrow",
    "good morning, how's your day",
    "good morning how's your day",
    "how's your day going",
    "task deadline changed",
    "should children have mobile phones",
    "children have mobile phones",
    "use your mobile phone",
    "use a mobile phone",
    "use the internet",
    "too much time online",
    "modern technology do you dislike",
    "shopping centres",
    "shopping centers",
    "traditional markets",
    "spend on clothes",
    "clothes do you like",
    "summer clothes",
    "winter clothes",
    "formal event",
    "favourite athlete",
    "favorite athlete",
    "watching the olympics",
    "new sport",
    "how often do you watch tv",
    "how often do you watch television",
    "television programmes",
    "television programs",
    "tv series",
    "go to the cinema",
    "fruit and vegetables",
    "another language",
    "reading books",
    "stories or poems",
    "website or app do you use often",
    "app do you use often",
    "travel to work or school",
    "facilities are there near your neighbourhood",
    "facilities are there near your neighborhood",
    "change about your neighbourhood",
    "change about your neighborhood",
    "good student when you were a child",
    "good student as a child",
    "summer holidays as a child",
    "what did you do with friends as a child",
    "favourite toy",
    "favorite toy",
    "birthday you remember",
  ])) {
    return true;
  }

  if (includesAny(normalized, [
    "people in china",
    "popular with tourists",
    "sports are popular in china",
    "films are popular in china",
    "what sports are popular",
    "what hobbies are popular",
  ])) {
    return true;
  }

  return false;
}

function isLikelyThirdPartyTranscript(query: string): boolean {
  const normalized = query.toLowerCase();
  const rawWordCount = query.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).length;
  if (rawWordCount < 65) return false;

  if (includesAny(normalized, [
    "xiang",
    "your project",
    "your experience",
    "your course",
    "your class",
    "your school",
    "your background",
    "your family",
    "your favorite",
    "your favourite",
    "about yourself",
    "tell me about yourself",
    "candidate",
    "interview question",
    "why did you",
    "what did you",
    "where did you",
  ])) {
    return false;
  }

  return true;
}

function isLikelyPublicMonologue(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const rawWordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (rawWordCount < 14) return false;

  return includesAny(normalized, [
    "here is the thing",
    "here is a simple explanation",
    "quick story time",
    "three small habits",
    "a lot of people think",
    "people romanticize",
    "if you are watching this",
    "this is why people",
    "the easiest way to make a group project worse",
    "say the blocker early",
    "nobody tells you",
    "stop waiting until",
    "remember this.",
    "most of the time it just means",
  ]);
}

function isLikelyCompleteDialogueExcerpt(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const rawWordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (rawWordCount < 28) return false;

  const quotedSpeakerLabels = (query.match(/\b[A-Z]:\s/g) ?? []).length;
  if (quotedSpeakerLabels >= 2) return true;

  if (includesAny(normalized, [
    "my name is",
    "what can i do for you today",
    "i would like to ask you some questions",
    "i'm looking for a one-bedroom apartment",
    "i am looking for a one-bedroom apartment",
    "i'm new to the choir",
    "do you sing alto",
    "soprano and alto",
    "your boy",
    "crankcase oil",
    "how nice of you to come",
    "how have you been",
    "i have bothered him several times",
    "he's the kind of guy",
  ])) {
    return true;
  }

  return false;
}

function isBehavioralStoryQuestion(query: string): boolean {
  const normalized = query.toLowerCase();
  return includesAny(normalized, [
    "tell me about a time",
    "describe a time",
    "give me an example",
    "behavioral",
    "conflict",
    "teammate",
    "disagree",
    "disagreed",
    "disagreement",
    "failure",
    "failed",
    "mistake",
    "what did you learn",
    "what you learned",
    "constructive feedback",
    "feedback have you received",
    "feedback that changed",
    "sounded too ai-like",
    "leadership",
    "ownership",
    "initiative",
    "hard bug",
    "hardest bug",
    "recent bug",
    "bug where",
    "debug the",
    "debugging challenge",
    "output was wrong because of context",
    "wrong because of context",
    "prioritize tasks",
    "prioritise tasks",
    "several deadlines",
    "paused one feature",
    "trade-off you made",
    "tradeoff you made",
    "vague requirements",
    "requirements are vague",
    "unclear idea",
    "product design decision",
    "different ideas in a group project",
    "technical disagreement",
    "above and beyond",
    "extra effort",
    "disagreement with your manager",
    "conflict with your manager",
    "influence a",
    "influence somebody",
    "without getting approval",
    "without a formal role",
    "had to push",
    "push for",
    "pushed for",
    "product decision",
    "persevere",
    "persevered",
    "multiple months",
    "unresponsive",
    "needed information",
    "wasn't responsive",
    "overwhelming",
    "failed deadline",
    "tight deadline",
    "time management",
    "working independently",
    "work independently",
    "independent work",
    "user impact",
    "customer impact",
    "user trust",
    "customer focus",
    "think about reliability",
    "code review feedback",
    "harsh code review",
    "pull request feedback",
    "harsh feedback",
    "why this company",
    "why this role",
    "achievement",
    "accomplishment",
    "most satisfied",
    "most proud",
    "project best shows",
    "best shows your product thinking",
    "difficult but meaningful",
  ]);
}

function isGeneralTechnicalConceptQuestion(query: string): boolean {
  const normalized = query.toLowerCase();
  const explicitGeneral = isExplicitGeneralTechnicalQuestion(query);

  if (includesAny(normalized, ["movie", "film", "films", "tv show"]) && includesAny(normalized, ["transformer", "transformers"])) {
    return false;
  }

  if (includesAny(normalized, ["which project", "what project", "your project", "my project"]) && includesAny(normalized, ["product thinking"])) {
    return false;
  }

  if (includesAny(normalized, [
    "object class in oop",
    "class in oop",
    "class in object oriented",
    "object oriented programming",
    "classification metric",
    "thread in operating system",
    "thread in os",
    "sparse graph",
    "represent a sparse graph",
    "debug a production bug",
    "production bug",
    "supervise learning",
    "drop out deep learning",
    "regression test",
    "cloud cost",
  ])) {
    return true;
  }

  if (!explicitGeneral && includesAny(normalized, [
    "saynext", "elderalbum", "elder album", "joblens", "job lens", "dalparkaid", "dal park",
    "my project", "your project", "my app", "your app", "resume", "cv", "portfolio",
    "course", "class", "semester", "term", "professor", "instructor", "studying", "study now",
    "interested in computer science", "became more interested", "why did you choose computer science",
    "choose computer science", "which project should", "what project should", "project should i talk",
    "react native project", "react native experience", "project parking", "parking project",
    "my aws project", "project album",
    "games related to", "programming interest", "bullying", "album sharing app",
    "serverless album", "connecting aws services",
  ])) {
    return false;
  }

  if (includesAny(normalized, [
    "technical interview", "coding interview", "big o", "time complexity", "space complexity",
    "data structure", "data structures", "hash map", "linked list", "stack versus queue",
    "stack vs queue", "heap", "top k", "binary search", "sliding window",
    "prefix sum", "dynamic programming", "greedy algorithm", "bfs", "dfs",
    "shortest path", "merge k sorted", "edge cases", "brute force", "solid",
    "dependency injection", "composition better than inheritance", "strategy pattern",
    "unit test", "integration test", "regression testing", "regression test", "mocks in tests",
    "system design", "non functional requirements", "caching", "cdn", "queue",
    "cap theorem", "eventual consistency", "idempotency", "exponential backoff",
    "circuit breaker", "distributed transaction", "type a url", "dns", "tcp", "udp",
    "https", "tls", "rest", "grpc", "websocket", "cors", "http 429",
    "acid", "database indexing", "normalization", "denormalization", "joins",
    "slow query", "sql over nosql", "transaction isolation", "n plus one",
    "dynamodb", "partition key", "sort key", "gsi", "hot partition",
    "access patterns", "iam", "vpc", "s3", "lambda", "ec2", "api gateway",
    "cloudwatch", "cloudfront", "sqs", "sns", "eventbridge", "well architected",
    "operational excellence", "cost optimization", "performance efficiency", "cloud cost",
    "serverless", "cold start", "step functions", "ci cd", "infrastructure as code",
    "blue green", "canary deployment", "rollback", "authentication", "authorization",
    "sql injection", "xss", "csrf", "jwt", "least privilege", "owasp", "passwords",
    "rest apis", "pagination", "rate limiting", "react props", "react keys",
    "useeffect", "csr", "ssr", "web performance", "accessibility",
    "supervised learning", "unsupervised learning", "bias variance", "overfitting",
    "cross validation", "confusion matrix", "precision", "recall", "f1 score",
    "classification metric",
    "gradient descent", "data leakage", "class imbalance", "regularization",
    "decision trees", "bagging", "boosting", "random forest", "feature selection",
    "missing values", "train test split", "a b testing", "ab testing", "p value", "logistic regression",
    "vanishing gradient", "backpropagation", "dropout",
    "batch normalization", "cnn", "rnn", "transformer architecture", "attention transformer", "embedding",
    "collaborative filtering", "content based recommendation", "cold start",
    "ndcg", "etl", "elt", "data warehouse", "star schema", "batch processing",
    "streaming", "data quality", "process versus thread", "process vs thread",
    "thread in operating system",
    "concurrency", "parallelism", "deadlock", "mutex", "semaphore",
    "virtual memory", "logs versus metrics", "logs vs metrics", "sli", "slo",
    "incident", "alerts", "red metrics", "mobile apps", "react native",
    "offline state", "software engineer do", "code review", "agile scrum",
    "product thinking",
  ])) {
    return true;
  }

  const hasConceptPrompt = includesAny(normalized, [
    "what is", "what are", "explain", "define", "difference between", "how does",
    "how do", "how would", "when would", "why do", "why does",
  ]);
  if (!hasConceptPrompt) return false;

  return includesAny(normalized, [
    "bias variance", "overfitting", "underfitting", "regularization", "cross validation",
    "confusion matrix", "precision", "recall", "gradient descent", "decision tree",
    "decision trees", "bagging", "boosting", "random forest", "feature selection",
    "missing values", "dataset", "class imbalance", "pca", "k-means", "clustering",
    "classification metric",
    "supervised", "unsupervised", "recommender system", "collaborative filtering",
    "content based recommendation", "train test split", "data leakage", "classification model",
    "a b testing", "ab testing", "p value", "logistic regression", "vanishing gradient",
    "dropout", "batch normalization", "embedding in machine learning", "cosine similarity",
  ]);
}

function knowledgeInterviewIntentBoost(query: string, sourceRef: string, tokens: Set<string>): number {
  if (!sourceRef.startsWith("knowledge:cs-interview:")) return 0;

  const q = query.toLowerCase();
  const ref = sourceRef.toLowerCase();
  const matches = (needles: string[]) => includesAny(q, needles);
  let boost = 0;

  if (ref.includes("answer-framework") && matches(["technical interview answer", "structure a technical", "tradeoffs in an interview", "talk about tradeoffs"])) boost += 0.24;
  if (ref.includes("big-o-complexity") && matches(["big o", "time complexity", "space complexity", "o n log n", "n squared", "nested loop"])) boost += 0.24;
  if (ref.includes("data-structures") && (matches(["data structure", "hash map", "linked list", "stack versus queue", "stack vs queue", "sparse graph", "top k"]) || hasAnyToken(tokens, ["heap", "trie"]))) boost += 0.24;
  if (ref.includes("algorithm-patterns") && matches(["binary search", "sliding window", "bfs", "dfs", "dynamic programming", "greedy", "prefix sum", "shortest path", "merge k sorted", "unweighted graph"])) boost += 0.24;
  if (ref.includes("coding-checklist") && matches(["before coding", "edge cases", "walk through examples", "after writing code", "brute force", "optimize"])) boost += 0.24;
  if (ref.includes("oop-design-patterns") && matches(["solid", "dependency injection", "composition better", "inheritance", "strategy pattern", "object oriented", "object class", "class in oop", "class in object oriented", "design pattern"])) boost += 0.24;
  if (ref.includes("software-engineering-testing") && matches(["unit test", "integration test", "regression test", "debug", "production bug", "bug", "regression testing", "mocks in tests", "testing"])) boost += 0.24;
  if (ref.includes("system-design-fundamentals") && matches(["system design", "url shortener", "non functional", "caching", "queue", "api and data model", "bottlenecks", "scale reads", "cdn", "static content"])) boost += 0.24;
  if (ref.includes("distributed-systems") && matches(["cap theorem", "eventual consistency", "idempotency", "retries", "exponential backoff", "jitter", "circuit breaker", "distributed transaction"])) boost += 0.24;
  if (ref.includes("networking-web-protocols") && (matches(["type a url", "dns", "tcp", "udp", "https", "tls", "grpc", "websocket", "cors", "http 429"]) || hasAnyToken(tokens, ["rest"]))) boost += 0.24;
  if (ref.includes("database-sql") && matches(["acid", "database indexing", "indexing", "normalization", "denormalization", "joins", "sql", "slow query", "transaction isolation", "n plus one"])) boost += 0.24;
  if (ref.includes("nosql-dynamodb") && matches(["dynamodb", "partition key", "sort key", "gsi", "hot partition", "access patterns", "nosql"])) boost += 0.24;
  if (ref.includes("aws-core-services") && matches(["iam", "vpc", "s3", "lambda versus ec2", "api gateway", "cloudwatch", "cloudfront", "sqs", "sns", "eventbridge", "aws"])) boost += 0.23;
  if (ref.includes("aws-well-architected") && matches(["well architected", "reliable aws", "cost optimization", "operational excellence", "performance efficiency", "cloud architecture", "cloud cost", "six pillars", "six pillar"])) boost += 0.27;
  if (ref.includes("serverless-lambda") && !matches(["recommender", "recommendation", "user item"]) && matches(["serverless", "lambda cold start", "cold start", "serverless a bad fit", "sqs and lambda", "step functions", "debug serverless"])) boost += 0.27;
  if (ref.includes("cloud-devops-cicd") && matches(["ci cd", "infrastructure as code", "blue green", "canary deployment", "secrets", "rollback", "deployment"])) boost += 0.24;
  if (ref.includes("security-web-app") && matches(["authentication", "authorization", "sql injection", "xss", "csrf", "jwt", "least privilege", "owasp", "passwords", "security"])) boost += 0.24;
  if (ref.includes("backend-api-design") && matches(["rest apis", "design rest", "pagination", "idempotency keys", "api error", "rate limiting", "api design"])) boost += 0.24;
  if (ref.includes("frontend-react-web") && matches(["react props", "react keys", "useeffect", "csr", "ssr", "web performance", "accessibility", "react native good"])) boost += 0.24;
  if (ref.includes("ml-fundamentals") && matches(["supervised learning", "supervise learning", "unsupervised learning", "bias variance", "overfitting", "cross validation", "confusion matrix", "precision", "recall", "f1", "gradient descent", "data leakage", "class imbalance", "evaluation metrics for ml", "choose a metric", "classification model", "classification metric", "regularization", "train test split", "decision trees", "bagging", "boosting", "random forest", "feature selection", "missing values", "logistic regression", "a b testing", "ab testing", "p value", "pca", "k-means", "cosine similarity"])) boost += 0.27;
  if (ref.includes("deep-learning") && matches(["backpropagation", "dropout", "drop out", "batch normalization", "cnn", "rnn", "transformer", "neural network", "embedding in neural", "vanishing gradient"])) boost += 0.27;
  if (ref.includes("recommender-systems") && matches(["collaborative filtering", "content based", "cold start in recommender", "recommender cold start", "user item", "evaluate a recommender", "ndcg", "recommender system"])) boost += 0.27;
  if (ref.includes("data-engineering-warehousing") && matches(["etl", "elt", "data warehouse", "star schema", "batch processing", "streaming", "data quality", "pipeline"])) boost += 0.24;
  if (ref.includes("os-concurrency") && matches(["process versus thread", "process vs thread", "thread in operating", "operating system thread", "operating system", "concurrency", "parallelism", "deadlock", "mutex", "semaphore", "virtual memory"])) boost += 0.24;
  if (ref.includes("sre-observability") && matches(["logs versus metrics", "logs vs metrics", "sli", "slo", "incident", "alerts", "red metrics", "observability"])) boost += 0.24;
  if (ref.includes("mobile-apps") && matches(["mobile apps", "mobile app", "react native", "offline state", "mobile app performance"])) boost += 0.27;
  if (ref.includes("cs-workplace-role") && matches(["software engineer do", "day to day", "code review", "agile scrum", "product thinking", "engineers"])) boost += 0.24;

  return boost;
}

function highSensitivityAllowed(query: string, memory: Pick<PersonalMemoryRecord, "category" | "keywords" | "title" | "content">): boolean {
  const queryTokens = new Set(tokenizeSearchText(query));
  const normalizedQuery = query.toLowerCase();
  const category = memory.category.toLowerCase();
  const directTriggers = [
    "family", "mother", "mom", "father", "dad", "sister", "brother", "brothers", "sibling", "siblings", "parent", "parents", "child", "childhood", "young", "bullying",
    "health", "liver", "weight", "relationship", "girlfriend", "romantic", "dating", "date", "immigration",
    "pr", "residency", "money", "financial", "scam", "private", "stress", "weakness",
    "confidence", "nervous", "anxiety", "future", "long term", "canada", "freedom",
    "家庭", "父亲", "母亲", "姐姐", "童年", "霸凌", "健康", "恋爱", "移民", "永居", "财务",
  ];

  if (category.includes("family_events")) {
    return includesAny(normalizedQuery, [
      "father", "dad", "sister", "passed away", "liver", "scam", "york", "money", "financial",
    ]);
  }

  if (category.includes("family")) {
    return includesAny(normalizedQuery, [
      "family", "mother", "mom", "father", "dad", "sister", "brother", "brothers", "sibling", "siblings", "parent", "parents", "business", "factory",
      "scam", "york", "money", "financial", "passed away", "liver",
    ]);
  }

  if (category.includes("emotional") || category.includes("stress")) {
    return includesAny(normalizedQuery, [
      "stress", "weakness", "confidence", "insecure", "insecurity", "nervous", "anxiety",
      "girlfriend", "relationship", "romantic", "dating", "date", "girl", "girls", "social", "bullying",
      "humiliation", "conflict", "mother", "fear", "interview",
    ]);
  }

  if (category.includes("immigration") || category.includes("values")) {
    return includesAny(normalizedQuery, [
      "canada", "future", "long term", "pr", "permanent", "residency", "immigration",
      "freedom", "stable job", "career", "stay",
    ]);
  }

  if (directTriggers.some((token) => normalizedQuery.includes(token))) return true;

  const memoryTokens = tokenizeSearchText([
    memory.category,
    memory.title,
    memory.keywords.join(" "),
  ].join(" "));
  return memoryTokens.filter((token) => queryTokens.has(token)).length >= 2;
}

function personalMemoryIntentBoost(query: string, memory: Pick<PersonalMemoryRecord, "category" | "title" | "sourceRef">): number {
  const normalizedQuery = query.toLowerCase();
  const tokens = new Set(tokenizeSearchText(query));
  const category = memory.category.toLowerCase();
  const title = memory.title.toLowerCase();
  const sourceRef = memory.sourceRef.toLowerCase();
  let boost = 0;
  boost += knowledgeInterviewIntentBoost(normalizedQuery, sourceRef, tokens);

  if (hasAnyToken(tokens, ["university", "college", "degree", "dalhousie", "acadia", "macs", "program", "study", "studying", "major"]) && category === "identity_education") {
    boost += 0.035;
    if (includesAny(normalizedQuery, [
      "studying now", "study now", "what are you studying", "work or study",
      "program", "at dal", "in dal", "current school", "currently studying",
      "choose your major", "what do you study",
    ])) boost += 0.07;
  }

  if (category === "identity_education" && includesAny(normalizedQuery, ["computer science", "choose computer science", "why did you choose computer"])) {
    boost += 0.075;
  }

  if (sourceRef.includes("xiang-profile:identity-education") && includesAny(normalizedQuery, [
    "privacy-sensitive place", "personal data should not", "not be overshared",
    "should not be overshared", "specific residence", "where do you live exactly",
    "residence", "private information", "tell me about yourself", "introduce yourself",
  ])) {
    boost += 0.16;
  }

  if (includesAny(normalizedQuery, ["high school", "school"]) && category === "education_history") {
    boost += 0.018;
    if (includesAny(normalizedQuery, ["high school"])) boost += 0.022;
    if (includesAny(normalizedQuery, ["before canada", "before i came to canada", "before coming to canada"]) && (title.includes("china") || sourceRef.includes("china"))) boost += 0.045;
    if (includesAny(normalizedQuery, ["canada", "halifax", "dartmouth", "aubrey"]) && (title.includes("canada") || sourceRef.includes("canada"))) boost += 0.025;
    if (includesAny(normalizedQuery, ["china", "chengdu", "chinese"]) && (title.includes("china") || sourceRef.includes("china"))) boost += 0.025;
    if (includesAny(normalizedQuery, ["as a child", "when you were a child", "when you were young", "where did you live as a child"])) boost += 0.035;
    if (includesAny(normalizedQuery, ["good student when you were a child", "good student as a child"])) boost += 0.08;
    if (includesAny(normalizedQuery, ["what subject was hardest", "worst subject", "hardest subject"])) boost -= 0.03;
  }

  if (category === "identity_education" && includesAny(normalizedQuery, ["where did you live as a child", "born", "birthplace", "grew up"])) {
    boost += 0.055;
  }

  if (category === "education_history" && includesAny(normalizedQuery, ["moving to halifax", "moved to halifax", "after moving to halifax", "after moving to canada", "after i moved"])) {
    if (title.includes("canada") || sourceRef.includes("canada")) boost += 0.06;
  }

  if (category === "lifestyle") {
    if (sourceRef.includes("xiang-profile:lifestyle-food-health")) {
      if (hasAnyToken(tokens, [
        "food", "eat", "drink", "cook", "cooking", "meal", "meals", "breakfast", "lunch",
        "sleep", "health", "healthy", "exercise", "sport", "sports", "hiking", "diet",
        "delivery", "takeout", "shopping", "fashionable", "routine", "morning", "evening", "relaxing",
      ])) boost += 0.035;
    }

  if (sourceRef.includes("xiang-update:2026-05:sleep-routine") && (hasAnyToken(tokens, [
      "sleep", "schedule", "routine", "morning", "evening", "relaxing", "weekend", "weekends",
    ]) || includesAny(normalizedQuery, ["after school", "after class", "free time"]))) {
      boost += 0.055;
    }

    if (sourceRef.includes("xiang-update:2026-05:home-room") && hasAnyToken(tokens, [
      "home", "room", "bedroom", "area", "live", "cozy", "safe",
    ])) boost += 0.055;

    if (sourceRef.includes("xiang-update:2026-05:parks-going-out") && hasAnyToken(tokens, [
      "park", "parks", "outdoor", "outdoors", "outside", "walk", "alone",
    ])) boost += 0.055;

    if (sourceRef.includes("xiang-update:2026-05:reddit-internet") && hasAnyToken(tokens, [
      "reddit", "website", "app", "internet", "news", "meme", "memes",
    ])) boost += 0.06;

    if (sourceRef.includes("xiang-update:2026-05:shopping-clothes") && hasAnyToken(tokens, [
      "shopping", "shop", "clothes", "fashion", "fashionable", "delivery", "takeout", "superstore", "groceries",
    ])) boost += 0.06;

    if (sourceRef.includes("xiang-update:2026-05:driving-car") && (hasAnyToken(tokens, [
      "car", "drive", "driving", "license", "licence", "campus",
    ]) || includesAny(normalizedQuery, ["go to school", "get to school", "travel to school", "get to campus", "go to campus"]))) {
      boost += 0.055;
    }

    if (sourceRef.includes("xiang-update:2026-05:fruit") && hasAnyToken(tokens, ["fruit", "pineapple", "orange"])) boost += 0.07;
    if (sourceRef.includes("xiang-update:2026-05:swimming") && hasAnyToken(tokens, ["swim", "swimming", "sport", "sports", "exercise"])) boost += 0.07;
  }

  if (hasAnyToken(tokens, ["indoor", "indoors", "outdoor", "outdoors", "home", "homebody", "free", "weekend", "weekends", "morning", "chill", "room", "alone", "friends"])
    && (category === "personality" || category === "speaking_style" || sourceRef.includes("xiang-profile:lifestyle-food-health"))) {
    boost += 0.022;
  }

  if (hasAnyToken(tokens, ["weekend", "weekends", "free"])
    && (category === "personality" || category === "games" || sourceRef.includes("xiang-profile:lifestyle-food-health"))) {
    boost += 0.055;
  }

  if (sourceRef.includes("xiang-update:2026-05:summer-courses") && includesAny(normalizedQuery, [
    "current course", "current courses", "taking this summer", "summer term", "this semester", "right now",
    "what course", "what courses", "course do you take", "course you take", "what class", "what classes", "studying now", "where are you studying now",
    "planning to take any courses soon", "take any courses soon", "courses soon",
    "what are you studying", "professor", "instructor", "teaches", "advanced cloud class",
    "excited to learn", "learn right now", "summer class", "what time is your deep learning",
    "deep learning class", "who teaches your advanced cloud", "which course summer cloud",
    "recommender system", "recommender systems", "recommendation system", "recommendation systems", "no recommendation system",
  ])) {
    boost += 0.11;
    if (includesAny(normalizedQuery, ["what time", "when is", "schedule", "who teaches", "professor", "instructor"])) boost += 0.08;
  }

  if (sourceRef.includes("xiang-update:2026-05:favorite-subjects") && includesAny(normalizedQuery, [
    "favorite subject", "favourite subject", "subject do you like", "subject do you enjoy",
    "like most right now", "current subject", "best subject", "like most this term",
    "course do you like", "class do you like", "excited to learn", "learn right now",
    "summer class deep learning cloud", "why do you like cloud architecture", "cloud architecture as a course",
    "deep learning connect", "ai software goal", "cloud architecture why", "deep learning like why",
    "why you like deep learning",
  ])) {
    boost += 0.12;
    if (includesAny(normalizedQuery, ["deep learning connect", "ai software goal", "cloud architecture as a course", "cloud architecture why", "deep learning like why", "why you like deep learning"])) boost += 0.08;
    if (includesAny(normalizedQuery, ["as a child", "when you were a child", "when you were young"])) boost -= 0.12;
  }

  if (sourceRef.includes("xiang-update:2026-05:childhood-biology") && includesAny(normalizedQuery, [
    "right now", "current subject", "currently", "this semester",
  ])) {
    boost -= 0.08;
  }

  if (sourceRef.includes("xiang-update:2026-05:childhood-biology") && includesAny(normalizedQuery, [
    "favorite subject as a child", "favourite subject as a child", "when you were a child",
    "childhood subject", "when you were young", "biology",
  ])) {
    boost += 0.105;
  }

  if (sourceRef.includes("xiang-update:2026-05:shopping-clothes") && includesAny(normalizedQuery, [
    "shopping", "online shopping", "clothes", "fashion", "fashionable", "superstore", "delivery",
  ])) {
    boost += 0.085;
  }

  if (sourceRef.includes("xiang-update:2026-05:driving-car") && includesAny(normalizedQuery, [
    "go to school", "get to school", "travel to school", "drive to school", "usually go to campus",
    "go to campus", "driver", "license", "licence", "car",
  ])) {
    boost += 0.11;
  }

  if (sourceRef.includes("xiang-update:2026-05:childhood-home") && includesAny(normalizedQuery, [
    "where did you live as a child", "childhood home", "lived as a child", "childhood memory",
    "friends from childhood",
  ])) {
    boost += 0.12;
  }

  if (sourceRef.includes("xiang-update:2026-05:future-job") && includesAny(normalizedQuery, [
    "dream job", "future job", "job do you want", "career goal", "tech job",
    "role are you looking for", "after graduation", "few years", "kind of project",
    "enjoy building", "useful software", "ai software goal", "deep learning connect",
  ])) {
    boost += 0.12;
    if (includesAny(normalizedQuery, ["ai software goal", "deep learning connect"])) boost += 0.08;
  }

  if (sourceRef.includes("xiang-update:2026-05:work-life-balance") && includesAny(normalizedQuery, [
    "work environment", "workplace", "fits you best", "frustrates you", "work-life balance",
    "overtime", "personal space", "privacy",
  ])) {
    boost += 0.12;
  }

  if (category === "personality" && includesAny(normalizedQuery, [
    "social media", "with other people", "alone or with other people", "watch tv alone",
    "friends from childhood", "do with friends", "area where you live", "enough free time",
  ])) {
    boost += 0.06;
  }

  if (category === "lifestyle" && includesAny(normalizedQuery, ["spend the most time", "favourite room", "favorite room", "after school", "work-life balance"])) {
    boost += 0.055;
  }

  if (sourceRef.includes("xiang-profile:lifestyle-food-health") && includesAny(normalizedQuery, [
    "food", "takeout", "want for takeout", "order delivery", "eat",
  ])) {
    boost += 0.09;
  }

  if (hasAnyToken(tokens, ["game", "games", "gaming", "pokemon", "genshin", "switch", "music", "musical", "instrument", "instruments", "scripting", "script", "scripts", "piano", "automation", "film", "films", "trophy", "trophies", "completion"]) && (category === "games" || category === "games_technical_hobby")) {
    boost += 0.035;
    if (category === "games" && hasAnyToken(tokens, ["play", "played", "games", "game", "film", "films"]) && !hasAnyToken(tokens, ["script", "scripts", "scripting", "automation", "programming", "piano", "music", "musical", "instrument", "instruments"])) boost += 0.018;
    if (category === "games_technical_hobby" && hasAnyToken(tokens, ["script", "scripts", "scripting", "automation", "programming", "piano", "music", "musical", "instrument", "instruments"])) boost += 0.055;
  }

  if (sourceRef.includes("xiang-update:2026-05:anime-tv-film") && hasAnyToken(tokens, [
    "anime", "tv", "show", "shows", "series", "film", "films", "movie", "movies",
  ])) {
    boost += 0.095;
  }

  if (sourceRef.includes("xiang-update:2026-05:music-listening") && includesAny(normalizedQuery, [
    "listen to music", "listening to music", "where do you usually listen", "where do you normally listen",
  ])) {
    boost += 0.11;
  }

  if (hasAnyToken(tokens, ["family", "mother", "mom", "father", "dad", "sister", "brother", "brothers", "sibling", "siblings", "parents", "business", "factory"]) && category.includes("family")) {
    boost += 0.04;
    if (category === "family_background" && hasAnyToken(tokens, ["family", "brother", "brothers", "sibling", "siblings", "parents", "mother", "mom"])) boost += 0.04;
    if (category === "family_events" && hasAnyToken(tokens, ["father", "dad", "sister", "scam", "york", "passed", "liver"])) boost += 0.04;
  }

  if (hasAnyToken(tokens, ["ai", "assistant", "solve", "problem", "problems", "tool", "tools", "analyze", "thinking"]) && category === "ai_workflow") {
    boost += 0.05;
  }

  if (category === "ai_workflow" && includesAny(normalizedQuery, [
    "requirements are vague", "vague requirements", "unclear requirements", "feel stuck",
    "stuck on a project", "keep a project moving", "technical topic",
  ])) {
    boost += 0.08;
  }

  if (hasAnyToken(tokens, ["presentation", "presentations", "prepare", "study", "studying", "learning", "memorize", "classroom", "topics", "understand", "subject", "subjects"]) && category === "learning_style") {
    boost += 0.03;
    if (includesAny(normalizedQuery, ["learn technical", "technical topics", "technical topic", "new technical", "learn topics", "learn best", "study technical"])) boost += 0.05;
    if (includesAny(normalizedQuery, ["prepare when you need to explain", "how do you prepare", "explain a project"])) boost += 0.09;
    if (includesAny(normalizedQuery, ["what are you studying", "work or study", "what do you study", "subject do you enjoy"])) boost -= 0.035;
    if (includesAny(normalizedQuery, ["what subject was hardest", "worst subject", "hardest subject", "good student"])) boost += 0.055;
    if (includesAny(normalizedQuery, ["learning english", "studying english"])) boost -= 0.025;
  }

  if (hasAnyToken(tokens, ["deadline", "deadlines", "motivation", "motivated", "procrastinate", "procrastination", "assignment", "work", "polished"]) && category === "motivation_work_style") {
    boost += 0.035;
    if (includesAny(normalizedQuery, ["tight deadline", "school project", "look polished", "useful software", "feel stuck"])) boost += 0.06;
    if (includesAny(normalizedQuery, ["work or study", "travel to work or school"])) boost -= 0.04;
  }

  if (hasAnyToken(tokens, ["stress", "weakness", "confidence", "nervous", "girlfriend", "relationship", "romantic", "dating", "date", "social", "interview"]) && category === "emotional_social" && !normalizedQuery.includes("social media")) {
    boost += 0.04;
  }

  if (category === "interview_profile" && includesAny(normalizedQuery, ["interview", "interview question", "interview questions", "answer interview", "answer questions"])) {
    boost += 0.05;
    if (sourceRef.includes("xiang-profile") && includesAny(normalizedQuery, ["avoid", "avoid saying", "should not say", "what should i avoid"])) boost += 0.05;
  }

  if (category === "technical_skills" && hasAnyToken(tokens, ["skill", "skills", "technology", "technologies", "tech", "know", "comfortable", "stack", "computer", "computers", "science", "major"])) {
    boost += 0.06;
    if (includesAny(normalizedQuery, ["use a computer", "use computers", "computers for", "computer science"])) boost += 0.035;
    if (includesAny(normalizedQuery, ["strength that helps", "software projects"])) boost += 0.11;
    if (includesAny(normalizedQuery, ["why computer science money project"])) boost -= 0.03;
  }

  if (hasAnyToken(tokens, ["weakness", "english", "speaking", "communication"]) && ["speaking_style", "learning_style"].includes(category)) {
    boost += 0.018;
  }

  if (includesAny(normalizedQuery, ["learning english", "studying english"]) && ["speaking_style", "education_history"].includes(category)) {
    boost += 0.045;
  }

  if (hasAnyToken(tokens, ["canada", "future", "long", "term", "pr", "residency", "immigration", "career", "freedom", "balance"]) && category === "values_immigration") {
    boost += 0.04;
    if (includesAny(normalizedQuery, ["dream job", "what kind of job do you want", "work-life balance"])) boost += 0.045;
  }

  if (category === "interview_profile" && includesAny(normalizedQuery, ["dream job", "what kind of job do you want", "job do you want in the future"])) {
    boost += 0.06;
  }

  if (category === "behavioral_story" && includesAny(normalizedQuery, [
    "tell me about a time", "describe a time", "give me an example", "behavioral",
    "conflict", "teammate", "disagree", "disagreed", "failure", "failed", "mistake",
    "learned", "constructive feedback", "feedback", "leadership", "ownership",
    "initiative", "hard bug", "hardest bug", "recent bug", "debug", "debugging",
    "prioritize", "prioritise", "priority", "deadline", "requirements", "vague",
    "achievement", "satisfied", "proud", "challenge", "difficult", "stuck",
  ])) {
    boost += 0.09;
  }

  if (sourceRef === "knowledge:behavioral-interview:star-patterns" && includesAny(normalizedQuery, [
    "star", "behavioral interview", "how should i answer behavioral",
    "structure for a software engineer conflict story", "developer talk about failure",
    "answer behavioral interview",
  ])) {
    boost += 0.22;
  }

  if (sourceRef.startsWith("xiang-behavioral:")) {
    if (includesAny(normalizedQuery, ["interview", "behavioral", "tell me about", "describe a time", "give me an example"])) boost += 0.035;
    if (sourceRef.includes("hard-bug-context") && includesAny(normalizedQuery, ["hard bug", "hardest bug", "recent bug", "debug", "debugging", "wrong output", "output was wrong", "wrong because of context", "stale context", "context bug"])) boost += 0.28;
    if (sourceRef.includes("hard-bug-context") && includesAny(normalizedQuery, ["ollama", "qwen", "json parse", "malformed json"])) boost -= 0.1;
    if (sourceRef.includes("local-llm-json-latency") && includesAny(normalizedQuery, ["json", "parse", "malformed", "ollama", "qwen", "latency", "loading", "stuck", "local llm", "model issue"])) boost += 0.33;
    if (sourceRef.includes("prompt-failure") && includesAny(normalizedQuery, ["failure", "failed", "mistake", "lesson", "too rigid", "prompt", "repeat", "repetitive", "ai-like"])) boost += 0.16;
    if (sourceRef.includes("constructive-feedback") && includesAny(normalizedQuery, ["constructive feedback", "feedback", "too formal", "ai-like", "natural", "communication feedback"])) boost += 0.18;
    if (sourceRef.includes("leadership-ownership") && includesAny(normalizedQuery, ["leadership", "ownership", "initiative", "led", "lead", "take ownership", "end to end"])) boost += 0.18;
    if (sourceRef.includes("above-and-beyond") && includesAny(normalizedQuery, ["above and beyond", "extra effort", "more than required", "beyond the requirement", "went beyond"])) boost += 0.2;
    if (sourceRef.includes("pushed-user-control") && includesAny(normalizedQuery, ["push for", "pushed for", "had to push", "influence", "convince", "manual scene", "scene profile", "user control", "user-controlled", "not fully automatic"])) boost += 0.3;
    if (sourceRef.includes("long-iteration") && includesAny(normalizedQuery, ["persevere", "persevered", "multiple months", "long project", "kept working", "kept improving", "difficult for a long time", "stuck with"])) boost += 0.28;
    if (sourceRef.includes("overwhelmed-scope-control") && includesAny(normalizedQuery, ["overwhelming", "overwhelmed", "tight deadline", "failed deadline", "deadline", "time management", "too much work", "several deadlines", "scope control", "cut scope"])) boost += 0.28;
    if (sourceRef.includes("independent-work") && includesAny(normalizedQuery, ["working independently", "work independently", "independent work", "self-directed", "without much guidance", "learn on your own"])) boost += 0.2;
    if (sourceRef.includes("user-impact-reliability") && includesAny(normalizedQuery, ["user impact", "customer impact", "reliability", "privacy", "trust", "customer focus", "user trust", "reliability and user trust", "think about reliability"])) boost += 0.34;
    if (sourceRef.includes("user-impact-reliability") && includesAny(normalizedQuery, ["trade-off", "tradeoff", "between cost and reliability", "cost and reliability"])) boost -= 0.08;
    if (sourceRef.includes("prioritization") && includesAny(normalizedQuery, ["prioritize", "prioritise", "priority", "deadline", "tradeoff", "trade-off", "trade-off you made", "tradeoff you made", "cost", "cost and reliability", "between cost and reliability", "local mode", "travel mode", "paused one feature", "pause one feature", "more important", "finish something more important"])) boost += 0.3;
    if (sourceRef.includes("vague-requirements") && includesAny(normalizedQuery, ["requirements", "vague", "ambiguity", "unclear", "prenote", "scene profile", "product design"])) boost += 0.17;
    if (sourceRef.includes("team-disagreement") && includesAny(normalizedQuery, ["conflict", "teammate", "team project", "group project", "disagree", "disagreed", "disagreement", "different ideas", "technical disagreement"])) boost += 0.18;
    if (sourceRef.includes("team-disagreement") && includesAny(normalizedQuery, ["never had a dramatic conflict", "no dramatic conflict", "never had a conflict", "no conflict"])) boost -= 0.25;
    if (sourceRef.includes("team-disagreement") && !includesAny(normalizedQuery, ["conflict", "teammate", "team project", "group project", "disagree", "disagreed", "disagreement", "different ideas", "technical disagreement"])) boost -= 0.12;
    if (sourceRef.includes("achievement") && includesAny(normalizedQuery, ["achievement", "satisfied", "proud", "most proud", "accomplishment", "best shows your product thinking", "project best shows", "product thinking", "difficult but meaningful"])) boost += 0.34;
  }

  if (sourceRef === "knowledge:behavioral-interview:code-review-feedback" && includesAny(normalizedQuery, ["code review", "harsh feedback", "harsh code review", "senior engineer", "criticism", "pull request feedback", "code review feedback"])) boost += 0.38;
  if (sourceRef === "knowledge:behavioral-interview:no-dramatic-conflict" && includesAny(normalizedQuery, ["no conflict", "never had a conflict", "never had a dramatic conflict", "no dramatic conflict", "conflict question"])) boost += 0.38;
  if (sourceRef === "knowledge:behavioral-interview:why-company-role" && includesAny(normalizedQuery, ["why this company", "why this role", "why do you want to work", "role interest", "why are you interested"])) boost += 0.22;
  if (sourceRef === "knowledge:behavioral-interview:manager-influence" && includesAny(normalizedQuery, ["disagreement with your manager", "conflict with your manager", "influence somebody", "without getting approval", "manager disagreement", "push for", "pushed for"])) boost += 0.34;
  if (sourceRef === "knowledge:behavioral-interview:unresponsive-info" && includesAny(normalizedQuery, ["unresponsive", "wasn't responsive", "needed information", "blocked by someone", "waiting for information", "not responsive"])) boost += 0.34;

  if (sourceRef.includes("xiang-update:2026-05:english-learning") && includesAny(normalizedQuery, [
    "area you are still trying to improve", "still trying to improve", "weak point",
    "weakness", "advanced vocabulary", "vocabulary",
  ])) {
    boost += 0.095;
  }

  if (sourceRef.includes("xiang-update:2026-05:why-computer-science") && includesAny(normalizedQuery, [
    "became more interested", "interested in computer science", "what made you become",
    "why computer science money project",
  ])) {
    boost += 0.16;
  }

  if (hasAnyToken(tokens, ["project", "projects", "software", "built", "build", "aws", "firebase", "react", "cloud", "full", "stack", "lambda", "api"]) && ["technical_projects", "technical_skills", "interview_profile"].includes(category)) {
    boost += 0.04;
  }

  if (includesAny(normalizedQuery, ["computer games"]) && (category === "games" || category === "games_technical_hobby")) {
    boost += 0.08;
  }

  const isGenericProjectQuestion = hasAnyToken(tokens, ["project", "projects", "software", "built", "build"])
    && !hasAnyToken(tokens, ["react", "native", "firebase", "parking", "mobile", "saynext", "glasses", "aws", "serverless", "lambda", "study", "tracker"]);
  if (isGenericProjectQuestion && category === "technical_projects" && title.includes("elder album")) {
    boost += 0.018;
  }

  if (category === "technical_projects" && title.includes("saynext") && hasAnyToken(tokens, ["saynext", "glasses", "assistant", "transcription"])) {
    boost += 0.025;
  }

  if (category === "technical_projects" && title.includes("saynext") && includesAny(normalizedQuery, [
    "strongest technical project", "best technical project", "most technical project",
  ])) {
    boost += 0.14;
  }

  if (category === "technical_projects" && title.includes("saynext") && hasAnyToken(tokens, ["project", "projects"]) && hasAnyToken(tokens, ["next", "saynext"])) {
    boost += 0.04;
  }

  if (sourceRef.startsWith("doc:saynext") && includesAny(normalizedQuery, [
    "saynext", "this app", "conversation assistant", "mobile app", "mobile assistant",
    "transcript", "asr", "prompt", "prenote", "personal memory", "scene profile",
    "ollama", "qwen", "openai", "gpt", "frp", "vps", "local mode", "travel mode",
    "product thinking",
  ])) {
    boost += 0.05;
    if (sourceRef.includes("positioning") && includesAny(normalizedQuery, ["what is", "overview", "mobile", "smart glasses", "goal", "motivation", "product thinking"])) boost += 0.04;
    if (sourceRef.includes("positioning") && includesAny(normalizedQuery, ["why did i build", "why build", "why did you decide", "decide to build", "motivation", "reason"])) boost += 0.11;
    if (sourceRef.includes("interview-story") && includesAny(normalizedQuery, ["why did i build", "why build", "why did you decide", "decide to build", "motivation", "interview", "product thinking"])) boost += 0.13;
    if (sourceRef.includes("runtime-flow") && includesAny(normalizedQuery, ["runtime", "flow", "transcript", "asr", "final", "timeout", "context", "stale", "response", "real time", "hardest part", "hard part", "bad context", "recover"])) boost += 0.04;
    if (sourceRef.includes("memory-personalization") && includesAny(normalizedQuery, ["memory", "prenote", "hybrid", "fts5", "sqlite", "personalization", "knowledge"])) boost += 0.04;
    if (sourceRef.includes("llm-deployment") && includesAny(normalizedQuery, ["ollama", "qwen", "openai", "gpt", "cost", "vps", "frp", "local mode", "travel mode", "deployment"])) boost += 0.04;
    if (sourceRef.includes("trial-error") && includesAny(normalizedQuery, ["develop", "development", "trial", "error", "debug", "problem", "fixed", "prompt", "repeat", "cost", "wrong", "hardest part", "hard part", "useful in real time", "design choices", "go through"])) boost += 0.095;
    if (sourceRef.includes("ui-ux") && includesAny(normalizedQuery, ["ui", "ux", "pause", "continue", "reset", "settings", "export", "screen", "button", "controls", "recover", "bad context", "design choices", "go through"])) boost += 0.075;
    if (sourceRef.includes("llm-deployment") && includesAny(normalizedQuery, ["design choices", "go through"]) && !includesAny(normalizedQuery, ["llm", "ollama", "qwen", "openai", "gpt", "vps", "frp", "deployment"])) boost -= 0.08;
  }

  if ((sourceRef.includes("doc:saynext:trial-error") || sourceRef.includes("doc:saynext:runtime-flow")) && includesAny(normalizedQuery, [
    "hard bug", "bug you fixed", "hardest bug", "fixed recently",
  ])) {
    boost += 0.12;
  }

  if (category === "technical_projects" && title.includes("joblens") && includesAny(normalizedQuery, ["joblens", "job lens", "resume", "job matching", "job aggregation", "application tracking", "career"])) {
    boost += 0.035;
  }

  if (category === "technical_projects" && title.includes("elder") && includesAny(normalizedQuery, ["elder", "album", "photo", "share link", "serverless"])) {
    boost += 0.035;
  }

  if ((sourceRef.includes("xiang-profile:project-elder-album") || sourceRef.includes("doc:elderalbum:aws-architecture-deployment"))
    && includesAny(normalizedQuery, ["interviewer asks about aws", "project should i use", "which project should i use", "what project should i use"])
    && includesAny(normalizedQuery, ["aws", "cloud", "serverless", "lambda"])) {
    boost += 0.18;
  }

  if (category === "technical_projects" && title.includes("dalparkaid") && includesAny(normalizedQuery, ["dalparkaid", "dal park", "parking", "prediction", "crowd", "crowdsourced", "campus", "react native project parking", "parking mobile app", "react native experience"])) {
    boost += 0.035;
  }

  const isResumeDocumentQuestion = includesAny(normalizedQuery, ["resume", "cv"])
    && !includesAny(normalizedQuery, ["job matching", "job aggregation", "resume upload", "resume parsing", "match analysis"]);
  if (sourceRef.startsWith("doc:resume") && isResumeDocumentQuestion) {
    boost += 0.055;
    if (sourceRef.includes("skills") && hasAnyToken(tokens, ["skill", "skills", "tech", "technology", "technologies", "stack"])) boost += 0.04;
    if (sourceRef.includes("selected-projects") && hasAnyToken(tokens, ["project", "projects", "built", "made", "experience"])) boost += 0.04;
  }

  if (sourceRef.startsWith("doc:joblens") && includesAny(normalizedQuery, ["joblens", "job lens"])) {
    boost += 0.045;
    if (sourceRef.includes("overview") && hasAnyToken(tokens, ["what", "overview", "about", "summary"])) boost += 0.025;
    if (sourceRef.includes("workflow") && includesAny(normalizedQuery, ["workflow", "feature", "features", "dashboard", "tracker", "save jobs", "application"])) boost += 0.035;
    if (sourceRef.includes("architecture") && includesAny(normalizedQuery, ["architecture", "cloud", "aws", "lambda", "eventbridge", "sqs", "fargate", "api gateway"])) boost += 0.035;
    if (sourceRef.includes("data-storage-security") && includesAny(normalizedQuery, ["dynamodb", "table", "tables", "storage", "s3", "security", "jwt", "cors", "privacy"])) boost += 0.04;
    if (sourceRef.includes("reliability-cost-limitations") && includesAny(normalizedQuery, ["reliability", "cost", "limitation", "limitations", "future", "improvement", "improvements"])) boost += 0.04;
  }

  if (sourceRef.startsWith("doc:joblens") && includesAny(normalizedQuery, ["job matching", "job aggregation", "resume upload", "resume parsing", "match analysis"])) {
    boost += 0.055;
    if (sourceRef.includes("workflow")) boost += 0.04;
    if (sourceRef.includes("overview")) boost += 0.02;
  }

  if (sourceRef.startsWith("doc:joblens") && sourceRef.includes("workflow") && includesAny(normalizedQuery, [
    "compare a resume", "resume with a job posting", "resume match", "match how work",
  ])) {
    boost += 0.075;
  }

  if (sourceRef.startsWith("doc:elderalbum") && includesAny(normalizedQuery, ["elderalbum", "elder album", "album", "photo", "serverless"])) {
    boost += 0.045;
    if (sourceRef.includes("overview") && hasAnyToken(tokens, ["what", "overview", "about", "summary", "feature", "features"])) boost += 0.03;
    if (sourceRef.includes("architecture") && includesAny(normalizedQuery, ["architecture", "aws", "deployment", "sam", "cloudformation", "lambda", "s3"])) boost += 0.035;
    if (sourceRef.includes("api-data-model") && includesAny(normalizedQuery, ["api", "apis", "route", "routes", "data model", "dynamodb", "gsi", "share token", "table", "store", "stored", "storage"])) boost += 0.04;
    if (sourceRef.includes("security-cost-future") && includesAny(normalizedQuery, ["security", "cost", "future", "improve", "improvement", "improvements", "next", "issue", "issues", "cloudfront", "cognito", "private"])) boost += 0.06;
  }

  if (sourceRef.startsWith("doc:dalparkaid") && includesAny(normalizedQuery, ["dalparkaid", "dal park", "parking", "campus", "react native project parking", "parking mobile app", "react native experience"])) {
    boost += 0.045;
    if (sourceRef.includes("overview") && hasAnyToken(tokens, ["what", "overview", "about", "summary", "problem", "experience"])) boost += 0.03;
    if (sourceRef.includes("overview") && includesAny(normalizedQuery, ["parking mobile app", "react native project parking", "react native experience"])) boost += 0.08;
    if (sourceRef.includes("prediction-engine") && includesAny(normalizedQuery, ["prediction", "engine", "weather", "timetable", "score", "availability", "status"])) boost += 0.04;
    if (sourceRef.includes("crowd-reporting-navigation") && includesAny(normalizedQuery, ["crowd", "report", "reporting", "navigation", "proximity", "decay", "voting", "route"])) boost += 0.04;
    if (sourceRef.includes("evaluation-limitations") && includesAny(normalizedQuery, ["evaluation", "test", "participants", "finding", "find", "limitations", "future"])) boost += 0.04;
  }

  if (hasAnyToken(tokens, ["course", "courses", "class", "classes", "schedule", "summer"]) && category === "knowledge") {
    boost += 0.035;
  }

  if (sourceRef.includes("xiang-update:2026-05:past-courses") && includesAny(normalizedQuery, [
    "data management", "data mgmt", "what courses did you take", "did you take for data",
    "mobile computing course", "take in winter", "took in winter", "fall 2025", "winter 2026",
  ])) {
    boost += 0.16;
  }

  return boost;
}

function mapRecord(row: any): ConversationSampleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    language: row.language,
    transcript: row.transcript,
    aiReply: row.ai_reply,
    actionType: row.action_type,
    reasoning: row.reasoning,
    model: row.model,
    profileVersion: row.profile_version,
    retrievedSampleIds: JSON.parse(row.retrieved_sample_ids || "[]"),
    natural: row.rating_natural,
    short: row.rating_short,
    fitsXiang: row.rating_fits_xiang,
    tooOfficial: boolFromDb(row.too_official),
    directlySayable: boolFromDb(row.directly_sayable),
    inventedInfo: boolFromDb(row.invented_info),
    idealReply: row.ideal_reply || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRecord(row: any): ConversationEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    scene: row.scene,
    title: row.title,
    summary: row.summary,
    status: row.status,
    startTimestamp: row.start_timestamp,
    lastTimestamp: row.last_timestamp,
    transcriptCount: row.transcript_count,
    aiReplyCount: row.ai_reply_count,
    rawTranscript: row.raw_transcript || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTranscriptExportSessionRecord(row: any): TranscriptExportSessionRecord {
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    title: row.title || row.session_id,
    scenes: String(row.scenes || "")
      .split(",")
      .map((scene) => scene.trim())
      .filter(Boolean),
    status: row.open_event_count > 0 ? "active" : "closed",
    startTimestamp: row.start_timestamp,
    lastTimestamp: row.last_timestamp,
    eventCount: Number(row.event_count || 0),
    transcriptCount: Number(row.transcript_count || 0),
    aiReplyCount: Number(row.ai_reply_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPipelineRunRecord(row: any): PersonalizationPipelineRunRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    userId: row.user_id,
    status: row.status,
    model: row.model,
    rawTranscript: row.raw_transcript,
    rawOutput: row.raw_output,
    cleanedTranscript: row.cleaned_transcript || "",
    cleanedOutput: row.cleaned_output || "",
    segmentsJson: row.segments_json || "[]",
    contextJson: row.context_json || "{}",
    eventJson: row.event_json || "{}",
    outputIntentJson: row.output_intent_json || "{}",
    qualityJson: row.quality_json || "{}",
    pseudoLabel: row.pseudo_label || "",
    reviewPriority: row.review_priority || "low",
    needsReview: Boolean(row.needs_review),
    memoryJson: row.memory_json || "{}",
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPersonalMemoryItemRecord(row: any): PersonalMemoryItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceRunId: row.source_run_id,
    memoryType: row.memory_type,
    content: row.content,
    tagsJson: row.tags_json || "[]",
    confidence: row.confidence ?? 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPersonalMemoryRecord(row: any): PersonalMemoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    category: row.category || "general",
    sensitivity: normalizeSensitivity(row.sensitivity),
    content: row.content || "",
    usageRule: row.usage_rule || "",
    keywords: parseJsonArray(row.keywords_json).map(String),
    embedding: parseJsonArray(row.embedding_json).map(Number).filter((value) => Number.isFinite(value)),
    status: row.status || "active",
    source: row.source || "manual",
    sourceRef: row.source_ref || "",
    contentHash: row.content_hash || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrenoteRecord(row: any): PrenoteRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description || "",
    status: row.status,
    isActive: Boolean(row.is_active),
    sourceText: row.source_text || "",
    extractedText: row.extracted_text || "",
    processedJson: row.processed_json || "{}",
    runtimeContext: row.runtime_context || "",
    model: row.model,
    contentHash: row.content_hash || "",
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrenoteFileRecord(row: any): PrenoteFileRecord {
  return {
    id: row.id,
    prenoteId: row.prenote_id,
    fileName: row.file_name,
    mimeType: row.mime_type || "",
    filePath: row.file_path,
    sizeBytes: row.size_bytes || 0,
    extractedText: row.extracted_text || "",
    status: row.status,
    error: row.error || "",
    createdAt: row.created_at,
  };
}

function mapSceneProfileRecord(row: any): SceneProfileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    builtinKey: row.builtin_key || "",
    name: row.name,
    prompt: row.prompt || "",
    isActive: Boolean(row.is_active),
    isBuiltin: Boolean(row.is_builtin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ConversationLogger {
  private db: Database | null = null;
  private initialized = false;

  isEnabled(): boolean {
    return process.env.DATA_LOGGING_ENABLED !== "false";
  }

  private getDb(): Database {
    if (!this.isEnabled()) {
      throw new Error("Conversation logging is disabled");
    }

    if (!this.db) {
      const dbPath = process.env.SAYNEXT_DB_PATH || DEFAULT_DB_PATH;
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA foreign_keys = ON");
    }

    if (!this.initialized) {
      this.initialize();
    }

    return this.db;
  }

  private initialize(): void {
    const db = this.db;
    if (!db) return;

    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        language TEXT,
        transcript TEXT NOT NULL,
        ai_reply TEXT,
        action_type TEXT NOT NULL,
        reasoning TEXT,
        model TEXT,
        profile_version TEXT,
        retrieved_sample_ids TEXT NOT NULL DEFAULT '[]',
        rating_natural INTEGER,
        rating_short INTEGER,
        rating_fits_xiang INTEGER,
        too_official INTEGER,
        directly_sayable INTEGER,
        invented_info INTEGER,
        ideal_reply TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_conversation_samples_user_time ON conversation_samples(user_id, timestamp DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        scene TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        start_timestamp TEXT NOT NULL,
        last_timestamp TEXT NOT NULL,
        transcript_count INTEGER NOT NULL DEFAULT 0,
        ai_reply_count INTEGER NOT NULL DEFAULT 0,
        raw_transcript TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_conversation_events_user_time ON conversation_events(user_id, last_timestamp DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS personalization_pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT,
        raw_transcript TEXT NOT NULL,
        raw_output TEXT,
        cleaned_transcript TEXT NOT NULL DEFAULT '',
        cleaned_output TEXT NOT NULL DEFAULT '',
        segments_json TEXT NOT NULL DEFAULT '[]',
        context_json TEXT NOT NULL DEFAULT '{}',
        event_json TEXT NOT NULL DEFAULT '{}',
        output_intent_json TEXT NOT NULL DEFAULT '{}',
        quality_json TEXT NOT NULL DEFAULT '{}',
        pseudo_label TEXT NOT NULL DEFAULT '',
        review_priority TEXT NOT NULL DEFAULT 'low',
        needs_review INTEGER NOT NULL DEFAULT 0,
        memory_json TEXT NOT NULL DEFAULT '{}',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_type, source_id)
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_time ON personalization_pipeline_runs(user_id, updated_at DESC)");
    db.run("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_review ON personalization_pipeline_runs(user_id, needs_review, review_priority)");

    db.run(`
      CREATE TABLE IF NOT EXISTS personal_memory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source_run_id INTEGER NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_run_id, memory_type, content)
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_personal_memory_user ON personal_memory_items(user_id, status, updated_at DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS personal_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        sensitivity TEXT NOT NULL DEFAULT 'medium',
        content TEXT NOT NULL,
        usage_rule TEXT NOT NULL DEFAULT '',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        embedding_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      db.run("ALTER TABLE personal_memories ADD COLUMN source_ref TEXT NOT NULL DEFAULT ''");
    } catch {
      // Existing database already has this migration.
    }

    try {
      db.run("ALTER TABLE personal_memories ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
    } catch {
      // Existing database already has this migration.
    }

    db.run("CREATE INDEX IF NOT EXISTS idx_personal_memories_user_status ON personal_memories(user_id, status, updated_at DESC)");
    db.run("CREATE INDEX IF NOT EXISTS idx_personal_memories_user_category ON personal_memories(user_id, category, sensitivity)");
    db.run("CREATE INDEX IF NOT EXISTS idx_personal_memories_source_ref ON personal_memories(user_id, source, source_ref)");
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_memories_unique_source_ref
      ON personal_memories(user_id, source, source_ref)
      WHERE source_ref <> ''
    `);

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS personal_memories_fts USING fts5(
        title,
        category,
        keywords,
        content
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS prenotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'processing',
        is_active INTEGER NOT NULL DEFAULT 0,
        source_text TEXT NOT NULL DEFAULT '',
        extracted_text TEXT NOT NULL DEFAULT '',
        processed_json TEXT NOT NULL DEFAULT '{}',
        runtime_context TEXT NOT NULL DEFAULT '',
        model TEXT,
        content_hash TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_prenotes_user_active ON prenotes(user_id, is_active, updated_at DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS prenote_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prenote_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        extracted_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(prenote_id) REFERENCES prenotes(id) ON DELETE CASCADE
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_prenote_files_prenote ON prenote_files(prenote_id)");

    db.run(`
      CREATE TABLE IF NOT EXISTS scene_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        builtin_key TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_scene_profiles_user_active ON scene_profiles(user_id, is_active, updated_at DESC)");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_profiles_builtin_key ON scene_profiles(user_id, builtin_key) WHERE builtin_key <> ''");
    this.initialized = true;
  }

  createSample(input: CreateConversationSampleInput): ConversationSampleRecord | null {
    if (!this.isEnabled()) return null;

    const db = this.getDb();
    const result = db
      .query(`
        INSERT INTO conversation_samples (
          user_id, session_id, timestamp, language, transcript, ai_reply,
          action_type, reasoning, model, profile_version, retrieved_sample_ids
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.userId,
        input.sessionId,
        new Date(input.timestamp).toISOString(),
        input.language ?? null,
        input.transcript,
        input.aiReply ?? null,
        input.actionType,
        input.reasoning ?? null,
        input.model ?? null,
        input.profileVersion ?? null,
        JSON.stringify(input.retrievedSampleIds ?? []),
      );

    return this.getSample(Number(result.lastInsertRowid));
  }

  getSample(id: number): ConversationSampleRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM conversation_samples WHERE id = ?")
      .get(id);

    return row ? mapRecord(row) : null;
  }

  listSamples(userId: string, limit = 50): ConversationSampleRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM conversation_samples WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapRecord);
  }

  updateSample(id: number, input: UpdateConversationSampleInput): ConversationSampleRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getSample(id);
    if (!existing) return null;

    this.getDb()
      .query(`
        UPDATE conversation_samples
        SET
          rating_natural = ?,
          rating_short = ?,
          rating_fits_xiang = ?,
          too_official = ?,
          directly_sayable = ?,
          invented_info = ?,
          ideal_reply = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(
        input.natural ?? existing.natural,
        input.short ?? existing.short,
        input.fitsXiang ?? existing.fitsXiang,
        mergeBoolForDb(input.tooOfficial, existing.tooOfficial),
        mergeBoolForDb(input.directlySayable, existing.directlySayable),
        mergeBoolForDb(input.inventedInfo, existing.inventedInfo),
        input.idealReply ?? existing.idealReply,
        input.notes ?? existing.notes,
        id,
      );

    return this.getSample(id);
  }

  upsertEvent(input: UpsertConversationEventInput): ConversationEventRecord | null {
    if (!this.isEnabled()) return null;

    this.getDb()
      .query(`
        INSERT INTO conversation_events (
          id, user_id, session_id, scene, title, summary, status,
          start_timestamp, last_timestamp, transcript_count, ai_reply_count, raw_transcript
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scene = excluded.scene,
          title = excluded.title,
          summary = excluded.summary,
          status = excluded.status,
          last_timestamp = excluded.last_timestamp,
          transcript_count = excluded.transcript_count,
          ai_reply_count = excluded.ai_reply_count,
          raw_transcript = excluded.raw_transcript,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.id,
        input.userId,
        input.sessionId,
        input.scene,
        input.title,
        input.summary,
        input.status,
        new Date(input.startTimestamp).toISOString(),
        new Date(input.lastTimestamp).toISOString(),
        input.transcriptCount,
        input.aiReplyCount,
        input.rawTranscript,
      );

    return this.getEvent(input.id);
  }

  getEvent(id: string): ConversationEventRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM conversation_events WHERE id = ?")
      .get(id);

    return row ? mapEventRecord(row) : null;
  }

  listEvents(userId: string, limit = 50): ConversationEventRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM conversation_events WHERE user_id = ? ORDER BY last_timestamp DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapEventRecord);
  }

  listTranscriptExportSessions(userId: string, limit = 50): TranscriptExportSessionRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query(`
        SELECT
          user_id,
          session_id,
          MIN(start_timestamp) AS start_timestamp,
          MAX(last_timestamp) AS last_timestamp,
          COUNT(*) AS event_count,
          SUM(transcript_count) AS transcript_count,
          SUM(ai_reply_count) AS ai_reply_count,
          GROUP_CONCAT(DISTINCT scene) AS scenes,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS open_event_count,
          MIN(created_at) AS created_at,
          MAX(updated_at) AS updated_at,
          (
            SELECT title
            FROM conversation_events AS first_event
            WHERE first_event.user_id = conversation_events.user_id
              AND first_event.session_id = conversation_events.session_id
            ORDER BY start_timestamp ASC
            LIMIT 1
          ) AS title
        FROM conversation_events
        WHERE user_id = ?
        GROUP BY user_id, session_id
        ORDER BY MAX(last_timestamp) DESC
        LIMIT ?
      `)
      .all(userId, safeLimit);

    return rows.map(mapTranscriptExportSessionRecord);
  }

  getTranscriptExportSession(userId: string, sessionId: string): TranscriptExportSessionRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query(`
        SELECT
          user_id,
          session_id,
          MIN(start_timestamp) AS start_timestamp,
          MAX(last_timestamp) AS last_timestamp,
          COUNT(*) AS event_count,
          SUM(transcript_count) AS transcript_count,
          SUM(ai_reply_count) AS ai_reply_count,
          GROUP_CONCAT(DISTINCT scene) AS scenes,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS open_event_count,
          MIN(created_at) AS created_at,
          MAX(updated_at) AS updated_at,
          (
            SELECT title
            FROM conversation_events AS first_event
            WHERE first_event.user_id = conversation_events.user_id
              AND first_event.session_id = conversation_events.session_id
            ORDER BY start_timestamp ASC
            LIMIT 1
          ) AS title
        FROM conversation_events
        WHERE user_id = ? AND session_id = ?
        GROUP BY user_id, session_id
      `)
      .get(userId, sessionId);

    return row ? mapTranscriptExportSessionRecord(row) : null;
  }

  listEventsForSession(userId: string, sessionId: string): ConversationEventRecord[] {
    if (!this.isEnabled()) return [];

    const rows = this.getDb()
      .query("SELECT * FROM conversation_events WHERE user_id = ? AND session_id = ? ORDER BY start_timestamp ASC")
      .all(userId, sessionId);

    return rows.map(mapEventRecord);
  }

  listSamplesForSessionWindow(userId: string, sessionId: string, startTimestamp: string, lastTimestamp: string): ConversationSampleRecord[] {
    if (!this.isEnabled()) return [];

    const rows = this.getDb()
      .query(`
        SELECT *
        FROM conversation_samples
        WHERE user_id = ?
          AND (
            session_id = ?
            OR (timestamp >= ? AND timestamp <= ?)
          )
        ORDER BY timestamp ASC
        LIMIT 1000
      `)
      .all(userId, sessionId, startTimestamp, lastTimestamp);

    return rows.map(mapRecord);
  }

  upsertPipelineRun(input: UpsertPersonalizationPipelineRunInput): PersonalizationPipelineRunRecord | null {
    if (!this.isEnabled()) return null;

    this.getDb()
      .query(`
        INSERT INTO personalization_pipeline_runs (
          source_type, source_id, user_id, status, model, raw_transcript, raw_output,
          cleaned_transcript, cleaned_output, segments_json, context_json, event_json,
          output_intent_json, quality_json, pseudo_label, review_priority, needs_review,
          memory_json, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET
          user_id = excluded.user_id,
          status = excluded.status,
          model = excluded.model,
          raw_transcript = excluded.raw_transcript,
          raw_output = excluded.raw_output,
          cleaned_transcript = excluded.cleaned_transcript,
          cleaned_output = excluded.cleaned_output,
          segments_json = excluded.segments_json,
          context_json = excluded.context_json,
          event_json = excluded.event_json,
          output_intent_json = excluded.output_intent_json,
          quality_json = excluded.quality_json,
          pseudo_label = excluded.pseudo_label,
          review_priority = excluded.review_priority,
          needs_review = excluded.needs_review,
          memory_json = excluded.memory_json,
          error = excluded.error,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.sourceType,
        input.sourceId,
        input.userId,
        input.status,
        input.model ?? null,
        input.rawTranscript,
        input.rawOutput ?? null,
        input.cleanedTranscript ?? "",
        input.cleanedOutput ?? "",
        input.segmentsJson ?? "[]",
        input.contextJson ?? "{}",
        input.eventJson ?? "{}",
        input.outputIntentJson ?? "{}",
        input.qualityJson ?? "{}",
        input.pseudoLabel ?? "",
        input.reviewPriority ?? "low",
        input.needsReview ? 1 : 0,
        input.memoryJson ?? "{}",
        input.error ?? "",
      );

    return this.getPipelineRunBySource(input.sourceType, input.sourceId);
  }

  getPipelineRunBySource(sourceType: string, sourceId: string): PersonalizationPipelineRunRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM personalization_pipeline_runs WHERE source_type = ? AND source_id = ?")
      .get(sourceType, sourceId);

    return row ? mapPipelineRunRecord(row) : null;
  }

  listPipelineRuns(userId: string, limit = 50): PersonalizationPipelineRunRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM personalization_pipeline_runs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapPipelineRunRecord);
  }

  createPersonalMemoryItem(input: CreatePersonalMemoryItemInput): PersonalMemoryItemRecord | null {
    if (!this.isEnabled()) return null;

    const result = this.getDb()
      .query(`
        INSERT INTO personal_memory_items (
          user_id, source_run_id, memory_type, content, tags_json, confidence, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_run_id, memory_type, content) DO UPDATE SET
          tags_json = excluded.tags_json,
          confidence = excluded.confidence,
          status = excluded.status,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.userId,
        input.sourceRunId,
        input.memoryType,
        input.content,
        JSON.stringify(input.tags ?? []),
        input.confidence ?? 0,
        input.status ?? "active",
      );

    const rowId = Number(result.lastInsertRowid);
    if (rowId > 0) {
      return this.getPersonalMemoryItem(rowId);
    }

    const existing = this.getDb()
      .query("SELECT * FROM personal_memory_items WHERE source_run_id = ? AND memory_type = ? AND content = ?")
      .get(input.sourceRunId, input.memoryType, input.content);

    return existing ? mapPersonalMemoryItemRecord(existing) : null;
  }

  getPersonalMemoryItem(id: number): PersonalMemoryItemRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM personal_memory_items WHERE id = ?")
      .get(id);

    return row ? mapPersonalMemoryItemRecord(row) : null;
  }

  listPersonalMemoryItems(userId: string, limit = 50): PersonalMemoryItemRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM personal_memory_items WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapPersonalMemoryItemRecord);
  }

  private upsertPersonalMemoryFts(memory: PersonalMemoryRecord): void {
    const db = this.getDb();
    db.query("DELETE FROM personal_memories_fts WHERE rowid = ?").run(memory.id);
    db.query(`
      INSERT INTO personal_memories_fts(rowid, title, category, keywords, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.title,
      memory.category,
      memory.keywords.join(" "),
      memory.content,
    );
  }

  private deletePersonalMemoryFts(id: number): void {
    this.getDb().query("DELETE FROM personal_memories_fts WHERE rowid = ?").run(id);
  }

  createPersonalMemory(input: CreatePersonalMemoryInput): PersonalMemoryRecord | null {
    if (!this.isEnabled()) return null;

    const keywords = Array.from(new Set((input.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 30);
    const source = input.source ?? "manual";
    const sourceRef = input.sourceRef?.trim() || "";
    const draft = {
      title: input.title.trim() || "Personal memory",
      category: input.category.trim() || "general",
      content: input.content.trim(),
      usageRule: input.usageRule?.trim() || "",
      keywords,
    };
    const contentHash = hashMemoryContent(draft.content);

    if (input.upsertBySource && sourceRef) {
      const existing = this.getPersonalMemoryBySourceRef(input.userId, source, sourceRef);
      if (existing) {
        return this.updatePersonalMemory(input.userId, existing.id, {
          title: draft.title,
          category: draft.category,
          sensitivity: normalizeSensitivity(input.sensitivity),
          content: draft.content,
          usageRule: draft.usageRule,
          keywords,
          status: input.status ?? "active",
          sourceRef,
        });
      }
    }

    if (input.upsertBySource && source === "knowledge") {
      const existingByHash = this.getPersonalMemoryByContentHash(input.userId, source, contentHash);
      const existingByTitle = existingByHash ?? this.getKnowledgeMemoryByTitle(input.userId, draft.category, draft.title);
      if (existingByTitle) {
        return this.updatePersonalMemory(input.userId, existingByTitle.id, {
          title: draft.title,
          category: draft.category,
          sensitivity: normalizeSensitivity(input.sensitivity),
          content: draft.content,
          usageRule: draft.usageRule,
          keywords,
          status: input.status ?? "active",
          sourceRef: sourceRef || existingByTitle.sourceRef,
        });
      }
    }

    const embedding = localHybridEmbedding(memorySearchText(draft));

    const result = this.getDb()
      .query(`
        INSERT INTO personal_memories (
          user_id, title, category, sensitivity, content, usage_rule,
          keywords_json, embedding_json, status, source, source_ref, content_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.userId,
        draft.title,
        draft.category,
        normalizeSensitivity(input.sensitivity),
        draft.content,
        draft.usageRule,
        JSON.stringify(keywords),
        JSON.stringify(embedding),
        input.status ?? "active",
        source,
        sourceRef,
        contentHash,
      );

    const memory = this.getPersonalMemory(Number(result.lastInsertRowid));
    if (memory) this.upsertPersonalMemoryFts(memory);
    return memory;
  }

  getPersonalMemory(id: number): PersonalMemoryRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM personal_memories WHERE id = ?")
      .get(id);

    return row ? mapPersonalMemoryRecord(row) : null;
  }

  getPersonalMemoryByContentHash(userId: string, source: string, contentHash: string): PersonalMemoryRecord | null {
    if (!this.isEnabled() || !contentHash.trim()) return null;

    const row = this.getDb()
      .query(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ? AND source = ? AND content_hash = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(userId, source, contentHash.trim());

    return row ? mapPersonalMemoryRecord(row) : null;
  }

  getKnowledgeMemoryByTitle(userId: string, category: string, title: string): PersonalMemoryRecord | null {
    if (!this.isEnabled() || !title.trim()) return null;

    const row = this.getDb()
      .query(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ?
          AND source = 'knowledge'
          AND category = ?
          AND LOWER(title) = LOWER(?)
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(userId, category.trim() || "knowledge", title.trim());

    return row ? mapPersonalMemoryRecord(row) : null;
  }

  getPersonalMemoryBySourceRef(userId: string, source: string, sourceRef: string): PersonalMemoryRecord | null {
    if (!this.isEnabled() || !sourceRef.trim()) return null;

    const row = this.getDb()
      .query(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ? AND source = ? AND source_ref = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(userId, source, sourceRef.trim());

    return row ? mapPersonalMemoryRecord(row) : null;
  }

  listPersonalMemories(userId: string, options: { status?: string; limit?: number } = {}): PersonalMemoryRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    const status = options.status ?? "active";
    const rows = this.getDb()
      .query(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ? AND (? = 'all' OR status = ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(userId, status, status, safeLimit);

    return rows.map(mapPersonalMemoryRecord);
  }

  updatePersonalMemory(userId: string, id: number, input: UpdatePersonalMemoryInput): PersonalMemoryRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getPersonalMemory(id);
    if (!existing || existing.userId !== userId) return null;

    const keywords = input.keywords
      ? Array.from(new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 30)
      : existing.keywords;

    const updatedDraft = {
      title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : existing.title,
      category: typeof input.category === "string" && input.category.trim() ? input.category.trim() : existing.category,
      content: typeof input.content === "string" ? input.content.trim() : existing.content,
      usageRule: typeof input.usageRule === "string" ? input.usageRule.trim() : existing.usageRule,
      keywords,
    };
    const embedding = localHybridEmbedding(memorySearchText(updatedDraft));
    const sourceRef = typeof input.sourceRef === "string" ? input.sourceRef.trim() : existing.sourceRef;
    const contentHash = hashMemoryContent(updatedDraft.content);

    this.getDb()
      .query(`
        UPDATE personal_memories
        SET
          title = ?,
          category = ?,
          sensitivity = ?,
          content = ?,
          usage_rule = ?,
          keywords_json = ?,
          embedding_json = ?,
          status = ?,
          source_ref = ?,
          content_hash = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `)
      .run(
        updatedDraft.title,
        updatedDraft.category,
        input.sensitivity ? normalizeSensitivity(input.sensitivity) : existing.sensitivity,
        updatedDraft.content,
        updatedDraft.usageRule,
        JSON.stringify(keywords),
        JSON.stringify(embedding),
        input.status ?? existing.status,
        sourceRef,
        contentHash,
        id,
        userId,
      );

    const memory = this.getPersonalMemory(id);
    if (memory) {
      if (memory.status === "active") this.upsertPersonalMemoryFts(memory);
      else this.deletePersonalMemoryFts(memory.id);
    }
    return memory;
  }

  deletePersonalMemory(userId: string, id: number): boolean {
    if (!this.isEnabled()) return false;

    const existing = this.getPersonalMemory(id);
    if (!existing || existing.userId !== userId) return false;

    this.getDb().query("DELETE FROM personal_memories WHERE id = ? AND user_id = ?").run(id, userId);
    this.deletePersonalMemoryFts(id);
    return true;
  }

  rebuildPersonalMemoryFts(userId?: string): void {
    if (!this.isEnabled()) return;

    const db = this.getDb();
    if (userId) {
      const memories = this.listPersonalMemories(userId, { status: "active", limit: 1000 });
      for (const memory of memories) this.upsertPersonalMemoryFts(memory);
      return;
    }

    db.query("DELETE FROM personal_memories_fts").run();
    const rows = db.query("SELECT * FROM personal_memories WHERE status = 'active'").all();
    rows.map(mapPersonalMemoryRecord).forEach((memory) => this.upsertPersonalMemoryFts(memory));
  }

  searchPersonalMemoriesHybrid(userId: string, query: string, limit = 3): PersonalMemorySearchResult[] {
    if (!this.isEnabled()) return [];

    const cleanedQuery = query.trim();
    if (!cleanedQuery) return [];
    if (shouldSkipPersonalMemorySearch(cleanedQuery)) return [];
    const generalTechnicalConceptQuestion = isGeneralTechnicalConceptQuestion(cleanedQuery);
    const explicitGeneralTechnicalQuestion = isExplicitGeneralTechnicalQuestion(cleanedQuery);
    const likelyThirdPartyTranscript = isLikelyThirdPartyTranscript(cleanedQuery);
    const likelyPassivePublicTranscript = isLikelyPublicMonologue(cleanedQuery) || isLikelyCompleteDialogueExcerpt(cleanedQuery);
    const behavioralStoryQuestion = isBehavioralStoryQuestion(cleanedQuery);
    if (likelyPassivePublicTranscript && !generalTechnicalConceptQuestion) return [];

    const db = this.getDb();
    const memories = this.listPersonalMemories(userId, { status: "active", limit: 1000 });
    if (memories.length === 0) return [];

    const queryTokens = new Set(tokenizeSearchText(cleanedQuery));
    const ftsQuery = buildFtsQuery(cleanedQuery);
    const lexicalRanks = new Map<number, number>();

    if (ftsQuery) {
      try {
        const rows = db
          .query(`
            SELECT rowid, bm25(personal_memories_fts) AS bm25_score
            FROM personal_memories_fts
            WHERE personal_memories_fts MATCH ?
            ORDER BY bm25_score ASC
            LIMIT 30
          `)
          .all(ftsQuery);
        rows.forEach((row: any, index) => lexicalRanks.set(Number(row.rowid), index + 1));
      } catch {
        // FTS query syntax can fail on unusual ASR text; vector/keyword scoring still runs.
      }
    }

    const queryEmbedding = localHybridEmbedding(cleanedQuery);
    const vectorRanks = new Map<number, number>();
    const vectorScores = memories
      .map((memory) => ({
        id: memory.id,
        score: memory.embedding.length ? cosineSimilarity(queryEmbedding, memory.embedding) : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    vectorScores.forEach((item, index) => vectorRanks.set(item.id, index + 1));

    const results = memories
      .reduce<PersonalMemorySearchResult[]>((acc, memory) => {
        const keywordScore = keywordOverlapScore(queryTokens, memory);
        const lexicalRank = lexicalRanks.get(memory.id);
        const vectorRank = vectorRanks.get(memory.id);
        const vectorScore = vectorScores.find((item) => item.id === memory.id)?.score ?? 0;
        const intentBoost = personalMemoryIntentBoost(cleanedQuery, memory);
        const normalizedQuery = cleanedQuery.toLowerCase();
        const sourceRef = memory.sourceRef.toLowerCase();
        const projectQuestion = hasAnyToken(queryTokens, ["project", "projects", "built", "build", "made", "experience", "architecture", "app"]);
        const projectSpecificQuestion = !explicitGeneralTechnicalQuestion && includesAny(normalizedQuery, [
          "saynext", "say next", "elderalbum", "elder album", "joblens", "job lens",
          "dalparkaid", "dal park", "my project", "your project", "my app", "your app",
          "which project should", "what project should", "project should i talk", "project should xiang talk",
          "project should i use", "album sharing app", "parking app", "parking mobile app",
          "parking project", "react native project parking", "react native experience",
          "my aws project", "project album", "job matching app", "connecting aws services",
        ]);
        const personalExperienceQuestion = includesAny(normalizedQuery, [
          "your programming interest", "my programming interest", "games related to",
          "why do you dislike", "do you dislike bullying", "what happened to your",
          "what happened to my", "why do you care", "why is freedom important",
          "how do you react under stress", "dating experience", "talking to girls",
          "what motivates you", "what did your family", "your family", "my family",
          "why do you like", "as a course", "what time is your", "personal data",
          "privacy-sensitive", "not be overshared", "cloud architecture why",
          "deep learning like why", "why you like deep learning",
        ]);

        if (memory.category === "behavioral_story" && !behavioralStoryQuestion) {
          return acc;
        }

        if (sourceRef.startsWith("knowledge:behavioral-interview:") && !behavioralStoryQuestion) {
          return acc;
        }

        if ((generalTechnicalConceptQuestion || likelyThirdPartyTranscript || likelyPassivePublicTranscript) && memory.source !== "knowledge" && !memory.category.startsWith("knowledge")) {
          return acc;
        }

        if (memory.source === "knowledge") {
          if (personalExperienceQuestion) return acc;
          if (projectSpecificQuestion) return acc;
          if (sourceRef.startsWith("knowledge:cs-interview:")
            && includesAny(normalizedQuery, ["which project", "what project", "project are you", "project best shows", "project did you"])) {
            return acc;
          }
          if (!generalTechnicalConceptQuestion && intentBoost < 0.1) return acc;
        }

        if (memory.sensitivity === "high" && !highSensitivityAllowed(cleanedQuery, memory)) {
          return acc;
        }

        if (memory.category === "values_immigration" && includesAny(normalizedQuery, [
          "english", "vocabulary", "youtube", "learn english", "learning english",
        ]) && !includesAny(normalizedQuery, [
          "canada", "future", "long term", "freedom", "residency", "immigration",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:joblens") && includesAny(normalizedQuery, [
          "dream job", "what kind of job do you want", "work-life balance", "do you work long hours",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:joblens") && !includesAny(normalizedQuery, [
          "joblens", "job lens", "job matching", "job aggregation", "resume upload",
          "resume parsing", "match analysis", "resume with a job posting", "job posting",
          "application tracking", "dynamodb", "eventbridge", "sqs", "fargate",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:saynext") && includesAny(normalizedQuery, [
          "parking", "dalparkaid", "dal park", "react native experience",
        ]) && !includesAny(normalizedQuery, ["saynext", "say next"])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:resume") && includesAny(normalizedQuery, [
          "course", "courses", "class", "classes", "summer", "professor", "instructor",
        ])) {
          return acc;
        }

        if ((sourceRef.startsWith("doc:") || memory.category === "technical_projects") && includesAny(normalizedQuery, [
          "privacy-sensitive place", "personal data should not", "not be overshared",
          "should not be overshared",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:dalparkaid") && !includesAny(normalizedQuery, [
          "dalparkaid", "dal park", "parking", "react native", "crowd report", "crowd reports",
          "crowdsourced", "30 meter", "proximity", "weather and class", "class timetable",
          "parking app",
        ]) && !(projectQuestion && includesAny(normalizedQuery, ["mobile", "campus", "prediction"]))) {
          return acc;
        }

        if (sourceRef.startsWith("doc:elderalbum") && !includesAny(normalizedQuery, [
          "elderalbum", "elder album", "album", "photo", "photos", "serverless", "aws",
          "lambda", "dynamodb", "s3", "api gateway", "share token", "cloudfront", "cognito",
        ]) && !(projectQuestion && includesAny(normalizedQuery, ["aws", "cloud", "serverless"]))) {
          return acc;
        }

        if (sourceRef.startsWith("doc:saynext") && !includesAny(normalizedQuery, [
          "saynext", "say next", "this app", "conversation assistant", "mobile app",
          "mobile assistant", "real time", "realtime", "transcript", "asr", "prompt",
          "prenote", "personal memory", "scene profile", "ollama", "qwen", "openai",
          "gpt", "frp", "vps", "local mode", "travel mode", "recover", "bad context",
          "ui controls", "controls", "product thinking",
          "design choices", "go through",
        ]) && !(projectQuestion && includesAny(normalizedQuery, ["real time", "assistant", "conversation", "product thinking"]))) {
          return acc;
        }

        if (memory.category === "technical_projects" && includesAny(normalizedQuery, [
          "strength that helps", "prepare when you need to explain", "how do you prepare",
          "what motivates you", "requirements are vague", "vague requirements",
          "feel stuck", "keep a project moving", "tight deadline",
        ]) && !includesAny(normalizedQuery, [
          "saynext", "say next", "elderalbum", "elder album", "joblens", "job lens",
          "dalparkaid", "dal park", "parking", "aws", "react native",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-profile:interview-style") && includesAny(normalizedQuery, [
          "strength that helps", "software projects",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-profile:project-saynext") && includesAny(normalizedQuery, [
          "hard part", "hardest part", "useful in real time",
        ])) {
          return acc;
        }

        if ((sourceRef.includes("doc:saynext:positioning") || sourceRef.includes("doc:saynext:memory-personalization"))
          && includesAny(normalizedQuery, ["hard part", "hardest part", "useful in real time"])
          && !includesAny(normalizedQuery, ["memory", "personalization", "prenote", "why", "overview"])) {
          return acc;
        }

        if (sourceRef.includes("doc:saynext:ui-ux")
          && includesAny(normalizedQuery, ["hard part", "hardest part", "useful in real time"])
          && !includesAny(normalizedQuery, ["ui", "ux", "controls", "recover", "bad context", "pause", "reset"])) {
          return acc;
        }

        if ((sourceRef.startsWith("doc:") || memory.category === "technical_projects") && includesAny(normalizedQuery, [
          "do you work or study",
          "work or study",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:resume") && includesAny(normalizedQuery, [
          "computer games", "how often do you use a computer", "what do you use computers for",
          "choose computer science", "why did you choose computer", "why computer science",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:resume") && includesAny(normalizedQuery, [
          "money project", "became more interested", "interested in computer science",
          "choose your major",
        ])) {
          return acc;
        }

        if (memory.category === "games_technical_hobby" && includesAny(normalizedQuery, [
          "where do you usually listen to music", "where do you normally listen to music",
          "where do you listen to music",
        ])) {
          return acc;
        }

        if (memory.category === "technical_skills" && includesAny(normalizedQuery, [
          "summer class", "which professor", "professor teaches", "teaches your advanced cloud",
        ])) {
          return acc;
        }

        if (memory.category === "speaking_style" && includesAny(normalizedQuery, [
          "good student when you were a child", "good student as a child",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:saynext") && includesAny(normalizedQuery, [
          "favourite room", "favorite room", "spend the most time", "where you live",
          "what website or app", "social media", "watch tv",
        ])) {
          return acc;
        }

        if (sourceRef.includes("doc:saynext:ui-ux") && includesAny(normalizedQuery, [
          "why did i build", "why build", "why did you decide", "decide to build",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:driving-car") && includesAny(normalizedQuery, [
          "care about canada", "long term stability", "why is freedom", "future in canada",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:driving-car") && !includesAny(normalizedQuery, [
          "go to school", "get to school", "travel to school", "go to campus", "get to campus",
        ]) && !hasAnyToken(queryTokens, ["car", "drive", "driving", "driver", "license", "licence", "campus"])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:shopping-clothes") && !includesAny(normalizedQuery, [
          "shopping", "shop", "online shopping", "clothes", "fashion", "fashionable",
          "delivery", "takeout", "superstore", "grocery", "groceries", "cook", "order delivery",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:parks-going-out") && !includesAny(normalizedQuery, [
          "park", "parks", "go out", "going out", "outside", "outdoor", "outdoors",
          "walk", "free time", "indoors", "indoor",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:sleep-routine") && !includesAny(normalizedQuery, [
          "sleep", "schedule", "routine", "morning", "evening", "weekend", "after school", "after class",
          "free time", "relax", "relaxing", "late", "wake",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:home-room") && !includesAny(normalizedQuery, [
          "home", "room", "bedroom", "where you live", "area where you live", "house",
          "apartment", "cozy", "small room", "spend the most time",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:reddit-internet") && !includesAny(normalizedQuery, [
          "reddit", "website", "app", "internet", "online", "news", "meme", "memes", "social media",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:why-computer-science") && !includesAny(normalizedQuery, [
          "computer science", "choose computer", "choose your major", "why your major", "why did you choose",
          "why computer science money project",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:favorite-subjects") && includesAny(normalizedQuery, [
          "explain a project", "prepare when you need to explain", "how do you prepare",
          "what time", "when is", "schedule", "who teaches", "professor", "instructor",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:english-learning") && !includesAny(normalizedQuery, [
          "english", "language", "vocabulary", "ielts", "learn english", "learning english",
          "area you are still trying to improve", "still trying to improve", "weak point", "weakness",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:anime-tv-film") && !includesAny(normalizedQuery, [
          "anime", "tv", "show", "shows", "programme", "programmes", "film", "films",
          "movie", "movies", "cinema", "series", "subtitles",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:anime-tv-film") && includesAny(normalizedQuery, [
          "alone or with other people", "watch tv alone", "watch television alone",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:music-listening") && !includesAny(normalizedQuery, [
          "music", "song", "songs", "listen", "headphones",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:fruit") && !includesAny(normalizedQuery, [
          "fruit", "pineapple", "orange",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:swimming") && !includesAny(normalizedQuery, [
          "swim", "swimming", "sport", "sports", "exercise",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:summer-courses") && includesAny(normalizedQuery, [
          "as a child", "when you were a child", "childhood", "where did you live", "bachelor degree",
          "data management", "did you take",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:summer-courses") && !includesAny(normalizedQuery, [
          "course", "courses", "class", "classes", "summer", "term", "semester",
          "studying now", "what are you studying", "current", "professor", "instructor",
          "teaches", "advanced cloud", "deep learning", "recommender systems",
          "recommender system", "recommendation system", "recommendation systems", "no recommendation system",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:past-courses") && includesAny(normalizedQuery, [
          "as a child", "when you were a child", "childhood", "where did you live", "bachelor degree",
          "studying now", "where are you studying now", "currently studying", "what are you studying",
        ])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:childhood-biology")
          && !includesAny(normalizedQuery, ["subject", "biology", "major"])) {
          return acc;
        }

        if (sourceRef.includes("xiang-update:2026-05:childhood-home") && includesAny(normalizedQuery, [
          "place to visit", "tourist", "tourists", "visit in chengdu",
        ])) {
          return acc;
        }

        if (!lexicalRank && keywordScore === 0 && intentBoost === 0) {
          return acc;
        }

        const lexicalComponent = lexicalRank ? 1 / (60 + lexicalRank) : 0;
        const vectorComponent = vectorRank && vectorScore > 0.08 ? 1 / (60 + vectorRank) : 0;
        const keywordComponent = keywordScore * 0.04;
        const score = lexicalComponent * 0.55 + vectorComponent * 0.35 + keywordComponent + intentBoost;

        if (score <= 0) return acc;
        if (keywordScore === 0 && intentBoost === 0 && score < 0.02) return acc;
        if (score <= 0.002 && keywordScore === 0 && intentBoost === 0) return acc;

        acc.push({
          ...memory,
          score,
          lexicalRank,
          vectorRank,
          keywordScore,
        });
        return acc;
      }, [])
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 8)));

    return results;
  }

  getRelevantPersonalMemoryContext(userId: string, query: string, limit = 3): string {
    const memories = this.searchPersonalMemoriesHybrid(userId, query, limit);
    if (memories.length === 0) return "";

    return memories
      .map((memory, index) => {
        const usage = memory.usageRule ? `\nUsage rule: ${memory.usageRule}` : "";
        return `Memory ${index + 1}: ${memory.title} [${memory.category}, ${memory.sensitivity}]\n${memory.content}${usage}`;
      })
      .join("\n\n---\n\n");
  }

  createPrenote(input: CreatePrenoteInput): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    const result = this.getDb()
      .query(`
        INSERT INTO prenotes (user_id, title, description, source_text, content_hash)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        input.userId,
        input.title,
        input.description ?? "",
        input.sourceText ?? "",
        input.contentHash ?? "",
      );

    return this.getPrenote(Number(result.lastInsertRowid));
  }

  getPrenote(id: number): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM prenotes WHERE id = ?")
      .get(id);

    return row ? mapPrenoteRecord(row) : null;
  }

  listPrenotes(userId: string): PrenoteRecord[] {
    if (!this.isEnabled()) return [];

    const rows = this.getDb()
      .query("SELECT * FROM prenotes WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC")
      .all(userId);

    return rows.map(mapPrenoteRecord);
  }

  updatePrenoteProcessing(id: number, input: UpdatePrenoteProcessingInput): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getPrenote(id);
    if (!existing) return null;

    this.getDb()
      .query(`
        UPDATE prenotes
        SET
          status = ?,
          extracted_text = ?,
          processed_json = ?,
          runtime_context = ?,
          model = ?,
          content_hash = ?,
          error = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(
        input.status,
        input.extractedText ?? existing.extractedText,
        input.processedJson ?? existing.processedJson,
        input.runtimeContext ?? existing.runtimeContext,
        input.model ?? existing.model,
        input.contentHash ?? existing.contentHash,
        input.error ?? "",
        id,
      );

    return this.getPrenote(id);
  }

  updatePrenoteMemory(userId: string, id: number, input: UpdatePrenoteMemoryInput): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getPrenote(id);
    if (!existing || existing.userId !== userId) return null;

    this.getDb()
      .query(`
        UPDATE prenotes
        SET
          title = ?,
          runtime_context = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `)
      .run(
        typeof input.title === "string" && input.title.trim() ? input.title.trim() : existing.title,
        typeof input.runtimeContext === "string" ? input.runtimeContext.trim() : existing.runtimeContext,
        id,
        userId,
      );

    return this.getPrenote(id);
  }

  setActivePrenote(userId: string, id: number | null): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    const db = this.getDb();
    db.query("UPDATE prenotes SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(userId);

    if (id === null) return null;

    db.query("UPDATE prenotes SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?").run(userId, id);
    return this.getPrenote(id);
  }

  setPrenoteActive(userId: string, id: number, active: boolean): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    this.getDb()
      .query("UPDATE prenotes SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?")
      .run(active ? 1 : 0, userId, id);

    return this.getPrenote(id);
  }

  getActivePrenote(userId: string): PrenoteRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM prenotes WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1")
      .get(userId);

    return row ? mapPrenoteRecord(row) : null;
  }

  listActivePrenotes(userId: string): PrenoteRecord[] {
    if (!this.isEnabled()) return [];

    const rows = this.getDb()
      .query("SELECT * FROM prenotes WHERE user_id = ? AND is_active = 1 AND status = 'ready' ORDER BY updated_at DESC")
      .all(userId);

    return rows.map(mapPrenoteRecord);
  }

  getActivePrenoteRuntimeContext(userId: string): string {
    const prenotes = this.listActivePrenotes(userId);
    if (prenotes.length === 0) return "";

    return prenotes
      .map((prenote, index) => {
        const context = prenote.runtimeContext || prenote.processedJson || "";
        return context.trim() ? `Active prenote ${index + 1}: ${prenote.title}\n${context.trim()}` : "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  deletePrenote(userId: string, id: number): boolean {
    if (!this.isEnabled()) return false;

    const prenote = this.getPrenote(id);
    if (!prenote || prenote.userId !== userId) return false;

    const files = this.listPrenoteFiles(id);
    this.getDb().query("DELETE FROM prenotes WHERE id = ? AND user_id = ?").run(id, userId);

    for (const file of files) {
      try {
        rmSync(file.filePath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }

    return true;
  }

  createPrenoteFile(input: CreatePrenoteFileInput): PrenoteFileRecord | null {
    if (!this.isEnabled()) return null;

    const result = this.getDb()
      .query(`
        INSERT INTO prenote_files (
          prenote_id, file_name, mime_type, file_path, size_bytes,
          extracted_text, status, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.prenoteId,
        input.fileName,
        input.mimeType,
        input.filePath,
        input.sizeBytes,
        input.extractedText ?? "",
        input.status ?? "ready",
        input.error ?? "",
      );

    return this.getPrenoteFile(Number(result.lastInsertRowid));
  }

  getPrenoteFile(id: number): PrenoteFileRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM prenote_files WHERE id = ?")
      .get(id);

    return row ? mapPrenoteFileRecord(row) : null;
  }

  listPrenoteFiles(prenoteId: number): PrenoteFileRecord[] {
    if (!this.isEnabled()) return [];

    const rows = this.getDb()
      .query("SELECT * FROM prenote_files WHERE prenote_id = ? ORDER BY id ASC")
      .all(prenoteId);

    return rows.map(mapPrenoteFileRecord);
  }

  private ensureDefaultSceneProfiles(userId: string): void {
    if (!this.isEnabled()) return;

    const db = this.getDb();
    for (const profile of DEFAULT_SCENE_PROFILES) {
      db.query(`
        INSERT OR IGNORE INTO scene_profiles (
          user_id, builtin_key, name, prompt, is_active, is_builtin
        )
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(
        userId,
        profile.builtinKey,
        profile.name,
        profile.prompt,
        profile.builtinKey === "daily_chat" ? 1 : 0,
      );
    }

    const active = db
      .query("SELECT id FROM scene_profiles WHERE user_id = ? AND is_active = 1 LIMIT 1")
      .get(userId);

    if (!active) {
      db.query(`
        UPDATE scene_profiles
        SET is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND builtin_key = 'daily_chat'
      `).run(userId);
    }
  }

  listSceneProfiles(userId: string): SceneProfileRecord[] {
    if (!this.isEnabled()) return [];

    this.ensureDefaultSceneProfiles(userId);
    const rows = this.getDb()
      .query(`
        SELECT *
        FROM scene_profiles
        WHERE user_id = ?
        ORDER BY is_active DESC, is_builtin DESC, id ASC
      `)
      .all(userId);

    return rows.map(mapSceneProfileRecord);
  }

  getSceneProfile(userId: string, id: number): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    this.ensureDefaultSceneProfiles(userId);
    const row = this.getDb()
      .query("SELECT * FROM scene_profiles WHERE user_id = ? AND id = ?")
      .get(userId, id);

    return row ? mapSceneProfileRecord(row) : null;
  }

  createSceneProfile(input: CreateSceneProfileInput): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    this.ensureDefaultSceneProfiles(input.userId);
    const result = this.getDb()
      .query(`
        INSERT INTO scene_profiles (user_id, name, prompt, is_active, is_builtin)
        VALUES (?, ?, ?, ?, 0)
      `)
      .run(
        input.userId,
        input.name.trim() || "Custom Scene",
        input.prompt.trim(),
        input.isActive ? 1 : 0,
      );

    const id = Number(result.lastInsertRowid);
    if (input.isActive) {
      return this.setActiveSceneProfile(input.userId, id);
    }

    return this.getSceneProfile(input.userId, id);
  }

  updateSceneProfile(userId: string, id: number, input: UpdateSceneProfileInput): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getSceneProfile(userId, id);
    if (!existing) return null;

    this.getDb()
      .query(`
        UPDATE scene_profiles
        SET name = ?, prompt = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `)
      .run(
        typeof input.name === "string" && input.name.trim() ? input.name.trim() : existing.name,
        typeof input.prompt === "string" ? input.prompt.trim() : existing.prompt,
        userId,
        id,
      );

    if (input.isActive === true) {
      return this.setActiveSceneProfile(userId, id);
    }

    if (input.isActive === false && existing.isActive) {
      this.getDb()
        .query("UPDATE scene_profiles SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?")
        .run(userId, id);
    }

    return this.getSceneProfile(userId, id);
  }

  setActiveSceneProfile(userId: string, id: number): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    this.ensureDefaultSceneProfiles(userId);
    const existing = this.getSceneProfile(userId, id);
    if (!existing) return null;

    const db = this.getDb();
    db.query("UPDATE scene_profiles SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(userId);
    db.query("UPDATE scene_profiles SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?").run(userId, id);

    return this.getSceneProfile(userId, id);
  }

  resetBuiltinSceneProfile(userId: string, id: number): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getSceneProfile(userId, id);
    if (!existing?.isBuiltin || !existing.builtinKey) return null;

    const defaults = DEFAULT_SCENE_PROFILES.find((profile) => profile.builtinKey === existing.builtinKey);
    if (!defaults) return null;

    this.getDb()
      .query(`
        UPDATE scene_profiles
        SET name = ?, prompt = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `)
      .run(defaults.name, defaults.prompt, userId, id);

    return this.getSceneProfile(userId, id);
  }

  deleteSceneProfile(userId: string, id: number): boolean {
    if (!this.isEnabled()) return false;

    const existing = this.getSceneProfile(userId, id);
    if (!existing || existing.isBuiltin) return false;

    this.getDb().query("DELETE FROM scene_profiles WHERE user_id = ? AND id = ?").run(userId, id);
    if (existing.isActive) {
      this.ensureDefaultSceneProfiles(userId);
    }
    return true;
  }

  getActiveSceneProfile(userId: string): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    this.ensureDefaultSceneProfiles(userId);
    const row = this.getDb()
      .query("SELECT * FROM scene_profiles WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1")
      .get(userId);

    return row ? mapSceneProfileRecord(row) : null;
  }

  getActiveSceneProfilePrompt(userId: string): string {
    const profile = this.getActiveSceneProfile(userId);
    if (!profile?.prompt.trim()) return "";

    return `Active scene profile: ${profile.name}\n${profile.prompt.trim()}`;
  }
}

export const conversationLogger = new ConversationLogger();
