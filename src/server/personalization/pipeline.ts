import type { ConversationSampleRecord } from "../data/conversation-logger";
import { generateLocalJson } from "../local-llm/ollama-client";

export type PipelineSourceType = "sample" | "event";

export interface PipelineSegment {
  text: string;
  speakerRole: "xiang" | "other" | "unknown";
  type: "question" | "answer" | "lecture" | "feedback" | "small_talk" | "noise";
}

export interface PipelineContext {
  scene: "interview" | "classroom" | "daily_chat" | "work_discussion" | "group_discussion" | "service_or_advisor" | "unknown";
  confidence: number;
  xiangExpectedToSpeak: boolean;
  reason: string;
}

export interface PipelineEvent {
  title: string;
  summary: string;
  usefulFacts: string[];
  blindSpots: string[];
  possibleFollowUpQuestions: string[];
}

export interface PipelineOutputIntent {
  intent:
    | "answer_question"
    | "technical_answer"
    | "supplement_knowledge"
    | "clarify_question"
    | "acknowledge"
    | "buy_time"
    | "no_output";
  shouldGenerateSayNext: boolean;
  reason: string;
}

export interface PipelineQuality {
  natural: number;
  useful: number;
  concise: number;
  fitsXiang: number;
  grounded: number;
  timing: number;
  shouldDisplay: number;
  overall: number;
  issues: string[];
}

export interface PipelinePseudoLabel {
  idealReply: string;
  labelQuality: number;
  whyBetter: string;
}

export interface PipelineReviewDecision {
  needsXiangReview: boolean;
  priority: "low" | "medium" | "high";
  reason: string;
}

export interface PipelineMemoryCandidate {
  shouldAddToPersonalMemory: boolean;
  memoryType: "style" | "fact" | "example" | "preference" | "correction" | "none";
  content: string;
  tags: string[];
  confidence: number;
}

export interface PersonalizationPipelineResult {
  cleanedTranscript: string;
  cleanedOutput: string;
  segments: PipelineSegment[];
  context: PipelineContext;
  event: PipelineEvent;
  outputIntent: PipelineOutputIntent;
  quality: PipelineQuality;
  pseudoLabel: PipelinePseudoLabel;
  review: PipelineReviewDecision;
  memory: PipelineMemoryCandidate;
}

export interface PipelineRunInput {
  sourceType: PipelineSourceType;
  sourceId: string;
  userId: string;
  rawTranscript: string;
  rawOutput?: string | null;
  timestamp?: string;
}

function buildPipelinePrompt(input: PipelineRunInput): string {
  return `You are the local SayNext personalization pipeline.

Goal:
Turn noisy raw transcript + SayNext output into useful training/memory data for Xiang.
Do not make Xiang sound more polished than he is.
Clean noise, but preserve natural spoken English.

Critical separation:
- Raw transcript is what was heard by ASR.
- Current SayNext output is AI output, not Xiang's real speech.
- Do not treat Current SayNext output as a transcript segment, speaker turn, event fact, or Xiang's memory.
- Segments must come only from Raw transcript. Never include the AI output in segments.

Pipeline stages to perform:
1. Cleaner: remove duplicated partial words, obvious ASR noise, and impossible fragments. Keep casual words like "uh", "kind of", "honestly" if they help the real speaking style.
   - Do not invent meaning for nonsensical ASR text.
   - If the transcript is mostly impossible/noisy, set cleanedTranscript to "[unclear ASR noise]" and include a segment with type "noise".
2. Segmenter: split the text into small conversation events.
3. Context Classifier: identify whether this is interview, classroom, daily chat, work discussion, group discussion, service/advisor, or unknown.
   - If the transcript asks about an academic or technical concept, classroom is possible, but do not be overconfident from one technical term.
   - Examples: supervised learning, neural network, Lambda, EC2, API, database, architecture, scalability, security, debugging.
   - Use confidence above 0.8 only when there are multiple clear scene clues.
   - If the transcript is short, garbled, or missing context, keep confidence around 0.4 to 0.65.
4. Event Extractor: summarize the useful event and extract facts, blind spots, and possible follow-up questions.
5. Output Intent Judge: decide what SayNext should have done.
   - If the transcript asks a technical/academic question and enough meaning is clear, use "technical_answer", not "clarify_question".
   - Use "clarify_question" only when Xiang genuinely cannot know what was asked.
   - If the transcript is low-value ASR noise, use "no_output" and shouldGenerateSayNext=false. Do not ask for clarification unless a real person clearly asked Xiang something.
6. Quality Scorer: score the current AI output.
   - Include timing: whether this was the right moment to show anything.
   - Include shouldDisplay: whether the glasses should display a reply at all.
7. Pseudo Label Generator: write a better Xiang-style reply if useful.
8. Review Selector: ask Xiang only when sample is uncertain, high-value, bad, or teaches personal style.
9. Personal Memory Candidate: decide whether to save a long-term memory/example.

Important style:
- Xiang's English should be simple, natural, student-like, and slightly imperfect if needed.
- Avoid resume-style, corporate wording, and fake confidence.
- For technical/professional questions, the ideal reply should still answer professionally.
- Technical answers should be short but useful. Give one correct core point or example.
- Only use Xiang's personal projects when the transcript explicitly asks about his experience or projects.
- If it is lecture content, the pseudo label should be a useful supplement or clarification, not just repeating the lecturer.
- Avoid fancy words in pseudo labels, like "nuances", "facilitate", "robust", or "comprehensive".
- Pseudo labels should usually be one short sentence. Use two short sentences only when needed.
- Do not make pseudo labels sound like a textbook answer. Prefer Xiang-style simple speech.
- Do not invent personal status, study state, feelings, or experience unless it is in the raw transcript or stable Xiang profile.
- Good technical pseudo label example: "I think supervised learning means the data already has labels, so the model learns from those examples."
- Bad pseudo label example: "I'm still trying to understand all its nuances in class."

Return exactly this JSON shape:
{
  "cleanedTranscript": "string",
  "cleanedOutput": "string",
  "segments": [
    {
      "text": "string",
      "speakerRole": "xiang | other | unknown",
      "type": "question | answer | lecture | feedback | small_talk | noise"
    }
  ],
  "context": {
    "scene": "interview | classroom | daily_chat | work_discussion | group_discussion | service_or_advisor | unknown",
    "confidence": 0.0,
    "xiangExpectedToSpeak": true,
    "reason": "string"
  },
  "event": {
    "title": "string",
    "summary": "string",
    "usefulFacts": ["string"],
    "blindSpots": ["string"],
    "possibleFollowUpQuestions": ["string"]
  },
  "outputIntent": {
    "intent": "answer_question | technical_answer | supplement_knowledge | clarify_question | acknowledge | buy_time | no_output",
    "shouldGenerateSayNext": true,
    "reason": "string"
  },
  "quality": {
    "natural": 1,
    "useful": 1,
    "concise": 1,
    "fitsXiang": 1,
    "grounded": 1,
    "timing": 1,
    "shouldDisplay": 1,
    "overall": 1,
    "issues": ["string"]
  },
  "pseudoLabel": {
    "idealReply": "string",
    "labelQuality": 0.0,
    "whyBetter": "string"
  },
  "review": {
    "needsXiangReview": true,
    "priority": "low | medium | high",
    "reason": "string"
  },
  "memory": {
    "shouldAddToPersonalMemory": false,
    "memoryType": "style | fact | example | preference | correction | none",
    "content": "string",
    "tags": ["string"],
    "confidence": 0.0
  }
}

Scoring rules:
- Scores are 1 to 5.
- timing = whether the output came at the right moment.
- shouldDisplay = whether any SayNext display was useful for this transcript.
- Mark needsXiangReview=true if overall <= 3 and the sample is useful to learn from, output invented personal details, pseudo label is high-value, context confidence < 0.65 for a meaningful sample, or the sample reveals a strong personal preference/style correction.
- Do not ask Xiang to review low-value ASR noise unless the model output was dangerous, very wrong, or invented personal details.
- Memory should be saved only for stable facts, reusable style corrections, or good examples. Do not save random one-off noise.

Source:
- sourceType: ${input.sourceType}
- sourceId: ${input.sourceId}
- userId: ${input.userId}
- timestamp: ${input.timestamp ?? ""}

Raw transcript:
${input.rawTranscript}

Current SayNext output:
${input.rawOutput || ""}`;
}

function clampScore(value: unknown, fallback: number): number {
  const numberValue = Number(value ?? fallback);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(1, Math.min(5, numberValue));
}

function clampConfidence(value: unknown, fallback: number): number {
  const numberValue = Number(value ?? fallback);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(1, numberValue));
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOutputLikeSegment(segmentText: string, input: PipelineRunInput, cleanedOutput: string): boolean {
  const segment = normalizeForCompare(segmentText);
  const rawOutput = normalizeForCompare(input.rawOutput || "");
  const output = normalizeForCompare(cleanedOutput);

  if (segment.length < 18) return false;
  return Boolean(
    (rawOutput && (rawOutput.includes(segment) || segment.includes(rawOutput))) ||
    (output && (output.includes(segment) || segment.includes(output)))
  );
}

function normalizeSegments(result: PersonalizationPipelineResult, input: PipelineRunInput, cleanedOutput: string): PipelineSegment[] {
  const rawTranscript = normalizeForCompare(input.rawTranscript);
  const cleanedTranscript = normalizeForCompare(result.cleanedTranscript || "");
  const rawSegments = Array.isArray(result.segments) ? result.segments : [];
  const segments = rawSegments
    .filter((segment) => segment?.text)
    .filter((segment) => !isOutputLikeSegment(segment.text, input, cleanedOutput))
    .filter((segment) => {
      if (segment.type === "noise") return true;
      const normalizedSegment = normalizeForCompare(segment.text);
      if (!normalizedSegment) return false;
      const shortSegment = normalizedSegment.slice(0, Math.min(40, normalizedSegment.length));
      return rawTranscript.includes(shortSegment) || cleanedTranscript.includes(shortSegment);
    })
    .slice(0, 12);

  if (segments.length > 0) return segments;

  const cleaned = String(result.cleanedTranscript || input.rawTranscript).trim();
  if (/^\[unclear asr noise\]$/i.test(cleaned)) {
    return [{ text: cleaned, speakerRole: "unknown", type: "noise" }];
  }

  return [{ text: cleaned, speakerRole: "unknown", type: "question" }];
}

function isLowValueAsrNoise(cleanedTranscript: string, segments: PipelineSegment[]): boolean {
  if (/^\[unclear asr noise\]$/i.test(cleanedTranscript.trim())) return true;
  if (segments.length > 0 && segments.every((segment) => segment.type === "noise")) return true;
  return false;
}

function isShortOrGarbled(text: string): boolean {
  const normalized = normalizeForCompare(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return true;
  return /\b(uh|um|gargle|hairy|nuts|naughty)\b/i.test(text) || /(?:\b\w{1,2}\b\s*){4,}/.test(text);
}

function hasTechnicalTerm(text: string): boolean {
  return /\b(supervised learning|supervise learning|machine learning|neural network|lambda|ec2|dynamodb|api|database|architecture|scalability|security|debugging|serverless|cloud|model|training)\b/i.test(text);
}

function containsInventedPersonalState(text: string): boolean {
  return /\b(i'?m still|i am still|in class|my class|i'?m trying to understand|i have been learning|i practiced every day)\b/i.test(text);
}

function shortenPseudoLabel(text: string): string {
  const cleaned = text
    .replace(/\bnuances\b/gi, "details")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const sentences = cleaned.match(/[^.!?]+[.!?]?/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !containsInventedPersonalState(sentence)) ?? [cleaned];

  return sentences.slice(0, 2).join(" ").slice(0, 360).trim();
}

function normalizePipelineResult(result: PersonalizationPipelineResult, input: PipelineRunInput): PersonalizationPipelineResult {
  const quality = result.quality ?? {};
  const overall = clampScore(quality.overall, 1);
  const cleanedOutput = String(result.cleanedOutput || input.rawOutput || "").trim();
  const cleanedTranscript = String(result.cleanedTranscript || input.rawTranscript).trim();
  const segments = normalizeSegments(result, input, cleanedOutput);
  const isNoise = isLowValueAsrNoise(cleanedTranscript, segments);
  const shortOrGarbled = isShortOrGarbled(cleanedTranscript);
  const onlyTechnicalClue = hasTechnicalTerm(cleanedTranscript) && shortOrGarbled;
  const rawContextConfidence = clampConfidence(result.context?.confidence, 0.4);
  const contextConfidence = isNoise
    ? Math.min(rawContextConfidence, 0.2)
    : onlyTechnicalClue
      ? Math.min(rawContextConfidence, 0.65)
      : rawContextConfidence;
  const pseudoLabelText = shortenPseudoLabel(String(result.pseudoLabel?.idealReply || ""));
  const timingScore = isNoise ? 1 : clampScore(quality.timing, overall);
  const shouldDisplayScore = isNoise ? 1 : clampScore(quality.shouldDisplay, overall);
  const issues = Array.isArray(quality.issues) ? quality.issues.slice(0, 10) : [];

  if (isNoise && !issues.some((issue) => /noise|asr/i.test(issue))) {
    issues.push("Low-value ASR noise; should not display.");
  }

  if (onlyTechnicalClue && !issues.some((issue) => /confidence|context/i.test(issue))) {
    issues.push("Context is uncertain; technical term alone is not enough.");
  }

  const outputIntent = isNoise
    ? {
        intent: "no_output" as const,
        shouldGenerateSayNext: false,
        reason: "Low-value ASR noise should stay silent instead of asking Xiang to clarify.",
      }
    : {
        intent: result.outputIntent?.intent || "no_output",
        shouldGenerateSayNext: Boolean(result.outputIntent?.shouldGenerateSayNext) && shouldDisplayScore >= 3,
        reason: String(result.outputIntent?.reason || ""),
      };

  const review = isNoise
    ? {
        needsXiangReview: false,
        priority: "low" as const,
        reason: "Low-value ASR noise; no review needed unless it caused a dangerous output.",
      }
    : {
        needsXiangReview: Boolean(result.review?.needsXiangReview),
        priority: result.review?.priority || (overall <= 3 ? "high" : "low"),
        reason: String(result.review?.reason || ""),
      };

  return {
    cleanedTranscript,
    cleanedOutput,
    segments,
    context: {
      scene: isNoise ? "unknown" : result.context?.scene || "unknown",
      confidence: contextConfidence,
      xiangExpectedToSpeak: isNoise ? false : Boolean(result.context?.xiangExpectedToSpeak),
      reason: isNoise ? "Low-value ASR noise." : String(result.context?.reason || ""),
    },
    event: {
      title: String(result.event?.title || "Untitled event").slice(0, 120),
      summary: String(result.event?.summary || "").slice(0, 1200),
      usefulFacts: Array.isArray(result.event?.usefulFacts) ? result.event.usefulFacts.slice(0, 8) : [],
      blindSpots: Array.isArray(result.event?.blindSpots) ? result.event.blindSpots.slice(0, 8) : [],
      possibleFollowUpQuestions: Array.isArray(result.event?.possibleFollowUpQuestions)
        ? result.event.possibleFollowUpQuestions.slice(0, 6)
        : [],
    },
    outputIntent,
    quality: {
      natural: clampScore(quality.natural, overall),
      useful: isNoise ? Math.min(clampScore(quality.useful, overall), 2) : clampScore(quality.useful, overall),
      concise: clampScore(quality.concise, overall),
      fitsXiang: clampScore(quality.fitsXiang, overall),
      grounded: clampScore(quality.grounded, overall),
      timing: timingScore,
      shouldDisplay: shouldDisplayScore,
      overall,
      issues,
    },
    pseudoLabel: {
      idealReply: isNoise ? "" : pseudoLabelText,
      labelQuality: isNoise || !pseudoLabelText ? 0 : Number(result.pseudoLabel?.labelQuality ?? 0),
      whyBetter: String(result.pseudoLabel?.whyBetter || "").slice(0, 800),
    },
    review,
    memory: {
      shouldAddToPersonalMemory: Boolean(result.memory?.shouldAddToPersonalMemory),
      memoryType: result.memory?.memoryType || "none",
      content: String(result.memory?.content || "").trim().slice(0, 1200),
      tags: Array.isArray(result.memory?.tags) ? result.memory.tags.slice(0, 12) : [],
      confidence: Number(result.memory?.confidence ?? 0),
    },
  };
}

export async function runPersonalizationPipeline(input: PipelineRunInput): Promise<{
  result: PersonalizationPipelineResult;
  rawModelOutput: string;
  model: string;
}> {
  const response = await generateLocalJson<PersonalizationPipelineResult>({
    prompt: buildPipelinePrompt(input),
    temperature: 0.1,
    numCtx: 8192,
    numPredict: 1600,
    timeoutMs: Number(process.env.PIPELINE_OLLAMA_TIMEOUT_MS || 90000),
  });

  return {
    result: normalizePipelineResult(response.data, input),
    rawModelOutput: response.rawText,
    model: response.model,
  };
}

export function sampleToPipelineInput(sample: ConversationSampleRecord): PipelineRunInput {
  return {
    sourceType: "sample",
    sourceId: String(sample.id),
    userId: sample.userId,
    rawTranscript: sample.transcript,
    rawOutput: sample.aiReply,
    timestamp: sample.timestamp,
  };
}
