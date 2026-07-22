import { expect, test } from "bun:test";
import {
  buildMemoryRouterInput,
  fallbackMemoryLane,
  prewarmMemoryRouter,
  type MemoryRouter,
  type MemoryRouterInput,
} from "../evenhub-v2/memory-router";

test("memory router input contains transcript text only and preserves the latest question", () => {
  expect(buildMemoryRouterInput({
    recentTranscript: [
      "Interviewer: Why are you interested in this role?",
      "Xiang: I like building applied AI products.",
    ].join("\n"),
    current: "What do you think about the ceramic fixate position?",
  })).toEqual({
    segmentMinus2: "Why are you interested in this role?",
    segmentMinus1: "I like building applied AI products.",
    current: "What do you think about the ceramic fixate position?",
  });
});

test("fallback memory lane keeps personal and generic technical questions separate", () => {
  expect(fallbackMemoryLane({
    segmentMinus2: "",
    segmentMinus1: "",
    current: "Where are you from?",
  })).toBe("profile");
  expect(fallbackMemoryLane({
    segmentMinus2: "",
    segmentMinus1: "",
    current: "What AWS services have you used?",
  })).toBe("personal_experience");
  expect(fallbackMemoryLane({
    segmentMinus2: "",
    segmentMinus1: "",
    current: "How would you design a chatbot that answers questions from our website?",
  })).toBe("none");
});

test("prewarmMemoryRouter loads the sidecar with a harmless generic question", async () => {
  const calls: MemoryRouterInput[] = [];
  const router: MemoryRouter = {
    async predict(input) {
      calls.push(input);
      return {
        lane: "none",
        confidence: 0.98,
        probabilities: { none: 0.98 },
        model: "test-memory-router",
        latencyMs: 1,
      };
    },
  };

  await prewarmMemoryRouter(router);

  expect(calls).toEqual([{
    segmentMinus2: "",
    segmentMinus1: "",
    current: "What is the difference between TCP and UDP?",
  }]);
});

test("prewarmMemoryRouter fails open", async () => {
  const router: MemoryRouter = {
    async predict() {
      throw new Error("router unavailable");
    },
  };

  await expect(prewarmMemoryRouter(router)).resolves.toBeUndefined();
});
