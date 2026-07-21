import { expect, test } from "bun:test";
import {
  buildDeepSenseInterviewSeed,
  findDeepSenseInterviewCard,
  loadDeepSenseInterviewGuide,
  parseDeepSenseInterviewGuide,
} from "../evenhub-v2/interview-guide";

test("DeepSense guide parser extracts the 100 interview question cards", () => {
  const guide = loadDeepSenseInterviewGuide();
  const cards = parseDeepSenseInterviewGuide(guide);

  expect(cards).toHaveLength(100);
  expect(cards[0]).toMatchObject({
    question: "Tell me a little about yourself.",
  });
  expect(cards[0].exampleAnswer).toContain("I’m Xiang");
  expect(cards.some((card) => card.question === "How would you deploy a chatbot on AWS?")).toBe(true);
});

test("DeepSense guide matches imperfect ASR wording to the intended answer card", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());

  const intro = findDeepSenseInterviewCard("so tell me little bit about yourself okay", cards);
  const rag = findDeepSenseInterviewCard("can you explain typical rag pipe line", cards);

  expect(intro?.question).toBe("Tell me a little about yourself.");
  expect(rag?.question).toBe("Can you explain a typical RAG pipeline?");
});

test("DeepSense guide does not match an unrelated technical comparison", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());

  const unrelated = findDeepSenseInterviewCard(
    "what is the difference between precision and recall",
    cards,
  );

  expect(unrelated).toBeNull();
});

test("DeepSense session seed keeps role grounding and representative examples without embedding all cards", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());
  const seed = buildDeepSenseInterviewSeed(cards);

  expect(seed).toContain("DeepSense Full-Stack AI Developer Co-op");
  expect(seed).toContain("Professor Lu");
  expect(seed).toContain("CueFlow");
  expect(seed).toContain("SayNext");
  expect(seed).toContain("Representative answer examples");
  expect(seed).toContain("Tell me a little about yourself");
  expect(seed.length).toBeLessThan(16_000);
  expect(seed.length).toBeGreaterThan(2_000);
});
