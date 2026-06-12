import { expect, test } from "bun:test";
import {
  buildSayNextConversationStateSeedInstructions,
  isSayNextSingleLlmMode,
} from "../saynext/prompts";
import {
  estimateSayNextStartupMemorySeedTokens,
  getSayNextStartupMemorySeed,
} from "../saynext/startup-memory-seed";

test("single LLM mode is explicitly opt in", () => {
  expect(isSayNextSingleLlmMode({} as NodeJS.ProcessEnv)).toBe(false);
  expect(isSayNextSingleLlmMode({ SAYNEXT_RESPONSE_MODE: "single_llm" } as NodeJS.ProcessEnv)).toBe(true);
  expect(isSayNextSingleLlmMode({ SAYNEXT_LLM_CONTROL_MODE: "one_llm" } as NodeJS.ProcessEnv)).toBe(true);
});

test("startup memory seed contains compact Xiang facts without review metadata", () => {
  const seed = getSayNextStartupMemorySeed();

  expect(estimateSayNextStartupMemorySeedTokens()).toBeLessThan(5000);
  expect(seed).toContain("Xiang Li is a Chinese international student");
  expect(seed).toContain("JobLens AI");
  expect(seed).toContain("AI Meeting Monitor");
  expect(seed).not.toContain("Category:");
  expect(seed).not.toContain("Sensitivity:");
  expect(seed).not.toContain("Runtime Use Contract");
  expect(seed).not.toContain("Hard rules:");
});

test("single LLM conversation seed combines hard boundaries, memory, and structured output contract", () => {
  const instructions = buildSayNextConversationStateSeedInstructions({ singleLlm: true });

  expect(instructions).toContain("single-call planner and final answer writer");
  expect(instructions).toContain('"task"');
  expect(instructions).toContain('"depth"');
  expect(instructions).toContain('"usedMemory"');
  expect(instructions).toContain('"output"');
  expect(instructions).toContain("Seeded Xiang memory facts:");
  expect(instructions).toContain("Xiang is now in the Master of Applied Computer Science program");
  expect(instructions).not.toContain("needsMemory");
});

test("legacy conversation seed stays answer-only and does not include startup memory", () => {
  const instructions = buildSayNextConversationStateSeedInstructions({ singleLlm: false });

  expect(instructions).toContain("Return only the answer");
  expect(instructions).not.toContain("Seeded Xiang memory facts:");
  expect(instructions).not.toContain('"usedMemory"');
});
