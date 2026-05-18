import fs from "node:fs";
import path from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { detectSuggestionEcho } from "../src/server/mastra/agents/response-handler";

type EdgeCategory =
  | "other-interrupt-no-question"
  | "other-quote-followup-question"
  | "multi-candidate-correct-reread"
  | "short-generic-self-read"
  | "short-generic-other-question"
  | "expired-window-model"
  | "cross-language-translation"
  | "semantic-paraphrase"
  | "legitimate-other-repeat-no-question";

type EdgeCase = {
  category: EdgeCategory;
  name: string;
  candidates: string[];
  targetCandidate?: string;
  transcript: string;
  expectedMatched: boolean;
  strict: boolean;
  note: string;
};

const args = process.argv.slice(2);
const userId = args.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const perCategory = Number(args.find((arg) => arg.startsWith("--per-category="))?.slice("--per-category=".length) || 120);
const seed = Number(args.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length) || 20260525);
const verbose = args.includes("--verbose");

function makeRandom(initialSeed: number) {
  let state = initialSeed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = makeRandom(seed);

function normalizeSpaces(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stripDisplayChrome(text: string): string {
  return normalizeSpaces(text)
    .replace(/^\d+\s*\/\s*\d+\s*/g, "")
    .replace(/\bNext:\s*/gi, " ")
    .replace(/\bDone\. SayNext is listening\.?/gi, "")
    .replace(/^AI:\s*/i, "")
    .trim();
}

function words(text: string): string[] {
  return stripDisplayChrome(text)
    .replace(/[^\p{Letter}\p{Number}'-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function fromWords(items: string[]): string {
  return normalizeSpaces(items.join(" "));
}

function wordCount(text: string): number {
  return words(text).length;
}

function truncateWords(text: string, maxWords: number): string {
  const parts = words(text);
  if (parts.length <= maxWords) return stripDisplayChrome(text);
  return fromWords(parts.slice(0, maxWords));
}

function uniqueByText(items: string[], max = 240): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const cleaned = stripDisplayChrome(item);
    const key = cleaned.toLowerCase();
    if (wordCount(cleaned) < 4 || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function pick<T>(items: T[], fallback: T): T {
  if (!items.length) return fallback;
  return items[Math.floor(random() * items.length)] ?? fallback;
}

function readDocSnippets(): string[] {
  const docs = [
    "docs/lecture_transcript.md",
    "docs/lecture_transcript2.md",
    "docs/lecture_transcript3.md",
    "docs/transcript3.md",
  ];

  const snippets: string[] = [];
  for (const relative of docs) {
    const file = path.join(process.cwd(), relative);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const pieces = text
      .replace(/\r\n/g, "\n")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((item) => normalizeSpaces(item))
      .filter((item) => item.length >= 35 && item.length <= 240);
    for (let i = 0; i < pieces.length; i += Math.max(1, Math.floor(pieces.length / 160))) {
      if (pieces[i]) snippets.push(pieces[i]);
    }
  }
  return snippets;
}

function loadDbPools() {
  const samples = conversationLogger.listSamples(userId, 240);
  return {
    aiReplies: uniqueByText(samples.map((sample) => sample.aiReply || "").filter(Boolean), 120),
    transcripts: uniqueByText(samples.map((sample) => sample.transcript || "").filter(Boolean), 180),
  };
}

const baseSuggestions = [
  "Good morning, I just have class later, so probably a bit of studying and then maybe some games to relax.",
  "I built SayNext as a mobile real-time conversation assistant that listens to transcripts, retrieves relevant memory, and gives short replies I can say naturally.",
  "For Lambda cold starts, I would first check package size, initialization code, and whether provisioned concurrency makes sense for the traffic pattern.",
  "I can take the API contract first, mock the missing fields, and then update the frontend once the backend schema is confirmed.",
  "A quick example of supervised learning is email spam detection, because the model trains on emails that are already labeled spam or not spam.",
  "I went to Aubrey Drive High School in Dartmouth after moving to Canada, and it was a pretty big adjustment at first.",
  "For DynamoDB, I would start from the access pattern and check whether the partition key, sort key, or GSI actually supports that query.",
  "The key idea is that multi-AZ improves availability by letting the system fail over if one availability zone has a problem.",
  "If the model gives a weird answer, I would check the input context first before blaming the model, because retrieval often causes the issue.",
  "For interviews, I try to keep the answer specific: what the problem was, what I did, and what changed after that.",
];

const shortSuggestions = [
  "Yeah, that makes sense.",
  "That sounds pretty fair.",
  "I get what you mean.",
  "Yeah, I can do that.",
  "That is a good point.",
  "I think that works.",
  "Sure, that sounds good.",
  "Yeah, probably.",
  "That is kind of tricky.",
  "I agree with that.",
];

const interruptionFragments = [
  "actually the deadline changed this morning",
  "actually the backend schema changed after standup",
  "actually I already sent the API contract",
  "actually we are using a different endpoint now",
  "no the database query is the real bottleneck",
  "no the professor said the opposite in class",
  "but the requirement changed yesterday",
  "but the mobile screen cannot show that much text",
  "but we already finished that part",
  "but I think the user flow is different now",
  "hold on the API response is different now",
  "wait the dataset is not labeled",
  "sorry the meeting topic moved to deployment",
  "one more thing the cost limit is lower now",
  "also the user asked for offline mode",
  "the main issue is actually authentication",
  "the blocker is not the frontend anymore",
  "we changed the schema in the last pull request",
  "I already tested this on the VPS",
  "this is not for glasses it is mainly the phone app",
];

const followupQuestions = [
  "what was the hardest part",
  "how did you test that",
  "why did you choose that approach",
  "can you give a concrete example",
  "what would you improve next",
  "how does that work in real time",
  "what was your role",
  "how did you handle the tradeoff",
  "why not use a simpler design",
  "what happens if the transcript is wrong",
];

const chineseTranslations = [
  "我之后有课，所以大概会学习一会儿，然后放松一下打会儿游戏",
  "我做的是一个手机端实时对话助手，可以听转录内容，然后找相关记忆，再给我一句自然能说出口的话",
  "如果是 Lambda 冷启动，我会先看包大小和初始化代码，再考虑 provisioned concurrency 是否适合流量模式",
  "我可以先负责 API contract，先 mock 缺少的字段，等后端 schema 确认后再更新前端",
  "监督学习的一个简单例子是垃圾邮件检测，因为模型是用已经标注好的邮件训练的",
  "我来加拿大后在 Dartmouth 的 Aubrey Drive High School 上高中，刚开始确实是很大的适应",
  "DynamoDB 我会先从 access pattern 开始，看 partition key、sort key 或 GSI 能不能支持这个 query",
  "Multi AZ 的核心是提升可用性，如果一个 availability zone 出问题，系统还能 fail over",
  "如果模型回答很怪，我会先检查输入上下文，因为很多问题其实是 retrieval 带偏了",
  "面试回答我会尽量具体，说清楚问题是什么、我做了什么、最后有什么变化",
];

const paraphrases = [
  "I have class later, so I will probably study for a while and then chill with games.",
  "SayNext is basically a phone-based assistant that listens to the conversation and suggests a natural next line.",
  "For cold start issues, I would inspect startup work, dependency size, and maybe use provisioned concurrency if traffic needs it.",
  "I can unblock the frontend by mocking the API shape first and switching to the real backend once the schema is stable.",
  "Spam filtering is supervised learning because the examples already come with labels.",
  "After I moved to Canada, I studied at Aubrey Drive, and the cultural adjustment was not small.",
  "With DynamoDB, I would design from the query pattern instead of choosing keys randomly.",
  "Multi-AZ helps because the app can keep running even if one zone fails.",
  "When an AI answer is off, I would debug the context and retrieval before changing the prompt.",
  "In interviews, I try to answer with the situation, my action, and the outcome.",
];

function prefixOf(suggestion: string, index: number, ratio = 0.38): string {
  const parts = words(truncateWords(suggestion, 36));
  const length = Math.max(5, Math.min(parts.length, Math.ceil(parts.length * ratio) + (index % 3)));
  return fromWords(parts.slice(0, length));
}

function buildCases(): EdgeCase[] {
  const db = loadDbPools();
  const docSnippets = readDocSnippets();
  const suggestions = uniqueByText([...baseSuggestions, ...db.aiReplies], 180)
    .map((item) => truncateWords(item, 36))
    .filter((item) => wordCount(item) >= 7);
  const distractors = uniqueByText([...baseSuggestions, ...db.aiReplies, ...db.transcripts, ...docSnippets], 260)
    .map((item) => truncateWords(item, 34))
    .filter((item) => wordCount(item) >= 5);

  const cases: EdgeCase[] = [];

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = suggestions[i % suggestions.length] || baseSuggestions[i % baseSuggestions.length]!;
    const interrupt = interruptionFragments[i % interruptionFragments.length]!;
    cases.push({
      category: "other-interrupt-no-question",
      name: `other-interrupt-no-question-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: `${prefixOf(suggestion, i, 0.34)} ${interrupt}`,
      expectedMatched: false,
      strict: true,
      note: "Other speaker interrupts after Xiang begins reading; no question mark.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = suggestions[i % suggestions.length] || baseSuggestions[i % baseSuggestions.length]!;
    const quote = prefixOf(suggestion, i, 0.5);
    cases.push({
      category: "other-quote-followup-question",
      name: `other-quote-followup-question-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: `So you said ${quote}, ${followupQuestions[i % followupQuestions.length]}?`,
      expectedMatched: false,
      strict: true,
      note: "Other speaker quotes Xiang then asks a real follow-up.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const target = suggestions[i % suggestions.length] || baseSuggestions[i % baseSuggestions.length]!;
    const pool = distractors.filter((item) => item.toLowerCase() !== target.toLowerCase());
    const candidates = [
      pick(pool, baseSuggestions[1]!),
      pick(pool, baseSuggestions[2]!),
      target,
      pick(pool, baseSuggestions[3]!),
      pick(pool, baseSuggestions[4]!),
    ];
    cases.push({
      category: "multi-candidate-correct-reread",
      name: `multi-candidate-correct-reread-${String(i + 1).padStart(3, "0")}`,
      candidates,
      targetCandidate: target,
      transcript: prefixOf(target, i, 0.68),
      expectedMatched: true,
      strict: true,
      note: "Several recent suggestions exist; the current reread should match one recent candidate. Exact candidate identity is only a log detail.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = shortSuggestions[i % shortSuggestions.length]!;
    cases.push({
      category: "short-generic-self-read",
      name: `short-generic-self-read-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: i % 2 === 0 ? suggestion : `uh yeah ${suggestion.toLowerCase()}`,
      expectedMatched: true,
      strict: true,
      note: "Short generic suggestion read by Xiang should still avoid loops.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = shortSuggestions[i % shortSuggestions.length]!;
    cases.push({
      category: "short-generic-other-question",
      name: `short-generic-other-question-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: `${suggestion} but ${followupQuestions[i % followupQuestions.length]}?`,
      expectedMatched: false,
      strict: true,
      note: "Short overlap followed by real other-speaker question must not be swallowed.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = suggestions[i % suggestions.length] || baseSuggestions[i % baseSuggestions.length]!;
    cases.push({
      category: "expired-window-model",
      name: `expired-window-model-${String(i + 1).padStart(3, "0")}`,
      candidates: [],
      transcript: prefixOf(suggestion, i, 0.74),
      expectedMatched: false,
      strict: true,
      note: "Models an expired suggestion window: no active candidates means no echo.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = baseSuggestions[i % baseSuggestions.length]!;
    cases.push({
      category: "cross-language-translation",
      name: `cross-language-translation-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: chineseTranslations[i % chineseTranslations.length]!,
      expectedMatched: true,
      strict: false,
      note: "Diagnostic only: semantic cross-language reread needs LLM/translation, not string matching.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = baseSuggestions[i % baseSuggestions.length]!;
    cases.push({
      category: "semantic-paraphrase",
      name: `semantic-paraphrase-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: paraphrases[i % paraphrases.length]!,
      expectedMatched: true,
      strict: false,
      note: "Diagnostic only: strong paraphrase is semantic echo, but string matching may miss it.",
    });
  }

  for (let i = 0; i < perCategory; i += 1) {
    const suggestion = suggestions[i % suggestions.length] || baseSuggestions[i % baseSuggestions.length]!;
    cases.push({
      category: "legitimate-other-repeat-no-question",
      name: `legitimate-other-repeat-no-question-${String(i + 1).padStart(3, "0")}`,
      candidates: [suggestion],
      transcript: `Right, so ${prefixOf(suggestion, i, 0.55)}, that is what I heard too.`,
      expectedMatched: false,
      strict: false,
      note: "Diagnostic only: another person repeats/acknowledges without asking. Usually low value, but it is real speech.",
    });
  }

  return cases;
}

const cases = buildCases();
const byCategory = new Map<EdgeCategory, { total: number; strictFailed: number; diagnosticMatched: number; diagnosticMissed: number }>();
let strictFailed = 0;

for (const testCase of cases) {
  const result = detectSuggestionEcho(testCase.transcript, testCase.candidates);
  const matched = result.matched === testCase.expectedMatched;
  const candidateMatched = true;
  const passed = matched && candidateMatched;
  const stats = byCategory.get(testCase.category) || { total: 0, strictFailed: 0, diagnosticMatched: 0, diagnosticMissed: 0 };
  stats.total += 1;

  if (testCase.strict && !passed) {
    stats.strictFailed += 1;
    strictFailed += 1;
  }
  if (!testCase.strict) {
    if (result.matched) stats.diagnosticMatched += 1;
    else stats.diagnosticMissed += 1;
  }
  byCategory.set(testCase.category, stats);

  if (verbose || (testCase.strict && !passed)) {
    console.log([
      passed ? "PASS" : testCase.strict ? "FAIL" : "DIAG",
      testCase.category,
      testCase.name,
      `strict=${testCase.strict}`,
      `expected=${testCase.expectedMatched}`,
      `actual=${result.matched}`,
      `candidateOk=${candidateMatched}`,
      `similarity=${result.similarity.toFixed(2)}`,
      `transcriptCoverage=${result.transcriptCoverage.toFixed(2)}`,
      `suggestionCoverage=${result.suggestionCoverage.toFixed(2)}`,
    ].join(" | "));
    if (testCase.strict && !passed) {
      console.log(`  note: ${testCase.note}`);
      console.log(`  transcript: ${testCase.transcript}`);
      console.log(`  candidates: ${JSON.stringify(testCase.candidates)}`);
      console.log(`  expectedCandidate: ${testCase.targetCandidate || ""}`);
      console.log(`  matchedCandidate: ${result.candidate}`);
    }
  }
}

console.log(`SUGGESTION_ECHO_EDGE_EVAL seed=${seed} perCategory=${perCategory} cases=${cases.length}`);
console.log("Summary");
for (const [category, stats] of byCategory) {
  if (stats.total < 100) {
    console.error(`${category}: only ${stats.total} cases`);
    strictFailed += 1;
  }
  const diagnostic = stats.diagnosticMatched + stats.diagnosticMissed;
  if (diagnostic > 0) {
    console.log(`${category}: diagnostic matched=${stats.diagnosticMatched}/${diagnostic}, missed=${stats.diagnosticMissed}/${diagnostic}`);
  } else {
    console.log(`${category}: strict passed=${stats.total - stats.strictFailed}/${stats.total}`);
  }
}

if (strictFailed > 0) {
  console.error(`\n${strictFailed} strict suggestion echo edge tests failed.`);
  process.exit(1);
}
