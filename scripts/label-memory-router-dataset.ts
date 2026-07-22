import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  serializeMemoryRouterInput,
  type MemoryRouterCandidate,
} from "../src/server/evenhub-v2/memory-router-dataset";
import {
  parseMemoryRouterTeacherResponse,
  type MemoryRouterTeacherLabel,
} from "../src/server/evenhub-v2/memory-router-labeling";

type LabeledMemoryRouterCandidate = MemoryRouterCandidate & {
  memoryLane: MemoryRouterTeacherLabel["lane"];
  labelConfidence: number;
  labelSource: "local_teacher";
  labelVersion: 1;
  teacherModel: string;
  labeledAt: string;
};

type OllamaResponse = {
  message?: { content?: string };
  error?: string;
};

const SYSTEM_PROMPT = `Classify transcript windows for an interview-focused personal-memory retrieval router.

The source transcripts contain many unrelated conversations, lectures, meetings, casual questions, and ASR errors. A second-person pronoun alone never means personal memory is needed. The router should open Xiang's long-term memory only when CURRENT, with at most the two previous transcript segments, clearly asks for a stable Xiang-specific professional, education, identity, motivation, or software-project fact. If the answer can be produced from general knowledge or only the visible conversation, choose none.

Use previous transcript only to resolve a direct follow-up. Do not reinterpret a standalone casual question, opinion, task, or technical definition as a job interview. Return exactly one lane per item:

- none: generic knowledge, coding, algorithms, system design, classroom content, casual/social/lifestyle talk, hobbies, travel, opinions, advice, meetings, acknowledgements, transient plans, service/booking/task parameters, or anything answerable without stable Xiang-specific memory.
- profile: direct questions about Xiang's identity, name, origin/location, education, current study, programming skills, professional strengths/weaknesses, language ability, career direction, or self-introduction. Do not use profile for hobbies, relaxation, weekend plans, social contact, opinions, or ordinary task slots.
- company_fit: explicit employment questions about why Xiang wants a named role/company, why he fits a position, what professional value he can contribute, career motivation, or workplace/team fit. Generic business, political, economic, social, or collaboration discussions are none.
- named_project: an explicitly named Xiang project, or a clear follow-up referring to that named project. Known names include SayNext, EvenHub, CueFlow, JobLens AI, ElderAlbum, DalParkAid, AI Meeting Monitor, Blood Donation Management System, Study Session Tracker, and AI Test Simulator.
- personal_experience: CURRENT explicitly asks what Xiang personally built, used, implemented, or worked on in software/engineering, but no one named project is the clear target. Generic technical definitions, hypothetical designs, and unrelated life experience are none.
- behavioral: CURRENT explicitly asks Xiang to provide a concrete past professional/project/team story about a challenge, conflict, failure, mistake, feedback, deadline, pressure, debugging, ownership, leadership, or teamwork. A transcript that merely contains somebody's past story is none.

Apply this priority: explicit named project, behavioral request, explicit company/role fit, unnamed technical experience, professional/identity profile, then none. Do not classify a generic technical question as personal merely because it says "you". Use named_project only when a known project is named in CURRENT or the previous context makes a reference like "that project" unambiguous. A technical or commercial meeting topic without a known project name is not named_project.

Examples:
- "What kind of cuisine do you want?" -> none
- "How much does it cost?" -> none
- "What are your plans this weekend?" -> none
- "Do you have any hobbies?" -> none
- "Can you tell me about your last trip?" -> none
- "What do you do to unwind after a stressful day?" -> none
- "What do you think are the best options?" -> none
- "Should I bring it up?" -> none
- "What is your major?" -> profile
- "Tell me a little about yourself" -> profile
- "What are your professional weaknesses?" -> profile
- "What AWS services have you used?" -> personal_experience
- "What AWS services have you used in your projects?" -> personal_experience
- "What is a checksum here?" -> none
- "What did you add?" with no clear software-work context -> none
- "How would you design an AWS chatbot?" -> none
- "Do you know which AWS service sends notifications?" -> none
- "How do you know where an LLM sends a prompt?" -> none
- "Where do I access remote models?" -> none
- "Why do you want this role?" -> company_fit
- "What do you know about DeepSense?" -> none; this asks for company knowledge, not a Xiang-specific fact.
- "What do you know about our company?" -> none
- If CURRENT is garbled ASR but the immediately previous transcript clearly asks why the candidate wants or fits a position, keep company_fit. Example: previous "Why are you interested in this role?", current "What about the ceramic fixate position?" -> company_fit.
- "What do you know about our company?" -> none
- "Tell me about a time you handled a deadline" -> behavioral
- "Describe a time you received difficult code review feedback" -> behavioral
- "I lost my luggage on my last trip" -> none
- "I accidentally hit send. How about you?" -> none
- "Can you explain SayNext end to end?" -> named_project
- ASR phrases such as "Sadness" or "Hyperset Memory" in a project question can refer to SayNext / Hybrid Search Memory -> named_project
- "you mentioned say ... what does the system do end to end?" -> named_project when ASR context clearly refers to SayNext
- "What was the hardest tradeoff in JobLens AI?" -> named_project
- "What have you been working on recently?" -> personal_experience
- "What software project are you most proud of?" -> personal_experience
- "How would you build a document matching or ranking tool?" -> personal_experience because Xiang has directly relevant applied project evidence; ASR may say "darkroom matching".
- "How would you split a document into chunks?" -> none
- "How would you design a recommendation system?" -> none
- "Can we expand fabric production capabilities in Vietnam?" -> none
- The generic word "project" without a known project name is not enough for named_project.
- "Mm, right." after an unnamed meeting discussion -> none

Return JSON only: {"labels":[{"index":0,"lane":"none","confidence":0.95}]}. Include every index exactly once.`;

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

function numericArgument(name: string, fallback: number): number {
  const value = Number(argument(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function requestLabels(
  endpoint: string,
  model: string,
  candidates: MemoryRouterCandidate[],
): Promise<MemoryRouterTeacherLabel[]> {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      keep_alive: "30m",
      options: {
        temperature: 0,
        num_ctx: 8192,
        num_predict: Math.max(512, candidates.length * 48),
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            items: candidates.map((candidate, index) => ({
              index,
              transcript: serializeMemoryRouterInput(candidate),
            })),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.MEMORY_ROUTER_TEACHER_TIMEOUT_MS || 90_000)),
  });
  const body = await response.json() as OllamaResponse;
  if (!response.ok || body.error) throw new Error(body.error || `ollama_http_${response.status}`);
  return parseMemoryRouterTeacherResponse(body.message?.content || "", candidates.length);
}

async function labelWithSplitRetry(
  endpoint: string,
  model: string,
  candidates: MemoryRouterCandidate[],
): Promise<Array<{ candidate: MemoryRouterCandidate; label: MemoryRouterTeacherLabel }>> {
  try {
    const labels = await requestLabels(endpoint, model, candidates);
    return candidates.map((candidate, index) => ({ candidate, label: labels[index] }));
  } catch (error) {
    if (candidates.length <= 1) throw error;
    const middle = Math.ceil(candidates.length / 2);
    const left = await labelWithSplitRetry(endpoint, model, candidates.slice(0, middle));
    const right = await labelWithSplitRetry(endpoint, model, candidates.slice(middle));
    return [...left, ...right];
  }
}

const inputPath = resolve(argument("input", "data/review/saynext-memory-router-v1-candidates.jsonl"));
const outputPath = resolve(argument("output", "annotation_batches/memory_router_labels_v1.jsonl"));
const endpoint = argument("endpoint", process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
const model = argument("model", process.env.MEMORY_ROUTER_TEACHER_MODEL || "qwen2.5:14b-instruct");
const batchSize = numericArgument("batch-size", 16);
const limit = numericArgument("limit", Number.MAX_SAFE_INTEGER);
const candidates = readJsonLines<MemoryRouterCandidate>(inputPath);
const completed = new Set(readJsonLines<LabeledMemoryRouterCandidate>(outputPath).map((row) => row.id));
const pending = candidates.filter((candidate) => !completed.has(candidate.id)).slice(0, limit);
const startedAt = Date.now();

console.log(JSON.stringify({ inputPath, outputPath, model, batchSize, total: candidates.length, completed: completed.size, pending: pending.length }));

for (let offset = 0; offset < pending.length; offset += batchSize) {
  const batch = pending.slice(offset, offset + batchSize);
  const results = await labelWithSplitRetry(endpoint, model, batch);
  const labeledAt = new Date().toISOString();
  const rows = results.map(({ candidate, label }): LabeledMemoryRouterCandidate => ({
    ...candidate,
    memoryLane: label.lane,
    labelConfidence: label.confidence,
    labelSource: "local_teacher",
    labelVersion: 1,
    teacherModel: model,
    labeledAt,
  }));
  appendFileSync(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  const done = Math.min(offset + batch.length, pending.length);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  console.log(JSON.stringify({ done, pending: pending.length, elapsedSeconds, rowsPerSecond: done / Math.max(elapsedSeconds, 0.001) }));
}
