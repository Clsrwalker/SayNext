import fs from "node:fs";
import path from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { detectSuggestionEcho } from "../src/server/mastra/agents/response-handler";

type EchoCategory =
  | "partial-read-plus-own-thought"
  | "broken-reread"
  | "filler-heavy-reread"
  | "misread-words"
  | "asr-wrong-words"
  | "omitted-words"
  | "grammar-error-reread"
  | "reordered-reread"
  | "mixed-realistic-noise"
  | "reread-then-question"
  | "negative-controls";

type EchoCase = {
  category: EchoCategory;
  name: string;
  suggestion: string;
  transcript: string;
  expected: boolean;
  source: string;
};

const args = process.argv.slice(2);
const userId = args.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const perCategory = Number(args.find((arg) => arg.startsWith("--per-category="))?.slice("--per-category=".length) || 120);
const seed = Number(args.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length) || 20260517);
const verbose = args.includes("--verbose");

const repoRoot = process.cwd();

function makeRandom(initialSeed: number) {
  let state = initialSeed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = makeRandom(seed);

function pick<T>(items: T[], fallback: T): T {
  if (!items.length) return fallback;
  return items[Math.floor(random() * items.length)] ?? fallback;
}

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncateWords(text: string, maxWords: number): string {
  const parts = words(text);
  if (parts.length <= maxWords) return stripDisplayChrome(text);
  return fromWords(parts.slice(0, maxWords));
}

function wordCount(text: string): number {
  return words(text).length;
}

function uniqueByText(items: string[], max = 240): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const cleaned = stripDisplayChrome(item);
    const key = cleaned.toLowerCase();
    if (wordCount(cleaned) < 5 || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function isQuestionLikeSuggestion(text: string): boolean {
  const normalized = stripDisplayChrome(text).toLowerCase();
  return /^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|tell me|describe|explain)\b/.test(normalized)
    || /\b(could you|can you|do you want me to|please clarify|what do you mean|could you clarify|repeat|remind me|which .* mean)\b/.test(normalized);
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
    const file = path.join(repoRoot, relative);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const pieces = text
      .replace(/\r\n/g, "\n")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((item) => normalizeSpaces(item))
      .filter((item) => item.length >= 35 && item.length <= 220);
    for (let i = 0; i < pieces.length; i += Math.max(1, Math.floor(pieces.length / 120))) {
      if (pieces[i]) snippets.push(pieces[i]);
    }
  }
  return snippets;
}

function loadDbPools() {
  const samples = conversationLogger.listSamples(userId, 200);
  return {
    aiReplies: uniqueByText(samples.map((sample) => sample.aiReply || "").filter(Boolean), 120),
    transcripts: uniqueByText(samples.map((sample) => sample.transcript || "").filter(Boolean), 160),
  };
}

const baseSuggestions = [
  "Good morning! I just have class later, so probably a bit of studying and then maybe some games to relax.",
  "I built SayNext as a mobile real-time conversation assistant. It listens to transcripts, retrieves relevant memory, and gives short replies that I can say naturally.",
  "For Lambda cold starts, I would first check package size, initialization code, and whether provisioned concurrency makes sense for the traffic pattern.",
  "I can take the API contract first, mock the missing fields, and then update the frontend once the backend schema is confirmed.",
  "A quick example of supervised learning is email spam detection, because the model trains on emails that are already labeled spam or not spam.",
  "I went to Aubrey Drive High School in Dartmouth after moving to Canada, and it was a pretty big adjustment at first.",
  "For DynamoDB, I would start from the access pattern and check whether the partition key, sort key, or GSI actually supports that query.",
  "I prefer indoors most of the time, but sometimes I like walking around a park alone when I need a quiet reset.",
  "I would keep the first version simple: define the schema, mock the API response, then connect the real endpoint when it is ready.",
  "The main tradeoff is that caching improves latency, but it also introduces invalidation problems when the underlying data changes.",
  "For a project bug, I usually reproduce it first, check the logs, narrow the failing layer, and then test the smallest fix.",
  "I am interested in AI software because it feels practical; you can build something that directly helps people communicate or work faster.",
  "In a meeting, I would ask for the exact acceptance criteria first, because otherwise we might all implement slightly different versions.",
  "The key idea is that multi-AZ improves availability by letting the system fail over if one availability zone has a problem.",
  "I usually learn better by building something and testing it, instead of just memorizing the theory from slides.",
  "For the UI, I would rather keep the flow simple and reduce the number of choices the user has to think about.",
  "If the model gives a weird answer, I would check the input context first before blaming the model, because retrieval often causes the issue.",
  "Honestly, I am pretty low energy, so after class I usually just study a bit, watch something, or play games.",
  "One limitation is that this design depends heavily on transcript quality, so noisy ASR can easily push the system in the wrong direction.",
  "For interviews, I try to keep the answer specific: what the problem was, what I did, and what changed after that.",
];

const ownThoughtContinuations = [
  "and then I would probably explain it in a more casual way.",
  "and honestly that is the part I would want to improve next.",
  "so I would probably use that as the main example.",
  "and I can add a small detail if they ask follow up.",
  "which is why I think the process matters more than just the final answer.",
  "and that is basically how I would say it out loud.",
  "but I would keep it short because too much detail sounds weird.",
  "and I would connect it back to the actual situation.",
  "so it does not sound like I memorized a script.",
  "and if they want more detail I can go deeper after that.",
  "then I can mention the concrete tradeoff instead of overexplaining.",
  "and I would probably pause there instead of adding random extra stuff.",
];

const fillerPhrases = [
  "yeah",
  "uh",
  "um",
  "like",
  "you know",
  "I mean",
  "honestly",
  "basically",
  "kind of",
  "sort of",
  "actually",
  "probably",
];

const questionSuffixes = [
  "what class is it",
  "what tech stack did you use",
  "why not just use containers",
  "can you finish it before Friday",
  "how did you test that",
  "what was the hardest part",
  "is that for a phone app or glasses",
  "can you explain that simpler",
  "what do you mean by memory retrieval",
  "how does that work in real time",
  "why did you choose DynamoDB",
  "what happens if the transcript is wrong",
  "can you give me a concrete example",
  "how would you debug that",
  "what is the tradeoff here",
  "did you build that by yourself",
  "how long did it take",
  "what would you improve next",
  "does that work offline",
  "can you repeat the last part",
];

const manualNegativeControls = [
  "Sounds chill. Are you mostly taking it easy today?",
  "That sounds useful, but how do you prevent it from giving awkward replies?",
  "How does provisioned concurrency actually reduce cold start latency?",
  "I already have the schema ready, I can send it after this call.",
  "The API contract is ready now, I added the missing fields this morning.",
  "Our Lambda function is slow because the database query is taking too long.",
  "I played games all night and now I am kind of tired.",
  "Tell me more about how the memory retrieval works.",
  "Explain how provisioned concurrency changes the scaling behavior.",
  "The professor said we should compare supervised and unsupervised learning.",
  "I think the frontend state is not updating because the dependency array is wrong.",
  "Can you talk about your internship preparation plan?",
  "The meeting is mostly about deadlines and who owns each task.",
  "The transcript keeps changing before finalizing, so we should wait for final output.",
  "There is an echo in the online meeting and the microphone may be picking up the speaker.",
  "What game have you been playing recently?",
  "Could you describe your favorite room?",
  "Why did you choose computer science?",
  "What is the difference between horizontal and vertical scaling?",
  "Let's move to the next topic.",
];

const testStopWords = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "so",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "that",
  "this",
  "it",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  "they",
  "their",
]);

const asrSubstitutions: Record<string, string[]> = {
  "api": ["a p i", "AP I"],
  "assistant": ["assistance"],
  "availability": ["ability"],
  "backend": ["back end"],
  "caching": ["catching"],
  "cold": ["code"],
  "concurrency": ["currency", "con current see"],
  "conversation": ["conservation"],
  "dynamodb": ["dynamo db", "dino db"],
  "frontend": ["front end"],
  "gsi": ["g s i"],
  "lambda": ["lamda", "landa"],
  "latency": ["late see", "latencey"],
  "memory": ["memories"],
  "multi-az": ["multi a z", "multi AZ"],
  "partition": ["position"],
  "provisioned": ["provision", "revision"],
  "relevant": ["relative"],
  "retrieval": ["retrieve all", "retriever"],
  "retrieves": ["retrieve", "reviews"],
  "schema": ["scheme", "ski ma"],
  "saynext": ["say next", "say net", "say necks"],
  "serverless": ["server less"],
  "supervised": ["super visor"],
  "transcript": ["trans craft"],
  "transcripts": ["transcript", "trans crafts"],
};

function cleanTokenKey(token: string): string {
  return token.toLowerCase().replace(/[^\p{Letter}\p{Number}-]+/gu, "");
}

function contentWords(text: string): string[] {
  return words(text).filter((token) => !testStopWords.has(cleanTokenKey(token)) && cleanTokenKey(token).length > 2);
}

function typoToken(token: string, index: number): string {
  const key = cleanTokenKey(token);
  if (key.length < 6) return token;
  if (index % 4 === 0) return key.replace(/[aeiou]/, "");
  if (index % 4 === 1) return `${key.slice(0, -1)}${key.at(-1)}`;
  if (index % 4 === 2) return key.replace(/tion$/, "shin").replace(/ing$/, "in");
  return key.replace(/r/g, "l").replace(/v/g, "b");
}

function substituteToken(token: string, index: number): string {
  const key = cleanTokenKey(token);
  const options = asrSubstitutions[key];
  if (options?.length) return options[index % options.length]!;
  return typoToken(token, index);
}

function fragmentWords(suggestion: string, index: number, ratio = 0.72): string[] {
  const parts = words(truncateWords(suggestion, 38));
  const length = clamp(Math.ceil(parts.length * ratio), 9, Math.min(28, parts.length));
  const maxOffset = Math.max(0, parts.length - length);
  const offset = maxOffset === 0 ? 0 : (index * 7) % (maxOffset + 1);
  return parts.slice(offset, offset + length);
}

function partialReadPlusOwnThought(suggestion: string, index: number): string {
  const parts = words(truncateWords(suggestion, 36));
  const length = clamp(Math.ceil(parts.length * (0.42 + (index % 4) * 0.06)), 7, Math.min(20, parts.length));
  const maxOffset = Math.max(0, parts.length - length);
  const offset = maxOffset === 0 ? 0 : (index * 3) % (maxOffset + 1);
  const fragment = fromWords(parts.slice(offset, offset + length));
  return `${fragment}, ${ownThoughtContinuations[index % ownThoughtContinuations.length]}`;
}

function brokenReread(suggestion: string, index: number): string {
  const parts = words(truncateWords(suggestion, 34));
  const length = clamp(Math.ceil(parts.length * 0.62), 7, Math.min(22, parts.length));
  const maxOffset = Math.max(0, parts.length - length);
  const offset = maxOffset === 0 ? 0 : (index * 5) % (maxOffset + 1);
  const fragment = parts.slice(offset, offset + length);
  const out: string[] = [];
  for (let i = 0; i < fragment.length; i += 1) {
    const token = fragment[i]!;
    if ((i + index) % 7 === 0) out.push(token);
    if ((i + index) % 5 === 0) out.push(token);
    out.push(token);
  }
  if (index % 3 === 0) {
    return out.filter((token) => !/^(the|a|an|is|are|was|were|to|and|or|but|that|this|it)$/i.test(token)).join(" ");
  }
  return out.join(" ");
}

function fillerHeavyReread(suggestion: string, index: number): string {
  const parts = words(truncateWords(suggestion, 34));
  const length = clamp(Math.ceil(parts.length * 0.72), 9, Math.min(26, parts.length));
  const fragment = parts.slice(0, length);
  const out: string[] = [];
  for (let i = 0; i < fragment.length; i += 1) {
    if ((i + index) % 4 === 0) out.push(fillerPhrases[(i + index) % fillerPhrases.length]!);
    out.push(fragment[i]!);
    if ((i + index) % 9 === 0) out.push(fragment[i]!);
  }
  return out.join(" ");
}

function misreadWords(suggestion: string, index: number): string {
  const fragment = fragmentWords(suggestion, index, 0.72);
  const out = fragment.map((token, i) => {
    if ((i + index) % 5 === 0) return substituteToken(token, i + index);
    return token;
  });
  if (index % 4 === 0) out.splice(2, 0, fillerPhrases[index % fillerPhrases.length]!);
  return out.join(" ");
}

function asrWrongWords(suggestion: string, index: number): string {
  const fragment = fragmentWords(suggestion, index, 0.78);
  const out: string[] = [];
  for (let i = 0; i < fragment.length; i += 1) {
    const token = fragment[i]!;
    const key = cleanTokenKey(token);
    if ((i + index) % 9 === 0 && testStopWords.has(key)) continue;
    if ((i + index) % 4 === 0) {
      out.push(substituteToken(token, i + index));
      continue;
    }
    out.push(token);
  }
  return out.join(" ");
}

function omittedWords(suggestion: string, index: number): string {
  const fragment = fragmentWords(suggestion, index, 0.82);
  const out = fragment.filter((token, i) => {
    const key = cleanTokenKey(token);
    if (testStopWords.has(key) && (i + index) % 2 === 0) return false;
    if (!testStopWords.has(key) && (i + index) % 7 === 0) return false;
    return true;
  });
  return out.join(" ");
}

function grammarErrorReread(suggestion: string, index: number): string {
  let text = fromWords(fragmentWords(suggestion, index, 0.8));
  const replacements: Array<[RegExp, string]> = [
    [/\bI built\b/gi, "I build"],
    [/\bit listens\b/gi, "it listen"],
    [/\bretrieves\b/gi, "retrieve"],
    [/\bgives\b/gi, "give"],
    [/\btrains\b/gi, "train"],
    [/\bdepends\b/gi, "depend"],
    [/\bimproves\b/gi, "improve"],
    [/\bchanges\b/gi, "change"],
    [/\bwas\b/gi, "is"],
    [/\bwere\b/gi, "are"],
    [/\ba pretty big adjustment\b/gi, "pretty big adjust"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  if (index % 3 === 0) text = text.replace(/\bthe\b/gi, "").replace(/\ba\b/gi, "");
  if (index % 3 === 1) text = text.replace(/\btranscripts\b/gi, "transcript").replace(/\bfields\b/gi, "field");
  return normalizeSpaces(text);
}

function reorderedReread(suggestion: string, index: number): string {
  const fragment = fragmentWords(suggestion, index, 0.76);
  const split = clamp(Math.floor(fragment.length * (0.42 + (index % 3) * 0.08)), 4, fragment.length - 3);
  const first = fragment.slice(0, split);
  const second = fragment.slice(split);
  if (index % 3 === 0) return `${fromWords(second)} and before that ${fromWords(first)}`;
  if (index % 3 === 1) return `${fromWords(second)} ${fromWords(first)}`;
  return `${fromWords(first.slice(Math.floor(first.length / 2)))} ${fromWords(second)} ${fromWords(first.slice(0, Math.floor(first.length / 2)))}`;
}

function mixedRealisticNoise(suggestion: string, index: number): string {
  const fragment = fragmentWords(suggestion, index, 0.82);
  const out: string[] = [];
  for (let i = 0; i < fragment.length; i += 1) {
    const token = fragment[i]!;
    const key = cleanTokenKey(token);
    if ((i + index) % 6 === 0 && testStopWords.has(key)) continue;
    if ((i + index) % 5 === 0) out.push(fillerPhrases[(i + index) % fillerPhrases.length]!);
    if ((i + index) % 7 === 0) {
      out.push(substituteToken(token, i + index));
      continue;
    }
    out.push(token);
    if ((i + index) % 11 === 0) out.push(token);
  }
  return out.join(" ");
}

function rereadThenQuestion(suggestion: string, index: number): string {
  const parts = words(truncateWords(suggestion, 34));
  const length = clamp(Math.ceil(parts.length * 0.35), 5, Math.min(14, parts.length));
  const fragment = fromWords(parts.slice(0, length));
  const question = questionSuffixes[index % questionSuffixes.length]!;
  if (index % 3 === 0) return `${fragment}. ${question}?`;
  if (index % 3 === 1) return `${fragment} wait before you continue ${question}`;
  return `${fragment} ${question}`;
}

function negativeControl(index: number, negatives: string[], suggestion: string): string {
  for (let attempt = 0; attempt < negatives.length; attempt += 1) {
    const text = negatives[(index + attempt * 17) % negatives.length] || manualNegativeControls[index % manualNegativeControls.length]!;
    const candidate = truncateWords(text, 34);
    if (!detectSuggestionEcho(candidate, [suggestion]).matched) {
      return candidate;
    }
  }
  return manualNegativeControls[index % manualNegativeControls.length]!;
}

function buildCases(): EchoCase[] {
  const db = loadDbPools();
  const docSnippets = readDocSnippets();
  const suggestions = uniqueByText([...baseSuggestions, ...db.aiReplies], 180)
    .map((item) => truncateWords(item, 36))
    .filter((item) => wordCount(item) >= 8 && !isQuestionLikeSuggestion(item));
  const negatives = uniqueByText([...manualNegativeControls, ...db.transcripts, ...docSnippets], 260)
    .filter((item) => wordCount(item) >= 5);

  const builders: Record<EchoCategory, (suggestion: string, index: number) => { transcript: string; expected: boolean; source: string }> = {
    "partial-read-plus-own-thought": (suggestion, index) => ({
      transcript: partialReadPlusOwnThought(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/template",
    }),
    "broken-reread": (suggestion, index) => ({
      transcript: brokenReread(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/stutter",
    }),
    "filler-heavy-reread": (suggestion, index) => ({
      transcript: fillerHeavyReread(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/filler",
    }),
    "misread-words": (suggestion, index) => ({
      transcript: misreadWords(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/misread",
    }),
    "asr-wrong-words": (suggestion, index) => ({
      transcript: asrWrongWords(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/asr-wrong",
    }),
    "omitted-words": (suggestion, index) => ({
      transcript: omittedWords(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/omitted",
    }),
    "grammar-error-reread": (suggestion, index) => ({
      transcript: grammarErrorReread(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/grammar",
    }),
    "reordered-reread": (suggestion, index) => ({
      transcript: reorderedReread(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/reordered",
    }),
    "mixed-realistic-noise": (suggestion, index) => ({
      transcript: mixedRealisticNoise(suggestion, index),
      expected: true,
      source: index < baseSuggestions.length ? "template" : "db-ai-reply/mixed-noise",
    }),
    "reread-then-question": (suggestion, index) => ({
      transcript: rereadThenQuestion(suggestion, index),
      expected: false,
      source: "template/interruption",
    }),
    "negative-controls": (suggestion, index) => ({
      transcript: negativeControl(index, negatives, suggestion),
      expected: false,
      source: index < manualNegativeControls.length ? "manual-negative" : "db-or-doc-transcript",
    }),
  };

  const categories: EchoCategory[] = [
    "partial-read-plus-own-thought",
    "broken-reread",
    "filler-heavy-reread",
    "misread-words",
    "asr-wrong-words",
    "omitted-words",
    "grammar-error-reread",
    "reordered-reread",
    "mixed-realistic-noise",
    "reread-then-question",
    "negative-controls",
  ];

  const cases: EchoCase[] = [];
  for (const category of categories) {
    for (let i = 0; i < perCategory; i += 1) {
      const suggestion = suggestions[i % suggestions.length] || baseSuggestions[i % baseSuggestions.length]!;
      const built = builders[category](suggestion, i);
      cases.push({
        category,
        name: `${category}-${String(i + 1).padStart(3, "0")}`,
        suggestion,
        transcript: built.transcript,
        expected: built.expected,
        source: built.source,
      });
    }
  }

  return cases;
}

const cases = buildCases();
const byCategory = new Map<EchoCategory, { total: number; failed: number }>();
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

  if (verbose || !passed) {
    console.log([
      passed ? "PASS" : "FAIL",
      testCase.category,
      testCase.name,
      `source=${testCase.source}`,
      `expected=${testCase.expected}`,
      `actual=${result.matched}`,
      `similarity=${result.similarity.toFixed(2)}`,
      `transcriptCoverage=${result.transcriptCoverage.toFixed(2)}`,
      `suggestionCoverage=${result.suggestionCoverage.toFixed(2)}`,
    ].join(" | "));
    if (!passed) {
      console.log(`  suggestion: ${testCase.suggestion}`);
      console.log(`  transcript: ${testCase.transcript}`);
      console.log(`  matchedCandidate: ${result.candidate}`);
    }
  }
}

console.log(`SUGGESTION_ECHO_EVAL seed=${seed} perCategory=${perCategory} cases=${cases.length}`);
console.log("Summary");
for (const [category, stats] of byCategory) {
  const passed = stats.total - stats.failed;
  console.log(`${category}: ${passed}/${stats.total} passed`);
  if (stats.total < 100) {
    console.error(`Category ${category} has fewer than 100 cases.`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} suggestion echo tests failed.`);
  process.exit(1);
}
