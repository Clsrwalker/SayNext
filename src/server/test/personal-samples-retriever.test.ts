import { expect, test } from "bun:test";
import { formatRetrievedSamples, formatXiangProfileForPrompt, retrievePersonalSamples } from "../personalization/retriever";

test("retrieves cloud interview intro sample", () => {
  const results = retrievePersonalSamples(
    "Can you briefly introduce yourself and tell me why you're interested in cloud engineering?"
  );

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].id).toBe("interview-intro-cloud-interest");
});

test("retrieves Chinese school planning sample", () => {
  const results = retrievePersonalSamples("你之后想做实习还是项目？");

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].id).toBe("chinese-clarify");
});

test("formats retrieved samples for prompt context", () => {
  const results = retrievePersonalSamples("Tell me about your AWS experience.", 1);
  const formatted = formatRetrievedSamples(results);

  expect(formatted).toContain("Scene:");
  expect(formatted).toContain("Transcript:");
  expect(formatted).toContain("Ideal answer:");
});

test("retrieves classroom scaling sample", () => {
  const results = retrievePersonalSamples("What is the difference between vertical scaling and horizontal scaling?");

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].id).toBe("classroom-vertical-vs-horizontal-scaling");
});

test("retrieves classroom lecture supplement sample", () => {
  const results = retrievePersonalSamples(
    "Managed services reduce operational work because the cloud provider handles more of the maintenance for us."
  );

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].id).toBe("classroom-lecture-managed-services-supplement");
});

test("retrieves encouragement sample instead of unrelated project samples", () => {
  const results = retrievePersonalSamples("That's the spirit. It's all about the process, right?");

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].id).toBe("daily-acknowledge-encouragement");
});

test("retrieves challenging class sample", () => {
  const results = retrievePersonalSamples(
    "Describe a class you've taken that challenged you the most. What made it tough, and how did you handle it?"
  );

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].id).toBe("daily-challenging-class");
});

test("retrieves casual lived-detail samples for daily questions", () => {
  expect(
    retrievePersonalSamples("Do you prefer to spend your free time indoors or outdoors, and why?")[0].id
  ).toBe("daily-free-time-indoors");

  expect(
    retrievePersonalSamples(
      "Can you describe a time when you learned a new skill or hobby, what was it, and how did you feel during the process?"
    )[0].id
  ).toBe("daily-learned-new-skill-piano");

  expect(
    retrievePersonalSamples("How do you think technology will change the way people work in the future?")[0].id
  ).toBe("daily-technology-future-work");
});

test("formats Xiang profile with privacy and classroom rules", () => {
  const formatted = formatXiangProfileForPrompt();

  expect(formatted).toContain("XiangProfile 3.0");
  expect(formatted).toContain("do not mention Shirreff Hall");
  expect(formatted).toContain("Sorry, I'm not sure about this one.");
  expect(formatted).toContain("Honda Civic");
});
