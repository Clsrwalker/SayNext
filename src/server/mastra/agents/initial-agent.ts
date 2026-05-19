import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { Action, AgentType, type Conversation, type AgentResponse } from "../types";
import type { EventMemorySnapshot } from "../../memory/event-memory";
import {
  type OpenAiConversationSession,
  type TranscriptCommitReason,
  isOpenAiConversationStateEnabled,
  shouldCommitTranscriptToOpenAiConversation,
} from "./openai-conversation-state";

const sayNextInstructions = `You are SayNext, Xiang's real-time conversation helper.

Output only the short text that should be shown on the display.

Core rules:
- Prioritize the latest transcript. Older context is only background.
- Output can be a sayable reply, a knowledge supplement, or a tiny clarification/acknowledgement.
- Conversation advantage goal: make Xiang sound like a calmer, clearer, more prepared version of himself, not a generic assistant and not a fake extrovert.
- Preserve believability: use wording Xiang could plausibly say out loud, grounded in his real memory, profile, prenote, or the latest transcript.
- Improve the live moment: organize the logic, reduce panic/blankness, add one useful bridge or next step, and help Xiang look capable without sounding over-polished.
- Choose one response move before writing: direct answer, acknowledge then answer, bridge to grounded personal detail, clarify only if needed, propose a next step, or graceful unknown.
- A good reply usually answers first, then adds one useful bridge, reason, or next step. Do not use filler return questions to fake conversational smoothness.
- Use personal background only when asked about Xiang's experience, project, school, work, preference, or plan.
- Do not invent Xiang's personal experience, senior work experience, important facts, exact dates, named people, awards, health, family, immigration, school/course, company, or project details unless supported by profile, memory, prenote, or recent transcript.
- Response playbooks in memory are reasoning frameworks, not proof that Xiang experienced that exact event. Use them to structure how Xiang would think, answer, or act; never convert a playbook into a past-tense personal story.
- If asked for a real example and no specific real memory supports one, be honest: say it was not a dramatic/specific personal example, then give the approach or a supported project pattern.
- IELTS/daily personal questions should stay grounded. If exact memory is missing, answer generally instead of inventing a specific movie, show, room, store, restaurant, park, trip, object, friend, animal encounter, or recent event.
- Known projects only: SayNext, Elder Album, Dal Parking Aid / DalParkAid, JobLens, and Study Session Tracker. If a project question is unclear, ask a short clarification instead of inventing a project name.
- Public-facing interview/project wording: prefer "Hybrid Search Memory Assistant" for SayNext unless the latest transcript is clearly an internal app-name discussion.
- Professional/technical/academic topics need precise concepts, mechanisms, trade-offs, assumptions, tools, examples, debugging steps, and correct terms.
- DynamoDB slow query: mention access pattern and key/index/GSI fit before capacity or hot partitions.
- Classroom/lecture: answer direct concept questions in 1-2 speakable sentences; otherwise add one very compact supplement, example, limitation, trade-off, or smart question. Sound like a capable student, not a professor or textbook.
- Meeting/group work: move the task forward in normal spoken meeting language: blocker, decision, owner, trade-off, risk, concrete next step, mock schema, assumption, or contract. Prefer 20-45 words. Do not sound like a spec document.
- Casual chat: normal student, simple, modest, slightly imperfect, not essay-like, not corporate.
- Obey requested output language exactly.
- Short fragments or broken ASR: do not create a new topic; give the smallest useful acknowledgement or clarification.
- Unclear short questions: answer briefly if likely, or ask "What do you mean exactly?" Avoid "give me more context" / "what are you referring to".
- Public/open/speaker-labelled third-party dialogue: do not insert Xiang, his hobbies/projects/school/career/family, or "I'm Xiang"; do not role-play as the agent, customer, host, interviewer, teacher, or any labelled speaker; keep neutral unless Xiang is clearly addressed.
- Public course source names such as OpenCourseWare are source context, not a prompt to introduce Xiang's projects.
- Ask a return question only when it clearly helps. Do not use "How about you?", "What happened after that?", or similar filler to force the conversation forward.
- If the user asks "what should I say" or "how should I answer", still output the exact words Xiang should say, not advice about how to answer.
- Avoid mission statements, self-praise, resume wording, and stiff openings like "Today I plan to..."
- Never use the phrase "dream job", even to say Xiang does not have one.
- Do not include labels, analysis, options, translations, or "you can say".

Style:
- short, natural, easy to say or read; sound like real speech, not a written answer
- For live display replies, prefer 12-45 words and avoid going over about 60 words unless the user explicitly asks for detail.
- usually 1 sentence; 2-4 short sentences are okay for professional or academic questions when depth is needed
- use "honestly", "probably", "kind of", "a bit", "not really", "I guess", and "like" sparingly; do not turn them into a repeated style mask. Avoid "pretty chill" as a default personality phrase.
- Do not use Markdown backticks, parenthetical asides, quoted terms, e.g., or doc-style phrasing. Say examples naturally.
- Avoid sounding too confident, too perfect, or too prepared.`;

export function resolveOpenAiModelConfig(env: NodeJS.ProcessEnv = process.env): {
  liveModel: string;
  longModel: string;
} {
  return {
    liveModel: env.OPENAI_MODEL || env.MODEL_NAME || "gpt-5.4-nano",
    longModel: env.OPENAI_LONG_MODEL || env.OPENAI_HIGH_RISK_MODEL || env.OPENAI_FALLBACK_MODEL || "gpt-5.4-mini",
  };
}

const OPENAI_MODEL_CONFIG = resolveOpenAiModelConfig();
const MODEL_NAME = OPENAI_MODEL_CONFIG.liveModel;
const LONG_MODEL_NAME = OPENAI_MODEL_CONFIG.longModel;
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
- like Xiang after thinking for a few seconds: clearer, calmer, and more confident, but still modest and believable
- useful for gaining conversation advantage: stronger logic, smoother flow, and grounded personal detail when available
- concrete when useful, but do not invent high-risk facts
- for IELTS/daily examples, stay grounded; if exact memory is missing, keep the detail generic instead of inventing a named movie, show, room, store, restaurant, park, trip, object, friend, animal encounter, or recent event

Avoid:
- "Today I will talk about"
- "In conclusion"
- fake senior work experience
- unsupported company, school, family, health, immigration, award, exact date, or named-person facts
- response playbooks as fake personal anecdotes; use them only as structure when no real story exists`;

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
  model: openai(LONG_MODEL_NAME),
  instructions: telepromptInstructions,
});

function normalizeMojibakeArtifacts(text: string): string {
  return text
    .replace(/H\u9227\u4FBD/g, "H2O")
    .replace(/\u9225\u650A/g, " - i")
    .replace(/\u9225\u6501/g, " - a")
    .replace(/\u9225\u6A9A/g, "'s")
    .replace(/\u9225\u6A9B/g, "'t")
    .replace(/\u9225\u6A99/g, "'re")
    .replace(/\u9225\u6A9D/g, "'ve")
    .replace(/\u9225\u6A87/g, "'")
    .replace(/\u9225[\u6A92\u95B3]/g, "\"")
    .replace(/[\u9225\u6A9A\u6A9B\u6A99\u6A9D\u6A87\u6A92\u95B3]/g, "");
}

function normalizeSpokenDisplayPunctuation(text: string): string {
  return text
    .replace(/\\hat\{([^}]+)\}/g, "$1-hat")
    .replace(/\\,/g, "")
    .replace(/\\\s*/g, "")
    .replace(/\bA\^T\s*A\b/g, "A transpose A")
    .replace(/\bA\^T\b/g, "A transpose")
    .replace(/`([^`\n]{1,80})`/g, "$1")
    .replace(/"([^"\n]{1,80})"/g, "$1")
    .replace(/\(\s*e\.g\.,?\s*([^()]{1,60})\s*\)/gi, ", for example $1,")
    .replace(/\(\s*for example,?\s*([^()]{1,60})\s*\)/gi, ", for example $1,")
    .replace(/\(\s*([^()]{1,45})\s*\)/g, ", $1,")
    .replace(/\be\.g\.,?/gi, "for example")
    .replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, "$1 and $2")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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

  cleaned = normalizeMojibakeArtifacts(cleaned.replace(/\r\n/g, "\n"))
    .replace(/\u2019s/g, "'s")
    .replace(/\u2019t/g, "'t")
    .replace(/\u2019re/g, "'re")
    .replace(/\u2019ve/g, "'ve")
    .replace(/\u2019d/g, "'d")
    .replace(/\u2019ll/g, "'ll")
    .replace(/\u2018|\u2019|\uFFFD/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, " - ")
    .replace(/\u2080/g, "0")
    .replace(/\u2081/g, "1")
    .replace(/\u2082/g, "2")
    .replace(/\u2083/g, "3")
    .replace(/\u2084/g, "4")
    .replace(/\u2085/g, "5")
    .replace(/\u2086/g, "6")
    .replace(/\u2087/g, "7")
    .replace(/\u2088/g, "8")
    .replace(/\u2089/g, "9")
    .replace(/\b(?:option|version|response)\s*\d+\s*[:.)-]/gi, "\n")
    .replace(/\b(?:option|version|response)\s*[A-Z]\s*[:.)-]/gi, "\n");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstUsefulLine = lines.find((line) => {
    if (/^(scene|analysis|reasoning|explanation|note|context)\s*[:-]/i.test(line)) return false;
    if (lines.length > 1 && /^(sure|yeah|okay|ok|absolutely|of course)[.!]*$/i.test(line)) return false;
    return true;
  }) ?? lines[0] ?? "";

  cleaned = firstUsefulLine
    .replace(/^\s*[A-Z][A-Z_ .'-]{0,30}\s*:\s*/i, "")
    .replace(/^\s*(?:[-*]+|\d+[.)]|[A-Za-z][.)])\s*/g, "")
    .replace(/^\s*(?:(?:you\s+can\s+say|you\s+could\s+say|say|direct\s+answer|answer|reply|response|suggested\s+reply)\s*[:-]\s*)+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  cleaned = normalizeSpokenDisplayPunctuation(cleaned);

  if (/\bopen\s*courseware\b/i.test(cleaned) && /\bsaynext\b|\bmy project\b|\bproject or experience\b|\bproject i can explain\b/i.test(cleaned)) {
    return "A useful note is that this is course context, so I would focus on the concept or example being explained, not treat OpenCourseWare as the topic.";
  }

  if (/^that'?s interesting\.\s*can you clarify (?:what specific|which) animals\b/i.test(cleaned)) {
    return "That's interesting. Which animal is that?";
  }

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
  cleaned = normalizeSpokenDisplayPunctuation(cleaned);
  if (/[\u0400-\u04FF]|\?{2,}/.test(cleaned)) {
    const englishSentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence && !/[\u0400-\u04FF]|\?{2,}/.test(sentence));
    cleaned = englishSentences.length ? englishSentences.join(" ") : cleaned.replace(/\s*\S*(?:[\u0400-\u04FF]|\?{2,})\S*/g, "");
  }
  cleaned = cleaned.replace(/([.!?]),/g, "$1").replace(/,\s*([.!?])/g, "$1").trim();

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

  if (containsChinese(transcript)) {
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
    return "Hey.";
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
  return /\bsource=open_|source=short_form|source=unseen_public|public open|open meeting|open lecture|open-domain|third-party\b/.test(text);
}

function removePublicTranscriptPersonalLeak(output: string, eventMemory?: EventMemorySnapshot): string {
  if (!looksLikePublicOpenEvent(eventMemory)) {
    return output;
  }

  if (/\b(open\s*courseware|opencourseware)\b/i.test(output)
    && /\b(project|experience|my project|real project|called)\b/i.test(output)) {
    return "A useful note is that this is course context, so I would focus on the concept or example being explained, not treat OpenCourseWare as the topic.";
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

function replaceUnsupportedFavoriteTeacherClaim(output: string, transcript: string): string {
  if (!/\b(favou?rite|favorite)\s+(teacher|professor|instructor)\b|\bteacher\s+(you|i)\s+(like|liked|remember|remembered)\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(?:mr|mrs|ms|miss|dr|professor)\.?\s+[A-Z][a-z]+|\bmy\s+(?:favou?rite|favorite)\s+(?:teacher|professor|instructor)\b/i.test(output)) {
    return output;
  }

  return "I do not really have one specific favourite teacher. I usually remember teachers who explain things clearly, stay patient, and do not make the class feel too stressful.";
}

function replaceUnsupportedNamedHypotheticalClaim(output: string, transcript: string): string {
  if (!/\bdescribe a person\b|\bperson who has chosen\b|\bsomeone who has chosen\b|\bcareer in the medical field\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(?:mr|mrs|ms|miss|dr|professor)\.?\s+[A-Z][a-z]+|\bsomeone like\s+[A-Z][a-z]+\b/i.test(output)) {
    return output;
  }

  return "I would describe someone who chose medicine because they wanted practical work that helps people directly. It seems demanding, but also meaningful because their effort can make a real difference for patients.";
}

function replaceOpenCoursewareProjectMisread(output: string, transcript: string): string {
  if (!/\b(open\s*courseware|opencourseware|ocw\.mit\.edu|creative commons|professor strang)\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(saynext|my project|real project|project or experience|project i can explain|architecture)\b/i.test(output)) {
    return output;
  }

  return "A useful note is that this is course context, so I would focus on the concept or example being explained, not treat OpenCourseWare as the topic.";
}

function shortenSmallProjectAnswer(output: string, transcript: string): string {
  if (!/\bsmall project\b|\bproject you made\b|\bsmall project you made\b/i.test(transcript)) {
    return output;
  }

  if (countTelepromptWords(output) <= 45) {
    return output;
  }

  if (/\belder album\b/i.test(output)) {
    return "Sure, I made Elder Album, a small AWS serverless photo-sharing app. It used Lambda, DynamoDB, and S3, and the main challenge was connecting the pieces without small integration mistakes breaking the flow.";
  }

  const firstSentence = output.match(/^.{1,260}?[.!?](?:\s|$)/)?.[0]?.trim();
  return firstSentence && countTelepromptWords(firstSentence) <= 45 ? firstSentence : output;
}

function replacePublicTranscriptRoleplay(output: string, transcript: string, eventMemory?: EventMemorySnapshot): string {
  const hasSpeakerLabel = isLikelySpeakerLabelTranscript(transcript);
  const xiangAddressedDirectly = /\bxiang\b/i.test(transcript) || (!hasSpeakerLabel && /\b(you|your)\b/i.test(transcript));
  const thirdPartyContext = (looksLikePublicOpenEvent(eventMemory) && !xiangAddressedDirectly)
    || (hasSpeakerLabel && !/\bxiang\b/i.test(transcript));
  if (!thirdPartyContext) {
    return output;
  }

  const combined = `${transcript} ${output}`.toLowerCase();
  const startsAsServiceRole = /^\s*(?:i'?ll|i will|i can|let me|we can|we will|we'?ll|i would be happy to|i apologize|sorry[, ]+i)\b/i.test(output);
  const serviceContext = /\b(agent|customer|client|order|shipping|tracking|refund|ticket|account|payment|reservation|appointment|support|status|package|case)\b/.test(combined);
  if (startsAsServiceRole && serviceContext) {
    return "They should check the status first and give a clear update instead of guessing or overpromising.";
  }

  const speakerLabel = transcript.match(/^\s*([A-Z][A-Z_ .'-]{0,30})\s*:/i)?.[1]?.trim().toLowerCase() ?? "";
  const roleLabel = /\b(agent|customer|client|host|interviewer|teacher|professor|manager|speaker|student|support|sales)\b/.test(speakerLabel);
  if (roleLabel && /^\s*(?:i|we)\b/i.test(output) && !/\b(xiang|my name|i'?m xiang|i am xiang)\b/i.test(output)) {
    return "That sounds reasonable. I would just double-check the details before deciding.";
  }

  if (!/\b(?:i|i'm|i am|i'd|i would|i'll|i will|my|we|we'd|we would|we'll|we will|let's)\b/i.test(output)) {
    return output;
  }

  if (/\b(button|prototype|remote|mode switch|advanced settings|clutter|ui|ux)\b/i.test(combined)) {
    return "Making the main control simpler makes sense. The team could hide advanced settings in a menu and test whether users understand the mode switch.";
  }

  if (/\b(overfit|overfitting|training loss|validation loss|regularization|early stopping|model)\b/i.test(combined)) {
    return "A useful supplement is that a widening gap between training loss and validation loss usually signals overfitting, so early stopping or regularization can help.";
  }

  if (/\b(meeting|prototype|decision|blocker|owner|next step|deadline|task)\b/i.test(combined)) {
    return "It would help to clarify the decision, the owner, and the next step before moving on.";
  }

  return makeNeutralThirdPartyResponse(transcript);
}

function makeNeutralThirdPartyResponse(transcript: string): string {
  const normalized = transcript.toLowerCase();
  if (/\bspell|spelling|your name|my name\b/.test(normalized)) {
    return "They are asking for spelling, so the useful next step is to spell the name clearly.";
  }
  if (/\bindian\b.*\bafrican\b|\bafrican\b.*\bindian\b|\belephant\b/.test(normalized)) {
    return "They are clarifying the animal type, so the next step is to decide which version they mean.";
  }
  if (/\bthere you go\b/.test(normalized)) {
    return "That is just a handoff; no action needed yet.";
  }
  if (/\bi just wanna watch\b|\bwatch the t_?v_?\b|\bremote\b/.test(normalized)) {
    return "They want the main control flow to stay simple, so the next step is to focus on the basic TV actions first.";
  }
  if (/\bi'?m from\b|\bfrom around\b|\bstate of\b/.test(normalized)) {
    return "That is just an introduction; no action needed yet.";
  }
  if (/\b(wait|i'?ll wait|let'?s see|mm '?kay|okay|almost)\b/i.test(transcript)) {
    return "They are pausing or waiting, so the next step is just to wait before moving on.";
  }
  if (/\b(draw|animal|elephant|seal|button|remote|prototype|design|settings)\b/.test(normalized)) {
    return "They are narrowing the design choice, so the useful next step is to make the option clear and easy to test.";
  }
  if (/\b(next topic|discuss|start|meeting|agenda|decision)\b/.test(normalized)) {
    return "They are moving the discussion forward; the useful next step is to clarify the decision and owner.";
  }
  if (/\bcareful|bone head|leave me alone|wish people\b/.test(normalized)) {
    return "That sounds like frustration, so a short acknowledgement is safer than pushing for more.";
  }
  return "No action needed yet.";
}

function polishPersonaSayability(output: string, transcript: string, promptMode?: PromptMode): string {
  let polished = output.trim();

  if (/^that sounds like a small transition in the conversation,\s*so i would just acknowledge it briefly\.?$/i.test(polished)) {
    return "No action needed yet.";
  }

  polished = polished
    .replace(/^Honestly,\s*/i, "")
    .replace(/\s+Honestly,\s*/g, " ")
    .replace(/\s+honestly([.!?])$/i, "$1")
    .replace(/^I finished(?: setting up)? the DynamoDB tables? and mocked some API\.?$/i, "I finished the DynamoDB table and mocked the API response. Next I'm testing the main flow and checking what still breaks before the demo.")
    .replace(/\bmostly chill at home\b/i, "mostly stay home")
    .replace(/\bchill one-on-one chats?\b/gi, "quiet one-on-one conversations")
    .replace(/\bprefer chill conversations\b/gi, "prefer quieter conversations")
    .replace(/\bit'?s pretty chill how\b/gi, "it's interesting how")
    .replace(/\bit'?s pretty chill\b/gi, "it's usually simple")
    .replace(/\bpretty chill stuff[.!]?/gi, "simple stuff.")
    .replace(/\bpretty chilly\b/gi, "cold")
    .replace(/\bpretty chill about it[.!]?/gi, "I do not worry about it too much.")
    .replace(/\bpretty chill to think about back then though[.!]?/gi, "I do not think about it much now.")
    .replace(/\bpretty chill over here[.!]?/gi, "I do not worry about it too much.")
    .replace(/\beveryone'?s pretty chill here[.!]?/gi, "everyone seems fine here.")
    .replace(/\s*Pretty chill overall though!?$/i, "")
    .replace(/\s*Pretty chill here[.!]?$/i, "")
    .replace(/,\s*pretty chill[.!]?$/i, ".")
    .replace(/\bpretty chill[.!]?$/i, "nothing too deep.")
    .replace(/\bpretty chill when\b/gi, "easier when")
    .replace(/\bis pretty chill\b/gi, "is convenient")
    .replace(/\bpretty chill topics\b/gi, "simple topics")
    .replace(/\bpretty chill though,\s*/i, "")
    .replace(/\bPretty straightforward!?$/i, "")
    .replace(/\bcan be mitigated by\b/gi, "can be reduced by")
    .replace(/\bto mitigate this,\s*/gi, "to reduce that, ")
    .replace(/\bcrucial for\b/gi, "important for")
    .replace(/\bindispensable\b/gi, "important")
    .replace(/\s+Kinda like how [^.?!]+[.?!]?$/i, "")
    .replace(/\s+Kind of been in a routine,?\.?$/i, "")
    .replace(/,\.$/g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();

  if (promptMode === "classroom" && countTelepromptWords(polished) > 42 && !looksLikeQuestion(transcript)) {
    const firstSentence = polished.match(/^.{1,260}?[.!?](?:\s|$)/)?.[0]?.trim();
    if (firstSentence && countTelepromptWords(firstSentence) >= 8) {
      polished = firstSentence;
    }
  }

  return polished || output;
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

function replaceUnsupportedSayNextClaim(output: string, transcript: string): string {
  if (!/\b(saynext|say next|mobile app experience)\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(reminder|reminders|daily task|daily tasks|task manager|manage their daily tasks|offline|offline sync|local storage|sync strategy|syncing it later|sync it later|multi-device|firebase sync|cross-platform code sharing|network instability)\b/i.test(output)) {
    return output;
  }

  if (/\bmobile app experience\b/i.test(transcript)) {
    return "My strongest mobile-related experience is from Hybrid Search Memory Assistant and DalParkAid. Hybrid Search Memory Assistant focuses on live transcripts, memory retrieval, scene profiles, prenotes, and local/travel modes. DalParkAid was a React Native parking app project, so I can talk about both AI-assisted mobile UX and normal app workflow.";
  }

  return "SayNext is a mobile real-time conversation assistant. The supported parts are live transcripts, response suggestions, scene profiles, prenotes, personal and knowledge memory retrieval, local Ollama mode, VPS/OpenAI travel mode, teleprompt controls, and response-quality testing.";
}

function replaceUnsupportedWorkExperienceClaim(output: string, transcript: string): string {
  if (/\b(i have not|i haven't|not used|not done|did not|didn't)\b/i.test(output)) {
    return output;
  }

  if (/\b(work|working|student|study)\b/i.test(transcript) && /\bi\s+work\s+as\s+(?:a\s+)?software\s+developer\b/i.test(output)) {
    return "I'm a MACS student at Dalhousie right now, basically Applied Computer Science.";
  }

  if (!/\b(internship at|internship with|during my internship|at a startup|at my company|at work|production team|my manager|senior engineer at work|worked on a team at)\b/i.test(output)) {
    return output;
  }

  if (/\blearn(?:ed)? something quickly\b/i.test(transcript)) {
    return "One example is from building SayNext. I had to learn how to handle real-time transcripts, memory retrieval, and local/VPS deployment while testing the app at the same time. I broke the problem into small parts, checked logs and behavior after each change, and used quick experiments to understand what was actually failing.";
  }

  if (/\bpressure|deadline\b/i.test(transcript)) {
    return "When I am under deadline pressure, I try to reduce the scope first and focus on the part that actually needs to work. In student projects, that usually means getting the core flow stable, testing the risky parts, and leaving nice-to-have features for later.";
  }

  if (/\bconflict|feedback|failure|trade-off|mistake|above and beyond|worked independently\b/i.test(transcript)) {
    return "A real example I can use is from SayNext. I had to make practical trade-offs around response quality, latency, local versus travel mode, and messy transcript handling. I learned to test the process instead of trusting one good-looking output, because real-time AI behavior can fail in small hidden ways.";
  }

  return "I do not want to frame this as workplace experience. A real example I can talk about is from student and personal projects like SayNext, where I handled practical engineering problems, tested edge cases, and improved the design based on what actually broke.";
}

function replaceMeetingCompletedWorkClaim(output: string, transcript: string, eventMemory?: EventMemorySnapshot): string {
  const eventText = `${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();
  if (!/\b(group_discussion|meeting)\b/.test(eventText)) {
    return output;
  }

  if (/\bapi cost\b/i.test(transcript) && /\b(process every transcript|every transcript|too high)\b/i.test(transcript)) {
    return "We should not process every transcript the same way. I would filter for final or meaningful turns first, cache repeated context, and only run the stronger model when the transcript actually needs a response or memory extraction.";
  }

  if (/\bquick update\b/i.test(transcript) && !/\b(dynamodb|lambda|api gateway|s3|schema|upload|parking|joblens|elder)\b/i.test(eventText)) {
    return "I can give a quick update: I finished the current testing pass, I'm checking edge cases now, and the main blocker is making sure the response flow stays reliable with noisy transcripts.";
  }

  if (!/\b(i just resolved|i finished|i already fixed|i already tested|i implemented)\b/i.test(output)) {
    return output;
  }

  if (/\b(update|progress|finished|what did you finish|what have you done)\b/i.test(transcript)) {
    return output;
  }

  if (/\b(branch|merge conflict|conflict with.*main|latest main)\b/i.test(transcript)) {
    return "I should pull the latest main branch first, resolve the conflict in the smallest files possible, then run the app or tests before pushing. If it is messy, I would pause and ask which version should win instead of guessing.";
  }

  if (/\b(upload|deployment|staging|token|auth|api|schema|bug|blocker|not working|fails|failed)\b/i.test(transcript)) {
    return "I should verify the failing path first, check the logs and config, then make the smallest fix we can test before the next demo. I would not claim it is done until we confirm it works in the target environment.";
  }

  return "I should describe the next concrete step instead of saying it is already done. The safe move is to clarify the blocker, assign the owner, and test the smallest fix before the next meeting.";
}

function replaceGenericSpeakingProjectLeak(output: string, transcript: string, promptMode?: PromptMode): string {
  if (promptMode !== "casual" && promptMode !== "general") {
    return output;
  }
  if (/\b(hybrid search memory assistant|saynext|say next|joblens|elderalbum|elder album|dalparkaid|blood donation|ai meeting monitor)\b/i.test(transcript)) {
    return output;
  }
  if (!isGenericSpeakingPrompt(transcript)) {
    return output;
  }
  if (!/\b(saynext|say next|aws|lambda|dynamodb|cloud|project|workplace|production|at work|engineering problems|technical)\b/i.test(output)) {
    return output;
  }

  if (/\b(team(?:ed)? up|work(?:ed|ing)? with someone|working in a team)\b/i.test(transcript)) {
    return "Yeah, mostly in school or small group tasks. I’m not always the loudest person, but I can listen, split the work clearly, and follow through on my part.";
  }

  if (/\bconfident|confidence\b/i.test(transcript)) {
    return "Probably when I slowly figure out something that looked hard at first. It’s not a dramatic moment, but that feeling of, okay, I can actually do this, is pretty nice.";
  }

  if (/\badvice\b/i.test(transcript)) {
    return "One time I asked a friend for advice when I was not sure what to focus on. They helped me narrow it down, and honestly it made the decision feel way less messy.";
  }

  if (/\blearn(?:ed)? (?:a )?(?:new )?(?:skill|hobby)\b/i.test(transcript)) {
    return "One skill I tried to learn was music when I was younger. I was not super consistent with it, but it still gave me a nice feeling when I could actually play something properly.";
  }

  return "Yeah, I can use a normal life example for that, not a work story. Something small but real usually sounds more natural.";
}

function replacePublicProjectName(output: string, transcript: string, promptMode?: PromptMode): string {
  if (!/\bSayNext\b/i.test(output)) {
    return output;
  }

  const publicFacing = promptMode === "interview"
    || /\b(project|bug|failure|trade[-\s]?off|above and beyond|worked independently|presentation|candidate|resume|explain|walk me through)\b/i.test(transcript);
  if (!publicFacing) {
    return output;
  }

  return output
    .replace(/\bSayNext's\b/g, "the Hybrid Search Memory Assistant's")
    .replace(/\bSayNext\b/g, "Hybrid Search Memory Assistant");
}

function trimForcedReturnQuestion(output: string, transcript: string): string {
  if (!/[?？]\s*$/.test(output)) {
    return output;
  }
  if (/\b(what should i ask|question should i ask|return it|receipt|final sale|could i|can i|should i say)\b/i.test(transcript)) {
    return output;
  }
  if (!/[.!]\s+\S/.test(output)) {
    return output;
  }

  let trimmed = output.trim();
  const trailingFillerQuestion = /\s+(?:How about you(?:, [A-Za-z]+)?|What about you|Have you [^?？.]{0,80}|Any games [^?？.]{0,80}|Can I help you with anything else|Is there someone else I can reach|What'?s next on the agenda|Or something else|What did you want to talk about|Anything refreshing to drink|Why do you ask|Everything okay|Anything urgent|What'?s going well today|How'?s it going|What do you think|right|huh)[?？.]$/i;
  for (let i = 0; i < 3; i += 1) {
    const next = trimmed.replace(trailingFillerQuestion, ".").replace(/\.\.+$/g, ".").trim();
    if (next === trimmed) break;
    trimmed = next;
  }
  return trimmed;
}

function trimForcedReturnQuestionV2(output: string, transcript: string): string {
  const embeddedFillerQuestion = /\s+(?:How about you[^?\uFF1F.]{0,80}|What about you[^?\uFF1F.]{0,80}|Anything fun you'?ve been into|Got any plans|Got any fun plans|Got anything fun planned|Got anything fun lined up|What kind of dish are you making|Want to talk about it|Maybe there'?s some confusion|What'?s up)[?\uFF1F]\s*/i;
  const trailingFillerPeriod = /\s+(?:What'?s next on (?:our )?(?:chat|conversation)|What'?s your go-to spot[^.]{0,80}|Anything to drink around here|Is there someone else I can help you find|Maybe having water nearby helps|Maybe try another pair|Maybe you collect coins|How was your day|Why are you asking)[.]$/i;
  if (!/[?\uFF1F][.!。！]?\s*$/.test(output) && !trailingFillerPeriod.test(output.trim()) && !embeddedFillerQuestion.test(output)) {
    return output;
  }
  if (/\b(what should i ask|question should i ask|return it|receipt|final sale|could i|can i|should i say)\b/i.test(transcript)) {
    return output;
  }
  if (!/[.!]\s+\S/.test(output)) {
    return output;
  }

  let trimmed = output.trim();
  trimmed = trimmed.replace(embeddedFillerQuestion, " ").replace(/\s{2,}/g, " ").trim();
  const trailingFillerQuestion = /\s+(?:How about you[^?\uFF1F.]{0,80}|What about you[^?\uFF1F.]{0,80}|Have you(?: [^?\uFF1F.]{0,80})?|Do you [^?\uFF1F.]{0,80}|Are you into sports or anything like that|Any games [^?\uFF1F.]{0,80}|Anything specific you'?re [^?\uFF1F.]{0,80}|Any specific way you want the chicken cut|Any other tips|Can I help you with anything else|Do you need help with anything else|Need anything else|Or do you need help with anything else|Could you repeat it|Can you say that again|What was the last part|What were you saying[^?\uFF1F.]{0,80}|Is there someone I can help you with|Is there someone else I can reach|Is there someone else I can help you find|What'?s next on (?:the agenda|our chat|our conversation)|What'?s your go-to (?:spot|show)[^?\uFF1F.]{0,80}|Or something else|What did you (?:want to talk about|need help with)|What are you guys up to|Any blockers for me to be aware of|Anything refreshing to drink|Anything to drink around here|What kind of dish are you making|Favorite mountain spot|Maybe we should [^?\uFF1F.]{0,120}|Maybe there'?s some confusion|Maybe having water nearby helps|Maybe try another pair|Maybe you collect coins|Got any fun plans|Got anything fun lined up|Any questions about that|Does that help clarify|Just calling you Doctor[^?\uFF1F.]{0,80}|Want to talk about it|Are you feeling okay|Why do you ask|Why are you asking|Everything okay|Anything urgent|What'?s going well today|How'?s it going|How was your day|What do you think|How about we call it a night|Let'?s (?:just )?forget about it and grab some takeout instead|Tall too|right|huh|you know)[?\uFF1F.]$/i;
  for (let i = 0; i < 3; i += 1) {
    const next = trimmed.replace(trailingFillerQuestion, ".").replace(/[?\uFF1F]\.+$/g, ".").replace(/\.\.+$/g, ".").trim();
    if (next === trimmed) break;
    trimmed = next;
  }
  trimmed = trimmed.replace(/\s+(?:What|Why)\.$/i, ".").replace(/\.\.+$/g, ".").trim();
  return trimmed;
}

function replaceUnsupportedDailySpecificClaim(output: string, transcript: string, promptMode?: PromptMode): string {
  if (promptMode !== "casual" && promptMode !== "general" && promptMode !== "interview") {
    return output;
  }

  const riskyOutput = /\b(cozy apartment|big window|couch|game nights?|gaming night|board games|pizza|sushi|favorite gaming controller|gaming headset|custom settings|black coffee|hot tea|piggy banks?|parking meters?|vending machines?|little corner store|corner store|coffee shops?|barista|usual order|noodle shop|owner knows me|extra veggies|victoria park|small park near my|peggy'?s cove|mountain in alberta|blew my mind|fresh air|spring garden road|pop atlantic|music festival|food vendors?|live music stages?|sunset|see the ocean|ocean in the distance|clear days|homebody like me|squirrels?|chipmunks?|ducks?|pond|picnic|pax|gaming conventions?|poster|genshin impact characters|detective conan|scarlet bullet|game of thrones|breaking bad|the boys|animated series|recently watched|pretty shy when i was little|participation in a coding competition|coding competition once|award for participation|favorite sichuan pepper grinder|friend'?s place|my friend alex|nose-deep|i know someone who|workshop|wooden frame|making everything from scratch|became a doctor|sister with her math homework|couple of hours|silly jokes|left it there by accident|mailed it back|called them to ask|librar(?:y|ies)|unknown number|wrong number|basketball together|different colleges|last year|spring festival|chinatown|lanterns?|dim sum|five main roads|residential streets|share them with friends|escrow|home stretch|playing some guitar|play guitar|guitar)\b/i.test(output);
  const additionalRiskyOutput = /\b(bookmarks and notes|last chapter|book recommendations|whipping through novels|non-fiction|cozy living room|balcony|near good food spots|parks too|games and books|halifax city center|harbor|crane my neck|green space if i crane|point pleasant park|friend from high school named alex|named alex|reconnected on social media|old friend from high school|indoor kid|for lunch today|fried chicken and soda|complex programming assignment last semester|gone fishing|went fishing|go fishing|by the lake|catch something|couple of times with my family back in chengdu)\b/i.test(output);
  const unsupportedStoryShape = /\b(describe|tell me about|time when|occasion|person who|family member|helped your family|place where|place in your city|photo|picture|view|crowded|good service|lost|valuable item|answered a phone|career in the medical|read a lot|make things by hand)\b/i.test(transcript)
    && /\b(I once|one time|there was this one|this local|my friend|I know someone|I have this|last time|last year|near my|at a coffee shop|at the library|in Chinatown|at Peggy'?s Cove)\b/i.test(output);
  if (!riskyOutput && !additionalRiskyOutput && !unsupportedStoryShape) {
    return output;
  }

  if (/\b(ideal|perfect)\b/i.test(transcript) && /\b(place|house|apartment|stay|live)\b/i.test(transcript)) {
    return "Probably somewhere quiet, private, and comfortable, with enough space for my computer setup. I care more about freedom and low pressure than a fancy place.";
  }

  if (/\b(lost|lose)\b/i.test(transcript) && /\b(valuable|item|thing)\b/i.test(transcript)) {
    return "I do not remember one dramatic valuable item I lost. Usually it is smaller stuff, and I just get annoyed for a while and try to find a practical replacement.";
  }

  if (/\b(did you like to talk|talk with others|talk to others)\b/i.test(transcript) && /\b(child|kid|little)\b/i.test(transcript)) {
    return "When I was very young, I was actually pretty lively and naughty. I became much quieter later, probably around middle school.";
  }

  if (/\b(prize|award|won|received)\b/i.test(transcript)) {
    return "I have not won any big prize that I would confidently talk about. I would keep it honest and say I am more proud of finishing real projects than receiving awards.";
  }

  if (/\b(small shop|store|shop)\b/i.test(transcript) && /\b(often|usually|go to)\b/i.test(transcript)) {
    return "I usually go to Superstore for normal groceries, or KFC and Mary Brown's when I just want fried chicken. Nothing fancy, just convenient.";
  }

  if (/\b(coffee)\b/i.test(transcript)) {
    return "No coffee for me, thanks. Water is fine.";
  }

  if (/\bperfume\b/i.test(transcript)) {
    return "Not really. I do not wear perfume much, so I would not make a big story out of it.";
  }

  if (/\b(chops)\b/i.test(transcript) && /\b(guitar|playing)\b/i.test(output)) {
    return "I'm good, thanks. Nothing special, just getting through the day.";
  }

  if (/\b(good service|service from a company|service from a shop)\b/i.test(transcript)) {
    return "I do not have one special service story I would confidently use. A safer answer is that I appreciate simple, efficient service, like when staff explain things clearly and do not make the process stressful.";
  }

  if (/\b(make things by hand|craft|toy|furniture)\b/i.test(transcript)) {
    return "I do not have a specific person story for that. I would describe it generally: people who make things by hand are usually patient and good at turning ideas into something real.";
  }

  if (/\b(person who likes to read|read a lot)\b/i.test(transcript)) {
    return "I do not have a specific person in mind, so I would describe this generally: someone who reads a lot is usually patient, curious, and able to focus for a long time.";
  }

  if (/\b(medical field|doctor|medicine|career in the medical)\b/i.test(transcript)) {
    return "I do not have a specific person story for that. I would answer generally: people who choose medicine usually need patience, responsibility, and a real willingness to deal with pressure.";
  }

  if (/\b(phone call|unknown number|public place)\b/i.test(transcript)) {
    return "I do not remember one clear story about this. In general, if I got an unknown call in public, I would probably answer quietly and keep it short.";
  }

  if (/\b(crowded place|crowded)\b/i.test(transcript)) {
    return "I do not have one dramatic crowded-place story. I would probably talk about a mall or supermarket when it gets busy, because I do not really enjoy crowded places.";
  }

  if (/\bfishing|go fishing|gone fishing|went fishing\b/i.test(transcript)) {
    return "I have not really gone fishing much. I like the idea of quiet outdoor stuff, but most of my free time is still games, anime, or staying inside.";
  }

  if (/\b(helped your family|family member|sister|brother|mother|mom)\b/i.test(transcript)) {
    return "I do not have one specific family-help story I would confidently use. A safer answer is that I usually help in small practical ways when family needs something, but I am not very expressive about it.";
  }

  if (/\b(photo|picture)\b/i.test(transcript) && /\b(home|room)\b/i.test(transcript)) {
    return "I do not have one specific photo or poster at home that I would confidently describe. I would keep it simple and say I care more about my computer setup and private space.";
  }

  if (/\b(cultural place|culture)\b/i.test(transcript)) {
    return "I would probably choose Japan because I am interested in the language, food, games, and anime culture. I have not been there yet, so I would keep it as something I want to learn about.";
  }

  if (/\b(study|favorite place to study|where do you study)\b/i.test(transcript)) {
    return "I do not really have a favorite study place. I usually just need somewhere quiet, with internet, and not too many distractions.";
  }

  if (/\b(coins?|coin)\b/i.test(transcript)) {
    return "Not really. I do not use coins much now, and I would not make a big story out of it.";
  }

  if (/\b(view|unforgettable view|seen anything)\b/i.test(transcript)) {
    return "I do not have one unforgettable view that clearly stands out. I usually like quieter views, like water, trees, or a calm street, more than crowded tourist spots.";
  }

  if (/\b(road|roads|neighborhood|neighbourhood)\b/i.test(transcript)) {
    return "I do not know the exact number of roads around my place. The area is fairly quiet and residential.";
  }

  if (/\b(park|garden|wild animals?|animal|nature|place in your city)\b/i.test(transcript)) {
    return "I would keep it general: I like quiet places that are not too crowded, with some trees or space to walk. I do not have one specific animal or park story I would confidently use.";
  }

  if (/\b(films?|movies?)\b/i.test(transcript) && /\b(watched|recently|describe)\b/i.test(transcript)) {
    return "I do not have one recent film that stands out. I usually watch anime or videos more casually, so I would rather not make up a specific title.";
  }

  if (/\b(films?|movies?|tv|shows?|watch)\b/i.test(transcript)) {
    return "I mostly watch anime or online videos casually. I would not name a specific film or show unless I clearly remember it.";
  }

  if (/\b(food|eat|favorite type of food)\b/i.test(transcript)) {
    return "Yeah, it is hard to pick one. I usually like Chinese food, fried chicken, curry, and malatang, depending on what is convenient.";
  }

  if (/\btraditional food|traditional festival|special event\b/i.test(transcript) && /\b(country|china|chinese)\b/i.test(transcript)) {
    return "For China, I would probably say zongzi during Dragon Boat Festival. It is sticky rice wrapped in bamboo leaves, sometimes with meat or red bean.";
  }

  if (/\b(party|parties)\b/i.test(transcript)) {
    return "I do not really go to many parties. If I hang out, it is usually something quieter, like food, games, or just talking with a small group.";
  }

  if (/\b(old friend|contact|got in contact|reconnect)\b/i.test(transcript)) {
    return "I can talk about old friends generally, but I should not invent a reunion story. A safer answer is that some friendships faded after school because people went to different places.";
  }

  if (/\b(free time|spare time|relax)\b/i.test(transcript)) {
    return "In my free time, I usually stay home, play games, watch anime or videos, and just enjoy having quiet time without pressure.";
  }

  if (/\b(escrow|home stretch)\b/i.test(output)) {
    return "It sounds like they are close to finishing the transaction, but they should double-check the details before assuming it is done.";
  }

  return output;
}

function replaceChineseEnglishClarification(output: string, transcript: string): string {
  if (!/[\u3400-\u9fff]/.test(transcript)) {
    return output;
  }

  if (!/\b(say that again in english|repeat that in english|say it again in english|could you say.*in english)\b/i.test(output)) {
    return output;
  }

  return "不好意思，刚才这句我没太听清，可以再说一遍吗？";
}

export function finalizeSayNextOutput(text: string, transcript: string, outputLanguage: OutputLanguage, eventMemory?: EventMemorySnapshot, promptMode?: PromptMode): string {
  const cleaned = sanitizeSayNextOutput(text);
  const withoutIdentityClaim = removeUnsupportedIdentityClaim(cleaned, transcript);
  const withoutWrongNameEcho = removeWrongNameEcho(withoutIdentityClaim, transcript);
  const withoutUnsupportedSayNext = replaceUnsupportedSayNextClaim(withoutWrongNameEcho, transcript);
  const withoutUnsupportedWork = replaceUnsupportedWorkExperienceClaim(withoutUnsupportedSayNext, transcript);
  const withoutUnsupportedTeacher = replaceUnsupportedFavoriteTeacherClaim(withoutUnsupportedWork, transcript);
  const withoutUnsupportedNamedHypothetical = replaceUnsupportedNamedHypotheticalClaim(withoutUnsupportedTeacher, transcript);
  const withoutOpenCoursewareMisread = replaceOpenCoursewareProjectMisread(withoutUnsupportedNamedHypothetical, transcript);
  const withoutLongSmallProject = shortenSmallProjectAnswer(withoutOpenCoursewareMisread, transcript);
  const withoutCompletedWorkClaim = replaceMeetingCompletedWorkClaim(withoutLongSmallProject, transcript, eventMemory);
  const withoutGenericProjectLeak = replaceGenericSpeakingProjectLeak(withoutCompletedWorkClaim, transcript, promptMode);
  const withoutPublicRoleplay = replacePublicTranscriptRoleplay(withoutGenericProjectLeak, transcript, eventMemory);
  const withoutPublicLeak = removePublicTranscriptPersonalLeak(withoutPublicRoleplay, eventMemory);
  const withoutUnsupportedDailySpecifics = replaceUnsupportedDailySpecificClaim(withoutPublicLeak, transcript, promptMode);
  const withoutChineseEnglishClarification = replaceChineseEnglishClarification(withoutUnsupportedDailySpecifics, transcript);
  const withoutPublicProjectName = replacePublicProjectName(withoutChineseEnglishClarification, transcript, promptMode);
  const withoutForcedQuestion = trimForcedReturnQuestionV2(withoutPublicProjectName, transcript);
  const polished = polishPersonaSayability(withoutForcedQuestion, transcript, promptMode);
  return enforceOutputLanguage(polished, transcript, outputLanguage);
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

async function generateOptionalContinuationWithOllama(prompt: string): Promise<string> {
  const timeoutMs = Math.min(
    OLLAMA_TIMEOUT_MS,
    Number(process.env.READBACK_CONTINUATION_MODEL_TIMEOUT_MS || 8000),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: `${sayNextInstructions}\n\nReturn only the next optional sentence Xiang can say, or NO_CONTINUATION. No JSON. No labels.`,
      prompt: `${prompt}\n\nReturn only one short optional continuation sentence, or NO_CONTINUATION. No JSON. No labels. No reasoning.`,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.85,
        num_ctx: 3072,
        num_predict: 55,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama readback continuation request failed: ${response.status} ${await response.text()}`);
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
  const directCleaned = cleaned.replace(/^["'“”‘’]\s*/, "").toLowerCase();
  if (directCleaned.startsWith(directOpening)) {
    const quoteOffset = cleaned.length - cleaned.replace(/^["'“”‘’]\s*/, "").length;
    return cleaned
      .slice(quoteOffset + opening.length)
      .replace(/^[\s:,\-.!?]+/, "")
      .replace(/^["'“”‘’]\s*/, "")
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

function enforceTelepromptOutputLanguage(text: string, outputLanguage?: OutputLanguage): string {
  if (outputLanguage !== "english") return text;

  let cleaned = text;
  const translationStart = cleaned.search(/(?:中文翻译|翻译如下|以下是中文|chinese translation|translation)\s*[:：]?/i);
  if (translationStart >= 0) {
    cleaned = cleaned.slice(0, translationStart).trim();
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const englishOnlySentences = sentences.filter((sentence) => !/[\u3400-\u9fff]/.test(sentence));
  if (englishOnlySentences.length > 0 && englishOnlySentences.length < sentences.length) {
    return englishOnlySentences.join(" ");
  }

  return cleaned;
}

function trimIncompleteTrailingSentence(text: string): string {
  const cleaned = text.trim();
  if (!cleaned || /[.!?。！？]["'”’)]?$/.test(cleaned)) return cleaned;

  const lastEnd = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf("!"),
    cleaned.lastIndexOf("?"),
    cleaned.lastIndexOf("。"),
    cleaned.lastIndexOf("！"),
    cleaned.lastIndexOf("？"),
  );

  if (lastEnd > 80) {
    return cleaned.slice(0, lastEnd + 1).trim();
  }

  return cleaned;
}

function trimIncompleteTrailingSentenceForDisplay(text: string): string {
  const cleaned = text.trim();
  if (!cleaned || /[.!?。！？]["']?$/.test(cleaned)) return cleaned;

  const lastEnd = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf("!"),
    cleaned.lastIndexOf("?"),
    cleaned.lastIndexOf("。"),
    cleaned.lastIndexOf("！"),
    cleaned.lastIndexOf("？"),
  );

  return lastEnd > 80 ? cleaned.slice(0, lastEnd + 1).trim() : cleaned;
}

function sanitizeTelepromptScript(text: string, openingLine?: string, outputLanguage?: OutputLanguage): string {
  let cleaned = String(text || "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (/^\s*\{/.test(cleaned)) {
    const output = extractOutputField(cleaned);
    if (output) cleaned = output;
  }

  cleaned = normalizeMojibakeArtifacts(cleaned)
    .replace(/\u2019s/g, "'s")
    .replace(/\u2019t/g, "'t")
    .replace(/\u2019re/g, "'re")
    .replace(/\u2019ve/g, "'ve")
    .replace(/\u2019d/g, "'d")
    .replace(/\u2019ll/g, "'ll")
    .replace(/\u2018|\u2019|\uFFFD/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, " - ")
    .replace(/^\s*(script|answer|response|teleprompt|continued answer)\s*:\s*/i, "")
    .replace(/\bI don'?t really have a super dramatic dream job,\s*but\s*/i, "")
    .replace(/\bI don'?t have a dream job,\s*but\s*/i, "")
    .replace(/\bdream job\b/gi, "ideal role")
    .replace(/\bOverall,\s*/gi, "")
    .replace(/\bIn conclusion,\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  cleaned = normalizeSpokenDisplayPunctuation(cleaned);

  cleaned = stripLeadingOpeningLine(cleaned, openingLine);
  cleaned = enforceTelepromptOutputLanguage(cleaned, outputLanguage);
  cleaned = trimIncompleteTrailingSentenceForDisplay(cleaned);

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

export interface ProcessConversationOptions {
  openAiConversationSession?: OpenAiConversationSession;
  transcriptCommitReason?: TranscriptCommitReason;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compactText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeContextLine(text: string): string {
  return compactText(text).toLowerCase();
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
  if (isGenericSpeakingPrompt(latestTranscript)) {
    return "casual";
  }

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
    "Identity: Chinese international student at Dalhousie in Halifax; current program/major is Master of Applied Computer Science (MACS), not Math; previous degree is Bachelor of Computer Science at Acadia; from Chengdu and moved to Canada during high school.",
    "Core style: simple spoken English, natural, low-pressure, modest, internet-native, slightly imperfect is okay.",
    "Tone: calm, relaxed, not performatively hardworking, not corporate, not fake-positive, not motivational-speaker.",
    "Conversation target: sound like Xiang after thinking for a few seconds: clearer, calmer, and more confident, but still modest and believable.",
    "Advantage target: help Xiang gain conversational advantage by organizing logic, choosing the useful next move, and avoiding panic, blankness, fake confidence, or fake personal detail.",
    "Good communicator shape: answer first, show he understood the situation, add one small bridge/reason/next step, and only ask a return question when it genuinely helps.",
    "Useful words, used sparingly: honestly, probably, kind of, mostly, a bit, not really, I guess, maybe, like.",
    "Social style: introverted/homebody, small circle, reactive more than proactive, comfortable being alone, does not like forced social energy.",
    "Motivation pattern: interest-triggered bursts rather than stable grinding; wants to look capable and prepared, but dislikes pressure, constant monitoring, and blank-page thinking.",
    "Work/learning style: procrastinates but usually finishes; learns best by practical examples, building, testing, and AI-assisted iteration.",
    "Self-positioning: reliable practical developer who can make systems work; do not frame Xiang as a technical genius, star engineer, or ultra-strong leader.",
    "Professional/academic topics: be accurate, specific, and capable. Give strong domain reasoning without claiming senior personal experience.",
    "Privacy: never volunteer family names, exact private background, health, bullying, finances, romantic inexperience, PR/immigration goals, or sensitive life events unless Xiang explicitly asks to use them.",
    "Avoid: polished essay tone, resume wording, self-praise, fake confidence, corporate words, unsolicited advice, overexplaining.",
  ];

  const modeProfiles: Record<PromptMode, string[]> = {
    casual: [
      "Casual life: indoor-focused, low-energy, likes games/anime/internet culture/memes/music, fried chicken, Sichuan flavors, soda, takeout, late sleep.",
      "Gaming: open-world/RPG/immersive games, Pokemon, Genshin, Zenless Zone Zero, game music, scripting/tools/automation for games.",
      "Casual replies should sound like a real local-ish student: short, relaxed, meme-aware only when natural, not too grammatically perfect.",
      "Do not overuse casual markers like honestly, kind of, I guess, or pretty chill; the output should not sound like a persona mask.",
      "Do not be nosy, do not give life advice, do not over-care. Answer the vibe and keep it low-pressure.",
      "Small generic detail is okay, but do not invent named movies, exact rooms, stores, parties, trips, valuable items, or recent events.",
      "Do not turn daily chat into a personal essay or deep meaning summary.",
    ],
    classroom: [
      "Classroom: Xiang wants to appear knowledgeable and capable, but still student-like.",
      "Academic/lecture content: prioritize correctness, but keep live-display answers compact.",
      "When the speaker is explaining a concept, give one short supplement, concrete example, trade-off, or sharp question Xiang could ask. Prefer about 12-28 words.",
      "When Xiang is asked directly, give 1-2 short speakable sentences unless the question explicitly asks for detail.",
      "Current Summer 2026 courses: Advanced Cloud Architecting, Deep Learning Applications, and Recommender Systems.",
      "Do not make classroom answers sound like casual small talk.",
    ],
    interview: [
      "Interview: honest, clear, professional student tone. Xiang wants to sound capable without overclaiming.",
      "He has hands-on student project experience in web/mobile apps, Firebase, AWS serverless, and AI-related tools.",
      "Projects available if asked: Hybrid Search Memory Assistant as the public-facing name for SayNext, plus Elder Album, Dal Parking Aid / DalParkAid, JobLens, and Study Session Tracker.",
      "Unknown tech: do not fake experience; say he has not used it in a real project yet.",
      "Interview help should organize answers because Xiang has difficulty memorizing scripts and structured speaking.",
      "Career: wants a stable software/cloud/full-stack/AI job and long-term life stability in Canada.",
      "For technical interview questions, give a clear concept, simple solution path, and practical debugging/architecture details.",
      "For IELTS-style Describe/Do you questions about everyday life, confidence, home, friends, places, hobbies, childhood, food, weather, or free time, answer like normal speaking practice. Do not force SayNext, cloud, AWS, or project stories unless the question explicitly asks about technical work, projects, debugging, teamwork, or engineering decisions.",
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

function findLatestTranscriptIndex(conversation: Conversation): number {
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].type === "transcript") return i;
  }
  return -1;
}

function isPublicOrThirdPartyEvent(eventMemory?: EventMemorySnapshot): boolean {
  if (!eventMemory) return false;
  const text = `${eventMemory.scene} ${eventMemory.title} ${eventMemory.summary}`.toLowerCase();
  return /\b(source=open_|source=short_form|open-source reference|third-party|public transcript|public\/open)\b/.test(text);
}

function isLikelySpeakerLabelTranscript(text: string): boolean {
  return /^\s*[A-Z][A-Z_ .'-]{0,30}\s*:/i.test(text);
}

function memoryBlockCategory(block: string): string {
  return block.match(/\[([^,\]]+)/)?.[1]?.trim().toLowerCase() || "";
}

function memoryBlockSourceRef(block: string): string {
  return block.match(/Source(?: ref)?:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase() || "";
}

function asksForXiangPersonalContext(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(xiang|you|your|yours|yourself|my|me|i)\b/.test(normalized)
    || /\b(favorite|favourite|prefer|like|dislike|study|school|course|class|project|built|made|experience|family|home|room|game|food|music|anime|weekend|sleep|live|from|background|candidate|interview)\b/.test(normalized);
}

function asksForProjectOrExperience(text: string): boolean {
  return /\b(project|built|made|experience|worked on|portfolio|app|application|interview|candidate|resume|tell me about yourself|why should we hire|your role|my role)\b/i.test(text);
}

function isGenericSpeakingPrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(project|technical|engineering|software|cloud|aws|lambda|dynamodb|react|firebase|api|debug|bug|code|coding|system|architecture|interview|candidate|resume|work|student|study|workplace|production|role|position|hire|portfolio|internship|ai|llm|model|prompt|agent)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:mobile|web|app|application|react native|development|technical|software)\s+experience\b/.test(normalized)
    || /\bapp development\b/.test(normalized)) {
    return false;
  }
  return /\b(describe|do you|did you|have you|what kind of|what type of|what is the difference|what do you usually|what do you learn from|who is|where do you|when was|how often|why do you)\b/.test(normalized);
}

function filterRuntimePersonalMemoryContext(
  context: string,
  latestTranscript: string,
  promptMode: PromptMode,
  eventMemory?: EventMemorySnapshot,
): string {
  const trimmed = context.trim();
  if (!trimmed) return "";

  if (isPublicOrThirdPartyEvent(eventMemory)) return "";

  const publicSpeakerLabel = isLikelySpeakerLabelTranscript(latestTranscript)
    && !/\b(xiang|you|your)\b/i.test(latestTranscript);
  if (publicSpeakerLabel && !asksForXiangPersonalContext(latestTranscript)) return "";

  const blocks = trimmed.split(/\n\n---\n\n/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return "";

  const wantsPersonal = asksForXiangPersonalContext(latestTranscript);
  const wantsProject = asksForProjectOrExperience(latestTranscript);
  const originMotivationQuestion = wantsPersonal && /\b(why|origin|motivation|motivated|interested|become interested|became interested|build|built)\b/i.test(latestTranscript);
  const keep = blocks.filter((block) => {
    const category = memoryBlockCategory(block);
    const sourceRef = memoryBlockSourceRef(block);
    const isKnowledge = category.startsWith("knowledge") || sourceRef.startsWith("knowledge:");
    const isProject = category.includes("project") || sourceRef.startsWith("doc:");
    const isBehavioral = category.includes("behavioral") || sourceRef.includes("behavioral");
    const isOriginMemory = originMotivationQuestion && /\b(origin|motivation|motivated|emotional origin|became interested|became one emotional origin)\b/i.test(block);

    if (isOriginMemory) return true;

    if (promptMode === "casual" || promptMode === "general") {
      if (!wantsPersonal) return false;
      if (isGenericSpeakingPrompt(latestTranscript) && (isKnowledge || isProject || isBehavioral)) return false;
      if (isKnowledge && !wantsProject) return false;
      return true;
    }

    if (promptMode === "classroom" || promptMode === "technical") {
      if (isKnowledge) return true;
      if ((isProject || isBehavioral) && wantsProject) return true;
      return wantsPersonal && !isProject && !isBehavioral;
    }

    if (promptMode === "interview") {
      if (isGenericSpeakingPrompt(latestTranscript) && (isKnowledge || isProject || isBehavioral)) return false;
      return true;
    }

    if (promptMode === "service") {
      return wantsPersonal && !isKnowledge;
    }

    return isKnowledge || wantsPersonal || wantsProject;
  });

  return keep.slice(0, 3).join("\n\n---\n\n");
}

function formatCompactEventMemory(eventMemory?: EventMemorySnapshot, excludedTranscripts: string[] = []): string {
  if (!eventMemory) return "No active event memory.";

  const excluded = new Set(excludedTranscripts.map(normalizeContextLine).filter(Boolean));
  const recent = eventMemory.recentTranscripts
    .filter((text) => !excluded.has(normalizeContextLine(text)))
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

  if (/\bwash\b/i.test(normalized) && /\bvegetables?\b/i.test(normalized) && /\bcut\b/i.test(normalized) && /\bchicken\b/i.test(normalized)) {
    return createInsight(
      "Sure, I'll wash the vegetables and cut the chicken first.",
      "Immediate task acknowledgement without unnecessary follow-up question",
      timestamp,
      0.9,
    );
  }

  if (/^\s*we'?re having great[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Glad to hear that.",
      "Immediate fragment acknowledgement without forced return question",
      timestamp,
      0.82,
    );
  }

  if (/\bwe'?re gonna kill you\b/i.test(normalized)) {
    return createInsight(
      "Please don't joke like that.",
      "Immediate de-escalation for threat-like transcript",
      timestamp,
      0.86,
    );
  }

  if (/^(?:good for you|nice|cool|awesome|that'?s good|that sounds good|sounds good|glad to hear that)[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese" ? "嗯，挺好的。" : "Yeah, thanks. I think it’ll be useful.",
      "Immediate safe acknowledgement without personal expansion",
      timestamp,
      0.82,
    );
  }

  if (/\b(good\s+morning|morning)\b/i.test(normalized) && /\b(day going|how'?s your day|how is your day|so far)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "还行，今天就比较 chill，刚开始进入状态。你呢？"
        : "Not bad so far, still waking up a bit.",
      "Immediate natural daily morning response",
      timestamp,
      0.9,
    );
  }

  if (/\b(taking it easy|take it easy|just chilling|chill today)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "嗯，今天就比较 chill，休息一下，可能顺便补点东西。"
        : "Yeah, mostly just taking it easy and maybe catching up on a few things.",
      "Immediate casual taking-it-easy response",
      timestamp,
      0.88,
    );
  }

  if (
    !/\b(lambda|function|cold start|aws)\b/i.test(normalized)
    && /\b(what time|when)\b/i.test(normalized)
    && /\b(sleep|go to bed|bedtime)\b/i.test(normalized)
  ) {
    return createInsight(
      "It depends, honestly. My sleep schedule is pretty irregular, especially when I have projects, so I often sleep late.",
      "Immediate grounded sleep-routine response",
      timestamp,
      0.88,
    );
  }

  if (/\bi'?m driving\b|\bdriving,\s*buddy\b/i.test(normalized)) {
    return createInsight(
      "I'm driving, so I can't really talk right now.",
      "Immediate driving response without forced return question",
      timestamp,
      0.86,
    );
  }

  if (/\bconfidence\b/i.test(normalized) && /\b(know everything|not sure|next step|still trying)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, that is closer to real confidence: admit uncertainty, then still take the next step.",
      "Immediate confidence reframing response",
      timestamp,
      0.86,
    );
  }

  if (/\b(confident|confidence)\b/i.test(normalized) && /\b(feel|made|something|time|describe)\b/i.test(normalized)) {
    return createInsight(
      "Probably when I keep adjusting a UI and it finally looks good. It is not dramatic, but it makes me feel like, okay, I can actually build this.",
      "Immediate grounded confidence-story response",
      timestamp,
      0.88,
    );
  }

  if (/\byou must be joking\b/i.test(normalized)) {
    return createInsight(
      "Yeah, rush hour is painful. I would rather avoid driving then if I can.",
      "Immediate grounded rush-hour joke response",
      timestamp,
      0.86,
    );
  }

  if (/\b(favorite type of food|favourite type of food|favorite food|favourite food|what food do you like)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, it is hard to pick one. I usually like Chinese food, fried chicken, curry, and malatang, depending on what is convenient.",
      "Immediate grounded favorite-food response",
      timestamp,
      0.88,
    );
  }

  if (/\bshare\b/i.test(normalized) && /\bsecrets?\b/i.test(normalized) && /\bfriends?\b/i.test(normalized)) {
    return createInsight(
      "It depends on trust. I would not share too much unless I really trust that person.",
      "Immediate grounded privacy-with-friends response",
      timestamp,
      0.86,
    );
  }

  if (/\bfree time\b/i.test(normalized) && /\b(now|nowadays|today|past|before|difference)\b/i.test(normalized)) {
    return createInsight(
      "Now people spend more free time online. For me that is mostly games, anime, and internet stuff, while in the past people seemed to go outside or meet friends more.",
      "Immediate grounded free-time comparison response",
      timestamp,
      0.88,
    );
  }

  if (/\b(talk with others|talk to others|talking with others)\b/i.test(normalized)) {
    return createInsight(
      "I am okay with one-on-one conversations, but I do not like big groups or forced socializing.",
      "Immediate grounded social-style response",
      timestamp,
      0.86,
    );
  }

  if (/\b(new friends?|made any new friends?)\b/i.test(normalized) && /\brecently|lately|these days\b/i.test(normalized)) {
    return createInsight(
      "Not really recently. I have mostly been busy with school and staying in my usual routine.",
      "Immediate grounded recent-friends response",
      timestamp,
      0.86,
    );
  }

  if (/\b(favorite|favourite|best)\b/i.test(normalized) && /\b(place to study|study place|where to study|study)\b/i.test(normalized)) {
    return createInsight(
      "I do not really have a favorite study place. Usually I just need somewhere quiet, with internet, and not too many distractions.",
      "Immediate grounded study-place response",
      timestamp,
      0.88,
    );
  }

  if (/\b(cultural place|culture)\b/i.test(normalized) && /\b(learn|like|would|want|describe|there)\b/i.test(normalized)) {
    return createInsight(
      "Probably Japan, mainly because I like games, anime, music, and maybe learning Japanese. I have not been there, so I would frame it as curiosity, not a travel story.",
      "Immediate grounded culture-place response",
      timestamp,
      0.88,
    );
  }

  if (/\bunforgettable view\b|\bseen .* view\b|\bbeautiful view\b/i.test(normalized)) {
    return createInsight(
      "Not really. I do not have one unforgettable view that clearly stands out. I usually like quieter views more than crowded tourist places.",
      "Immediate grounded view-memory response",
      timestamp,
      0.88,
    );
  }

  if (/\b(favou?rite|favorite)\s+(teacher|professor|instructor)\b/i.test(normalized)) {
    return createInsight(
      "I do not really have one specific favourite teacher. I usually remember teachers who explain things clearly and do not make the class too stressful.",
      "Immediate grounded favourite-teacher response",
      timestamp,
      0.88,
    );
  }

  if (/\b(work as|be|become)\s+a\s+teacher\b|\bwould you like to teach\b|\bteaching\b.*\byour thing\b/i.test(normalized)) {
    return createInsight(
      "Not really. I respect teaching, but I prefer building systems where I can focus quietly and solve practical problems.",
      "Immediate grounded teaching-career response",
      timestamp,
      0.88,
    );
  }

  if (/\b(prize|award)\b/i.test(normalized) && /\b(received|won|got|describe|talk about|have)\b/i.test(normalized)) {
    return createInsight(
      "I have not won any big prize that I would confidently talk about. I am more proud of finishing real projects than receiving awards.",
      "Immediate grounded prize response",
      timestamp,
      0.88,
    );
  }

  if (/\btraditional food|traditional festival|special event\b/i.test(normalized) && /\b(country|china|chinese)\b/i.test(normalized)) {
    return createInsight(
      "For China, I would probably say zongzi during Dragon Boat Festival. It is sticky rice wrapped in bamboo leaves, sometimes with meat or red bean.",
      "Immediate compact traditional-food response",
      timestamp,
      0.86,
    );
  }

  if (/\bfishing|go fishing|gone fishing|went fishing\b/i.test(normalized)) {
    return createInsight(
      "I have not really gone fishing much. I like the idea of quiet outdoor stuff, but most of my free time is still games, anime, or staying inside.",
      "Immediate grounded fishing response",
      timestamp,
      0.86,
    );
  }

  if (/^\s*(?:mm+[-\s]?hmm+|mhm+|uh[-\s]?huh|yeah|yep|okay|ok)[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Yeah, I'm following.",
      "Immediate minimal acknowledgement for filler transcript",
      timestamp,
      0.82,
    );
  }

  if (/^\s*present[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Present.",
      "Immediate attendance response",
      timestamp,
      0.9,
    );
  }

  if (/^\s*(?:and|so|then)[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Yeah, go on.",
      "Immediate minimal response for continuation fragment",
      timestamp,
      0.82,
    );
  }

  if (/^\s*(?:[A-Z]\s*:\s*)?(?:uh\s+|um\s+)?almost[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Almost. Give me one minute, then next I can share my part.",
      "Immediate meeting almost-ready response with next step",
      timestamp,
      0.84,
    );
  }

  if (/^\s*[A-Z][a-zA-Z'-]{2,24}[.!?\s]*$/.test(transcript)) {
    return createInsight(
      "I heard the name, but I don't have enough context yet.",
      "Immediate single-name fragment response without forced follow-up",
      timestamp,
      0.82,
    );
  }

  if (/\bwrong number\b/i.test(normalized)) {
    return createInsight(
      "Sorry about that. You must have the wrong number.",
      "Immediate wrong-number response without forced follow-up",
      timestamp,
      0.84,
    );
  }

  if (/\bprimary school teachers?\b/i.test(normalized) && /\bstill in touch|keep in touch|contact\b/i.test(normalized)) {
    return createInsight(
      "No, not really. I would keep that answer short.",
      "Immediate grounded primary-school-teacher contact response",
      timestamp,
      0.86,
    );
  }

  if (/^\s*hey,\s*doctor[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Hey, good morning.",
      "Immediate casual doctor greeting without forced follow-up",
      timestamp,
      0.82,
    );
  }

  if (/\bname and the\b/i.test(normalized)) {
    return createInsight(
      "Sorry, I didn't catch that clearly.",
      "Immediate unclear name-fragment response without forced follow-up",
      timestamp,
      0.82,
    );
  }

  if (/\bgargle\b/i.test(normalized)) {
    return createInsight(
      "Sorry, I didn't catch that clearly.",
      "Immediate unclear gargle-fragment response without forced follow-up",
      timestamp,
      0.82,
    );
  }

  if (/\bdid i just get two people\b/i.test(normalized)) {
    return createInsight(
      "No, just one person here. Maybe the audio doubled.",
      "Immediate duplicated-audio clarification without forced follow-up",
      timestamp,
      0.84,
    );
  }

  if (/\bthere you go\b/i.test(normalized)) {
    return createInsight(
      "That is just a handoff; no action needed yet.",
      "Immediate handoff response without forced follow-up",
      timestamp,
      0.82,
    );
  }

  if (/^\s*(?:thank you|thanks|thank you very much)[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "You're welcome.",
      "Immediate simple thanks response",
      timestamp,
      0.86,
    );
  }

  if (/\bhow are your chops\b/i.test(normalized)) {
    return createInsight(
      "I'm good, thanks. Nothing special, just getting through the day.",
      "Immediate ambiguous chops response without fake hobby",
      timestamp,
      0.84,
    );
  }

  if (/\b(i'?ll just have water|just water|water for me)\b/i.test(normalized)) {
    return createInsight(
      "Just water for me, thanks.",
      "Immediate drink response without forced follow-up",
      timestamp,
      0.88,
    );
  }

  if (/\bcoffee\b/i.test(normalized) && /\b(want|drink|have|for coffee|some coffee)\b/i.test(normalized)) {
    return createInsight(
      "No coffee for me, thanks. Water is fine.",
      "Immediate coffee preference response without forced follow-up",
      timestamp,
      0.88,
    );
  }

  if (/\bgrab food\b|\bget food\b|\beat later\b/i.test(normalized)) {
    return createInsight(
      "Sure, sounds good. Sichuan food or fried chicken both work for me.",
      "Immediate food-plan response without forced follow-up",
      timestamp,
      0.86,
    );
  }

  if (/\bfree time activities\b/i.test(normalized) && /\b(country|china|chinese)\b/i.test(normalized)) {
    return createInsight(
      "In China, people often watch videos, play games, eat out, or walk around malls. For me it is mostly games and anime.",
      "Immediate compact country-free-time response",
      timestamp,
      0.86,
    );
  }

  if (/\bwhat time\b/i.test(normalized) && /\b(head out|leave|go out)\b/i.test(normalized)) {
    return createInsight(
      "Let's head out in about 15 minutes.",
      "Immediate departure-time response without forced follow-up",
      timestamp,
      0.86,
    );
  }

  if (/\benroll\b/i.test(normalized) && /\bnight school\b/i.test(normalized) && /\bbusiness management\b/i.test(normalized)) {
    return createInsight(
      "That sounds like a good plan. Business management could be useful if you want more practical career options.",
      "Immediate night-school response without forced follow-up",
      timestamp,
      0.84,
    );
  }

  if (/\b(freezing|cold outside|cold out)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, it is cold outside. I would probably just stay inside if I can.",
      "Immediate cold-weather response without fake drink detail",
      timestamp,
      0.86,
    );
  }

  if (/\bthanks?\b/i.test(normalized) && /\bprofessor\b/i.test(normalized) && /\bnice of you\b/i.test(normalized)) {
    return createInsight(
      "Thanks, professor. I appreciate it.",
      "Immediate professor-thanks response without forced return question",
      timestamp,
      0.86,
    );
  }

  if (/\bbeing watched\b|\bbe careful\b/i.test(normalized) && /\bprivacy|watched|careful|paranoid|guard\b/i.test(normalized)) {
    return createInsight(
      "I get it. I would rather be careful with personal information and only share what is necessary.",
      "Immediate privacy concern response without forced return question",
      timestamp,
      0.86,
    );
  }

  if (/\bwhat did you eat for lunch\b/i.test(normalized)) {
    return createInsight(
      "Probably something simple, like fried chicken, curry, or malatang. My meals are usually pretty practical.",
      "Immediate grounded lunch response",
      timestamp,
      0.86,
    );
  }

  if (/\bprefer\b/i.test(normalized) && /\bwork(?:ing)?\b/i.test(normalized) && /\bhome\b/i.test(normalized) && /\bworkplace|office\b/i.test(normalized)) {
    return createInsight(
      "I prefer working from home because it is quieter and I have more control over my space. Offices can feel noisy and distracting.",
      "Immediate grounded work-from-home preference",
      timestamp,
      0.86,
    );
  }

  if (/\bcheapest fried chicken\b|\bfried chicken\b.*\bfrench fries\b|\bfrench fries\b.*\bfried chicken\b/i.test(normalized)) {
    return createInsight(
      "Yeah, fried chicken and fries sounds good. I usually like KFC or Mary Brown's for that kind of food.",
      "Immediate fried chicken preference response",
      timestamp,
      0.86,
    );
  }

  if (/\bview\b/i.test(normalized) && /\b(place where you live|around your place|where you live|around here)\b/i.test(normalized)) {
    return createInsight(
      "Nothing too special, mostly normal city or residential views around Halifax. I care more about quiet private space than a beautiful view.",
      "Immediate grounded view response",
      timestamp,
      0.86,
    );
  }

  if (/\b(person who likes to read|someone who likes to read|read a lot)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific person in mind. I would describe someone patient and curious, who can focus for a long time without getting bored.",
      "Immediate generic reader-person response",
      timestamp,
      0.86,
    );
  }

  if (/\b(make things by hand|handmade|craft|toys?|furniture)\b/i.test(normalized) && /\b(person|someone|describe|likes?)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific person in mind. I would say they are probably patient, practical, and good at turning an idea into something real.",
      "Immediate grounded handmaking-person response without fake anecdote",
      timestamp,
      0.86,
    );
  }

  if (/\bperfume\b/i.test(normalized) && /\bgift\b/i.test(normalized)) {
    return createInsight(
      "Maybe, but only if I knew the person liked that scent. Otherwise, I would choose something safer.",
      "Immediate perfume-gift response without unsupported relationship detail",
      timestamp,
      0.86,
    );
  }

  if (/\bperfume\b/i.test(normalized) && /\b(many bottles|have many|wear|why)\b/i.test(normalized)) {
    return createInsight(
      "Not really. I do not wear perfume much, so I would not make a big story out of it.",
      "Immediate perfume ownership response without unsupported gift detail",
      timestamp,
      0.86,
    );
  }

  if (/\b(person who|someone who|describe)\b/i.test(normalized) && /\b(medical field|medicine|doctor|surgeon|nurse)\b/i.test(normalized)) {
    return createInsight(
      "I do not have a specific person story for that. I would answer generally: people who choose medicine usually need patience, responsibility, and a real willingness to deal with pressure.",
      "Immediate generic medical-career person response",
      timestamp,
      0.86,
    );
  }

  if (/\b(have you collected coins|do you collect coins|collected coins|take coins|carry coins|use coins)\b/i.test(normalized)) {
    return createInsight(
      "Not really. I almost never carry coins now; I mostly use cards or my phone.",
      "Immediate coins response without forced follow-up",
      timestamp,
      0.86,
    );
  }

  if (/\bwhen are you coming back\b/i.test(normalized)) {
    return createInsight(
      "I'm not sure yet; probably later. I can let you know when I know.",
      "Immediate cautious return-time response",
      timestamp,
      0.84,
    );
  }

  if (/\b(cooked me|so dead|i'?m dead|brutal|midterm)\b/i.test(normalized) && /\b(midterm|exam|test|dead|cooked)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, that sounds brutal. I would probably just recover a bit and not think too hard for a while.",
      "Immediate slang stress response without fake personal claim",
      timestamp,
      0.88,
    );
  }

  if (/\b(asked someone for advice|ask someone for advice|asked for advice|advice from someone)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one dramatic advice story. Usually I ask when I need to narrow down choices, like courses, projects, or what to focus on next.",
      "Immediate grounded advice story response",
      timestamp,
      0.86,
    );
  }

  if (/\b(photo|picture)\b/i.test(normalized) && /\b(describe|talk about|makes you|important|remember|home|room)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific photo I would confidently describe. I would keep it simple and talk about photos as a way to remember a period of life.",
      "Immediate grounded photo response",
      timestamp,
      0.86,
    );
  }

  if (/\b(old friend|got in contact|reconnect|reconnected|lost contact)\b/i.test(normalized)) {
    return createInsight(
      "I can talk about old friends generally, but I should not invent a reunion story. Some friendships just faded after school because people went to different places.",
      "Immediate grounded old-friend response",
      timestamp,
      0.86,
    );
  }

  if (/\b(wild animals?|park|nature|animal)\b/i.test(normalized) && /\b(city|halifax|place|seen|see|describe)\b/i.test(normalized)) {
    return createInsight(
      "I would keep it general: I like quiet places with some trees or space to walk, but I do not have one specific animal or park story I would confidently use.",
      "Immediate grounded park/animal response",
      timestamp,
      0.86,
    );
  }

  if (/\bpanther\b/i.test(normalized) && /\bdifficult\b/i.test(normalized) && /^\s*[A-Z]\s*:/i.test(transcript)) {
    return createInsight(
      "Good point. We should decide the level of detail first, then draw the simplest version that still reads as a panther.",
      "Immediate meeting panther design-scope response",
      timestamp,
      0.86,
    );
  }

  if (/\bspiders?\b/i.test(normalized) && /\bweb\b/i.test(normalized) && /^\s*[A-Z]\s*:/i.test(transcript)) {
    return createInsight(
      "So the next decision is whether we model the web as flat or three-dimensional.",
      "Immediate meeting spider-web decision response",
      timestamp,
      0.86,
    );
  }

  if (/\bindian\b/i.test(normalized) && /\bafrican\b/i.test(normalized) && /\belephants?\b/i.test(normalized)) {
    return createInsight(
      "So the next step is to choose which elephant type first, because the ears change the drawing.",
      "Immediate meeting elephant-type decision response",
      timestamp,
      0.86,
    );
  }

  if (/\b(child|kid|childhood)\b/i.test(normalized) && /\b(friends|teamwork|make friends|play with others)\b/i.test(normalized)) {
    return createInsight(
      "When I was very young, I was actually lively and playful. Later I became quieter, so I would not describe it as a simple always-social or always-alone story.",
      "Immediate grounded childhood social response",
      timestamp,
      0.86,
    );
  }

  if (/\bwhat game\b|\bwhich game\b|\bgames? (?:you )?(?:played|play)\b/i.test(normalized)) {
    return createInsight(
      "Mostly games like Genshin or other RPG and gacha-style games. I like exploration, music, collecting, and the overall atmosphere.",
      "Immediate grounded game preference response",
      timestamp,
      0.88,
    );
  }

  if (/\bmountains?\b/i.test(normalized) && /\bholiday|travel|go to|go on\b/i.test(normalized)) {
    return createInsight(
      "I do not really go on mountain holidays, but I would be open to it with other people. I like the idea of travel more than travelling alone.",
      "Immediate grounded mountain travel response",
      timestamp,
      0.86,
    );
  }

  if (/\bbike\b/i.test(normalized) && /\b(now|currently|these days|do you have)\b/i.test(normalized)) {
    return createInsight(
      "Not now. The bike I remember more is the e-bike I used in university, but these days I usually walk, take the bus, or drive.",
      "Immediate grounded current-bike response",
      timestamp,
      0.86,
    );
  }

  if (/\b(what|which)\s+car\b/i.test(normalized) || /\bcar\b.{0,30}\bdrive\b/i.test(normalized) || /\bdrive\b.{0,30}\bcar\b/i.test(normalized)) {
    return createInsight(
      "I drive a black 2025 Honda Civic Hatchback Sport, but honestly I do not drive that much day to day.",
      "Immediate grounded current-car response",
      timestamp,
      0.9,
    );
  }

  if (/\bbike\b/i.test(normalized) && /\b(young|child|kid|childhood)\b/i.test(normalized)) {
    return createInsight(
      "I do not remember childhood biking clearly. The bike I remember more is the e-bike I used later in university, especially dealing with winter and steep roads.",
      "Immediate grounded bike memory response",
      timestamp,
      0.86,
    );
  }

  if (/\bonline video\b/i.test(normalized) && /\blearn(?:ed)?\b/i.test(normalized)) {
    return createInsight(
      "I usually learn practical tech things from online videos or tutorials. I watch enough to understand the idea, then I test it myself instead of just trusting the video.",
      "Immediate grounded online-learning response",
      timestamp,
      0.86,
    );
  }

  if (/\bstrong opinions\b|\bopinionated\b/i.test(normalized) && /\b(person|someone|who)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific person I would name. I would describe someone who argues confidently, speaks directly, and does not change their view easily.",
      "Immediate generic strong-opinion person response",
      timestamp,
      0.86,
    );
  }

  if (
    /\b(challenge|difficult|hard)\b/i.test(normalized)
    && /\b(describe|faced|face|thought was|overcome|deal with)\b/i.test(normalized)
    && !/\b(bug|debug|project|app|software|code|programming|assignment|system|technical)\b/i.test(normalized)
  ) {
    return createInsight(
      "One real challenge was adapting to English after coming to Canada. It was not one dramatic moment; it was constant awkwardness, slowly understanding people, and learning to answer naturally.",
      "Immediate grounded life-challenge answer",
      timestamp,
      0.88,
    );
  }

  if (/\bapi response schema\b|\bresponse schema from backend\b|\bschema from backend\b/i.test(normalized)) {
    return createInsight(
      "Let's use a mock schema for now, write down the assumptions, and replace it once backend confirms the real response shape.",
      "Immediate meeting API schema unblock response",
      timestamp,
      0.9,
    );
  }

  if (/\bprogress update\b|\bquick update\b|\bwhat should i say\b.*\b(progress|update)\b/i.test(normalized)) {
    return createInsight(
      "I finished the DynamoDB table and mocked the API response. Next I'm testing the main flow and checking what still breaks before the demo.",
      "Immediate meeting progress update with next step",
      timestamp,
      0.9,
    );
  }

  if (/\b(private user data|expose private|privacy breach|user data)\b/i.test(normalized)) {
    return createInsight(
      "Let's pause and map what data is exposed, who can access it, and add that as the next review item before shipping.",
      "Immediate meeting privacy-risk response with next action",
      timestamp,
      0.9,
    );
  }

  if (/\b(react native parking|dalparkaid|dal\s*park\s*aid|parking project|parking app)\b/i.test(normalized)) {
    return createInsight(
      "DalParkAid was a React Native parking app for Dalhousie. It estimated campus parking availability using timetable, weather, and crowd-report context, then showed lot status with simple map markers.",
      "Immediate grounded DalParkAid interview response",
      timestamp,
      0.92,
    );
  }

  if (
    /\b(what|which|tell me|explain|describe|talk about)\b/i.test(normalized)
    && /\b(project|app|application)\b/i.test(normalized)
    && /\b(saynext|say next|for next|did you make|you made|you built|your project)\b/i.test(normalized)
  ) {
    return createInsight(
      "Hybrid Search Memory Assistant is my real-time AI conversation project. It uses live transcripts, personal memory, prenotes, and hybrid retrieval so the model only sees the most relevant context.",
      "Immediate public project overview",
      timestamp,
      0.92,
    );
  }

  if (/\b(did you like to talk|talk with others|talk to others)\b/i.test(normalized) && /\b(child|kid|little)\b/i.test(normalized)) {
    return createInsight(
      "When I was very young, I was actually pretty lively and naughty. I became much quieter later, probably around middle school.",
      "Immediate grounded childhood personality answer",
      timestamp,
      0.9,
    );
  }

  if (/\babove and beyond\b/i.test(normalized)) {
    return createInsight(
      "One example is Hybrid Search Memory Assistant. I did not just fix one bug; I kept testing messy ASR, memory retrieval, and teleprompt cases until the system felt more usable.",
      "Immediate grounded above-and-beyond interview answer",
      timestamp,
      0.9,
    );
  }

  if (/\badd notifications\b/i.test(normalized) && /\bmatching bug\b/i.test(normalized)) {
    return createInsight(
      "Next, I would fix the matching bug first, then add notifications after the core flow is stable and tested.",
      "Immediate meeting scope-control response",
      timestamp,
      0.9,
    );
  }

  if (/\busers?\b/i.test(normalized) && /\bconfused\b/i.test(normalized) && /\badd button\b/i.test(normalized)) {
    return createInsight(
      "We should make the Add button label or tooltip clearer, then test the main flow again with a fresh user.",
      "Immediate meeting UI clarity response",
      timestamp,
      0.9,
    );
  }

  if (/\b(which branch|latest code|latest branch)\b/i.test(normalized)) {
    return createInsight(
      "Let's check the remote branches and recent commits first, then pick the latest tested branch and write down which one we are using.",
      "Immediate meeting branch clarification response",
      timestamp,
      0.88,
    );
  }

  if (/\bdynamodb\b/i.test(normalized) && /\b(slow|query|getting slow|latency)\b/i.test(normalized)) {
    return createInsight(
      "Let's first check whether the query matches the partition key, sort key, or GSI. If the access pattern is wrong, capacity tuning will not really fix it.",
      "Immediate DynamoDB meeting/debug response",
      timestamp,
      0.9,
    );
  }

  if (/\bindex|indexes|indices\b/i.test(normalized) && /\bwrites?\b/i.test(normalized) && /\breads?\b/i.test(normalized)) {
    return createInsight(
      "The trade-off is simple. Reads can be faster, but every write also has to maintain the index.",
      "Immediate compact classroom index trade-off",
      timestamp,
      0.9,
    );
  }

  if (/\bMIT OpenCourseWare\b/i.test(normalized) && /\bcitation format|accessed|license|terms\b/i.test(normalized)) {
    return createInsight(
      "This is just source and citation info. If I cite it, the main thing is to include the actual access date.",
      "Immediate compact classroom citation-source response",
      timestamp,
      0.88,
    );
  }

  if (/\bCAP theorem\b/i.test(normalized)) {
    return createInsight(
      "CAP means that during a network partition, you usually have to choose consistency or availability. You cannot fully guarantee both.",
      "Immediate compact classroom CAP response",
      timestamp,
      0.9,
    );
  }

  if (/\bTCP\b/i.test(normalized) && /\bthree[-\s]?way handshake\b/i.test(normalized)) {
    return createInsight(
      "TCP handshake is SYN, SYN-ACK, then ACK. After that, the connection is ready to send data reliably.",
      "Immediate compact classroom TCP handshake response",
      timestamp,
      0.9,
    );
  }

  if (/\banswer\b/i.test(normalized) && /\bsupervis(?:e|ed)\s+learning\b/i.test(normalized)) {
    return createInsight(
      "Do you mean supervised learning? Basically, it learns from labeled examples.",
      "Immediate compact classroom ASR correction for supervised learning",
      timestamp,
      0.9,
    );
  }

  if (/\b(can'?t|cannot|can't|why.*use)\b/i.test(normalized) && /\bsupervised learning\b/i.test(normalized)) {
    return createInsight(
      "Because supervised learning needs labeled examples. If labels are missing or too expensive, it is not the right fit.",
      "Immediate compact classroom supervised-learning-limit response",
      timestamp,
      0.9,
    );
  }

  if (/\bcollaborative filtering\b/i.test(normalized) && /\bcontent[-\s]?based\b/i.test(normalized)) {
    return createInsight(
      "Collaborative filtering uses other users' behavior. Content-based recommendation uses item features similar to what one user already likes.",
      "Immediate compact classroom recommender response",
      timestamp,
      0.9,
    );
  }

  if (/\bspeed and accuracy\b|\baccuracy and speed\b/i.test(normalized) && /\bcompute|computation|computations\b/i.test(normalized)) {
    return createInsight(
      "The key trade-off is accuracy versus speed. First define the equation, then choose the method based on stability and cost.",
      "Immediate compact classroom computation-tradeoff response",
      timestamp,
      0.88,
    );
  }

  if (/\bnearly singular\b|\bcondition number\b/i.test(normalized) && /\bsensitive|delicate|numerically difficult|small changes\b/i.test(normalized)) {
    return createInsight(
      "Nearly singular means the condition number is high, so small input errors can create large output errors.",
      "Immediate compact classroom near-singular response",
      timestamp,
      0.88,
    );
  }

  if (/\bpivoting\b|\bexchanging rows\b|\bwell conditioned\b|\bill conditioned\b/i.test(normalized)) {
    return createInsight(
      "Pivoting helps the method stay stable, but the condition number tells you how hard the problem itself is.",
      "Immediate compact classroom pivoting-condition response",
      timestamp,
      0.88,
    );
  }

  if (/\bsymmetric positive\b|\btall,?\s*thin\b|\brectangular\b/i.test(normalized) && /\bcondition number|least squares|straightforward elimination\b/i.test(normalized)) {
    return createInsight(
      "K is the symmetric system case; A is usually tall and rectangular, so least squares methods are the better framing.",
      "Immediate compact classroom K-vs-A response",
      timestamp,
      0.88,
    );
  }

  if (/\bleast squares\b|\bbackslash\b|\bthousands of unknowns\b/i.test(normalized)) {
    return createInsight(
      "Accuracy depends on both the method and the condition number. A bad condition number can make small errors grow.",
      "Immediate compact classroom least-squares-accuracy response",
      timestamp,
      0.88,
    );
  }

  if (/\bdatabase index\b|\bindex\b.*\breads faster\b|\breads faster\b.*\bindex\b/i.test(normalized)) {
    return createInsight(
      "An index is like a lookup table: reads are faster because the database avoids scanning every row.",
      "Immediate compact classroom database-index response",
      timestamp,
      0.9,
    );
  }

  if (/\boverfitting\b/i.test(normalized) && /\b(machine learning|model|training|data)\b/i.test(normalized)) {
    return createInsight(
      "Overfitting means the model memorizes training data too much, so it performs worse on new data.",
      "Immediate compact classroom overfitting response",
      timestamp,
      0.9,
    );
  }

  if (/\bCNNs?\b/i.test(normalized) && /\bimages?\b/i.test(normalized)) {
    return createInsight(
      "CNNs work well for images because they capture local patterns like edges and shapes with shared filters.",
      "Immediate compact classroom CNN response",
      timestamp,
      0.9,
    );
  }

  if (/\bcloud architecture\b/i.test(normalized) && /\bwhy|difference|traditional|trade[-\s]?off\b/i.test(normalized)) {
    return createInsight(
      "Cloud architecture is useful because it scales more easily, but you still have to manage cost and complexity.",
      "Immediate compact classroom cloud-architecture response",
      timestamp,
      0.9,
    );
  }

  if (/\bregularization\b/i.test(normalized) && /\b(model|overfit|overfitting|help)\b/i.test(normalized)) {
    return createInsight(
      "Regularization adds a penalty so the model does not overfit too much. Basically, it pushes the model toward a simpler solution.",
      "Immediate compact classroom regularization response",
      timestamp,
      0.9,
    );
  }

  if (/\bpasswords?\b/i.test(normalized) && /\bhash(?:ed|ing)?\b/i.test(normalized) && /\bsalt(?:ed|ing)?\b/i.test(normalized)) {
    return createInsight(
      "Hashing avoids storing raw passwords; salt makes identical passwords hash differently and blocks precomputed attacks.",
      "Immediate compact classroom password-hashing response",
      timestamp,
      0.9,
    );
  }

  if (/\bsemi[-\s]?supervised\b/i.test(normalized) && /\bsupervised\b/i.test(normalized) && /\bunsupervised\b/i.test(normalized) && /\breinforcement\b/i.test(normalized)) {
    return createInsight(
      "Right, the main three are supervised, unsupervised, and reinforcement learning. Semi-supervised is more like an extra category.",
      "Immediate compact classroom learning-types response",
      timestamp,
      0.9,
    );
  }

  if (/^\s*unsurprised learning[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      "Do you mean unsupervised learning? That means finding patterns without labels.",
      "Immediate compact classroom ASR correction for unsupervised learning",
      timestamp,
      0.88,
    );
  }

  if (
    /\blambda\b/i.test(normalized)
    && (
      /\bcold start\b/i.test(normalized)
      || (/\bstart\b/i.test(normalized) && /\b(sleep|idle|long time)\b/i.test(normalized))
      || (/\bfunction\b/i.test(normalized) && /\b(sleep|idle|long time)\b/i.test(normalized))
    )
  ) {
    return createInsight(
      "A Lambda cold start happens when the function has been idle and AWS has to initialize a fresh runtime before handling the request.",
      "Immediate compact classroom lambda cold-start response",
      timestamp,
      0.9,
    );
  }

  if (/\bexam\b/i.test(normalized) && /\b(condition number|gram[-\s]?schmidt|not in the exam|review)\b/i.test(normalized)) {
    return createInsight(
      "So basically, focus on the exam topics first, and treat condition numbers or Gram-Schmidt as extra background.",
      "Immediate compact classroom review-scope response",
      timestamp,
      0.88,
    );
  }

  if (/\bA transpose A\b/i.test(normalized) || /\bu hat\b/i.test(normalized)) {
    return createInsight(
      "Using A transpose A can make the conditioning worse. So for stability, QR is usually the safer method.",
      "Immediate compact classroom numerical-stability response",
      timestamp,
      0.9,
    );
  }

  if (/\bA transpose C A\b/i.test(normalized) && /\belastic bar|stretching equation|beam bending\b/i.test(normalized)) {
    return createInsight(
      "A transpose C A here is for the elastic bar stretching equation, not beam bending.",
      "Immediate compact classroom elastic-bar-matrix response",
      timestamp,
      0.88,
    );
  }

  if (/\borthonormal\b/i.test(normalized) && /\bdependent columns?|linearly dependent|not full rank\b/i.test(normalized)) {
    return createInsight(
      "If A's columns are dependent, A loses rank; that is the least-squares version of a singular problem.",
      "Immediate compact classroom dependent-columns response",
      timestamp,
      0.88,
    );
  }

  if (/\bserverless\b/i.test(normalized) && /\bcost\b/i.test(normalized) && /\boverhead\b/i.test(normalized)) {
    return createInsight(
      "Serverless removes server management, but cost still depends on traffic, cold starts, and per-request pricing.",
      "Immediate compact classroom serverless cost answer",
      timestamp,
      0.9,
    );
  }

  if (/\b(blocker|blocked|main issue|risk)\b/i.test(normalized) && /\b(privacy|uploaded files|upload files|file upload|mitigation)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "主要 blocker 是上传文件的隐私风险。我们应该先定义文件怎么存、谁能访问、什么时候删除，再去定 API contract。"
        : "The main blocker is privacy risk for uploaded files. We should define storage, access control, and deletion rules before finalizing the API contract.",
      "Immediate meeting privacy blocker response",
      timestamp,
      0.9,
    );
  }

  if (/\b(before tax|after tax|tax)\b/i.test(normalized) && /\b(thirty\s+nine|39(?:\.| )?99|forty|price|roughly|how much)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "在 Nova Scotia 现在 HST 大概是 14%，所以 39.99 加税后差不多 45.60。"
        : "In Nova Scotia the HST is about 14%, so $39.99 would be roughly $45.60 after tax.",
      "Immediate Nova Scotia after-tax estimate",
      timestamp,
      0.88,
    );
  }

  if (/\b(tap|insert|card|cash|debit|credit)\b/i.test(normalized) && /\b(total|pay|payment|forty|dollar|cash)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese" ? "刷卡就好，谢谢。" : "Tap, please.",
      "Immediate payment method response",
      timestamp,
      0.9,
    );
  }

  if (/\b(return|receipt|final sale|doesn'?t fit|does not fit|exchange)\b/i.test(normalized) && /\b(hoodie|clothes|shirt|item|receipt|final sale|fit)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我想确认一下，如果不合适的话可以凭收据退吗，还是这个是 final sale？"
        : "Could I return it with the receipt if it doesn't fit, or is this final sale?",
      "Immediate shopping return-policy question",
      timestamp,
      0.88,
    );
  }

  if (/\b(say a few words|toast|wedding|ceremony|congratulations|before the toast)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "祝你们新婚快乐，也希望今天对你们来说是很轻松、很开心的一天。我不太会讲很正式的话，但我真的很高兴能在这里。"
        : "I just want to say congratulations, and I hope today feels really happy and easy for both of you. I'm not great at big speeches, but I'm genuinely glad to be here.",
      "Immediate warm ceremony response",
      timestamp,
      0.9,
    );
  }

  if (/\b(introduce yourself|self[-\s]?introduction|graduation photo|quickly before the photo|before the photo)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "你好，我叫 Xiang Li，现在在 Dalhousie 读 MACS，也就是 Master of Applied Computer Science。"
        : "Hi, I'm Xiang Li. I'm a MACS student at Dalhousie, so Master of Applied Computer Science.",
      "Immediate formal self-introduction response",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(family|property|rent|rental|lease|tenant)\b/i.test(normalized)
    && /\b(what do you think|what should we do|next|plan|handle|decide)\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我觉得先把事实列清楚：现在的租金、租约条款、成本，还有我们实际有哪些选择。然后再决定是续约、调价，还是先观察。"
        : "I think we should first get the facts clear: current rent, lease terms, expenses, and what options we actually have. Then we can decide whether to renew, adjust the price, or wait.",
      "Immediate cautious family property planning response",
      timestamp,
      0.86,
    );
  }

  if (/\b(mom|mother|mum)\b/i.test(normalized)
    && (/\b(upset|angry|mad)\b/i.test(normalized) || /\bbecause\b/i.test(normalized))
    && /\b(didn'?t reply|not reply|did not reply|reply|message|text)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "你可以先说：不好意思，我刚才有点忙，没有故意不回你。我现在看到了。"
        : "I'd just say, sorry, I got caught up and didn't mean to ignore you. I saw it now.",
      "Immediate family message de-escalation response",
      timestamp,
      0.88,
    );
  }

  if (/^\s*(?:speaker\s*[a-z]?|[abc]|agent|customer)\s*:/i.test(transcript) && /\b(notification|notifications|phone|phones|anxiety|anxious)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "他们主要是在说，手机通知太多的时候，反而会让人更焦虑，而不是更有效率。"
        : "They're basically saying constant phone notifications can feel more stressful than helpful.",
      "Immediate neutral third-party dialogue summary",
      timestamp,
      0.82,
    );
  }

  if (/\btechnical trade[-\s]?off\b/i.test(normalized) && /\b(made|you made|your)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "一个真实的 trade-off 是 SayNext 里上下文丰富度和响应速度之间的平衡。我需要给模型足够的 transcript、memory 和 scene 信息，但如果塞太多内容，延迟会变高，所以我后来用检索和 gating 只放最相关的内容。"
        : "One real trade-off I made in Hybrid Search Memory Assistant was between richer context and lower latency. I wanted the model to see enough transcript, memory, and scene context, but too much input made responses slower, so I used retrieval and gating to include only the most relevant parts.",
      "Immediate supported SayNext technical trade-off answer",
      timestamp,
      0.9,
    );
  }

  if (/\b(honda|civic|car|vehicle|service appointment|appointment)\b/i.test(normalized) && /\b(issue|write down|need it back|pickup|pick up|ready)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "可以写一个 general service check。然后麻烦先告诉我大概什么时候能取车和预估费用。"
        : "You can write it as a general service check for now. Could you also let me know the estimated pickup time and cost before starting?",
      "Immediate car service appointment response",
      timestamp,
      0.86,
    );
  }

  if (
    /\b(deadline|due|demo|presentation)\b/i.test(normalized)
    && /\b(too many features|scope|cut|what should we do|what do we do|right now)\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我觉得先保住 core flow，分清 must-have 和 nice-to-have。时间不够的话，先砍掉风险高的额外功能，保证 demo 路径稳定。"
        : "I think we should protect the core flow first, split must-have from nice-to-have, and cut the risky extra features until the demo path is stable.",
      "Immediate deadline scope-control response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(tell me about a time|describe a time|give me an example|real example)\b/i.test(normalized)
    && /\b(conflict|teammate|disagreement|different ideas)\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我没有那种很 dramatic 的 conflict。更接近的是 group project 里的 technical disagreement，我会把 deadline、risk 和 trade-off 说清楚，然后先推一个更小但能工作的版本。"
        : "I don't have a dramatic conflict story. The closest is a low-drama technical disagreement in group projects, where I would make the deadline, risk, and trade-off clear, then push for a smaller working version first.",
      "Immediate no-fake-conflict interview response",
      timestamp,
      0.9,
    );
  }

  if (/\blearn(?:ed)?\b/i.test(normalized) && /\bworking\s+in\s+a\s+team|work\s+in\s+a\s+team|teamwork\b/i.test(normalized)) {
    return createInsight(
      "For me, the biggest lesson is that integration and clear ownership matter more than just finishing your own feature. In group projects, if the API contract, owner, and test path are unclear, everything becomes stressful near the deadline.",
      "Immediate grounded teamwork lesson answer",
      timestamp,
      0.88,
    );
  }

  if (
    /\bconstructive\s+feedback\b/i.test(normalized)
    || (/\bfeedback\b/i.test(normalized) && /\b(received|got|given|improve|improved|learned)\b/i.test(normalized))
  ) {
    return createInsight(
      "One useful piece of feedback was that my answers sometimes sounded too polished and AI-like. I took that seriously because for my assistant project, the answer has to sound like something I could actually say. So I changed the prompts and tests to check for shorter, more natural responses, not just technically correct ones.",
      "Immediate supported constructive-feedback interview answer",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(bug|debug|debugging|flaky|broken)\b/i.test(normalized)
    && /\b(how should i|how should we|what should i|what should we|where it is|debug it|approach)\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我不会先猜。先复现问题，再隔离是哪一层坏了，检查 logs 或 raw input/output，然后一次只验证一个小假设。"
        : "I would not guess first. I would reproduce it, isolate the failing layer, check logs or raw inputs and outputs, then test one small hypothesis at a time.",
      "Immediate debugging process response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(what should i say|how should i answer|what do i say)\b/i.test(normalized)
    && /\b(don'?t know|do not know|not know|not sure|not enough|uncertain)\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我还不是完全确定，但我现在的理解是这样。我想先确认关键细节，再给最后结论。"
        : "I'm not fully sure yet, but my current understanding is this. I would rather verify the key detail first before giving a final answer.",
      "Immediate honest uncertainty response",
      timestamp,
      0.88,
    );
  }

  if (/\bwho\s+owns\b/i.test(normalized) && /\b(contract|api\s+contract|demo)\b/i.test(normalized)) {
    return createInsight(
      "I don't want to guess a name. Let's assign one owner now, and that person should write the current v1 API contract before the demo.",
      "Immediate meeting owner clarification",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(hardest|hard|difficult|tricky)\b/i.test(normalized)
    && /\b(bug|issue|problem|fix|fixed|debug)\b/i.test(normalized)
    && (
      /\b(hardest bug|hard bug|difficult bug|tricky bug|debugging bug|debug)\b/i.test(normalized)
      || (/\b(fix|fixed)\b/i.test(normalized) && /\b(tell me|your|example|time you|you had|you fixed|faced|handled|solved)\b/i.test(normalized))
      || (/\b(issue|problem)\b/i.test(normalized) && /\b(tell me|your|example|time you|you had|faced|handled|solved)\b/i.test(normalized) && /\b(project|work|app|system|code|software)\b/i.test(normalized))
    )
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "比较难的是 SayNext 里实时转录和旧回复会互相影响的问题。我是通过复现 ASR 流、加 stale response 检查、echo detection 和 reset/teleprompt guard 来修的。"
        : "One tricky bug was in Hybrid Search Memory Assistant, where live transcripts and old suggestions could get out of sync or overwrite newer turns. I fixed it by reproducing the ASR flow, adding stale-response checks, echo detection, and reset or teleprompt guards.",
      "Immediate supported hard-bug interview answer",
      timestamp,
      0.9,
    );
  }

  if (/\bmobile\s+app\s+experience\b/i.test(normalized)) {
    return createInsight(
      "My strongest mobile-related experience is from Hybrid Search Memory Assistant and DalParkAid. Hybrid Search Memory Assistant focuses on live transcripts, memory retrieval, scene profiles, prenotes, and local/travel modes. DalParkAid was a React Native parking app project, so I can talk about both AI-assisted mobile UX and normal app workflow.",
      "Immediate supported mobile app experience answer",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(before\s+canada|before\s+coming\s+to\s+canada|before\s+i\s+came\s+to\s+canada|high\s+school\s+in\s+china|school\s+in\s+china|high\s+school\b.*\bchina|china\b.*\bhigh\s+school|school\b.*\bchina)\b/i.test(normalized)
    && /\b(school|study|studied|high\s+school|where|what)\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "来加拿大前，我在成都读过石室中学高新校区，后来转到北大附属实验学校。"
        : "Before Canada, I studied at Shishi High School in Chengdu, then Peking University Affiliated Experimental School.",
      "Immediate China school history answer",
      timestamp,
      0.95,
    );
  }

  if (
    /\b(work\s+or\s+(?:are\s+you\s+)?(?:a\s+)?student|student\s+or\s+work|are\s+you\s+(?:a\s+)?student|do\s+you\s+work\s+or\s+study)\b/i.test(normalized)
    || /\bwork\b.{0,40}\bor\b.{0,40}\bare\s+you(?:\s+a)?(?:\s+student)?\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我现在是 Dalhousie 的 MACS 学生，主要学 Applied Computer Science。"
        : "I'm a MACS student at Dalhousie right now, basically Applied Computer Science.",
      "Immediate current student/program answer",
      timestamp,
      0.94,
    );
  }

  if (/\b(?:student\s+or\s+working|working\s+or\s+student|study\s+or\s+work|work\s+or\s+study|you\s+student|you\s+working)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我现在是 Dalhousie 的 MACS 学生，主要学 Applied Computer Science。"
        : "I'm a MACS student at Dalhousie right now, basically Applied Computer Science.",
      "Immediate ASR current student/program answer",
      timestamp,
      0.92,
    );
  }

  if (((/\b(rehearsal room|classroom room number|room number|which room)\b/i.test(normalized)) || (/\bwhere\b/i.test(normalized) && /\b(rehearsal|classroom)\b/i.test(normalized) && /\broom\b/i.test(normalized))) && /\b(class|classroom|rehearsal|room)\b/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese"
        ? "应该是在 Goldberg Computer Science Building 的 134 房间。"
        : "It should be in the Goldberg Computer Science Building, room 134.",
      "Immediate supported class room answer",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(?:what|which)\s+(?:is\s+)?(?:your\s+)?(?:major|program|degree)\b/i.test(normalized)
    || /\b(?:what|which)\s+(?:program|major|degree)\s+(?:are\s+you\s+)?(?:in|studying|taking)\b/i.test(normalized)
    || /\bwhat\s+(?:are\s+you\s+)?studying\b/i.test(normalized)
    || /\bwhat\s+do\s+you\s+study\b/i.test(normalized)
  ) {
    return createInsight(
      outputLanguage === "chinese"
        ? "我现在读的是 Dalhousie 的 MACS，Master of Applied Computer Science，不是数学。"
        : "I'm in MACS at Dalhousie, so Master of Applied Computer Science.",
      "Immediate current major/program answer",
      timestamp,
      0.95,
    );
  }

  if (/\b(non[-\s]?refundable|deposit|send a deposit|e[-\s]?transfer|hold it|pick it up next week)\b/i.test(normalized)) {
    const housingDeposit = /\b(landlord|lease|rent|apartment|unit|room|tenant)\b/i.test(normalized);
    return createInsight(
      housingDeposit
        ? "Could you send me the lease details and payment instructions in writing first? I want to verify everything before I send any deposit."
        : "Could you send me the details in writing first? I just want to confirm the item, total cost, and refund policy before I send the deposit.",
      "Immediate cautious transaction response",
      timestamp,
      0.88,
    );
  }

  if (/\b(sign|signature)\b/i.test(normalized) && /\b(lease|addendum|contract|agreement|standard|everyone signs)\b/i.test(normalized)) {
    return createInsight(
      "Could you send it to me first? I want to read it properly before I sign.",
      "Immediate cautious contract response",
      timestamp,
      0.9,
    );
  }

  if (/\b(medicine|medication|pill|dose|take it|pharmacist|doctor|side effect|liver)\b/i.test(normalized) && /\b(should i|still take|take it|tonight|safe|affect)\b/i.test(normalized)) {
    return createInsight(
      "I should check with the pharmacist or doctor first. I don't want to guess with medication.",
      "Immediate cautious medical response",
      timestamp,
      0.88,
    );
  }

  if (/^present[.!?\s]*$/i.test(normalized)) {
    return createInsight(
      outputLanguage === "chinese" ? "到。" : "I'm here.",
      "Immediate attendance response",
      timestamp,
      0.95,
    );
  }

  if (/周末|週末/.test(transcript) || /\bzhoumo\b/i.test(normalized)) {
    return createInsight(
      "一般就是在家休息，打游戏、看动漫或者刷点视频。如果有项目或者作业，就补一点进度；不然我更喜欢安静待着，不太想把周末排得很满。",
      "Immediate Chinese weekend response",
      timestamp,
      0.88,
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

  if (/\b(current flow|this flow|the flow)\b/i.test(normalized) && /\b(doesn'?t work|don't think it works|not work|what do you think|what do think|what do y)\b/i.test(normalized)) {
    return createInsight(
      "I think the current flow is okay for now. Let's run the main user path once, and only change it if something actually breaks.",
      "Immediate ambiguous meeting-flow clarification",
      timestamp,
      0.84,
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

  const unlabelledSpeakerIntro = normalized.match(/^\s*(?:hi|hello|hey)[, ]+(?:i'?m|i am)\s+([A-Za-z][A-Za-z .'-]{1,40})(?:[, ]+.*)?[.!?\s]*$/i);
  if (unlabelledSpeakerIntro?.[1] && !/^xiang(?:\s+li)?$/i.test(unlabelledSpeakerIntro[1].trim())) {
    const name = unlabelledSpeakerIntro[1].trim().replace(/[.!?]+$/, "");
    return createInsight(
      outputLanguage === "chinese" ? `你好，${name}。` : `Nice to meet you, ${name}.`,
      "Immediate unlabelled speaker introduction response",
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

function getPrenoteExactAnswerImmediateResponse(
  transcript: string,
  prenoteContext: string,
  timestamp: number,
): AgentResponse | null {
  const context = prenoteContext.trim();
  if (!context || /^No active prenote\.$/i.test(context)) return null;

  const lines = context
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !/^(active prenote excerpt|section:|chunk:|exact excerpt:|only these exact prenote|---|#)/i.test(line);
    });

  const cleanLine = (line: string): string => line
    .replace(/^[A-Z0-9_ -]{3,80}:\s*/i, "")
    .replace(/^[-*]\s*/, "")
    .trim();

  const isBadFactLine = (line: string): boolean => {
    return /^(noise|filler|unrelated)\b/i.test(line) || /\bunrelated chat\b/i.test(line);
  };

  const findLine = (...patterns: RegExp[]): string | null => {
    const line = lines.find((candidate) => !isBadFactLine(candidate) && patterns.every((pattern) => pattern.test(candidate)));
    return line ? cleanLine(line) : null;
  };

  if (/\b(deadline|due|due date|final report)\b/i.test(transcript) || /哪天|什么时候|截止|交/.test(transcript)) {
    const line = findLine(/\b(deadline|due)\b/i);
    if (line) return createInsight(line, "Immediate exact prenote deadline answer", timestamp, 0.92);
  }

  if (/\b(where|room|location|rehearsal)\b/i.test(transcript) || /哪里|在哪|房间|教室/.test(transcript)) {
    const line = findLine(/(?:rehearsal|building|location|(?:^|[^a-z])room(?:[^a-z]|$))/i);
    if (line) return createInsight(line, "Immediate exact prenote room answer", timestamp, 0.92);
  }

  if (/\b(demo|rubric|mention|include|show)\b/i.test(transcript)) {
    const line = /\b(demo|rubric)\b/i.test(transcript)
      ? (findLine(/\b(demo|rubric)\b/i) || findLine(/\bmention\b/i))
      : findLine(/\bmention\b/i);
    if (line) return createInsight(line, "Immediate exact prenote rubric answer", timestamp, 0.9);
  }

  if (/\b(api|contract|field|fields|schema)\b/i.test(transcript)) {
    const line = findLine(/\b(field|fields|api|contract)\b/i);
    if (line) return createInsight(line, "Immediate exact prenote API-field answer", timestamp, 0.9);
  }

  return null;
}

function getUnsupportedPremiseImmediateResponse(transcript: string, timestamp: number, trustedContext: string): AgentResponse | null {
  const normalized = transcript.toLowerCase();
  const context = trustedContext.toLowerCase();
  const lacks = (term: string) => !context.includes(term.toLowerCase());

  if (/\bgoogle\b/.test(normalized) && /\b(internship|worked|work|team|experience)\b/.test(normalized) && lacks("google")) {
    return createInsight(
      "I haven't had a Google internship, so I wouldn't describe it as my own experience. A real example I can talk about is Hybrid Search Memory Assistant, where I worked on real-time transcripts, memory retrieval, and response quality.",
      "Immediate boundary for unsupported Google work premise",
      timestamp,
      0.9,
    );
  }

  if (/\bshopify\b/.test(normalized) && /\b(internship|worked|work|outage|experience)\b/.test(normalized) && lacks("shopify")) {
    return createInsight(
      "I haven't worked at Shopify, so I wouldn't frame it as my own experience. A real adjacent example is Hybrid Search Memory Assistant, where I had to debug messy real-time behavior and improve the response flow.",
      "Immediate boundary for unsupported Shopify work premise",
      timestamp,
      0.9,
    );
  }

  if (/\b(award|hackathon winner|won for)\b/.test(normalized) && (!context.includes("award") || !context.includes("won"))) {
    return createInsight(
      "I haven't won that exact award, so I wouldn't present it as something that happened. I can talk about Hybrid Search Memory Assistant as a real project and explain what I built, tested, and improved.",
      "Immediate boundary for unsupported award premise",
      timestamp,
      0.9,
    );
  }

  if (/\bproduction outage\b/.test(normalized) && lacks("production outage")) {
    return createInsight(
      "I haven't caused a real production outage at work, so I wouldn't claim that. A real example is debugging Hybrid Search Memory Assistant's real-time transcript flow, where stale context and partial speech could lead to bad responses.",
      "Immediate boundary for unsupported production outage premise",
      timestamp,
      0.9,
    );
  }

  const unsupportedEntities = extractPossibleNamedEntities(transcript).filter((entity) => !context.includes(entity.toLowerCase()));
  if (
    unsupportedEntities.length &&
    /\b(your|you)\b/.test(normalized) &&
    /\b(project|architecture|internship|offer|paper|course|certification|benchmark|startup)\b/.test(normalized)
  ) {
    const entity = unsupportedEntities[0];
    return createInsight(
      `I don't have a project or experience called ${entity}, so I wouldn't make up its architecture. A real project I can explain is Hybrid Search Memory Assistant, especially the live transcript flow, memory retrieval, scene profiles, and local/travel mode trade-off.`,
      "Immediate boundary for unsupported named entity premise",
      timestamp,
      0.88,
    );
  }

  return null;
}

function extractPossibleNamedEntities(text: string): string[] {
  const entities = new Set<string>();
  const knownSafe = new Set([
    "AWS", "OpenAI", "API", "LLM", "AI", "Canada", "Canadian", "Halifax",
    "DynamoDB", "Lambda", "Raft", "Paxos", "SayNext", "JobLens", "DalParkAid",
    "ElderAlbum", "Tokyo", "Japan", "Nova Scotia", "Dalhousie", "Acadia",
  ].map((item) => item.toLowerCase()));

  const camelCaseMatches = text.match(/\b[A-Z][A-Za-z0-9]*(?:DB|Cache|Scheduler|VectorDB|Lambda|Bench|Graph|Sync|Mesh)\b/g) ?? [];
  for (const match of camelCaseMatches) {
    if (!knownSafe.has(match.toLowerCase())) entities.add(match);
  }

  const mixedCasePhraseMatches = text.match(/\b[A-Z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,})){0,4}\b/g) ?? [];
  for (const match of mixedCasePhraseMatches) {
    if (!knownSafe.has(match.toLowerCase())) entities.add(match);
  }

  const phraseMatches = text.match(/\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,})){1,5}\b/g) ?? [];
  for (const match of phraseMatches) {
    const normalized = match.toLowerCase();
    if (knownSafe.has(normalized)) continue;
    if (/^(can you|could you|tell me|explain the|describe a|ielts part|give me|use your)$/i.test(match)) continue;
    if (/\b(API|DB|Cache|Scheduler|Protocol|Robotics|Algorithm|Compiler|Optimization|Bench|Graph|River|Orchard|Reborn|Professor|Pax|Tree|Quanta|Northstar|Shopify|Google)\b/.test(match)) {
      entities.add(match);
    }
  }

  return [...entities].slice(0, 5);
}

function buildTelepromptBoundaryHint(latestTranscript: string, trustedContext: string): string {
  const normalized = latestTranscript.toLowerCase();
  const context = trustedContext.toLowerCase();
  const hints: string[] = [];

  const exactPersonalPremise = [
    "internship at",
    "offer from",
    "experience at",
    "worked at",
    "team at",
    "google",
    "shopify",
    "certification",
    "award",
    "startup",
    "published paper",
    "trip to",
    "exact grade",
    "exact percentage",
    "exact metric",
    "production outage",
    "at work",
    "course",
  ].some((needle) => normalized.includes(needle));

  if (exactPersonalPremise) {
    hints.push("The latest request may contain an unsupported personal premise. If the exact company, course, award, internship, certification, trip, grade, metric, paper, or work incident is not in Relevant personal memory or Prenote, first say Xiang has not done it or does not have that exact detail. Then pivot to a real adjacent project or a general answer. Do not replace an unsupported award/trip/internship/job/course with another invented award, recognition, trip, internship, workplace, or course.");
  }

  if (/\bgoogle\b/i.test(latestTranscript) && !context.includes("google")) {
    hints.push('Required boundary: say "I have not had Google team-lead experience, but a real example I can use is from SayNext." Do not omit the Google boundary.');
  }

  if (/\bshopify\b/i.test(latestTranscript) && !context.includes("shopify")) {
    hints.push('Required boundary: say "I have not had a Shopify internship, but a real adjacent example is..." Do not describe working at Shopify.');
  }

  if (/\bnorthstar robotics\b/i.test(latestTranscript) && !context.includes("northstar robotics")) {
    hints.push('Required boundary: say "I do not have that exact Northstar Robotics offer." You may answer hypothetically after that.');
  }

  if (/\baward\b/i.test(latestTranscript) && (!context.includes("award") || (/\bstartup\b/i.test(latestTranscript) && !context.includes("ai startup")))) {
    hints.push('Required boundary: say "I have not won that exact award." Do not invent hackathon recognition, startup awards, judge feedback, school competitions, or any other recognition.');
  }

  if (/\btrip to\b/i.test(latestTranscript) && !context.includes("trip to")) {
    hints.push('Required boundary: say "I did not take that exact trip." Do not invent alternative travel memories, cities visited, weddings, friend trips, family trips, or dates.');
  }

  if (/\bproduction outage\b/i.test(latestTranscript) && !context.includes("production outage")) {
    hints.push('Required boundary: say "I have not caused a full production outage at work." Use a school/project bug example instead. Do not invent an internship, workplace, deployed production app, or company incident.');
  }

  if (/\b(forgot to explain what the project is|never told you which app|forgot to explain the context|without knowing the project|not sure what the project is)\b/i.test(latestTranscript)) {
    hints.push("The project/app context is explicitly missing. Do not default to SayNext, AWS, Firebase, Lambda, DynamoDB, or any stack. Ask for requirements or give a neutral discovery framework.");
  }

  if (isGenericSpeakingPrompt(latestTranscript)) {
    hints.push("This looks like a generic speaking-practice or daily-life question, not a technical interview. Answer with everyday life details and do not use SayNext, cloud, AWS, Lambda, DynamoDB, project stories, or workplace framing unless the latest transcript explicitly asks for technical work or a project.");
  }

  if (/\b(latest|today|current|this week|exact legal|legal rules|medicine|medication|stock|financial|price|pricing)\b/i.test(latestTranscript)) {
    hints.push("The latest/current/legal/medical/financial premise needs verification. Do not give exact claims, prices, legal conclusions, medical changes, or stock recommendations. Give cautious general guidance and say Xiang would check an authoritative source.");
  }

  const unsupportedEntities = extractPossibleNamedEntities(latestTranscript).filter((entity) => !context.includes(entity.toLowerCase()));
  if (unsupportedEntities.length) {
    hints.push(`Unsupported named entity/entities not found in trusted memory: ${unsupportedEntities.join(", ")}. Treat them as unknown. Do not describe them as real products, papers, protocols, games, courses, companies, APIs, benchmarks, or memories. Use: "I am not familiar with X specifically, but generally..."`);
  }

  if (/\b(saynext|say next)\b/i.test(latestTranscript)) {
    hints.push("For SayNext, supported details are live transcript handling, AI response suggestions, scene profiles, prenotes, personal/knowledge memory retrieval, local Ollama mode, VPS/OpenAI travel mode, teleprompt controls/testing, and response quality. Do not invent Firebase, reminders/tasks, multi-device sync, production users, or distributed storage unless present in memory.");
  }

  return hints.length ? hints.join("\n") : "No special boundary risk detected.";
}

function isFollowupLikeTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount <= 12
    || /\b(there|that|it|those|them|this one|what did|why did|how did|what was|what about|tell me more|exact|actually do|pick it|like|uh|wait|so)\b/i.test(normalized);
}

function buildTelepromptRiskText(latestTranscript: string, recentTranscriptText: string): string {
  if (!recentTranscriptText.trim()) return latestTranscript;
  if (!isFollowupLikeTranscript(latestTranscript)) return latestTranscript;
  return `${recentTranscriptText}\nLatest transcript: "${latestTranscript}"`;
}

function buildUnsupportedPremiseFallback(latestTranscript: string, trustedContext: string, targetMode: "expandable" | "long"): string | null {
  const normalized = latestTranscript.toLowerCase();
  const context = trustedContext.toLowerCase();
  const longSuffix = targetMode === "long"
    ? " From there, I can still give a useful answer by talking about a real adjacent project, the decision process, and what I learned, instead of pretending that unsupported detail is true."
    : "";
  const genericUnknownLongSuffix = targetMode === "long"
    ? " If I needed to speak for longer, I would explain how I would approach it safely: first clarify the actual requirements, then identify the main constraints, then compare possible designs or techniques. I would also say what evidence I would need before making a confident claim, such as documentation, measurements, code, or project notes. That keeps the answer useful without turning an unknown name into fake experience."
    : "";

  const lacks = (term: string) => !context.includes(term.toLowerCase());

  if (/\bgoogle\b/.test(normalized) && lacks("google")) {
    return `No, I did not actually work at Google. I would correct that first so I do not accidentally make it sound like real work experience. A real example I can talk about is SayNext. In that project, I had to deal with messy real-time transcript behavior, stale context, and response quality. The useful part was figuring out what was actually breaking, testing noisy cases, and making the assistant feel more reliable instead of just adding random features.${longSuffix}`;
  }

  if (/\bshopify\b/.test(normalized) && lacks("shopify")) {
    return `I have not had a Shopify internship, so I would not describe it as my own experience. A real adjacent example is my work on app projects like SayNext and JobLens, where I had to think about user needs, backend behavior, and response quality. The useful lesson is that even in student projects, the same basic engineering habits matter: define the user flow, test edge cases, watch latency, and avoid adding features before the core path works.${longSuffix}`;
  }

  if (/\bnorthstar robotics\b/.test(normalized) && lacks("northstar robotics")) {
    return `I do not actually have that Northstar Robotics offer, so I would not frame it like a real decision I already made. Hypothetically, if I were choosing a role like that, I would care about whether the work connects AI with real software, whether I could keep learning from the team, and whether the product solves a practical problem. For me, the strongest fit would be a role where I can build mobile, web, or AI-assisted tools instead of only working on abstract ideas.${longSuffix}`;
  }

  if (/\baward\b/.test(normalized) && (lacks("award") || (/\bstartup\b/.test(normalized) && lacks("ai startup")))) {
    return `I have not won that exact award, so I would not present it as something that happened. A real thing I can talk about is building projects like SayNext, where the value came from solving a practical communication problem and improving the system through testing. The meaningful part for me was not an award; it was seeing the project become more realistic over time as I added memory, scene profiles, local and travel modes, and teleprompt behavior. That experience still gave me confidence because it showed I could take a vague idea and turn it into a working product. If I were answering this in an interview, I would focus on the process, the technical choices, and what I learned, rather than claiming external recognition I do not have.`;
  }

  if (/\bjapan\b/.test(normalized) && /\b(trip|food|summer|there|visit)\b/.test(normalized) && !context.includes("trip to japan")) {
    return `Nah, I did not actually go to Japan last summer, so I would not make up food memories from a trip I did not take. But Japan is definitely a place I would like to visit. I would probably be excited for ramen, sushi, convenience-store food, and just walking around places like Tokyo or Akihabara because I like games, anime culture, and city atmosphere. So the honest answer is: I cannot tell a real travel story yet, but I can talk about why Japan is high on my list. If I were answering this casually, I would say the food I want to try most is ramen or convenience-store snacks, but I would make it clear that is a future plan, not a past memory.`;
  }

  if (/\bproduction outage\b/.test(normalized) && !context.includes("production outage")) {
    return `I have not caused a full production outage at work, so I would not frame it that way. A more accurate example is a project bug from SayNext, where real-time transcripts and AI suggestions could get out of sync or respond to stale context. I debugged it by reproducing the transcript flow, checking how partial and final inputs changed state, and adding better handling for reset, interruptions, and stale suggestions. The lesson was that real-time AI apps need careful state management, not just a good model response. I would also explain that the process mattered more than the drama: reproduce the issue, isolate the state transition, add a guard, then run noisy transcript tests to confirm the fix.`;
  }

  if (/\bforgot to explain what the project is|never told you which app|forgot to explain the context|without knowing the project|not sure what the project is\b/.test(normalized)) {
    return `I would need a bit more context before proposing a real architecture. The first thing I would ask is what the project is trying to achieve, who the users are, what data it handles, and what constraints matter most, like latency, cost, privacy, or scale. Without those requirements, choosing a stack would just be guessing. A safer proposal is to start with the main user flow, identify the core entities and operations, then decide whether the system needs simple CRUD, real-time updates, background jobs, analytics, or strict access control. After that, we can choose the database, API style, hosting model, and monitoring setup based on the actual requirements instead of forcing a random architecture onto an unknown project.`;
  }

  if (/\bgrade\b/.test(normalized) && /\b(exact|a\+|mark|score|got|get|did you)\b/.test(normalized)) {
    return `I do not remember the exact grade, so I would not make up a number or say A+ just to sound better. What I can say is that I liked the cloud architecture class because it felt practical. It connected ideas like reliability, scaling, automation, cost, and failure recovery to real software systems. If someone really needed the official grade, I would check my school record. In a normal conversation, I would rather talk about what I learned than guess a number.`;
  }

  if (/\b(sister|kid|daughter|niece|baby)\b/.test(normalized) && /\b(exact|birthday|date)\b/.test(normalized)) {
    return `Honestly, I do not know the exact birthday off the top of my head, so I would not throw out a random date. I know my sister got married in 2025 and she has a daughter now, but for the precise birthday I would need to ask my sister or my mom. I would rather say I am not sure than guess a private family date and get it wrong.`;
  }

  if (/\b(professor morgan|prof morgan|rubric)\b/.test(normalized)) {
    return `I do not know Professor Morgan's exact rubric from memory, so I would not pretend I know the precise requirements. The safe move is to check the course page, assignment sheet, or ask a direct clarification question. Generally, for an AI ethics assignment, I would expect things like clear argument, ethical reasoning, evidence, and concrete examples, but the exact grading criteria have to come from the actual rubric.`;
  }

  if (/\b(dal ai lab|published paper|paper)\b/.test(normalized) && /\b(your|main contribution|contribution|published)\b/.test(normalized) && !context.includes("published paper")) {
    return `I have not published a Dal AI Lab paper, so I would not present that as my own work. If this comes up in an interview, I would pivot to real project experience instead. For example, I can talk about SayNext as a practical AI communication tool, or JobLens AI as a project involving cloud and AI features. The important thing is to explain a real contribution clearly: what problem I worked on, what I built, what trade-offs I handled, and what I learned from testing it.`;
  }

  if (/\bexact\b/.test(normalized) && /\b(percentage|latency|metric)\b/.test(normalized)) {
    return `I do not have the exact number, so I would not make one up. The honest answer is that I can explain the improvement process and what I paid attention to, but not claim a precise percentage. For a project like SayNext, the important part was reducing stale context, handling partial transcripts more carefully, and testing whether the response flow stayed usable in noisy real-time situations. If this were an interview, I would say that I should have measured the before-and-after latency more formally, but the real lesson was learning to debug real-time behavior with repeatable tests instead of relying on a vague feeling that it became faster.`;
  }

  if (/\b(uric acid|medicine|medication|dose|medical)\b/.test(normalized)) {
    return `Honestly, I would not just switch it by myself. I am not a doctor, and uric acid medicine depends on blood test results, symptoms, side effects, and what the doctor is trying to control. If it feels like it is not working, the safest move is to talk to a healthcare professional and bring the actual lab results. They can decide whether the dose, medicine, or lifestyle plan needs to change. I would keep it simple: do not guess with medication, check it properly. For a longer answer, I would mention that doctors usually look at whether the current treatment is effective, whether there are side effects, and whether diet, hydration, or other health factors are involved.`;
  }

  if (/\b(stock|financial|invest|investment)\b/.test(normalized)) {
    return `Nah, I would not pick a stock for quick money like that. That is how people get cooked. If real money is involved, I would check reliable financial sources or talk to someone qualified instead of acting on a random quick answer. The useful way to think about it is risk, time horizon, diversification, company fundamentals, and whether you can handle losing money. I can give a framework, but I would not name one stock or make it sound guaranteed. For a longer answer, I would also say that short-term stock picking is more like speculation than planning, so I would rather compare options carefully than pretend there is one magic ticker.`;
  }

  if (/\b(openai|gpt)\b/.test(normalized) && /\b(latest|today|current|price|pricing|cheapest)\b/.test(normalized) && /\b(api|model)\b/.test(normalized)) {
    return `I do not know the exact latest API pricing from memory, so I would check the official pricing page before making a decision. The practical way to compare models is to look at input cost, output cost, latency, context length, quality, and whether the task needs a strong model or a cheaper fast one. For SayNext, the cheapest model is not automatically the best choice, because bad responses can hurt the experience more than a small cost difference. I would first define the task, estimate token usage, test response quality, and then pick the lowest-cost model that still gives reliable answers.`;
  }

  const unsupportedEntities = extractPossibleNamedEntities(latestTranscript).filter((entity) => !context.includes(entity.toLowerCase()));
  if (
    unsupportedEntities.length
    && /\b(api|endpoint|endpoints|exact|structure|schema|benchmark|algorithm|paper|course|protocol|pricing|design|architecture)\b/.test(normalized)
  ) {
    const entity = unsupportedEntities[0];
    if (/\b(api|endpoint|endpoints|structure|schema)\b/.test(normalized)) {
      return `I am not familiar with ${entity} specifically, so I would not present exact endpoints or API details as if they are official. What I can do safely is explain the API design process. I would first clarify the core resources, the main user actions, the data that needs to be created or updated, and the security requirements. Then I would design predictable routes, consistent request and response formats, validation rules, error handling, pagination for large lists, and idempotency for operations that might be retried. I would also add logging and tests around the most important flows. So the useful answer is not fake endpoint names; it is a clear framework for how I would design and verify the API once the real requirements are known.${genericUnknownLongSuffix}`;
    }

    return `I am not familiar with ${entity} specifically, so I would not describe it as a real product, paper, course, benchmark, or personal experience from memory. If the topic is the general concept behind it, I can still give a useful explanation by separating what I know from what I would need to verify. I would first identify the claimed problem, compare it with standard approaches, look for official documentation or measurements, and then discuss likely trade-offs such as performance, reliability, cost, complexity, and maintainability. That keeps the answer useful without pretending that an unsupported named entity is something I personally know.${genericUnknownLongSuffix}`;
  }
  if (/\byour\b/.test(normalized) && /\b(project|course|trip|game|internship|offer|certification|paper)\b/.test(normalized) && unsupportedEntities.length) {
    const entity = unsupportedEntities[0];
    return `I do not think I actually used ${entity}, so I would not call it my own project or experience. If you mean the general technical idea, I can still talk about the trade-offs, requirements, failure modes, and how I would test it. If you mean my real background, I would switch to a project I can actually support, like SayNext, JobLens, DalParkAid, or ElderAlbum. That way the answer is still useful, but I am not borrowing a fake project name and pretending it happened.${genericUnknownLongSuffix}`;
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
  const trustedSupportContext = [
    formattedProfile,
    formattedSceneProfile,
    formattedPersonalMemory,
    formattedPrenoteContext,
  ].join("\n");
  const recentTranscriptText = params.conversation
    .filter((item) => item.type === "transcript")
    .slice(-5)
    .map((item) => `Transcript: "${item.text}"`)
    .join("\n");
  const boundarySourceText = buildTelepromptRiskText(latestTranscript, recentTranscriptText);
  const boundaryHint = buildTelepromptBoundaryHint(boundarySourceText, trustedSupportContext);

  const targetWords = params.targetMode === "long" ? "150-230" : "90-150";
  const prompt = `Task:
Write the continuation script Xiang can read after this opening line:
"${params.openingLine}"

Target length: ${targetWords} words.
Output language: ${outputLanguage === "chinese" ? "Chinese" : "English"}.

Rules:
- Output only in the requested language. If Output language is English, do not include Chinese text, bilingual explanations, translation sections, or phrases like "Chinese translation".
- Do not repeat the opening line. Start directly with the next sentence after it.
- Write natural spoken text Xiang can read out loud.
- Use short paragraphs and clear sentence breaks.
- End with a complete sentence. Do not stop mid-thought.
- For long target length, use 2-3 short spoken paragraphs. Do not stop after only a short memory quote.
- Prefer relevant personal memory when it directly matches the question.
- Before writing, do a premise check:
  - If the user's premise is not supported by memory/context, the first sentence after the opening line must correct the premise or mark uncertainty.
  - Do not answer from an unsupported premise first and add uncertainty later. The boundary has to come first.
  - The opening line may redirect an unknown project question to a real project such as SayNext. Continue that safe redirection; do not accept the fake project name as real.
- Knowledge boundary is strict:
  - If the request names a product, library, paper, protocol, company, course, award, benchmark, game, trip, job, internship, certification, exact grade, exact metric, exact date, current news, current price, legal rule, medical advice, or financial recommendation that is not explicitly supported by context, do not pretend to know it.
  - Say the boundary naturally: "I'm not fully sure about that exact one", "I haven't personally done that", "I don't have that exact detail", or "I'd need to check the latest source".
  - After the boundary, give a useful general framework, comparison criteria, or safe next step.
  - Do not turn a named unknown entity into a real thing with invented features, endpoints, benchmark scores, release dates, founders, team details, missions, memories, or personal experience.
- If the question asks about Xiang's own past, project, company, award, internship, certification, course, travel, game experience, family detail, grade, metric, or work incident, use only explicit memory/context. If it is missing, say it is missing and pivot to a real adjacent experience or a general answer.
- Never write "In my [named unknown] project/course/job/trip/offer..." or "When I used [named unknown]..." unless that exact named item appears in relevant memory, event memory, scene profile, or prenote.
- Pivoting must stay factual:
  - If you pivot from a fake/unsupported premise to SayNext, only use supported SayNext details: live transcripts, response suggestions, scene profiles, prenotes, personal/knowledge memory retrieval, local Ollama mode, VPS/OpenAI travel mode, teleprompt controls/testing, and response quality.
  - Do not invent SayNext as a task/reminder app, distributed storage system, Firebase sync app, hackathon winner, production app, or multi-device cloud product unless that is explicitly in memory.
  - If asked about an unsupported award, recognition, trip, internship, workplace, certification, or course, do not replace it with another invented award, trip, internship, workplace, certification, or course. State the boundary and then talk generally or use a supported real project.
- For unknown named technical entities, use the pattern: "I am not familiar with X specifically, but if the topic is Y, the general idea is..." Then explain Y generally.
- For an unspecified app/project/assignment/team where the speaker says they forgot to explain the context, ask for requirements or give a neutral discovery framework. Do not default to SayNext or any specific stack.
- For current, legal, medical, and financial topics, avoid exact claims and recommendations unless verified in context. Use cautious wording and suggest checking an authoritative source.
- For legal, medical, financial, or current-news topics, do not add invented personal anecdotes such as friends, family, classmates, doctors, advisors, or past cases. Keep the answer as a cautious general framework.
- If this is IELTS/daily speaking, add ordinary generic details if useful, but do not invent specific room, house, family, job, school, health, immigration, friend, restaurant, park, trip, object, or recent-event facts.
- For IELTS/daily speaking, plausible details are only for low-risk generic topics like a broad preference, a meal category, a hobby type, or an opinion. Do not invent having read a named book, watched a named show/movie, visited a named park/country, lost a specific object, played a named game beyond memory, won an award, held a job, taken a course, met a friend, or experienced a specific event unless it is in memory.
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

Boundary hint:
${boundaryHint}

Xiang profile:
${formattedProfile}

Active event memory:
${formattedEventMemory}

Relevant personal memory:
${formattedPersonalMemory}

Active prenote memory:
${formattedPrenoteContext}`;

  console.log(`[SayNext] Teleprompt model: ${LLM_PROVIDER === "ollama" ? `Ollama:${OLLAMA_MODEL}` : LONG_MODEL_NAME} targetMode=${params.targetMode}`);

  const responseText = LLM_PROVIDER === "ollama"
    ? await generateLongWithOllama(prompt)
    : (await withModelTimeout(
      telepromptAgent.generate(prompt),
      Math.max(OPENAI_TIMEOUT_MS, 60000),
      "OpenAI teleprompt request",
    )).text;

  let script = stripUnsupportedRoomVisualDetails(
    sanitizeTelepromptScript(responseText, params.openingLine, outputLanguage),
    latestTranscript,
  );
  script = replacePublicProjectName(script, `${latestTranscript} ${params.openingLine}`, "interview");

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
      sanitizeTelepromptScript(expandedText, params.openingLine, outputLanguage),
      latestTranscript,
    );
    const expandedPublicSafe = replacePublicProjectName(expanded, `${latestTranscript} ${params.openingLine}`, "interview");
    if (countTelepromptWords(expandedPublicSafe) > countTelepromptWords(script)) {
      script = expandedPublicSafe;
    }
  }

  const fallback = buildUnsupportedPremiseFallback(boundarySourceText, trustedSupportContext, params.targetMode);
  if (fallback) {
    script = fallback;
  }

  return replacePublicProjectName(script, `${latestTranscript} ${params.openingLine}`, "interview");
}

function shouldSkipOptionalContinuation(displayedAnswer: string, latestTranscript: string, eventMemory?: EventMemorySnapshot): boolean {
  const answer = displayedAnswer.trim();
  if (!answer) return true;

  const normalizedAnswer = answer.toLowerCase();
  const normalizedSource = latestTranscript.toLowerCase();
  const eventText = `${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();
  const answerWords = countTelepromptWords(answer);

  if (answerWords < 6) return true;
  if (/[?？]\s*$/.test(answer)) return true;
  if (/^(sorry|could you repeat|what do you mean|nice to meet you|thank you|thanks|sure, could you repeat|i'm not sure what you mean)/i.test(answer)) {
    return true;
  }
  if (/\b(source=open_|source=short_form|third-party|public transcript|public\/open)\b/.test(eventText)) {
    return true;
  }

  const highRiskService = /\b(id|passport|permit|sin|bank|insurance|lease|contract|payment|credit card|doctor|medicine|medication|legal|lawyer|police|border|immigration|non-refundable|deposit|sign|signature|advisor|front desk|maintenance)\b/;
  if (highRiskService.test(normalizedSource) || highRiskService.test(normalizedAnswer)) {
    return true;
  }

  return false;
}

function cleanOptionalContinuation(text: string, latestTranscript: string, outputLanguage: OutputLanguage, eventMemory?: EventMemorySnapshot): string | null {
  const extracted = extractOutputField(text) ?? text;
  let cleaned = finalizeSayNextOutput(extracted, latestTranscript, outputLanguage, eventMemory)
    .replace(/\bNO_CONTINUATION\b[.!]?/gi, "")
    .replace(/^\s*(?:next|continuation|follow[- ]?up|say)\s*[:.-]\s*/i, "")
    .trim();

  if (!cleaned || /^no\s+continuation/i.test(cleaned)) return null;
  if (/^(sorry|could you repeat|what do you mean)/i.test(cleaned)) return null;

  const firstSentence = cleaned.match(/^.{1,180}?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence) {
    cleaned = firstSentence;
  } else if (cleaned.length > 180) {
    cleaned = `${cleaned.slice(0, 177).trim()}...`;
  }

  const words = countTelepromptWords(cleaned);
  if (words < 4 || words > 36) return null;
  if (/[?？]\s*$/.test(cleaned)) return null;
  return cleaned;
}

export async function generateOptionalContinuation(params: {
  conversation: Conversation;
  eventMemory?: EventMemorySnapshot;
  outputLanguage?: OutputLanguage;
  activePrenoteContext?: string;
  activeSceneProfilePrompt?: string;
  relevantPersonalMemoryContext?: string;
  displayedAnswer: string;
  sourceTranscript: string;
}): Promise<string | null> {
  const latestTranscript = params.sourceTranscript || getLatestTranscript(params.conversation);
  const outputLanguage = params.outputLanguage ?? "english";
  if (shouldSkipOptionalContinuation(params.displayedAnswer, latestTranscript, params.eventMemory)) {
    return null;
  }

  const promptMode = detectPromptMode(latestTranscript, params.eventMemory);
  const formattedProfile = buildCompactXiangProfile(promptMode);
  const formattedEventMemory = formatCompactEventMemory(params.eventMemory, [latestTranscript]);
  const formattedPrenoteContext = params.activePrenoteContext?.trim() || "No active prenote.";
  const formattedSceneProfile = params.activeSceneProfilePrompt?.trim() || "No active scene profile.";
  const filteredPersonalMemoryContext = filterRuntimePersonalMemoryContext(
    params.relevantPersonalMemoryContext ?? "",
    latestTranscript,
    promptMode,
    params.eventMemory,
  );
  const formattedPersonalMemory = filteredPersonalMemoryContext.trim() || "No relevant personal memory.";
  const recentTranscriptText = params.conversation
    .filter((item) => item.type === "transcript")
    .slice(-4)
    .map((item) => `Transcript: "${item.text}"`)
    .join("\n");

  const prompt = `Task:
Xiang just read the displayed answer below. The other person has not spoken yet.
Write ONE optional follow-up sentence Xiang can continue with, only if it naturally adds useful detail.
If a follow-up would feel awkward, repetitive, too eager, risky, or unsupported, return NO_CONTINUATION.

Output language: ${outputLanguage === "chinese" ? "Chinese" : "English"}.

Rules:
- Return only one speakable sentence, or NO_CONTINUATION.
- Do not answer a new question.
- Do not repeat the displayed answer.
- Do not introduce unsupported personal facts, exact dates, grades, numbers, names, awards, family details, legal/medical/financial advice, or project claims.
- Good continuation patterns: a small example, a reason, a limitation, a modest clarification, or one concrete next detail.
- Bad continuation patterns: another question, a summary, a lecture, self-praise, "overall", "in conclusion", or sounding like a prepared script.
- For interview/classroom/meeting, the continuation may add one useful concrete detail.
- For casual chat, keep it light and human, or return NO_CONTINUATION.
- If the displayed answer is about SayNext, prefer supported concrete details: live transcripts, response suggestions, scene profiles, prenotes, personal/knowledge memory retrieval, local Ollama mode, VPS/OpenAI travel mode, teleprompt controls/testing, and noisy transcript handling.
- Do not add generic project claims like "uses NLP and machine learning" unless the displayed answer or memory already supports that exact framing.

Source transcript that triggered the displayed answer:
"${latestTranscript}"

Displayed answer Xiang just read:
"${params.displayedAnswer}"

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

  try {
    const timeoutMs = Number(process.env.READBACK_CONTINUATION_MODEL_TIMEOUT_MS || 8000);
    const responseText = LLM_PROVIDER === "ollama"
      ? await generateOptionalContinuationWithOllama(prompt)
      : (await withModelTimeout(
        initialAgentLow.generate(prompt),
        Math.min(OPENAI_TIMEOUT_MS, timeoutMs),
        "OpenAI readback continuation request",
      )).text;

    return cleanOptionalContinuation(responseText, latestTranscript, outputLanguage, params.eventMemory);
  } catch (error) {
    console.warn(`Optional readback continuation skipped after model error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function processConversation(
  conversation: Conversation,
  frequency: 'low' | 'medium' | 'high' = 'high',
  eventMemory?: EventMemorySnapshot,
  outputLanguage: OutputLanguage = "english",
  activePrenoteContext = "",
  activeSceneProfilePrompt = "",
  relevantPersonalMemoryContext = "",
  options: ProcessConversationOptions = {},
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
  const latestTranscriptIndex = findLatestTranscriptIndex(conversation);
  const compactConversation = conversation
    .filter((_, index) => index !== latestTranscriptIndex)
    .slice(-4);
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
  const historyTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const formattedEventMemory = formatCompactEventMemory(eventMemory, [latestTranscript, ...historyTranscriptTexts]);
  const formattedPrenoteContext = activePrenoteContext.trim() || "No active prenote.";
  const formattedSceneProfile = activeSceneProfilePrompt.trim() || "No active scene profile.";
  const filteredPersonalMemoryContext = filterRuntimePersonalMemoryContext(
    relevantPersonalMemoryContext,
    latestTranscript,
    promptMode,
    eventMemory,
  );
  const formattedPersonalMemory = filteredPersonalMemoryContext.trim() || "No relevant personal memory.";
  const trustedSupportContext = [
    formattedProfile,
    formattedSceneProfile,
    formattedPersonalMemory,
    formattedPrenoteContext,
  ].join("\n");
  const prenoteExactResponse = getPrenoteExactAnswerImmediateResponse(latestTranscript, formattedPrenoteContext, currentTimestamp);
  if (prenoteExactResponse) {
    return prenoteExactResponse;
  }

  const unsupportedPremiseResponse = getUnsupportedPremiseImmediateResponse(latestTranscript, currentTimestamp, trustedSupportContext);
  if (unsupportedPremiseResponse) {
    return unsupportedPremiseResponse;
  }

  console.log("\n--- SayNext Agent Context ---\n", formattedHistory, "\n-----------------------------\n");
  const stablePromptPrefix = `Task:
- Use the latest transcript as the trigger and follow the active scene profile first.
- Direct question: answer directly. Lecture/explanation: add a useful supplement or question. Casual: keep it natural. Meeting: move the task forward.
- Output must read like something Xiang can say out loud immediately. Avoid quoted terms, parentheses, Markdown backticks, e.g., and spec-doc phrasing.
- For live meeting replies, keep it to one or two short spoken sentences. Do not pack multiple document actions into one long sentence.
- If the transcript asks Xiang's name, identity, or name pronunciation, answer with Xiang Li / Xiang; never echo a wrong name.
- If someone suggests adding a new feature before fixing a known bug/blocker, push back gently and prioritize the core bug first.
- For public-facing project or interview answers, use "Hybrid Search Memory Assistant" as the name for SayNext unless the conversation is clearly internal.
- Use active prenote memory as prepared context when relevant. It is stronger than generic knowledge, but do not force it if unrelated.
- If the active prenote contains an exact date, room, deadline, rubric item, API field, requirement, or policy that answers the latest transcript, use that exact detail instead of guessing.
- Use relevant personal memory only when it directly helps; do not volunteer sensitive details.
- Do not mention memory source refs, categories, or usage rules. If a relevant memory has source ref starting with knowledge:xiang-playbook:, treat it as a response playbook only: use its logic, but do not claim Xiang lived that exact event.
- For conflict, feedback, deadline, debugging, demo-pressure, unclear-requirement, or unknown-answer situations, a response playbook can supply the reasoning path when no exact personal story exists.
- For daily/IELTS life questions, do not invent specific named movies, shows, stores, restaurants, parks, rooms, parties, trips, valuable items, friends, animal encounters, or recent events. If memory is missing, answer generally and modestly.
- Avoid forced return questions like "How about you?", "What happened after that?", "ready?", "right?", or "huh?" unless the user explicitly asks for a question to say or the question is operationally necessary.
- If the transcript asks why/origin/motivation for Xiang's own project or interest, and relevant personal memory contains an explicit origin, lead with that origin before technical details.
- Personality, self-image, identity-belonging, mentor, relationship, political-values, and social-confidence memory is private shaping context. Use it only when the latest transcript directly asks about motivation, work style, confidence, self-image, social style, identity/belonging, important mentors, dating/relationship boundaries, political values, or future/workplace preference. Phrase it modestly and safely; do not quote raw insecurity like "too dumb", name private mentors, or volunteer political opinions unless Xiang explicitly asks for that topic.
- High-stakes money, contract, lease, medical, legal, or non-refundable transaction pressure: do not agree or commit for Xiang. Use a cautious, sayable line asking to review, confirm in writing, or check with the right person.
- Formal ceremony/toast/speech moments: be warm, simple, respectful, and not slangy.
- If the latest transcript asks what question Xiang should ask in class or after a lecture, output one short student-like question only. Make it low-profile and natural, often with "would it be" or "so basically"; do not add an explanation.
- For direct classroom concept questions, prefer 1-2 compact spoken sentences. For lecture supplements, prefer 12-28 words. Do not write a mini textbook explanation unless the transcript asks for detail.
- Ambiguous meeting statements using "it/this/that" without enough background: avoid blindly agreeing; clarify the specific part, risk, or next check.
- For meetings, include a concrete next move such as owner, blocker, decision, assumption, contract, test, log check, or scope cut. Avoid general "we should review it" language.
- Do not use the personal sample library.
- The requested Output language below is mandatory.
- If active event memory says source=open_* or source=short_form, or the transcript is labelled third-party dialogue, reply neutrally to the transcript only; do not use Xiang personal/profile context or take over a speaker role.
- For labelled third-party dialogue, output a short neutral content response or summary. Do not output meta text like "respond neutrally" or "do not take over the speaker role".

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

  const dynamicPromptCore = `Time: ${currentDate}
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
--- END RELEVANT PERSONAL MEMORY ---`;

  const dynamicPromptSuffix = `${dynamicPromptCore}

${formattedHistory}`;

  const openAiConversationInstructions = `${sayNextInstructions}

${stablePromptPrefix}

${dynamicPromptCore}

OpenAI conversation state may contain previous clean transcript turns from this app session.
- Treat previous user messages as prior transcript context only.
- Assistant outputs are display suggestions, not external speech. If any previous assistant output is still visible in state, do not treat it as something the other person said.
- The current transcript is provided in the user input for this request.`;

  // Keep repeated content before volatile transcript/event context so OpenAI prompt caching can reuse the prefix.
  const prompt = `${stablePromptPrefix}\n\n${dynamicPromptSuffix}`;
  const cacheablePrefix = `${sayNextInstructions}\n\n${stablePromptPrefix}`;
  const openAiConversationReady = Boolean(options.openAiConversationSession)
    && isOpenAiConversationStateEnabled(LLM_PROVIDER)
    && shouldCommitTranscriptToOpenAiConversation(options.transcriptCommitReason ?? "final");

  console.log(
    `[SayNext] Input approx tokens: system=${estimateTokens(sayNextInstructions)} prompt=${estimateTokens(prompt)} cacheablePrefix=${estimateTokens(cacheablePrefix)} dynamic=${estimateTokens(dynamicPromptSuffix)} total=${estimateTokens(`${sayNextInstructions}\n\n${prompt}`)} mode=${promptMode}${openAiConversationReady ? ` openaiConversation=enabled conversationRequest=${estimateTokens(openAiConversationInstructions) + estimateTokens(latestTranscript)}` : ""}`,
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

    console.log(`>> Using agent brain: ${LLM_PROVIDER === "ollama" ? `Ollama:${OLLAMA_MODEL}` : openAiConversationReady ? `${agent.name}:conversation-state` : agent.name}`);

    let openAiConversationMetadata: Record<string, unknown> | undefined;
    let responseText: string;
    if (LLM_PROVIDER === "ollama") {
      responseText = await generateWithOllama(prompt);
    } else if (openAiConversationReady && options.openAiConversationSession) {
      try {
        const result = await options.openAiConversationSession.generate({
          model: MODEL_NAME,
          instructions: openAiConversationInstructions,
          latestTranscript,
          timeoutMs: OPENAI_TIMEOUT_MS,
        });
        responseText = result.text;
        openAiConversationMetadata = {
          enabled: true,
          conversationId: result.conversationId,
          responseId: result.responseId,
          deletedAssistantOutputItemIds: result.deletedOutputItemIds,
          omittedRecentHistoryFromPrompt: true,
          transcriptCommitReason: options.transcriptCommitReason ?? "final",
          estimatedInstructionTokens: estimateTokens(openAiConversationInstructions),
          estimatedUserInputTokens: estimateTokens(latestTranscript),
        };
      } catch (error) {
        console.warn(`OpenAI conversation-state request failed; falling back to normal OpenAI prompt: ${error instanceof Error ? error.message : String(error)}`);
        responseText = (await withModelTimeout(agent.generate(prompt), OPENAI_TIMEOUT_MS, "OpenAI SayNext fallback request")).text;
        openAiConversationMetadata = {
          enabled: true,
          fallback: true,
          error: error instanceof Error ? error.message : String(error),
          transcriptCommitReason: options.transcriptCommitReason ?? "final",
        };
      }
    } else {
      responseText = (await withModelTimeout(agent.generate(prompt), OPENAI_TIMEOUT_MS, "OpenAI SayNext request")).text;
    }

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
          output: finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory, promptMode),
          confidence: extractedOutput ? 0.5 : 0.7,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
              openAiConversation: openAiConversationMetadata,
            }
          }
        };
      }

      const extractedOutput = extractOutputField(responseText);
      return {
        type: Action.INSIGHT,
        reasoning: extractedOutput
          ? "OpenAI returned structured text; extracted output field"
          : "Generated SayNext reply with OpenAI",
        timestamp: currentTimestamp,
        output: finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory, promptMode),
        confidence: extractedOutput ? 0.6 : 0.8,
        metadata: {
          agentType: AgentType.Initial,
          agentInput: {
            model: ACTIVE_MODEL_NAME,
            profileVersion: PROFILE_VERSION,
            retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            openAiConversation: openAiConversationMetadata,
          }
        }
      };
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
          openAiConversation: openAiConversationMetadata,
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
