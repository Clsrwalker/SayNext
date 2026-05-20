export type TopicKind =
  | "tech"
  | "classroom"
  | "meeting"
  | "service"
  | "casual"
  | "personal"
  | "risk"
  | "unknown";

export type ContextSignals = {
  latestText: string;
  normalizedLatest: string;
  latestWordCount: number;
  latestIsBackchannel: boolean;
  latestIsClosing: boolean;
  latestIsGreeting: boolean;
  latestIsQuestion: boolean;
  latestIsAnyQuestionsPrompt: boolean;
  latestIsContinuation: boolean;
  latestLooksIncomplete: boolean;
  latestLooksLikeNameFragment: boolean;
  latestHasDirectAddress: boolean;
  latestHasConcreteTask: boolean;
  latestHasRiskOrActionKeyword: boolean;
  latestHasClassroomConceptSignal: boolean;
  latestHasClassroomTaskSignal: boolean;
  previousHasClassroomTopic: boolean;
  hasPriorTranscript: boolean;
  hasRecentAgentOutput: boolean;
  previousWasQuestion: boolean;
  previousTopicKind: TopicKind;
  shouldUseRecentContext: boolean;
  shouldUsePersonalMemory: boolean;
  likelyNoDisplay: boolean;
};

export type DisplayDecision =
  | { action: "silent"; reason: string; confidence: number }
  | { action: "continue"; reason: string; confidence: number };

type BuildContextSignalsInput = {
  latestTranscript: string;
  previousTranscriptTexts?: string[];
  hasRecentAgentOutput?: boolean;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function looksLikeQuestion(value: string): boolean {
  return /\?\s*$/.test(value)
    || /\b(what|how|why|when|where|which|who|should|could|can|would|do you|did you|are you|is it|does it)\b/i.test(value);
}

function classifyTopicKind(text: string): TopicKind {
  const normalized = normalize(text);
  if (!normalized) return "unknown";
  if (hasAny(normalized, [
    /\b(api|cors|http|endpoint|request|response|status|log|lambda|dynamodb|sql|database|query|schema|rag|retrieval|token|typescript|javascript|bug|debug|serverless|ec2|aws)\b/i,
  ])) return "tech";
  if (hasAny(normalized, [/\b(class|professor|lecture|assignment|brightspace|attendance|exam|course|student)\b/i])) return "classroom";
  if (hasAny(normalized, [/\b(meeting|standup|demo|scope|owner|handoff|deadline|team|teammate|action item)\b/i])) return "meeting";
  if (hasAny(normalized, [/\b(deposit|lease|refund|receipt|appointment|pharmacy|restaurant|allergy|bank|insurance|counter|pickup|delivery)\b/i])) return "service";
  if (hasAny(normalized, [/\b(password|code|pay now|payment|legal|doctor|medical|health|privacy|consent|phishing|scam|financial|investment)\b/i])) return "risk";
  if (hasAny(normalized, [/\b(xiang|your project|your experience|resume|background|dalhousie|joblens|saynext|elderalbum|dalparkaid)\b/i])) return "personal";
  if (wordCount(normalized) <= 8) return "casual";
  return "unknown";
}

export function buildContextSignals(input: BuildContextSignalsInput): ContextSignals {
  const latestText = input.latestTranscript.trim();
  const normalizedLatest = normalize(latestText);
  const previousTranscriptTexts = input.previousTranscriptTexts || [];
  const previousText = previousTranscriptTexts.at(-1) || "";
  const previousContextText = previousTranscriptTexts.join(" ");
  const latestWordCount = wordCount(latestText);
  const latestIsQuestion = looksLikeQuestion(latestText);
  const latestIsAnyQuestionsPrompt = /^\s*(?:any questions?|questions on (?:this|that|it|the .*?)?|does anybody have questions?|do you have any questions?)\s*[.!?]*\s*$/i.test(latestText);
  const latestIsBackchannel = /^\s*(?:mm+[-\s]?hmm+|mhm+|uh[-\s]?huh|yeah|yep|okay|ok|right|sure|fine)\s*[.!?,]*\s*$/i.test(latestText);
  const latestIsClosing = /^\s*(?:that'?s\s+fine|that'?s\s+all|no\s+more\s+questions?|thanks?|thank\s+you(?:\s+very\s+much)?|thanks\s+so\s+much|ok(?:ay)?[.!?,\s]+that'?s\s+all[.!?,\s]+thanks?|thank\s+you[.!?,\s]+no|bye|see\s+you)\s*[.!?,]*\s*$/i.test(latestText);
  const latestIsGreeting = /^\s*(?:hello|hi|hey|good\s+morning|good\s+afternoon)\s*[.!?,]*\s*$/i.test(latestText);
  const latestLooksIncomplete = latestWordCount <= 8 && (
    /\b(?:to|and|or|so|because|with|for|if|when|where|that|the)\s*[.!?,]*$/i.test(latestText)
    || /^(?:ok|okay|yeah)[.!?,\s]+[a-z]{2,24}\s*[.!?,]*$/i.test(latestText)
  );
  const latestLooksLikeNameFragment = /^\s*[A-Z][a-zA-Z'-]{2,24}(?:\s+[A-Z][a-zA-Z'-]{2,24}){0,2}[.!?,\s]*$/.test(latestText)
    && !/^\s*(?:Present|Scalar|Matrix|Vector)\s*[.!?,\s]*$/.test(latestText);
  const latestIsContinuation = latestWordCount <= 8 && hasAny(normalizedLatest, [
    /^(?:and|so|then|but|also)\b/i,
    /^(?:what about|how about|that one|this one|which one|same here)\b/i,
    /^(?:can you explain|could you explain|why is|what does)\s+(?:it|that|this)\b/i,
  ]);
  const directAddressText = normalizedLatest.replace(/\bthank you\b/g, "");
  const latestHasDirectAddress = /\b(xiang|you|your)\b/i.test(directAddressText);
  const latestHasRiskOrActionKeyword = hasAny(normalizedLatest, [
    /\b(password|verification code|two[-\s]?factor|pay|payment|deposit|sign|legal|lawyer|doctor|medical|health|pharmacy|privacy|consent|phishing|scam|bank|financial|investment|guarantee)\b/i,
  ]);
  const latestHasClassroomTaskSignal = hasAny(normalizedLatest, [
    /\b(rubric|deadline|due date|exam|midterm|final|assignment|homework|quiz|grade|marks?|requirement|required|submission|submit|brightspace|slides?|lecture notes?)\b/i,
  ]);
  const latestHasClassroomDefinitionMarker = hasAny(normalizedLatest, [
    /\b(definition|define|means|called|is called|is (?:a|an|the)|nothing but|formula|equation|viewpoint|concept|intuition)\b/i,
  ]);
  const latestHasClassroomDomainTerm = hasAny(normalizedLatest, [
    /\b(scalar|vector|matrix|tensor|weighted sum|bias|score|linear classifier|linear regression|classification|hyperplane|decision boundary|gradient|loss|model|training|dataset|data set|features?|labels?)\b/i,
  ]);
  const latestHasClassroomConceptSignal = (latestHasClassroomDefinitionMarker && latestHasClassroomDomainTerm)
    || hasAny(normalizedLatest, [/\b(w\s*(?:x|into x|\*)\s*\+?\s*b|a transpose a|a transpose c a)\b/i]);
  const latestHasConcreteTask = latestHasRiskOrActionKeyword || hasAny(normalizedLatest, [
    /\b(send|share|show|write|email|call|pay|sign|book|schedule|confirm|check|fix|debug|explain|compare|list|summarize|review|test|verify|deploy|update|open|close)\b/i,
    /\b(api|cors|403|404|500|endpoint|request|response|payload|route|auth|log|lambda|dynamodb|sql|database|query|schema|code|bug|error)\b/i,
  ]);
  const hasPriorTranscript = previousTranscriptTexts.length > 0;
  const hasRecentAgentOutput = Boolean(input.hasRecentAgentOutput);
  const previousWasQuestion = looksLikeQuestion(previousText);
  const previousTopicKind = classifyTopicKind(previousContextText);
  const previousHasClassroomTopic = previousTopicKind === "tech"
    || previousTopicKind === "classroom"
    || hasAny(normalize(previousContextText), [
      /\b(professor|lecture|class|course|slides?|assignment|exam|rubric)\b/i,
      /\b(linear classifier|linear regression|tensor|matrix|vector|weighted sum|hyperplane|decision boundary|lambda|dynamodb|database|algorithm|model|training|dataset)\b/i,
    ]);
  const shouldUsePersonalMemory = hasAny(normalizedLatest, [
    /\b(xiang|your project|your projects|your experience|your resume|your background|tell me about yourself|what did you build|your preference|your school|your work|your career|your major)\b/i,
    /\b(joblens|saynext|elderalbum|elder album|dalparkaid|dal park aid|hybrid search memory assistant)\b/i,
  ]);
  const shouldUseRecentContext = latestIsContinuation
    || (latestWordCount <= 5 && !latestIsClosing && !latestIsBackchannel && hasPriorTranscript);
  const likelyNoDisplay = (
    latestIsBackchannel
    || latestIsClosing
    || (latestIsGreeting && hasPriorTranscript)
    || latestLooksIncomplete
    || (latestLooksLikeNameFragment && hasPriorTranscript)
  )
    && (hasPriorTranscript || hasRecentAgentOutput)
    && !latestIsQuestion
    && !latestHasConcreteTask
    && !latestHasDirectAddress;

  return {
    latestText,
    normalizedLatest,
    latestWordCount,
    latestIsBackchannel,
    latestIsClosing,
    latestIsGreeting,
    latestIsQuestion,
    latestIsAnyQuestionsPrompt,
    latestIsContinuation,
    latestLooksIncomplete,
    latestLooksLikeNameFragment,
    latestHasDirectAddress,
    latestHasConcreteTask,
    latestHasRiskOrActionKeyword,
    latestHasClassroomConceptSignal,
    latestHasClassroomTaskSignal,
    previousHasClassroomTopic,
    hasPriorTranscript,
    hasRecentAgentOutput,
    previousWasQuestion,
    previousTopicKind,
    shouldUseRecentContext,
    shouldUsePersonalMemory,
    likelyNoDisplay,
  };
}

export function decideDisplay(signals: ContextSignals): DisplayDecision {
  if (signals.likelyNoDisplay) {
    return {
      action: "silent",
      reason: signals.latestIsClosing ? "closing_or_acknowledgement" : "backchannel_after_context",
      confidence: 0.9,
    };
  }

  if (signals.latestIsAnyQuestionsPrompt && !signals.previousHasClassroomTopic) {
    return {
      action: "silent",
      reason: "any_questions_without_clear_recent_topic",
      confidence: 0.8,
    };
  }

  return {
    action: "continue",
    reason: "display_not_blocked_by_fast_context_signals",
    confidence: 0.75,
  };
}
