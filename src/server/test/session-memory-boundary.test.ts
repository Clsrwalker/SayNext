import { expect, test } from "bun:test";
import { isPromotablePersonalMemoryCandidateType } from "../data/conversation-logger";

test("only Xiang-specific candidate types can become personal memory", () => {
  expect(isPromotablePersonalMemoryCandidateType("personal_fact")).toBe(true);
  expect(isPromotablePersonalMemoryCandidateType("preference")).toBe(true);
  expect(isPromotablePersonalMemoryCandidateType("speaking_style")).toBe(true);
  expect(isPromotablePersonalMemoryCandidateType("project_detail")).toBe(true);
  expect(isPromotablePersonalMemoryCandidateType("correction")).toBe(true);

  expect(isPromotablePersonalMemoryCandidateType("knowledge_fact")).toBe(false);
  expect(isPromotablePersonalMemoryCandidateType("event_summary")).toBe(false);
  expect(isPromotablePersonalMemoryCandidateType("interview_job")).toBe(false);
  expect(isPromotablePersonalMemoryCandidateType("unknown")).toBe(false);
});
