import { readFileSync } from "node:fs";

type Candidate = {
  id: string;
  group: string;
  segmentMinus2: string;
  segmentMinus1: string;
  current: string;
};

type Label = {
  id: string;
  memoryLane?: string;
};

function readJsonLines<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const candidatesPath = option("candidates", "data/review/saynext-memory-router-v1-candidates.jsonl");
const labelsPath = option("labels", "annotation_batches/memory_router_human_labels_v1.jsonl");
const teacherLabelsPath = option("teacher-labels", "");
const teacherLane = option("teacher-lane", "");
const pattern = new RegExp(option("pattern", "."), "i");
const limit = Math.max(1, Number(option("limit", "50")) || 50);
const scope = option("scope", "all");
const usedIds = new Set(readJsonLines<Label>(labelsPath).map((label) => label.id));
const teacherLabels = teacherLabelsPath
  ? new Map(readJsonLines<Label>(teacherLabelsPath).map((label) => [label.id, label.memoryLane || ""]))
  : null;
const candidates = readJsonLines<Candidate>(candidatesPath);

let emitted = 0;
for (const candidate of candidates) {
  if (usedIds.has(candidate.id)) continue;
  if (teacherLabels && teacherLane && teacherLabels.get(candidate.id) !== teacherLane) continue;
  const transcript = scope === "current"
    ? candidate.current
    : [candidate.segmentMinus2, candidate.segmentMinus1, candidate.current].join(" ");
  if (!pattern.test(transcript)) continue;
  process.stdout.write(`${JSON.stringify({
    id: candidate.id,
    group: candidate.group,
    segmentMinus2: candidate.segmentMinus2,
    segmentMinus1: candidate.segmentMinus1,
    current: candidate.current,
  })}\n`);
  emitted += 1;
  if (emitted >= limit) break;
}

process.stderr.write(`review_candidates=${emitted}\n`);
