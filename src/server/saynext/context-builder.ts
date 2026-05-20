import type { Conversation } from "../mastra/types";
import type { EventMemorySnapshot } from "../memory/event-memory";
import { isLikelySpeakerLabelTranscript, isTechnicalOrProjectFollowup } from "./output-postprocess";
import type { PromptMode } from "./process-router";
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function compactText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function normalizeContextLine(text: string): string {
  return compactText(text).toLowerCase();
}


export function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}


export function buildGeneralAsrPromptHint(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return "";

  const candidates: Array<[RegExp, string]> = [
    [/\bdead line\b/i, '"dead line" may mean "deadline".'],
    [/\bcheap work\b/i, '"cheap work" may mean "deep work".'],
    [/\bpoly ticks\b/i, '"poly ticks" may mean "politics" unless the relationship context clearly says polyamory.'],
    [/\bemployment\b/i, '"employment" may be an ASR slip for "deployment" in software or cloud contexts.'],
    [/\breact neighbor\b/i, '"react neighbor" may mean "React Native".'],
    [/\bjava script\b/i, '"java script" usually means "JavaScript" in technical contexts.'],
    [/\bfront end\b/i, '"front end" may mean "frontend" in technical contexts.'],
    [/\bback end\b/i, '"back end" may mean "backend" in technical contexts.'],
    [/\bprivate sea\b/i, '"private sea" may mean "privacy".'],
    [/\bcontent\b/i, '"content" may mean "consent" when the topic is privacy or ethics.'],
    [/\brefound\b/i, '"refound" may mean "refund".'],
    [/\ball energy\b/i, '"all energy" may mean "allergy" only in food or medical contexts; otherwise treat it as likely noise.'],
    [/\bscheme\b/i, '"scheme" may mean "schema" in database or API contexts.'],
    [/\bthe bugging\b/i, '"the bugging" may mean "debugging".'],
    [/\bproduct activity\b/i, '"product activity" may mean "productivity" unless the context is product analytics.'],
    [/\bhigh bridge search\b/i, '"high bridge search" may mean "Hybrid Search" in Xiang project contexts.'],
    [/\bdoor closes mid[- ]sentence\b/i, '"door closes mid-sentence" is likely a noise marker, not part of the answer topic.'],
    [/\bsorry,? can you repeat\b/i, 'A repeated "sorry, can you repeat" phrase may be ASR or background noise, not a request Xiang must answer literally.'],
  ];

  const hints = candidates
    .filter(([pattern]) => pattern.test(raw))
    .map(([, hint]) => hint);

  return hints.length
    ? `General ASR/noise hints:\n${hints.slice(0, 4).map((hint) => `- ${hint}`).join("\n")}`
    : "";
}

export function buildProcessHint(latestTranscript: string, promptMode: PromptMode): string {
  const hints: string[] = [
    "Process before answering: identify the main request, ignore obvious ASR/noise, decide the safest response move, then write the shortest useful answer.",
  ];

  const questionCount = (latestTranscript.match(/[?\uFF1F]/g) ?? []).length;
  const hasQuestionWord = /\b(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|should)\b/i.test(latestTranscript);
  const hasMultiIntentMarkers = questionCount >= 2 || (hasQuestionWord && /\b(and|also|but|or)\b/i.test(latestTranscript));
  if (hasMultiIntentMarkers) {
    hints.push("If the transcript mixes two topics, answer the latest or most actionable direct ask first. If the side topic is unrelated, uncertain, or high-risk, acknowledge it briefly instead of inventing details.");
  }

  if (/\b(why|how|trade[- ]?off|risk|policy|evidence|debug|algorithm|cloud|api|database|legal|health|finance|news|censorship|privacy|contract|lease|lambda|dynamodb|serverless)\b/i.test(latestTranscript)) {
    hints.push("For serious or technical topics, use a minimum structure: clear claim, one reason or mechanism, and one next step or caveat. Avoid vague one-line slogans.");
  }

  if (/\b(exact|specific|list|timestamp|date|metric|number|title|quote|verbatim|who owns|status|progress|when)\b/i.test(latestTranscript)) {
    hints.push("If exact details are not present in transcript, memory, or prenote, say what is unknown and how to verify. Do not use placeholders like X, Y, Z, [date], or made-up specifics.");
  }

  if (/\b(allergy|allergies|medicine|medical|symptom|doctor|clinic|pharmacy|deposit|lease|contract|payment|immigration|tax|bank|insurance)\b/i.test(latestTranscript)) {
    hints.push("For health, money, contract, tax, bank, insurance, or immigration topics, be cautious: do not commit, diagnose, or guess exact facts. Ask to verify or confirm in writing when needed.");
  }

  if (promptMode === "casual" || promptMode === "general") {
    hints.push("For open-ended casual questions, answer like a normal person: pick one simple opinion and one small reason. Do not over-technicalize.");
  }

  return hints.join("\n");
}

export function detectPromptMode(latestTranscript: string, eventMemory?: EventMemorySnapshot): PromptMode {
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

export function buildCompactXiangProfile(mode: PromptMode): string {
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

export function findLatestTranscriptIndex(conversation: Conversation): number {
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].type === "transcript") return i;
  }
  return -1;
}

export function isPublicOrThirdPartyEvent(eventMemory?: EventMemorySnapshot): boolean {
  if (!eventMemory) return false;
  const text = `${eventMemory.scene} ${eventMemory.title} ${eventMemory.summary}`.toLowerCase();
  return /\b(source=open_|source=short_form|open-source reference|third-party|public transcript|public\/open)\b/.test(text);
}


export function memoryBlockCategory(block: string): string {
  return block.match(/\[([^,\]]+)/)?.[1]?.trim().toLowerCase() || "";
}

export function memoryBlockSourceRef(block: string): string {
  return block.match(/Source(?: ref)?:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase() || "";
}

export function asksForXiangPersonalContext(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(xiang|you|your|yours|yourself|my|me|i)\b/.test(normalized)
    || /\b(favorite|favourite|prefer|like|dislike|study|school|course|class|project|built|made|experience|family|home|room|game|food|music|anime|weekend|sleep|live|from|background|candidate|interview)\b/.test(normalized);
}

export function asksForProjectOrExperience(text: string): boolean {
  return /\b(project|built|made|experience|worked on|portfolio|app|application|interview|candidate|resume|tell me about yourself|why should we hire|your role|my role)\b/i.test(text);
}

export function isGenericSpeakingPrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  if (isTechnicalOrProjectFollowup(normalized)) {
    return false;
  }
  if (/\b(project|technical|engineering|software|cloud|aws|lambda|dynamodb|react|firebase|api|debug|bug|code|coding|system|architecture|interview|candidate|resume|work|student|study|workplace|production|role|position|hire|portfolio|internship|ai|llm|model|prompt|agent|asr|transcript|summary|summaries|diarization|latency|segment|buffer|buffering|delay|refresh|failure mode|monitor|monitoring|observability|data|storage|privacy|leakage|bias|security|risk|policy|contract|lease|customer|user|c\+\+|java|algorithm|multithreading|coursework|kubernetes|rbac|network polic)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:mobile|web|app|application|react native|development|technical|software)\s+experience\b/.test(normalized)
    || /\bapp development\b/.test(normalized)) {
    return false;
  }
  return /\b(describe|do you|did you|have you|what kind of|what type of|what is the difference|what do you usually|what do you learn from|who is|where do you|when was|how often|why do you)\b/.test(normalized);
}


export function filterRuntimePersonalMemoryContext(
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

export function formatCompactEventMemory(eventMemory?: EventMemorySnapshot, excludedTranscripts: string[] = []): string {
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
