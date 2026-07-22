import { expect, test } from "bun:test";
import { parseMemoryRouterTeacherResponse } from "../evenhub-v2/memory-router-labeling";

test("teacher response parser accepts one complete ordered label set", () => {
  const labels = parseMemoryRouterTeacherResponse(JSON.stringify({
    labels: [
      { index: 1, lane: "none", confidence: 0.9 },
      { index: 0, lane: "profile", confidence: 1.2 },
    ],
  }), 2);

  expect(labels).toEqual([
    { index: 0, lane: "profile", confidence: 1 },
    { index: 1, lane: "none", confidence: 0.9 },
  ]);
});

test("teacher response parser rejects missing or duplicate labels", () => {
  expect(() => parseMemoryRouterTeacherResponse(JSON.stringify({
    labels: [
      { index: 0, lane: "none", confidence: 0.8 },
      { index: 0, lane: "profile", confidence: 0.8 },
    ],
  }), 2)).toThrow("memory_router_teacher_incomplete_batch");
});
