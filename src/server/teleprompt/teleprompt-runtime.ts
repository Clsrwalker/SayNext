import { findBestMatch } from "string-similarity";

const MAX_CHUNK_CHARS = 135;
const MATCH_WINDOW = 4;
const MIN_ADVANCE_SCORE = 0.42;
const MIN_TOKEN_OVERLAP = 0.45;
const MIN_ADVANCE_WORD_RATIO = 0.65;
const MIN_TARGET_TOKEN_COVERAGE = 0.58;
const MIN_CURRENT_READING_EVIDENCE = 0.30;
const LONG_UNMATCHED_TRANSCRIPT_WORDS = 12;
const PENDING_UNMATCHED_TRANSCRIPT_WORDS = 10;
const MAX_IDLE_MS = 3 * 60 * 1000;
const TOKEN_OVERLAP_STOP_WORDS = new Set([
  "about",
  "actually",
  "after",
  "answer",
  "before",
  "can",
  "could",
  "does",
  "been",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "make",
  "more",
  "just",
  "now",
  "really",
  "should",
  "talk",
  "that",
  "the",
  "there",
  "this",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "would",
  "you",
  "your",
  "yeah",
  "and",
]);

type TelepromptStatus = "pending" | "ready";

export type TelepromptDisplay = {
  text: string;
  currentIndex: number;
  total: number;
  status: TelepromptStatus;
};

export type TelepromptTranscriptResult =
  | { action: "advance"; display: TelepromptDisplay }
  | { action: "rewind"; display: TelepromptDisplay }
  | { action: "hold"; consumed: boolean }
  | { action: "finish"; display: TelepromptDisplay }
  | { action: "cancel"; reason: string };

type ActiveTeleprompt = {
  id: string;
  sourceTranscript: string;
  openingLine: string;
  chunks: string[];
  currentIndex: number;
  status: TelepromptStatus;
  createdAt: number;
  lastActivityAt: number;
};

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return compact(text)
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(compact)
    .filter((sentence) => sentence.length > 0);
}

function chunkScript(text: string): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    if (`${current} ${sentence}`.length <= MAX_CHUNK_CHARS) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) chunks.push(current);

  if (chunks.length > 0) {
    return chunks;
  }

  const words = compact(text).split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 18) {
    chunks.push(words.slice(i, i + 18).join(" "));
  }
  return chunks.filter(Boolean);
}

function normalize(text: string): string {
  return compact(text)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\b(uh|um|erm|hmm|like|you know|sort of|kind of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInterruptionText(text: string): string {
  return compact(text)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitInterruptionMarker(text: string): boolean {
  const normalized = normalizeInterruptionText(text);
  if (!normalized) return false;

  return (
    /\bactually\s+(?:i already|we are|we already|we changed|user|backend|deadline|api|schema|cost|main issue|blocker|requirement|database|endpoint)\b/.test(normalized) ||
    /\bactually\s+the\s+(?:deadline|backend|api|schema|cost|main issue|blocker|requirement|database|endpoint)\b/.test(normalized) ||
    /\bno\s+(?:the|we|it|this|that)\b/.test(normalized) ||
    /\bbut\s+(?:i think the|i already|user|mobile|requirement|backend|api)\b/.test(normalized) ||
    /\bbut\s+the\s+(?:requirement|mobile screen|schema|backend|api|database|deadline|user flow|cost|blocker)\b/.test(normalized) ||
    /\bbut\s+we\s+(?:already|changed|are using|need|cannot|can't)\b/.test(normalized) ||
    /\bsorry\s+(?:the|meeting|to interrupt)\b/.test(normalized) ||
    /\bone more thing\b/.test(normalized) ||
    /\balso\s+(?:user|we|i)\b/.test(normalized) ||
    /\balso\s+the\s+user\b/.test(normalized) ||
    /\bthe\s+(?:blocker|requirement|deadline|database query|api response|dataset|cost limit)\b/.test(normalized) ||
    /\bthe main issue\s+(?:is|was)\b/.test(normalized) ||
    /\bwe changed\b/.test(normalized) ||
    /\bi already\b/.test(normalized) ||
    /\bthis is not for\b/.test(normalized)
  );
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(normalize(a).split(/\s+/).filter((token) => token.length > 2 && !TOKEN_OVERLAP_STOP_WORDS.has(token)));
  const right = new Set(normalize(b).split(/\s+/).filter((token) => token.length > 2 && !TOKEN_OVERLAP_STOP_WORDS.has(token)));
  if (!left.size || !right.size) return 0;

  let matches = 0;
  for (const token of left) {
    if (right.has(token)) matches += 1;
  }
  if (matches < 2) return 0;
  return matches / Math.min(left.size, right.size);
}

function contentTokens(text: string): string[] {
  return normalize(text).split(/\s+/).filter((token) => token.length > 2 && !TOKEN_OVERLAP_STOP_WORDS.has(token));
}

function targetTokenCoverage(source: string, target: string): number {
  const sourceTokens = new Set(contentTokens(source));
  const targetTokens = new Set(contentTokens(target));
  if (!sourceTokens.size || !targetTokens.size) return 0;

  let matches = 0;
  for (const token of targetTokens) {
    if (sourceTokens.has(token)) matches += 1;
  }
  if (matches < 2) return 0;
  return matches / targetTokens.size;
}

function hasTargetOpeningEvidence(source: string, target: string): boolean {
  const sourceTokens = new Set(contentTokens(source));
  const targetTokens = contentTokens(target).slice(0, 5);
  if (!sourceTokens.size || targetTokens.length < 2) return false;

  let consecutive = 0;
  for (const token of targetTokens) {
    if (!sourceTokens.has(token)) break;
    consecutive += 1;
  }
  return consecutive >= 2;
}

function wordCountRatio(a: string, b: string): number {
  const left = normalize(a).split(/\s+/).filter(Boolean).length;
  const right = normalize(b).split(/\s+/).filter(Boolean).length;
  if (!left || !right) return 0;
  return left / right;
}

function wordCount(text: string): number {
  return normalize(text).split(/\s+/).filter(Boolean).length;
}

function isLikelyNewQuestion(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (/\?$/.test(text.trim())) return true;
  if (/^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|tell me|describe|explain)\b/.test(normalized)) {
    return true;
  }
  return /\b(what about|how about|can you|could you|would you|do you|did you|what was|what is|how does|how do|why did|why do|tell me|describe|explain)\b/.test(normalized);
}

function isShortBackchannel(text: string): boolean {
  return /^(yeah|yes|right|okay|ok|sure|that makes sense|sounds good|got it|mm|hmm)[.!?\s]*$/i.test(text.trim());
}

function isLikelyInterruption(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || isShortBackchannel(text)) return false;
  if (isLikelyNewQuestion(text)) return true;
  if (hasExplicitInterruptionMarker(text)) return true;

  return (
    /\b(thank you|thanks)\b.*\b(now|next|move|part two|part three|another|question|topic)\b/.test(normalized) ||
    /\b(stop there|hold on|wait|before you continue)\b/.test(normalized) ||
    /\b(let s|lets)\s+(move|switch|talk|discuss|go back)\b/.test(normalized) ||
    /\b(that s enough|thats enough|no need for details|keep it shorter|not go too deep|move on to|skip this part)\b/.test(normalized) ||
    /\b(one second|pause)\b.*\b(question|ask|cost|mean|model)\b/.test(normalized) ||
    /\b(now|next|actually)\b.*\b(talk|move|switch|ask|question|explain|describe|tell|part|topic|instead|continue|discuss)\b/.test(normalized) ||
    /\b(change topic|another question|different topic|something different|go back to)\b/.test(normalized) ||
    /\bi want\b.*\b(ask|change|talk|switch|instead|part)\b/.test(normalized) ||
    /\b(interrupts|asks about|another question)\b/.test(normalized)
  );
}

function formatTeleprompt(active: ActiveTeleprompt): TelepromptDisplay {
  const total = Math.max(active.chunks.length, 1);
  const current = active.chunks[active.currentIndex] || active.openingLine;
  const next = active.chunks[active.currentIndex + 1];
  const progress = active.status === "pending" ? "" : `${Math.min(active.currentIndex + 1, total)} / ${total}`;

  return {
    currentIndex: active.currentIndex,
    total,
    status: active.status,
    text: [
      progress,
      "",
      current,
      next ? `\nNext:\n${next}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function formatFinished(active: ActiveTeleprompt): TelepromptDisplay {
  return {
    currentIndex: active.chunks.length,
    total: active.chunks.length,
    status: "ready",
    text: "Done. SayNext is listening.",
  };
}

export class TelepromptRuntime {
  private active: ActiveTeleprompt | null = null;

  startPending(sourceTranscript: string, openingLine: string, timestamp = Date.now()): TelepromptDisplay {
    this.active = {
      id: `teleprompt-${timestamp}`,
      sourceTranscript,
      openingLine,
      chunks: [openingLine],
      currentIndex: 0,
      status: "pending",
      createdAt: timestamp,
      lastActivityAt: timestamp,
    };

    return formatTeleprompt(this.active);
  }

  setScript(script: string, timestamp = Date.now()): TelepromptDisplay | null {
    if (!this.active) return null;

    const chunks = chunkScript(script)
      .map((chunk) => chunk.replace(/^(script|answer|response|continued answer)\s*:\s*/i, "").trim())
      .filter(Boolean);

    if (!chunks.length) {
      return null;
    }

    this.active.chunks = chunks;
    this.active.currentIndex = 0;
    this.active.status = "ready";
    this.active.lastActivityAt = timestamp;
    return formatTeleprompt(this.active);
  }

  isActive(): boolean {
    return Boolean(this.active);
  }

  cancel(): void {
    this.active = null;
  }

  getDisplay(): TelepromptDisplay | null {
    return this.active ? formatTeleprompt(this.active) : null;
  }

  advanceManual(timestamp = Date.now()): TelepromptTranscriptResult {
    if (!this.active) {
      return { action: "hold", consumed: false };
    }

    if (timestamp - this.active.lastActivityAt > MAX_IDLE_MS) {
      this.cancel();
      return { action: "cancel", reason: "teleprompt_idle_timeout" };
    }

    this.active.lastActivityAt = timestamp;

    if (this.active.status === "pending") {
      return { action: "hold", consumed: true };
    }

    this.active.currentIndex = Math.min(this.active.currentIndex + 1, this.active.chunks.length);

    if (this.active.currentIndex >= this.active.chunks.length) {
      const display = formatFinished(this.active);
      this.cancel();
      return { action: "finish", display };
    }

    return {
      action: "advance",
      display: formatTeleprompt(this.active),
    };
  }

  rewindManual(timestamp = Date.now()): TelepromptTranscriptResult {
    if (!this.active) {
      return { action: "hold", consumed: false };
    }

    if (timestamp - this.active.lastActivityAt > MAX_IDLE_MS) {
      this.cancel();
      return { action: "cancel", reason: "teleprompt_idle_timeout" };
    }

    this.active.lastActivityAt = timestamp;

    if (this.active.status === "pending") {
      return { action: "hold", consumed: true };
    }

    this.active.currentIndex = Math.max(0, this.active.currentIndex - 1);

    return {
      action: "rewind",
      display: formatTeleprompt(this.active),
    };
  }

  cancelManual(): TelepromptTranscriptResult {
    if (!this.active) {
      return { action: "hold", consumed: false };
    }

    this.cancel();
    return { action: "cancel", reason: "manual_cancel" };
  }

  handleTranscript(text: string, timestamp = Date.now()): TelepromptTranscriptResult {
    if (!this.active) {
      return { action: "hold", consumed: false };
    }

    if (timestamp - this.active.lastActivityAt > MAX_IDLE_MS) {
      this.cancel();
      return { action: "cancel", reason: "teleprompt_idle_timeout" };
    }

    this.active.lastActivityAt = timestamp;

    if (this.active.status === "pending") {
      if (isLikelyInterruption(text)) {
        this.cancel();
        return { action: "cancel", reason: "interruption_while_preparing" };
      }
      if (
        wordCount(text) >= PENDING_UNMATCHED_TRANSCRIPT_WORDS &&
        targetTokenCoverage(text, this.active.openingLine) < 0.35 &&
        !hasTargetOpeningEvidence(text, this.active.openingLine)
      ) {
        this.cancel();
        return { action: "cancel", reason: "new_long_transcript_while_preparing" };
      }
      return { action: "hold", consumed: true };
    }

    if (isShortBackchannel(text)) {
      return { action: "hold", consumed: true };
    }

    const window = this.active.chunks.slice(
      this.active.currentIndex,
      this.active.currentIndex + MATCH_WINDOW,
    );

    const normalizedWindow = window.map(normalize);
    const normalizedText = normalize(text);
    const { bestMatch, bestMatchIndex } = normalizedWindow.length
      ? findBestMatch(normalizedText, normalizedWindow)
      : { bestMatch: { rating: 0 }, bestMatchIndex: -1 };

    const matchedChunk = window[bestMatchIndex] || "";
    const overlap = tokenOverlap(text, matchedChunk);
    const coverage = targetTokenCoverage(text, matchedChunk);
    const completeness = wordCountRatio(text, matchedChunk);
    const currentChunk = window[0] || "";
    const currentOverlap = tokenOverlap(text, currentChunk);
    const currentCoverage = targetTokenCoverage(text, currentChunk);
    const hasCurrentReadingEvidence =
      currentCoverage >= MIN_CURRENT_READING_EVIDENCE ||
      currentOverlap >= MIN_CURRENT_READING_EVIDENCE ||
      hasTargetOpeningEvidence(text, currentChunk);
    const explicitInterruption = hasExplicitInterruptionMarker(text);

    const isCurrentChunkMatch = bestMatchIndex === 0;
    const isStrongFutureChunkMatch =
      bestMatchIndex > 0 &&
      completeness >= 0.78 &&
      bestMatch.rating >= 0.62 &&
      overlap >= 0.62 &&
      coverage >= 0.68;

    if (
      completeness >= MIN_ADVANCE_WORD_RATIO &&
      coverage >= MIN_TARGET_TOKEN_COVERAGE &&
      (
        (isCurrentChunkMatch && (bestMatch.rating >= MIN_ADVANCE_SCORE || overlap >= MIN_TOKEN_OVERLAP)) ||
        isStrongFutureChunkMatch
      )
    ) {
      const matchedAbsoluteIndex = this.active.currentIndex + Math.max(0, bestMatchIndex);
      this.active.currentIndex = Math.min(matchedAbsoluteIndex + 1, this.active.chunks.length);

      if (this.active.currentIndex >= this.active.chunks.length) {
        const display = formatFinished(this.active);
        this.cancel();
        return { action: "finish", display };
      }

      return {
        action: "advance",
        display: formatTeleprompt(this.active),
      };
    }

    if (wordCount(text) >= LONG_UNMATCHED_TRANSCRIPT_WORDS && !hasCurrentReadingEvidence && coverage < MIN_TARGET_TOKEN_COVERAGE) {
      this.cancel();
      return { action: "cancel", reason: "weak_long_match_during_teleprompt" };
    }

    if (wordCount(text) >= LONG_UNMATCHED_TRANSCRIPT_WORDS && bestMatchIndex > 0 && !isStrongFutureChunkMatch && !hasCurrentReadingEvidence) {
      this.cancel();
      return { action: "cancel", reason: "future_chunk_mismatch_during_teleprompt" };
    }

    if (explicitInterruption && !hasCurrentReadingEvidence) {
      this.cancel();
      return { action: "cancel", reason: "interruption_during_teleprompt" };
    }

    if (
      isLikelyInterruption(text) &&
      !hasCurrentReadingEvidence &&
      (completeness < MIN_ADVANCE_WORD_RATIO || (bestMatch.rating < MIN_ADVANCE_SCORE && overlap < MIN_TOKEN_OVERLAP))
    ) {
      this.cancel();
      return { action: "cancel", reason: "interruption_during_teleprompt" };
    }

    if (
      wordCount(text) >= LONG_UNMATCHED_TRANSCRIPT_WORDS &&
      bestMatch.rating < MIN_ADVANCE_SCORE &&
      overlap < MIN_TOKEN_OVERLAP &&
      !hasCurrentReadingEvidence
    ) {
      this.cancel();
      return { action: "cancel", reason: "unmatched_long_transcript_during_teleprompt" };
    }

    return { action: "hold", consumed: true };
  }
}

export function makeTelepromptOpeningLine(text: string): string {
  const normalized = normalize(text);

  if (/\b(lambda|lamba|lamda|serverless|server less|cold start|cold starts|database index|data base in dex|data base index|supervised learning|supervise learning|superwise learning|regularization|backpropagation|cloud architecture|multi az|multi-az|dynamodb|api gateway|s3|vpc|terraform|docker|container|kubernetes)\b/.test(normalized)) {
    return "Yeah, I can explain that. The main idea is pretty straightforward.";
  }

  if (/\b(why did you choose|why computer science|choose computer science)\b/.test(normalized)) {
    return "Yeah, at first I chose computer science because it felt practical, but I started liking it more after building projects.";
  }

  if (/\b(saynext|say next)\b/.test(normalized)) {
    return "Yeah, I can talk about SayNext. It's a mobile app I've been building for real-time conversation help.";
  }

  if (/\b(project|app|application|built|made)\b/.test(normalized)) {
    return "Yeah, one project I can talk about is SayNext, a mobile app I've been building recently.";
  }

  if (/\b(hard bug|debug|challenge|failure|conflict|feedback|leadership)\b/.test(normalized)) {
    return "Yeah, one example is from SayNext, where I had to deal with messy real-time context and improve the design.";
  }

  if (/\b(ielts|part 2|describe|talk about a time|an occasion)\b/.test(normalized)) {
    return "Yeah, I can talk about that. One example that comes to mind is pretty simple.";
  }

  return "Yeah, I can talk about that. Let me explain it in a simple way.";
}

export function shouldStartTeleprompt(text: string, sceneHint = ""): "none" | "expandable" | "long" {
  const textNormalized = normalize(text);
  const sceneNormalized = normalize(sceneHint);
  const normalized = normalize(`${text} ${sceneHint}`);
  const wordCount = textNormalized.split(/\s+/).filter(Boolean).length;
  const hasCjk = /[\u3400-\u9fff]/.test(text);

  if (!hasCjk && wordCount < 5) return "none";
  if (/\b(movie|tv|television|subtitle|subtitles|caption|captions|background)\b/.test(sceneNormalized)) {
    return "none";
  }
  if (/^(what'?s your name|where are you from|how are you|how'?s your day|do you like|are you|is it|can you repeat)\b/.test(textNormalized)) {
    return "none";
  }
  if (/^(what'?s the project name|what is the project name|what school|where (are|did) you study|what game|which game|what did you eat|what time do you|where do you live)\b/.test(textNormalized)) {
    return "none";
  }

  if (hasCjk && !/[a-z]/i.test(textNormalized)) {
    if (/(雅思|第二部分|两分钟|2分钟|一分钟|1分钟|演讲|展示|详细|完整|长一点)/.test(text)) return "long";
    if (/(多说一点|多讲一点|解释一下|解释下|讲一下|说一下|描述一下|介绍一下)/.test(text)) return "expandable";
    return "none";
  }

  const explicitLong = /\b(ielts part 2|part 2|two minute|two min|two minit|two minut|2 minute|2 min|one minute|one min|one minit|one minut|1 minute|1 min|one or two minutes|one or two min|1 or 2 minutes|presentation|presentaton|speech|long answer|longer answer|say more about|more details about|more detail about|in detail|in details|detailed explanation|detail explanation|explain long|explain longer|explan long|explan longer|could you explain long|can you explain long|could you explan long|can you explan long|could you explain longer|can you explain longer|walk me through|walk me thru|walk me true|walk us through|walk us thru|tell me about a time|tell me about a hard bug|tell me hard bug|tell me about a conflict|tell me conflict|tell me about a failure|tell me failure|tell me about a challenge|tell me challenge|tell me about a time|what constructive feedback|describe a time|describe an occasion|describe a room|describe a place|describe a skill|describe a childhood|describe your favorite|describe your favourite|descrip a room|descrip a place|descrip a skill|descripe a room|descripe a place|can you present|could you present|please present)\b/.test(textNormalized);
  if (explicitLong) return "long";

  const roughLongIntent = /\b(long|longer|detail|details|detailed|one min|two min|2 min|1 min|for a while|full answer|whole answer)\b/.test(textNormalized)
    && /\b(answer|explain|explan|talk|tell|describe|descrip|present|project|experience|story)\b/.test(textNormalized);
  if (roughLongIntent) return "long";

  if (/\bielts\b/.test(sceneNormalized) && /^describe\b/.test(textNormalized)) {
    return "long";
  }

  if (/\bdescribe\b.*\b(explain why|meaningful|important|memorable|favorite|favourite)\b/.test(normalized)) {
    return "long";
  }

  const structuredTopic = /\b(project|projct|projec|experience|experence|challenge|failure|conflict|feedback|leadership|hard bug|debugging|debug|architecture|architec|architexture|system design|trade off|tradeoff|sql|nosql|hash map|remote work|serverless|server less|lambda|lamba|lamda|cold start|cold starts|cold stared|cold starter|supervised learning|supervise learning|superwise learning|answer supervise learning|database index|data base index|data base in dex|slow query|object storage|what is an object|containerd|container runtime|container registry|docker|kubernetes|config map|configmap|secret manager|aws service|aws services|aws resource|aws resources|iam role|s3 path|cloudfront|route 53|primary database|secondary database|database replication|network partition|prompt|prompts|opinion about|why did you choose|what do you think about|how do you think|can you explain|could you explain|please explain|can you explan|could you explan|please explan|explain your|explain a|explain the|explan your|explan a|explan the|tell me more about|tell me about|talk about how|talk bout how|describe|descrip|descripe|explain how|explain why|explan how|explan why|how would you explain|how would you explan|how did you test|how did you improve)\b/.test(textNormalized);
  const technicalExplainIntent = structuredTopic && (
    /\b(can|could|would|please)?\s*(you\s+)?(explain|explan|describe|descrip|walk me through|walk me thru|walk us through|walk us thru|tell me about|tell me more about)\b/.test(textNormalized) ||
    /\b(why|how)\b/.test(textNormalized)
  );
  const projectNarrativeIntent = structuredTopic && (
    /^(what|which)\b.*\b(project|challenge|role|leadership|feedback|architecture|experience|bug|conflict|failure|decision)\b/.test(textNormalized) ||
    /\b(can|could|would)\s+you\s+(talk about|tell about)\b/.test(textNormalized) ||
    /^tell about\b/.test(textNormalized)
  );
  const classroomLecture = /\bclassroom\b/.test(sceneNormalized) && /\b(teacher|lecture|explaining|concept)\b/.test(sceneNormalized);
  if (classroomLecture) {
    const directClassroomQuestion = /\?$/.test(text.trim())
      || /^(what|why|how|when|where|who|which)\s+(is|are|do|does|did|can|could|would|should|will|was|were)\b/.test(textNormalized)
      || /^(can|could|would|do|does|did|is|are|have|has)\b/.test(textNormalized)
      || /^(tell me (about|what|why|how|when|where|which)|explain)\b/.test(textNormalized)
      || /\b(can someone|can somebody|does anybody|anybody|how do you|how would you|why do)\b/.test(textNormalized)
      || (structuredTopic && /\b(why|how|explain|explan)\b/.test(textNormalized));
    if (!directClassroomQuestion) return "none";
    if (
      explicitLong ||
      roughLongIntent ||
      /\b(tell me about|tell me more about|describe|walk me through|walk me thru|walk us through|walk us thru|explain in detail|explain longer|long answer)\b/.test(textNormalized)
    ) {
      return "expandable";
    }
    if (technicalExplainIntent) {
      return "expandable";
    }
    return "none";
  }

  if (/\b(tell me about|tell me more about|talk about how|can you describe|could you describe|please describe|describe a|describe an|describe your|descrip a|descrip an|descripe a|descripe an|can you explain|could you explain|please explain|can you explan|could you explan|please explan|walk me through|walk me thru|walk us through|walk us thru|how did you test|how did you improve|why did you choose|what do you think about|what is your opinion about|what's your opinion about)\b/.test(textNormalized)) {
    return "expandable";
  }

  if (technicalExplainIntent || projectNarrativeIntent) {
    return "expandable";
  }

  return "none";
}
