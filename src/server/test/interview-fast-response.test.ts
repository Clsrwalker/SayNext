import { expect, test } from "bun:test";
import { processConversation } from "../mastra/agents/initial-agent";
import { Action } from "../mastra/types";

test("returns a direct intro and cloud interest answer without waiting for model", async () => {
  const response = await processConversation([
    {
      type: "transcript",
      text: "Can you briefly introduce yourself and tell me why you're interested in cloud engineering?",
      timestamp: Date.now(),
    },
  ]);

  expect(response.type).toBe(Action.INSIGHT);
  if (response.type === Action.INSIGHT) {
    expect(response.output).toContain("I'm Xiang Li");
    expect(response.output).toContain("cloud engineering");
    expect(response.output).not.toBe("Sure.");
  }
});
