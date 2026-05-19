import { mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { buildLosslessRuntimeContext, isLosslessPrenoteRuntimeContext } from "../prenotes/prenote-processor";

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

export type SessionMemoryCandidateStatus = "pending" | "approved" | "rejected" | "promoted";

export interface SessionMemoryCandidateRecord {
  id: number;
  userId: string;
  sessionId: string;
  candidateType: string;
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
  validationJson: string;
  status: SessionMemoryCandidateStatus;
  model: string | null;
  rawJson: string;
  contentHash: string;
  promotedMemoryId: number | null;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSessionMemoryCandidateInput {
  userId: string;
  sessionId: string;
  candidateType: string;
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule?: string;
  keywords?: string[];
  evidence?: string[];
  confidence?: number;
  valueScore?: number;
  riskScore?: number;
  validation?: Record<string, unknown>;
  status?: SessionMemoryCandidateStatus;
  model?: string | null;
  rawJson?: string;
  rejectionReason?: string;
}

export interface UpdateSessionMemoryCandidateInput {
  title?: string;
  category?: string;
  sensitivity?: PersonalMemorySensitivity;
  content?: string;
  usageRule?: string;
  keywords?: string[];
  evidence?: string[];
  status?: SessionMemoryCandidateStatus;
  rejectionReason?: string;
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

export interface PrenoteChunkRecord {
  id: number;
  prenoteId: number;
  userId: string;
  chunkIndex: number;
  headingPath: string;
  text: string;
  charStart: number;
  charEnd: number;
  tokenEstimate: number;
  keywords: string[];
  embedding: number[];
  embeddingModel: string;
  contentHash: string;
  createdAt: string;
}

export interface PrenoteChunkSearchResult extends PrenoteChunkRecord {
  prenoteTitle: string;
  score: number;
  lexicalRank?: number;
  vectorRank?: number;
  keywordScore: number;
  tokenOverlapScore: number;
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
const PRENOTE_CHUNK_MAX_CHARS = Number(process.env.PRENOTE_CHUNK_MAX_CHARS || 3600);
const PRENOTE_CHUNK_MIN_CHARS = Number(process.env.PRENOTE_CHUNK_MIN_CHARS || 900);
const PRENOTE_CHUNK_OVERLAP_CHARS = Number(process.env.PRENOTE_CHUNK_OVERLAP_CHARS || 450);
const PRENOTE_RETRIEVAL_TOP_K = Number(process.env.PRENOTE_RETRIEVAL_TOP_K || 4);
const PRENOTE_RETRIEVAL_MAX_CHARS = Number(process.env.PRENOTE_RETRIEVAL_MAX_CHARS || 9000);
const PRENOTE_EMBEDDING_PROVIDER = (process.env.PRENOTE_EMBEDDING_PROVIDER || "auto").toLowerCase();
const PRENOTE_EMBEDDING_MODEL = process.env.PRENOTE_EMBEDDING_MODEL || "text-embedding-3-small";
const PRENOTE_OPENAI_EMBEDDING_BATCH_SIZE = Number(process.env.PRENOTE_OPENAI_EMBEDDING_BATCH_SIZE || 64);
const PRENOTE_QUERY_EMBEDDING_CACHE_TTL_MS = Number(process.env.PRENOTE_QUERY_EMBEDDING_CACHE_TTL_MS || 120000);
const PRENOTE_QUERY_EMBEDDING_CACHE_MAX = Number(process.env.PRENOTE_QUERY_EMBEDDING_CACHE_MAX || 128);
const prenoteQueryEmbeddingCache = new Map<string, { embedding: number[]; model: string; expiresAt: number }>();
export type PrenoteRetrievalMode = "fast" | "semantic";

const DEFAULT_SCENE_PROFILES = [
  {
    builtinKey: "auto",
    name: "Auto",
    prompt: `Scene: Auto

Fast Router mode.
When this profile is active, SayNext chooses Daily Chat, Classroom, Interview, or Meeting locally for each turn.
This profile does not generate replies directly and does not call an extra LLM router.`,
  },
  {
    builtinKey: "daily_chat",
    name: "Daily Chat",
    prompt: `Scene: Daily Chat

Goal:
Help Xiang sound like a relaxed, funny, real person in casual conversation.
The reply should feel reactive and natural, not like an AI answering a prompt.
Sound like someone who uses Reddit, games, memes, and online culture naturally.
It is okay if the answer is slightly incomplete, casual, or imperfect.

Style:
Short, chill, human, low-pressure, and a little funny when it fits.
Use spoken English with everyday words, casual fillers, and relaxed phrasing.
Use medium slang or light internet humor naturally, not in every sentence.
Good tone examples: honestly, probably, kinda, lowkey, not gonna lie, fair enough, pretty chill, cooked, side quest, brain not loading, takeout carrying me.
Default shape: quick reaction + simple answer + one small real-life detail + optional light joke.
Small real-life details are better than life summaries: room, weather, food, sleep, games, class, driving, takeout, Reddit, anime, Halifax.

When to speak:
If someone directly talks to Xiang or asks a casual question, suggest one natural reply.
If the other person is just talking and no reply is needed, keep the output minimal and do not force a fake reply.
For small talk, use 1 sentence.
For normal casual questions, use 1-2 sentences.
For personal "why" or "tell me about" questions, use 2-4 short spoken sentences.
Only ask a return question when it naturally keeps the conversation going.

Avoid:
Do not mention school, projects, career, cloud, AWS, or AI unless the other person directly asks.
Do not sound like an essay, interview answer, motivational speech, or corporate AI.
Do not overexplain.
Do not give unsolicited advice.
Do not turn small talk into a deep personal reflection.
Do not make every reply end with a question.
Do not overuse slang.
Do not use cringe or over-trendy slang like skibidi, sigma, rizz, no cap, or fr fr.`,
  },
  {
    builtinKey: "classroom",
    name: "Classroom",
    prompt: `Scene: Classroom

Goal:
Help Xiang sound like a capable student who can follow the class, answer when asked, and add useful academic or technical value.
The output should make Xiang seem prepared, thoughtful, and professionally aware, but still like a student, not a professor.

Main behavior:
If the teacher directly asks a question, give Xiang a short answer he can say out loud.
If the teacher is explaining a concept, give one useful supplement, example, limitation, trade-off, or clarifying question.
If the class is in tutorial/lab/hands-on mode, give a practical next step, debugging idea, or implementation check.
If classmates or a TA are discussing, add one sentence that helps move the discussion forward.
If there is no useful thing for Xiang to say, keep the output minimal.

Style:
Clear, professional, student-like, and concise.
Sound knowledgeable but not overconfident.
Use one concrete technical detail when useful.
Prefer mechanisms, examples, trade-offs, assumptions, debugging steps, or real-world decision rules.
Do not use Daily Chat slang or meme tone.

Good answer patterns:
"The key difference is..."
"A quick example is..."
"One limitation is..."
"So the trade-off is..."
"In practice, I'd probably..."
"I'd check..."
"Would it be fair to say..."
"Could you clarify..."

Question quality:
When asking a question, make it specific, technically useful, and easy for the instructor to answer.
A good question should include the concept plus the exact uncertainty.
Prefer questions about boundary, trade-off, decision rule, failure mode, validation metric, or misconception check.
Ask one question at a time.
Avoid vague questions like "Can you explain more?" or overly broad questions like "How does this whole system work?"
Do not ask a question just to sound smart. The question should help clarify the lecture or move the class forward.

Good question types:
Boundary:
"When would this approach stop working well?"

Trade-off:
"What is the trade-off between more control and less operational overhead here?"

Decision rule:
"In practice, what signal tells us to choose Lambda instead of ECS?"

Failure mode:
"If this pipeline silently stops processing, what would be the first thing to check?"

Validation / metric:
"How would we measure whether this model is actually generalizing?"

Misconception check:
"Would it be wrong to say Kinesis deletes records after Lambda reads them, or does retention work differently?"

Length:
Direct concept answer: 1-2 sentences.
Lecture supplement: 1 sentence.
Clarifying question: 1 sentence.
Debug/lab help: 1-2 sentences.
Complex explanation only when clearly needed: 3-4 short sentences.

When to speak:
Speak when Xiang is directly asked, when there is a clear knowledge gap, when a useful clarification can be added, or when asking a good question would show real understanding.
If the teacher says "any questions" and the recent lecture contains a specific concept, ask a high-quality question about that concept.
If the professor is mid-explanation and there is no clear gap, do not interrupt with generic filler.
If the transcript is just public lecture content and Xiang is not being addressed, prefer a short understanding note or useful question, not a fake personal reply.

Avoid:
Do not repeat the teacher's words.
Do not start every answer with "I think".
Do not turn every lecture sentence into something Xiang should say.
Do not force Xiang's personal projects unless the teacher asks for Xiang's own example.
Do not overexplain like a full lecture.
Do not sound like an AI tutor.
Do not ask generic questions only to participate.
Do not guess if Xiang clearly does not know.
Do not invent facts, project details, course details, or personal experience.`,
  },
  {
    builtinKey: "interview",
    name: "Interview",
    prompt: `Scene: Interview

Goal:
Help Xiang answer interview questions in a way that sounds clear, grounded, professional, and believable.
Make him sound like a capable junior/new-grad software developer with real project experience, not a senior engineer and not a polished corporate robot.

Core Principle:
The answer should show the process of thinking, not just the final answer.
A strong interview answer should make the interviewer feel:
- Xiang understands the problem.
- Xiang knows what matters technically.
- Xiang can explain decisions clearly.
- Xiang is honest about his experience.
- Xiang can reason through unfamiliar problems.

Main Behavior:
If asked a personal/professional question, answer directly first, then briefly explain.
If asked about a project, use real project details from memory and explain:
problem -> what Xiang built -> technical challenge -> decision/trade-off -> result/lesson.
If asked a technical question, explain:
core mechanism -> practical example -> trade-off / edge case / debugging check.
If asked a behavioral question, use a natural STAR-like structure:
context -> Xiang's role -> action -> result -> lesson.
Do not say "Situation, Task, Action, Result" out loud.
If the question is unclear, ask one short clarifying question before answering.
If Xiang does not have direct experience, be honest, then answer conceptually with how he would approach it.

Style:
Use conclusion-first answers.
Use simple, clear spoken English.
Sound prepared, but still natural.
Use "I" when describing Xiang's own action.
Be specific enough to sound real, but do not overclaim.
Use technical words only when they help.
Prefer practical engineering judgment over textbook definitions.

Answer Length:
Simple interview question: 2-4 sentences.
Technical concept: 3-5 sentences.
Project explanation: 4-6 sentences.
Behavioral story: 5-8 short sentences.
Clarifying question: 1 sentence.
Long mode / teleprompt mode may expand into a full structured answer.

Good Answer Patterns:
"My role was..."
"The main challenge was..."
"I handled it by..."
"The trade-off was..."
"In practice, I would first check..."
"I haven't used it at production scale, but conceptually..."
"What I learned from that was..."
"The reason I chose that approach was..."
"One thing I would improve next time is..."

Technical Interview Rules:
Do not only define terms.
Always connect the concept to real engineering usage.
For system design or cloud questions, mention scalability, latency, cost, reliability, security, or maintainability when relevant.
For debugging questions, mention observation, hypothesis, isolation, fix, and verification.
For coding questions, mention edge cases, complexity, and testing when relevant.
For AI/ML questions, mention data, model behavior, evaluation, limitations, or deployment trade-offs when relevant.

Project Interview Rules:
Use Xiang's real projects when relevant, especially SayNext, JobLens AI, ElderAlbum, DalParkAid, cloud/mobile/web projects, and AI-assisted systems.
For cloud/AWS/serverless questions, JobLens AI or cloud architecture projects are relevant.
For mobile or real-time assistant questions, SayNext is relevant.
For teamwork, planning, UI/UX, or delivery questions, use course/team projects when relevant.
Do not force a project example when the question is purely conceptual.
Do not force a project example for generic IELTS-style life questions such as confidence, home, free time, hobbies, places, childhood, food, weather, or daily routine.
Only use AWS, Lambda, DynamoDB, or specific project names when the question asks about technical experience, projects, work, cloud, mobile apps, debugging, teamwork, or engineering decisions.

Behavioral Interview Rules:
Make stories sound real and modest.
Focus on the decision process, communication, and lesson learned.
For conflict, do not blame teammates. Show clarification, compromise, and follow-up.
For failure, explain what went wrong, what Xiang changed, and what he learned.
For leadership, frame it as ownership or helping the team, not formal authority.
For feedback, show that Xiang listened and improved the work.

Avoid:
Do not exaggerate Xiang's experience.
Do not make Xiang sound senior.
Do not invent company experience, production scale, large user numbers, awards, or leadership titles.
Do not say dream job, passionate, best candidate, strong leader, world-class, or similar empty phrases.
Do not give generic resume-sounding answers.
Do not mention unrelated personal life unless directly asked.
Do not overuse projects when the interviewer asks a direct technical question.
Do not sound like ChatGPT giving a perfect essay.
Do not answer with only buzzwords.

Ideal Tone:
Calm, thoughtful, specific, and honest.
A little imperfect spoken English is okay.
The answer should feel like Xiang understands what he is saying and can defend it.`,
  },
  {
    builtinKey: "meeting_group",
    name: "Meeting / Group Discussion",
    prompt: `Scene: Meeting / Group Discussion

Goal:
Help Xiang say one useful thing that moves the meeting forward.
The output should make Xiang sound reliable, practical, project-aware, and easy to work with.
Do not make him sound like he is giving a speech or trying to dominate the meeting.

Core Principle:
A good meeting response should do at least one of these:
- clarify the current goal
- identify a blocker
- suggest a concrete next step
- confirm a decision
- assign or accept ownership
- reduce risk
- make a trade-off clear
- keep the discussion from drifting

Use Context:
Use the active Live Meeting State when available.
Treat these fields as important meeting memory:
- project/topic
- current goal
- current decision
- open blockers
- known assumptions
- action items
- Xiang responsibility
- next useful move

If Live Meeting State shows a blocker, prioritize unblocking it.
If it shows a decision but no owner/deadline, suggest confirming owner or deadline.
If it shows Xiang's responsibility, help Xiang give progress, ask for missing info, or confirm the next step.
If the meeting topic is unclear, ask one short clarification instead of inventing context.

Main Behavior:
If someone asks Xiang for progress, give a short status update:
what is done -> what is next -> blocker if any.

If the team is stuck, suggest a small unblock step:
mock schema, documented assumption, quick prototype, test case, owner confirmation, or short follow-up.

If people are choosing between options, frame the trade-off:
speed vs quality, flexibility vs simplicity, cost vs reliability, UX vs implementation effort, short-term milestone vs long-term maintainability.

If someone proposes adding more work before fixing a core issue, gently push back and prioritize the blocker.

If there is disagreement, acknowledge the other side and move toward a practical split:
must-have now vs nice-to-have later, quick version now vs improved version later.

If the discussion is vague, make it concrete:
owner, deadline, expected output, API contract, data format, acceptance criteria, or test plan.

If Xiang can take ownership, say it clearly but modestly.
If someone asks Xiang to take "this part" or "that part" but the exact task is not clear from Live Meeting State or recent transcript, do not accept ownership yet. Ask which part they mean.
For unclear "this part" or "that part" requests, start with the clarification. Do not start with "I can take that part."

Style:
Short, direct, practical, and calm.
Default to one sentence.
Use 2 sentences only when needed.
Use technical reasoning when it helps.
Sound like a real teammate, not a manager, consultant, or AI assistant.
Low ego. No corporate buzzwords.
Use simple spoken English.

Length:
Normal meeting reply: 1 sentence.
Progress update: 1-2 sentences.
Technical clarification: 1-2 sentences.
Blocker + next step: 1-2 sentences.
Conflict / disagreement: 2 short sentences.
Do not produce long explanations unless explicitly asked.

Good Patterns:
"I can take that part."
"My main blocker right now is..."
"To unblock this, we can..."
"Maybe we should confirm the schema first."
"I think the safer option for this milestone is..."
"The trade-off is..."
"Can we define who owns this and when it should be done?"
"Should we treat this as must-have or nice-to-have?"
"I can keep going with a mock version, but we should confirm the final API contract."
"That makes sense, but I think we should fix the core bug before adding another feature."

Progress Update Pattern:
"I finished X, I'm working on Y, and the only blocker is Z."

Blocker Pattern:
"The blocker is X. I can use Y temporarily, but we need Z confirmed."

Decision Pattern:
"I think we should go with X for now because it is simpler for this milestone, and we can improve Y later."

Risk Pattern:
"One risk is X, so maybe we should test Y before we commit to it."

Clarification Pattern:
"Just to confirm, are we deciding X today, or only narrowing down the options?"

When to speak:
Speak when Xiang is asked for progress, opinion, blocker, decision, or next step.
Speak when the team is stuck or repeating the same point.
Speak when a useful question can clarify owner, deadline, requirement, schema, or acceptance criteria.
Speak when there is a clear risk that the team has not mentioned.
Speak when Xiang can offer a concrete next step.

When Not to Speak:
Do not reply if others are only chatting casually.
Do not repeat what someone already said.
Do not say generic agreement like "yeah I agree" unless adding a concrete reason.
Do not interrupt a normal explanation unless there is a clear gap or blocker.
Do not invent project details, teammates, deadlines, users, production scale, or technical decisions.
Do not force Xiang's personal projects unless the meeting is clearly about them.

Project Rules:
If the meeting is about SayNext, use SayNext context when relevant:
teleprompt, memory retrieval, scene profiles, prenote, transcript handling, local/travel mode, ASR behavior, response quality, testing, or UI controls.

If the meeting is about JobLens AI, use cloud/AWS/serverless context when relevant:
Lambda, API Gateway, DynamoDB, S3, EventBridge, SQS, Fargate, Terraform, resume parsing, job matching, or application tracking.

If the meeting is about ElderAlbum or DalParkAid, use their project context only when relevant.

If the project is unclear, ask a short clarification.

Avoid:
Do not make long speeches.
Do not sound like a project manager assigning everyone around.
Do not overuse "I think".
Do not sound overly formal or corporate.
Do not say empty phrases like "moving forward", "synergy", "leverage", or "circle back" unless they are naturally necessary.
Do not mention unrelated personal life.
Do not use Daily Chat slang or memes.
Do not answer like an interview response.
Do not summarize the whole meeting unless asked.

Ideal Tone:
Reliable teammate.
Clear thinker.
Practical builder.
Someone who notices blockers and helps the team move.`,
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
  const baseTokens = String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token))
    ?? [];
  const expandedTokens = [...baseTokens];

  for (const token of baseTokens) {
    if (!/[\p{Script=Han}]/u.test(token) || token.length <= 2) continue;
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= token.length - size; index += 1) {
        expandedTokens.push(token.slice(index, index + size));
      }
    }
  }

  return Array.from(new Set(expandedTokens));
}

function expandAsrSearchQuery(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const corrected = raw
    .toLowerCase()
    .replace(/\bexplan\b/g, "explain")
    .replace(/\bprojct\b/g, "project")
    .replace(/\bprojec\b/g, "project")
    .replace(/\bsay\s+next\b/g, "saynext")
    .replace(/\bserver\s+less\b/g, "serverless")
    .replace(/\blamba\b/g, "lambda")
    .replace(/\blamda\b/g, "lambda")
    .replace(/\bcold\s+stared\b/g, "cold start")
    .replace(/\bcold\s+starter\b/g, "cold start")
    .replace(/\belastic\s+cash\b/g, "elasticache")
    .replace(/\belastic\s+cache\b/g, "elasticache")
    .replace(/\bcloud\s+front\b/g, "cloudfront")
    .replace(/\bdynamo\s+db\b/g, "dynamodb")
    .replace(/\bback\s+propagation\b/g, "backpropagation")
    .replace(/\bsuperwise\s+learning\b/g, "supervised learning")
    .replace(/\bsupervise\s+learning\b/g, "supervised learning")
    .replace(/\bdata\s+base\s+in\s+dex\b/g, "database index")
    .replace(/\bdata\s+base\s+index\b/g, "database index")
    .replace(/\barchitexture\b/g, "architecture")
    .replace(/\bmemry\b/g, "memory")
    .replace(/\bmoble\b/g, "mobile")
    .replace(/\btranscrips\b/g, "transcripts")
    .replace(/\btranscrip\b/g, "transcript");

  const expansions = [raw];
  if (corrected !== raw.toLowerCase()) expansions.push(corrected);

  if (/周末|星期六|星期天|礼拜六|礼拜天/.test(raw)) {
    expansions.push("weekend free time games");
  }
  if (/游戏|打游戏|玩游戏|动漫|动画/.test(raw)) {
    expansions.push("games anime homebody");
  }
  if (/睡|作息|几点睡|起床/.test(raw)) {
    expansions.push("sleep schedule routine irregular");
  }

  if (/[\u3400-\u9fff]/.test(raw)) {
    if (/\bdeadline\b/i.test(raw) || /截止|哪天|什么时候|交/.test(raw)) {
      expansions.push("deadline due date final report");
    }
    if (/\broom|location|rehearsal\b/i.test(raw) || /哪里|在哪|房间|教室|地点/.test(raw)) {
      expansions.push("room location rehearsal building");
    }
    if (/\bdemo|rubric\b/i.test(raw) || /演示|展示|评分|要点/.test(raw)) {
      expansions.push("demo rubric mention include");
    }
  }

  if (/[\u3400-\u9fff]/.test(raw) && expansions.length > 1) {
    return expansions.slice(1).join(" ");
  }

  return expansions.join(" ");
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

function normalizeVector(values: number[]): number[] {
  const finite = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const norm = Math.sqrt(finite.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? finite.map((value) => Number((value / norm).toFixed(8))) : finite;
}

async function createPrenoteEmbeddings(texts: string[]): Promise<{ embeddings: number[][]; model: string }> {
  const normalizedTexts = texts.map((text) => String(text || "").slice(0, 12000));
  const shouldUseOpenAI = PRENOTE_EMBEDDING_PROVIDER === "openai"
    || (PRENOTE_EMBEDDING_PROVIDER === "auto" && Boolean(process.env.OPENAI_API_KEY));

  if (shouldUseOpenAI) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      if (PRENOTE_EMBEDDING_PROVIDER === "openai") {
        throw new Error("OPENAI_API_KEY is required for PRENOTE_EMBEDDING_PROVIDER=openai");
      }
    } else {
      try {
        const embeddings: number[][] = [];
        for (let index = 0; index < normalizedTexts.length; index += PRENOTE_OPENAI_EMBEDDING_BATCH_SIZE) {
          const batch = normalizedTexts.slice(index, index + PRENOTE_OPENAI_EMBEDDING_BATCH_SIZE);
          const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: PRENOTE_EMBEDDING_MODEL,
              input: batch,
            }),
          });

          if (!response.ok) {
            throw new Error(`OpenAI embedding request failed: ${response.status} ${await response.text()}`);
          }

          const data = await response.json();
          const batchEmbeddings = [...(data.data ?? [])]
            .sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0))
            .map((item: any) => normalizeVector(Array.isArray(item.embedding) ? item.embedding : []));
          embeddings.push(...batchEmbeddings);
        }

        if (embeddings.length === normalizedTexts.length) {
          return { embeddings, model: PRENOTE_EMBEDDING_MODEL };
        }
      } catch (error) {
        if (PRENOTE_EMBEDDING_PROVIDER === "openai") throw error;
        console.warn(`[Prenote] OpenAI embeddings unavailable, falling back to local hybrid vectors: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  return {
    embeddings: normalizedTexts.map((text) => localHybridEmbedding(text)),
    model: "local-hybrid",
  };
}

async function createPrenoteQueryEmbedding(query: string): Promise<{ embedding: number[]; model: string }> {
  const cacheKey = `${PRENOTE_EMBEDDING_PROVIDER}|${PRENOTE_EMBEDDING_MODEL}|${query.slice(0, 4000)}`;
  const now = Date.now();
  const cached = prenoteQueryEmbeddingCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { embedding: cached.embedding, model: cached.model };
  }

  const result = await createPrenoteEmbeddings([query]);
  const value = { embedding: result.embeddings[0] ?? [], model: result.model };
  if (PRENOTE_QUERY_EMBEDDING_CACHE_TTL_MS > 0) {
    if (prenoteQueryEmbeddingCache.size >= PRENOTE_QUERY_EMBEDDING_CACHE_MAX) {
      const oldestKey = prenoteQueryEmbeddingCache.keys().next().value;
      if (oldestKey) prenoteQueryEmbeddingCache.delete(oldestKey);
    }
    prenoteQueryEmbeddingCache.set(cacheKey, {
      ...value,
      expiresAt: now + PRENOTE_QUERY_EMBEDDING_CACHE_TTL_MS,
    });
  }
  return value;
}

interface BuiltPrenoteChunk {
  chunkIndex: number;
  headingPath: string;
  text: string;
  charStart: number;
  charEnd: number;
  tokenEstimate: number;
  keywords: string[];
  contentHash: string;
}

function estimateChunkTokens(text: string): number {
  return Math.ceil(String(text || "").length / 4);
}

function extractChunkKeywords(text: string, headingPath: string): string[] {
  const tokens = tokenizeSearchText(`${headingPath}\n${text}`);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (token.length < 3) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([token]) => token);
}

function detectPrenoteHeading(block: string): string | null {
  const firstLine = block.split(/\n/).find(Boolean)?.trim() ?? "";
  if (!firstLine) return null;

  const fileBoundary = firstLine.match(/^\[File:\s*(.{1,180})\]$/i);
  if (fileBoundary) return `File: ${fileBoundary[1].trim()}`;

  const markdown = firstLine.match(/^#{1,6}\s+(.{2,120})$/);
  if (markdown) return markdown[1].trim();

  const numbered = firstLine.match(/^(?:chapter|section|part)?\s*\d+(?:\.\d+)*[.)]?\s+(.{3,120})$/i);
  if (numbered) return firstLine.trim();

  if (firstLine.length <= 90 && /[:：]$/.test(firstLine) && block.length <= 220) return firstLine.replace(/[:：]+$/, "").trim();
  if (firstLine.length <= 80 && firstLine === firstLine.toUpperCase() && /[A-Z]{4}/.test(firstLine)) return firstLine;

  return null;
}

function isPrenoteHardBoundary(block: string): boolean {
  const firstLine = block.split(/\n/).find(Boolean)?.trim() ?? "";
  return /^\[File:\s*.{1,180}\]$/i.test(firstLine);
}

function buildPrenoteChunksFromText(text: string): BuiltPrenoteChunk[] {
  const normalized = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) return [];

  const maxChars = Math.max(1200, PRENOTE_CHUNK_MAX_CHARS);
  const minChars = Math.max(300, Math.min(PRENOTE_CHUNK_MIN_CHARS, maxChars));
  const overlapChars = Math.max(0, Math.min(PRENOTE_CHUNK_OVERLAP_CHARS, Math.floor(maxChars / 3)));
  const rawBlocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const chunks: BuiltPrenoteChunk[] = [];
  let chunkText = "";
  let chunkStart = 0;
  let chunkEnd = 0;
  let cursor = 0;
  let headingPath = "";
  let chunkHeading = "";

  const pushChunk = () => {
    const textValue = chunkText.trim();
    if (!textValue) return;
    const keywords = extractChunkKeywords(textValue, chunkHeading);
    chunks.push({
      chunkIndex: chunks.length,
      headingPath: chunkHeading,
      text: textValue,
      charStart: Math.max(0, chunkStart),
      charEnd: Math.max(chunkEnd, chunkStart + textValue.length),
      tokenEstimate: estimateChunkTokens(textValue),
      keywords,
      contentHash: hashMemoryContent(`${chunkHeading}\n${textValue}`),
    });
  };

  const startNewChunkWithOverlap = () => {
    const overlap = overlapChars > 0 && chunkText.length > overlapChars
      ? chunkText.slice(-overlapChars).replace(/^[^\n.?!。！？]*[\n.?!。！？]\s*/, "").trim()
      : "";
    pushChunk();
    chunkText = overlap ? `${overlap}\n\n` : "";
    chunkStart = overlap ? Math.max(0, chunkEnd - overlap.length) : chunkEnd;
    chunkHeading = headingPath;
  };

  const startNewChunkWithoutOverlap = () => {
    pushChunk();
    chunkText = "";
    chunkStart = chunkEnd;
    chunkHeading = headingPath;
  };

  for (const block of rawBlocks) {
    const foundAt = normalized.indexOf(block, cursor);
    const blockStart = foundAt >= 0 ? foundAt : cursor;
    const blockEnd = blockStart + block.length;
    cursor = blockEnd;

    const hardBoundary = isPrenoteHardBoundary(block);
    if (hardBoundary && chunkText.trim()) {
      startNewChunkWithoutOverlap();
    }

    const heading = detectPrenoteHeading(block);
    if (heading) headingPath = heading;

    if (block.length > maxChars) {
      if (chunkText.trim()) {
        if (hardBoundary) startNewChunkWithoutOverlap();
        else startNewChunkWithOverlap();
      }
      for (let start = 0; start < block.length; start += Math.max(1, maxChars - overlapChars)) {
        const slice = block.slice(start, start + maxChars);
        chunkText = slice;
        chunkStart = blockStart + start;
        chunkEnd = Math.min(blockEnd, blockStart + start + slice.length);
        chunkHeading = headingPath;
        pushChunk();
      }
      chunkText = "";
      chunkStart = blockEnd;
      chunkEnd = blockEnd;
      chunkHeading = headingPath;
      continue;
    }

    const nextText = chunkText ? `${chunkText}\n\n${block}` : block;
    if (chunkText && nextText.length > maxChars && chunkText.length >= minChars) {
      startNewChunkWithOverlap();
    }

    if (!chunkText.trim()) {
      chunkStart = blockStart;
      chunkHeading = headingPath;
    }
    chunkText = chunkText ? `${chunkText}\n\n${block}` : block;
    chunkEnd = blockEnd;
  }

  pushChunk();
  return chunks;
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

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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

function isPersonalOrProjectMemoryQuery(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasAnonymousSpeakerLabel = /\b[A-Z]:\s/.test(query);

  if (!normalized) return false;
  if (isExplicitGeneralTechnicalQuestion(normalized)) return false;
  if (!/\b(xiang|you|your|yours|yourself|my|me|i)\b/.test(normalized)
    && /^(who developed|who created|who invented|who released|when was|where was)\b/.test(normalized)) {
    return false;
  }
  if (!/\b(xiang|you|your|yours|yourself|my|me|i)\b/.test(normalized)
    && /^(what is|what was|what are|what does|explain|define|give me a general definition)\b/.test(normalized)) {
    return false;
  }
  if (hasAnonymousSpeakerLabel && !includesAny(normalized, [
    "xiang", "saynext", "say next", "elderalbum", "elder album", "joblens", "job lens",
    "dalparkaid", "dal park", "interview question", "candidate",
  ])) {
    return false;
  }
  if (isLikelyThirdPartyTranscript(normalized) || isLikelyPublicMonologue(normalized) || isLikelyCompleteDialogueExcerpt(normalized)) {
    return false;
  }

  if (includesAny(normalized, [
    "saynext", "say next", "elderalbum", "elder album", "joblens", "job lens",
    "dalparkaid", "dal park", "my project", "your project", "my app", "your app",
    "my application", "your application", "my experience", "your experience",
    "what project you did", "project you did", "project did you do",
    "project you made", "project you built", "project for next",
    "my background", "your background", "about yourself", "tell me about yourself",
    "introduce yourself", "resume", "cv", "portfolio", "scene profile",
    "scene profiles", "prenote", "personal memory", "memory retrieval",
    "automatic context detection", "context detection",
    "hybrid search memory assistant", "hybrid search", "context aware ai assistance",
    "context-aware ai assistance", "realtime ai assistant", "real-time ai assistant",
    "ai assistant idea", "ai assistant origin", "blood donation management system",
    "ai meeting monitor",
    "food allergy", "food allergies", "dietary restriction", "dietary restrictions",
    "non-refundable deposit", "deposit now", "send the deposit", "lease addendum",
    "payment terms", "landlord says", "formal speaking", "formal event",
    "ceremony", "wedding toast", "graduation intro", "self introduction",
    "classroom question", "ask in class", "questions do you ask in class",
    "professor asks if there are any questions", "any questions after explaining",
    "what kind of question should i ask", "question should i ask after",
    "after a lecture", "lecture about",
    "family property", "family money", "property rent", "mother communication",
    "target role", "full-stack developer", "full stack developer",
    "remote-friendly", "workplace preference", "team style fits you",
    "technical areas are you more and less experienced", "more and less experienced",
    "more experienced", "less experienced", "skill confidence", "experienced in",
    "motivation pattern", "work rhythm", "interest-triggered", "interest triggered",
    "stable grinder", "project mode", "hyperfocus", "all-nighter", "all nighter",
    "manager check-ins", "manager check ins", "monitored while working",
    "forced online responsiveness", "social confidence", "simulate conversations",
    "conversation preparation", "envy socially", "envy in conversation",
    "envy in english speaking", "self-esteem", "self image", "self-image",
    "feel dumb", "technical genius", "star engineer", "reliable contributor",
    "practical developer", "want people to think", "about your ability",
    "observer of the world", "future preference", "work culture do you fear",
    "what kind of future", "lifestyle and work environment",
    "high-pressure work culture", "competitive grind culture", "private space",
    "english social embarrassment", "english social failure", "constant awkwardness",
    "high school adaptation", "english adaptation", "insecurity from high school",
    "driving learning", "learned driving", "summer 2024", "naturally talented",
    "surprisingly naturally talented", "talented at driving", "local canadian", "canadian identity", "culturally integrated",
    "halifax home", "home feeling", "feel like home", "ai not a toy", "not a toy",
    "not just a toy", "ai was not just a toy", "when did you first feel ai",
    "gpt-3", "gpt3", "fixed programmed responses", "hardcoded replies",
    "observation ability", "hidden problems", "right questions", "mr. jiang",
    "mr jiang", "jiang xiansheng", "蒋先生", "mentor", "study abroad",
    "recommendation letter", "hidden insecurities", "afraid people discover",
    "afraid people will discover", "worry others may discover",
    "not smart enough", "not social", "not independent", "emotional comfort",
    "instrumental music", "orchestral music", "genshin bgm", "genshin music",
    "first presentation panic", "presentation panic", "history class presentation",
    "phone translator", "read from translator", "first snow walk home",
    "walking home alone in snow", "home alone in snow", "snow memory",
    "solo travel", "travel alone", "traveling alone", "tourism preference",
    "traveled much", "travelled much", "not traveled much", "not travelled much",
    "ideal type", "relationship preference", "separate finances", "no kids",
    "relationship style",
    "developer identity", "frontend developer", "ui finally looks good",
    "user experience", "frontend less", "true happiness", "real happiness", "really happy",
  ])) {
    return true;
  }

  if (isBehavioralStoryQuestion(normalized)) return true;

  if (/\b(where|what|which|when|why|how|who)\s+(did|do|are|were|was|is|influenced)\s+(you|your)\b/.test(normalized)) {
    return true;
  }

  if (/\b(do|did|are|were|would|will|can|could)\s+you\b/.test(normalized) && includesAny(normalized, [
    "like", "prefer", "play", "watch", "read", "study", "student", "work", "drive", "cook",
    "eat", "sleep", "live", "go out", "travel", "learn", "use", "listen",
    "ask", "envy", "want", "fear",
  ])) {
    return true;
  }

  if (includesAny(normalized, [
    "your school", "your high school", "your university", "your college", "your major",
    "your program", "your course", "your class", "your professor", "your instructor",
    "your schedule", "your summer term", "your job", "your career", "your dream job",
    "your family", "your mother", "your mom", "your father", "your dad", "your sister",
    "your hometown", "your birthplace", "your childhood", "your room", "your bedroom",
    "your home", "your car", "your license", "your favourite", "your favorite",
    "your hobby", "your hobbies", "your games", "your music", "your english",
    "your personality", "your lifestyle",
    "my school", "my high school", "my university", "my major", "my course",
    "my class", "my family", "my hometown", "my childhood", "my room",
    "my car", "my english", "my job", "my career",
    "what were you like as a kid", "as a kid", "when you were a kid",
    "your friend", "your friends", "your best friend", "your host family",
    "your homestay", "your roommate", "your roommates", "your restaurant",
    "your restaurants", "your drink", "your drinks", "what language",
    "which language",
  ])) {
    return true;
  }

  if (includesAny(normalized, [
    "what games", "what game", "which game", "what food", "what music",
    "what anime", "what tv", "what movie", "what website", "what app",
    "what kind of games", "what kind of game", "what kind of job", "what kind of work",
    "what kind of clothes", "clothes do you usually wear", "what do you usually wear",
    "clothes do you wear", "clothes do you like wearing",
    "what kind of role", "role are you looking for", "what role are you looking for",
    "what do you usually",
    "what do you often", "what do you normally", "how often do you",
    "how did you improve your english", "why did you choose computer science",
    "why computer science", "when did you move to canada", "after moving to canada",
    "before canada", "high school in china", "high school after moving",
    "where did you study", "where are you studying", "what are you studying",
    "what is your major", "what major", "which major", "what program",
    "which program", "program are you in", "major are you in",
    "what degree", "which degree", "what subject do you study",
    "what school you studying", "high school you studying in china",
    "do you work or study", "work or study", "free time", "weekend",
    "spend your free time", "spending free time", "indoors or outdoors",
    "most expensive item", "ever bought", "favourite room", "favorite room",
    "favourite subject", "favorite subject", "play any musical instrument",
    "good at any sport", "any sport", "what sport", "which sport",
    "what restaurants", "which restaurants", "where do you eat",
    "what do you cook", "what do you drink", "what language",
    "which language", "learn another language",
    "good student", "who influenced you", "influenced you during undergrad",
    "get around during undergrad", "how did you get around",
    "proudest achievement", "most proud", "lowest period", "difficult period",
    "technical strength", "technical strengths", "technical weakness", "technical weaknesses",
    "leetcode", "procrastinate", "procrastination", "ai assisted development",
    "ai-assisted development", "preferred ai workflow", "disliked ai response",
    "communication style", "communication styles", "prefer being alone",
    "prefer solitude", "ideal day", "first real software project",
    "first software project", "first english confidence", "confidence speaking english",
    "feel confident speaking english", "translation software", "childhood period",
    "remember most warmly", "warmest period",
    "food allergy", "food allergies", "dietary restriction", "allergic to",
    "send the deposit", "pay the deposit", "non-refundable deposit", "lease addendum",
    "payment terms", "formal speaking", "formal event", "ceremony", "wedding toast",
    "graduation intro", "self introduction", "classroom question", "ask in class",
    "questions do you ask in class", "professor asks if there are any questions",
    "any questions after explaining", "what kind of question should i ask",
    "question should i ask after", "after a lecture", "lecture about",
    "family property", "family money", "property rent",
    "mother communication", "target role", "full-stack developer",
    "full stack developer", "remote-friendly", "workplace preference",
    "team style fits you", "technical areas are you more and less experienced",
    "more and less experienced", "more experienced", "less experienced",
    "skill confidence", "experienced in",
    "motivation pattern", "work rhythm", "interest-triggered", "interest triggered",
    "stable grinder", "project mode", "hyperfocus", "all-nighter", "all nighter",
    "manager check-ins", "manager check ins", "monitored while working",
    "forced online responsiveness", "social confidence", "simulate conversations",
    "conversation preparation", "envy socially", "envy in conversation",
    "envy in english speaking", "self-esteem", "self image", "self-image",
    "feel dumb", "technical genius", "star engineer", "reliable contributor",
    "practical developer", "want people to think", "about your ability",
    "observer of the world", "future preference", "work culture do you fear",
    "what kind of future", "lifestyle and work environment",
    "high-pressure work culture", "competitive grind culture", "private space",
    "english social embarrassment", "english social failure", "constant awkwardness",
    "high school adaptation", "english adaptation", "insecurity from high school",
    "driving learning", "learned driving", "summer 2024", "naturally talented",
    "surprisingly naturally talented", "talented at driving", "local canadian", "canadian identity", "culturally integrated",
    "halifax home", "home feeling", "feel like home", "ai not a toy", "not a toy",
    "not just a toy", "ai was not just a toy", "when did you first feel ai",
    "gpt-3", "gpt3", "fixed programmed responses", "hardcoded replies",
    "observation ability", "hidden problems", "right questions", "mr. jiang",
    "mr jiang", "jiang xiansheng", "蒋先生", "mentor", "study abroad",
    "recommendation letter", "hidden insecurities", "afraid people discover",
    "afraid people will discover", "worry others may discover",
    "not smart enough", "not social", "not independent", "emotional comfort",
    "instrumental music", "orchestral music", "genshin bgm", "genshin music",
    "project you did for next", "project did for next", "small project you made",
    "小时候", "幼儿园", "初中", "高中", "本科", "学习", "语言", "德语",
    "日语", "足球", "游泳", "餐厅", "肯德基", "炸鸡", "咖喱", "麻辣烫",
    "饮料", "代可", "朋友", "住家", "室友", "电动自行车",
  ])) {
    return true;
  }

  if (/^(describe|descrip|descripe|talk about|tell me about)\b/.test(normalized) && includesAny(normalized, [
    "room", "place", "person", "friend", "family", "childhood", "school",
    "teacher", "home", "city", "hometown", "item", "thing", "gift", "skill",
    "game", "movie", "film", "book", "website", "app", "music", "sport",
    "food", "trip", "holiday", "experience", "memory", "favourite", "favorite",
    "expensive", "bought",
  ])) {
    return true;
  }

  if (/\bielts\b/.test(normalized) && includesAny(normalized, [
    "room", "place", "person", "friend", "family", "childhood", "school",
    "teacher", "home", "city", "hometown", "item", "thing", "gift", "skill",
    "game", "movie", "film", "book", "website", "app", "music", "sport",
    "food", "trip", "holiday", "experience", "memory", "favourite", "favorite",
    "expensive", "bought",
  ])) {
    return true;
  }

  if (wordCount <= 8 && includesAny(normalized, [
    "what school", "what high school", "what game", "what project", "which project",
    "what course", "what class", "where from", "where are you from",
  ])) {
    return true;
  }

  return false;
}

function shouldSkipPersonalMemorySearch(query: string): boolean {
  const normalized = query.toLowerCase();

  if (includesAny(normalized, [
    "what restaurant", "which restaurant", "your restaurant", "restaurants do you",
    "what food", "what do you cook", "what do you drink", "your drink",
    "host family", "homestay", "your roommate", "your friend", "your friends",
    "what language", "which language", "languages have you learned",
    "小时候", "语言", "餐厅", "饮料", "住家", "室友",
  ])) {
    return false;
  }

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
    "can you hear me",
    "mic work",
    "mic working",
    "microphone work",
    "microphone working",
    "is my mic",
    "is the mic",
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
    "public lecture",
    "summarize this lecture",
    "summarize this public lecture",
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

  const spacedPunctuationCount = (query.match(/\s[.,!?]\s/g) ?? []).length;
  if (spacedPunctuationCount >= 3 && includesAny(normalized, [
    "same problem here",
    "brothers and sisters",
    "hand-me-downs",
    "oldest and youngest child",
    "oldest was going to college",
  ])) {
    return true;
  }

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
    "lack of personal property",
    "three quarters of my wardrobe",
    "age gap is also annoying",
    "last child was born",
  ])) {
    return true;
  }

  return false;
}

function isLikelyExternalLearningTranscript(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const rawWordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (rawWordCount < 8) return false;

  if (includesAny(normalized, [
    "xiang",
    "my project",
    "your project",
    "my experience",
    "your experience",
    "about yourself",
    "tell me about yourself",
    "your family",
    "my family",
  ])) {
    return false;
  }

  return includesAny(normalized, [
    "professor",
    "students",
    "all of you",
    "you guys",
    "can anyone",
    "does anyone",
    "any questions",
    "today we're",
    "today we are",
    "today's lecture",
    "lecture",
    "this class",
    "this course",
    "week two",
    "ta",
    "assignment",
    "homework",
  ]);
}

function isBehavioralStoryQuestion(query: string): boolean {
  const normalized = query.toLowerCase();
  if (/\b(proudest achievement|most proud|what are you proud of|what is your proudest achievement|what accomplishment are you proud)\b/i.test(normalized)
    && !/\b(time|example|project|work|interview|behavioral|tell me about)\b/i.test(normalized)) {
    return false;
  }

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
    "prompt design",
    "design that did not work",
    "first design was too rigid",
    "constructive feedback",
    "feedback have you received",
    "feedback that changed",
    "sounded too ai-like",
    "answer sounded too ai-like",
    "leadership",
    "ownership",
    "taking ownership",
    "take ownership",
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
    "prioritize",
    "prioritise",
    "several deadlines",
    "paused one feature",
    "pause one feature",
    "finish something more important",
    "trade-off you made",
    "tradeoff you made",
    "cost and reliability",
    "local mode",
    "travel mode",
    "vague requirements",
    "requirements are vague",
    "unclear idea",
    "why did you add prenote",
    "why did you add scene",
    "prenote and scene profile",
    "prenote and scene profiles",
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

function isResponsePlaybookQuestion(query: string): boolean {
  const normalized = query.toLowerCase();
  const hasActionOrPressurePrompt = includesAny(normalized, [
    "what should i say",
    "how should i answer",
    "what should we do",
    "what do we do",
    "what would you do",
    "how would you handle",
    "how do you handle",
    "how should i handle",
    "how should we handle",
    "how would you approach",
    "how should i approach",
    "how should we approach",
    "what is the best next step",
    "what should be the next step",
    "right now",
  ]);

  if (!hasActionOrPressurePrompt && (isGeneralTechnicalConceptQuestion(query) || isLikelyGeneralTechnicalLecture(query))) {
    return false;
  }

  return includesAny(normalized, [
    "what should i say",
    "how should i answer",
    "what should we do",
    "what do we do",
    "what would you do",
    "how would you handle",
    "how do you handle",
    "how should i handle",
    "how should we handle",
    "how would you approach",
    "how should i approach",
    "how should we approach",
    "what is the best next step",
    "what should be the next step",
    "right now",
    "blocker",
    "blocked",
    "stuck",
    "pressure",
    "deadline",
    "scope",
    "cut scope",
    "demo",
    "presentation tomorrow",
    "before the demo",
    "before presentation",
    "requirements are unclear",
    "unclear requirement",
    "vague requirement",
    "api contract",
    "contract keeps changing",
    "integration issue",
    "integration problem",
    "team conflict",
    "teammate conflict",
    "disagreement",
    "different ideas",
    "feedback",
    "code review",
    "harsh feedback",
    "hard bug",
    "debug this",
    "debugging approach",
    "not responsive",
    "unresponsive teammate",
    "waiting for information",
  ]);
}

function isGeneralTechnicalConceptQuestion(query: string): boolean {
  const normalized = query.toLowerCase();
  const explicitGeneral = isExplicitGeneralTechnicalQuestion(query);

  if (/\bielts\b/.test(normalized)) {
    return false;
  }

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
    "clustering",
    "google news clustering",
    "related news articles",
    "unlabeled data",
    "anomaly detection",
    "reinforcement learning",
    "learning from trial and error",
    "reward function",
    "policy gradient",
    "prompt engineering",
    "in-context learning",
    "few-shot learning",
    "chain of thought",
    "rag",
    "retrieval augmented generation",
    "vector database",
    "fine tuning",
    "fine-tuning",
    "model training",
    "data management practices",
    "foundation model",
    "cloud security",
    "object storage",
    "what is an object",
    "containerd",
    "container runtime",
    "container registry",
    "docker hub",
    "kubernetes",
    "config map",
    "configmap",
    "secret manager",
    "guided lab",
    "challenge lab",
    "load balance",
    "cloudfront",
    "route 53",
    "primary database",
    "secondary database",
    "database replication",
    "network partition",
    "data processing on cloud",
    "s3 path",
    "s3 source",
    "iam role",
    "aws services",
    "aws resources",
    "access key id",
    "secret access key",
    "kinesis",
    "kinesis data streams",
    "kds",
    "kafka",
    "partition",
    "partitions",
    "vpc endpoint",
    "interface endpoint",
    "gateway endpoint",
    "privatelink",
    "private link",
    "direct connect",
    "vpn",
    "private network",
    "private net",
    "public internet",
    "security group",
    "network acl",
    "nacl",
    "stateful",
    "stateless",
    "subnet",
    "subnets",
    "public subnet",
    "private subnet",
    "application server",
    "app server",
    "database server",
    "internet gateway",
    "nat gateway",
    "route table",
    "cidr",
    "elastic ip",
    "public ip",
    "ami",
    "amazon machine image",
    "instance type",
    "autoscaling",
    "vmware",
    "elastic beanstalk",
    "beanstalk",
    "fargate",
    "ecs",
    "eks",
    "ecr",
    "dns resolver",
    "edge location",
    "point of presence",
    "consumer group",
    "offset tracking",
    "partition key",
    "shard",
    "broker",
    "firehose",
    "flink",
    "lambda layer",
    "lambda layers",
    "docker image",
    "container image",
    "buildspec",
    "appspec",
    "codecommit",
    "codebuild",
    "codedeploy",
    "codepipeline",
    "codedeploy agent",
    "deployment group",
    "codedeploy application",
    "presigned url",
    "s3 vectors",
    "opensearch",
    "glacier",
    "efs",
    "lifecycle policy",
    "rds standby",
    "read replica",
    "multi az standby",
    "cloud hosted model",
    "hard drive",
    "disk size",
    "volume size",
    "resize partitions",
    "one frame",
    "multiple frames",
    "pattern movement",
    "general ai application",
    "general ai applications",
    "ai application architecture",
    "business reason",
    "new version",
    "infrastructure as code",
    "iac",
    "terraform",
    "cloudformation",
    "cloud formation",
    "hcl",
    "hashicorp configuration language",
    "state file",
    "tfstate",
    "terraform init",
    "terraform plan",
    "terraform apply",
    "terraform destroy",
    "provider block",
    "resource block",
    "aws_vpc",
    "aws_subnet",
    "aws_instance",
    "user data",
    "aws cli",
    "access key",
    "secret access key",
    "session token",
    "learner lab",
    "learnlab",
    "port 80",
    "port 22",
    "port 3306",
    "mysql port",
    "react",
    "react native",
    "component",
    "components",
    "props",
    "state visible",
    "text input",
    "radio button",
    "navigation",
    "navigator",
    "route",
    "routes",
    "login route",
    "login component",
    "firebase auth",
    "useeffect",
    "use effect",
    "usestate",
    "use state",
    "dependency array",
    "screen",
    "screens",
    "wireframe",
    "prototype",
    "prototyping",
    "low fidelity",
    "medium fidelity",
    "high fidelity",
    "user experience",
    "usability",
    "ui design",
    "gesture",
    "animation",
    "sensor",
    "sensors",
    "gesture detector",
    "gestures",
    "rotation",
    "rotations",
    "x y z",
    "ui thread",
    "async",
    "promise",
    "database schema",
    "schema",
    "table",
    "tables",
    "field",
    "fields",
    "column",
    "columns",
    "attribute",
    "attributes",
    "primary key",
    "auto-increment",
    "cache",
    "caching",
    "data persistence",
    "restful",
    "rest api",
    "api",
    "apis",
    "pos system",
    "payment systems",
    "shopping cart",
    "checkout",
    "web client",
    "web server",
    "html",
    "url",
    "port number",
    "fragment",
    "path representing",
    "fetch data",
    "https",
    "http",
    "sender",
    "receiver",
    "channel",
    "decode",
    "decoding",
    "data center",
    "data centers",
    "virtualization",
    "cpu",
    "gpu",
    "virtual gpu",
    "virtual machine",
    "cuda",
    "opencl",
    "container",
    "containers",
    "container image",
    "docker image",
    "distributed computing",
    "big data",
    "intellectual property",
    "copyright",
    "contract",
    "ip rights",
    "ai tools",
    "online communication",
    "virtual background",
    "mute",
    "echo",
    "bandwidth",
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
    "conversation assistant", "conversation support", "real time conversation",
    "realtime conversation", "real-time conversation", "live transcript", "live transcripts",
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
    "reinforcement learning", "reward function", "policy", "agent environment",
    "prompt engineering", "in-context learning", "few-shot learning", "chain of thought",
    "rag", "retrieval augmented generation", "vector database", "fine tuning", "fine-tuning",
    "foundation model", "large language model", "llm application",
    "object storage", "containerd", "container runtime", "container registry",
    "docker hub", "kubernetes", "config map", "configmap", "secret manager",
    "guided lab", "challenge lab", "cloudfront", "route 53",
    "load balance", "load balancing", "load balancer",
    "primary database", "secondary database", "database replication",
    "network partition", "data processing on cloud", "s3 path", "s3 source",
    "iam role", "aws services", "aws resources", "access key id", "secret access key",
    "kinesis", "kinesis data streams", "kds", "kafka", "partition", "partitions", "consumer group",
    "offset tracking", "partition key", "shard", "broker", "firehose", "flink",
    "vpc endpoint", "interface endpoint", "gateway endpoint", "privatelink",
    "private link", "direct connect", "vpn", "private network", "private net", "public internet",
    "security group", "network acl", "nacl", "stateful", "stateless",
    "subnet", "subnets", "public subnet", "private subnet", "application server",
    "app server", "database server", "internet gateway", "nat gateway", "route table",
    "cidr", "elastic ip", "public ip", "ami", "amazon machine image", "instance type",
    "elastic beanstalk", "beanstalk", "fargate", "ecs", "eks", "ecr",
    "dns resolver", "edge location", "point of presence",
    "lambda layer", "lambda layers", "docker image", "container image",
    "buildspec", "appspec", "codecommit", "codebuild", "codedeploy",
    "codepipeline", "codedeploy agent", "deployment group", "codedeploy application",
    "presigned url", "s3 vectors",
    "opensearch", "glacier", "efs", "lifecycle policy", "rds standby",
    "read replica", "multi az standby", "cloud hosted model",
    "hard drive", "disk size", "volume size", "one frame", "multiple frames",
    "pattern movement", "general ai application", "general ai applications",
    "ai application architecture", "business reason", "new version",
    "infrastructure as code", "iac", "terraform", "cloudformation", "cloud formation",
    "hcl", "hashicorp configuration language", "state file", "tfstate",
    "terraform init", "terraform plan", "terraform apply", "terraform destroy",
    "provider block", "resource block", "aws_vpc", "aws_subnet", "aws_instance",
    "user data", "aws cli", "access key", "secret access key", "session token", "learner lab", "learnlab",
    "port 80", "port 22", "port 3306", "mysql port",
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
    "reinforcement learning", "reward", "policy", "agent", "environment",
    "prompt engineering", "in-context learning", "few-shot learning", "chain of thought",
    "rag", "retrieval augmented generation", "vector database", "fine tuning", "fine-tuning",
    "foundation model", "cloud security", "model training", "data management practices",
    "object storage", "containerd", "container runtime", "container registry",
    "kubernetes", "config map", "configmap", "secret manager", "cloudfront",
    "primary database", "secondary database", "database replication", "network partition",
    "iam role", "aws services", "aws resources", "access key id", "secret access key",
    "kinesis", "kinesis data streams", "kafka", "partition", "partitions", "consumer group", "offset tracking",
    "firehose", "flink", "lambda layer", "buildspec", "appspec", "codepipeline",
    "codebuild", "codedeploy", "codecommit", "presigned url", "s3 vectors",
    "opensearch", "glacier", "efs", "lifecycle policy", "rds standby",
    "read replica", "cloud hosted model", "vpc endpoint", "interface endpoint",
    "gateway endpoint", "privatelink", "private link", "security group", "network acl",
    "direct connect", "vpn", "private network", "private net", "public internet",
    "nacl", "stateful", "stateless", "subnet", "subnets", "public subnet", "private subnet",
    "application server", "app server", "database server",
    "internet gateway", "nat gateway", "route table", "cidr", "elastic ip",
    "public ip", "ami", "amazon machine image", "instance type", "autoscaling", "vmware", "elastic beanstalk",
    "beanstalk", "fargate", "ecs", "eks", "ecr", "dns resolver", "edge location",
    "point of presence",
    "infrastructure as code", "iac", "terraform", "cloudformation", "cloud formation",
    "hcl", "hashicorp configuration language", "state file", "tfstate",
    "terraform init", "terraform plan", "terraform apply", "terraform destroy",
    "provider block", "resource block", "user data", "aws cli", "session token",
  ]);
}

function isLikelyGeneralTechnicalLecture(query: string): boolean {
  const normalized = query.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean).length;
  if (words < 8) return false;

  if (includesAny(normalized, [
    "xiang", "saynext", "say next", "elderalbum", "elder album", "joblens", "job lens",
    "dalparkaid", "dal park", "my project", "your project", "my app", "your app",
    "my experience", "your experience", "my course", "your course", "my class",
    "your class", "my school", "your school", "my family", "your family",
    "what application did you build", "what app did you build",
    "why do you like", "why did you choose", "favorite", "favourite",
  ])) {
    return false;
  }

  return includesAny(normalized, [
    "aws", "cloud", "ec2", "s3", "lambda", "iam", "vpc", "rds",
    "database", "databases", "storage", "object", "bucket", "data lake",
    "load balance", "load balancing", "load balancer", "auto scaling", "autoscaling", "multi-az", "availability zone",
    "kubernetes", "pod", "pods", "node", "nodes", "cluster", "replica set",
    "container", "containerd", "docker", "config map", "configmap", "secret manager",
    "event bridge", "eventbridge", "sqs", "sns", "cloudfront", "route 53",
    "security", "secure", "encrypt", "access key", "secret access key", "token",
    "kinesis", "kds", "kafka", "partition", "partitions", "consumer group", "offset", "partition key",
    "shard", "broker", "firehose", "flink", "codecommit", "codebuild",
    "codedeploy", "codepipeline", "buildspec", "appspec", "codedeploy agent",
    "deployment group", "codedeploy application",
    "presigned url", "s3 vectors", "opensearch", "glacier", "efs",
    "lifecycle policy", "read replica", "standby", "cloud hosted model",
    "vpc endpoint", "interface endpoint", "gateway endpoint", "privatelink",
    "private link", "direct connect", "vpn", "private network", "private net",
    "public internet", "security group", "network acl", "nacl", "stateful",
    "stateless", "inbound", "outbound", "subnet", "subnets", "public subnet",
    "private subnet", "application server", "app server", "database server",
    "internet gateway", "nat gateway", "route table", "cidr", "elastic ip",
    "public ip", "ami", "amazon machine image", "instance type", "elastic beanstalk",
    "beanstalk", "fargate", "ecs", "eks", "ecr", "dns resolver",
    "edge location", "point of presence",
    "language model", "llm", "prompt", "prompts", "vector database", "rag",
    "supervised learning", "unsupervised learning", "reinforcement learning",
    "computer vision", "image classification", "model training",
    "consistency", "replication", "latency", "caching", "cache", "ttl",
    "hard drive", "disk", "volume", "frame", "frames", "pattern movement",
    "general ai application", "general ai applications", "application architecture",
    "business reason", "new version", "version update", "user feedback",
    "infrastructure as code", "iac", "terraform", "cloudformation", "cloud formation",
    "hcl", "hashicorp configuration language", "state file", "tfstate",
    "terraform init", "terraform plan", "terraform apply", "terraform destroy",
    "provider block", "resource block", "aws_vpc", "aws_subnet", "aws_instance",
    "user data", "aws cli", "session token", "learner lab", "learnlab",
    "port 80", "port 22", "port 3306", "mysql port",
    "react", "react native", "component", "components", "props", "state visible",
    "text input", "radio button", "navigation", "navigator", "route", "routes",
    "login route", "login component", "firebase auth", "useeffect", "use effect",
    "usestate", "use state", "dependency array", "screen", "screens",
    "wireframe", "prototype", "prototyping", "low fidelity", "medium fidelity",
    "high fidelity", "user experience", "usability", "ui design", "gesture",
    "gestures", "gesture detector", "animation", "lottie", "key framing",
    "z-axis", "justify-content", "align-items", "cross axis", "main axis",
    "sensor", "sensors", "rotation", "rotations", "x y z",
    "ui thread", "async", "promise", "database schema", "schema", "table",
    "tables", "field", "fields", "column", "columns", "attribute",
    "attributes", "primary key", "auto-increment", "cache", "caching",
    "data persistence", "restful", "rest api", "api", "apis", "pos system",
    "payment systems", "shopping cart", "checkout", "web client", "web server",
    "html", "url", "port number", "fragment", "path representing",
    "fetch data", "https", "http", "sender", "receiver", "channel", "decode",
    "decoding", "data center", "data centers", "virtualization",
    "cpu", "gpu", "virtual gpu", "virtual machine", "cuda", "opencl",
    "container", "containers", "container image", "docker image", "distributed computing", "big data",
    "intellectual property", "copyright", "contract", "ip rights", "ai tools",
    "online communication", "virtual background", "mute", "echo", "bandwidth",
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
  if (ref.includes("data-engineering-warehousing")
    && (hasAnyToken(tokens, ["etl", "elt"]) || matches(["data warehouse", "star schema", "batch processing", "streaming", "data quality", "data pipeline"]))) {
    boost += 0.24;
  }
  if (ref.includes("os-concurrency") && matches(["process versus thread", "process vs thread", "thread in operating", "operating system thread", "operating system", "concurrency", "parallelism", "deadlock", "mutex", "semaphore", "virtual memory"])) boost += 0.24;
  if (ref.includes("sre-observability") && matches(["logs versus metrics", "logs vs metrics", "sli", "slo", "incident", "alerts", "red metrics", "observability"])) boost += 0.24;
  if (ref.includes("mobile-apps") && matches(["mobile apps", "mobile app", "react native", "offline state", "mobile app performance"])) boost += 0.27;
  if (ref.includes("cs-workplace-role") && matches(["software engineer do", "day to day", "code review", "agile scrum", "product thinking", "engineers"])) boost += 0.24;

  return boost;
}

function knowledgeLectureIntentBoost(query: string, sourceRef: string, tokens: Set<string>): number {
  if (!sourceRef.startsWith("knowledge:lecture:")) return 0;

  const q = query.toLowerCase();
  const ref = sourceRef.toLowerCase();
  const matches = (needles: string[]) => includesAny(q, needles);
  let boost = 0;

  if (ref.includes("kinesis-kafka-streaming") && (matches([
    "kinesis", "kds", "kafka", "data stream", "topic", "partition", "consumer group",
    "offset", "offset tracking", "broker", "partition key", "shard", "retention",
    "ordering", "hot shard",
  ]) || hasAnyToken(tokens, ["kinesis", "kafka", "broker", "shard", "partition", "offset"]))) {
    boost += 0.34;
    if (matches(["lambda", "base64", "base sixty four", "s3 pipeline", "put record", "putrecord", "event and context"])) boost -= 0.14;
  }

  if (ref.includes("kinesis-lambda-s3-pipeline") && matches([
    "kinesis to lambda", "lambda to s3", "kinesis lambda", "putrecord", "put record",
    "partition key", "base64", "base sixty four", "decode", "event context",
    "event and context", "triggered by kinesis", "cloudwatch", "batch size", "trim horizon", "s3 pipeline",
  ])) {
    boost += 0.34;
    if (matches(["runtime", "environment variables", "timeout limits", "timeout", "lambda layers", "docker image"])) boost -= 0.12;
  }

  if (ref.includes("lambda-runtime-layers-docker") && matches([
    "lambda layer", "lambda layers", "docker image", "container image", "runtime",
    "handler", "environment variables", "cloudwatch logs", "timeout", "15 minutes",
    "timeout limits", "package size", "dependency",
  ])) {
    boost += 0.32;
    if (matches(["runtime environment variables", "cloudwatch logs", "timeout limits"])) boost += 0.12;
  }

  if (ref.includes("aws-cicd-codepipeline") && matches([
    "codepipeline", "codebuild", "codedeploy", "codecommit", "buildspec", "appspec",
    "ci cd", "cicd", "pipeline", "artifact", "rollback",
    "deployment group", "codedeploy application", "create an application",
    "application first", "deployment first",
  ])) {
    boost += 0.34;
    if (matches(["codedeploy agent", "agent installed", "installed on ec2", "ec2 user data"])) boost -= 0.13;
  }

  if (ref.includes("cicd-iam-ec2-setup") && matches([
    "codedeploy agent", "ec2 user data", "user data", "httpd", "ruby",
    "instance profile", "trust relationship", "iam role", "codebuild role",
    "codedeploy role", "codepipeline role", "security group", "agent installed", "installed on ec2",
  ])) {
    boost += 0.34;
  }

  if (ref.includes("s3-object-storage-vectors") && matches([
    "s3 object", "object storage", "bucket", "presigned url", "pre signed url",
    "object url", "s3 vectors", "opensearch", "vector database", "static assets",
    "data transfer", "storage class",
  ])) {
    boost += 0.32;
    if (matches(["s3 vectors", "opensearch"])) boost += 0.14;
  }

  if (ref.includes("s3-efs-glacier-lifecycle") && matches([
    "efs", "elastic file system", "glacier", "s3 glacier", "lifecycle policy",
    "standard ia", "archive", "retrieval", "file system", "file storage",
  ])) {
    boost += 0.34;
  }

  if (ref.includes("managed-unmanaged-db-security") && matches([
    "managed database", "managed rds", "unmanaged database", "running my own database", "own database on ec2", "database on ec2",
    "on premise", "on-premise", "sensitive data", "cloud security", "nist",
    "hipaa", "gdpr", "patching", "backups",
  ])) {
    boost += 0.32;
    if (matches(["managed rds", "running my own database", "own database on ec2", "tradeoff between managed"])) boost += 0.14;
  }

  if (ref.includes("rds-ha-backups-dr") && matches([
    "rds", "multi az", "multi-az", "standby", "read replica", "failover",
    "disaster recovery", "route 53", "health check", "backup", "cross region",
    "rpo", "rto",
  ])) {
    boost += 0.34;
    if (matches(["managed rds", "running my own database", "own database on ec2", "tradeoff between managed"])) boost -= 0.16;
  }

  if (ref.includes("cloud-architecture-best-practices") && matches([
    "cloud architecture", "best practices", "auto scaling", "automated recovery",
    "infrastructure as code", "loose coupling", "load balancer", "sqs", "sns",
    "cloudfront", "redis", "ttl", "cache invalidation", "devsecops",
  ])) {
    boost += 0.32;
    if (matches(["redis", "ttl", "cache invalidation", "performance design"])) boost += 0.1;
  }

  if (ref.includes("genai-rag-finetuning") && matches([
    "prompt engineering", "in context learning", "few shot", "rag",
    "retrieval augmented generation", "vector database", "fine tuning", "fine-tuning",
    "genai", "llm application", "foundation model",
  ])) {
    boost += 0.34;
    if (matches(["s3 vectors", "opensearch"])) boost -= 0.16;
  }

  if (ref.includes("llm-api-cloud-security") && matches([
    "llm api", "api token", "api key", "cloud hosted model", "iam role",
    "internal network", "bedrock", "token management", "private access",
  ])) {
    boost += 0.34;
  }

  if (ref.includes("ml-paradigms-supervised-unsupervised-rl") && matches([
    "supervised learning", "supervise learning", "unsupervised learning",
    "reinforcement learning", "trial and error", "reward", "policy", "agent",
    "environment", "chess", "clustering", "anomaly detection", "labels",
  ])) {
    boost += 0.32;
  }

  if (ref.includes("firehose-flink-stream-processing") && matches([
    "firehose", "kinesis firehose", "flink", "apache flink", "stream processing",
    "real time analytics", "delivery stream", "s3 delivery", "stateful processing",
  ])) {
    boost += 0.34;
  }

  if (ref.includes("vpc-subnets-route-tables") && matches([
    "vpc", "subnet", "subnets", "public subnet", "private subnet", "route table", "local route",
    "internet gateway", "nat gateway", "cidr", "availability zone", "0.0.0.0/0",
    "what makes a subnet public", "private route table", "application server",
    "app server", "database server", "multiple subnets",
  ])) {
    boost += 0.34;
  }

  if (ref.includes("security-groups-nacls") && matches([
    "security group", "security groups", "network acl", "nacl", "nacls",
    "stateful", "stateless", "inbound", "outbound", "allow and deny",
    "rule number", "first matching rule", "instance level", "subnet level",
  ])) {
    boost += 0.36;
  }

  if (ref.includes("vpc-endpoints-privatelink") && matches([
    "vpc endpoint", "interface endpoint", "gateway endpoint", "privatelink",
    "private link", "s3 endpoint", "dynamodb endpoint", "aws backbone",
    "internal network", "not public internet", "private network", "private net",
    "public internet",
  ])) {
    boost += 0.36;
  }

  if (ref.includes("vpc-vpn-direct-connect") && matches([
    "direct connect", "vpn", "private network", "private net", "public internet",
    "not public internet", "dedicated connection", "private connection",
    "bandwidth guarantee", "guaranteed bandwidth", "hybrid cloud networking",
  ])) {
    boost += 0.38;
  }

  if (ref.includes("route53-cloudfront-cdn") && matches([
    "route 53", "route fifty three", "dns", "dns resolver", "domain name",
    "health check", "routing policy", "latency routing", "geolocation",
    "cloudfront", "cdn", "edge location", "regional edge cache", "point of presence", "pop",
  ])) {
    boost += 0.34;
    if (matches(["redis", "ttl", "cache invalidation"])) boost -= 0.14;
  }

  if (ref.includes("aws-compute-service-choice") && matches([
    "choose between ec2", "ec2 lambda ecs", "lambda ecs", "eks", "fargate",
    "elastic beanstalk", "beanstalk", "compute service", "serverless",
    "container", "virtual machine", "it depends", "use case", "workload requirements",
  ])) {
    boost += 0.36;
  }

  if (ref.includes("ec2-ami-instance-networking") && matches([
    "ami", "amazon machine image", "golden ami", "marketplace ami",
    "community ami", "instance type", "t3 micro", "cpu", "memory", "storage",
    "network performance", "public ip", "elastic ip", "network interface",
  ])) {
    boost += 0.34;
    if (matches(["s3 object", "object storage", "presigned url", "pre signed url"])) boost -= 0.16;
  }

  if (ref.includes("iac-terraform-cloudformation") && matches([
    "infrastructure as code", "iac", "terraform", "cloudformation", "cloud formation",
    "hcl", "hashicorp configuration language", "state file", "tfstate",
    "cloud agnostic", "aws native", "stack", "stacks", "declarative",
    "configuration drift", "reproducible", "reproduce the environment",
  ])) {
    boost += 0.38;
  }

  if (ref.includes("terraform-aws-lab-resources")) {
    const hasTerraformLabContext = matches([
      "terraform", "main.tf", "provider block", "resource block", "aws_vpc",
      "aws_subnet", "aws_instance", "terraform init", "terraform plan",
      "terraform apply", "terraform destroy", "learner lab", "learnlab",
      "aws cli", "session token", "output variable",
    ]);
    const hasLabResourceTerm = matches([
      "user data", "rds", "mysql", "port 80", "port 22", "port 3306",
      "security group", "public subnet", "private subnet", "internet gateway",
      "ec2 boots", "instance boots",
    ]);
    if (hasTerraformLabContext && (hasLabResourceTerm || matches(["provider block", "resource block", "terraform init", "terraform plan", "terraform apply", "terraform destroy", "aws cli", "session token"]))) {
      boost += 0.38;
    }
  }

  return boost;
}

function highSensitivityAllowed(query: string, memory: Pick<PersonalMemoryRecord, "category" | "keywords" | "title" | "content">): boolean {
  const queryTokens = new Set(tokenizeSearchText(query));
  const normalizedQuery = query.toLowerCase();
  const category = memory.category.toLowerCase();
  const directTriggers = [
    "family", "mother", "mom", "father", "dad", "sister", "brother", "brothers", "sibling", "siblings", "parent", "parents", "child", "childhood", "young", "bullying",
    "kid", "kids", "friend", "friends", "best friend", "host family", "homestay", "roommate", "roommates",
    "influenced", "peer influence", "undergrad", "undergraduate",
    "health", "liver", "weight", "relationship", "girlfriend", "romantic", "dating", "date", "immigration",
    "pr", "residency", "money", "financial", "scam", "private", "stress", "weakness",
    "confidence", "nervous", "anxiety", "future", "long term", "canada", "freedom",
    "solitude", "alone", "communication style", "communication styles", "ideal day",
    "lowest period", "difficult period", "nostalgic", "neighborhood", "neighbourhood",
    "weak english", "english confidence", "translation software",
    "self-esteem", "self image", "self-image", "insecurity", "insecurities", "insecure", "inferiority", "feel dumb",
    "technical genius", "star engineer", "reliable contributor", "practical developer",
    "recognition", "ability", "capable", "capability", "observer of the world",
    "simulate conversations", "conversation preparation", "envy", "social confidence",
    "fluent english", "react quickly",
    "motivation pattern", "work rhythm", "hyperfocus", "all-nighter", "all nighter",
    "manager check-ins", "manager check ins", "monitored", "forced online responsiveness",
    "high-pressure work culture", "competitive grind", "private space", "life direction",
    "english social embarrassment", "english social failure", "constant awkwardness",
    "high school adaptation", "english adaptation", "insecurity from high school",
    "canadian identity", "local canadian", "culturally integrated",
    "study abroad", "mentor", "mr. jiang", "mr jiang", "jiang", "jiang xiansheng",
    "蒋先生", "recommendation letter", "hidden insecurities", "afraid people discover",
    "afraid people will discover", "worry others may discover",
    "not smart enough", "not social", "not independent",
    "presentation panic", "first presentation", "phone translator", "read from translator",
    "dating preference", "relationship preference", "relationship style", "girlfriend", "ideal type",
    "separate finances", "children", "kids", "political values",
    "china political system", "authoritarianism", "dictatorship", "censorship",
    "propaganda", "tiananmen", "great famine", "mao zedong", "xi jinping",
    "return to china", "go back to china",
    "家庭", "父亲", "母亲", "姐姐", "童年", "小时候", "幼儿园", "朋友", "好友", "住家", "寄宿家庭", "室友",
    "家庭", "父亲", "母亲", "姐姐", "童年", "霸凌", "健康", "恋爱", "移民", "永居", "财务",
  ];

  if (category.includes("family_events")) {
    return includesAny(normalizedQuery, [
      "family", "mother", "mom", "father", "dad", "sister", "sibling", "siblings", "parent", "parents",
      "passed away", "liver", "scam", "york", "money", "financial", "partner", "uncle", "zhao",
      "niece", "married", "daughter", "age gap", "lives with",
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

  if (category.includes("presentation_anxiety")) {
    return includesAny(normalizedQuery, [
      "presentation", "public speaking", "panic", "nervous", "history class",
      "phone translator", "translator", "read from", "early canada", "language barrier",
      "embarrassed", "awkward",
    ]);
  }

  if (category.includes("relationship_preference")) {
    return includesAny(normalizedQuery, [
      "relationship", "girlfriend", "dating", "date", "romantic", "ideal type",
      "relationship style", "partner", "marriage", "children", "kids", "finance", "finances",
      "financially separate", "separate finances", "single", "no pressure",
      "autonomy", "freedom",
    ]);
  }

  if (category.includes("political_values_china")) {
    return includesAny(normalizedQuery, [
      "political", "politics", "china political", "chinese political",
      "authoritarian", "authoritarianism", "dictatorship", "censorship",
      "propaganda", "freedom of speech", "tiananmen", "great famine",
      "mao", "mao zedong", "xi jinping", "return to china", "go back to china",
      "don't want to return", "do not want to return", "why not return",
    ]);
  }

  if (category.includes("self_image") || category.includes("social_confidence")) {
    return includesAny(normalizedQuery, [
      "self-esteem", "self image", "self-image", "insecurity", "insecurities", "insecure", "inferiority", "feel dumb",
      "too dumb", "technical genius", "star engineer", "reliable contributor",
      "practical developer", "recognition", "ability", "capable", "capability", "confidence",
      "social confidence", "simulate conversations", "conversation preparation",
      "envy", "speak naturally", "fluent english", "english speaking", "react quickly",
      "knowledgeable", "observer of the world", "social style",
      "interview", "strength", "weakness", "building projects", "built projects",
      "afraid people", "discover", "not smart enough", "not social", "not independent",
    ]);
  }

  if (category.includes("language_identity")) {
    return includesAny(normalizedQuery, [
      "english", "social embarrassment", "social failure", "constant awkwardness",
      "high school adaptation", "english adaptation", "early canada", "weak english",
      "social participation", "insecurity", "ever fully disappear",
    ]);
  }

  if (category.includes("identity_belonging")) {
    return includesAny(normalizedQuery, [
      "canadian identity", "local canadian", "culturally integrated", "native culture",
      "local social culture", "belonging", "isolation", "loneliness", "canada",
    ]);
  }

  if (category.includes("mentor_life_anchor")) {
    return includesAny(normalizedQuery, [
      "mentor", "mr. jiang", "mr jiang", "jiang", "jiang xiansheng", "蒋先生",
      "study abroad", "recommendation", "support materials", "life advice",
      "important person", "turning point", "helped you", "helped xiang",
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

function promotedKnowledgeIntentBoost(query: string, memory: Pick<PersonalMemoryRecord, "category" | "title" | "sourceRef">, tokens: Set<string>): number {
  const sourceRef = memory.sourceRef.toLowerCase();
  const category = memory.category.toLowerCase();
  if (!sourceRef.startsWith("session-memory:") || !category.startsWith("knowledge")) return 0;

  const title = memory.title.toLowerCase();
  const q = query.toLowerCase();
  const matches = (needles: string[]) => includesAny(q, needles);
  const tokenHits = (needles: string[]) => hasAnyToken(tokens, needles);
  let boost = 0;

  if ((title.includes("architecture") || title.includes("e-commerce") || title.includes("ecommerce"))
    && (matches([
      "high availability", "highly available", "low latency", "e-commerce", "ecommerce",
      "cloudfront", "dynamodb global", "global table", "multi az", "multi-az",
      "application load balancer", "auto scaling", "eks",
    ]) || tokenHits(["cloudfront", "dynamodb", "ecommerce", "latency"]))) {
    boost += 0.34;
  }

  if ((title.includes("elasticache") || title.includes("caching"))
    && (matches(["elasticache", "redis", "memcached", "cache invalidation", "database cache", "old data cost"])
      || tokenHits(["elasticache", "redis", "memcached"])
      || (tokenHits(["database"]) && tokenHits(["cache", "caching"])))) {
    boost += 0.43;
  }

  if ((category.includes("security") || title.includes("security") || title.includes("observability"))
    && (matches([
      "secrets manager", "cloudtrail", "vpc flow", "api keys", "network traffic",
      "least privilege", "parameter store",
    ]) || tokenHits(["secrets", "cloudtrail", "audit", "credentials"]))) {
    boost += 0.36;
  }

  if ((category.includes("ai") || category.includes("ml") || title.includes("language model") || title.includes("token prediction"))
    && (matches(["large language model", "language models", "backpropagation", "next token", "next word", "gpt style"])
      || tokenHits(["llm", "gpt"])
      || (tokenHits(["backpropagation"]) && tokenHits(["model", "models", "language"]))
      || (tokenHits(["token", "probability"]) && tokenHits(["llm", "gpt", "word"])))) {
    boost += 0.34;
  }

  return boost;
}

function personalMemoryIntentBoost(query: string, memory: Pick<PersonalMemoryRecord, "category" | "title" | "sourceRef">): number {
  const normalizedQuery = query.toLowerCase();
  const tokens = new Set(tokenizeSearchText(query));
  const category = memory.category.toLowerCase();
  const title = memory.title.toLowerCase();
  const sourceRef = memory.sourceRef.toLowerCase();
  const sayNextPublicProjectIntent = includesAny(normalizedQuery, [
    "saynext", "say next", "hybrid search memory assistant", "hybrid search",
    "what project you did for next", "project you did for next", "project did for next",
    "what project did you do for next", "project you made for next", "conversation assistant",
    "real-time ai assistant", "realtime ai assistant", "real time ai assistant",
    "context-aware ai assistance", "context aware ai assistance", "input token", "input tokens",
    "token cost", "memory retrieval", "personal memory", "prenote", "transcript understanding",
  ]);
  let boost = 0;
  boost += knowledgeInterviewIntentBoost(normalizedQuery, sourceRef, tokens);
  boost += knowledgeLectureIntentBoost(normalizedQuery, sourceRef, tokens);
  boost += promotedKnowledgeIntentBoost(normalizedQuery, memory, tokens);

  if (hasAnyToken(tokens, ["university", "college", "degree", "dalhousie", "acadia", "macs", "program", "study", "studying", "major"]) && category === "identity_education") {
    boost += 0.035;
    if (includesAny(normalizedQuery, [
      "studying now", "study now", "what are you studying", "work or study",
      "program", "at dal", "in dal", "current school", "currently studying",
      "choose your major", "what do you study", "what is your major",
      "what major", "which major", "what program", "which program",
      "program are you in", "major are you in", "what degree",
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
      "car", "cars", "drive", "driving", "license", "licence", "campus", "honda", "civic", "hatchback", "sport", "kentville", "dealership",
    ]) || includesAny(normalizedQuery, [
      "go to school", "get to school", "travel to school", "get to campus", "go to campus",
      "expensive item", "most expensive", "ever bought", "you bought", "bought recently",
    ]))) {
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
    "go to campus", "driver", "license", "licence", "car", "expensive item", "most expensive", "ever bought",
    "honda civic", "hatchback sport", "black car", "kentville", "dealership", "how much was your car",
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
  if (sourceRef.includes("xiang-profile:game-scripting-music") && includesAny(normalizedQuery, [
    "piano scripts", "game scripting", "script in games", "scripts in games", "music scripts in games",
  ])) {
    boost += 0.22;
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

  if (sourceRef.includes("xiang-update:2026-05:music-instruments") && (hasAnyToken(tokens, [
    "instrument", "instruments", "saxophone", "sax", "band", "concert", "performance", "perform", "performed", "harp", "piano", "keyboard",
  ]) || includesAny(normalizedQuery, [
    "play any musical instrument", "played any instrument", "school band", "concert band", "wind band",
    "do you play piano", "can you play piano", "do you play saxophone", "learned harp",
  ]))) {
    boost += 0.14;
  }
  if (sourceRef.includes("xiang-update:2026-05:music-instruments") && includesAny(normalizedQuery, [
    "piano scripts", "game scripting", "script in games", "scripts in games", "music scripts in games",
  ])) {
    boost -= 0.16;
  }

  if (sourceRef.includes("xiang-update:2026-05:family-current-details") && (hasAnyToken(tokens, [
    "family", "mother", "mom", "sister", "sibling", "siblings", "niece", "married", "daughter", "zhao",
  ]) || includesAny(normalizedQuery, [
    "age gap", "older sister", "how old is your sister", "is your sister married",
    "does your sister have a child", "mother partner", "uncle zhao", "mom's partner",
    "after your father passed", "who lives with your mother",
  ]))) {
    boost += 0.14;
  }
  if (sourceRef.includes("xiang-update:2026-05:family-current-details") && includesAny(normalizedQuery, [
    "family business", "family company", "business do", "company after 2018", "factory", "natural gas",
    "what did your sister study", "sister study", "york university", "financial scam",
  ])) {
    boost -= 0.18;
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

  if (sourceRef.includes("xiang-update:2026-05:piano-learning") && includesAny(normalizedQuery, [
    "skill you learned", "learned skill", "new skill", "difficult at first",
    "difficult skill", "learn a skill", "learned a skill", "hobby", "piano",
  ])) {
    boost += 0.13;
  }
  if (sourceRef.includes("xiang-update:2026-05:piano-learning") && includesAny(normalizedQuery, [
    "piano scripts", "game scripting", "script in games", "scripts in games", "music scripts in games",
  ])) {
    boost -= 0.16;
  }

  if (hasAnyToken(tokens, ["deadline", "deadlines", "motivation", "motivated", "procrastinate", "procrastination", "assignment", "work", "polished"]) && category === "motivation_work_style") {
    boost += 0.035;
    if (includesAny(normalizedQuery, ["tight deadline", "school project", "look polished", "useful software", "feel stuck"])) boost += 0.06;
    if (includesAny(normalizedQuery, ["work or study", "travel to work or school"])) boost -= 0.04;
  }

  if (hasAnyToken(tokens, ["stress", "weakness", "confidence", "nervous", "girlfriend", "relationship", "romantic", "dating", "date", "social", "interview"]) && category === "emotional_social" && !normalizedQuery.includes("social media")) {
    boost += 0.04;
  }
  if (sourceRef.includes("xiang-profile:stress-insecurity-romance") && includesAny(normalizedQuery, [
    "react under stress", "reaction under stress", "stress response", "under heavy stress", "how do you react under stress",
  ])) {
    boost += 0.24;
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
    if (includesAny(normalizedQuery, ["skill you learned", "learned skill", "new skill", "difficult at first"])) boost -= 0.04;
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
    if (sourceRef.includes("prompt-failure") && includesAny(normalizedQuery, ["failure", "failed", "mistake", "mistake you made", "lesson", "what did you learn", "too rigid", "prompt", "prompt design", "design that did not work", "first design", "repeat", "repetitive", "ai-like"])) boost += 0.32;
    if (sourceRef.includes("prompt-failure") && includesAny(normalizedQuery, ["long project", "kept improving", "multiple months", "repeated failures"])) boost -= 0.22;
    if (sourceRef.includes("constructive-feedback") && includesAny(normalizedQuery, ["constructive feedback", "feedback", "too formal", "ai-like", "answer sounded too ai-like", "said your answer sounded", "natural", "communication feedback"])) boost += 0.32;
    if (sourceRef.includes("constructive-feedback") && includesAny(normalizedQuery, ["code review", "harsh code review", "senior engineer", "pull request feedback"])) boost -= 0.25;
    if (sourceRef.includes("leadership-ownership") && includesAny(normalizedQuery, ["leadership", "ownership", "taking ownership", "initiative", "led", "lead", "take ownership", "end to end"])) boost += 0.3;
    if (sourceRef.includes("above-and-beyond") && includesAny(normalizedQuery, ["above and beyond", "extra effort", "more than required", "beyond the requirement", "above and beyond the requirements", "went beyond"])) boost += 0.45;
    if (sourceRef.includes("pushed-user-control") && includesAny(normalizedQuery, ["push for", "pushed for", "had to push", "influence", "convince", "manual scene", "scene profile", "user control", "user-controlled", "not fully automatic"])) boost += 0.3;
    if (sourceRef.includes("long-iteration") && includesAny(normalizedQuery, ["persevere", "persevered", "multiple months", "long project", "kept working", "kept improving", "repeated failures", "difficult for a long time", "stuck with"])) boost += 0.45;
    if (sourceRef.includes("overwhelmed-scope-control") && includesAny(normalizedQuery, ["overwhelming", "overwhelmed", "tight deadline", "failed deadline", "deadline", "time management", "too much work", "several deadlines", "several deadlines happen together", "scope control", "cut scope"])) boost += 0.34;
    if (sourceRef.includes("independent-work") && includesAny(normalizedQuery, ["working independently", "work independently", "independent work", "self-directed", "without much guidance", "learn on your own"])) boost += 0.2;
    if (sourceRef.includes("user-impact-reliability") && includesAny(normalizedQuery, ["user impact", "customer impact", "reliability", "privacy", "trust", "customer focus", "user trust", "reliability and user trust", "think about reliability"])) boost += 0.34;
    if (sourceRef.includes("user-impact-reliability") && includesAny(normalizedQuery, ["trade-off", "tradeoff", "between cost and reliability", "cost and reliability"])) boost -= 0.08;
    if (sourceRef.includes("prioritization") && includesAny(normalizedQuery, ["prioritize", "prioritise", "priority", "deadline", "tradeoff", "trade-off", "trade-off you made", "tradeoff you made", "cost", "cost and reliability", "between cost and reliability", "local mode", "travel mode", "split local mode", "split local", "paused one feature", "pause one feature", "more important", "finish something more important"])) boost += 0.42;
    if (sourceRef.includes("vague-requirements") && includesAny(normalizedQuery, ["requirements", "vague", "ambiguity", "unclear", "prenote", "scene profile", "scene profiles", "why did you add prenote", "why did you add scene", "product design"])) boost += 0.34;
    if (sourceRef.includes("vague-requirements") && includesAny(normalizedQuery, ["above and beyond", "above and beyond the requirements", "extra effort"])) boost -= 0.2;
    if (sourceRef.includes("team-disagreement") && includesAny(normalizedQuery, ["conflict", "teammate", "team project", "group project", "disagree", "disagreed", "disagreement", "different ideas", "technical disagreement"])) boost += 0.18;
    if (sourceRef.includes("team-disagreement") && includesAny(normalizedQuery, ["never had a dramatic conflict", "no dramatic conflict", "never had a conflict", "no conflict"])) boost -= 0.25;
    if (sourceRef.includes("team-disagreement") && !includesAny(normalizedQuery, ["conflict", "teammate", "team project", "group project", "disagree", "disagreed", "disagreement", "different ideas", "technical disagreement"])) boost -= 0.12;
    if (sourceRef.includes("achievement") && includesAny(normalizedQuery, ["achievement", "satisfied", "proud", "most proud", "accomplishment", "best shows your product thinking", "project best shows", "product thinking", "difficult but meaningful"])) boost += 0.34;
  }

  if (sourceRef === "knowledge:behavioral-interview:code-review-feedback" && includesAny(normalizedQuery, [
    "code review", "harsh code review", "senior engineer", "pull request feedback",
  ])) {
    boost += 0.45;
  }

  if (sourceRef.startsWith("xiang-update:2026-05-18:")) {
    if (sourceRef.includes("hybrid-search-memory-assistant")
      && includesAny(normalizedQuery, [
        "hybrid search memory assistant", "hybrid search", "real-time ai assistant",
        "realtime ai assistant", "ai assistant idea", "ai assistant origin",
        "translation software", "conversation assistant", "input token", "input tokens",
        "token cost", "memory retrieval", "personal memory", "prenote", "transcript",
        "production users", "revenue",
      ])) {
      boost += 0.32;
    }
    if (sourceRef.includes("hybrid-search-memory-assistant") && sayNextPublicProjectIntent) {
      boost += 0.48;
      if (sourceRef.includes("origin") && includesAny(normalizedQuery, ["why", "origin", "motivation", "decide", "built", "build"])) boost += 0.08;
      if (sourceRef.includes("goal-architecture") && includesAny(normalizedQuery, ["architecture", "how", "technical", "system", "retrieval", "token", "context"])) boost += 0.08;
    }
    if (sourceRef.includes("personal-growth-achievement") && includesAny(normalizedQuery, [
      "proudest achievement", "most proud", "achievement", "accomplishment",
      "lowest period", "difficult period", "struggling international student",
      "turning ideas into real working systems", "working systems",
    ])) boost += 0.28;
    if (sourceRef.includes("technical-strengths-weaknesses") && includesAny(normalizedQuery, [
      "technical strength", "technical strengths", "technical weakness", "technical weaknesses",
      "leetcode", "algorithm", "algorithms", "advanced mathematics", "competitive programming",
      "api integration", "architecture", "practical systems",
    ])) boost += 0.26;
    if (sourceRef.includes("procrastination-project-blockers") && includesAny(normalizedQuery, [
      "procrastinate", "procrastination", "avoid starting", "deadline", "project problems",
      "project blockers", "git conflicts", "unclear requirements", "large codebase",
      "integration confusion",
    ])) boost += 0.26;
    if (sourceRef.includes("ai-assisted-development-workflow") && includesAny(normalizedQuery, [
      "ai assisted development", "ai-assisted development", "preferred ai workflow",
      "disliked ai response", "uncertainty", "pretending to understand", "fake confidence",
      "ai response style", "do you dislike", "useless filler", "inspect files",
      "diff-based", "tdd", "checklists", "human verifies",
    ])) boost += 0.28;
    if (sourceRef.includes("english-confidence-turning-point") && includesAny(normalizedQuery, [
      "english confidence", "confidence speaking english", "first english confidence",
      "feel confident speaking english", "speaking english", "high school", "host family", "weak english", "mentally translating",
      "participate in conversations",
    ])) boost += 0.24;
    if (sourceRef.includes("blood-donation-first-software-project") && includesAny(normalizedQuery, [
      "blood donation", "first real software", "first software project", "asp.net",
      "c#", "database-backed", "backend logic", "form submission", "login session",
    ])) boost += 0.34;
    if (sourceRef.includes("ai-meeting-monitor") && includesAny(normalizedQuery, [
      "ai meeting monitor", "meeting monitor", "meeting summary", "action item",
      "transcript navigation", "react", "typescript", "vite", "integration",
      "stabilized", "stabilised", "a grade", "api coordination",
    ])) boost += 0.34;
    if (sourceRef.includes("solitude-communication-preferences") && includesAny(normalizedQuery, [
      "prefer being alone", "prefer solitude", "solitude", "communication style",
      "communication styles", "preaching", "moral pressure", "forced socialization",
      "fake authority", "low-pressure",
    ])) boost += 0.28;
    if (sourceRef.includes("nostalgic-childhood-neighborhood") && includesAny(normalizedQuery, [
      "nostalgic", "childhood neighborhood", "childhood neighbourhood", "before smartphones",
      "role-playing", "outdoor play", "childhood period", "warmest period",
      "remember most warmly",
    ])) boost += 0.24;
    if (sourceRef.includes("ideal-day-low-pressure") && includesAny(normalizedQuery, [
      "ideal day", "perfect day", "no deadlines", "no work pressure",
      "forced social interaction", "wake up naturally", "low pressure",
    ])) boost += 0.24;
    if (sourceRef.includes("no-food-allergies") && includesAny(normalizedQuery, [
      "food allergy", "food allergies", "allergy", "allergies", "allergic to",
      "dietary restriction", "dietary restrictions", "ingredient check", "restaurant allergy",
    ])) boost += 0.32;
    if (sourceRef.includes("deposit-contract-pressure-risk") && includesAny(normalizedQuery, [
      "deposit", "non-refundable", "non refundable", "lease", "lease addendum",
      "contract", "payment terms", "pay now", "pay quickly", "send the deposit",
      "landlord", "opportunity will disappear", "lose the apartment", "signing",
    ])) boost += 0.32;
    if (sourceRef.includes("family-communication-money-profile") && includesAny(normalizedQuery, [
      "mother", "mom", "late reply", "replied late", "read and not reply",
      "family property", "family money", "property rent", "market rent", "rent",
      "sister", "father", "admire", "family role", "observer", "quiet in family",
      "video call", "play games every day",
    ])) boost += 0.3;
    if (sourceRef.includes("formal-speaking-style") && includesAny(normalizedQuery, [
      "formal speaking", "formal event", "ceremony", "wedding", "toast",
      "graduation", "presentation", "self introduction", "introduce yourself",
      "too official", "corporate", "hr style", "natural speech",
    ])) boost += 0.28;
    if (sourceRef.includes("classroom-question-style") && includesAny(normalizedQuery, [
      "classroom question", "ask in class", "questions do you ask", "any questions",
      "professor asks", "edge case", "architecture question", "clarification",
      "practical implementation", "show off", "would it be", "so basically",
      "what kind of question should i ask", "question should i ask after",
      "after a lecture", "lecture about",
    ])) boost += 0.3;
    if (sourceRef.includes("career-target-workplace-preferences") && includesAny(normalizedQuery, [
      "target role", "career", "job do you want", "kind of job", "what kind of job",
      "full-stack", "full stack", "workplace", "remote-friendly", "remote friendly",
      "company style", "team style", "backend", "database", "cloud deployment",
      "devops", "security", "machine learning", "ml", "technical areas",
      "more and less experienced", "more experienced", "less experienced",
      "which technical areas", "skill confidence", "experienced in",
    ])) boost += 0.28;
    if (sourceRef.includes("motivation-energy-work-rhythm") && includesAny(normalizedQuery, [
      "motivation pattern", "work rhythm", "interest-triggered", "interest triggered",
      "stable grinder", "long-term grinder", "cool", "futuristic", "technically interesting",
      "mental exhaustion", "project mode", "hyperfocus", "all-nighter", "all nighter",
      "manager check-ins", "manager check ins", "monitored while working",
      "forced online responsiveness", "constant check-ins", "why some technical topics excite",
    ])) boost += 0.34;
    if (sourceRef.includes("social-confidence-conversation-prep") && includesAny(normalizedQuery, [
      "social confidence", "conversation preparation", "simulate conversations",
      "mentally simulate", "envy socially", "envy in conversation", "envy in english speaking",
      "speak naturally", "fluent english", "react quickly",
      "appear intelligent", "knowledgeable", "observer of the world",
      "transactional social relationships", "forced socializing",
    ])) boost += 0.34;
    if (sourceRef.includes("recognition-self-image-capability") && includesAny(normalizedQuery, [
      "self-esteem", "self image", "self-image", "recognition", "want people to think",
      "about your ability", "ability", "feel insecure", "feel dumb", "too dumb",
      "technical genius", "star engineer",
      "technical leader", "reliable contributor", "practical developer",
      "make systems work", "capable", "capability", "inferiority",
      "mathematically strong", "algorithmically strong", "fast-thinking", "building projects",
    ])) boost += 0.36;
    if (sourceRef.includes("future-work-lifestyle-boundary") && includesAny(normalizedQuery, [
      "future preference", "future do you fear", "high-pressure work culture",
      "competitive grind culture", "no freedom", "constant socializing",
      "private space", "stable income", "low-pressure life", "life direction",
      "others deciding", "work-life balance", "work culture do you fear",
      "what kind of future", "lifestyle and work environment", "work environment",
      "long term", "996", "hustle culture",
    ])) boost += 0.32;
    if (sourceRef.includes("english-social-awkwardness-anchor") && includesAny(normalizedQuery, [
      "english social embarrassment", "english social failure", "dramatic english",
      "constant awkwardness", "early canada", "high school adaptation",
      "english adaptation", "insecurity from high school", "ever fully disappear",
      "weak english", "socially during early canada", "english insecurity",
      "participate socially",
    ])) boost += 0.34;
    if (sourceRef.includes("driving-learning-confidence-anchor") && includesAny(normalizedQuery, [
      "driving learning", "learn driving", "learned driving", "learn to drive",
      "first learn driving", "first learned driving", "when did you first learn",
      "how did it feel", "driving feel", "summer 2024", "学车", "第一次学车", "开车",
      "china driving", "first attempt", "passed all tests", "talented at driving",
      "naturally understand driving", "quick adaptation", "unexpectedly talented",
      "surprisingly naturally talented", "naturally talented",
    ])) boost += 0.34;
    if (sourceRef.includes("xiang-update:2026-05:driving-car") && includesAny(normalizedQuery, [
      "driving learning", "learn driving", "learned driving", "learn to drive",
      "first learn driving", "first learned driving", "when did you first learn",
      "how did it feel", "driving feel", "summer 2024", "学车", "第一次学车",
    ])) boost -= 0.12;
    if (sourceRef.includes("canadian-identity-distance-anchor") && includesAny(normalizedQuery, [
      "canadian identity", "local canadian", "culturally integrated",
      "fully integrated", "native culture", "local social culture",
      "sense of distance", "adapted to isolation", "extreme loneliness",
      "feel like a canadian", "feel canadian",
    ])) boost += 0.34;
    if (sourceRef.includes("halifax-home-feeling-anchor") && includesAny(normalizedQuery, [
      "halifax home", "feel like home", "home feeling", "this is home",
      "halifax feel like home", "frequent moving", "deeply rooted", "emotionally home",
      "old neighborhood", "cozy spaces",
    ])) boost += 0.34;
    if (sourceRef.includes("ai-realization-not-toy-anchor") && includesAny(normalizedQuery, [
      "ai not a toy", "not a toy", "not just a toy", "ai was not just a toy",
      "when did you first feel ai", "gpt-3", "gpt3", "ai realization",
      "first time", "genuinely converse", "dynamic", "non-scripted",
      "fixed programmed responses", "hardcoded replies", "future value",
      "memorizing knowledge", "observation ability", "hidden problems",
      "logical thinking", "empathy", "right questions", "ai-native",
      "ai assisted thinking", "conversational ai",
    ])) boost += 0.36;
    if (sourceRef.includes("mr-jiang-mentor-anchor") && includesAny(normalizedQuery, [
      "mr. jiang", "mr jiang", "jiang xiansheng", "蒋先生", "mentor",
      "important person", "turning point", "study abroad", "recommendation",
      "support materials", "life advice", "dalhousie professor", "knew your mother",
      "helped you study abroad",
    ])) boost += 0.36;
    if (sourceRef.includes("hidden-insecurities-anchor") && includesAny(normalizedQuery, [
      "hidden insecurities", "afraid people discover", "worry others may discover",
      "afraid people will discover",
      "fear others notice", "not smart enough", "english not", "lazy",
      "not social", "not independent", "low self-confidence",
    ])) boost += 0.36;
    if (sourceRef.includes("emotional-comfort-music-anchor") && includesAny(normalizedQuery, [
      "emotional comfort", "comfort sources", "what would you miss",
      "freedom", "internet access", "private space", "ai tools",
      "phone", "computer", "quiet digital", "instrumental music",
      "orchestral music", "soundtrack", "genshin bgm", "genshin music",
      "emotional regulation", "private mental space",
    ])) boost += 0.34;
    if (sourceRef.includes("first-presentation-panic-history-class") && includesAny(normalizedQuery, [
      "first presentation panic", "presentation panic", "first presentation",
      "history class", "phone translator", "read from translator", "language barrier",
      "public speaking", "nervous presentation", "embarrassing presentation",
    ])) boost += 0.36;
    if (sourceRef.includes("snow-walk-home-boundary") && includesAny(normalizedQuery, [
      "first snow walk home", "first time in snow", "walked home in snow",
      "walking home alone in snow", "home alone in snow", "snow day",
      "canada snow", "snow memory", "winter memory",
    ])) boost += 0.34;
    if (sourceRef.includes("travel-not-alone-preference") && includesAny(normalizedQuery, [
      "solo travel", "travel alone", "traveling alone", "travelling alone",
      "travel preference", "tourism preference", "travel style", "travel in canada",
      "why don't you travel", "why do you not travel", "not traveled much",
      "not travelled much", "traveled much in canada", "travelled much in canada",
      "has a car but", "after getting a car",
    ])) boost += 0.34;
    if (sourceRef.includes("relationship-autonomy-no-pressure") && includesAny(normalizedQuery, [
      "relationship preference", "relationship style", "ideal type", "girlfriend", "dating",
      "black straight hair", "quiet and cute", "separate finances",
      "financially separate", "no kids", "children", "autonomy", "single is okay",
      "not forcing relationship", "relationship pressure",
    ])) boost += 0.36;
    if (sourceRef.includes("developer-identity-frontend-to-ux") && includesAny(normalizedQuery, [
      "developer identity", "frontend developer", "ui finally looks good",
      "user experience", "actual user experience", "frontend less",
      "ai changes frontend", "product feel", "ux matters",
    ])) boost += 0.34;
    if (sourceRef.includes("china-political-values-return-boundary") && includesAny(normalizedQuery, [
      "china political system", "chinese political system", "authoritarianism",
      "dictatorship", "censorship", "propaganda", "freedom of speech",
      "tiananmen", "great famine", "mao zedong", "xi jinping",
      "return to china", "go back to china", "why not return to china",
      "why don't you want to return", "political values",
    ])) boost += 0.38;
    if (sourceRef.includes("true-happiness-no-pressure") && includesAny(normalizedQuery, [
      "true happiness", "real happiness", "really happy", "genuinely happy", "happy every day",
      "not pressure myself", "no pressure", "external pressure", "daily happiness",
      "what makes you happy",
    ])) boost += 0.34;
  }

  if (sourceRef === "knowledge:behavioral-interview:code-review-feedback" && includesAny(normalizedQuery, ["code review", "harsh feedback", "harsh code review", "senior engineer", "criticism", "pull request feedback", "code review feedback"])) boost += 0.38;
  if (sourceRef === "knowledge:behavioral-interview:no-dramatic-conflict" && includesAny(normalizedQuery, ["no conflict", "never had a conflict", "never had a dramatic conflict", "no dramatic conflict", "conflict question"])) boost += 0.38;
  if (sourceRef === "knowledge:behavioral-interview:why-company-role" && includesAny(normalizedQuery, ["why this company", "why this role", "why do you want to work", "role interest", "why are you interested"])) boost += 0.22;
  if (sourceRef === "knowledge:behavioral-interview:manager-influence" && includesAny(normalizedQuery, ["disagreement with your manager", "conflict with your manager", "influence somebody", "without getting approval", "manager disagreement", "push for", "pushed for"])) boost += 0.34;
  if (sourceRef === "knowledge:behavioral-interview:unresponsive-info" && includesAny(normalizedQuery, ["unresponsive", "wasn't responsive", "needed information", "blocked by someone", "waiting for information", "not responsive"])) boost += 0.34;

  if (sourceRef.startsWith("knowledge:xiang-playbook:")) {
    if (sourceRef.includes("team-conflict") && includesAny(normalizedQuery, ["conflict", "teammate", "disagreement", "different ideas", "technical disagreement", "group project"])) boost += 0.42;
    if (sourceRef.includes("feedback") && includesAny(normalizedQuery, ["feedback", "code review", "criticism", "harsh feedback", "senior engineer", "review comment"])) boost += 0.42;
    if (sourceRef.includes("deadline-scope") && includesAny(normalizedQuery, ["deadline", "scope", "cut scope", "too many features", "ship", "must have", "nice to have"])) boost += 0.42;
    if (sourceRef.includes("hard-bug") && includesAny(normalizedQuery, ["hard bug", "debug", "debugging", "reproduce", "root cause", "broken", "flaky"])) boost += 0.42;
    if (sourceRef.includes("demo-pressure") && includesAny(normalizedQuery, ["demo", "presentation", "tomorrow", "smoke test", "fallback", "last minute"])) boost += 0.42;
    if (sourceRef.includes("unclear-requirements") && includesAny(normalizedQuery, ["unclear", "vague", "requirements", "api contract", "contract keeps changing", "schema", "assumption"])) boost += 0.42;
    if (sourceRef.includes("unknown-question") && includesAny(normalizedQuery, ["not sure", "don't know", "unknown", "uncertain", "how should i answer if i don't know", "what if i don't know"])) boost += 0.38;
    if (sourceRef.includes("interview-no-fake-story") && includesAny(normalizedQuery, ["real example", "tell me about a time", "describe a time", "give me an example", "never had", "no dramatic"])) boost += 0.38;
    if (sourceRef.includes("high-stakes-transaction") && includesAny(normalizedQuery, ["deposit", "lease", "contract", "non-refundable", "pay now", "sign now", "receipt", "pressure"])) boost += 0.38;
    if (includesAny(normalizedQuery, ["what should i say", "how should i answer", "how should i handle", "what should we do", "what is the best next step"])) boost += 0.12;
  }

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

  const sayNextConversationSupportIntent = includesAny(normalizedQuery, [
    "real time conversation", "realtime conversation", "real-time conversation",
    "conversation support", "conversation assistant", "real time assistant",
    "realtime assistant", "real-time assistant", "live transcript", "live transcripts",
  ]) || (
    hasAnyToken(tokens, ["real", "realtime", "real-time", "live", "conversation", "assistant", "transcript", "transcripts"])
    && hasAnyToken(tokens, ["project", "app", "built", "build", "made", "assistant", "support"])
  );

  if (includesAny(normalizedQuery, ["computer games"]) && (category === "games" || category === "games_technical_hobby")) {
    boost += 0.08;
  }

  const isGenericProjectQuestion = hasAnyToken(tokens, ["project", "projects", "software", "built", "build"])
    && !hasAnyToken(tokens, ["react", "native", "firebase", "parking", "mobile", "saynext", "glasses", "aws", "serverless", "lambda", "study", "tracker"]);
  if (isGenericProjectQuestion && !sayNextConversationSupportIntent && category === "technical_projects" && title.includes("elder album")) {
    boost += 0.018;
  }

  if (sayNextConversationSupportIntent && category === "technical_projects" && title.includes("saynext")) {
    boost += 0.14;
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

  if (category === "technical_projects" && title.includes("saynext") && includesAny(normalizedQuery, [
    "what i make", "what i made", "what you make", "what you made", "make and why",
    "made and why", "project and why", "why did you build", "why did i build",
    "why build", "why did you make", "why did i make",
  ])) {
    boost += 0.12;
  }

  if (sourceRef === "redacted-project:ai-context-engine-hybrid-search" && sayNextPublicProjectIntent) {
    boost += 0.36;
  }

  if (category === "technical_projects"
    && sayNextPublicProjectIntent
    && !sourceRef.includes("hybrid-search-memory-assistant")
    && sourceRef !== "redacted-project:ai-context-engine-hybrid-search"
    && !sourceRef.startsWith("doc:saynext")
    && !sourceRef.includes("project-saynext")
    && !sourceRef.startsWith("xiang-behavioral:")) {
    boost -= 0.1;
  }

  if (sourceRef.startsWith("doc:saynext") && includesAny(normalizedQuery, [
    "saynext", "this app", "conversation assistant", "mobile app", "mobile assistant",
    "conversation support", "real time", "realtime", "real-time",
    "transcript", "asr", "prompt", "prenote", "personal memory", "scene profile",
    "ollama", "qwen", "openai", "gpt", "frp", "vps", "local mode", "travel mode",
    "product thinking",
  ])) {
    boost += 0.05;
    if (sayNextConversationSupportIntent) boost += 0.12;
    if (sourceRef.includes("positioning") && includesAny(normalizedQuery, ["what is", "overview", "mobile", "smart glasses", "goal", "motivation", "product thinking", "what i make", "what i made", "what you make", "what you made"])) boost += 0.08;
    if (sourceRef.includes("positioning") && includesAny(normalizedQuery, ["why did i build", "why did you build", "why build", "why did you decide", "decide to build", "motivation", "reason", "make and why", "made and why", "project and why"])) boost += 0.13;
    if (sourceRef.includes("interview-story") && includesAny(normalizedQuery, ["why did i build", "why did you build", "why build", "why did you decide", "decide to build", "motivation", "interview", "product thinking", "make and why", "made and why", "project and why"])) boost += 0.16;
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

  if ((sourceRef.includes("xiang-profile:project-elder-album") || sourceRef.startsWith("doc:elderalbum"))
    && includesAny(normalizedQuery, ["your aws project", "my aws project", "tell me about your aws project", "aws project"])
    && !includesAny(normalizedQuery, ["joblens", "job lens", "resume", "job matching", "job aggregation", "application tracking"])) {
    boost += 0.36;
    if (sourceRef.includes("aws-architecture-deployment")) boost += 0.12;
  }

  if (sourceRef.startsWith("doc:joblens") && includesAny(normalizedQuery, [
    "aws cloud project", "cloud project", "aws project", "cloud architecture",
    "aws architecture", "serverless", "lambda", "api gateway", "dynamodb",
    "s3", "eventbridge", "sqs", "fargate", "terraform", "event-driven",
  ])) {
    boost += 0.08;
    if (sourceRef.includes("architecture")) boost += 0.08;
    if (sourceRef.includes("data-storage-security") && includesAny(normalizedQuery, ["dynamodb", "s3", "security", "jwt"])) boost += 0.04;
    if (includesAny(normalizedQuery, ["your aws project", "my aws project", "tell me about your aws project"])
      && !includesAny(normalizedQuery, ["joblens", "job lens", "resume", "job matching", "job aggregation", "application tracking"])) {
      boost -= 0.12;
    }
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
    if (sourceRef.includes("overview-scope") && includesAny(normalizedQuery, ["what was joblens", "what is joblens", "what was job lens", "what is job lens"])) boost += 0.05;
    if (sourceRef.includes("workflow") && includesAny(normalizedQuery, ["workflow", "feature", "features", "dashboard", "tracker", "save jobs", "application"])) boost += 0.035;
    if (sourceRef.includes("workflow") && includesAny(normalizedQuery, ["what was joblens", "what is joblens", "what was job lens", "what is job lens"])) boost += 0.045;
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

  if (sourceRef.includes("xiang-update:2026-05-18:childhood-personality-change") && includesAny(normalizedQuery, [
    "childhood", "as a kid", "when you were a kid", "when you were young", "personality",
    "quiet", "mischievous", "小时候", "幼儿园", "调皮", "沉默寡言",
  ])) {
    boost += 0.18;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:study-avoidance-turnaround") && includesAny(normalizedQuery, [
    "study", "studying", "student", "high school", "middle school", "novel", "novels",
    "english was weak", "gpa", "macs", "学习", "小说", "英文差", "加拿大高中", "本科",
  ])) {
    boost += 0.15;
    if (includesAny(normalizedQuery, ["friend", "friends", "who influenced", "influenced you", "roommate", "roommates"])) boost -= 0.12;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:languages-german-japanese") && includesAny(normalizedQuery, [
    "language", "languages", "english", "german", "japanese", "learn another language",
    "语言", "英语", "德语", "日语",
  ])) {
    boost += 0.2;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:soccer-history") && includesAny(normalizedQuery, [
    "soccer", "football", "sport", "sports", "swimming", "club", "足球", "游泳", "运动",
  ])) {
    boost += 0.16;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:food-restaurants-cooking") && includesAny(normalizedQuery, [
    "food", "restaurant", "restaurants", "kfc", "mary brown", "fried chicken", "cook", "cooking",
    "curry", "malatang", "superstore", "食物", "餐厅", "肯德基", "炸鸡", "咖喱", "麻辣烫",
  ])) {
    boost += 0.18;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:drinks-diet-coke") && includesAny(normalizedQuery, [
    "drink", "drinks", "water", "diet coke", "coke", "soda", "sugar", "饮料", "喝水", "代可", "可乐",
  ])) {
    boost += 0.17;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:canada-high-school-friends") && includesAny(normalizedQuery, [
    "high school friend", "high school friends", "friend in canada", "friends in canada",
    "halifax", "dartmouth", "mall", "bus", "高中朋友", "哈利法克斯", "达特茅斯",
  ])) {
    boost += 0.26;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:childhood-friend-xu-ziyang") && includesAny(normalizedQuery, [
    "childhood friend", "best friend", "kindergarten friend", "friend in china",
    "童年朋友", "最好的朋友", "徐子洋", "幼儿园",
  ])) {
    boost += 0.18;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:host-family-grace-michael") && includesAny(normalizedQuery, [
    "host family", "homestay", "host parent", "early canada life", "living situation",
    "住家", "寄宿家庭", "加拿大住家",
  ])) {
    boost += 0.2;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:undergrad-covid-life") && includesAny(normalizedQuery, [
    "undergraduate", "undergrad", "covid", "dorm", "online class", "online classes",
    "university life", "本科", "疫情", "宿舍", "网课",
  ])) {
    boost += 0.16;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:undergrad-roommates") && includesAny(normalizedQuery, [
    "roommate", "roommates", "peer influence", "influenced you", "chinese student",
    "池后语", "韦基泽", "室友", "中国室友",
  ])) {
    boost += 0.24;
  }

  if (sourceRef.includes("xiang-update:2026-05-18:undergrad-ebike-hill") && includesAny(normalizedQuery, [
    "electric bike", "e-bike", "ebike", "transportation", "commute", "winter biking", "hill",
    "get around", "got around", "around during undergrad",
    "电动自行车", "交通工具", "陡坡", "冬天",
  ])) {
    boost += 0.22;
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

function mapSessionMemoryCandidateRecord(row: any): SessionMemoryCandidateRecord {
  const status = String(row.status || "pending");
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    candidateType: row.candidate_type || "unknown",
    title: row.title || "Memory candidate",
    category: row.category || "general",
    sensitivity: normalizeSensitivity(row.sensitivity),
    content: row.content || "",
    usageRule: row.usage_rule || "",
    keywords: parseJsonArray(row.keywords_json).map(String),
    evidence: parseJsonArray(row.evidence_json).map(String),
    confidence: Number(row.confidence || 0),
    valueScore: Number(row.value_score || 0),
    riskScore: Number(row.risk_score || 0),
    validationJson: row.validation_json || "{}",
    status: status === "approved" || status === "rejected" || status === "promoted" ? status : "pending",
    model: row.model,
    rawJson: row.raw_json || "{}",
    contentHash: row.content_hash || "",
    promotedMemoryId: row.promoted_memory_id === null || row.promoted_memory_id === undefined ? null : Number(row.promoted_memory_id),
    rejectionReason: row.rejection_reason || "",
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

function mapPrenoteChunkRecord(row: any): PrenoteChunkRecord {
  return {
    id: Number(row.id),
    prenoteId: Number(row.prenote_id),
    userId: row.user_id,
    chunkIndex: Number(row.chunk_index || 0),
    headingPath: row.heading_path || "",
    text: row.text || "",
    charStart: Number(row.char_start || 0),
    charEnd: Number(row.char_end || 0),
    tokenEstimate: Number(row.token_estimate || 0),
    keywords: parseJsonArray(row.keywords_json).map(String),
    embedding: parseJsonArray(row.embedding_json).map(Number).filter((value) => Number.isFinite(value)),
    embeddingModel: row.embedding_model || "",
    contentHash: row.content_hash || "",
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
  private syncedDefaultSceneProfileUsers = new Set<string>();

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
      this.db.run("PRAGMA busy_timeout = 5000");
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
      CREATE TABLE IF NOT EXISTS session_memory_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        candidate_type TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        sensitivity TEXT NOT NULL DEFAULT 'medium',
        content TEXT NOT NULL,
        usage_rule TEXT NOT NULL DEFAULT '',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        value_score REAL NOT NULL DEFAULT 0,
        risk_score REAL NOT NULL DEFAULT 1,
        validation_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        model TEXT,
        raw_json TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT NOT NULL DEFAULT '',
        promoted_memory_id INTEGER,
        rejection_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, session_id, candidate_type, content_hash)
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_session_memory_candidates_user_status ON session_memory_candidates(user_id, status, updated_at DESC)");
    db.run("CREATE INDEX IF NOT EXISTS idx_session_memory_candidates_session ON session_memory_candidates(user_id, session_id, updated_at DESC)");

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
      CREATE TABLE IF NOT EXISTS prenote_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prenote_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        heading_path TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        char_start INTEGER NOT NULL DEFAULT 0,
        char_end INTEGER NOT NULL DEFAULT 0,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        keywords_json TEXT NOT NULL DEFAULT '[]',
        embedding_json TEXT NOT NULL DEFAULT '[]',
        embedding_model TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(prenote_id) REFERENCES prenotes(id) ON DELETE CASCADE,
        UNIQUE(prenote_id, chunk_index)
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_prenote_chunks_prenote ON prenote_chunks(prenote_id, chunk_index)");
    db.run("CREATE INDEX IF NOT EXISTS idx_prenote_chunks_user ON prenote_chunks(user_id, prenote_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_prenote_chunks_hash ON prenote_chunks(prenote_id, content_hash)");

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS prenote_chunks_fts USING fts5(
        heading_path,
        keywords,
        text
      )
    `);

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

    const rawQuery = query.trim();
    if (!rawQuery) return [];
    const cleanedQuery = expandAsrSearchQuery(rawQuery);
    const behavioralStoryQuestion = isBehavioralStoryQuestion(cleanedQuery);
    const responsePlaybookQuestion = isResponsePlaybookQuestion(cleanedQuery);
    if (!behavioralStoryQuestion && !responsePlaybookQuestion && (shouldSkipPersonalMemorySearch(rawQuery) || shouldSkipPersonalMemorySearch(cleanedQuery))) return [];
    const generalTechnicalConceptQuestion = isGeneralTechnicalConceptQuestion(cleanedQuery)
      || isLikelyGeneralTechnicalLecture(cleanedQuery)
      || isGeneralTechnicalConceptQuestion(rawQuery)
      || isLikelyGeneralTechnicalLecture(rawQuery);
    const explicitGeneralTechnicalQuestion = isExplicitGeneralTechnicalQuestion(cleanedQuery);
    const likelyThirdPartyTranscript = isLikelyThirdPartyTranscript(cleanedQuery) || isLikelyThirdPartyTranscript(rawQuery);
    const likelyPassivePublicTranscript = isLikelyPublicMonologue(cleanedQuery)
      || isLikelyCompleteDialogueExcerpt(cleanedQuery)
      || isLikelyPublicMonologue(rawQuery)
      || isLikelyCompleteDialogueExcerpt(rawQuery);
    const likelyExternalLearningContext = isLikelyExternalLearningTranscript(cleanedQuery) || isLikelyExternalLearningTranscript(rawQuery);
    if (likelyPassivePublicTranscript && !likelyExternalLearningContext) return [];

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
        const queryWordCount = normalizedQuery.split(/\s+/).filter(Boolean).length;
        const sourceRef = memory.sourceRef.toLowerCase();
        const isResponsePlaybook = sourceRef.startsWith("knowledge:xiang-playbook:");
        const projectQuestion = hasAnyToken(queryTokens, ["project", "projects", "built", "build", "made", "experience", "architecture", "app"]);
        const explicitProjectQuestion = hasAnyToken(queryTokens, ["project", "projects", "built", "build", "made"])
          || includesAny(normalizedQuery, ["my app", "your app", "my application", "your application"]);
        const genericDefinitionQuestion = !/\b(xiang|you|your|yours|yourself|my|me|i)\b/.test(normalizedQuery)
          && /^(what is|what was|what are|what does|explain|define|give me a general definition|who developed|who created|who invented|who released|when was|where was)\b/.test(normalizedQuery);
        const projectSpecificQuestion = !explicitGeneralTechnicalQuestion && (includesAny(normalizedQuery, [
          "saynext", "say next", "elderalbum", "elder album", "joblens", "job lens",
          "dalparkaid", "dal park", "my project", "your project", "my app", "your app",
          "which project should", "what project should", "project should i talk", "project should xiang talk",
          "project should i use", "album sharing app", "parking app", "parking mobile app",
          "what project you did", "project you did", "project did you do",
          "project you made", "project you built", "project for next",
          "parking project", "react native project parking", "react native experience",
          "my aws project", "my aws cloud project", "aws cloud project", "cloud project",
          "project album", "job matching app", "connecting aws services",
          "what project did i use", "what project did you use",
          "conversation assistant", "conversation support", "real time conversation",
          "realtime conversation", "real-time conversation", "live transcript", "live transcripts",
          "hybrid search memory assistant", "hybrid search", "real-time ai assistant",
          "realtime ai assistant", "blood donation management system", "ai meeting monitor",
        ]) || (
          explicitProjectQuestion && includesAny(normalizedQuery, [
            "aws", "cloud", "serverless", "lambda", "dynamodb", "s3", "api gateway",
            "cloud architecture", "serverless architecture", "eventbridge", "sqs",
            "fargate", "terraform", "event-driven",
          ])
        ));
        const shortPersonalCoursePreferenceQuestion = queryWordCount <= 14 && includesAny(normalizedQuery, [
          "cloud architecture why", "deep learning like why", "why you like deep learning",
        ]);
        const personalExperienceQuestion = !explicitGeneralTechnicalQuestion && !genericDefinitionQuestion && includesAny(normalizedQuery, [
          "your programming interest", "my programming interest", "games related to",
          "why do you dislike", "do you dislike bullying", "what happened to your",
          "what happened to my", "why do you care", "why is freedom important",
          "how do you react under stress", "dating experience", "talking to girls",
          "what motivates you", "what did your family", "your family", "my family",
          "why do you like", "as a course", "what time is your", "personal data",
          "privacy-sensitive", "not be overshared",
          "host family", "homestay", "roommate", "roommates", "friend", "friends",
          "restaurant", "restaurants", "what do you cook", "what do you drink",
          "what language", "which language", "languages have you learned",
          "good student", "who influenced you", "get around during undergrad",
          "how did you get around",
          "proudest achievement", "most proud", "lowest period", "difficult period",
          "technical strength", "technical strengths", "technical weakness", "technical weaknesses",
          "leetcode", "procrastinate", "procrastination", "project problems",
          "project blockers", "ai assisted development", "ai-assisted development",
          "preferred ai workflow", "disliked ai response", "communication style",
          "communication styles", "prefer being alone", "prefer solitude", "ideal day",
          "first real software project", "first software project", "first english confidence",
          "confidence speaking english", "feel confident speaking english", "speaking english",
          "ai response style", "do you dislike", "translation software",
          "childhood period", "remember most warmly", "warmest period",
          "food allergy", "food allergies", "dietary restriction", "allergic to",
          "deposit now", "send the deposit", "pay the deposit", "non-refundable deposit",
          "lease addendum", "payment terms", "landlord says", "formal speaking",
          "formal event", "ceremony", "wedding toast", "graduation intro",
          "self introduction", "classroom question", "ask in class",
          "questions do you ask in class", "target role", "full-stack developer",
          "professor asks if there are any questions", "any questions after explaining",
          "what kind of question should i ask", "question should i ask after",
          "after a lecture", "lecture about",
          "family property", "family money", "property rent", "mother communication",
          "full stack developer", "remote-friendly", "workplace preference",
          "team style fits you", "technical areas are you more and less experienced",
          "more and less experienced", "more experienced", "less experienced",
          "skill confidence", "experienced in",
          "motivation pattern", "work rhythm", "interest-triggered", "interest triggered",
          "stable grinder", "project mode", "hyperfocus", "all-nighter", "all nighter",
          "manager check-ins", "manager check ins", "monitored while working",
          "forced online responsiveness", "social confidence", "simulate conversations",
          "conversation preparation", "envy socially", "envy in conversation",
          "envy in english speaking", "self-esteem", "self image", "self-image",
          "feel insecure", "insecure after building projects", "feel dumb",
          "technical genius", "star engineer", "reliable contributor",
          "practical developer", "want people to think", "about your ability",
          "observer of the world", "future preference", "work culture do you fear",
          "what kind of future", "lifestyle and work environment",
          "high-pressure work culture", "competitive grind culture", "private space",
          "english social embarrassment", "english social failure", "constant awkwardness",
          "high school adaptation", "english adaptation", "insecurity from high school",
          "driving learning", "learned driving", "summer 2024", "naturally talented",
          "surprisingly naturally talented", "talented at driving", "local canadian", "canadian identity", "culturally integrated",
          "halifax home", "home feeling", "feel like home", "ai not a toy", "not a toy",
          "not just a toy", "ai was not just a toy", "when did you first feel ai",
          "gpt-3", "gpt3", "fixed programmed responses", "hardcoded replies",
          "observation ability", "hidden problems", "right questions", "mr. jiang",
          "mr jiang", "jiang xiansheng", "蒋先生", "mentor", "study abroad",
          "recommendation letter", "hidden insecurities", "afraid people discover",
          "afraid people will discover", "worry others may discover",
          "not smart enough", "not social", "not independent", "emotional comfort",
          "instrumental music", "orchestral music", "genshin bgm", "genshin music",
          "first presentation panic", "presentation panic", "history class presentation",
          "phone translator", "read from translator", "first snow walk home",
          "walking home alone in snow", "home alone in snow", "snow memory",
          "solo travel", "travel alone", "traveling alone", "tourism preference",
          "traveled much", "travelled much", "not traveled much", "not travelled much",
          "ideal type", "relationship preference", "relationship style", "separate finances", "no kids",
          "developer identity", "frontend developer", "ui finally looks good",
          "user experience", "frontend less", "your political values",
          "your view on china", "why don't you want to return to china",
          "why do you not want to return to china", "why not go back to china",
          "true happiness", "real happiness", "really happy",
        ]) || shortPersonalCoursePreferenceQuestion;
        const technicalKnowledgeQuestion = includesAny(normalizedQuery, [
          "serverless", "cold start", "lambda", "api gateway", "dynamodb", "s3",
          "sql", "nosql", "database index", "supervised learning", "unsupervised learning",
          "backpropagation", "regularization", "hash map", "cap theorem", "jwt",
        ]);
        const allowPersonalOrProjectMemory = isPersonalOrProjectMemoryQuery(cleanedQuery)
          || projectSpecificQuestion
          || personalExperienceQuestion
          || behavioralStoryQuestion;

        if (!allowPersonalOrProjectMemory
          && memory.source !== "knowledge"
          && !memory.category.startsWith("knowledge")) {
          return acc;
        }

        if (!allowPersonalOrProjectMemory
          && (sourceRef.startsWith("xiang-") || sourceRef.startsWith("doc:"))) {
          return acc;
        }

        if (memory.category === "behavioral_story" && !behavioralStoryQuestion) {
          return acc;
        }

        if (isResponsePlaybook && !responsePlaybookQuestion && !behavioralStoryQuestion) {
          return acc;
        }

        if (sourceRef.startsWith("knowledge:behavioral-interview:") && !behavioralStoryQuestion) {
          return acc;
        }

        if (behavioralStoryQuestion
          && memory.category !== "behavioral_story"
          && !sourceRef.startsWith("knowledge:behavioral-interview:")
          && !isResponsePlaybook
          && sourceRef !== "xiang-profile:work-motivation") {
          return acc;
        }

        if ((generalTechnicalConceptQuestion || likelyThirdPartyTranscript || likelyPassivePublicTranscript || likelyExternalLearningContext)
          && !behavioralStoryQuestion
          && !projectSpecificQuestion
          && !personalExperienceQuestion
          && memory.source !== "knowledge"
          && !memory.category.startsWith("knowledge")) {
          return acc;
        }

        if ((generalTechnicalConceptQuestion || likelyExternalLearningContext)
          && !behavioralStoryQuestion
          && (sourceRef.startsWith("xiang-") || sourceRef.startsWith("doc:"))
          && !projectSpecificQuestion
          && !personalExperienceQuestion) {
          return acc;
        }

        if (memory.source === "knowledge" || memory.category.startsWith("knowledge") || sourceRef.startsWith("knowledge:")) {
          if (isResponsePlaybook) {
            if (!responsePlaybookQuestion && !behavioralStoryQuestion) return acc;
          } else {
            if (behavioralStoryQuestion && !sourceRef.startsWith("knowledge:behavioral-interview:")) return acc;
            if (personalExperienceQuestion && !technicalKnowledgeQuestion) return acc;
            if (projectSpecificQuestion) return acc;
            if (sourceRef.startsWith("knowledge:cs-interview:")
              && includesAny(normalizedQuery, ["which project", "what project", "project are you", "project best shows", "project did you"])) {
              return acc;
            }
            if (!generalTechnicalConceptQuestion && intentBoost < 0.1) return acc;
          }
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
          "application tracking", "aws", "cloud", "cloud architecture", "aws architecture",
          "serverless", "lambda", "api gateway", "dynamodb", "s3", "eventbridge", "sqs",
          "fargate", "terraform", "event-driven",
        ])) {
          return acc;
        }

        if (sourceRef.startsWith("doc:saynext") && includesAny(normalizedQuery, [
          "parking", "dalparkaid", "dal park", "react native experience",
        ]) && !includesAny(normalizedQuery, ["saynext", "say next"])) {
          return acc;
        }

        if (sourceRef.includes("travel-not-alone-preference") && includesAny(normalizedQuery, [
          "local mode", "travel mode", "split local mode", "split local and travel",
          "openai api", "ollama", "vps", "frp",
        ])) {
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
          "design choices", "go through", "automatic context detection", "context detection",
          "manual scene", "scene profiles", "project you did for next", "project did for next",
          "small project you made",
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

        if (sourceRef.includes("xiang-profile:canada-high-school-transition") && includesAny(normalizedQuery, [
          "before canada", "before coming to canada", "before moving to canada",
          "in china before canada", "china before canada",
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
          "why did i build", "why did you build", "why build", "why did you decide", "decide to build",
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
          "expensive item", "most expensive", "ever bought", "you bought", "bought recently",
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
        const sourceRef = memory.sourceRef ? `\nSource ref: ${memory.sourceRef}` : "";
        return `Memory ${index + 1}: ${memory.title} [${memory.category}, ${memory.sensitivity}]${sourceRef}\n${memory.content}${usage}`;
      })
      .join("\n\n---\n\n");
  }

  upsertSessionMemoryCandidate(input: UpsertSessionMemoryCandidateInput): SessionMemoryCandidateRecord | null {
    if (!this.isEnabled()) return null;

    const content = input.content.trim();
    if (!content) return null;

    const keywords = Array.from(new Set((input.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 30);
    const evidence = Array.from(new Set((input.evidence ?? []).map((item) => item.trim()).filter(Boolean))).slice(0, 12);
    const contentHash = hashMemoryContent([
      input.candidateType.trim(),
      input.category.trim(),
      content,
    ].join("\n"));
    const status = input.status === "approved" || input.status === "rejected" || input.status === "promoted"
      ? input.status
      : "pending";

    this.getDb()
      .query(`
        INSERT INTO session_memory_candidates (
          user_id, session_id, candidate_type, title, category, sensitivity,
          content, usage_rule, keywords_json, evidence_json, confidence,
          value_score, risk_score, validation_json, status, model, raw_json,
          content_hash, rejection_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, session_id, candidate_type, content_hash) DO UPDATE SET
          title = excluded.title,
          category = excluded.category,
          sensitivity = excluded.sensitivity,
          content = excluded.content,
          usage_rule = excluded.usage_rule,
          keywords_json = excluded.keywords_json,
          evidence_json = excluded.evidence_json,
          confidence = excluded.confidence,
          value_score = excluded.value_score,
          risk_score = excluded.risk_score,
          validation_json = excluded.validation_json,
          status = CASE
            WHEN session_memory_candidates.status = 'promoted' THEN session_memory_candidates.status
            ELSE excluded.status
          END,
          model = excluded.model,
          raw_json = excluded.raw_json,
          rejection_reason = excluded.rejection_reason,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.userId,
        input.sessionId,
        input.candidateType.trim() || "unknown",
        input.title.trim() || "Memory candidate",
        input.category.trim() || "general",
        normalizeSensitivity(input.sensitivity),
        content,
        input.usageRule?.trim() || "",
        JSON.stringify(keywords),
        JSON.stringify(evidence),
        clampUnit(input.confidence ?? 0),
        clampUnit(input.valueScore ?? 0),
        clampUnit(input.riskScore ?? 1),
        JSON.stringify(input.validation ?? {}),
        status,
        input.model ?? null,
        input.rawJson ?? "{}",
        contentHash,
        input.rejectionReason?.trim() || "",
      );

    const row = this.getDb()
      .query(`
        SELECT *
        FROM session_memory_candidates
        WHERE user_id = ? AND session_id = ? AND candidate_type = ? AND content_hash = ?
        LIMIT 1
      `)
      .get(input.userId, input.sessionId, input.candidateType.trim() || "unknown", contentHash);

    return row ? mapSessionMemoryCandidateRecord(row) : null;
  }

  getSessionMemoryCandidate(userId: string, id: number): SessionMemoryCandidateRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM session_memory_candidates WHERE user_id = ? AND id = ?")
      .get(userId, id);

    return row ? mapSessionMemoryCandidateRecord(row) : null;
  }

  listSessionMemoryCandidates(userId: string, options: { sessionId?: string; status?: string; limit?: number } = {}): SessionMemoryCandidateRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(options.limit ?? 100, 1000));
    const sessionId = options.sessionId ?? "";
    const status = options.status ?? "all";
    const rows = this.getDb()
      .query(`
        SELECT *
        FROM session_memory_candidates
        WHERE user_id = ?
          AND (? = '' OR session_id = ?)
          AND (? = 'all' OR status = ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(userId, sessionId, sessionId, status, status, safeLimit);

    return rows.map(mapSessionMemoryCandidateRecord);
  }

  supersedeSessionMemoryCandidates(userId: string, sessionId: string): void {
    if (!this.isEnabled()) return;

    this.getDb()
      .query(`
        UPDATE session_memory_candidates
        SET status = 'rejected',
            rejection_reason = 'Superseded by a newer extraction run.',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND session_id = ?
          AND status IN ('pending', 'approved')
          AND promoted_memory_id IS NULL
      `)
      .run(userId, sessionId);
  }

  updateSessionMemoryCandidateStatus(
    userId: string,
    id: number,
    status: SessionMemoryCandidateStatus,
    rejectionReason = "",
    promotedMemoryId?: number | null,
  ): SessionMemoryCandidateRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getSessionMemoryCandidate(userId, id);
    if (!existing) return null;

    this.getDb()
      .query(`
        UPDATE session_memory_candidates
        SET status = ?, rejection_reason = ?, promoted_memory_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `)
      .run(status, rejectionReason, promotedMemoryId ?? existing.promotedMemoryId, userId, id);

    return this.getSessionMemoryCandidate(userId, id);
  }

  updateSessionMemoryCandidate(userId: string, id: number, input: UpdateSessionMemoryCandidateInput): SessionMemoryCandidateRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getSessionMemoryCandidate(userId, id);
    if (!existing) return null;

    const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : existing.title;
    const category = typeof input.category === "string" && input.category.trim() ? input.category.trim() : existing.category;
    const content = typeof input.content === "string" ? input.content.trim() : existing.content;
    const usageRule = typeof input.usageRule === "string" ? input.usageRule.trim() : existing.usageRule;
    const keywords = input.keywords
      ? Array.from(new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 30)
      : existing.keywords;
    const evidence = input.evidence
      ? Array.from(new Set(input.evidence.map((item) => item.trim()).filter(Boolean))).slice(0, 12)
      : existing.evidence;
    const status = input.status === "approved" || input.status === "rejected" || input.status === "promoted" || input.status === "pending"
      ? input.status
      : existing.status;
    const contentHash = hashMemoryContent([
      existing.candidateType,
      category,
      content,
    ].join("\n"));

    this.getDb()
      .query(`
        UPDATE session_memory_candidates
        SET title = ?,
            category = ?,
            sensitivity = ?,
            content = ?,
            usage_rule = ?,
            keywords_json = ?,
            evidence_json = ?,
            status = ?,
            content_hash = ?,
            rejection_reason = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `)
      .run(
        title,
        category,
        input.sensitivity ? normalizeSensitivity(input.sensitivity) : existing.sensitivity,
        content,
        usageRule,
        JSON.stringify(keywords),
        JSON.stringify(evidence),
        status,
        contentHash,
        typeof input.rejectionReason === "string" ? input.rejectionReason.trim() : existing.rejectionReason,
        userId,
        id,
      );

    return this.getSessionMemoryCandidate(userId, id);
  }

  deleteSessionMemoryCandidate(userId: string, id: number): boolean {
    if (!this.isEnabled()) return false;

    const existing = this.getSessionMemoryCandidate(userId, id);
    if (!existing) return false;

    this.getDb()
      .query("DELETE FROM session_memory_candidates WHERE user_id = ? AND id = ?")
      .run(userId, id);
    return true;
  }

  promoteSessionMemoryCandidate(userId: string, id: number): { candidate: SessionMemoryCandidateRecord; memory: PersonalMemoryRecord } | null {
    if (!this.isEnabled()) return null;

    const candidate = this.getSessionMemoryCandidate(userId, id);
    if (!candidate || candidate.status === "rejected") return null;
    if (candidate.candidateType === "event_summary") return null;

    const source = candidate.candidateType === "knowledge_fact" ? "knowledge" : "pipeline";
    const sourceRef = `session-memory:${candidate.id}`;
    const memory = this.createPersonalMemory({
      userId,
      title: candidate.title,
      category: candidate.category,
      sensitivity: candidate.sensitivity,
      content: candidate.content,
      usageRule: candidate.usageRule,
      keywords: candidate.keywords,
      status: "active",
      source,
      sourceRef,
      upsertBySource: true,
    });

    if (!memory) return null;
    const updatedCandidate = this.updateSessionMemoryCandidateStatus(userId, id, "promoted", "", memory.id) ?? candidate;
    return { candidate: updatedCandidate, memory };
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

  getPrenoteChunkCount(prenoteId: number): number {
    if (!this.isEnabled()) return 0;
    const row = this.getDb()
      .query("SELECT COUNT(*) AS count FROM prenote_chunks WHERE prenote_id = ?")
      .get(prenoteId) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  listPrenoteChunks(prenoteId: number): PrenoteChunkRecord[] {
    if (!this.isEnabled()) return [];
    const rows = this.getDb()
      .query("SELECT * FROM prenote_chunks WHERE prenote_id = ? ORDER BY chunk_index ASC")
      .all(prenoteId);
    return rows.map(mapPrenoteChunkRecord);
  }

  private deletePrenoteChunks(prenoteId: number): void {
    const db = this.getDb();
    const rows = db.query("SELECT id FROM prenote_chunks WHERE prenote_id = ?").all(prenoteId) as { id: number }[];
    for (const row of rows) {
      db.query("DELETE FROM prenote_chunks_fts WHERE rowid = ?").run(Number(row.id));
    }
    db.query("DELETE FROM prenote_chunks WHERE prenote_id = ?").run(prenoteId);
  }

  private upsertPrenoteChunkFts(chunk: PrenoteChunkRecord): void {
    const db = this.getDb();
    db.query("DELETE FROM prenote_chunks_fts WHERE rowid = ?").run(chunk.id);
    db.query(`
      INSERT INTO prenote_chunks_fts(rowid, heading_path, keywords, text)
      VALUES (?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.headingPath,
      chunk.keywords.join(" "),
      chunk.text,
    );
  }

  async rebuildPrenoteChunks(prenoteId: number): Promise<PrenoteChunkRecord[]> {
    if (!this.isEnabled()) return [];

    const prenote = this.getPrenote(prenoteId);
    if (!prenote) return [];

    const sourceText = prenote.extractedText.trim() || prenote.sourceText.trim();
    this.deletePrenoteChunks(prenoteId);
    if (!sourceText) return [];

    const builtChunks = buildPrenoteChunksFromText(sourceText);
    if (builtChunks.length === 0) return [];

    const embeddingInput = builtChunks.map((chunk) => [
      `Prenote: ${prenote.title}`,
      chunk.headingPath ? `Section: ${chunk.headingPath}` : "",
      `Keywords: ${chunk.keywords.join(", ")}`,
      chunk.text,
    ].filter(Boolean).join("\n"));
    const embeddingResult = await createPrenoteEmbeddings(embeddingInput);

    const db = this.getDb();
    const inserted: PrenoteChunkRecord[] = [];
    for (const chunk of builtChunks) {
      const embedding = embeddingResult.embeddings[chunk.chunkIndex] ?? [];
      const result = db.query(`
        INSERT INTO prenote_chunks (
          prenote_id, user_id, chunk_index, heading_path, text, char_start, char_end,
          token_estimate, keywords_json, embedding_json, embedding_model, content_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        prenote.id,
        prenote.userId,
        chunk.chunkIndex,
        chunk.headingPath,
        chunk.text,
        chunk.charStart,
        chunk.charEnd,
        chunk.tokenEstimate,
        JSON.stringify(chunk.keywords),
        JSON.stringify(embedding),
        embeddingResult.model,
        chunk.contentHash,
      );

      const row = db.query("SELECT * FROM prenote_chunks WHERE id = ?").get(Number(result.lastInsertRowid));
      if (row) {
        const record = mapPrenoteChunkRecord(row);
        inserted.push(record);
        this.upsertPrenoteChunkFts(record);
      }
    }

    return inserted;
  }

  private async ensureActivePrenoteChunks(userId: string, desiredEmbeddingModel: string): Promise<void> {
    const activePrenotes = this.listActivePrenotes(userId);
    for (const prenote of activePrenotes) {
      const chunks = this.listPrenoteChunks(prenote.id);
      const needsInitialIndex = chunks.length === 0 && Boolean(prenote.extractedText.trim() || prenote.sourceText.trim());
      const needsRealEmbeddingUpgrade = desiredEmbeddingModel !== "local-hybrid"
        && chunks.some((chunk) => chunk.embeddingModel !== desiredEmbeddingModel || chunk.embedding.length < 1000);

      if (needsInitialIndex || needsRealEmbeddingUpgrade) {
        await this.rebuildPrenoteChunks(prenote.id);
      }
    }
  }

  async searchActivePrenoteChunksHybrid(userId: string, query: string, limit = PRENOTE_RETRIEVAL_TOP_K, mode: PrenoteRetrievalMode = "semantic"): Promise<PrenoteChunkSearchResult[]> {
    if (!this.isEnabled()) return [];

    const rawQuery = query.trim();
    if (!rawQuery) return [];
    const cleanedQuery = expandAsrSearchQuery(rawQuery);
    const queryEmbedding = mode === "semantic"
      ? await createPrenoteQueryEmbedding(cleanedQuery)
      : { embedding: [] as number[], model: "fast-local" };

    if (mode === "semantic") {
      await this.ensureActivePrenoteChunks(userId, queryEmbedding.model);
    }

    const db = this.getDb();
    const rows = db.query(`
      SELECT c.*, p.title AS prenote_title
      FROM prenote_chunks c
      JOIN prenotes p ON p.id = c.prenote_id
      WHERE c.user_id = ?
        AND p.user_id = ?
        AND p.is_active = 1
        AND p.status = 'ready'
      ORDER BY p.updated_at DESC, c.chunk_index ASC
    `).all(userId, userId) as any[];
    if (rows.length === 0) return [];

    const chunks = rows.map((row) => ({
      ...mapPrenoteChunkRecord(row),
      prenoteTitle: row.prenote_title || "Prenote",
    }));
    const queryTokens = new Set(tokenizeSearchText(cleanedQuery));
    const ftsQuery = buildFtsQuery(cleanedQuery);
    const lexicalRanks = new Map<number, number>();

    if (ftsQuery) {
      try {
        const ftsRows = db.query(`
          SELECT rowid, bm25(prenote_chunks_fts) AS bm25_score
          FROM prenote_chunks_fts
          WHERE prenote_chunks_fts MATCH ?
          ORDER BY bm25_score ASC
          LIMIT 80
        `).all(ftsQuery);
        ftsRows.forEach((row: any, index) => lexicalRanks.set(Number(row.rowid), index + 1));
      } catch {
        // Keep vector/keyword scoring when FTS syntax dislikes noisy ASR text.
      }
    }

    const vectorScores = chunks
      .map((chunk) => ({
        id: chunk.id,
        score: mode === "semantic" && chunk.embedding.length === queryEmbedding.embedding.length
          ? cosineSimilarity(queryEmbedding.embedding, chunk.embedding)
          : 0,
      }))
      .sort((a, b) => b.score - a.score);
    const vectorRanks = new Map<number, number>();
    vectorScores.slice(0, 80).forEach((item, index) => vectorRanks.set(item.id, index + 1));
    const vectorScoreById = new Map(vectorScores.map((item) => [item.id, item.score]));
    const vectorThreshold = mode === "fast"
      ? Number.POSITIVE_INFINITY
      : queryEmbedding.model === "local-hybrid" ? 0.08 : 0.28;

    const results = chunks
      .reduce<PrenoteChunkSearchResult[]>((acc, chunk) => {
        const lexicalRank = lexicalRanks.get(chunk.id);
        const vectorRank = vectorRanks.get(chunk.id);
        const vectorScore = vectorScoreById.get(chunk.id) ?? 0;
        const chunkTextTokens = new Set(tokenizeSearchText(chunk.text));
        const chunkHeadingTokens = new Set(tokenizeSearchText(chunk.headingPath));
        const tokenOverlapCount = [...queryTokens].filter((token) => chunkTextTokens.has(token)).length;
        const headingOverlapCount = [...queryTokens].filter((token) => chunkHeadingTokens.has(token)).length;
        const tokenOverlapScore = tokenOverlapCount / Math.max(3, queryTokens.size);
        const headingOverlapScore = headingOverlapCount / Math.max(3, queryTokens.size);
        const keywordScore = keywordOverlapScore(queryTokens, {
          title: chunk.prenoteTitle,
          category: "prenote",
          content: chunk.text,
          keywords: chunk.keywords,
        });
        const lexicalSignal = Boolean(lexicalRank) && (tokenOverlapScore >= 0.08 || keywordScore >= 0.14);
        const keywordSignal = keywordScore > 0.08 && tokenOverlapScore >= 0.08;
        const headingSignal = headingOverlapScore >= 0.22 && tokenOverlapScore >= 0.12;
        const semanticSignal = mode === "semantic" && vectorScore >= vectorThreshold;
        const hasSignal = lexicalSignal || keywordSignal || headingSignal || tokenOverlapScore >= 0.22 || semanticSignal;
        if (!hasSignal) return acc;

        const lexicalComponent = lexicalRank ? 1 / (40 + lexicalRank) : 0;
        const vectorComponent = vectorRank && vectorScore >= vectorThreshold
          ? (Math.max(0, vectorScore) * 0.08) + (1 / (80 + vectorRank))
          : 0;
        const keywordComponent = keywordScore * 0.08;
        const tokenOverlapComponent = tokenOverlapScore * 0.05;
        const headingBoost = chunk.headingPath && tokenizeSearchText(chunk.headingPath).some((token) => queryTokens.has(token)) ? 0.025 : 0;
        const score = lexicalComponent * 0.75 + vectorComponent + keywordComponent + tokenOverlapComponent + headingBoost;
        if (score <= 0.01) return acc;

        acc.push({
          ...chunk,
          score,
          lexicalRank,
          vectorRank,
          keywordScore,
          tokenOverlapScore,
        });
        return acc;
      }, [])
      .sort((a, b) => b.score - a.score);

    const top = results[0];
    if (!top) return [];

    const topScore = top.score;
    const topHeading = top.headingPath;
    return results
      .filter((chunk) => {
        if (chunk.id === top.id) return true;
        if (chunk.score < topScore * 0.72) return false;
        if (chunk.headingPath && topHeading && chunk.headingPath === topHeading) return true;
        if (chunk.tokenOverlapScore >= 0.34) return true;
        if (chunk.lexicalRank && chunk.lexicalRank <= 6 && chunk.tokenOverlapScore >= 0.22) return true;
        if (chunk.keywordScore >= 0.18 && chunk.tokenOverlapScore >= 0.22) return true;
        return false;
      })
      .slice(0, Math.max(1, Math.min(limit, 8)));
  }

  getEffectivePrenoteRuntimeContext(prenote: PrenoteRecord): string {
    const runtimeContext = prenote.runtimeContext.trim();
    const extractedText = prenote.extractedText.trim();
    const legacyRuntimeLooksLossy = Boolean(extractedText)
      && Boolean(runtimeContext)
      && !isLosslessPrenoteRuntimeContext(runtimeContext)
      && extractedText.length > runtimeContext.length * 1.2;

    if (legacyRuntimeLooksLossy || (!runtimeContext && extractedText)) {
      return buildLosslessRuntimeContext(prenote.title, extractedText);
    }

    return runtimeContext || prenote.processedJson || "";
  }

  getActivePrenoteRuntimeContext(userId: string): string {
    const prenotes = this.listActivePrenotes(userId);
    if (prenotes.length === 0) return "";

    return prenotes
      .map((prenote, index) => {
        const context = this.getEffectivePrenoteRuntimeContext(prenote);
        return context.trim() ? `Active prenote ${index + 1}: ${prenote.title}\n${context.trim()}` : "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  async getActivePrenoteRuntimeContextForQuery(userId: string, query: string, mode: PrenoteRetrievalMode = "semantic"): Promise<string> {
    const chunks = await this.searchActivePrenoteChunksHybrid(userId, query, PRENOTE_RETRIEVAL_TOP_K, mode);
    if (chunks.length === 0) return "";

    const lines: string[] = [];
    let usedChars = 0;
    chunks.forEach((chunk, index) => {
      const header = [
        `Active prenote excerpt ${index + 1}: ${chunk.prenoteTitle}`,
        chunk.headingPath ? `Section: ${chunk.headingPath}` : "",
        `Chunk: ${chunk.chunkIndex + 1}, score=${chunk.score.toFixed(4)}, embedding=${chunk.embeddingModel}`,
        "Exact excerpt:",
      ].filter(Boolean).join("\n");
      const remaining = PRENOTE_RETRIEVAL_MAX_CHARS - usedChars - header.length - 16;
      if (remaining <= 200) return;
      const text = chunk.text.length > remaining ? `${chunk.text.slice(0, remaining - 3).trim()}...` : chunk.text;
      usedChars += header.length + text.length + 16;
      lines.push(`${header}\n${text}`);
    });

    if (lines.length === 0) return "";

    return [
      "Only these exact prenote excerpts were retrieved for the current transcript. Full prenote text remains stored but is not injected.",
      ...lines,
    ].join("\n\n---\n\n");
  }

  deletePrenote(userId: string, id: number): boolean {
    if (!this.isEnabled()) return false;

    const prenote = this.getPrenote(id);
    if (!prenote || prenote.userId !== userId) return false;

    const files = this.listPrenoteFiles(id);
    this.deletePrenoteChunks(id);
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
    if (this.syncedDefaultSceneProfileUsers.has(userId)) return;

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
      db.query(`
        UPDATE scene_profiles
        SET name = ?, prompt = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND builtin_key = ?
          AND is_builtin = 1
          AND (name <> ? OR prompt <> ?)
      `).run(
        profile.name,
        profile.prompt,
        userId,
        profile.builtinKey,
        profile.name,
        profile.prompt,
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
    this.syncedDefaultSceneProfileUsers.add(userId);
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

  getSceneProfileByBuiltinKey(userId: string, builtinKey: string): SceneProfileRecord | null {
    if (!this.isEnabled()) return null;

    this.ensureDefaultSceneProfiles(userId);
    const row = this.getDb()
      .query("SELECT * FROM scene_profiles WHERE user_id = ? AND builtin_key = ?")
      .get(userId, builtinKey);

    return row ? mapSceneProfileRecord(row) : null;
  }

  formatSceneProfilePrompt(profile: SceneProfileRecord | null): string {
    if (!profile?.prompt.trim()) return "";
    return `Active scene profile: ${profile.name}\n${profile.prompt.trim()}`;
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
    return this.formatSceneProfilePrompt(profile);
  }
}

export const conversationLogger = new ConversationLogger();
