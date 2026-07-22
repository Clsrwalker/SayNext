import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  parseMemoryRouterAnnotationBatch,
} from "../src/server/evenhub-v2/memory-router-dataset";
import { MEMORY_LANES, type MemoryLane } from "../src/server/evenhub-v2/memory-router";

type HumanLabel = {
  id: string;
  memoryLane: MemoryLane;
  labelConfidence: 1;
  labelSource: "human";
};

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readJsonLines(path: string): HumanLabel[] {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HumanLabel);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

const inputPath = resolve(argument("input", "annotation_batches/memory_router_manual_positive_asr_v1.txt"));
const outputPath = resolve(argument("output", "annotation_batches/memory_router_human_labels_v1.jsonl"));
const input = readFileSync(inputPath, "utf8");
const candidates = parseMemoryRouterAnnotationBatch(input, basename(inputPath));
const laneByItem = new Map<string, MemoryLane>();

const headers = [...input.matchAll(/^=== ITEM (\d+) ===\s*$/gm)];
for (const [index, match] of headers.entries()) {
  const bodyStart = (match.index || 0) + match[0].length;
  const bodyEnd = headers[index + 1]?.index ?? input.length;
  const body = input.slice(bodyStart, bodyEnd);
  const lane = /^HUMAN_MEMORY_LANE:\s*(\S+)\s*$/m.exec(body)?.[1] as MemoryLane | undefined;
  if (!lane || !MEMORY_LANES.includes(lane)) {
    throw new Error(`invalid or missing HUMAN_MEMORY_LANE for item ${match[1]}`);
  }
  laneByItem.set(match[1], lane);
}

if (laneByItem.size !== candidates.length) {
  throw new Error(`manual label count mismatch: labels=${laneByItem.size} candidates=${candidates.length}`);
}

const labels = new Map(readJsonLines(outputPath).map((label) => [label.id, label]));
for (const candidate of candidates) {
  const item = /#item_(\d+)$/.exec(candidate.sourceRef)?.[1];
  const memoryLane = item ? laneByItem.get(item) : undefined;
  if (!memoryLane) throw new Error(`missing lane for ${candidate.sourceRef}`);
  labels.set(candidate.id, {
    id: candidate.id,
    memoryLane,
    labelConfidence: 1,
    labelSource: "human",
  });
}

writeFileSync(outputPath, `${[...labels.values()].map((label) => JSON.stringify(label)).join("\n")}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  imported: candidates.length,
  totalHumanLabels: labels.size,
  outputPath,
}, null, 2)}\n`);
