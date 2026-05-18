import { detectSuggestionEcho } from "../src/server/mastra/agents/response-handler";

type EchoCase = {
  category: string;
  name: string;
  suggestion: string;
  transcript: string;
  expected: boolean;
};

const dailySuggestion = "Good morning! I just have class later, so probably a bit of studying and then maybe some games to relax.";
const projectSuggestion = "I built SayNext as a mobile real-time conversation assistant. It listens to transcripts, retrieves relevant memory, and gives short replies that I can say naturally.";
const cloudSuggestion = "For Lambda cold starts, I would first check package size, initialization code, and whether provisioned concurrency makes sense for the traffic pattern.";
const meetingSuggestion = "I can take the API contract first, mock the missing fields, and then update the frontend once the backend schema is confirmed.";

const cases: EchoCase[] = [
  // Incomplete reread + Xiang continues with his own wording.
  {
    category: "partial-read-plus-own-thought",
    name: "daily partial then extra plan",
    suggestion: dailySuggestion,
    transcript: "I just have class later, probably study a bit, and then I might go to the library if I still have energy",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "project partial then extra detail",
    suggestion: projectSuggestion,
    transcript: "I built SayNext as a mobile real-time conversation assistant, and honestly the hard part was making it not sound robotic",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "cloud partial then own example",
    suggestion: cloudSuggestion,
    transcript: "For Lambda cold starts I would check package size and initialization code, and maybe compare it with a warm start log",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "meeting partial then personal ownership",
    suggestion: meetingSuggestion,
    transcript: "I can take the API contract first and mock the missing fields, then I can unblock my part today",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "only tail plus own wording",
    suggestion: dailySuggestion,
    transcript: "a bit of studying and maybe some games later, probably nothing too crazy",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "project partial then phone clarification",
    suggestion: projectSuggestion,
    transcript: "I built SayNext as a mobile real time assistant, basically a phone app, not really a smart glasses app itself",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "cloud partial then vpc detail",
    suggestion: cloudSuggestion,
    transcript: "I would first check package size and initialization code, and if it is in a VPC I would check that too",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "meeting partial then assumptions",
    suggestion: meetingSuggestion,
    transcript: "I can mock the missing fields and document my assumptions so the team is not blocked",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "daily beginning then different ending",
    suggestion: dailySuggestion,
    transcript: "Good morning I just have class later, and after that I will probably just stay home",
    expected: true,
  },
  {
    category: "partial-read-plus-own-thought",
    name: "project middle then extra process",
    suggestion: projectSuggestion,
    transcript: "it retrieves relevant memory and gives short replies naturally, and I tested a lot of awkward conversation cases",
    expected: true,
  },

  // Broken / stuttered / interrupted reread.
  {
    category: "broken-reread",
    name: "daily broken chunks",
    suggestion: dailySuggestion,
    transcript: "Good morning I just, I just have class later, so probably a bit, a bit of studying",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "project broken chunks",
    suggestion: projectSuggestion,
    transcript: "I built SayNext as a mobile, mobile real time conversation assistant, it listens to transcript and retrieves memory",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "cloud broken chunks",
    suggestion: cloudSuggestion,
    transcript: "Lambda cold starts, I would first check package size, initialization, uh initialization code",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "meeting broken chunks",
    suggestion: meetingSuggestion,
    transcript: "I can take the API contract first, mock the missing fields, and then update, update the frontend",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "asr clipped beginning",
    suggestion: projectSuggestion,
    transcript: "real time conversation assistant it listens to transcripts retrieves relevant memory and gives short replies",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "daily repeated fragments",
    suggestion: dailySuggestion,
    transcript: "class later class later probably studying studying and then maybe games",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "project missing grammar",
    suggestion: projectSuggestion,
    transcript: "SayNext mobile real time assistant listen transcript retrieve memory give short reply natural",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "cloud clipped technical",
    suggestion: cloudSuggestion,
    transcript: "cold starts check package size init code provisioned concurrency traffic pattern",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "meeting no function words",
    suggestion: meetingSuggestion,
    transcript: "take API contract mock missing fields update frontend backend schema confirmed",
    expected: true,
  },
  {
    category: "broken-reread",
    name: "daily starts late and repeats",
    suggestion: dailySuggestion,
    transcript: "probably a bit a bit of studying then maybe maybe some games to relax",
    expected: true,
  },

  // Heavy filler / natural spoken hesitation while reading.
  {
    category: "filler-heavy-reread",
    name: "daily many fillers",
    suggestion: dailySuggestion,
    transcript: "yeah honestly I just have like class later so probably kind of a bit of studying and then maybe some games to relax",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "project many fillers",
    suggestion: projectSuggestion,
    transcript: "so basically I built SayNext as like a mobile real time conversation assistant and it kind of retrieves relevant memory",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "cloud many fillers",
    suggestion: cloudSuggestion,
    transcript: "I mean for Lambda cold starts I would probably first check package size and like initialization code",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "meeting many fillers",
    suggestion: meetingSuggestion,
    transcript: "yeah I can maybe take the API contract first and mock the missing fields for now",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "double filler and repetition",
    suggestion: dailySuggestion,
    transcript: "um yeah I just have class later, like class later, so probably a bit of studying",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "project casual filler",
    suggestion: projectSuggestion,
    transcript: "honestly yeah I built SayNext as kind of a mobile real time conversation assistant, like it listens to transcripts",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "cloud hesitation",
    suggestion: cloudSuggestion,
    transcript: "uh for Lambda cold starts I would like first check package size, maybe initialization code, you know",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "meeting hesitant ownership",
    suggestion: meetingSuggestion,
    transcript: "I guess I can take the API contract first and like mock the missing fields for now",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "daily filler before tail",
    suggestion: dailySuggestion,
    transcript: "yeah so probably a bit of studying and then honestly maybe some games to relax",
    expected: true,
  },
  {
    category: "filler-heavy-reread",
    name: "project filler and asr singular",
    suggestion: projectSuggestion,
    transcript: "so it listen to transcript and retrieve relevant memory and gives like short reply I can say naturally",
    expected: true,
  },

  // Reading starts, then the other person interrupts with a real question.
  // These should not be swallowed; the new question should drive SayNext.
  {
    category: "reread-then-question",
    name: "daily read then followup question",
    suggestion: dailySuggestion,
    transcript: "I just have class later so probably a bit of studying. What class do you have?",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "project read then ask tech stack",
    suggestion: projectSuggestion,
    transcript: "I built SayNext as a mobile real time conversation assistant. What tech stack did you use?",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "cloud read then challenge",
    suggestion: cloudSuggestion,
    transcript: "For Lambda cold starts I would check package size. But why not just use containers?",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "meeting read then blocker question",
    suggestion: meetingSuggestion,
    transcript: "I can take the API contract first. Can you finish it before Friday?",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "interrupt marker",
    suggestion: projectSuggestion,
    transcript: "I built SayNext as a mobile real time conversation assistant. Wait, before you continue, is this for glasses or phone?",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "no punctuation tech stack question",
    suggestion: projectSuggestion,
    transcript: "I built SayNext as a mobile real time conversation assistant what tech stack did you use",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "no punctuation class question",
    suggestion: dailySuggestion,
    transcript: "I just have class later so probably a bit of studying what class is it",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "no punctuation why challenge",
    suggestion: cloudSuggestion,
    transcript: "I would first check package size and initialization code why not just use containers",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "no punctuation can you question",
    suggestion: meetingSuggestion,
    transcript: "I can take the API contract first can you finish it before Friday",
    expected: false,
  },
  {
    category: "reread-then-question",
    name: "read then switch topic",
    suggestion: dailySuggestion,
    transcript: "probably a bit of studying and then maybe some games anyway different topic what are you doing tomorrow",
    expected: false,
  },

  // Negative controls: overlapping topic, but not a self-read.
  {
    category: "negative-controls",
    name: "daily natural response",
    suggestion: dailySuggestion,
    transcript: "Sounds chill. Are you mostly taking it easy today?",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "project real followup",
    suggestion: projectSuggestion,
    transcript: "That sounds useful, but how do you prevent it from giving awkward replies?",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "cloud concept question",
    suggestion: cloudSuggestion,
    transcript: "How does provisioned concurrency actually reduce cold start latency?",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "meeting answer from teammate",
    suggestion: meetingSuggestion,
    transcript: "I already have the schema ready, I can send it after this call.",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "short backchannel",
    suggestion: dailySuggestion,
    transcript: "yeah",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "teammate mentions api contract",
    suggestion: meetingSuggestion,
    transcript: "The API contract is ready now, I added the missing fields this morning.",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "classmate mentions lambda",
    suggestion: cloudSuggestion,
    transcript: "Our Lambda function is slow because the database query is taking too long.",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "friend talks about games",
    suggestion: dailySuggestion,
    transcript: "I played games all night and now I am kind of tired.",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "interviewer asks project without question mark",
    suggestion: projectSuggestion,
    transcript: "Tell me more about how the memory retrieval works",
    expected: false,
  },
  {
    category: "negative-controls",
    name: "professor asks explain without question mark",
    suggestion: cloudSuggestion,
    transcript: "Explain how provisioned concurrency changes the scaling behavior",
    expected: false,
  },
];

const byCategory = new Map<string, { total: number; failed: number }>();
let failed = 0;

for (const testCase of cases) {
  const result = detectSuggestionEcho(testCase.transcript, [testCase.suggestion]);
  const passed = result.matched === testCase.expected;
  const stats = byCategory.get(testCase.category) || { total: 0, failed: 0 };
  stats.total += 1;
  if (!passed) {
    stats.failed += 1;
    failed += 1;
  }
  byCategory.set(testCase.category, stats);

  console.log([
    passed ? "PASS" : "FAIL",
    testCase.category,
    testCase.name,
    `expected=${testCase.expected}`,
    `actual=${result.matched}`,
    `similarity=${result.similarity.toFixed(2)}`,
    `transcriptCoverage=${result.transcriptCoverage.toFixed(2)}`,
    `suggestionCoverage=${result.suggestionCoverage.toFixed(2)}`,
  ].join(" | "));
}

console.log("\nSummary");
for (const [category, stats] of byCategory) {
  console.log(`${category}: ${stats.total - stats.failed}/${stats.total} passed`);
}

if (failed > 0) {
  console.error(`\n${failed} suggestion echo tests failed.`);
  process.exit(1);
}
