import type { EventMemorySnapshot } from "../memory/event-memory";
import type { PromptMode } from "./process-router";

export type AnswerIntent =
  | "ordinary_practical"
  | "casual_opinion"
  | "technical_mechanism"
  | "technical_debug"
  | "service_admin"
  | "service_risk"
  | "interview_intro"
  | "interview_project"
  | "interview_code_solution"
  | "interview_debug_solution"
  | "interview_technical_solution"
  | "interview_concept"
  | "interview_behavioral"
  | "personal_fact"
  | "classroom_answer"
  | "classroom_note";

function normalizeText(text: string): string {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasQuestionShape(text: string): boolean {
  return /[?\uFF1F]/.test(text)
    || /^\s*(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|should|compare|contrast|differentiate)\b/i.test(text)
    || /\b(can you|could you|would you|do you|does it|tell me why|tell me how|explain why|explain how)\b/i.test(text);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const TECHNICAL_ENTITY_PATTERNS = [
  /\b(api|endpoint|backend|frontend|database|db|index|query|lookup|cache|redis|dynamodb|lambda|serverless|kubernetes|docker|auth|login|sign in|browser|safari|chrome|chart|dataset|schema|algorithm|hash map|hash table|model|gradient|loss|neural|embedding|rag|llm|http|json|sql|runtime|deployment|deploy|deployed|react|render|rerender|re-render|component|state|props|button|handler|event handler|click handler|page|route|build|pipeline)\b/i,
];

const TECHNICAL_SYMPTOM_PATTERNS = [
  /\b(keeps? (?:updating|refreshing|rendering|rerendering|re-rendering|firing|running|looping)|again and again|fires? twice|runs? twice|double fires?|sends? (?:the )?(?:request|form) (?:two times|twice)|submits? (?:the )?form (?:two times|twice)|submits? (?:two times|twice)|calls? (?:the )?api (?:two times|twice)|fails? after deploy(?:ment)?|breaks? after deploy(?:ment)?|slow after deploy(?:ment)?|cors blocks?|blocked by cors|works? locally but fails?|works? on my machine but breaks?|fine with small data|okay on \d+ rows but slow|slow on (?:a )?(?:million|large|more) rows|slow with more records|gets slow|suddenly slow|too slow|latency|timeout|times out|stuck|broken|returns? wrong|not returning|error|fails?|failed|500|403|401|NaN|not a number|exploding gradients?|deadlock|race condition|memory leak|infinite loop|bottleneck|too many re[- ]?renders?|re[- ]?renders? too much)\b/i,
  /\b(train(?:ing)? accuracy is high|high on train(?:ing)? data|bad on validation|validation accuracy is low|validation loss (?:goes up|is high)|doesn'?t generalize)\b/i,
  /\b(works? in chrome but not safari|only on safari|goes blank|flashes? and then goes blank|freezes? with (?:the )?real dataset|fine with ten rows)\b/i,
];

const TECHNICAL_DEBUG_ACTION_PATTERNS = [
  /\b(debug|troubleshoot|investigate|inspect|check logs?|look at logs?|trace|profil|profile|reproduce|bisect|instrument|monitor|metrics?|p95|p99|query plan|explain plan|diagnose|root cause|narrow (?:it|this) down|figure out|what should i check|where should i look|what would you check|what would you look at|first thing to check|what could cause)\b/i,
];

const TECHNICAL_MECHANISM_QUESTION_PATTERNS = [
  /^\s*(why|how)\s+(?:does|do|is|are)\b.*\b(work|reduce|improve|help|make|speed up|faster|fast|cache|caching|index|lookup)\b/i,
  /^\s*(what is|what are|explain)\b/i,
];

const STRONG_DEBUG_CONTEXT_PATTERNS = [
  /\b(after deploy(?:ment)?|only after|keeps?|suddenly|sometimes|again and again|returns?|fails?|failed|error|timeout|times out|stuck|broken|wrong|not returning|twice|two times|gets slow|slow with|slow after|fine with small|okay on \d+ rows|cors|NaN|not a number|500|403|401|bad on validation|validation accuracy is low|validation loss|doesn'?t generalize|chrome but not safari|only on safari|goes blank|freezes? with (?:the )?real dataset|fine with ten rows)\b/i,
];

const CONSUMER_DEVICE_PATTERNS = [
  /\b(phone|laptop|battery|wi-?fi|wifi|printer|charger|airpods?|headphones?|screen|keyboard|mouse|router)\b/i,
];

const BEHAVIORAL_INTERVIEW_PATTERNS = [
  /\b(tell me about a time|example of|experience with|conflict|failure|challenge|difficult|under pressure|leadership|feedback|mistake|disagreement|teamwork|prioriti[sz]e)\b/i,
];

const INTERVIEW_INTRO_PATTERNS = [
  /\b(tell me about yourself|introduce yourself|walk me through your background|briefly introduce yourself)\b/i,
];

const INTERVIEW_PROJECT_PATTERNS = [
  /\b(your|you)\b.*\b(project|projects|architecture|backend experience|cloud experience|mobile app|app you built|built|made|implemented|developed|role)\b/i,
  /\b(which project|one project|school project|university project|project architecture|backend experience|cloud backend|mobile app you built|explain one mobile app|describe your backend|what was your role in|your role in)\b/i,
  /\b(joblens|job lens|saynext|hybrid search memory assistant|elderalbum|elder album|dalparkaid|dal parking aid|study session tracker)\b.*\b(database|backend|architecture|data flow|what kind of|used|built|project)\b/i,
  /\b(database|backend|architecture|data flow|what kind of|used|built|project)\b.*\b(joblens|job lens|saynext|hybrid search memory assistant|elderalbum|elder album|dalparkaid|dal parking aid|study session tracker)\b/i,
];

const INTERVIEW_TECHNICAL_SOLUTION_PATTERNS = [
  /\b(coderpad|coding interview|technical interview|object[- ]oriented|ood|algorithm(?:s)? question|coding problem|start coding|write (?:a )?function|implement|solve this|talk me through your approach|before you start coding)\b/i,
  /\b(core classes|classes and components|components (?:are|would be) important|structure (?:the )?(?:core|base|foundation|classes|components)|design (?:a|an|the) .{0,80}(?:system|application|app|library|reader|reading|book))\b/i,
  /\b(data structures?|time complexity|space complexity|edge cases?|pseudocode|code skeleton)\b/i,
];

const INTERVIEW_CODE_SOLUTION_PATTERNS = [
  /\b(?:show|write|give|see)\s+(?:me\s+)?(?:some\s+)?(?:python\s+)?(?:pseudo[- ]?code|code)\b/i,
  /\b(?:python\s+)?(?:pseudo[- ]?code|code)\s+(?:for|to|that|this)\b/i,
  /\b(?:code\s+structure|code\s+look|class\s+shape)\b/i,
  /\b(?:flesh out|fill out|implement|code|write)\s+(?:one of these\s+)?(?:the\s+)?(?:class|classes|method|function)\b/i,
  /\bimplement\s+(?:the\s+)?[a-zA-Z_][\w-]*\s+method\b/i,
  /\bwrite\s+(?:the\s+)?(?:main\s+)?methods?\b/i,
  /\b(?:class|code)\s+skeleton\b/i,
  /\b(?:write|implement)\s+(?:a\s+)?function\b/i,
  /\blet'?s\s+(?:code|implement)\b/i,
];

const PERSONAL_FACT_PATTERNS = [
  /\bwhat(?:'s| is) your (?:major|degree|hometown)\b/i,
  /\bwhat (?:program|major) (?:are|were) you (?:in|taking|studying)\b/i,
  /\bwhat are you studying\b/i,
  /\bare you studying (?:computer science|cs) or math\b/i,
  /\bwhere (?:are|were) you (?:from|originally from|studying)\b/i,
  /\bwhere did you (?:study|go to school)\b/i,
  /\bwhat school did you go to for your bachelor'?s\b/i,
  /\bwhere did you do your (?:bachelor'?s|undergrad|undergraduate)\b/i,
  /\bwhat did you study during your bachelor(?:'?s)? degree\b/i,
  /\bwhich city are you from in china\b/i,
  /\bwhere did you grow up|where were you born|originally from\b/i,
  /\b(legally allowed to work|work authorization|authorized to work|allowed to work in canada)\b/i,
  /\b(before dalhousie|previous school|previous university|previous degree|what did you study before|what did you study at acadia|what was your previous major|acadia degree)\b/i,
];

const ORDINARY_PRACTICAL_PATTERNS = [
  /\b(how|what|which|can|should|do|does|is|are)\b.*\b(measure|weigh|check|tell|know|judge|make|cool|warm|heat|open|close|clean|carry|move|fix|cook|boil|wash|dry|fold|sleep|wake|eat|drink|bus|walk|room|water|weather|laundry|elephant|scale|fan|window|air conditioner|ac|sticker|bottle|soup|spill|leak|bag|noodles|glasses|fog|remember|memorize|name|smell|lunch box|lunchbox)\b/i,
  /\b(water boil|boiling water|room cool|cooler room|measure an elephant|weigh an elephant|doing laundry|taking the bus|walking)\b/i,
  /\b(glasses|lenses)\b.*\b(fog|fogging|fogged)\b/i,
];

const SERVICE_RISK_PATTERNS = [
  /\b(landlord|lease|deposit|rent|pay today|payment|lose the apartment|forfeit|doctor|medical|insurance|legal|contract|refund|bank|fee|non[- ]?refundable)\b/i,
];

const SERVICE_ADMIN_PATTERNS = [
  /\b(front desk|package|missing|delivery|delivered|order status|form|document|appointment|office|admin|receipt|tracking|claim|report|ask them|what should i ask)\b/i,
];

export function classifyAnswerIntent(
  latestTranscript: string,
  promptMode: PromptMode,
  eventMemory?: EventMemorySnapshot,
): AnswerIntent {
  const text = normalizeText(`${latestTranscript} ${eventMemory?.scene || ""} ${eventMemory?.title || ""}`);
  const isQuestion = hasQuestionShape(latestTranscript);
  const hasTechnicalEntity = hasAny(text, TECHNICAL_ENTITY_PATTERNS);
  const hasTechnicalSymptom = hasAny(text, TECHNICAL_SYMPTOM_PATTERNS);
  const hasDebugAction = hasAny(text, TECHNICAL_DEBUG_ACTION_PATTERNS);
  const hasTechnicalMechanismQuestion = hasAny(text, TECHNICAL_MECHANISM_QUESTION_PATTERNS);
  const hasStrongDebugContext = hasAny(text, STRONG_DEBUG_CONTEXT_PATTERNS);
  const isConsumerDeviceIssue = hasAny(text, CONSUMER_DEVICE_PATTERNS) && !hasTechnicalEntity;

  if (promptMode === "classroom") {
    return isQuestion ? "classroom_answer" : "classroom_note";
  }

  if (promptMode === "interview" && hasAny(text, INTERVIEW_INTRO_PATTERNS)) {
    return "interview_intro";
  }

  if (hasAny(text, PERSONAL_FACT_PATTERNS)) {
    return "personal_fact";
  }

  if (promptMode === "service") {
    if (hasAny(text, SERVICE_RISK_PATTERNS)) return "service_risk";
    if (hasAny(text, SERVICE_ADMIN_PATTERNS) || isQuestion) return "service_admin";
  }

  if (promptMode === "interview") {
    if (/\b(salary expectation|expected salary|compensation|pay range)\b/i.test(text)) return "interview_concept";
    if (hasAny(text, INTERVIEW_PROJECT_PATTERNS)) return "interview_project";
    if (hasAny(text, INTERVIEW_CODE_SOLUTION_PATTERNS)) return "interview_code_solution";
    if (!isConsumerDeviceIssue && hasTechnicalEntity && (hasDebugAction || (hasTechnicalSymptom && hasStrongDebugContext))) {
      return "interview_debug_solution";
    }
    if (hasTechnicalMechanismQuestion && hasTechnicalEntity) {
      return "technical_mechanism";
    }
    if (hasAny(text, INTERVIEW_TECHNICAL_SOLUTION_PATTERNS)) return "interview_technical_solution";
    return hasAny(text, BEHAVIORAL_INTERVIEW_PATTERNS) ? "interview_behavioral" : "interview_concept";
  }

  if (hasTechnicalMechanismQuestion && !hasDebugAction && !(hasTechnicalSymptom && hasStrongDebugContext) && (hasTechnicalEntity || promptMode === "technical")) {
    return "technical_mechanism";
  }

  if (!isConsumerDeviceIssue && hasTechnicalEntity && (hasDebugAction || (hasTechnicalSymptom && hasStrongDebugContext))) {
    return "technical_debug";
  }

  if (hasTechnicalEntity) {
    return "technical_mechanism";
  }

  if (promptMode === "technical") {
    return hasDebugAction || (hasTechnicalSymptom && hasStrongDebugContext) ? "technical_debug" : "technical_mechanism";
  }

  if ((promptMode === "casual" || promptMode === "general")
    && /\b(prefer|favorite|best|like|enjoy|comfortable|better|opinion|usually|miss|order takeout|cook or order)\b/i.test(text)) {
    return "casual_opinion";
  }

  if ((promptMode === "casual" || promptMode === "general" || promptMode === "service")
    && hasAny(text, ORDINARY_PRACTICAL_PATTERNS)) {
    return "ordinary_practical";
  }

  return isQuestion && promptMode !== "casual" ? "ordinary_practical" : "casual_opinion";
}

export function buildAnswerIntentHint(intent: AnswerIntent): string {
  const hints: Record<AnswerIntent, string> = {
    ordinary_practical:
      [
        "Ordinary practical question: give only the most likely everyday answer first. Do not be clever, theoretical, exhaustive, or riddle-like unless the transcript clearly asks for that.",
        "Use one action or one compact distinction, then stop. Do not give a checklist, categories, edge cases, or special methods.",
        "Exception: if the topic involves safety, medical, legal, money, contract, or emergency risk, do not over-shorten; give the safest immediate step and mention getting proper help or confirmation.",
        "Examples: How do you weigh an elephant? -> Use a large platform scale or weighbridge.",
        "How do you know water is boiling? -> Look for rolling bubbles and steady steam.",
        "How do you make a room cooler? -> Turn on AC or use a fan and open a window.",
        "How do you dry wet shoes? -> Stuff them with paper and let them air dry.",
        "How do you check if the door is locked? -> Try the handle once and check the lock position.",
      ].join("\n"),
    casual_opinion:
      "Casual opinion or small talk: give one natural answer and one simple reason. Avoid turning it into advice, a list, or a deep explanation.",
    technical_mechanism:
      "Technical concept: start with the core mechanism in plain words, then add one useful trade-off, example, or edge case. Do not begin with a textbook taxonomy.",
    technical_debug:
      "Technical debugging: start with the first check that narrows scope, then name the likely signal to inspect, such as logs, metrics, traces, query plan, or downstream latency.",
    service_admin:
      "Service/admin question: give a practical line Xiang can say to move the issue forward. Ask for exact record, ID, status, written confirmation, owner, or next step. Keep it polite and specific.",
    service_risk:
      "Service risk question involving money, housing, medical, legal, contract, or non-refundable pressure: do not agree or commit. Ask to review the written details, confirm the amount or policy, and get a receipt or proper staff confirmation.",
    interview_intro:
      "Interview intro: give a short professional self-introduction, not just identity facts. Use 2-3 short spoken sentences: exact current program from profile, previous CS background, practical developer positioning. Do not simplify MACS to Computer Science. Do not list multiple projects or full tech stacks unless asked; one brief project or interest bridge is enough if supported by context.",
    interview_project:
      "Interview project or experience answer: use the most relevant named project from memory when memory context is present. If memory contains named projects, name one exact project in the first sentence, then give concrete architecture, tools, data flow, role, or trade-off from that memory. Do not answer with only a generic frontend/API/data-layer pattern unless no project memory is available.",
    interview_code_solution:
      "Coding interview implementation request: produce actual code or pseudocode, not just say what you would write. Use a glasses-readable shape: one short explanation line, then code lines below it, with short comments where they clarify intent. Keep code lines reasonably short and preserve indentation. For OOD, include concrete classes, fields, methods, and responsibilities; for algorithm prompts, include the function and core logic. After the code, add one brief explanation of how Xiang would explain it to the interviewer if useful.",
    interview_debug_solution:
      "Interview debugging or performance scenario: give a concrete investigation plan, not just one high-level sentence. Start with the first check that narrows scope, then give 3-5 practical steps with specific signals to inspect, such as exact error logs, stack trace, request path, environment variables, traces, query plan, indexes, metrics, or downstream latency. Include the likely fix or next experiment when the transcript gives enough detail. Keep it explainable to an interviewer.",
    interview_technical_solution:
      "Technical/coding interview task: produce a solution, not a social acknowledgement. For OOD or system design, give a concrete mini design: main components/classes, key fields, important methods, ownership/data flow, and one trade-off; do not stop after naming components. For algorithm or coding prompts, give the approach plus concise pseudocode or a code skeleton when useful. If details are missing, state one reasonable assumption and begin solving.",
    interview_concept:
      "Interview answer: sound like a junior developer thinking clearly. Give the conclusion first, then one reason, practical example, or trade-off; do not sound like a textbook.",
    interview_behavioral:
      "Behavioral interview: use a natural story shape without labels: context, what Xiang did, result, and lesson. Do not invent a past-tense story. Only say 'I remember', 'one time', or describe a specific project incident if memory supports that exact story. If memory does not contain a concrete incident, answer as an approach Xiang would take, using 'I would...' rather than a fake past example. Never mention awards or prizes unless the transcript asks about awards.",
    personal_fact:
      [
        "Identity or personal fact question: this is stricter than ordinary practical answers.",
        "Use only supported profile, memory, transcript, or prenote facts. Do not expand acronyms, infer school details, hometown, degree, project names, or experience unless support explicitly says so.",
        "Answer directly; if a fact is missing, say it is not something to make up.",
      ].join("\n"),
    classroom_answer:
      "Classroom direct question: use a tight student answer shape: core answer first, then at most one compact mechanism or example. Do not write a mini textbook explanation unless the transcript asks for detail.",
    classroom_note:
      "Classroom note: if Xiang is not directly asked, provide one small useful knowledge point from the transcript, or stay minimal. Do not force participation.",
  };

  return hints[intent];
}
