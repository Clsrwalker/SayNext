import { MEMORY_LANES, type MemoryLane } from "./memory-router";

export type MemoryRouterTeacherLabel = {
  index: number;
  lane: MemoryLane;
  confidence: number;
};

type TeacherEnvelope = {
  labels?: unknown;
};

export function parseMemoryRouterTeacherResponse(
  value: string,
  expectedCount: number,
): MemoryRouterTeacherLabel[] {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("memory_router_teacher_invalid_json");
  const parsed = JSON.parse(value.slice(start, end + 1)) as TeacherEnvelope;
  if (!Array.isArray(parsed.labels)) throw new Error("memory_router_teacher_missing_labels");

  const labels = parsed.labels.map((raw): MemoryRouterTeacherLabel => {
    const item = raw as Record<string, unknown>;
    const index = Number(item.index);
    const lane = String(item.lane || "") as MemoryLane;
    const confidence = Number(item.confidence);
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
      throw new Error("memory_router_teacher_invalid_index");
    }
    if (!MEMORY_LANES.includes(lane)) throw new Error("memory_router_teacher_invalid_lane");
    if (!Number.isFinite(confidence)) throw new Error("memory_router_teacher_invalid_confidence");
    return { index, lane, confidence: Math.max(0, Math.min(1, confidence)) };
  });

  const byIndex = new Map(labels.map((label) => [label.index, label]));
  if (byIndex.size !== expectedCount) throw new Error("memory_router_teacher_incomplete_batch");
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}
