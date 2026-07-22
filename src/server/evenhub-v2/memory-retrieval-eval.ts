export type MemoryRetrievalGoldenCase = {
  id: string;
  group: string;
  asrQuestion: string;
  recentContext?: string;
  sourceConversationId: string;
  sourceTranscriptLineIndex: number;
  sourceAttemptId?: string;
  sourceTranscriptKind: string;
  expectedMemoryIds: number[];
  forbiddenMemoryIds: number[];
  rationale: string;
};

export type MemoryRetrievalPrediction = {
  caseId: string;
  memoryIds: number[];
  latencyMs?: number;
};

export type RetrievalRatio = {
  numerator: number;
  denominator: number;
  value: number | null;
};

export type MemoryRetrievalCaseResult = {
  caseId: string;
  expectedMemoryIds: number[];
  forbiddenMemoryIds: number[];
  predictedMemoryIds: number[];
  relevantAt1: boolean;
  relevantCountAt2: number;
  hitAt2: boolean;
  forbiddenHitIds: number[];
  expectedNoMemory: boolean;
  latencyMs: number | null;
};

export type MemoryRetrievalMetrics = {
  caseCount: number;
  memoryRequiredCaseCount: number;
  noMemoryCaseCount: number;
  precisionAt1: RetrievalRatio;
  precisionAt2: RetrievalRatio;
  requiredPrecisionAt1: RetrievalRatio;
  requiredPrecisionAt2: RetrievalRatio;
  hitRateAt1: RetrievalRatio;
  hitRateAt2: RetrievalRatio;
  missRateAt2: RetrievalRatio;
  forbiddenCaseRateAt2: RetrievalRatio;
  noMemoryAccuracy: RetrievalRatio;
  averageReturnedCards: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  cases: MemoryRetrievalCaseResult[];
};

function ratio(numerator: number, denominator: number): RetrievalRatio {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? numerator / denominator : null,
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? null;
}

export function validateMemoryRetrievalGoldenCases(cases: MemoryRetrievalGoldenCase[]): void {
  const seen = new Set<string>();
  for (const testCase of cases) {
    if (!testCase.id.trim()) throw new Error("Golden case id cannot be empty");
    if (seen.has(testCase.id)) throw new Error(`Duplicate golden case id: ${testCase.id}`);
    seen.add(testCase.id);

    const expected = new Set(testCase.expectedMemoryIds);
    const overlap = testCase.forbiddenMemoryIds.filter((id) => expected.has(id));
    if (overlap.length) {
      throw new Error(`Golden case ${testCase.id} marks memory IDs as both expected and forbidden: ${overlap.join(", ")}`);
    }
    if (!testCase.asrQuestion.trim()) throw new Error(`Golden case ${testCase.id} has an empty ASR question`);
  }
}

export function evaluateMemoryRetrieval(
  cases: MemoryRetrievalGoldenCase[],
  predictions: MemoryRetrievalPrediction[],
): MemoryRetrievalMetrics {
  validateMemoryRetrievalGoldenCases(cases);
  const predictionByCase = new Map(predictions.map((prediction) => [prediction.caseId, prediction]));
  const knownCaseIds = new Set(cases.map((testCase) => testCase.id));
  const unknownPrediction = predictions.find((prediction) => !knownCaseIds.has(prediction.caseId));
  if (unknownPrediction) throw new Error(`Prediction references unknown case: ${unknownPrediction.caseId}`);

  let relevantAt1 = 0;
  let predictionsAt1 = 0;
  let relevantAt2 = 0;
  let predictionsAt2 = 0;
  let requiredRelevantAt1 = 0;
  let requiredPredictionsAt1 = 0;
  let requiredRelevantAt2 = 0;
  let requiredPredictionsAt2 = 0;
  let requiredHitAt1 = 0;
  let requiredHitAt2 = 0;
  let forbiddenCases = 0;
  let noMemoryCorrect = 0;
  let returnedCards = 0;
  const latencies: number[] = [];

  const results = cases.map((testCase): MemoryRetrievalCaseResult => {
    const prediction = predictionByCase.get(testCase.id);
    const predictedMemoryIds = [...new Set(prediction?.memoryIds ?? [])].slice(0, 2);
    const expected = new Set(testCase.expectedMemoryIds);
    const forbidden = new Set(testCase.forbiddenMemoryIds);
    const expectedNoMemory = expected.size === 0;
    const first = predictedMemoryIds[0];
    const isRelevantAt1 = first !== undefined && expected.has(first);
    const relevantCountAt2 = predictedMemoryIds.filter((id) => expected.has(id)).length;
    const hitAt2 = relevantCountAt2 > 0;
    const forbiddenHitIds = predictedMemoryIds.filter((id) => forbidden.has(id));

    returnedCards += predictedMemoryIds.length;
    predictionsAt2 += predictedMemoryIds.length;
    relevantAt2 += relevantCountAt2;
    if (first !== undefined) {
      predictionsAt1 += 1;
      if (isRelevantAt1) relevantAt1 += 1;
    }
    if (!expectedNoMemory) {
      requiredPredictionsAt2 += predictedMemoryIds.length;
      requiredRelevantAt2 += relevantCountAt2;
      if (first !== undefined) {
        requiredPredictionsAt1 += 1;
        if (isRelevantAt1) requiredRelevantAt1 += 1;
      }
      if (isRelevantAt1) requiredHitAt1 += 1;
      if (hitAt2) requiredHitAt2 += 1;
    } else if (predictedMemoryIds.length === 0) {
      noMemoryCorrect += 1;
    }
    if (forbiddenHitIds.length) forbiddenCases += 1;
    if (Number.isFinite(prediction?.latencyMs)) latencies.push(Number(prediction?.latencyMs));

    return {
      caseId: testCase.id,
      expectedMemoryIds: [...testCase.expectedMemoryIds],
      forbiddenMemoryIds: [...testCase.forbiddenMemoryIds],
      predictedMemoryIds,
      relevantAt1: isRelevantAt1,
      relevantCountAt2,
      hitAt2,
      forbiddenHitIds,
      expectedNoMemory,
      latencyMs: Number.isFinite(prediction?.latencyMs) ? Number(prediction?.latencyMs) : null,
    };
  });

  const requiredCount = cases.filter((testCase) => testCase.expectedMemoryIds.length > 0).length;
  const noMemoryCount = cases.length - requiredCount;
  return {
    caseCount: cases.length,
    memoryRequiredCaseCount: requiredCount,
    noMemoryCaseCount: noMemoryCount,
    precisionAt1: ratio(relevantAt1, predictionsAt1),
    precisionAt2: ratio(relevantAt2, predictionsAt2),
    requiredPrecisionAt1: ratio(requiredRelevantAt1, requiredPredictionsAt1),
    requiredPrecisionAt2: ratio(requiredRelevantAt2, requiredPredictionsAt2),
    hitRateAt1: ratio(requiredHitAt1, requiredCount),
    hitRateAt2: ratio(requiredHitAt2, requiredCount),
    missRateAt2: ratio(requiredCount - requiredHitAt2, requiredCount),
    forbiddenCaseRateAt2: ratio(forbiddenCases, cases.length),
    noMemoryAccuracy: ratio(noMemoryCorrect, noMemoryCount),
    averageReturnedCards: cases.length ? returnedCards / cases.length : 0,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    cases: results,
  };
}
