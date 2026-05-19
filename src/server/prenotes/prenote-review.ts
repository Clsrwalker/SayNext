import { conversationLogger, type PersonalMemorySensitivity, type SessionMemoryCandidateRecord } from "../data/conversation-logger";

export interface QueuePrenoteKnowledgeReviewInput {
  userId: string;
  prenoteId: number;
  title?: string;
  content?: string;
  usageRule?: string;
  keywords?: string[];
  sensitivity?: PersonalMemorySensitivity;
}

function normalizeWhitespace(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeKeywords(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter((item) => item.length > 2))).slice(0, 24);
}

function splitKeywordSeeds(text: string): string[] {
  return text
    .split(/[\s,，/|:_-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}

function detectContentQualityFlags(content: string): string[] {
  const flags: string[] = ["prenote_upload_requires_review"];
  const normalized = normalizeWhitespace(content);
  if (normalized.length < 80) flags.push("very_short_prenote_content");
  if (normalized.length > 12000) flags.push("long_prenote_review_required");

  const sample = normalized.slice(0, 6000);
  const replacementChars = (sample.match(/[�锟]/g) || []).length;
  if (replacementChars >= 3) flags.push("possible_encoding_or_ocr_noise");

  const lettersAndNumbers = (sample.match(/[a-zA-Z0-9\u4e00-\u9fff]/g) || []).length;
  const visible = (sample.match(/\S/g) || []).length;
  if (visible > 200 && lettersAndNumbers / visible < 0.45) flags.push("low_text_signal_ratio");

  const words = sample.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{2,}/g) || [];
  const unique = new Set(words);
  if (words.length > 180 && unique.size / words.length < 0.08) flags.push("repetitive_or_low_quality_text");

  return flags;
}

function buildEvidence(content: string, evidenceSeeds: string[]): string[] {
  const contentLines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-=#_*`\s]+$/.test(line))
    .slice(0, 5)
    .map((line) => line.length > 260 ? `${line.slice(0, 257).trim()}...` : line);

  return Array.from(new Set([...evidenceSeeds, ...contentLines])).slice(0, 12);
}

export function queuePrenoteKnowledgeReview(input: QueuePrenoteKnowledgeReviewInput): SessionMemoryCandidateRecord | null {
  const prenote = conversationLogger.getPrenote(input.prenoteId);
  if (!prenote || prenote.userId !== input.userId) return null;

  const files = conversationLogger.listPrenoteFiles(prenote.id);
  const title = (input.title || prenote.title || "Prenote knowledge").trim();
  const content = (input.content || conversationLogger.getEffectivePrenoteRuntimeContext(prenote) || prenote.extractedText || prenote.sourceText).trim();
  if (!content) return null;

  const fileKeywords = files.flatMap((file) => splitKeywordSeeds(file.fileName.replace(/\.[^.]+$/, "")));
  const keywords = normalizeKeywords([
    ...splitKeywordSeeds(title),
    ...fileKeywords,
    ...(input.keywords ?? []),
    "prenote",
    "uploaded material",
  ]);

  const fileErrors = files.filter((file) => file.status === "error");
  const flags = detectContentQualityFlags(content);
  if (fileErrors.length > 0 || prenote.error.trim()) flags.push("file_extraction_error_requires_review");

  const evidenceSeeds = [
    `Source prenote #${prenote.id}: ${prenote.title}`,
    ...files.slice(0, 6).map((file) => {
      const status = file.status === "ready" ? "ready" : `error: ${file.error || "extraction failed"}`;
      return `File ${file.fileName}: ${status}, extracted ${file.extractedText.length} chars`;
    }),
  ];

  const riskScore = flags.some((flag) => flag !== "prenote_upload_requires_review") ? 0.62 : 0.38;
  const confidence = flags.includes("very_short_prenote_content") || flags.includes("low_text_signal_ratio") ? 0.62 : 0.82;
  const now = new Date().toISOString();

  return conversationLogger.upsertSessionMemoryCandidate({
    userId: input.userId,
    sessionId: `prenote:${prenote.id}`,
    candidateType: "knowledge_fact",
    title,
    category: "knowledge_prenote",
    sensitivity: input.sensitivity ?? "medium",
    content,
    usageRule: input.usageRule?.trim()
      || "Use only when the current conversation is directly related to this reviewed uploaded prenote material.",
    keywords,
    evidence: buildEvidence(content, evidenceSeeds),
    confidence,
    valueScore: 0.76,
    riskScore,
    validation: {
      valid: true,
      safeToPromote: false,
      flags,
      groundedEvidence: buildEvidence(content, evidenceSeeds),
      duplicateMemoryRefs: [],
      dateMetadata: {
        eventTime: now,
        mentionedDate: null,
        dateSource: "session_time_only",
        dateConfidence: 0.2,
        dateEvidence: ["Queued from Prenote upload. No transcript-mentioned date was supplied."],
      },
      reason: "Uploaded Prenote material is staged for manual Memory Review before it can become long-term memory.",
      source: "prenote_upload",
      prenoteId: prenote.id,
      fileCount: files.length,
      fileErrors: fileErrors.map((file) => ({ fileName: file.fileName, error: file.error })),
    },
    status: "pending",
    model: "deterministic:prenote-review",
    rawJson: JSON.stringify({
      source: "prenote_upload",
      prenoteId: prenote.id,
      title: prenote.title,
      fileNames: files.map((file) => file.fileName),
      flags,
    }),
    rejectionReason: "",
  });
}
