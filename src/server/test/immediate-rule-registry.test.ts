import { expect, test } from "bun:test";
import type { ImmediateRule } from "../saynext/immediate-rule-registry";
import {
  IMMEDIATE_RULE_BANK_PRIORITY_RANGES,
  IMMEDIATE_RULE_PRIORITY_MAX,
  IMMEDIATE_RULE_PRIORITY_MIN,
  type ImmediateRuleContext,
  runImmediateRuleDecision,
  runImmediateRules,
} from "../saynext/immediate-rule-registry";
import { IMMEDIATE_RULES } from "../saynext/immediate-rule-bank";
import { getImmediateDecision } from "../saynext/immediate-rules";
import { Action } from "../mastra/types";
import { buildContextSignals, decideDisplay } from "../saynext/context-signals";

function makeContext(
  transcript = "Please send the CORS endpoint status but not the deposit.",
  previousTranscriptTexts: string[] = [],
): ImmediateRuleContext {
  const signals = buildContextSignals({ latestTranscript: transcript, previousTranscriptTexts });
  return {
    transcript,
    normalized: transcript.trim(),
    lower: transcript.trim().toLowerCase(),
    timestamp: 123,
    outputLanguage: "english" as const,
    signals,
    previousTranscriptTexts,
    hasPriorTranscript: signals.hasPriorTranscript,
    hasRecentAgentOutput: signals.hasRecentAgentOutput,
  };
}

const baseContext = makeContext();

test("immediate rule registry respects priority and stable matching", () => {
  const rules: ImmediateRule[] = [
    {
      id: "test:low-priority",
      priority: 10,
      category: "tech_process",
      include: [/cors/i],
      output: "low",
      reasoning: "low priority",
    },
    {
      id: "test:high-priority",
      priority: 20,
      category: "tech_process",
      include: [/cors/i],
      output: "high",
      reasoning: "high priority",
    },
  ];

  const decision = runImmediateRuleDecision(rules, baseContext);

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("test:high-priority");
  expect(decision.routeHints[0].route).toBe("technical_concept");
  expect(decision.routeHints[0].instructions.join(" ")).toContain("high");
});

test("immediate rule registry supports negative patterns", () => {
  const rules: ImmediateRule[] = [
    {
      id: "test:cors-without-money",
      priority: 10,
      category: "tech_process",
      include: [/cors/i],
      exclude: [/deposit/i],
      output: "cors",
      reasoning: "CORS without money risk",
    },
  ];

  expect(runImmediateRules(rules, baseContext)).toBeNull();
});

test("immediate rule registry can return silent actions", () => {
  const rules: ImmediateRule[] = [
    {
      id: "test:silent-ack",
      priority: 20,
      category: "no_intervention",
      action: "silent",
      include: [/that's fine/i],
      output: "",
      reasoning: "short acknowledgement should stay silent",
    },
  ];

  const response = runImmediateRules(rules, makeContext("That's fine."));

  expect(response?.type).toBe(Action.SILENT);
  expect(response?.reasoning).toBe("short acknowledgement should stay silent");
});

test("route hints stop lower direct-response templates without producing display text", () => {
  const rules: ImmediateRule[] = [
    {
      id: "test:classroom-route-hint",
      priority: 30,
      category: "tech_process",
      effect: "route_hint",
      route: "technical_concept",
      include: [/linear classifier/i],
      hint: "Use classroom concept framing.",
      mustInclude: ["weighted sum", "bias"],
      mustAvoid: ["photo story"],
      reasoning: "classroom hint",
    },
    {
      id: "test:photo-template",
      priority: 10,
      category: "casual",
      include: [/picture/i],
      output: "I do not have a specific photo to describe.",
      reasoning: "photo template",
    },
  ];

  const context = makeContext("For image classification, a linear classifier treats W like a picture template.");
  const decision = runImmediateRuleDecision(rules, context);

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("test:classroom-route-hint");
  expect(decision.routeHints[0].route).toBe("technical_concept");
  expect(runImmediateRules(rules, context)).toBeNull();
});

test("casual route hints do not trigger on classroom technical examples", () => {
  const movieVectorDecision = runImmediateRuleDecision(
    IMMEDIATE_RULES,
    makeContext(
      "You want to predict what genre of movies a user will like from ratings, so how can we form this vector?",
      ["The lecture is explaining vectors and machine learning inputs."],
    ),
  );
  const tensorDecision = runImmediateRuleDecision(
    IMMEDIATE_RULES,
    makeContext(
      "Tensor is a multidimensional array, like an RGB image with height cross width cross 3, and you cannot visualize it on paper.",
      ["The professor is explaining matrix multiplication, vectors, and tensors."],
    ),
  );

  expect(movieVectorDecision.routeHints.map((hint) => hint.id)).not.toContain("immediate:grounded-media-specificity");
  expect(tensorDecision.routeHints.map((hint) => hint.id)).not.toContain("immediate:stationery-comfort");
});

test("classroom display decision handles any-questions and core notes", () => {
  const standaloneAnyQuestions = getImmediateDecision("Any questions?", 123, "english");
  const contextualAnyQuestions = getImmediateDecision("Any questions?", 123, "english", {
    previousTranscriptTexts: ["The professor just explained linear classifiers and weighted sums."],
  });
  const coreDefinition = getImmediateDecision(
    "Tensor is a multidimensional array that generalizes vectors and matrices.",
    123,
    "english",
    {
      previousTranscriptTexts: ["The professor is explaining vectors, matrices, and image representations."],
    },
  );
  const actionInfo = getImmediateDecision(
    "For the assignment rubric, the deadline and required submission format are important.",
    123,
    "english",
    {
      previousTranscriptTexts: ["The professor is explaining the course assignment."],
    },
  );

  expect(standaloneAnyQuestions.response?.type).toBe(Action.SILENT);
  expect(contextualAnyQuestions.routeHints[0].id).toBe("immediate:classroom-any-questions-smart-question");
  expect(coreDefinition.routeHints[0].id).toBe("immediate:classroom-core-definition-note");
  expect(actionInfo.routeHints[0].id).toBe("immediate:classroom-action-info-note");
});

test("supply-chain store rule does not hijack technical latency checkout wording", () => {
  const decision = getImmediateDecision(
    "If you're optimizing latency, what user value are you protecting, checkout speed, logins, or video?",
    123,
    "english",
    {
      previousTranscriptTexts: ["For a small web app, we are comparing serverless and EC2 latency trade-offs."],
    },
  );

  expect(decision.routeHints.map((hint) => hint.id)).not.toContain("immediate:supply-chain-store-impact");
  if (decision.response?.type === Action.INSIGHT) {
    const trace = (decision.response.metadata.agentInput as any)?.processTrace;

    expect(trace?.rulesFired || []).not.toContain("immediate:supply-chain-store-impact");
    expect(decision.response.output).not.toContain("delayed items");
  }
});

test("debug summary rule does not hijack definition-of-done meeting context", () => {
  const decision = getImmediateDecision(
    "Great, let us frame it: done means a merged integration PR plus a demo meeting log.",
    123,
    "english",
    {
      previousTranscriptTexts: ["Can you volunteer for the AI Meeting Monitor integration sprint?"],
    },
  );

  expect(decision.response?.type).not.toBe(Action.INSIGHT);
  if (decision.response?.type === Action.INSIGHT) {
    const trace = (decision.response.metadata.agentInput as any)?.processTrace;

    expect(trace?.rulesFired || []).not.toContain("immediate:exact-failure-debug-summary");
    expect(decision.response.output).not.toContain("exact failing step");
  }
});

test("tax deductible roommate-noise questions use cautious boundary wording", () => {
  const decision = getImmediateDecision(
    "When you handle noise conflict, do you have any deductible home-office impacts to close the loop?",
    123,
    "english",
    {
      previousTranscriptTexts: ["We are discussing a roommate conflict about noise."],
    },
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:tax-deductible-home-office-boundary");
  expect(decision.routeHints[0].route).toBe("risk_boundary");
  expect(decision.routeHints[0].instructions.join(" ")).toContain("tax preparer");
  expect(decision.routeHints[0].instructions.join(" ")).toContain("official guidance");
});

test("bus versus walking rule does not ignore fee clarification", () => {
  const decision = getImmediateDecision(
    "Before we compare bus versus walking, can you unpack that fee you mentioned?",
    123,
    "english",
    {
      previousTranscriptTexts: ["We are at the library service desk and there is a confusing fee."],
    },
  );

  expect(decision.response?.type).not.toBe(Action.INSIGHT);
  if (decision.response?.type === Action.INSIGHT) {
    const trace = (decision.response.metadata.agentInput as any)?.processTrace;

    expect(trace?.rulesFired || []).not.toContain("immediate:airport-bus-versus-walking");
    expect(decision.response.output).not.toContain("For airport travel");
  }
});

test("gossip verbatim follow-up gets a boundary route hint", () => {
  const decision = getImmediateDecision(
    "Okay, but in practice, who do you tell, and what do you say verbatim?",
    123,
    "english",
    {
      previousTranscriptTexts: ["When you hear gossip, what trade-off did you make between reporting and protecting boundaries?"],
    },
  );

  expect(decision.routeHints[0]?.id).toBe("immediate:gossip-boundary-verbatim-hint");
  expect(decision.routeHints[0]?.mustAvoid || []).toContain("normal life example");
});

test("student availability rule does not hijack casual bus-or-walking commute preference", () => {
  const decision = getImmediateDecision(
    "Hey, what's the status, bus or walking feels more comfortable, especially with mobile commute?",
    123,
    "english",
    {
      previousTranscriptTexts: ["We are chatting after class about whether bus or walking is more comfortable."],
    },
  );

  if (decision.response?.type === Action.INSIGHT) {
    const trace = (decision.response.metadata.agentInput as any)?.processTrace;

    expect(trace?.rulesFired || []).not.toContain("immediate:student-availability-transport");
    expect(decision.response.output).not.toContain("school schedule");
    expect(decision.response.output).not.toContain("after classes");
  }
});

test("mentor memory rules do not hijack front-desk action questions", () => {
  const first = getImmediateDecision(
    "I just do not understand the older album mentor support, what exactly do I do at the front desk?",
    123,
    "english",
  );
  const second = getImmediateDecision(
    "So the elder elbow mentor support, do I just log it, or talk to him?",
    123,
    "english",
    {
      previousTranscriptTexts: ["The customer asked what to do at the front desk."],
    },
  );

  for (const decision of [first, second]) {
    if (decision.response?.type === Action.INSIGHT) {
      const trace = (decision.response.metadata.agentInput as any)?.processTrace;

      expect(trace?.rulesFired || []).not.toContain("immediate:grounded-mentor-follow-up");
      expect(trace?.rulesFired || []).not.toContain("immediate:exact-failure-debug-summary");
      expect(decision.response.output).not.toContain("study abroad");
      expect(decision.response.output).not.toContain("exact failing step");
    }
  }
});

test("unclear requirements tradeoff rule stays scoped to project or requirement context", () => {
  const decision = getImmediateDecision(
    "Okay, but why that dream specifically, and what trade-off would you accept on cost?",
    123,
    "english",
    {
      previousTranscriptTexts: ["We are talking about turning a dream into a movie."],
    },
  );

  if (decision.response?.type === Action.INSIGHT) {
    const trace = (decision.response.metadata.agentInput as any)?.processTrace;

    expect(trace?.rulesFired || []).not.toContain("immediate:unclear-requirements-tradeoff");
    expect(decision.response.output).not.toContain("When requirements are unclear");
  }
});

test("assumptions risks documentation rule does not hijack competition reason lists", () => {
  const decision = getImmediateDecision(
    "For documentation purposes, list three concrete reasons, each with a specific observable outcome.",
    123,
    "english",
    {
      previousTranscriptTexts: ["People enjoy competitions for clear goals and measurable progress."],
    },
  );

  if (decision.response?.type === Action.INSIGHT) {
    const trace = (decision.response.metadata.agentInput as any)?.processTrace;

    expect(trace?.rulesFired || []).not.toContain("immediate:assumptions-risks-documentation");
    expect(decision.response.output).not.toContain("assumptions are what data");
  }
});

test("short acknowledgement silence requires nearby conversation context", () => {
  const standalone = runImmediateRules(IMMEDIATE_RULES, makeContext("Thanks."));

  const contextual = runImmediateRules(
    IMMEDIATE_RULES,
    makeContext("Thanks.", ["The professor just finished explaining the assignment."]),
  );

  expect(standalone).toBeNull();
  expect(contextual?.type).toBe(Action.SILENT);
});

test("social openers are not treated as single-name fragments", () => {
  for (const text of ["Hello.", "Thanks.", "Okay."]) {
    const response = runImmediateRules(IMMEDIATE_RULES, makeContext(text));

    expect(response?.type).not.toBe(Action.INSIGHT);
    if (response?.type === Action.INSIGHT) {
      expect(response.output).not.toContain("I heard the name");
    }
  }
});

test("fast display decision does not silence short turns with real tasks", () => {
  const previousTranscriptTexts = ["We were discussing the project status."];
  for (const text of [
    "Thanks, can you send me the code?",
    "Okay, but what about the API 403?",
    "Fine, just pay the deposit now.",
  ]) {
    const signals = buildContextSignals({ latestTranscript: text, previousTranscriptTexts });
    const decision = decideDisplay(signals);

    expect(decision.action).toBe("continue");
    expect(signals.latestHasConcreteTask).toBe(true);
  }
});

test("fast display decision silences context-only greetings and fragments", () => {
  const previousTranscriptTexts = ["The professor was taking attendance and wrapping up a lecture."];
  for (const text of ["Hello.", "Yeah. Happy", "OK. Sothis is a good place to", "Harsh Pande."]) {
    const signals = buildContextSignals({ latestTranscript: text, previousTranscriptTexts });
    const decision = decideDisplay(signals);

    expect(decision.action).toBe("silent");
  }
});

test("immediate rule bank uses stable ids and documented priority range", () => {
  const seen = new Set<string>();

  for (const rule of IMMEDIATE_RULES) {
    expect(rule.id.startsWith("immediate:")).toBe(true);
    expect(seen.has(rule.id)).toBe(false);
    seen.add(rule.id);
    expect(rule.bank).toBeTruthy();
    expect(rule.priority).toBeGreaterThanOrEqual(IMMEDIATE_RULE_PRIORITY_MIN);
    expect(rule.priority).toBeLessThanOrEqual(IMMEDIATE_RULE_PRIORITY_MAX);
    const bankRange = rule.bank ? IMMEDIATE_RULE_BANK_PRIORITY_RANGES[rule.bank] : undefined;
    expect(bankRange).toBeTruthy();
    if (bankRange) {
      expect(rule.priority).toBeGreaterThanOrEqual(bankRange.min);
      expect(rule.priority).toBeLessThanOrEqual(bankRange.max);
    }
  }
});
