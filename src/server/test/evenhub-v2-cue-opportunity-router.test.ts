import { expect, test } from "bun:test";
import {
  prewarmCueOpportunityRouter,
  type CueOpportunityRouter,
  type CueOpportunityRouterInput,
} from "../evenhub-v2/cue-opportunity-router";

test("prewarmCueOpportunityRouter loads the sidecar with a harmless no-cue sample", async () => {
  const calls: CueOpportunityRouterInput[] = [];
  const router: CueOpportunityRouter = {
    async predict(input) {
      calls.push(input);
      return {
        probability: 0.1,
        decision: "no_cue",
        threshold: 0.5,
        model: "test-router",
        latencyMs: 1,
      };
    },
  };

  await prewarmCueOpportunityRouter(router);

  expect(calls).toEqual([{
    segmentMinus2: "",
    segmentMinus1: "",
    current: "Thanks, that makes sense.",
  }]);
});

test("prewarmCueOpportunityRouter fails open", async () => {
  const router: CueOpportunityRouter = {
    async predict() {
      throw new Error("router unavailable");
    },
  };

  await expect(prewarmCueOpportunityRouter(router)).resolves.toBeUndefined();
});
