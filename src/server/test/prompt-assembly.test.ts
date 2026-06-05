import { expect, test } from "bun:test";
import { buildAnswerIntentHint, classifyAnswerIntent } from "../saynext/answer-intent";
import {
  buildLiveXiangProfile,
  compactRuntimeContextBlock,
  filterRuntimePersonalMemoryContext,
} from "../saynext/context-builder";
import { buildSayNextLiveTaskPrompt } from "../saynext/prompts";

test("interview prompt includes top memory context for GPT to use", () => {
  const latestTranscript = "How would you explain your backend experience?";
  const promptMode = "interview";
  const memoryContext = [
    "Personal memory candidates:",
    "[1] sourceRef=project:joblens facet=architecture",
    "Title: JobLens backend architecture",
    "Facts:",
    "- JobLens used AWS Lambda, API Gateway, DynamoDB, S3, and a resume/job matching workflow.",
    "- Xiang worked on backend integration, data flow, and debugging.",
    "",
    "---",
    "",
    "[2] sourceRef=project:elderalbum facet=architecture",
    "Title: ElderAlbum backend architecture",
    "Facts:",
    "- ElderAlbum used Lambda-triggered metadata processing.",
  ].join("\n");

  const answerIntent = classifyAnswerIntent(latestTranscript, promptMode);
  const answerIntentHint = buildAnswerIntentHint(answerIntent);
  const filteredMemoryContext = filterRuntimePersonalMemoryContext(
    memoryContext,
    latestTranscript,
    promptMode,
  );
  const supportContext = compactRuntimeContextBlock([
    buildLiveXiangProfile(promptMode),
    compactRuntimeContextBlock(filteredMemoryContext, 1400),
  ].filter(Boolean).join("\n"), 2600);

  const prompt = buildSayNextLiveTaskPrompt({
    formattedSceneProfile: "Scene: Interview",
    promptMode,
    supportContext,
    routeHints: "",
    answerIntentHint,
  });

  expect(answerIntent).toBe("interview_project");
  expect(prompt).toContain("Relevant private context candidates");
  expect(prompt).toContain("JobLens backend architecture");
  expect(prompt).toContain("AWS Lambda, API Gateway, DynamoDB, S3");
  expect(prompt).toContain("ElderAlbum backend architecture");
  expect(prompt).toContain("use the most relevant named project from memory");
});

test("coding interview prompt asks for concrete code when interviewer requests pseudocode", () => {
  const latestTranscript = "I would love to see some Python pseudocode to flesh out one of these classes.";
  const promptMode = "interview";
  const answerIntent = classifyAnswerIntent(latestTranscript, promptMode);
  const prompt = buildSayNextLiveTaskPrompt({
    formattedSceneProfile: "Scene: Interview",
    promptMode,
    supportContext: "",
    routeHints: "",
    answerIntentHint: buildAnswerIntentHint(answerIntent),
  });

  expect(answerIntent).toBe("interview_code_solution");
  expect(prompt).toContain("actual code");
  expect(prompt).toContain("not just say what you would write");
  expect(prompt).toContain("short comment");
});
