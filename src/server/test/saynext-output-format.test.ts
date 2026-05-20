import { expect, test } from "bun:test";
import { finalizeSayNextOutput, processConversation, resolveOpenAiModelConfig, routeSayNextProcess, sanitizeSayNextOutput } from "../mastra/agents/initial-agent";
import { Action } from "../mastra/types";
import { getImmediateDecision } from "../saynext/immediate-rules";
import { makeTelepromptOpeningLine } from "../teleprompt/teleprompt-runtime";
import { getKnownTermAsrCandidates, normalizeKnownProjectAsrAliases } from "../text/asr-corrections";

function expectImmediateHint(
  input: string,
  expectedId: string,
  mustContain: string[] = [],
  mustAvoid: string[] = [],
  context: Parameters<typeof getImmediateDecision>[3] = {},
) {
  const decision = getImmediateDecision(input, Date.now(), "english", context);
  expect(decision.response).toBeNull();
  expect(decision.routeHints[0]?.id).toBe(expectedId);
  const hintText = [
    ...(decision.routeHints[0]?.instructions || []),
    ...(decision.routeHints[0]?.mustInclude || []),
    ...(decision.routeHints[0]?.mustAvoid || []),
  ].join(" ").toLowerCase();
  for (const term of mustContain) expect(hintText).toContain(term.toLowerCase());
  for (const term of mustAvoid) expect(hintText).not.toContain(term.toLowerCase());
  return decision.routeHints[0];
}

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

test("immediate rules return route hints instead of fixed display text", () => {
  const hint = expectImmediateHint(
    "I am outside - can you confirm the deposit, and also fix that CORS error real quick?",
    "immediate:money-risk-plus-api-debug",
    ["deposit separate", "backend API URL", "request and response headers"],
  );

  expect(hint.route).toBe("multi_intent");
  expect(hint.category).toBe("multi_intent");
});

test("stays silent on short acknowledgements and closings", async () => {
  const closingInputs = [
    "Okay.",
    "Yeah.",
    "That's fine.",
    "Thanks so much.",
    "OK. That's all. Thanks,",
    "Thank you. No.",
  ];

  for (const input of closingInputs) {
    const response = await processConversation(
      [
        {
          type: "transcript",
          text: "In high-dimensional space, a linear classifier learns a boundary from labelled data.",
          timestamp: Date.now() - 1_000,
        },
        { type: "transcript", text: input, timestamp: Date.now() },
      ],
      "high",
      undefined,
      "english",
    );

    expect(response.type).toBe(Action.SILENT);
  }
});

test("keeps linear-classifier visual viewpoint in classroom route instead of photo template", async () => {
  const decision = getImmediateDecision(
    "There's also a different way you can think about what a linear classifier is doing. For image classification, it's called a visual viewpoint. If you write this W matrix like a 2D picture and take a weighted sum, it is like putting W on top of the image and doing pixel-wise multiplication. If we learned the best W and B, visually what is it really learning?",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:classroom-linear-classifier-visual-template");
  expect(decision.routeHints[0].route).toBe("technical_concept");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toMatch(/class template|pixels|bias/i);
  expect(decision.routeHints[0].mustAvoid?.join(" ")).toMatch(/photo|documents|deadline|screenshot/i);
});

test("keeps linear-classifier geometric lecture away from document deadline template", async () => {
  const decision = getImmediateDecision(
    "In high-dimensional space, if you think of what this linear classifier is learning, we are learning some form of lines. In high-dimensional spaces, these are called hyperplanes. They cannot learn decision boundaries where you need some form of nonlinear decision boundary.",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:classroom-linear-classifier-geometric-boundary");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toMatch(/hyperplane|nonlinear decision boundary/i);
  expect(decision.routeHints[0].mustAvoid?.join(" ")).toMatch(/documents|deadline|screenshot|photo/i);
});

test("keeps algebraic linear-classifier viewpoint on weighted sums", async () => {
  const decision = getImmediateDecision(
    "Any questions? The first viewpoint is the algebraic viewpoint: the score for a class is taking the weighted sum of the input and adding a bias. What is a linear classifier doing? It is trying to take a weighted sum of the inputs.",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:classroom-linear-classifier-wx-plus-b");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toMatch(/weighted sum|bias|score/i);
  expect(decision.routeHints[0].mustAvoid?.join(" ")).toMatch(/template limitation|documents|deadline/i);
});

test("does not treat linear regression classroom mention as debug regression", async () => {
  const decision = getImmediateDecision(
    "For people interested, you can look at it called linear regression. The output quantity can be a real number, but here we are looking at classification.",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:classroom-linear-regression-vs-classification");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toMatch(/real number|classification|scores/i);
  expect(decision.routeHints[0].mustAvoid?.join(" ")).toMatch(/bisect|schema migration|smallest repro|debugging/i);
});

test("uses open-topic photo rules as route hints instead of fixed templates", () => {
  const decision = getImmediateDecision(
    "Describe a picture or photo in your home that you like.",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:grounded-photo");
  expect(decision.routeHints[0].route).toBe("casual");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toMatch(/no invented specific photo|period-of-life/i);
  expect(decision.routeHints[0].mustAvoid?.join(" ")).toMatch(/specific childhood photo|linear-classifier/i);
});

test("uses book preference boundary as a route hint instead of fixed template", () => {
  const decision = getImmediateDecision(
    "Do you have any serious nonfiction book recommendation, like Sapiens or Atomic Habits?",
    Date.now(),
    "english",
  );

  expect(decision.response).toBeNull();
  expect(decision.routeHints[0].id).toBe("immediate:honest-book-recommendation-boundary");
  expect(decision.routeHints[0].route).toBe("casual");
  expect(decision.routeHints[0].mustInclude?.join(" ")).toMatch(/does not read serious nonfiction/i);
  expect(decision.routeHints[0].mustAvoid?.join(" ")).toMatch(/pretending|fake reading history/i);
});

test("routes process cases without calling the model", () => {
  const trace = routeSayNextProcess({
    transcript: "How should I debug this API 403 issue with the request payload?",
    output: "I would check the request, response status, auth, route, payload, and logs first.",
    source: "model_generation",
  });

  expect(trace.route).toBe("tech_debug");
  expect(trace.processContract.join(" ")).toContain("logs/request/response/status/auth/schema");
  expect(trace.rulesFired).toContain("model-generation");
  expect(trace.rulesFired).toContain("route:technical-debug-path");
  expect(trace.matchedRules?.[0]?.id).toBe("technical-debug-path");
});

test("does not route API contract wording as legal risk", () => {
  const trace = routeSayNextProcess({
    transcript: "Before integration, what API contract should we expose to the downstream service?",
    output: "I would define the smallest schema and error states first.",
    source: "model_generation",
  });

  expect(trace.route).toBe("product_scope");
  expect(trace.rulesFired).toContain("route:product-scope-process");
  expect(trace.rulesFired).not.toContain("route:high-risk-boundary");
});

test("routes noisy programming language experience question as a hint", () => {
  expectImmediateHint(
    "What's programming have you do you have an experiment with?",
    "immediate:programming-language-experience",
    ["TypeScript", "JavaScript", "C++", "Java", "Python", "React Native", "databases"],
  );
});

test("routes clipped program language correction as a hint", () => {
  expectImmediateHint(
    "I mean the program langu",
    "immediate:programming-language-experience",
    ["TypeScript", "JavaScript", "rusty"],
  );
});

test("routes cloud project selection as a hint instead of fixed text", () => {
  expectImmediateHint(
    "Which project should I talk about for cloud experience?",
    "immediate:cloud-project-selection",
    ["JobLens AI", "ElderAlbum", "Lambda"],
    ["Hybrid Search", "I should use"],
  );
});

test("normalizes JobLens ASR aliases without treating them as unknown projects", () => {
  expect(normalizeKnownProjectAsrAliases("Jobless AI. Could you explain more?"))
    .toBe("JobLens AI. Could you explain more?");
  expect(normalizeKnownProjectAsrAliases("So I am interested in your job level. Could you explain more?"))
    .toBe("So I am interested in your job level. Could you explain more?");
  expect(getKnownTermAsrCandidates("So I am interested in your job level. Could you explain more?")[0]?.canonical)
    .toBe("JobLens AI");
  expect(makeTelepromptOpeningLine("Jobless AI. Could you explain more?"))
    .toBe("Yeah, I can explain JobLens AI. It's my cloud-based job platform project.");
  expect(makeTelepromptOpeningLine("So I am interested in your job level. Could you explain more?"))
    .toBe("Yeah, I can explain JobLens AI. It's my cloud-based job platform project.");
  expect(getKnownTermAsrCandidates("Which job level are you most interested in?")[0])
    .toBeUndefined();
  expect(getKnownTermAsrCandidates("Can you explain job levels in software companies?")[0])
    .toBeUndefined();
  expect(makeTelepromptOpeningLine("Could you explain AI meeting model?"))
    .toBe("Yeah, I can explain AI Meeting Monitor. It's my meeting transcript and analysis project.");
  expect(makeTelepromptOpeningLine("Can you talk about older album?"))
    .toBe("Yeah, I can explain ElderAlbum. It's my AWS serverless photo album project.");
  expect(getKnownTermAsrCandidates("I found an older album from my childhood.")[0])
    .toBeUndefined();
  expect(getKnownTermAsrCandidates("Can you talk about older album photos in general?")[0])
    .toBeUndefined();
  expect(getKnownTermAsrCandidates("How did hybrid search memory assistance reduce input tokens?")[0]?.canonical)
    .toBe("Hybrid Search Memory Assistant");
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

test("routes JavaScript ASR wording without financial template", () => {
  expectImmediateHint(
    "So to be safe, could you confirm the exact wording and intended meaning of java script?",
    "immediate:javascript-asr-meaning-clarification",
    ["JavaScript", "programming language"],
    ["inflation", "hawkish", "dovish", "rates"],
  );
});

test("routes allergy checks from Xiang profile instead of listing generic allergens", () => {
  expectImmediateHint(
    "Honestly, I think people fear missing chances, but no pressure - what allergies should we avoid?",
    "immediate:food-allergy-safety",
    ["do not have food allergies"],
    ["nuts", "shellfish", "sesame"],
  );
});

test("replaces placeholder progress answers with process-safe status request", () => {
  expect(finalizeSayNextOutput(
    "X is complete, Y is in progress, and Z is the only open item. We should expect Z done by [date and time].",
    "So what's the one-line status, and when do we expect Z done?",
    "english",
    undefined,
    "technical",
  ))
    .toBe("I do not have the exact status yet. I would ask the owner for one concrete update and a realistic time before we report it.");
});

test("corrects misdirected media guard for dream movie scope", () => {
  expect(finalizeSayNextOutput(
    "I watch anime and videos more casually, so I would not force a specific title if I cannot clearly remember one.",
    "If we turn that dream into a movie, what's the scope and timeline?",
    "english",
    undefined,
    "technical",
  ))
    .toBe("For the movie idea, I would keep it simple: one main feeling, one setting, and one short scene, then decide the timeline after the concept is clear.");
});

test("routes appointment-room ASR without guessing room number", () => {
  expectImmediateHint(
    "For the point mint, which room number should I go to?",
    "immediate:appointment-room-anti-guess",
    ["appointment", "confirmation", "guess"],
    ["134"],
  );
});

test("routes flash versus Flask ASR back to team ownership process", () => {
  expectImmediateHint(
    "For flash ownership in the team, how would you explain the boundaries?",
    "immediate:flask-ownership-asr-boundary",
    ["ownership", "handoff", "integration"],
    ["web framework", "microframework"],
  );
});

test("routes sincere apology questions with reasoning structure", () => {
  expectImmediateHint(
    "What evidence do you have that an apology feels sincere to nontechnical users?",
    "immediate:sincere-apology-reasoning",
    ["went wrong", "impact", "change"],
  );
});

test("routes response-window documentation requests instead of no action", () => {
  expectImmediateHint(
    "I need that in writing: define response windows and the escalation path if pressure spikes.",
    "immediate:response-window-escalation-process",
    ["response", "escalation", "writing"],
    ["No action needed"],
  );
});

test("corrects misdirected media guard for ElderAlbum Lambda follow-up", () => {
  expect(finalizeSayNextOutput(
    "I watch anime and videos more casually, so I would not force a specific title if I cannot clearly remember one.",
    "So the ElderAlbum indexing is automatic - what triggers the Lambda workflow, and where do tags show up?",
    "english",
    undefined,
    "technical",
  ))
    .toContain("S3 upload triggers Lambda");
});

test("does not let presentation failure template hijack prioritization", () => {
  expect(finalizeSayNextOutput(
    "The immediate impact was that the presentation was not smooth, and I probably looked very nervous.",
    "Good, but what matters most - how do you decide the highest-impact task under pressure?",
    "english",
    undefined,
    "technical",
  ))
    .toMatch(/blocks the core goal|biggest risk|unblocks/i);
});

test("does not let generic life-example template hijack technical follow-ups", () => {
  expect(finalizeSayNextOutput(
    "Yeah, I can use a normal life example for that, not a work story. Something small but real usually sounds more natural.",
    "When you say JavaScript, what open-source contributions did you make with it?",
    "english",
    undefined,
    "general",
  ))
    .toMatch(/not claim a major open-source contribution|JavaScript as project experience/i);

  expect(finalizeSayNextOutput(
    "Yeah, I can use a normal life example for that, not a work story. Something small but real usually sounds more natural.",
    "What regression cases cover edge users, and how often should we rerun them?",
    "english",
    undefined,
    "general",
  ))
    .toMatch(/regression cases|edge users|before each release/i);

  expect(finalizeSayNextOutput(
    "I would use a small everyday example instead of a workplace story.",
    "Which edge cases do we defer, and what interface contract do we expose?",
    "english",
    undefined,
    "general",
  ))
    .toMatch(/required fields|error states|fallback behavior/i);

  expect(finalizeSayNextOutput(
    "Yeah, I can use a normal life example for that, not a work story. Something small but real usually sounds more natural.",
    "When serverless breaks under uncertainty, where do you start tracing logs?",
    "english",
    undefined,
    "technical",
  ))
    .toMatch(/invocation|request ID|Lambda logs|known-good request/i);

  expect(finalizeSayNextOutput(
    "Yeah, I can use a normal life example for that, not a work story. Something small but real usually sounds more natural.",
    "Okay, but if they choose the DynamoDB partition key poorly, won't reads throttle fast?",
    "english",
    undefined,
    "technical",
  ))
    .toMatch(/partition key|hot-spot|CloudWatch|GSI/i);
});

test("keeps risk and terminology corrections grounded", () => {
  expect(finalizeSayNextOutput(
    "Yeah, I did - apples basically support gut microbes through the fiber, especially the pectin.",
    "But if it is one fruit only, I would go with apples - did you see that gut microbiome study?",
    "english",
    undefined,
    "general",
  ))
    .toMatch(/not checked that study|verify the actual study|strong health claim/i);

  expect(finalizeSayNextOutput(
    "That study suggests apples support the gut microbiome, so it sounds plausible.",
    "Did you see that gut microbiome study about apples?",
    "english",
    undefined,
    "general",
  ))
    .toMatch(/not checked that study|verify the actual study|strong health claim/i);

  expect(finalizeSayNextOutput(
    "Social awkwardness usually isn't a legal liability in real life; it's more like a vibes risk.",
    "Honestly, as written here, awkwardness can be a legal liability in social settings.",
    "english",
    undefined,
    "general",
  ))
    .toMatch(/legal conclusion|verify the actual legal point|strong claim/i);

  expect(finalizeSayNextOutput(
    "I like the Inazuma vibe, but I don't remember the exact track title right now.",
    "Okay, Inazuma - name one specific track you'd queue first, right now.",
    "english",
    undefined,
    "general",
  ))
    .not.toMatch(/legal conclusion|verify the actual legal point/i);
});

test("uses category-level guards for misdirected output domains", () => {
  expect(finalizeSayNextOutput(
    "I mostly watch shows and anime casually, so I don't name exact titles unless I clearly remember them.",
    "So the ElderAlbum indexing is automatic - what triggers the Lambda workflow, and where do tags show up?",
    "english",
    undefined,
    "technical",
  ))
    .toContain("S3 upload triggers Lambda");

  expect(finalizeSayNextOutput(
    "In my presentation, the language barrier made me freeze and I felt embarrassed in Canada.",
    "Good, but what matters most - how do you decide the highest-impact task under pressure?",
    "english",
    undefined,
    "technical",
  ))
    .toMatch(/blocks the core goal|biggest risk|unblocks/i);
});

test("keeps process-first answers under ASR and topic noise", async () => {
  const cases: Array<{
    input: string;
    must: string[];
    avoid: string[];
    routeHint?: string;
  }> = [
    {
      input: "Atomic Habits sounds good, but what is the measurable payoff?",
      must: ["track", "behavior"],
      avoid: ["do not read serious nonfiction"],
    },
    {
      input: "For JobLens, what data goes where, and how do you prevent leakage or bias?",
      must: ["DynamoDB", "S3", "leakage"],
      avoid: ["normal life example"],
    },
    {
      input: "Can you explain how token reduction works in Hybrid Search Memory Assistant?",
      must: ["chunks", "input tokens"],
      avoid: ["production users"],
    },
    {
      input: "Before money, can you confirm allergies and any substitutions needed?",
      must: ["no food allergies", "confirm"],
      avoid: ["coconut milk"],
    },
    {
      input: "As a family doctor, does Lambda cold start delay affect patient-critical apps?",
      must: ["cold-start", "latency"],
      avoid: ["pharmacist"],
    },
    {
      input: "Explain in plain language how you verify a bank fraud call before sharing info.",
      must: ["official", "bank"],
      avoid: ["I verify by never giving info on the call itself."],
    },
    {
      input: "Okay, where does it break at source checking, or is it elder album style reposting?",
      must: ["ASR noise", "source"],
      avoid: ["ElderAlbum-style"],
    },
    {
      input: "Honestly, I think some people just like the statinary smell, no pressure, like pens and paper.",
      routeHint: "immediate:stationery-comfort",
      must: ["small, practical, or tactile", "tiny sense of order"],
      avoid: ["brain clocks"],
    },
    {
      input: "For airport travel, would you say bus or walking is more comfortable?",
      must: ["bus", "luggage"],
      avoid: ["Japan"],
    },
    {
      input: "How is your day going, good neighbors help out with quick deliveries, not pharmacy, farm see.",
      must: ["boundary", "reasonable"],
      avoid: ["sketchy"],
    },
    {
      input: "Cool, so Dell parking aid, did you store location history, or just aggregate counts?",
      must: ["aggregate", "location history"],
      avoid: ["estimated campus parking availability"],
    },
    {
      input: "When handling angry customers, be careful with that wording, keep your tone steady, not defensive.",
      must: ["calm", "defensive"],
      avoid: ["personal information"],
    },
    {
      input: "Be careful with that wording, Lambda might sound like lamb da or lander to learners.",
      must: ["AWS Lambda", "spell"],
      avoid: ["cold start"],
    },
    {
      input: "Sorry, just to clarify, was the receipt dated yesterday, or earlier, before you asked?",
      must: ["receipt date", "yesterday"],
      avoid: ["final sale"],
    },
    {
      input: "When you say soft rain, what volume range keeps it from masking speech?",
      must: ["low", "speech"],
      avoid: ["white noise is useful"],
    },
    {
      input: "So, in your future job, how will you protect patient privacy?",
      must: ["minimum", "access"],
      avoid: ["JobLens"],
    },
    {
      input: "For security reasons, did specific outfits help your focus, or was it just comfort?",
      must: ["security", "comfort"],
      avoid: ["directly change my mood"],
    },
    {
      input: "Honestly, if you're asking why Xiang stopped playing, it's like a legal duty - busy markets distract, and quiet shops let you focus.",
      must: ["ASR noise", "quiet shops"],
      avoid: ["pretty much"],
    },
    {
      input: "When you say expected return, what timeline like 3, 5, or 10 years, and how to measure?",
      must: ["cash flow", "maintenance"],
      avoid: ["3 years is more for cash flow"],
    },
    {
      input: "That reminds me, when I read Atomic Habits, I confused scheme with schema, so explain it plainly.",
      must: ["schema", "scheme", "structure", "plan"],
      avoid: ["serious nonfiction"],
    },
    {
      input: "Okay, but what's the threat model - does tactile satisfaction ever mask risks like counterfeit paper?",
      must: ["counterfeit", "seller", "materials"],
      avoid: ["Stationery is satisfying"],
    },
    {
      input: "Can you share a minimal repro for token reduction - jobless AI, or job level AI?",
      must: ["minimal repro", "input tokens", "retrieved chunks", "grounded"],
      avoid: ["AI will change some work"],
    },
    {
      input: "Thanks, let us align on the exact timeline; did you notice any secure tea overlap?",
      must: ["clarify", "quiet hours", "start and stop times"],
      avoid: ["secure tea time window"],
    },
    {
      input: "Hey, just curious, are flights delayed today, and did you see election misinformation news?",
      must: ["cannot verify", "airline or airport", "original source"],
      avoid: ["I did see"],
    },
    {
      input: "When you say migrating to AWS, what changed your mind about that Azure project?",
      must: ["Azure", "AWS", "project scope"],
      avoid: ["For cloud projects, I would talk about JobLens AI first"],
    },
    {
      input: "Okay, but in your project, what actually changed, was it React's constraints, or the classroom?",
      must: ["React", "classroom", "technical constraints"],
      avoid: ["emissions"],
    },
    {
      input: "Sorry maybe my meaning is, this automation fee for AI jobs, is it per day or per delivery?",
      must: ["fee", "per day", "per delivery"],
      avoid: ["AI will change some work"],
    },
    {
      input: "Got it, so would you frame the contract draft as avoidance coping, or more like timing uncertainty?",
      must: ["stress avoidance", "timing uncertainty", "verify anything legal"],
      avoid: ["For JobLens"],
    },
    {
      input: "When data is anonymized, do you mean fully de-identified or just masked?",
      must: ["de-identified", "masked", "sensitive"],
      avoid: ["For JobLens"],
    },
    {
      input: "Sorry, maybe, does DalParkAid charge in Germany, and is the fee per month?",
      must: ["student parking project", "not a paid app", "no real billing model"],
      avoid: ["estimated campus parking availability"],
    },
    {
      input: "When you discuss EV news, what is sustainable, also, who owns the data and code?",
      must: ["data owner", "code owner", "sustainability metric"],
      avoid: ["data scheme owner"],
    },
    {
      input: "Sorry, what was that, like, can clothes really change mood, or is it just perception?",
      must: ["comfort", "self-perception", "not treat it as a strong rule"],
      avoid: ["security literally"],
    },
    {
      input: "Hey, quick question - your carrier plan covers swim alerts, or should we upgrade today? this changes everything",
      must: ["not upgrade today", "app push", "exact cost"],
      avoid: ["only way"],
    },
    {
      input: "Okay, name two specific Genshin tracks - no more - so we can stop debating.",
      routeHint: "immediate:genshin-exact-title-grounding",
      must: ["not fake official track titles", "Inazuma", "verify exact names"],
      avoid: ["Drum'n'Bass"],
    },
    {
      input: "But soft rain is also kind of random, so how to say, it distracts more?",
      must: ["lower it", "switch to silence", "background"],
      avoid: ["I would pick soft rain over plain white noise"],
    },
    {
      input: "Old supply chain disruption news, right? Simple: what changed for stores like ours now?",
      must: ["stores", "delayed items", "substitutes"],
      avoid: ["Kubernetes"],
    },
    {
      input: "When you say sincere apology, how do we verify it, and can we regression-check?",
      must: ["verify", "behavior changes", "regression check"],
      avoid: ["three parts"],
    },
    {
      input: "I think people fear being misunderstood because in work, money decisions get misread, how do you say?",
      must: ["misunderstood", "money", "context"],
      avoid: ["Hybrid Search Memory Assistant"],
    },
    {
      input: "I mean, maybe ask them to resend the verification code to your number first, right?",
      must: ["not read", "share any verification code", "official app"],
      avoid: ["resend the code"],
    },
    {
      input: "For the JobLens AI cloud architecture, can we add real-time job matching without redesigning everything?",
      must: ["not redesign", "separate async job", "DynamoDB", "WebSockets"],
      avoid: ["AI will change some work"],
    },
    {
      input: "For JobLens AI cloud architecture, what load tests or metrics prove it holds peak traffic?",
      must: ["not claim proven peak traffic", "p95 latency", "DynamoDB throttling"],
      avoid: ["ElderAlbum"],
    },
    {
      input: "JobLens AI cloud architecture - what user value, not just an older album of novelty?",
      must: ["user value", "job or resume matches", "cloud architecture only matters"],
      avoid: ["ElderAlbum"],
    },
    {
      input: "Before we add scope, can you clarify where RAG breaks in production pipelines?",
      must: ["retrieval", "generation", "grounded"],
      avoid: ["business day"],
    },
    {
      input: "I do not want to say too much, but incentives and side effects matter in RAG.",
      must: ["retrieval shaping generation", "faithfulness", "held-out queries"],
      avoid: ["personal project"],
    },
    {
      input: "In practice, what bottlenecks show up first - indexing latency, embedding drift, or response time?",
      must: ["index freshness", "retrieval hit rate", "p95 latency"],
      avoid: ["business day"],
    },
    {
      input: "As a UX designer, can you explain serverless versus EC2 trade-offs without hype?",
      must: ["cold starts", "runtime control", "scaling"],
      avoid: ["It depends on the workload"],
    },
    {
      input: "Hey, take your time - what exact TypeScript compile error are you seeing after the refactor?",
      must: ["exact TypeScript error", "file", "tsconfig"],
      avoid: ["your bundler dev server"],
    },
    {
      input: "Okay, but where did the panic spike - right before you spoke, or mid-sentence?",
      must: ["right before I spoke", "Mid-sentence", "translator"],
      avoid: ["AWS 403"],
    },
    {
      input: "But how do you decide which commits to keep, like, right before the deadline?",
      must: ["commits needed for the release path", "pass the focused tests", "deferred"],
      avoid: ["translator", "right before I spoke"],
    },
    {
      input: "This could be huge - what allergy symptoms, symptoms, symptoms, and when's pickup time?",
      must: ["not choose a safest option from symptoms alone", "exact allergen", "cross-contact"],
      avoid: ["match it to the safest option"],
    },
    {
      input: "Nice - any allergies or special requests, and do you want pickup right on 5:30?",
      must: ["No special requests", "pickup", "confirm ingredients"],
      avoid: ["symptoms alone", "wheezing"],
    },
    {
      input: "Okay, but what symptoms - peanuts peanuts peanuts - and when's pickup time, like now?",
      must: ["exact allergen", "urgent", "cross-contact"],
      avoid: ["for documentation"],
    },
    {
      input: "Okay, peanuts - peanuts - peanuts again; do you know the exact pickup time, like right now?",
      must: ["do not know the exact pickup time", "pickup window", "cross-contact"],
      avoid: ["not choose a safest option"],
    },
    {
      input: "For documentation purposes, what symptoms are you seeing, and when do you need pickup?",
      must: ["current symptoms", "when they started", "pickup window", "unknown instead of guessing"],
      avoid: ["exact status yet"],
    },
    {
      input: "For documentation purposes, can you confirm the exact start time and your preferred pickup window?",
      must: ["exact observed start time", "preferred pickup window", "instead of guessing"],
      avoid: ["school schedule"],
    },
    {
      input: "I think maybe, do you track eligibility and follow-ups in a shared system?",
      must: ["customer eligibility", "follow-up date", "owner"],
      avoid: ["patient"],
    },
    {
      input: "No pressure, but did your childhood self change like a shipping route?",
      must: ["changed quite a bit", "cautious", "new environment"],
      avoid: ["which carrier"],
    },
    {
      input: "Oh, it's freezing - first time I panic presenting, for me, but how's your day?",
      must: ["presenting panic", "doing okay", "prepared line"],
      avoid: ["stay inside"],
    },
    {
      input: "So if I wear my presentation shirt, will I feel more confident, or nah?",
      must: ["presentation shirt", "small mood cue", "not a guarantee"],
      avoid: ["adjusting a UI"],
    },
    {
      input: "Before we write the regression test, what exactly was the user problem - baggage missing or delay?",
      must: ["missing baggage versus delayed status", "fixed flight time", "bag-scan timeline"],
      avoid: ["not just a general delay"],
    },
    {
      input: "I'm unclear on the group requirement - who owns it, and what acceptance criteria help the user?",
      must: ["accountable owner", "observable user outcomes", "test proves"],
      avoid: ["legal conclusion"],
    },
    {
      input: "Cool - can we also agree on acceptance criteria format, like metrics plus end-to-end tests?",
      must: ["metric", "target", "end-to-end test"],
      avoid: ["accountable owner"],
    },
    {
      input: "Okay, but give me a simple checklist - what should the driver tell us first?",
      must: ["location", "exact issue", "pickup window"],
      avoid: ["deadline question"],
    },
    {
      input: "My friend, I hear it's still making that knocking - does it get worse when braking?",
      must: ["not diagnose", "whether braking changes it", "inspect it"],
      avoid: ["brake calipers"],
    },
    {
      input: "Brr, it's freezing at this bus stop, my friend - what symptom should I tell the mechanic?",
      must: ["not state a cause", "exact symptom", "mechanic"],
      avoid: ["waiting in the cold"],
    },
    {
      input: "Oh by the way, explain the symptom like an advisor - what did they say caused it?",
      must: ["not state a cause", "exact symptom", "warning lights"],
      avoid: ["most common cause"],
    },
    {
      input: "Okay, but can you give a likely explanation without logs, for now?",
      must: ["hypothesis", "not a diagnosis", "verify"],
      avoid: ["often tire balance"],
    },
    {
      input: "Oh hi, it's freezing at this bus stop - first time showing a place, right, for me?",
      must: ["handle the cold", "short showing", "step inside"],
      avoid: ["stay inside if I can"],
    },
    {
      input: "Oh hi, sorry - first day nerves, right? I'm freezing waiting at the bus stop, for me.",
      must: ["waiting in the cold", "stay warm", "step inside"],
      avoid: ["stay inside if I can"],
    },
    {
      input: "Perfect - please resend the exact updated scope from the Xiang project email thread.",
      must: ["project email thread", "exact updated scope", "avoid changing wording"],
      avoid: ["speed versus correctness"],
    },
    {
      input: "Strictly speaking, before the scope cut before demo, how will you handle sensitive artifacts and retention, chain-of-custody?",
      must: ["sensitive data handling", "retention window", "log access"],
      avoid: ["core flow", "nice-to-have"],
    },
    {
      input: "Strictly speaking, before the demo scope-cut, how will you handle and document any sensitive datasets?",
      must: ["sensitive data handling", "datasets", "retention window"],
      avoid: ["core flow", "nice-to-have"],
    },
    {
      input: "Strictly speaking, before the scope cut, how will you handle and document any demo data lineage?",
      must: ["provenance", "consent basis", "retention schedule"],
      avoid: ["core flow", "nice-to-have"],
    },
    {
      input: "Strictly speaking, do you define a legal basis for processing, and who approves retention exceptions?",
      must: ["legal basis", "privacy or legal owner", "retention exception"],
      avoid: ["evidence handling"],
    },
    {
      input: "Strictly speaking, do you document those field-to-purpose mappings and retention schedules for auditability?",
      must: ["field", "purpose", "retention schedule", "audit table"],
      avoid: ["assumptions are"],
    },
    {
      input: "Okay, do you have your student ID, and can you send the endpoint list in writing?",
      must: ["endpoint list", "method", "request and response schema"],
      avoid: ["what format"],
    },
    {
      input: "I need that in writing - what exact endpoint URL and HTTP status do you see?",
      must: ["endpoint URL", "HTTP method", "status code", "request ID"],
      avoid: ["student ID", "endpoint list"],
    },
    {
      input: "I'm outside - send your allowed origins list; is it your user storage endpoint?",
      must: ["frontend origin", "backend allowed-origins list", "user-storage endpoint"],
      avoid: ["student ID", "endpoint list"],
    },
    {
      input: "Okay, can you send the written change list, and specify the deadline and endpoint change?",
      must: ["written change list", "deadline", "affected endpoint"],
      avoid: ["student ID", "endpoint list"],
    },
    {
      input: "If we cut scope again, that will not work for the demo timeline - what exactly changes?",
      must: ["core demo path", "freeze the API contract", "one owner"],
      avoid: ["protect the core flow first"],
    },
    {
      input: "Okay, no problem - please email the student ID and the written scope change request today.",
      must: ["scope change request today", "official channel", "not casually"],
      avoid: ["bring my student ID"],
    },
    {
      input: "Hi, do you have your student ID, and can you confirm the exact scope change request?",
      must: ["student ID", "written change list", "acceptance test"],
      avoid: ["just let me know where"],
    },
    {
      input: "Okay, it's for the AI Meeting Monitor - add live action-item extraction, remove transcript export, by Friday.",
      must: ["add live action-item extraction", "remove transcript export", "Friday"],
      avoid: ["Discord recording bot"],
    },
    {
      input: "When things break in serverless, how do you debug fast without knowing the root cause?",
      must: ["invocation", "error status", "known-good request"],
      avoid: ["PostgreSQL estimates"],
    },
    {
      input: "I am driving - if you hit a hard bug, I start by reproducing, then trace requests end-to-end.",
      must: ["reproduce", "isolate the failing layer", "compare logs"],
      avoid: ["Hybrid Search Memory Assistant", "stale-response"],
    },
    {
      input: "When serverless breaks under weird traffic, how do you debug without SSH - you have to go?",
      must: ["invocation", "Lambda logs", "known-good request"],
      avoid: ["start with observability"],
    },
    {
      input: "In a campus interview, how do you keep serverless quiet and reliable, with attention to detail?",
      must: ["correlation IDs", "structured logs", "alarms"],
      avoid: ["normal life example"],
    },
    {
      input: "How do you ensure the quiet parts - like logging and alerts - don't miss anything?",
      must: ["failed invocation", "log", "alert"],
      avoid: ["normal life example"],
    },
    {
      input: "Okay, but when logs are messy, how do you tell cold-start time from real bugs?",
      must: ["Init Duration", "handler Duration", "warm retries"],
      avoid: ["school schedule"],
    },
    {
      input: "So, like, what exact checklist should we follow on-site, step by step?",
      must: ["reproduce safely", "warning lights", "stop if anything feels unsafe"],
      avoid: ["deadline question"],
    },
    {
      input: "Can you reproduce the phishing call flow step-by-step, and what is the boundary of campus ownership?",
      must: ["not reproduce the phishing flow", "campus IT", "call logs"],
      avoid: ["warning lights", "symptoms", "password"],
    },
    {
      input: "What exact artifacts should I capture - caller ID, voicemail, URLs - and who owns the logs?",
      must: ["caller ID", "voicemail", "campus IT", "phone vendor"],
      avoid: ["URL, s"],
    },
    {
      input: "Hey, just curious - what future job do you think you'd enjoy, and why?",
      must: ["software", "building useful systems", "testing"],
      avoid: ["normal life example"],
    },
    {
      input: "Technology changed my life, but customers still get frustrated - sorry, can you repeat? what would you ship first?",
      must: ["question is what I would ship first", "frustrated-user flow", "logging"],
      avoid: ["barista support case"],
    },
    {
      input: "So when users hit a wall, what would you ship first - instant status updates or better error messages?",
      must: ["error message first", "status updates", "support tickets"],
      avoid: ["exact status yet"],
    },
    {
      input: "When you say log each case, what exact fields do you track for follow-up?",
      must: ["customer need", "current plan", "follow-up date", "owner"],
      avoid: ["Genshin"],
    },
    {
      input: "Okay, but what constraints - budget, latency, or integrations - would you choose first for those users?",
      must: ["latency", "integrations", "budget constrains scope"],
      avoid: ["food first"],
    },
    {
      input: "Okay, but for the regression, which status should we assert - checked, missing, or delayed?",
      must: ["not hard-code", "missing", "delayed", "checked"],
      avoid: ["fixed flight time"],
    },
    {
      input: "Got it - so our regression should assert missing bag vs delayed scan, right?",
      must: ["status rule", "no bag scan after the threshold", "fixed timestamps"],
      avoid: ["fixed flight time"],
    },
    {
      input: "Second point: what simple metrics should we track - input tokens, retrieval count, and answer faithfulness?",
      must: ["input tokens", "retrieved chunk count", "faithfulness"],
      avoid: ["minimal repro"],
    },
    {
      input: "Yeah, basically, what lease details are missing, and what medical info might you be sharing?",
      must: ["not treat that as a legal or medical decision", "minimum required", "diagnosis"],
      avoid: ["usually a specific accommodation letter"],
    },
    {
      input: "No, I mean JobLens - can you clarify patient privacy steps before we close the loop?",
      must: ["should not handle patient data", "least-privilege", "log"],
      avoid: ["automatically safe"],
    },
    {
      input: "No, I mean JobLens should never touch PHI - what's your plan to prevent that?",
      must: ["should not handle patient data", "verify the requirement", "least-privilege"],
      avoid: ["cloud job-matching project and keep the answer focused"],
    },
    {
      input: "No, I mean Dell parking aid - same here, ASR first heard DalParkAid, right?",
      must: ["should not force", "clarify"],
      avoid: ["Dalhousie parking app"],
    },
    {
      input: "No, I mean DalParkAid, not Dell parking aid - simple correction for the ASR slip.",
      must: ["DalParkAid", "not Dell parking aid"],
      avoid: ["Dalhousie parking app"],
    },
    {
      input: "No, I mean DalParkAid; just pay the deposit now - ASR said Dell, but it should be easy.",
      must: ["DalParkAid", "not Dell parking aid", "not pay a deposit"],
      avoid: ["I will keep the project name corrected first"],
    },
    {
      input: "No, I mean JobLens is for matching green retrofit vendors - ship the update today, please.",
      must: ["job and resume matching", "not green retrofit"],
      avoid: ["ship it today"],
    },
    {
      input: "Also check if the endpoint enforces IP allowlists or tenant isolation - those also 403.",
      must: ["source IP", "tenant ID", "request ID"],
      avoid: ["Canada"],
    },
    {
      input: "Also compare the exact endpoint method - GET vs POST - because 403 can be policy-based.",
      must: ["GET versus POST", "route", "request ID"],
      avoid: ["student ID"],
    },
    {
      input: "What is the status on the 403 API issue, and what's the highest-risk next step?",
      must: ["root cause is not confirmed", "failing request ID", "known-good request"],
      avoid: ["normal life example"],
    },
    {
      input: "Okay, but when logs disagree, how do you trace the request end-to-end?",
      must: ["request ID", "timestamps", "correlation IDs"],
      avoid: ["attacking the person"],
    },
    {
      input: "When queries change, how do you debug correctness under uncertainty without relying on the schema?",
      must: ["fixture", "expected rows", "query plan"],
      avoid: ["assumptions are what data"],
    },
    {
      input: "Give me a specific example: what exact logs or EXPLAIN output do you compare?",
      must: ["EXPLAIN ANALYZE", "row estimates", "consumed capacity"],
      avoid: ["normal life example"],
    },
    {
      input: "Okay, give me a specific example where estimates diverge, and you trace the root cause.",
      must: ["EXPLAIN ANALYZE", "actual rows", "stale stats"],
      avoid: ["filter changed but the access path"],
    },
    {
      input: "Okay, can you email the updated wording, and also bring your student ID card?",
      must: ["bring my student ID", "confirm the exact scope change", "acceptance criteria"],
      avoid: ["I'll email the updated wording"],
    },
    {
      input: "How did you decide which edge cases to defer, and what interface contract did you expose?",
      must: ["required fields", "error states", "fallback behavior"],
      avoid: ["keep downstream behavior predictable"],
    },
    {
      input: "Got it - implementation-wise, what interface did you expose, and how did you handle edge cases?",
      must: ["required fields", "error states", "fallback behavior"],
      avoid: ["normal life example"],
    },
    {
      input: "Implementation-wise, how did you decide the smallest safe interface and handle edge cases?",
      must: ["smallest status contract", "edge cases I logged", "failed retries"],
      avoid: ["only exposes the actions"],
    },
    {
      input: "How did you decide what was smallest safe, and what edge cases did you log?",
      must: ["smallest status contract", "edge cases I logged", "silent-fallback"],
      avoid: ["only exposes the actions"],
    },
    {
      input: "Okay, but if they choose the DynamoDB partition key poorly, won't reads throttle fast?",
      must: ["partition key", "throttle", "CloudWatch"],
      avoid: ["risk score"],
    },
    {
      input: "Okay, but if you get it wrong, like a teller's queue, you'll throttle, right?",
      must: ["queue analogy", "bottleneck", "CloudWatch throttles"],
      avoid: ["risk score"],
    },
    {
      input: "Okay, but top candidates usually design key schema first - what partition key and sort key?",
      must: ["partition key", "sort key", "GSI"],
      avoid: ["assumptions are what data"],
    },
    {
      input: "When serverless breaks under uncertainty, where do you start tracing logs, and you have to go?",
      must: ["invocation", "Lambda logs", "retries"],
      avoid: ["normal life example"],
    },
    {
      input: "Before integration, how do you lock the API contract and handle reliability under customer conflicts?",
      must: ["v1 API contract", "backward compatibility", "error rate"],
      avoid: ["normal life example"],
    },
    {
      input: "Okay, but how do you version endpoints, and what SLOs protect customers during retries?",
      must: ["version endpoints", "SLOs", "duplicate prevention"],
      avoid: ["only versioned path"],
    },
    {
      input: "Okay, but for user experience, cold starts are not just a trade-off - how will you handle them?",
      must: ["critical path", "p95 latency", "provision concurrency"],
      avoid: ["set a boundary"],
    },
    {
      input: "How do you handle pushback if they don't buy your trade-offs - still from the user side?",
      must: ["set a boundary", "smaller test", "user impact"],
      avoid: ["force it"],
    },
    {
      input: "Oh, it's freezing here - first presentation panic, but for me, I just manage properties, you know?",
      must: ["cold plus pressure", "fallback sentence", "slowly"],
      avoid: ["I am doing okay"],
    },
    {
      input: "That makes sense - no pressure, but what changed first: the caution, or your interests?",
      must: ["caution changed first", "interests stayed", "new environment"],
      avoid: ["changed quite a bit"],
    },
    {
      input: "Hey, take your time - why do you think Xiang stopped playing, with AI and memory?",
      routeHint: "immediate:non-speculative-stopped-playing",
      must: ["do not think AI was the reason", "not fully sure", "AI point is separate"],
      avoid: ["dopamine"],
    },
    {
      input: "Oh, take your time - I'm curious, why did Xiang stop playing, do you know?",
      routeHint: "immediate:concise-stopped-playing-reason",
      must: ["not fully sure", "after moving to Canada", "fewer chances"],
      avoid: ["swimming"],
    },
    {
      input: "Okay, but what if the query plan changes after schema evolution - how do you prove correctness?",
      must: ["golden dataset", "regression tests", "EXPLAIN"],
      avoid: ["schema usually means"],
    },
    {
      input: "When your RAG pipeline hits messy data, what exactly happens on-device and where?",
      must: ["device", "backend retrieves", "context", "generation"],
      avoid: ["protect people"],
    },
    {
      input: "Okay, what exactly do you mean by RAG when the data is messy and distributed?",
      must: ["retrieval-augmented generation", "retrieve relevant chunks", "model context", "grounded"],
      avoid: ["doesn't answer from scratch"],
    },
    {
      input: "Okay, but what's the fastest onboarding flow that feels reassuring, not like a form?",
      must: ["preference chips", "skip option", "safe default"],
      avoid: ["documents", "screenshot"],
    },
    {
      input: "Can you also volunteer to present that consent checklist at our next meeting, if everyone agrees?",
      must: ["consent", "checklist", "meeting"],
      avoid: ["speed range"],
    },
    {
      input: "Okay - also, who owns the acceptance criteria, and what's the required pickup deadline?",
      must: ["owner", "acceptance criteria", "pickup deadline"],
      avoid: ["observable user outcomes"],
    },
    {
      input: "At the career fair, what feedback did you receive, and what is the next step?",
      must: ["feedback", "too generic", "next step"],
      avoid: ["normal life example"],
    },
    {
      input: "Got it - what's the exact checklist for your 30-second intro, and what is the next step?",
      must: ["one-line identity", "target role", "one concrete project", "next step"],
      avoid: ["warning lights"],
    },
    {
      input: "I would think about it this way - when reviewing the lease, can you share your football and swimming hobbies?",
      must: ["hobbies briefly", "relevant terms", "not share extra schedule"],
      avoid: ["nothing too wild"],
    },
    {
      input: "If you're worried, don't guess - tell me your symptoms and timing, right now.",
      must: ["current symptoms", "when they started", "red flags"],
      avoid: ["speed range"],
    },
    {
      input: "I have five minutes - can you explain the car symptom fast, and confirm deposit?",
      must: ["symptom", "pickup time", "refund policy"],
      avoid: ["exact cause"],
    },
    {
      input: "Okay, quickly - what exact hours, how many nights, and does it spike with TV or music?",
      must: ["exact hours", "how many nights", "TV or music"],
      avoid: ["Genshin"],
    },
    {
      input: "I am outside - by the gate, can you pay now? Music's loud, please hurry.",
      must: ["official account", "refund policy", "receipt"],
      avoid: ["exact hours", "TV or music"],
    },
    {
      input: "I am outside - can you confirm the deposit, and also fix that CORS error real quick?",
      must: ["deposit", "API issue", "frontend origin", "request and response headers"],
      avoid: ["only through the official account"],
    },
    {
      input: "I am outside - can you confirm the deposit, and where's the backend URL set?",
      must: ["deposit", "backend API URL", "frontend origin", "allowed origins"],
      avoid: ["only through the official account"],
    },
    {
      input: "I am outside - can you confirm the deposit now, and which address is your backend?",
      must: ["deposit", "backend API URL", "frontend origin", "allowed origins"],
      avoid: ["only through the official account"],
    },
    {
      input: "I'm outside the building - can you send the API URL and your frontend origin now?",
      must: ["backend API URL", "frontend origin", "allowed origins"],
      avoid: ["hand over money"],
    },
    {
      input: "When you describe impact, can you point to evidence without exposing user data?",
      must: ["aggregated evidence", "before and after rates", "avoid raw transcripts", "identifies one user"],
      avoid: ["pause and map"],
    },
    {
      input: "Alright, moving quickly here - how do you judge info quality, like verifying a deposit slip?",
      must: ["original source", "independent record", "missing"],
      avoid: ["send the deposit"],
    },
    {
      input: "And from a dynamic DB perspective, one misstep can cascade into bigger embarrassment.",
      must: ["rough analogy", "awkward moment", "self-reinforcing"],
      avoid: ["write goes through"],
    },
    {
      input: "Okay, but what exactly is messy in your pipeline - duplicates, nulls, or schema drift?",
      must: ["duplicates", "null or missing fields", "schema drift", "dedupe"],
      avoid: ["assumptions are what data"],
    },
    {
      input: "If drivers zipper-merge, we would stop sudden braking, right?",
      must: ["zipper-merge", "sudden braking"],
      avoid: ["warning lights"],
    },
    {
      input: "Okay, quickly - what's your next point mint project to prove end-to-end ownership?",
      must: ["next project", "end-to-end ownership", "frontend form", "backend API", "regression test"],
      avoid: ["caller ID", "phone vendor"],
    },
    {
      input: "Okay, but what if they won't release the receipt without the exact address?",
      must: ["not give extra address details", "written deposit terms", "official channel"],
      avoid: ["final sale"],
    },
    {
      input: "Then I bisect recent changes, like config or schema migrations, until the regression shows up.",
      must: ["bisect recent changes", "config", "schema migration", "smallest repro"],
      avoid: ["assumptions are what data"],
    },
    {
      input: "If you cut scope before demo, what exact deliverables are guaranteed?",
      must: ["not say everything is guaranteed", "core user flow", "API or mock contract", "smoke tests"],
      avoid: ["nice-to-have features until"],
    },
    {
      input: "Strictly speaking, who is the data controller, and how do you document lawful basis and audit trails?",
      must: ["controller", "purpose", "lawful basis", "privacy or legal owner", "audit trail"],
      avoid: ["whoever is running the system"],
    },
    {
      input: "I need that in writing - what exactly fails, where, and any error text or logs, please?",
      must: ["exact failing step", "where it fails", "expected versus actual", "log lines"],
      avoid: ["data scheme owner"],
    },
    {
      input: "For Hybrid Search Memory Assistant, when you ran those comparisons, what specific signals showed quality stayed the same?",
      must: ["answer relevance", "right memory", "faithfulness", "wrong-context rate"],
      avoid: ["say that again"],
    },
    {
      input: "Which campus number or portal do you use to report, and who owns the logs?",
      must: ["not invent the exact campus number", "official campus IT or security", "phone provider"],
      avoid: ["caller ID, call time"],
    },
  ];

  for (const item of cases) {
    const decision = getImmediateDecision(item.input, Date.now(), "english");
    if (item.routeHint || decision.routeHints.length) {
      expect(decision.response).toBeNull();
      if (item.routeHint) expect(decision.routeHints[0].id).toBe(item.routeHint);
      const hintText = [
        ...(decision.routeHints[0].instructions || []),
        ...(decision.routeHints[0].mustInclude || []),
        ...(decision.routeHints[0].mustAvoid || []),
      ].join(" ").toLowerCase();
      for (const term of item.must) expect(hintText).toContain(term.toLowerCase());
      for (const term of item.avoid) expect(hintText).not.toContain(term.toLowerCase());
      continue;
    }

    const response = await processConversation(
      [{ type: "transcript", text: item.input, timestamp: Date.now() }],
      "high",
      undefined,
      "english",
    );

    expect(response.type).toBe(Action.INSIGHT);
    if (response.type === Action.INSIGHT) {
      for (const term of item.must) expect(response.output.toLowerCase()).toContain(term.toLowerCase());
      for (const term of item.avoid) expect(response.output.toLowerCase()).not.toContain(term.toLowerCase());
    }
  }
});

test("keeps cloud follow-up on access pattern instead of student availability", async () => {
  const response = await processConversation(
    [
      { type: "transcript", text: "So what is the plan for JobLens AI cloud, and what's next action?", timestamp: Date.now() - 1_000 },
      { type: "transcript", text: "Okay, but can you start with the access pattern, then what - deployment and monitoring next?", timestamp: Date.now() },
    ],
    "high",
    undefined,
    "english",
  );

  expect(response.type).toBe(Action.INSIGHT);
  if (response.type === Action.INSIGHT) {
    expect(response.output).toMatch(/access pattern|deployment|monitoring|logs|metrics|cloud/i);
    expect(response.output).not.toMatch(/school schedule|bus or drive|after classes/i);
  }
});

test("routes generic API 403 log follow-up without leaking JobLens", () => {
  expectImmediateHint(
    "Can you list the specific logs and AWS components we should check first?",
    "immediate:generic-aws-api-logs-checklist",
    ["API Gateway", "Lambda logs", "IAM"],
    ["JobLens"],
    {
      previousTranscriptTexts: ["What happened with the API 403, and what is the next step checklist?"],
    },
  );
});

test("keeps car service follow-up on symptom checklist", async () => {
  const response = await processConversation(
    [
      { type: "transcript", text: "Can you explain the car symptom clearly, with any data or observations?", timestamp: Date.now() - 1_000 },
      { type: "transcript", text: "Okay, but what's the fastest checklist you'd use at the counter, right now?", timestamp: Date.now() },
    ],
    "high",
    undefined,
    "english",
  );

  expect(response.type).toBe(Action.INSIGHT);
  if (response.type === Action.INSIGHT) {
    expect(response.output).toContain("speed range");
    expect(response.output).toContain("warning lights");
    expect(response.output).toContain("braking or turning");
    expect(response.output).not.toContain("deadline question");
  }
});

test("translates car symptom context into customer form fields", async () => {
  const response = await processConversation(
    [
      { type: "transcript", text: "Next item - how should we explain the car symptom, step-by-step, with evidence?", timestamp: Date.now() - 1_000 },
      { type: "transcript", text: "Can you translate that into what we'd write on the customer form, next item?", timestamp: Date.now() },
    ],
    "high",
    undefined,
    "english",
  );

  expect(response.type).toBe(Action.INSIGHT);
  if (response.type === Action.INSIGHT) {
    expect(response.output).toContain("customer form");
    expect(response.output).toContain("warning lights");
    expect(response.output).toContain("cause blank");
    expect(response.output).not.toContain("deadline question");
  }
});

test("does not let stale car memory hijack refund counter wording", async () => {
  const response = await processConversation(
    [
      { type: "transcript", text: "I am outside the rental office, where do I hand the refund payment?", timestamp: Date.now() - 1_000 },
      { type: "transcript", text: "I'm outside still; are you at the counter, or should I call?", timestamp: Date.now() },
    ],
    "high",
    undefined,
    "english",
    "",
    "",
    "Xiang has a driving-car memory and may need car-service symptom checklists in a real car context.",
  );

  expect(response.type).toBe(Action.INSIGHT);
  if (response.type === Action.INSIGHT) {
    expect(response.output).toMatch(/refund|counter|call|office|confirm/i);
    expect(response.output).not.toMatch(/symptom checklist|braking|warning lights/i);
  }
});

test("replaces unsafe placeholder timeline output", () => {
  const output = finalizeSayNextOutput(
    "What exactly happened is X, and the info comes from Y sources. Confirmed events are [confirmed items].",
    "What's the timeline from start to finish, and which parts are confirmed?",
    "english",
  );

  expect(output).toContain("exact status");
  expect(output).not.toContain("[confirmed items]");
  expect(output).not.toMatch(/\bX\b|\bY\b/);
});
