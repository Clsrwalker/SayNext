import { expect, test } from "bun:test";
import { buildOpenAiConversationInput } from "../mastra/agents/openai-conversation-state";
import { buildAnswerIntentHint, classifyAnswerIntent } from "../saynext/answer-intent";
import { buildLiveXiangProfile } from "../saynext/context-builder";
import { buildSayNextLiveTaskPrompt } from "../saynext/prompts";

test("ordinary practical questions prefer common-sense direct answers", () => {
  const intent = classifyAnswerIntent("How do you measure an elephant?", "general");
  expect(intent).toBe("ordinary_practical");

  const hint = buildAnswerIntentHint(intent);
  expect(hint).toContain("most likely everyday answer first");
  expect(hint).toContain("Use a large platform scale or weighbridge");
  expect(hint).toContain("Do not give a checklist, categories");
  expect(hint).toContain("safety, medical, legal, money");
});

test("everyday boiling-water question stays ordinary instead of technical taxonomy", () => {
  expect(classifyAnswerIntent("How do you know water is boiling?", "casual"))
    .toBe("ordinary_practical");
});

test("technical mechanism questions ask for mechanism and one trade-off", () => {
  const intent = classifyAnswerIntent("Why does a database index make queries faster?", "technical");
  expect(intent).toBe("technical_mechanism");
  expect(buildAnswerIntentHint(intent)).toContain("core mechanism");
});

test("debug questions prioritize first check and inspection signal", () => {
  const intent = classifyAnswerIntent("If an API endpoint suddenly gets slow, how would you debug it?", "technical");
  expect(intent).toBe("technical_debug");
  expect(buildAnswerIntentHint(intent)).toContain("first check");
});

test("technical mode does not fall back to ordinary practical routing", () => {
  expect(classifyAnswerIntent("Why is a hash map lookup usually fast?", "technical"))
    .toBe("technical_mechanism");
  expect(classifyAnswerIntent("If a React page suddenly re-renders too much, how would you debug it?", "technical"))
    .toBe("technical_debug");
});

test("technical debug catches symptom paraphrases without requiring the word debug", () => {
  const cases = [
    "My page keeps updating again and again.",
    "The button fires twice.",
    "The submit button sends the request two times.",
    "My React button sends the form twice but I only clicked once.",
    "The click handler calls the API twice.",
    "The API works locally but fails after deploy.",
    "It works on my machine but breaks after deployment.",
    "Why is my API slow after deployment?",
    "The database query is fine with small data but gets slow with more records.",
    "The query is okay on 100 rows but slow on a million rows.",
    "The model loss becomes NaN after a few epochs.",
    "The model accuracy is high on training data but bad on validation data.",
    "My React component keeps rendering in a loop.",
    "My login works in Chrome but not Safari.",
    "The page flashes and then goes blank after I sign in.",
    "The chart looks fine with ten rows but freezes with the real dataset.",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "technical")).toBe("technical_debug");
  }
});

test("technical mechanism questions do not get swallowed by debug routing", () => {
  const cases = [
    "Why does a hash map lookup usually fast?",
    "How does React state update work?",
    "What is database indexing?",
    "Why does model loss decrease during training?",
    "Why does HTTP caching reduce latency?",
    "Why does this cache reduce latency?",
    "Why does browser caching make repeat visits faster?",
    "How does my index speed up the query?",
    "Why would this hash map lookup be fast?",
    "What is a deadlock?",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "technical")).toBe("technical_mechanism");
  }
});

test("casual personal preference questions do not fall into ordinary practical by default", () => {
  expect(classifyAnswerIntent("Do you miss your hometown?", "casual"))
    .toBe("casual_opinion");
  expect(classifyAnswerIntent("Do you usually cook or order takeout?", "casual"))
    .toBe("casual_opinion");
});

test("casual greeting and day questions do not expose project anchors", () => {
  expect(classifyAnswerIntent("How is your day going?", "casual"))
    .toBe("casual_opinion");
  expect(classifyAnswerIntent("How are you doing today?", "casual"))
    .toBe("casual_opinion");

  const profile = buildLiveXiangProfile("casual");
  expect(profile).not.toContain("Known projects:");
  expect(profile).not.toContain("Hybrid Search Memory Assistant");
  expect(profile).not.toContain("Elder Album");
});

test("base live profile does not expose project names without retrieved memory", () => {
  const profile = buildLiveXiangProfile("interview");

  expect(profile).not.toContain("Known projects:");
  expect(profile).not.toContain("Hybrid Search Memory Assistant");
  expect(profile).not.toContain("SayNext");
  expect(profile).not.toContain("JobLens");
  expect(profile).not.toContain("Elder Album");
  expect(profile).toContain("use retrieved memory context");
});

test("consumer device problems stay ordinary unless framed as software debugging", () => {
  const cases = [
    "My phone is slow.",
    "My laptop battery dies fast.",
    "My Wi-Fi is bad.",
    "My printer is not working.",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "general")).not.toBe("technical_debug");
  }
});

test("technical debug catches natural troubleshooting language", () => {
  const cases = [
    "Where should I look if the API is slow after deployment?",
    "What would you check first when the database query times out?",
    "How do I figure out why this endpoint returns 500?",
    "What could cause the React page to keep refreshing?",
    "My API works in localhost but CORS blocks it in the browser after deploy.",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "technical")).toBe("technical_debug");
  }
});

test("interview behavioral questions use natural story shape", () => {
  const intent = classifyAnswerIntent("Tell me about a time you handled a difficult technical problem.", "interview");
  expect(intent).toBe("interview_behavioral");
  expect(buildAnswerIntentHint(intent)).toContain("without labels");
  expect(buildAnswerIntentHint(intent)).toContain("Do not invent a past-tense story");
  expect(buildAnswerIntentHint(intent)).toContain("I would");
  expect(buildAnswerIntentHint(intent)).toContain("Never mention awards");
});

test("service mode separates admin issues from high-risk pressure", () => {
  expect(classifyAnswerIntent("The landlord says I have to pay today or lose the apartment deposit.", "service"))
    .toBe("service_risk");
  expect(classifyAnswerIntent("The doctor form asks for insurance details and I am not sure what to write.", "service"))
    .toBe("service_risk");
  expect(classifyAnswerIntent("The front desk says my package is missing, what should I ask them?", "service"))
    .toBe("service_admin");
  expect(buildAnswerIntentHint("service_risk")).toContain("do not agree or commit");
  expect(buildAnswerIntentHint("service_admin")).toContain("record, ID, status");
});

test("personal fact questions keep supported facts boundary", () => {
  const intent = classifyAnswerIntent("What is your major at Dalhousie?", "interview");
  expect(intent).toBe("personal_fact");
  expect(buildAnswerIntentHint(intent)).toContain("supported profile");
  expect(buildAnswerIntentHint(intent)).not.toContain("Master of Applied Computer Science");
  expect(buildAnswerIntentHint(intent)).toContain("Do not expand acronyms");
});

test("previous school and degree questions route as personal facts before interview style", () => {
  expect(classifyAnswerIntent("Where did you study before Dalhousie?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("Where are you originally from?", "interview"))
    .toBe("personal_fact");
  expect(buildAnswerIntentHint("personal_fact")).not.toContain("Chengdu, China");
  expect(classifyAnswerIntent("What was your previous degree before MACS?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("What program are you taking now?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("What did you study at Acadia?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("What school did you go to for your bachelor's?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("What did you study during your bachelor degree?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("Which city are you from in China?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("Are you studying computer science or math right now?", "interview"))
    .toBe("personal_fact");
  expect(classifyAnswerIntent("Are you legally allowed to work in Canada?", "interview"))
    .toBe("personal_fact");
});

test("interview experience questions are not swallowed by strict identity fact routing", () => {
  expect(classifyAnswerIntent("How would you describe your backend experience?", "interview"))
    .toBe("interview_project");
  expect(classifyAnswerIntent("Can you explain one of your projects?", "interview"))
    .toBe("interview_project");
  expect(buildAnswerIntentHint("interview_project")).toContain("named project from memory");
  expect(buildAnswerIntentHint("interview_project")).toContain("first sentence");
  expect(buildAnswerIntentHint("interview_project")).toContain("generic frontend/API/data-layer");
  expect(classifyAnswerIntent("Can you debug your program?", "interview"))
    .not.toBe("personal_fact");
  expect(classifyAnswerIntent("Can you explain your school project architecture?", "interview"))
    .toBe("interview_project");
  expect(classifyAnswerIntent("What did you do in your university project?", "interview"))
    .toBe("interview_project");
  expect(classifyAnswerIntent("What was your role in JobLens?", "interview"))
    .toBe("interview_project");
  expect(classifyAnswerIntent("What kind of database did you use in JobLens?", "interview"))
    .toBe("interview_project");
  expect(classifyAnswerIntent("Do you miss your hometown?", "casual"))
    .not.toBe("personal_fact");
  expect(classifyAnswerIntent("What is your salary expectation for an entry-level developer role?", "interview"))
    .toBe("interview_concept");
});

test("software interview coding prompts route to solution mode across realistic variants", () => {
  const cases = [
    "I'm curious how you would structure the core classes for this online reading app.",
    "For this object-oriented design question, what components would be important?",
    "Let's solve this in CoderPad; design a library where users can set an active book.",
    "How would you implement pagination for the active book?",
    "Talk me through your approach before you start coding.",
    "What data structures would you use for this coding problem?",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "interview")).toBe("interview_technical_solution");
  }

  const hint = buildAnswerIntentHint("interview_technical_solution");
  expect(hint).toContain("produce a solution");
  expect(hint).toContain("components/classes");
  expect(hint).toContain("fields");
  expect(hint).toContain("methods");
  expect(hint).toContain("code skeleton");
  expect(hint).toContain("not a social acknowledgement");
});

test("explicit coding interview requests require actual code or pseudocode", () => {
  const cases = [
    "I would love to see some Python pseudocode to flesh out one of these classes.",
    "Can you write the Python code for the Book class?",
    "Let's code the Library class now.",
    "Could you write a function to find duplicates in an array?",
    "Show me a class skeleton with the fields and methods.",
    "Can you implement the pagination method?",
    "How would you implement this LRU cache? Can you write the code structure?",
    "How would you implement a simple rate limiter? Show the class shape.",
    "Design a job scheduler class and write the main methods.",
    "For this Kindle-like library system, what classes would you write and how would the code look?",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "interview")).toBe("interview_code_solution");
  }

  const hint = buildAnswerIntentHint("interview_code_solution");
  expect(hint).toContain("actual code");
  expect(hint).toContain("short comment");
  expect(hint).toContain("glasses-readable");
  expect(hint).toContain("preserve indentation");
  expect(hint).toContain("not just say what you would write");
});

test("interview debugging prompts route to debug instead of generic concept", () => {
  const cases = [
    "Walk me through how you would debug an endpoint that returns 500 after deploy.",
    "The API works locally but fails after deploy. What would you check first?",
    "My submit button fires twice after I click it once. How would you debug it?",
    "The query is fine with small data but gets slow with more records. How would you fix it?",
  ];

  for (const transcript of cases) {
    expect(classifyAnswerIntent(transcript, "interview")).toBe("interview_debug_solution");
  }

  expect(buildAnswerIntentHint("interview_debug_solution")).toContain("concrete investigation plan");
  expect(buildAnswerIntentHint("interview_debug_solution")).toContain("3-5 practical steps");
  expect(buildAnswerIntentHint("interview_debug_solution")).toContain("query plan");
});

test("interview intent can use transcript context when the latest line says only it or this", () => {
  const transcriptContext = [
    "The interviewer gives a debugging scenario.",
    "A Node backend endpoint works locally, but after deployment it returns 500 only for one route.",
    "Logs show the database URL is loaded, but the query fails after the request reaches the server.",
  ].join("\n");
  const latest = "Walk me through how you would debug it and what you would check first.";

  expect(classifyAnswerIntent(`${transcriptContext}\n${latest}`, "interview"))
    .toBe("interview_debug_solution");
});

test("software interview solution routing does not swallow project, behavior, or identity questions", () => {
  expect(classifyAnswerIntent("Can you explain your school project architecture?", "interview"))
    .toBe("interview_project");
  expect(classifyAnswerIntent("Tell me about a time you handled conflict with a teammate.", "interview"))
    .toBe("interview_behavioral");
  expect(classifyAnswerIntent("What is your major at Dalhousie?", "interview"))
    .toBe("personal_fact");
});

test("service admin catches delivery status issues even without question shape", () => {
  expect(classifyAnswerIntent("The delivery app says delivered but nothing is at my door.", "service"))
    .toBe("service_admin");
});

test("interview intro is distinct from bare identity facts", () => {
  const intent = classifyAnswerIntent("Tell me about yourself.", "interview");
  expect(intent).toBe("interview_intro");
  expect(buildAnswerIntentHint(intent)).toContain("professional self-introduction");
  expect(buildAnswerIntentHint(intent)).toContain("Do not simplify MACS to Computer Science");
  expect(classifyAnswerIntent("Introduce yourself briefly.", "interview")).toBe("interview_intro");
});

test("ordinary from-phrases do not route as personal facts", () => {
  expect(classifyAnswerIntent("How do you remove a sticker from a bottle?", "casual"))
    .toBe("ordinary_practical");
  expect(classifyAnswerIntent("How do you keep soup from spilling in a bag?", "general"))
    .toBe("ordinary_practical");
  expect(classifyAnswerIntent("What is the easiest way to remember someone's name?", "casual"))
    .toBe("ordinary_practical");
  expect(classifyAnswerIntent("How do I get rid of a bad smell in a lunch box?", "casual"))
    .toBe("ordinary_practical");
  expect(classifyAnswerIntent("My glasses keep fogging up when I walk outside, what should I do?", "casual"))
    .toBe("ordinary_practical");
});

test("classroom mode separates direct answers from lecture notes", () => {
  expect(classifyAnswerIntent("What is the CAP theorem?", "classroom")).toBe("classroom_answer");
  expect(classifyAnswerIntent("Compare batch normalization and layer normalization.", "classroom")).toBe("classroom_answer");
  expect(classifyAnswerIntent("The lecture is discussing consistency and availability in the CAP theorem.", "classroom")).toBe("classroom_note");
  expect(buildAnswerIntentHint("classroom_answer")).toContain("Do not write a mini textbook");
});

test("SayNext live prompt carries answer strategy before scene context", () => {
  const prompt = buildSayNextLiveTaskPrompt({
    promptMode: "general",
    answerIntentHint: buildAnswerIntentHint("ordinary_practical"),
    formattedSceneProfile: "Scene: Daily Chat",
  });

  expect(prompt).toContain("Answer strategy:");
  expect(prompt).toContain("most likely everyday answer first");
  expect(prompt.indexOf("Answer strategy:")).toBeLessThan(prompt.indexOf("Scene guidance:"));
});

test("ordinary practical calibration does not leak into technical or interview hints", () => {
  expect(buildAnswerIntentHint("technical_mechanism")).not.toContain("weighbridge");
  expect(buildAnswerIntentHint("technical_debug")).not.toContain("wet shoes");
  expect(buildAnswerIntentHint("service_admin")).not.toContain("weighbridge");
  expect(buildAnswerIntentHint("service_risk")).not.toContain("wet shoes");
  expect(buildAnswerIntentHint("interview_concept")).not.toContain("rolling bubbles");
  expect(buildAnswerIntentHint("interview_project")).not.toContain("rolling bubbles");
  expect(buildAnswerIntentHint("classroom_answer")).not.toContain("platform scale");
});

test("OpenAI conversation input can carry answer intent as compact dynamic metadata", () => {
  expect(buildOpenAiConversationInput("How do you measure an elephant?", {
    outputLanguage: "English",
    promptMode: "general",
    answerIntent: "ordinary_practical",
  })).toBe([
    "Language: English",
    "Mode: general",
    "Intent: ordinary_practical",
    "Transcript: How do you measure an elephant?",
  ].join("\n"));
});
