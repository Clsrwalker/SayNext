import { expect, test } from "bun:test";
import type { ImmediateRule } from "../saynext/immediate-rule-registry";
import { runImmediateRules } from "../saynext/immediate-rule-registry";
import { Action } from "../mastra/types";

const baseContext = {
  transcript: "Please send the CORS endpoint status but not the deposit.",
  normalized: "Please send the CORS endpoint status but not the deposit.",
  lower: "please send the cors endpoint status but not the deposit.",
  timestamp: 123,
  outputLanguage: "english" as const,
};

test("immediate rule registry respects priority and stable matching", () => {
  const rules: ImmediateRule[] = [
    {
      id: "test:low-priority",
      priority: 10,
      category: "tech_process",
      include: [/cors/i],
      output: "low",
      reasoning: "low priority",
    },
    {
      id: "test:high-priority",
      priority: 20,
      category: "tech_process",
      include: [/cors/i],
      output: "high",
      reasoning: "high priority",
    },
  ];

  const response = runImmediateRules(rules, baseContext);

  expect(response?.type).toBe(Action.INSIGHT);
  if (response?.type === Action.INSIGHT) {
    expect(response.output).toBe("high.");
    expect((response.metadata.agentInput as any).processTrace.rulesFired[0]).toBe("test:high-priority");
  }
});

test("immediate rule registry supports negative patterns", () => {
  const rules: ImmediateRule[] = [
    {
      id: "test:cors-without-money",
      priority: 10,
      category: "tech_process",
      include: [/cors/i],
      exclude: [/deposit/i],
      output: "cors",
      reasoning: "CORS without money risk",
    },
  ];

  expect(runImmediateRules(rules, baseContext)).toBeNull();
});
