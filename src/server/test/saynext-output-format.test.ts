import { expect, test } from "bun:test";
import { sanitizeSayNextOutput } from "../mastra/agents/initial-agent";

test("removes you-can-say prefix", () => {
  expect(sanitizeSayNextOutput("You can say: I'm leaning toward co-op, but I'm still checking the deadline."))
    .toBe("I'm leaning toward co-op, but I'm still checking the deadline.");
});

test("keeps only first option", () => {
  expect(sanitizeSayNextOutput("Option 1: I'm still learning, but I can explain my project.\nOption 2: I am an expert."))
    .toBe("I'm still learning, but I can explain my project.");
});

test("removes bullet formatting", () => {
  expect(sanitizeSayNextOutput("- Sorry, could you repeat the last part?"))
    .toBe("Sorry, could you repeat the last part?");
});

test("skips explanation lines", () => {
  expect(sanitizeSayNextOutput("Explanation: The speaker is asking about co-op.\nSay: I'm leaning toward co-op, but I'm still checking the requirements."))
    .toBe("I'm leaning toward co-op, but I'm still checking the requirements.");
});

test("keeps simple direct answer unchanged", () => {
  expect(sanitizeSayNextOutput("I used Firebase Authentication and Firestore for that project."))
    .toBe("I used Firebase Authentication and Firestore for that project.");
});

test("replaces bare acknowledgement with clarification", () => {
  expect(sanitizeSayNextOutput("Sure!"))
    .toBe("Sure, could you repeat the full question?");
});
