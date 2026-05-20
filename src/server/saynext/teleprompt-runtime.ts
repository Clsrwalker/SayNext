import type { Conversation } from "../mastra/types";
import type { EventMemorySnapshot } from "../memory/event-memory";
import { buildKnownTermAsrPromptHint, normalizeKnownProjectAsrAliases } from "../text/asr-corrections";
import {
  buildCompactXiangProfile,
  detectPromptMode,
  filterRuntimePersonalMemoryContext,
  formatCompactEventMemory,
  isGenericSpeakingPrompt,
} from "./context-builder";
import {
  LLM_PROVIDER,
  LONG_MODEL_NAME,
  OLLAMA_MODEL,
  OPENAI_TIMEOUT_MS,
  generateLongWithOllama,
  generateOptionalContinuationWithOllama,
  initialAgentLow,
  telepromptAgent,
  withModelTimeout,
} from "./model-runtime";
import {
  countTelepromptWords,
  extractOutputField,
  finalizeSayNextOutput,
  normalizeMojibakeArtifacts,
  normalizeSpokenDisplayPunctuation,
  replacePublicProjectName,
  type OutputLanguage,
} from "./output-postprocess";

function getLatestTranscript(conversation: Conversation): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const item = conversation[i];
    if (item.type === "transcript") return item.text;
  }
  return "";
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


export function extractPossibleNamedEntities(text: string): string[] {
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

  if (/\bgoogle\b/.test(normalized)) {
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
  const rawLatestTranscript = getLatestTranscript(params.conversation);
  const latestTranscript = normalizeKnownProjectAsrAliases(rawLatestTranscript);
  const asrCorrectionHint = buildKnownTermAsrPromptHint(rawLatestTranscript);
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
    formattedEventMemory,
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
${asrCorrectionHint ? `
ASR correction hint:
${asrCorrectionHint}
` : ""}

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
