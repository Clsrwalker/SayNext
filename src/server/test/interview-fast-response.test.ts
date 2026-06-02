import { expect, test } from "bun:test";
import { getImmediateDecision } from "../saynext/immediate-rules";

test("routes intro and cloud interest as a profile hint instead of fixed display text", () => {
  const decision = getImmediateDecision(
    "Can you briefly introduce yourself and tell me why you're interested in cloud engineering?",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:intro-cloud-engineering-interest");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toContain("Xiang Li");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toContain("cloud engineering");
});
