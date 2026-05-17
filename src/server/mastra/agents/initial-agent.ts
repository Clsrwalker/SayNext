import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { Action, AgentType, type Conversation, type AgentResponse } from "../types";
import type { EventMemorySnapshot } from "../../memory/event-memory";

const sayNextInstructions = `You are SayNext, Xiang's real-time conversation helper.

Output one short text that is useful on the current screen right now. It can be:
- a sayable reply when someone asks Xiang something
- a short knowledge supplement when someone is explaining a concept
- a brief acknowledgement or clarification when that is all that helps

Core rules:
- Prioritize the latest transcript. Older context is only background.
- Do not repeat or summarize the speaker's words
- Use personal background only when the question asks about Xiang's experience, project, school, work, preference, or plan.
- Do not invent Xiang's personal experience or claim senior work experience.
- For low-stakes IELTS/daily personal questions, it is okay to add small plausible details if they fit Xiang and make the answer sound real. Keep them ordinary and low-risk.
- Do not invent important facts: school names, course names, family events, health, immigration, work history, company experience, real project details, exact dates, awards, or named people unless supported by profile, relevant memory, prenote, or recent transcript.
- Known projects only: SayNext, Elder Album, Dal Parking Aid / DalParkAid, JobLens, and Study Session Tracker. If a project question is unclear, ask a short clarification instead of inventing a project name.
- For professional, technical, or academic topics, be precise and knowledgeable. Use correct domain terms when useful.
- For technical questions, answer the concept first with a useful principle, mechanism, trade-off, tool, or debugging step.
- For DynamoDB slow query issues, mention the access pattern and whether the partition key, sort key, or GSI/index matches that query; also consider hot partitions.
- For lecture/explanation context, provide a deeper useful note, concrete example, trade-off, or smart question. Do not write it as fake small talk.
- For classroom lecture transcripts, sound like a capable student adding one useful point, not like a professor. Good shapes are: "The key difference is...", "A quick example is...", "One way to think about it is...", or "So the limitation is...".
- If the professor asks the class a concept question, answer directly in 1-2 speakable sentences. If the professor is explaining, add one connection, example, limitation, or clarifying question instead of restating the lecture.
- For meeting/group work, move the task forward. If someone is blocked by missing API/schema/info, suggest a concrete unblock step like using a mock schema, documenting assumptions, or asking for the exact contract.
- For casual chat, sound like a normal student: simple, modest, slightly imperfect, not essay-like, not corporate.
- Obey the requested output language. If Output language is English, answer in English even when the transcript is Chinese or mixed. Use Chinese only when Output language is Chinese.
- For one-word or fragment transcripts like "And", "Yeah", "Present", or broken ASR, do not invent a full conversation. Give the smallest useful acknowledgement or clarification.
- For unclear short questions like "Is that normal?", answer briefly if likely, or ask "What do you mean exactly?" Do not say "give me more context", "what are you referring to", or similar meta wording.
- If the transcript looks like a third-party/public dialogue or speaker-labelled meeting, do not insert Xiang into it, do not say "I'm Xiang", and do not claim a role unless the speaker directly asks Xiang to introduce himself.
- For public/open transcript or overheard third-party dialogue, do not use Xiang's personal hobbies, projects, school, or career. Keep it neutral.
- Do not ask a return question unless it clearly helps. Do not act like a therapist, coach, or assistant managing the other person's life.
- If the user asks "what should I say" or "how should I answer", still output the exact words Xiang should say, not advice about how to answer.
- Avoid mission statements, self-praise, resume wording, and stiff openings like "Today I plan to..."
- Never use the phrase "dream job", even to say Xiang does not have one.
- Do not include labels, analysis, options, translations, or "you can say".

Style:
- short, natural, easy to say or read, Sound like a real person talking, not a written answer
- usually 1 sentence; 2-4 short sentences are okay for professional or academic questions when depth is needed
- okay to use "honestly", "probably", "kind of", "a bit", "not really", "I guess", "like".
-Avoid sounding too confident, too perfect, or too prepared.

- English by default; Chinese only when the output language setting is Chinese.


Return only valid JSON in this exact shape:
{"type":"insight","reasoning":"brief private reason","timestamp":0,"output":"the short useful text to show","confidence":0.8,"metadata":{"agentType":"Initial"}}

The output field is the only text that will be shown on the display.`;

const MODEL_NAME = "gpt-4.1-mini";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || process.env.MODEL_TIMEOUT_MS || 30000);
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const PROFILE_VERSION = "3.0";
const ACTIVE_MODEL_NAME = LLM_PROVIDER === "ollama" ? OLLAMA_MODEL : MODEL_NAME;

const telepromptInstructions = `You write natural spoken teleprompt scripts for Xiang.

Return only the script text. No JSON, no labels, no bullet points, no stage directions.

The script should sound like Xiang speaking:
- natural spoken English by default
- simple, slightly imperfect, not corporate
- clear enough for interviews, IELTS, presentations, or project explanations
- concrete when useful, but do not invent high-risk facts
- ordinary low-risk details are allowed for IELTS/daily examples if they fit Xiang

Avoid:
- "Today I will talk about"
- "In conclusion"
- fake senior work experience
- unsupported company, school, family, health, immigration, award, exact date, or named-person facts`;

export const initialAgentHigh = new Agent({
  name: "SayNextAgentHigh",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions
});

export const initialAgentMedium = new Agent({
  name: "SayNextAgentMedium",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions
});

export const initialAgentLow = new Agent({
  name: "SayNextAgentLow",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions
});

const telepromptAgent = new Agent({
  name: "SayNextTelepromptAgent",
  model: openai(MODEL_NAME),
  instructions: telepromptInstructions,
});

export function sanitizeSayNextOutput(text: string): string {
  let cleaned = String(text ?? "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (/^\s*\{/.test(cleaned)) {
    const outputField = extractOutputField(cleaned);
    if (outputField) {
      cleaned = outputField;
    } else {
      return "Sorry, could you say that again?";
    }
  }

  cleaned = cleaned
    .replace(/\r\n/g, "\n")
    .replace(/\b(?:option|version|response)\s*\d+\s*[:.)-]/gi, "\n")
    .replace(/\b(?:option|version|response)\s*[A-Z]\s*[:.)-]/gi, "\n");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstUsefulLine = lines.find((line) => {
    return !/^(scene|analysis|reasoning|explanation|note|context)\s*[:-]/i.test(line);
  }) ?? lines[0] ?? "";

  cleaned = firstUsefulLine
    .replace(/^\s*[A-Z]\s*:\s*/i, "")
    .replace(/^\s*(?:[-*]+|\d+[.)]|[A-Za-z][.)])\s*/g, "")
    .replace(/^\s*(?:(?:you\s+can\s+say|you\s+could\s+say|say|direct\s+answer|answer|reply|response|suggested\s+reply)\s*[:-]\s*)+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();

  const metaQuoted = cleaned.match(/\b(?:just say|say|like|such as)\s+["“]([^"”]{1,80})["”]/i);
  if (
    metaQuoted?.[1]
    && /\b(?:would work|if that|since there|referring to|acknowledg|casual|what the professor|attendance|best answer)\b/i.test(cleaned)
  ) {
    cleaned = metaQuoted[1].trim();
  }

  if (/^you can mention what (?:you'?ve|you have) accomplished/i.test(cleaned)) {
    cleaned = "I can give a quick update on what I finished, what I'm working on, and any blocker.";
  } else if (/^you can mention\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/^you can mention\b/i, "I can mention").trim();
  }

  cleaned = cleaned
    .replace(/\s*(?:Can you|Could you)\s+give me more context\??/gi, "")
    .replace(/\bI don'?t really have a super dramatic dream job,\s*but\s*/i, "")
    .replace(/\bI don'?t have a dream job,\s*but\s*/i, "")
    .replace(/\bdream job\b/gi, "ideal role")
    .trim();

  if (!cleaned) {
    return "Sorry, could you say that again?";
  }

  if (/^(sure|okay|ok|yes|yeah|thank you|thanks)[.!]*$/i.test(cleaned)) {
    return "Sure, could you repeat the full question?";
  }

  if (cleaned.length > 360) {
    const firstSentence = cleaned.match(/^.{1,360}?[.!?](?:\s|$)/)?.[0]?.trim();
    cleaned = firstSentence || `${cleaned.slice(0, 357).trim()}...`;
  }

  return cleaned;
}

function containsChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function enforceOutputLanguage(output: string, transcript: string, outputLanguage: OutputLanguage): string {
  if (outputLanguage === "chinese" || !containsChinese(output)) {
    return output;
  }

  const normalizedTranscript = transcript.trim().toLowerCase();

  if (/自己做/.test(transcript)) {
    return "Yeah, I made it myself.";
  }

  if (/我拒绝|不想|不要/.test(transcript)) {
    return "Yeah, I don't really want to do that.";
  }

  if (/不太了解|不知道|不清楚/.test(transcript)) {
    return "I'm not really sure about that yet.";
  }

  if (/你好|哈喽|hello|hi/.test(normalizedTranscript)) {
    return "Hey, how's it going?";
  }

  return "Sorry, could you say that again in English?";
}

function removeUnsupportedIdentityClaim(output: string, transcript: string): string {
  const transcriptLooksSpeakerLabeled = /^\s*[A-Z]\s*:/i.test(transcript);
  const transcriptAsksXiangIdentity = /\b(your name|who are you|introduce yourself|tell me about yourself)\b/i.test(transcript);

  if (!transcriptLooksSpeakerLabeled && transcriptAsksXiangIdentity) {
    return output;
  }

  if (!/\bI'?m Xiang\b|\bI am Xiang\b/i.test(output)) {
    return output;
  }

  const kept = output
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bI'?m Xiang\b|\bI am Xiang\b|\bbackend development\b/i.test(sentence))
    .join(" ")
    .trim();

  return kept || "Nice to meet you.";
}

function looksLikePublicOpenEvent(eventMemory?: EventMemorySnapshot): boolean {
  const text = `${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();
  return /\bsource=open_|source=short_form|public open|open meeting|open lecture|open-domain|third-party\b/.test(text);
}

function removePublicTranscriptPersonalLeak(output: string, eventMemory?: EventMemorySnapshot): string {
  if (!looksLikePublicOpenEvent(eventMemory)) {
    return output;
  }

  const leakPattern = /\b(xiang|x-i-a-n-g|li\b|dalhousie|macs|chengdu|saynext|elder album|joblens|dalparkaid|my project|coding|gaming|video games|aws|lambda|dynamodb|my sister|my brother|my family|my childhood|when i was a child|back in chengdu)\b/i;
  const filtered = output
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      return !leakPattern.test(sentence);
    })
    .join(" ")
    .trim();

  if (filtered) return filtered;
  if (/\bspell|name\b/i.test(output)) return "Could you spell it out?";
  if (leakPattern.test(output)) return "Yeah, that makes sense.";
  return output;
}

function removeWrongNameEcho(output: string, transcript: string): string {
  if (!/\b(name|pronounce|pronunciation|called|correct me)\b/i.test(transcript) || !/\bdaewon\b/i.test(output)) {
    return output;
  }

  const filtered = output
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bdaewon\b/i.test(sentence))
    .join(" ")
    .trim();

  return filtered || "I'm good, thanks. My name is Xiang Li, but Xiang is fine.";
}

function finalizeSayNextOutput(text: string, transcript: string, outputLanguage: OutputLanguage, eventMemory?: EventMemorySnapshot): string {
  const cleaned = sanitizeSayNextOutput(text);
  const withoutIdentityClaim = removeUnsupportedIdentityClaim(cleaned, transcript);
  const withoutWrongNameEcho = removeWrongNameEcho(withoutIdentityClaim, transcript);
  const withoutPublicLeak = removePublicTranscriptPersonalLeak(withoutWrongNameEcho, eventMemory);
  return enforceOutputLanguage(withoutPublicLeak, transcript, outputLanguage);
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function extractOutputField(text: string): string | null {
  const match = text.match(/"output"\s*:\s*"((?:\\.|[^"\\])*)/i);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(`"${match[1].replace(/\\?$/, "")}"`);
  } catch {
    return match[1].replace(/\\"/g, '"').trim();
  }
}

async function generateWithOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: `${sayNextInstructions}\n\nDo not return JSON for Ollama. Return only the short useful text to show on the display.`,
      prompt: `${prompt}\n\nReturn only one short useful text. Use 2-4 short sentences if a professional or academic question needs depth. Obey the Output language exactly. If Output language is English, do not output Chinese. No JSON. No labels. No reasoning.`,
      stream: false,
      options: {
        temperature: 0.35,
        top_p: 0.9,
        num_ctx: 4096,
        num_predict: 120,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "");
}

async function withModelTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function generateLongWithOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(OLLAMA_TIMEOUT_MS, 60000));

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: telepromptInstructions,
      prompt,
      stream: false,
      options: {
        temperature: 0.45,
        top_p: 0.9,
        num_ctx: 4096,
        num_predict: 420,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama teleprompt request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "");
}

function normalizeTelepromptPrefix(text: string): string {
  return String(text || "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .toLowerCase();
}

function stripLeadingOpeningLine(text: string, openingLine?: string): string {
  const opening = openingLine?.trim();
  const cleaned = text.trim();
  if (!opening || !cleaned) return cleaned;

  const directOpening = opening.toLowerCase();
  const directCleaned = cleaned.toLowerCase();
  if (directCleaned.startsWith(directOpening)) {
    return cleaned
      .slice(opening.length)
      .replace(/^[\s:,\-.!?]+/, "")
      .trim();
  }

  const target = normalizeTelepromptPrefix(opening);
  const scanLimit = Math.min(cleaned.length, opening.length + 80);
  for (let index = 0; index < scanLimit; index += 1) {
    const char = cleaned[index];
    if (char !== "." && char !== "!" && char !== "?" && char !== "\n") continue;

    const candidate = cleaned.slice(0, index + 1);
    if (normalizeTelepromptPrefix(candidate) === target) {
      return cleaned
        .slice(index + 1)
        .replace(/^[\s:,\-.!?]+/, "")
        .trim();
    }
  }

  return cleaned;
}

function sanitizeTelepromptScript(text: string, openingLine?: string): string {
  let cleaned = String(text || "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (/^\s*\{/.test(cleaned)) {
    const output = extractOutputField(cleaned);
    if (output) cleaned = output;
  }

  cleaned = cleaned
    .replace(/^\s*(script|answer|response|teleprompt|continued answer)\s*:\s*/i, "")
    .replace(/\bI don'?t really have a super dramatic dream job,\s*but\s*/i, "")
    .replace(/\bI don'?t have a dream job,\s*but\s*/i, "")
    .replace(/\bdream job\b/gi, "ideal role")
    .replace(/\bOverall,\s*/gi, "")
    .replace(/\bIn conclusion,\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  cleaned = stripLeadingOpeningLine(cleaned, openingLine);

  return cleaned;
}

function isRoomHomeTeleprompt(text: string): boolean {
  return /\b(room|bedroom|home|house|place where you live|where you live)\b/i.test(text);
}

function stripUnsupportedRoomVisualDetails(script: string, latestTranscript: string): string {
  if (!isRoomHomeTeleprompt(latestTranscript)) return script;

  const unsupportedVisualDetail = /\b(window|windows|view|poster|posters|plant|plants|wall|walls|floor|floors|chair|chairs|armchair|decorated|decoration|decorations|tidy|organized|organised|furniture|lamp|bookshelf|shelf|shelves)\b/i;
  const sentences = script
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const filtered = sentences.filter((sentence) => !unsupportedVisualDetail.test(sentence));

  return filtered.length > 0 ? filtered.join(" ") : script;
}

function createInsight(output: string, reasoning: string, timestamp: number, confidence = 0.9): AgentResponse {
  return {
    type: Action.INSIGHT,
    reasoning,
    timestamp,
    output: sanitizeSayNextOutput(output),
    confidence,
    metadata: {
      agentType: AgentType.Initial,
      agentInput: {
        model: ACTIVE_MODEL_NAME,
        profileVersion: PROFILE_VERSION,
        retrievedSampleIds: [],
      }
    }
  };
}

function getLatestTranscript(conversation: Conversation): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const item = conversation[i];
    if (item.type === 'transcript') {
      return item.text;
    }
  }

  return "";
}

export type OutputLanguage = "english" | "chinese";

type PromptMode = "casual" | "classroom" | "interview" | "technical" | "service" | "general";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countTelepromptWords(text: string): number {
  const compacted = String(text || "").replace(/\s+/g, " ").trim();
  const words = compacted.split(/\s+/).filter(Boolean).length;
  const cjkChars = compacted.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return cjkChars > 0 ? Math.max(words, Math.round(cjkChars / 2)) : words;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /[?？]\s*$/.test(normalized) || /^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|tell me|describe|explain)\b/.test(normalized);
}

function detectPromptMode(latestTranscript: string, eventMemory?: EventMemorySnapshot): PromptMode {
  const text = `${latestTranscript} ${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();

  if (includesAny(text, ["interview", "candidate", "hire", "resume", "tell me about yourself", "why should we hire", "position", "role"])) {
    return "interview";
  }

  if (includesAny(text, [
    "classroom",
    "lecture",
    "professor",
    "course",
    "assignment",
    "academic",
    "algorithm",
    "theorem",
    "math",
    "proof",
    "model",
    "training",
    "loss",
    "gradient",
    "backprop",
    "supervised learning",
    "unsupervised learning",
    "neural network",
    "deep learning",
    "machine learning",
    "data structure",
    "distributed system",
    "consistency",
    "cap theorem",
    "cloud architecting",
    "availability zone",
    "lambda",
    "dynamodb",
    "scalability",
    "elasticity",
  ])) {
    return "classroom";
  }

  if (includesAny(text, [
    "api",
    "backend",
    "frontend",
    "cloud",
    "database",
    "debug",
    "architecture",
    "security",
    "aws",
    "firebase",
    "react",
    "serverless",
    "kubernetes",
    "sagemaker",
    "machine learning",
    "deep learning",
    "code",
  ]) || /\b(ai|llm|artificial intelligence)\b/.test(text)) {
    return "technical";
  }

  if (includesAny(text, ["front desk", "maintenance", "advisor", "insurance", "bank", "policy", "residence", "deadline", "appointment"])) {
    return "service";
  }

  if (includesAny(text, ["weekend", "free time", "music", "game", "food", "anime", "friend", "weather", "holiday", "mountain", "morning", "day going"])) {
    return "casual";
  }

  return "general";
}

function buildCompactXiangProfile(mode: PromptMode): string {
  const base = [
    "Name: Xiang Li.",
    "Identity: Chinese international MACS student at Dalhousie in Halifax; from Chengdu and moved to Canada during high school.",
    "Core style: simple spoken English, natural, low-pressure, modest, internet-native, slightly imperfect is okay.",
    "Tone: calm, relaxed, not performatively hardworking, not corporate, not fake-positive, not motivational-speaker.",
    "Useful words: honestly, probably, definitely, kind of, mostly, a bit, not really, I guess, maybe, like.",
    "Social style: introverted/homebody, small circle, reactive more than proactive, comfortable being alone, does not like forced social energy.",
    "Motivation pattern: wants to look capable and prepared, but dislikes pressure and blank-page thinking; AI should organize messy input and reduce mental startup cost.",
    "Work/learning style: procrastinates but usually finishes; learns best by practical examples, building, testing, and AI-assisted iteration.",
    "Professional/academic topics: be accurate, specific, and capable. Give strong domain reasoning without claiming senior personal experience.",
    "Privacy: never volunteer family names, exact private background, health, bullying, finances, romantic inexperience, PR/immigration goals, or sensitive life events unless Xiang explicitly asks to use them.",
    "Avoid: polished essay tone, resume wording, self-praise, fake confidence, corporate words, unsolicited advice, overexplaining.",
  ];

  const modeProfiles: Record<PromptMode, string[]> = {
    casual: [
      "Casual life: indoor-focused, low-energy, likes games/anime/internet culture/memes/music, fried chicken, Sichuan flavors, soda, takeout, late sleep.",
      "Gaming: open-world/RPG/immersive games, Pokemon, Genshin, Zenless Zone Zero, game music, scripting/tools/automation for games.",
      "Casual replies should sound like a real local-ish student: short, chill, meme-aware when natural, not too grammatically perfect.",
      "Do not be nosy, do not give life advice, do not over-care. Answer the vibe and keep it low-pressure.",
      "Small funny detail is okay; do not turn daily chat into a personal essay or deep meaning summary.",
    ],
    classroom: [
      "Classroom: Xiang wants to appear knowledgeable and capable, but still student-like.",
      "Academic/lecture content: prioritize correctness and depth. Use mechanisms, terms, assumptions, examples, and trade-offs when useful.",
      "When the speaker is explaining a concept, give a useful supplement, concrete example, trade-off, or sharp question Xiang could ask.",
      "When Xiang is asked directly, give a speakable answer that is short but not shallow.",
      "Current Summer 2026 courses: Advanced Cloud Architecting, Deep Learning Applications, and Recommender Systems.",
      "Do not make classroom answers sound like casual small talk.",
    ],
    interview: [
      "Interview: honest, clear, professional student tone. Xiang wants to sound capable without overclaiming.",
      "He has hands-on student project experience in web/mobile apps, Firebase, AWS serverless, and AI-related tools.",
      "Projects available if asked: SayNext, Elder Album, Dal Parking Aid / DalParkAid, JobLens, and Study Session Tracker.",
      "Unknown tech: do not fake experience; say he has not used it in a real project yet.",
      "Interview help should organize answers because Xiang has difficulty memorizing scripts and structured speaking.",
      "Career: wants a stable software/cloud/full-stack/AI job and long-term life stability in Canada.",
      "For technical interview questions, give a clear concept, simple solution path, and practical debugging/architecture details.",
    ],
    technical: [
      "Technical background: CS/MACS student with hands-on web, mobile, Firebase, AWS serverless, and AI-related app experience.",
      "Technical/professional output should be senior-level in knowledge: precise, practical, and specific, without claiming senior personal experience.",
      "For knowledge questions, answer generally first using mechanisms and practical details: logs, metrics, permissions, data access pattern, cost, reliability, control.",
      "For problem-solving, be proactive and opinionated: infer the likely issue, give the best next step, and explain briefly how to verify.",
      "Use a personal project only when the question asks for Xiang's own experience or example.",
    ],
    service: [
      "Service/admin: polite, simple, direct. Explain the issue first and ask what to do next.",
      "Mention exact residence or private details only when needed for residence/front desk/maintenance.",
    ],
    general: [
      "General: answer the latest question naturally and briefly. Use personal details only if they help.",
    ],
  };

  return [...base, ...modeProfiles[mode]].join("\n");
}

function formatCompactEventMemory(eventMemory?: EventMemorySnapshot): string {
  if (!eventMemory) return "No active event memory.";

  const recent = eventMemory.recentTranscripts
    .slice(-3)
    .map((text) => text.length > 140 ? `${text.slice(0, 137)}...` : text);
  const meetingState = eventMemory.meetingState;
  const formattedMeetingState = meetingState
    ? [
      meetingState.projectTopic ? `Project/topic: ${meetingState.projectTopic}` : "",
      meetingState.currentGoal ? `Current goal: ${meetingState.currentGoal}` : "",
      meetingState.currentDecision ? `Current decision: ${meetingState.currentDecision}` : "",
      meetingState.openBlockers.length ? `Open blockers: ${meetingState.openBlockers.join(" | ")}` : "",
      meetingState.knownAssumptions.length ? `Known assumptions: ${meetingState.knownAssumptions.join(" | ")}` : "",
      meetingState.actionItems.length ? `Action items: ${meetingState.actionItems.join(" | ")}` : "",
      meetingState.xiangResponsibility ? `Xiang responsibility: ${meetingState.xiangResponsibility}` : "",
      meetingState.nextUsefulMove ? `Next useful move: ${meetingState.nextUsefulMove}` : "",
    ].filter(Boolean).join("\n")
    : "";

  return [
    `Scene: ${eventMemory.scene}`,
    eventMemory.title ? `Title: ${eventMemory.title}` : "",
    `Summary: ${eventMemory.summary.length > 260 ? `${eventMemory.summary.slice(0, 257)}...` : eventMemory.summary}`,
    formattedMeetingState ? `Live meeting state:\n${formattedMeetingState}` : "",
    recent.length ? `Recent: ${recent.map((text) => `"${text}"`).join(" | ")}` : "",
  ].filter(Boolean).join("\n");
}

function getFallbackResponse(transcript: string, timestamp: number): AgentResponse {
  const normalized = transcript.trim().toLowerCase();

  if (/^(definitely|yeah|yes|right|exactly|true|sounds good)[.!]*$/i.test(normalized)) {
    return createInsight(
      "Yeah, that makes sense.",
      "Fallback acknowledgement after model failure",
      timestamp,
      0.4,
    );
  }

  if (normalized.includes("do you like") || normalized.includes("what do you think")) {
    return createInsight(
      "Yeah, I think so, but I need a second to explain it clearly.",
      "Fallback buy-time response after model failure",
      timestamp,
      0.4,
    );
  }

  return createInsight(
    "Sorry, could you say that again?",
    "Fallback clarification after model failure",
    timestamp,
    0.3,
  );
}

function getImmediateResponse(transcript: string, timestamp: number, outputLanguage: OutputLanguage): AgentResponse | null {
  const normalized = transcript.trim();
  const lower = normalized.toLowerCase();

  if (/^present[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese" ? "到。" : "I'm here.",
      "Immediate attendance response",
      timestamp,
      0.95,
    );
  }

  if (outputLanguage === "chinese" && /\bzhoumo\b|周末/i.test(normalized)) {
    return createInsight(
      "可能就在家休息，打打游戏或者看点动漫，有项目的话就补一下。",
      "Immediate Chinese weekend response",
      timestamp,
      0.85,
    );
  }

  if (/^(and|uh|um|yeah|yes|right|okay|ok)[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese" ? "不好意思，刚才那部分能再说一下吗？" : "Sorry, what was the last part?",
      "Immediate fragment clarification",
      timestamp,
      0.8,
    );
  }

  const speakerIntro = normalized.match(/^\s*[A-Z]\s*:\s*(?:hi|hello|hey)[, ]+(?:i'?m|i am)\s+([A-Za-z][A-Za-z .'-]{1,40})[.!?\s]*$/i);
  if (speakerIntro?.[1]) {
    const name = speakerIntro[1].trim().replace(/[.!?]+$/, "");
    return createInsight(
      outputLanguage === "chinese" ? `你好，${name}。` : `Nice to meet you, ${name}.`,
      "Immediate speaker introduction response",
      timestamp,
      0.85,
    );
  }

  if (/自己做/.test(transcript) && outputLanguage === "english") {
    return createInsight("Yeah, I made it myself.", "Immediate bilingual English response", timestamp, 0.8);
  }

  if ((/不太了解|不知道|不清楚/.test(transcript)) && outputLanguage === "english") {
    return createInsight("I'm not really sure about that yet.", "Immediate bilingual English response", timestamp, 0.8);
  }

  if ((/我拒绝|不想|不要/.test(transcript)) && outputLanguage === "english") {
    return createInsight("Yeah, I don't really want to do that.", "Immediate bilingual English response", timestamp, 0.8);
  }

  if (lower === "water.") {
    return createInsight(
      outputLanguage === "chinese" ? "我想喝点水。" : "I could use some water.",
      "Immediate short word response",
      timestamp,
      0.75,
    );
  }

  return null;
}

export async function generateTelepromptScript(params: {
  conversation: Conversation;
  eventMemory?: EventMemorySnapshot;
  outputLanguage?: OutputLanguage;
  activePrenoteContext?: string;
  activeSceneProfilePrompt?: string;
  relevantPersonalMemoryContext?: string;
  openingLine: string;
  targetMode: "expandable" | "long";
}): Promise<string> {
  const latestTranscript = getLatestTranscript(params.conversation);
  const outputLanguage = params.outputLanguage ?? "english";
  const promptMode = detectPromptMode(latestTranscript, params.eventMemory);
  const formattedProfile = buildCompactXiangProfile(promptMode);
  const formattedEventMemory = formatCompactEventMemory(params.eventMemory);
  const formattedPrenoteContext = params.activePrenoteContext?.trim() || "No active prenote.";
  const formattedSceneProfile = params.activeSceneProfilePrompt?.trim() || "No active scene profile.";
  const formattedPersonalMemory = params.relevantPersonalMemoryContext?.trim() || "No relevant personal memory.";
  const recentTranscriptText = params.conversation
    .filter((item) => item.type === "transcript")
    .slice(-5)
    .map((item) => `Transcript: "${item.text}"`)
    .join("\n");

  const targetWords = params.targetMode === "long" ? "150-230" : "90-150";
  const prompt = `Task:
Write the continuation script Xiang can read after this opening line:
"${params.openingLine}"

Target length: ${targetWords} words.
Output language: ${outputLanguage === "chinese" ? "Chinese" : "English"}.

Rules:
- Do not repeat the opening line. Start directly with the next sentence after it.
- Write natural spoken text Xiang can read out loud.
- Use short paragraphs and clear sentence breaks.
- For long target length, use 2-3 short spoken paragraphs. Do not stop after only a short memory quote.
- Prefer relevant personal memory when it directly matches the question.
- If this is IELTS/daily speaking, add ordinary plausible details if useful, but do not invent specific room, house, family, job, school, health, or immigration facts.
- For room/home answers, do not invent visual details like windows, views, posters, chairs, wall colors, floors, decorations, tidy/organized habits, or exact furniture unless they appear in memory.
- If this is interview, project, school, technical, family, health, immigration, or work history, use only supported facts from the context below.
- If exact facts are missing, stay general instead of inventing.
- For classroom/technical questions, do not connect the answer to Xiang's project unless the question explicitly asks about his project or experience.
- For behavioral interviews, match the requested story type exactly:
  conflict = disagreement, scope, deadline, trade-off, or coordination;
  feedback = feedback received and what changed;
  hard bug = debugging process and fix.
- For meeting blockers, say the blocker, a temporary workaround such as mock/schema/contract if relevant, and the next concrete step.
- For demo/progress updates, use the active project/context below. If no exact feature or project is named, default to SayNext current work: teleprompt controls/testing, memory retrieval, scene profiles, local/travel mode, or response quality. Do not invent random features, stacks, teammates, users, load balancing, serverless architecture, or production-scale claims.
- Avoid polished wrap-up phrases like "overall", "in conclusion", "this journey", or exaggerated resume language. Do not mention those phrases as examples either.
- No bullet points, no labels, no Markdown heading, no JSON.

Latest request:
"${latestTranscript}"

Recent conversation:
${recentTranscriptText || "No recent conversation."}

Active scene profile:
${formattedSceneProfile}

Xiang profile:
${formattedProfile}

Active event memory:
${formattedEventMemory}

Relevant personal memory:
${formattedPersonalMemory}

Active prenote memory:
${formattedPrenoteContext}`;

  const responseText = LLM_PROVIDER === "ollama"
    ? await generateLongWithOllama(prompt)
    : (await withModelTimeout(
      telepromptAgent.generate(prompt),
      Math.max(OPENAI_TIMEOUT_MS, 60000),
      "OpenAI teleprompt request",
    )).text;

  let script = stripUnsupportedRoomVisualDetails(
    sanitizeTelepromptScript(responseText, params.openingLine),
    latestTranscript,
  );

  const minTargetWords = params.targetMode === "long" ? 110 : 55;
  if (countTelepromptWords(script) < minTargetWords) {
    const expandPrompt = `${prompt}

The previous draft was too short for this teleprompt.
Expand it to the requested target length using the same supported facts.
Write at least ${params.targetMode === "long" ? 130 : 70} words.
Do not add unsupported specific details.
Do not repeat the opening line.
Return only the final expanded script.

Previous draft:
${script}`;

    const expandedText = LLM_PROVIDER === "ollama"
      ? await generateLongWithOllama(expandPrompt)
      : (await withModelTimeout(
        telepromptAgent.generate(expandPrompt),
        Math.max(OPENAI_TIMEOUT_MS, 60000),
        "OpenAI teleprompt expand request",
      )).text;
    const expanded = stripUnsupportedRoomVisualDetails(
      sanitizeTelepromptScript(expandedText, params.openingLine),
      latestTranscript,
    );
    if (countTelepromptWords(expanded) > countTelepromptWords(script)) {
      script = expanded;
    }
  }

  return script;
}

export async function processConversation(
  conversation: Conversation,
  frequency: 'low' | 'medium' | 'high' = 'high',
  eventMemory?: EventMemorySnapshot,
  outputLanguage: OutputLanguage = "english",
  activePrenoteContext = "",
  activeSceneProfilePrompt = "",
  relevantPersonalMemoryContext = "",
): Promise<AgentResponse> {
  const currentTimestamp = Date.now();
  const currentDate = new Date(currentTimestamp).toISOString();
  const latestTranscript = getLatestTranscript(conversation);

  const immediateResponse = getImmediateResponse(latestTranscript, currentTimestamp, outputLanguage);
  if (immediateResponse) {
    return immediateResponse;
  }

  const promptMode = detectPromptMode(latestTranscript, eventMemory);
  const latestLooksLikeQuestion = looksLikeQuestion(latestTranscript);
  const compactConversation = conversation.slice(-4);
  const formattedHistoryLines: string[] = [];
  for (const item of compactConversation) {
    switch (item.type) {
      case 'transcript':
        formattedHistoryLines.push(`Transcript: "${item.text}"`);
        break;
      case 'insight':
        // Previous suggestions are model outputs, not conversation audio.
        // Keeping them out of the prompt prevents the model from replying to itself.
        break;
      case 'silent':
        formattedHistoryLines.push(`Previous non-response: "${item.reasoning}"`);
        break;
      case 'route':
        formattedHistoryLines.push(`Previous route decision: "${item.reasoning}"`);
        break;
    }
  }

  const formattedHistory = `--- RECENT CONVERSATION ---\n${formattedHistoryLines.join('\n')}\n--- END CONVERSATION ---`;
  const retrievedSamples: { id: string }[] = [];
  const formattedProfile = buildCompactXiangProfile(promptMode);
  const formattedEventMemory = formatCompactEventMemory(eventMemory);
  const formattedPrenoteContext = activePrenoteContext.trim() || "No active prenote.";
  const formattedSceneProfile = activeSceneProfilePrompt.trim() || "No active scene profile.";
  const formattedPersonalMemory = relevantPersonalMemoryContext.trim() || "No relevant personal memory.";

  console.log("\n--- SayNext Agent Context ---\n", formattedHistory, "\n-----------------------------\n");
  const stablePromptPrefix = `Task:
- Use the latest transcript as the trigger.
- Follow the active scene profile first. It is Xiang's manual instruction for how to behave in this situation.
- If it is a direct question, answer it directly.
- If it is professional, technical, or academic, give a rigorous concept answer first. Be specific about mechanism, trade-off, assumption, tool, or example.
- For DynamoDB/database slow-query questions, name the access pattern and index/GSI fit before talking about capacity or hot partitions.
- If it is lecture/explanation and not a direct question, give a professional knowledge supplement or useful question, not a conversational reply.
- In classroom lecture mode, use student-like explanation patterns: key difference, quick example, limitation, or a short clarifying question. Do not mimic the professor's long lecture style.
- If it is casual, keep it natural and grounded.
- If the transcript asks Xiang's name, identity, or name pronunciation, answer with Xiang Li / Xiang. Never identify Xiang as another name from the transcript, and do not repeat the wrong name.
- If someone suggests adding a new feature before fixing a known bug/blocker, push back gently and prioritize the core bug first.
- Use active prenote memory as prepared context when relevant. It is stronger than generic knowledge, but do not force it if unrelated.
- Use relevant personal memory only when it directly helps answer the latest transcript. Do not volunteer sensitive details.
- For low-stakes IELTS/daily personal questions, you may create small plausible details if they sound natural and fit Xiang. Do this to avoid robotic generic answers.
- For important factual claims, use only profile, relevant memory, prenote, or recent transcript. Do not create fake school names, course names, family events, health details, immigration details, company/work experience, project details, exact dates, awards, or named people.
- Do not use the personal sample library.
- The requested Output language below is mandatory.
- For short fragments, do not create a new topic. Keep it minimal.
- For unclear short questions, ask a natural clarification like "What do you mean exactly?" Avoid meta wording such as "give me more context" or "what are you referring to".
- If the audio sounds like other people talking to each other, do not role-play as one of them unless Xiang is clearly being addressed.
- If active event memory says the source is public/open transcript, or its summary contains source=open_* or source=short_form, do not use Xiang's hobbies, projects, school, career, family, childhood, or personal profile. Do not say "my sister", "my family", "when I was a child", or similar personal claims. Reply neutrally to the transcript only.
- If the latest transcript asks how to answer, output the answer itself, not strategy advice.

--- ACTIVE SCENE PROFILE ---
${formattedSceneProfile}
--- END ACTIVE SCENE PROFILE ---

--- XIANG PROFILE ---
Prompt mode: ${promptMode}
${formattedProfile}
--- END XIANG PROFILE ---

--- ACTIVE PRENOTE MEMORY ---
${formattedPrenoteContext}
--- END ACTIVE PRENOTE MEMORY ---`;

  const dynamicPromptSuffix = `Time: ${currentDate}
Output language: ${outputLanguage === "chinese" ? "Chinese" : "English"}
Latest transcript looks like a direct question: ${latestLooksLikeQuestion ? "yes" : "no"}

--- LATEST TRANSCRIPT ---
Transcript: "${latestTranscript}"
--- END LATEST TRANSCRIPT ---

--- ACTIVE EVENT MEMORY ---
${formattedEventMemory}
--- END ACTIVE EVENT MEMORY ---

--- RELEVANT PERSONAL MEMORY ---
${formattedPersonalMemory}
--- END RELEVANT PERSONAL MEMORY ---

${formattedHistory}`;

  // Keep repeated content before volatile transcript/event context so OpenAI prompt caching can reuse the prefix.
  const prompt = `${stablePromptPrefix}\n\n${dynamicPromptSuffix}`;
  const cacheablePrefix = `${sayNextInstructions}\n\n${stablePromptPrefix}`;

  console.log(
    `[SayNext] Input approx tokens: system=${estimateTokens(sayNextInstructions)} prompt=${estimateTokens(prompt)} cacheablePrefix=${estimateTokens(cacheablePrefix)} dynamic=${estimateTokens(dynamicPromptSuffix)} total=${estimateTokens(`${sayNextInstructions}\n\n${prompt}`)} mode=${promptMode}`,
  );

  try {
    let agent: Agent<any, any>;
    switch (frequency) {
      case 'low':
        agent = initialAgentLow;
        break;
      case 'medium':
        agent = initialAgentMedium;
        break;
      case 'high':
      default:
        agent = initialAgentHigh;
        break;
    }

    console.log(`>> Using agent brain: ${LLM_PROVIDER === "ollama" ? `Ollama:${OLLAMA_MODEL}` : agent.name}`);

    const responseText = LLM_PROVIDER === "ollama"
      ? await generateWithOllama(prompt)
      : (await withModelTimeout(agent.generate(prompt), OPENAI_TIMEOUT_MS, "OpenAI SayNext request")).text;

    if (responseText) {
      if (LLM_PROVIDER === "ollama") {
        const extractedOutput = extractOutputField(responseText);
        const looksLikeJson = /^\s*\{/.test(responseText);

        if (looksLikeJson && !extractedOutput) {
          const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
          if (fallback.type === Action.INSIGHT) {
            fallback.reasoning = "Fallback after Ollama returned malformed JSON without an output field";
            fallback.metadata.agentInput = {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            };
          }
          return fallback;
        }

        return {
          type: Action.INSIGHT,
          reasoning: extractedOutput
            ? "Ollama returned partial JSON; extracted output field"
            : "Generated SayNext reply with Ollama",
          timestamp: currentTimestamp,
          output: finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory),
          confidence: extractedOutput ? 0.5 : 0.7,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            }
          }
        };
      }

      try {
        const jsonText = extractJsonObject(responseText) ?? responseText.trim();
        const parsed = JSON.parse(jsonText);
        const output = finalizeSayNextOutput(parsed.output ?? responseText, latestTranscript, outputLanguage, eventMemory);

        return {
          type: Action.INSIGHT,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "Generated SayNext reply",
          timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : currentTimestamp,
          output,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            }
          }
        };
      } catch (parseError) {
        console.error("Failed to parse JSON from text:", parseError);
        const extractedOutput = extractOutputField(responseText);
        if (extractedOutput) {
          return {
            type: Action.INSIGHT,
            reasoning: "Model returned partial JSON; extracted output field",
            timestamp: currentTimestamp,
            output: finalizeSayNextOutput(extractedOutput, latestTranscript, outputLanguage, eventMemory),
            confidence: 0.5,
            metadata: {
              agentType: AgentType.Initial,
              agentInput: {
                model: ACTIVE_MODEL_NAME,
                profileVersion: PROFILE_VERSION,
                retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
              }
            }
          };
        }

        if (LLM_PROVIDER === "ollama") {
          const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
          if (fallback.type === Action.INSIGHT) {
            fallback.reasoning = "Fallback after Ollama returned malformed JSON";
            fallback.metadata.agentInput = {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            };
          }
          return fallback;
        }

        return {
          type: Action.INSIGHT,
          reasoning: "Model returned plain text; sanitized direct reply",
          timestamp: currentTimestamp,
          output: finalizeSayNextOutput(responseText, latestTranscript, outputLanguage, eventMemory),
          confidence: 0.6,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            }
          }
        };
      }
    }

    return {
      type: Action.INSIGHT,
      reasoning: "No model text returned",
      timestamp: currentTimestamp,
      output: "Sorry, could you say that again?",
      confidence: 0.3,
      metadata: {
        agentType: AgentType.Initial,
        agentInput: {
          model: ACTIVE_MODEL_NAME,
          profileVersion: PROFILE_VERSION,
          retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
        }
      }
    };
  } catch (error) {
    console.error("Error in processConversation:", error);
    const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
    if (fallback.type === Action.INSIGHT) {
      fallback.reasoning = `Fallback after model error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      fallback.metadata.agentInput = {
        model: ACTIVE_MODEL_NAME,
        profileVersion: PROFILE_VERSION,
        retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
      };
    }
    return fallback;
  }
}
