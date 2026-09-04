import { expect, test } from "bun:test";
import {
  buildDeepSenseInterviewSeed,
  findDeepSenseInterviewCard,
  formatInterviewAnswerCard,
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

test("DeepSense guide does not treat a code walkthrough as a background question", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());

  const codeWalkthrough = findDeepSenseInterviewCard(
    "cool, now walk me through that code and tell me the time and space complexity",
    cards,
  );
  const realBackground = findDeepSenseInterviewCard(
    "could you walk me through your background",
    cards,
  );

  expect(codeWalkthrough).toBeNull();
  expect(realBackground?.question).toBe("Can you walk me through your background?");
});

test("DeepSense guide distinguishes RAG design from RAG testing", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());

  const design = findDeepSenseInterviewCard(
    "okay so how would you design the rag chatbot for our website and internal docs",
    cards,
  );
  const testing = findDeepSenseInterviewCard(
    "and how do you actually test that rag pipe line before shipping it",
    cards,
  );

  expect(design?.question).toBe("How would you design a chatbot that answers questions from our website?");
  expect(testing?.question).toBe("How would you test a RAG pipeline?");
});

test("DeepSense guide maps noisy debugging and company-fit questions to their own intents", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());

  const debugging = findDeepSenseInterviewCard(
    "tell me about when the integration broke and how you narrowed down what was wrong",
    cards,
  );
  const companyFit = findDeepSenseInterviewCard(
    "yeah so why deep sense and why this full stack ai co op specifically",
    cards,
  );

  expect(debugging?.question).toBe("Describe a difficult bug and how you found the root cause.");
  expect(companyFit?.question).toBe("Why do you want to work with DeepSense?");
});

test("per-turn interview cards cannot reduce depth explicitly requested by the current question", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());
  const card = cards.find((candidate) => (
    candidate.question === "How would you design a chatbot that answers questions from our website?"
  ));

  expect(card).toBeDefined();
  const formatted = formatInterviewAnswerCard(card!);
  expect(formatted).toContain("The current question controls answer depth");
  expect(formatted).toContain("expand beyond a simpler reference answer");
  expect(formatted).toContain("decision, execution path, failure response, and verification");
});

test("fixed interview seed contains reusable rules but no DeepSense facts or answer examples", () => {
  const cards = parseDeepSenseInterviewGuide(loadDeepSenseInterviewGuide());
  const seed = buildDeepSenseInterviewSeed(cards);

  expect(seed).toContain("Reusable interview answer rules:");
  expect(seed).toContain("System design and application");
  expect(seed).toContain("make a concrete decision");
  expect(seed).toContain("how to verify");
  expect(seed).toContain("Use facts from a reference answer only when the current question matches that answer's topic");
  expect(seed).toContain("Reference answers are factual sources for matching questions, not scripts");
  expect(seed).toContain("Do not copy their opening, sentence order, transitions, or conclusion");
  expect(seed).toContain("answer the current ASR wording from scratch");
  expect(seed).not.toContain("DeepSense");
  expect(seed).not.toContain("Professor Lu");
  expect(seed).not.toContain("CueFlow");
  expect(seed).not.toContain("SayNext");
  expect(seed).not.toContain("Hybrid Search Memory Assistant");
  expect(seed).not.toContain("Representative answer examples");
  expect(seed).not.toContain("Question:");
  expect(seed).not.toContain("Example answer:");
  expect(seed.length).toBeLessThan(4_000);
  expect(seed.length).toBeGreaterThan(500);
});
