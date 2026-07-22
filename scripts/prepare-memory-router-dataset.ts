import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  dedupeMemoryRouterCandidates,
  parseMemoryRouterAnnotationBatch,
  parseRealTranscriptCandidates,
  type MemoryRouterCandidate,
} from "../src/server/evenhub-v2/memory-router-dataset";

type GoldenFile = {
  cases?: Array<{ asrQuestion?: string }>;
};

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

function readGoldenQuestions(path: string): string[] {
  const golden = JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
  return (golden.cases || []).map((testCase) => testCase.asrQuestion || "").filter(Boolean);
}

function originCounts(candidates: MemoryRouterCandidate[]): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.origin] = (counts[candidate.origin] || 0) + 1;
    return counts;
  }, {});
}

const annotationsDir = resolve(argument("annotations", "annotation_batches"));
const transcriptPath = resolve(argument("transcripts", "data/review/saynext-transcripts-training-2026-07-17.txt"));
const goldenPath = resolve(argument("golden", "data/eval/evenhub-v2-real-asr-memory-retrieval-golden-v1.json"));
const outputPath = resolve(argument("output", "data/review/saynext-memory-router-v1-candidates.jsonl"));

const annotationCandidates = readdirSync(annotationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
  .sort((left, right) => left.name.localeCompare(right.name))
  .flatMap((entry) => parseMemoryRouterAnnotationBatch(
    readFileSync(join(annotationsDir, entry.name), "utf8"),
    entry.name,
  ));
const realTranscriptCandidates = parseRealTranscriptCandidates(readFileSync(transcriptPath, "utf8"));
const goldenQuestions = readGoldenQuestions(goldenPath);
const candidates = dedupeMemoryRouterCandidates(
  [...annotationCandidates, ...realTranscriptCandidates],
  goldenQuestions,
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${candidates.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  outputPath,
  annotationCandidates: annotationCandidates.length,
  realTranscriptCandidates: realTranscriptCandidates.length,
  goldenQuestionsExcluded: goldenQuestions.length,
  finalCandidates: candidates.length,
  origins: originCounts(candidates),
}, null, 2));
