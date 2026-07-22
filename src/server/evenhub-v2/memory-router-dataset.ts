import { createHash } from "node:crypto";

export type MemoryRouterCandidate = {
  id: string;
  segmentMinus2: string;
  segmentMinus1: string;
  current: string;
  group: string;
  origin: "annotation_batch" | "real_transcript" | "augmentation";
  sourceRef: string;
};

function field(body: string, name: string): string {
  const match = new RegExp(`^${name}:\\s?(.*)$`, "m").exec(body);
  return match?.[1]?.trim() || "";
}

export function normalizeRouterTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function serializeMemoryRouterInput(input: Pick<MemoryRouterCandidate, "segmentMinus2" | "segmentMinus1" | "current">): string {
  return [
    `<SEG_MINUS_2> ${normalizeRouterTranscript(input.segmentMinus2)}`,
    `<SEG_MINUS_1> ${normalizeRouterTranscript(input.segmentMinus1)}`,
    `<CURRENT> ${normalizeRouterTranscript(input.current)}`,
  ].join(" ");
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

export function parseMemoryRouterAnnotationBatch(text: string, fileName: string): MemoryRouterCandidate[] {
  const candidates: MemoryRouterCandidate[] = [];
  const headers = [...text.matchAll(/^=== ITEM (\d+) ===\s*$/gm)];
  for (const [index, match] of headers.entries()) {
    const bodyStart = (match.index || 0) + match[0].length;
    const bodyEnd = headers[index + 1]?.index ?? text.length;
    const body = text.slice(bodyStart, bodyEnd);
    const modelInput = /MODEL_INPUT_BEGIN\s*\r?\n([\s\S]*?)\r?\nMODEL_INPUT_END/.exec(body)?.[1] || "";
    const current = normalizeRouterTranscript(field(modelInput, "CURRENT"));
    if (!current) continue;
    const segmentMinus2 = normalizeRouterTranscript(field(modelInput, "SEGMENT_-2"));
    const segmentMinus1 = normalizeRouterTranscript(field(modelInput, "SEGMENT_-1"));
    const group = field(body, "SPLIT_GROUP_ID")
      || field(body, "DOCUMENT_GROUP_ID")
      || `${fileName}#item_${match[1]}`;
    const textRegime = field(body, "TEXT_REGIME");
    const sourceRef = `${fileName}#item_${match[1]}`;
    candidates.push({
      id: stableId("annotation", sourceRef),
      segmentMinus2,
      segmentMinus1,
      current,
      group,
      origin: textRegime === "SYNTHETIC_PUNCTUATION_AUGMENTATION_ONLY"
        ? "augmentation"
        : "annotation_batch",
      sourceRef,
    });
  }
  return candidates;
}

export function isQuestionLikeTranscript(value: string): boolean {
  const normalized = normalizeRouterTranscript(value);
  if (!normalized || normalized.length < 4 || normalized.length > 420) return false;
  if (normalized.includes("?")) return true;
  return /^(?:uh+\s+|um+\s+|okay\s+|ok\s+|so\s+|well\s+)*(?:what|why|how|where|when|who|which|can|could|would|should|do|does|did|are|is|have|has|tell|walk|describe|explain|give)\b/i.test(normalized);
}

export function parseRealTranscriptCandidates(text: string): MemoryRouterCandidate[] {
  const seen = new Set<string>();
  const candidates: MemoryRouterCandidate[] = [];
  const conversations = text
    .split(/(?:\r?\n)\s*(?:\r?\n)+/)
    .map((block) => block.split(/\r?\n/).map(normalizeRouterTranscript).filter(Boolean))
    .filter((lines) => lines.length > 0);

  for (const lines of conversations) {
    const group = stableId("real_group", lines.join("\n").toLowerCase());
    let context: string[] = [];
    for (const current of lines) {
      if (!isQuestionLikeTranscript(current)) {
        context = [...context, current].slice(-2);
        continue;
      }
      const normalized = current.toLowerCase();
      if (seen.has(normalized)) {
        context = [...context, current].slice(-2);
        continue;
      }
      seen.add(normalized);
      const sourceRef = `real_transcript#line_${stableId("text", normalized).slice(-16)}`;
      candidates.push({
        id: stableId("real", normalized),
        segmentMinus2: context.at(-2) || "",
        segmentMinus1: context.at(-1) || "",
        current,
        group,
        origin: "real_transcript",
        sourceRef,
      });
      context = [...context, current].slice(-2);
    }
  }
  return candidates;
}

export function dedupeMemoryRouterCandidates(
  candidates: MemoryRouterCandidate[],
  excludedCurrent: Iterable<string> = [],
): MemoryRouterCandidate[] {
  const excluded = new Set([...excludedCurrent].map((value) => normalizeRouterTranscript(value).toLowerCase()));
  const seen = new Set<string>();
  const result: MemoryRouterCandidate[] = [];
  for (const candidate of candidates) {
    if (excluded.has(normalizeRouterTranscript(candidate.current).toLowerCase())) continue;
    const key = serializeMemoryRouterInput(candidate).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}
