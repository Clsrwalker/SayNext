export function countTelepromptWords(text: string): number {
  const compacted = String(text || "").replace(/\s+/g, " ").trim();
  const words = compacted.split(/\s+/).filter(Boolean).length;
  const cjkChars = compacted.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return cjkChars > 0 ? Math.max(words, Math.round(cjkChars / 2)) : words;
}

export function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /[?？]\s*$/.test(normalized) || /^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|tell me|describe|explain)\b/.test(normalized);
}

export function isLikelySpeakerLabelTranscript(text: string): boolean {
  const match = text.match(/^\s*([A-Z][A-Z_ .'-]{0,30})\s*:/i);
  if (!match) return false;
  const label = match[1].trim().toLowerCase();
  if (/^(i|i need|i want|i think|i guess|we|we need|you|he|she|they|it)\b/.test(label)) {
    return false;
  }
  return /^(speaker|agent|customer|interviewer|teacher|professor|student|doctor|nurse|manager|teammate|friend|host|guest|user|assistant)(?:\s+[a-z0-9])?$/.test(label)
    || /^[abc]$/.test(label);
}

export function isTechnicalOrProjectFollowup(text: string): boolean {
  return /\b(project|technical|engineering|software|cloud|aws|lambda|serverless|dynamodb|react|react native|firebase|api|debug|bug|code|coding|system|architecture|repository|github|open[-\s]?source|contribution|contributed|pull request|pr\b|javascript|typescript|node|python|java\b|c\+\+|database|sql|nosql|regression|edge users?|edge cases?|test cases?|unit tests?|integration tests?|smoke tests?|rerun|re-run|release|deployment|monitoring|observability|logs?|security|privacy|bias|leakage|access pattern|data plan|frontend|backend)\b/i.test(text);
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

export function normalizeMojibakeArtifacts(text: string): string {
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

export function normalizeSpokenDisplayPunctuation(text: string): string {
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
