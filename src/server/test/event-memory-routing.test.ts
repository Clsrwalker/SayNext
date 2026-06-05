import { expect, test } from "bun:test";
import { classifyScene, shouldStartNewEvent } from "../memory/event-memory";
import { routeFastScene } from "../scene/fast-scene-router";

test("coding interview setup is classified as interview rather than classroom", () => {
  const cases = [
    "We're going to use CoderPad for this interview, then start with object-oriented design.",
    "This is a technical interview; first we will do an OOD question and then an algorithms question.",
    "For this coding interview, please share code and talk through your approach.",
  ];

  for (const transcript of cases) {
    expect(classifyScene(transcript)).toBe("interview");
  }
});

test("active interview does not drift to classroom or group discussion for OOD prompts", () => {
  const now = Date.now();
  const current = { scene: "interview", lastTimestamp: now };
  const oodAsk = "I really want to think about what components are important. This is an object-oriented design question, and I'm curious how you would structure the core foundation.";

  expect(shouldStartNewEvent(current, "classroom", now + 10_000, oodAsk)).toBe(false);
  expect(shouldStartNewEvent(current, "group_discussion", now + 10_000, oodAsk)).toBe(false);
});

test("fast scene router keeps realistic coding interview prompts in interview scene", () => {
  const cases = [
    "We're going to use CoderPad for this interview, then start with object-oriented design.",
    "For this coding interview, please share code and talk through your approach.",
    "I really want to think about what components are important for this online reading app.",
    "What data structures would you use before you start coding?",
  ];

  for (const latestTranscript of cases) {
    expect(routeFastScene({ latestTranscript }).sceneKey).toBe("interview");
  }
});

test("fast scene router does not let previous interview drift on follow-up OOD wording", () => {
  const route = routeFastScene({
    previousSceneKey: "interview",
    recentTranscripts: [
      "This is a technical interview and we'll start in CoderPad.",
      "The prompt is an online reading app with active books and pages.",
    ],
    latestTranscript: "I'm curious how you would structure the core classes and components.",
  });

  expect(route.sceneKey).toBe("interview");
  expect(route.scores.interview).toBeGreaterThan(route.scores.classroom);
  expect(route.scores.interview).toBeGreaterThan(route.scores.meeting_group);
});
