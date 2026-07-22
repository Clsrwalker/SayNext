import { describe, expect, test } from "bun:test";
import {
  evaluateMemoryRetrieval,
  validateMemoryRetrievalGoldenCases,
  type MemoryRetrievalGoldenCase,
} from "../evenhub-v2/memory-retrieval-eval";

const goldenPath = "data/eval/evenhub-v2-real-asr-memory-retrieval-golden-v1.json";

function goldenCase(
  id: string,
  expectedMemoryIds: number[],
  forbiddenMemoryIds: number[] = [],
): MemoryRetrievalGoldenCase {
  return {
    id,
    group: "test",
    asrQuestion: `question ${id}`,
    sourceConversationId: "conversation",
    sourceTranscriptLineIndex: 1,
    sourceTranscriptKind: "assemblyai",
    expectedMemoryIds,
    forbiddenMemoryIds,
    rationale: "test fixture",
  };
}

describe("EvenHub v2 memory retrieval golden metrics", () => {
  test("real-ASR golden set keeps required and no-memory cases explicitly annotated", async () => {
    const golden = await Bun.file(goldenPath).json() as {
      cases: MemoryRetrievalGoldenCase[];
    };

    validateMemoryRetrievalGoldenCases(golden.cases);
    expect(golden.cases.length).toBe(31);
    expect(golden.cases.filter((testCase) => testCase.expectedMemoryIds.length > 0).length).toBe(19);
    expect(golden.cases.filter((testCase) => testCase.expectedMemoryIds.length === 0).length).toBe(12);
    expect(golden.cases.every((testCase) => testCase.forbiddenMemoryIds.length > 0)).toBe(true);
    expect(golden.cases.some((testCase) => /Hyperset Memory/.test(testCase.asrQuestion))).toBe(true);
  });

  test("computes precision, miss rate, forbidden hits, and no-memory accuracy", () => {
    const metrics = evaluateMemoryRetrieval(
      [
        goldenCase("relevant-and-forbidden", [1, 2], [3]),
        goldenCase("miss", [4], [5]),
        goldenCase("no-memory", [], [1, 2, 3, 4, 5]),
      ],
      [
        { caseId: "relevant-and-forbidden", memoryIds: [1, 3], latencyMs: 10 },
        { caseId: "miss", memoryIds: [5], latencyMs: 30 },
        { caseId: "no-memory", memoryIds: [], latencyMs: 20 },
      ],
    );

    expect(metrics.precisionAt1).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(metrics.precisionAt2).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(metrics.requiredPrecisionAt1.value).toBe(0.5);
    expect(metrics.requiredPrecisionAt2.value).toBe(1 / 3);
    expect(metrics.hitRateAt1.value).toBe(0.5);
    expect(metrics.hitRateAt2.value).toBe(0.5);
    expect(metrics.missRateAt2.value).toBe(0.5);
    expect(metrics.forbiddenCaseRateAt2.value).toBe(2 / 3);
    expect(metrics.noMemoryAccuracy.value).toBe(1);
    expect(metrics.averageReturnedCards).toBe(1);
    expect(metrics.latencyP50Ms).toBe(20);
    expect(metrics.latencyP95Ms).toBe(30);
  });

  test("treats an omitted prediction as an empty retrieval", () => {
    const metrics = evaluateMemoryRetrieval(
      [goldenCase("required", [1]), goldenCase("no-memory", [])],
      [],
    );

    expect(metrics.missRateAt2.value).toBe(1);
    expect(metrics.noMemoryAccuracy.value).toBe(1);
    expect(metrics.precisionAt1.value).toBeNull();
    expect(metrics.precisionAt2.value).toBeNull();
    expect(metrics.requiredPrecisionAt1.value).toBeNull();
    expect(metrics.requiredPrecisionAt2.value).toBeNull();
  });

  test("rejects contradictory annotations", () => {
    expect(() => validateMemoryRetrievalGoldenCases([
      goldenCase("contradiction", [7], [7]),
    ])).toThrow("both expected and forbidden");
  });

  test("rejects predictions for unknown cases", () => {
    expect(() => evaluateMemoryRetrieval(
      [goldenCase("known", [1])],
      [{ caseId: "unknown", memoryIds: [1] }],
    )).toThrow("unknown case");
  });
});
