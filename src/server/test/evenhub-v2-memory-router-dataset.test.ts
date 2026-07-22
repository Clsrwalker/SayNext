import { expect, test } from "bun:test";
import {
  dedupeMemoryRouterCandidates,
  parseMemoryRouterAnnotationBatch,
  parseRealTranscriptCandidates,
  serializeMemoryRouterInput,
} from "../evenhub-v2/memory-router-dataset";

test("memory router dataset reads only the three transcript fields as model input", () => {
  const rows = parseMemoryRouterAnnotationBatch(`
=== ITEM 007 ===
SOURCE_DATASET: private-source-that-must-not-be-input
SPLIT_GROUP_ID: conversation-1
MODEL_INPUT_BEGIN
SEGMENT_-2: We were discussing the role.
SEGMENT_-1: Why do you like applied AI?
CURRENT: Why do you want this position?
MODEL_INPUT_END
HUMAN_CUE_NEEDED: 1
HUMAN_RATIONALE: private annotation metadata
`, "batch_001.txt");

  expect(rows).toHaveLength(1);
  expect(serializeMemoryRouterInput(rows[0])).toBe(
    "<SEG_MINUS_2> We were discussing the role. <SEG_MINUS_1> Why do you like applied AI? <CURRENT> Why do you want this position?",
  );
  expect(serializeMemoryRouterInput(rows[0])).not.toContain("private-source");
  expect(serializeMemoryRouterInput(rows[0])).not.toContain("HUMAN_CUE_NEEDED");
  expect(rows[0].group).toBe("conversation-1");
});

test("memory router dataset marks synthetic transcript variants as augmentation", () => {
  const rows = parseMemoryRouterAnnotationBatch(`
=== ITEM 001 ===
SPLIT_GROUP_ID: manual-profile-1
TEXT_REGIME: SYNTHETIC_PUNCTUATION_AUGMENTATION_ONLY
MODEL_INPUT_BEGIN
SEGMENT_-2:
SEGMENT_-1: Okay lets begin
CURRENT: uh can you tell me a little about yourself
MODEL_INPUT_END
`, "memory_router_manual_positive_asr_v1.txt");

  expect(rows).toHaveLength(1);
  expect(rows[0].origin).toBe("augmentation");
  expect(serializeMemoryRouterInput(rows[0])).not.toContain("TEXT_REGIME");
});

test("real transcript candidates keep question-like lines and deduplicate repeated ASR text", () => {
  const rows = parseRealTranscriptCandidates([
    "I built SayNext as a live conversation assistant.",
    "what major you study",
    "what major you study",
    "",
    "How would you design a chatbot?",
  ].join("\n"));

  expect(rows.map((row) => row.current)).toEqual([
    "what major you study",
    "How would you design a chatbot?",
  ]);
  expect(rows[0].segmentMinus1).toBe("I built SayNext as a live conversation assistant.");
  expect(rows[1].segmentMinus1).toBe("");
  expect(rows[0].group).not.toBe(rows[1].group);
});

test("real transcript questions from the same conversation share a split group", () => {
  const rows = parseRealTranscriptCandidates([
    "We were discussing my recent software work.",
    "What have you been working on recently?",
    "Why did you choose that project?",
    "",
    "What is Kubernetes?",
  ].join("\n"));

  expect(rows).toHaveLength(3);
  expect(rows[0].group).toBe(rows[1].group);
  expect(rows[2].group).not.toBe(rows[0].group);
});

test("golden questions are excluded before memory-router training", () => {
  const rows = parseRealTranscriptCandidates([
    "Where are you from?",
    "What is Kubernetes?",
  ].join("\n"));

  expect(dedupeMemoryRouterCandidates(rows, ["where are you from?"]).map((row) => row.current))
    .toEqual(["What is Kubernetes?"]);
});
