import { expect, test } from "bun:test";
import { finalizeSayNextOutput, resolveOpenAiModelConfig, sanitizeSayNextOutput } from "../mastra/agents/initial-agent";

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

test("skips bare opener before useful answer", () => {
  expect(sanitizeSayNextOutput("Sure!\nDalParkAid was a React Native parking app for Dalhousie that used weather and timetable context."))
    .toBe("DalParkAid was a React Native parking app for Dalhousie that used weather and timetable context.");
});

test("resolves separate live and long OpenAI models", () => {
  expect(resolveOpenAiModelConfig({} as NodeJS.ProcessEnv)).toEqual({
    liveModel: "gpt-5.4-nano",
    longModel: "gpt-5.4-mini",
  });

  expect(resolveOpenAiModelConfig({
    OPENAI_MODEL: "gpt-live",
    OPENAI_LONG_MODEL: "gpt-long",
  } as NodeJS.ProcessEnv)).toEqual({
    liveModel: "gpt-live",
    longModel: "gpt-long",
  });
});

test("normalizes written punctuation into spoken display text", () => {
  expect(sanitizeSayNextOutput('For right now, freeze a thin "minimum contract" and lock the request/response shape (e.g., `v1`).'))
    .toBe("For right now, freeze a thin minimum contract and lock the request and response shape, for example v1.");
});

test("normalizes latex-like classroom notation", () => {
  expect(sanitizeSayNextOutput(String.raw`A^T A and \hat{u} can be sensitive depending on the condition number.`))
    .toBe("A transpose A and u-hat can be sensitive depending on the condition number.");
});

test("removes unnecessary cooking follow-up question", () => {
  expect(finalizeSayNextOutput(
    "Sure thing! I'll wash the veggies and prep the chicken while you cook. Any specific way you want the chicken cut?",
    "You can wash the vegetables and cut the chicken and I'll make dinner!",
    "english",
  ))
    .toBe("Sure thing! I'll wash the veggies and prep the chicken while you cook.");
});

test("removes fake casual pretty-chill ending", () => {
  expect(finalizeSayNextOutput(
    "Not really, teaching isn't my thing. I prefer working on projects and systems where I can focus deeply without too much pressure. Pretty chill here.",
    "Would you like to work as a teacher?",
    "english",
    undefined,
    "casual",
  ))
    .toBe("Not really, teaching isn't my thing. I prefer working on projects and systems where I can focus deeply without too much pressure.");
});

test("removes forced public-dialogue question tail", () => {
  expect(finalizeSayNextOutput(
    "He's pretty tall and built, like he could have joined sports instead of the army. Tall too?",
    "I can tell it from your build.",
    "english",
  ))
    .toBe("He's pretty tall and built, like he could have joined sports instead of the army.");
});

test("removes generic tips question tail", () => {
  expect(finalizeSayNextOutput(
    "I try to avoid ordering food when I'm super hungry too. It's hard though, especially with all the takeout ads everywhere. Any other tips?",
    "Three small habits that helped me save money: stop buying random drinks outside, check subscriptions once a month, and do not open food delivery apps when you are already hungry.",
    "english",
  ))
    .toBe("I try to avoid ordering food when I'm super hungry too. It's hard though, especially with all the takeout ads everywhere.");
});

test("removes bare have-you question tail", () => {
  expect(finalizeSayNextOutput(
    "Not really, I haven't seen anything that would qualify as an unforgettable view. Maybe something like sunrise over the ocean could be pretty memorable though. Have you?",
    "Have you seen an unforgettable view?",
    "english",
  ))
    .toBe("Not really, I haven't seen anything that would qualify as an unforgettable view. Maybe something like sunrise over the ocean could be pretty memorable though.");
});

test("removes sports filler question tail", () => {
  expect(finalizeSayNextOutput(
    "Yeah, he's definitely tall and built. Must be from all that training. Are you into sports or anything like that?",
    "I can tell it from your build.",
    "english",
  ))
    .toBe("Yeah, he's definitely tall and built. Must be from all that training.");
});
