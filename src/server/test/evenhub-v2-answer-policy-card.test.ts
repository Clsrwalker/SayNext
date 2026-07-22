import { expect, test } from "bun:test";
import {
  findAnswerPolicyCard,
  formatAnswerPolicyCard,
  getAnswerPolicyCards,
} from "../evenhub-v2/answer-policy-cards";

test("EvenHub v2 exposes the 15 migrated answer policy cards with stable unique ids", () => {
  const cards = getAnswerPolicyCards();

  expect(cards).toHaveLength(15);
  expect(new Set(cards.map((card) => card.id)).size).toBe(15);
  expect(cards.every((card) => card.legacyMemoryId > 0)).toBe(true);
});

test("every migrated answer policy card is reachable from its representative question", () => {
  for (const card of getAnswerPolicyCards()) {
    expect(findAnswerPolicyCard(card.matchExamples[0])?.id).toBe(card.id);
  }
});

test("answer policy matching selects one specific card from imperfect interview wording", () => {
  const feedback = findAnswerPolicyCard(
    "tell me about some pretty harsh feedback you got on a code review",
  );
  const waiting = findAnswerPolicyCard(
    "what do you do if another person is not replying and you need their information",
  );
  const deadline = findAnswerPolicyCard(
    "the demo is next week and there are too many features, how do you prioritize",
  );

  expect(feedback?.id).toBe("behavioral-code-review-feedback");
  expect(waiting?.id).toBe("behavioral-waiting-on-information");
  expect(deadline?.id).toBe("response-deadline-scope-cut");
});

test("answer policy matching handles realistic DeepSense ASR phrasing", () => {
  expect(findAnswerPolicyCard(
    "tell me about a time something broke during integration, like how did you actually narrow it down",
  )?.id).toBe("response-hard-bug-debugging");
  expect(findAnswerPolicyCard(
    "last one, why DeepSense and why this full stack AI co-op specifically",
  )?.id).toBe("behavioral-why-role");
});

test("answer policy matching stays out of ordinary technical answers", () => {
  expect(findAnswerPolicyCard("what is the difference between precision and recall"))
    .toBeNull();
});

test("formatted answer policy is structure-only and cannot supply Xiang facts", () => {
  const card = findAnswerPolicyCard("tell me about critical code review feedback");
  expect(card).not.toBeNull();

  const formatted = formatAnswerPolicyCard(card!);
  expect(formatted).toContain("Reusable answer policy");
  expect(formatted).toContain("not personal-memory evidence");
  expect(formatted).toContain("must come from verified Xiang memory");
});
