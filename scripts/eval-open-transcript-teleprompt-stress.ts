import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import {
  makeTelepromptOpeningLine,
  shouldStartTeleprompt,
  TelepromptRuntime,
  type TelepromptTranscriptResult,
} from "../src/server/teleprompt/teleprompt-runtime";

type SourceKind =
  | "daily_dialogue"
  | "meeting"
  | "ielts"
  | "lecture"
  | "news"
  | "open_movie_subtitles"
  | "public_domain_drama"
  | "subtitle_style"
  | "short_form";
type ExpectedAction = "advance" | "finish" | "cancel" | "hold_consumed" | "hold_open";

type TranscriptSnippet = {
  source: string;
  kind: SourceKind;
  text: string;
};

type StressCase = {
  id: string;
  group: string;
  source: string;
  kind: SourceKind;
  transcript: string;
  expectedAction?: ExpectedAction;
  expectedStart?: "none" | "expandable" | "long" | "not_long";
  actualAction?: ExpectedAction;
  actualStart?: "none" | "expandable" | "long";
  pass?: boolean;
  note: string;
};

const rawArgs = process.argv.slice(2);
const targetCount = Math.max(180, Number(rawArgs.find((arg) => /^\d+$/.test(arg)) || 360));
const seedArg = rawArgs.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length);
const seed = seedArg || new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join("data", "eval");
const now = new Date().toISOString().replace(/[:.]/g, "-");

const DAILY_DIALOG_URL = "https://raw.githubusercontent.com/liuzeming01/XDailyDialog/master/data/1k_part_data/dialogues_text_En.txt";
const AMI_DEV_URL = "https://raw.githubusercontent.com/tsuruoka-lab/AMI-Meeting-Parallel-Corpus/master/dev.json";
const IELTS_SPEAKING_URL = "https://huggingface.co/datasets/qwertyuiopasdfg/IELTs-Speaking-answer/resolve/main/ielts_new.json";
const MIT_OCW_PDF_URL = "https://ocw.mit.edu/courses/18-085-computational-science-and-engineering-i-fall-2008/1b9d3132350905168127c7d42421f0a0_18-085F08-L14.pdf";
const WIKINEWS_LIST_URL = "https://en.wikinews.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Published&cmlimit=20&format=json&origin=*";
const TEARS_OF_STEEL_SRT_URL = "https://commons.wikimedia.org/w/index.php?title=TimedText:Tears_of_Steel_1080p.webm.en.srt&action=raw";
const BIG_BUCK_BUNNY_VTT_URL = "https://raw.githubusercontent.com/chintan9/Big-Buck-Bunny/master/subtitles-en.vtt";
const GUTENBERG_FIRST_FOLIO_URL = "https://www.gutenberg.org/ebooks/2270.txt.utf-8";

const baseScript = [
  "SayNext is a mobile app I have been building for real-time conversation support.",
  "It listens to live transcripts, keeps short context, and uses memory retrieval to make the answer more personal.",
  "The hardest part is not only generating a reply, but deciding when to speak, when to stay quiet, and how to recover after interruptions.",
  "I tested it with daily chat, interviews, classroom discussions, meetings, and messy ASR transcripts.",
  "The goal is to make the output feel useful in the moment instead of sounding like a generic chatbot.",
].join(" ");

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(input: number): () => number {
  let value = input >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded<T>(items: T[], seedText: string): T[] {
  const rng = mulberry32(hashSeed(seedText));
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function chunkWords(text: string, size: number, limit: number): string[] {
  const words = compact(text).split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length && chunks.length < limit; i += size) {
    const chunk = words.slice(i, i + size).join(" ");
    if (wordCount(chunk) >= Math.max(8, Math.floor(size * 0.6))) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function stripSubtitleMarkup(text: string): string {
  return compact(text
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/^\s*[-–]\s*/gm, "")
    .replace(/\s+/g, " "));
}

function parseSubtitleCues(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => {
          if (!line) return false;
          if (/^WEBVTT/i.test(line)) return false;
          if (/^NOTE\b/i.test(line)) return false;
          if (/^\d+$/.test(line)) return false;
          if (/-->/i.test(line)) return false;
          if (/^\s*(align|position|line|size):/i.test(line)) return false;
          return true;
        });
      return stripSubtitleMarkup(lines.join(" "));
    })
    .filter((cue) => wordCount(cue) >= 2);
}

function chunkCues(cues: string[], cueWindow: number, limit: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < cues.length && chunks.length < limit; i += cueWindow) {
    const chunk = compact(cues.slice(i, i + cueWindow).join(" "));
    if (wordCount(chunk) >= 12) chunks.push(chunk);
  }
  return chunks;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/plain,application/json,application/pdf,*/*",
      "User-Agent": "SayNext open transcript stress test",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function sampleEvery<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const output: T[] = [];
  for (let i = 0; i < items.length && output.length < count; i += step) {
    output.push(items[Math.floor(i)]);
  }
  return output;
}

function extractStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const cleaned = compact(value);
    if (cleaned.length >= 20) out.push(cleaned);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) extractStrings(item, out);
  }
  return out;
}

async function fetchDailyDialog(): Promise<TranscriptSnippet[]> {
  const text = await fetchText(DAILY_DIALOG_URL);
  const dialogues = text
    .split(/\r?\n/)
    .map((line) => line.split("__eou__").map(compact).filter(Boolean))
    .filter((turns) => turns.length >= 3);

  return sampleEvery(dialogues, 80).map((turns, index) => ({
    source: `XDailyDialog/DailyDialog ${index + 1}`,
    kind: "daily_dialogue",
    text: turns.slice(0, Math.min(5, turns.length)).join(" "),
  }));
}

async function fetchAmiMeeting(): Promise<TranscriptSnippet[]> {
  const raw = await fetchText(AMI_DEV_URL);
  const docs = JSON.parse(raw) as Array<{ id: string; conversation: Array<{ en_speaker?: string; en_sentence?: string }> }>;
  const snippets: TranscriptSnippet[] = [];

  for (const doc of docs.slice(0, 12)) {
    const turns = doc.conversation
      .map((turn) => compact(`${turn.en_speaker || "speaker"}: ${turn.en_sentence || ""}`))
      .filter((line) => wordCount(line) >= 4);
    for (let i = 0; i < turns.length && snippets.length < 80; i += 6) {
      const text = turns.slice(i, i + 5).join(" ");
      if (wordCount(text) >= 18) {
        snippets.push({
          source: `AMI meeting ${doc.id} chunk ${i}`,
          kind: "meeting",
          text,
        });
      }
    }
  }

  return snippets;
}

async function fetchIelts(): Promise<TranscriptSnippet[]> {
  const raw = await fetchText(IELTS_SPEAKING_URL);
  const values = extractStrings(JSON.parse(raw));
  return values
    .filter((item) => /\b(describe|talk about|tell me|what|why|how|do you|would you|should)\b/i.test(item))
    .slice(0, 90)
    .map((text, index) => ({
      source: `IELTS speaking dataset ${index + 1}`,
      kind: "ielts",
      text,
    }));
}

async function fetchMitLecture(): Promise<TranscriptSnippet[]> {
  const response = await fetch(MIT_OCW_PDF_URL, {
    headers: { "User-Agent": "SayNext open transcript stress test" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for MIT OCW PDF`);

  const parser = new PDFParse({ data: Buffer.from(await response.arrayBuffer()) });
  try {
    const parsed = await parser.getText();
    return chunkWords(parsed.text, 65, 60).map((text, index) => ({
      source: `MIT OCW lecture PDF chunk ${index + 1}`,
      kind: "lecture",
      text,
    }));
  } finally {
    await parser.destroy();
  }
}

async function fetchWikinews(): Promise<TranscriptSnippet[]> {
  const list = JSON.parse(await fetchText(WIKINEWS_LIST_URL)) as {
    query?: { categorymembers?: Array<{ title: string }> };
  };
  const titles = (list.query?.categorymembers ?? []).map((item) => item.title).slice(0, 12);
  const snippets: TranscriptSnippet[] = [];

  for (const title of titles) {
    const url = `https://en.wikinews.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&origin=*&titles=${encodeURIComponent(title)}`;
    const data = JSON.parse(await fetchText(url)) as { query?: { pages?: Record<string, { extract?: string }> } };
    const extract = Object.values(data.query?.pages ?? {})[0]?.extract || "";
    for (const [index, text] of chunkWords(extract, 65, 2).entries()) {
      snippets.push({
        source: `Wikinews ${title} chunk ${index + 1}`,
        kind: "news",
        text,
      });
    }
  }

  return snippets.slice(0, 24);
}

async function fetchOpenMovieSubtitles(): Promise<TranscriptSnippet[]> {
  const sources = [
    { name: "Tears of Steel Wikimedia subtitles", url: TEARS_OF_STEEL_SRT_URL, cueWindow: 9 },
    { name: "Big Buck Bunny open movie VTT", url: BIG_BUCK_BUNNY_VTT_URL, cueWindow: 10 },
  ];
  const snippets: TranscriptSnippet[] = [];

  for (const source of sources) {
    const cues = parseSubtitleCues(await fetchText(source.url));
    for (const [index, text] of chunkCues(cues, source.cueWindow, 22).entries()) {
      snippets.push({
        source: `${source.name} chunk ${index + 1}`,
        kind: "open_movie_subtitles",
        text,
      });
    }
  }

  return snippets;
}

async function fetchGutenbergDrama(): Promise<TranscriptSnippet[]> {
  const raw = await fetchText(GUTENBERG_FIRST_FOLIO_URL);
  const body = raw
    .replace(/^[\s\S]*?\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^*]+\*\*\*/i, "")
    .replace(/\*\*\* END OF THE PROJECT GUTENBERG EBOOK[\s\S]*$/i, "");
  const cleaned = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(act|scene)\b/i.test(line)) return false;
      if (/^\[[^\]]+\]$/.test(line)) return false;
      if (/^dramatis personae/i.test(line)) return false;
      return /[a-zA-Z]/.test(line);
    })
    .join(" ");

  return chunkWords(cleaned, 65, 90).map((text, index) => ({
    source: `Project Gutenberg Shakespeare First Folio chunk ${index + 1}`,
    kind: "public_domain_drama",
    text,
  }));
}

function makeSubtitleStyle(): TranscriptSnippet[] {
  const scenes = [
    "A: Wait, you actually built this on your own? B: Kind of. I mean, not everything from scratch, but the main flow is mine. A: Then why is it still loading? B: Because real-time audio is messy, okay.",
    "A: We have five minutes before the meeting starts. B: That is not enough time. A: It is enough if you stop explaining the whole universe and just tell me the problem. B: Fine. The database is not syncing.",
    "A: You said the app was ready. B: I said it was mostly ready. A: That is a dangerous word. B: It works until someone talks too fast, which is basically everyone.",
    "A: Why did you choose cloud computing? B: Honestly, because it felt useful. A: That is your answer? B: No, that is the human version. The interview version has more structure.",
    "A: The professor is asking for a technical answer. B: Okay, then say the trade-off is scalability versus control. A: That sounds too clean. B: Add cold start and debugging, then it sounds real.",
    "A: Are you nervous? B: A little. A: You have the notes. B: Yeah, but reading notes while looking normal is a whole separate skill.",
    "A: The client changed the requirement again. B: Of course they did. A: Can your system handle that? B: If the transcript is clear, yes. If it is chaos, maybe.",
    "A: You stopped in the middle. B: I lost the next line. A: Then go back one step. B: That is exactly why I need a Back button.",
    "A: Do not over-explain. B: I know. A: You are already doing it. B: Sorry, I just need one sentence to connect the idea.",
    "A: What happened to the first prototype? B: It was too slow. A: How slow? B: Slow enough that the answer arrived after the conversation moved on.",
    "A: If this is for daily chat, make it less formal. B: So basically, sound like a normal person. A: Exactly. B: That is somehow harder than sounding professional.",
    "A: He asked a new question while you were still reading. B: Then the old script should disappear. A: And if it disappears too early? B: Then I need cancel, back, and next.",
    "A: This part feels like a presentation. B: Yeah, I need a longer answer. A: But not a wall of text. B: More like small chunks I can actually read.",
    "A: Did you test it with subtitles? B: Not enough. A: Movie dialogue is weird. B: Exactly, people interrupt each other and nobody speaks like a textbook.",
    "A: You keep saying basically. B: Basically is load-bearing vocabulary. A: That is not a thing. B: It is when you are trying to sound casual.",
    "A: The scene changed from interview to daily chat. B: Then the answer style should change too. A: Can the app know that? B: It can guess, but manual scene control is safer.",
    "A: What if the ASR misses half your sentence? B: Then the teleprompt should not panic. A: It should wait? B: Yeah, hold the current line until there is enough evidence.",
    "A: This sounds like a TV argument. B: Good, because real conversation is closer to that than to IELTS sample answers. A: Annoying but true.",
    "A: You are reading too fast. B: I know. A: The system skipped ahead. B: Then I hit Back and continue from the same chunk.",
    "A: The next slide is about architecture. B: Wait, I am still on the memory part. A: Then do not jump yet. B: Exactly, partial reading should hold.",
    "A: Are we done with this topic? B: Not really. A: Then why did it say Done? B: Because it thought I finished the last chunk.",
    "A: This is a disaster. B: It is not a disaster. A: It is a live demo. B: Okay, live demo disaster, but still fixable.",
    "A: The villain monologue is too long. B: Cut it into chunks. A: That is your solution to everything. B: For glasses, yes, actually.",
    "A: You sound like you memorized it. B: Then add a little hesitation. A: Not too much. B: Yeah, just enough to sound alive.",
    "A: The meeting moved on. B: Cancel the prompt. A: What about the old context? B: Keep it in memory, but stop showing it.",
  ];

  const setupLines = [
    "The room goes quiet and everyone looks at the screen",
    "The call freezes for a second and then comes back",
    "Someone walks in halfway through the explanation",
    "The interviewer glances at the next question",
    "The teacher switches slides before the answer is done",
    "A teammate interrupts with a database question",
    "The subtitles lag behind the audio by one sentence",
    "The speaker changes topic without warning",
    "The conversation turns from casual to technical",
    "The presenter loses the next line and pauses",
  ];
  const speakerALines = [
    "Wait, can you go back to the previous point",
    "That sounds right, but what is the actual problem",
    "Can you make it shorter and more natural",
    "I think we skipped the important part",
    "Why does the app need memory at all",
    "What happens if the transcript is wrong",
    "Can you explain it without sounding like a textbook",
    "Are you still talking about the same project",
    "Do we need to cancel this answer now",
    "Should we move to the next question",
    "How would you say that in an interview",
    "What if the professor asks a follow-up",
  ];
  const speakerBLines = [
    "Yeah, basically the system needs enough evidence before it moves on",
    "I would keep the current line until the spoken words clearly match it",
    "The answer should change only when the scene really changes",
    "If someone interrupts, the old script should stop being the main thing",
    "A short hesitation should not be treated like a new question",
    "The safest design is to hold first and let the user press Next if needed",
    "If it jumps too early, Back is the fastest recovery",
    "If the conversation changes completely, Cancel is better than forcing it",
    "The UI has to assume the user is busy and cannot manage a complex menu",
    "It should sound like spoken English, not a polished essay",
    "The system should not panic just because I add basically or you know",
    "Real subtitles are messy because people overlap and change direction",
  ];
  const followUps = [
    "Okay, but do not make it too formal",
    "Right, but the timing still matters",
    "That is useful if the screen is tiny",
    "So the problem is not only the model",
    "That makes sense in a live meeting",
    "Good, now test it with a weirder scene",
    "Fine, but what about daily chat",
    "That sounds like a real edge case",
  ];
  const generatedScenes: string[] = [];

  for (let i = 0; generatedScenes.length < 80; i += 1) {
    generatedScenes.push([
      `Scene: ${setupLines[i % setupLines.length]}.`,
      `A: ${speakerALines[i % speakerALines.length]}?`,
      `B: ${speakerBLines[(i * 3) % speakerBLines.length]}.`,
      `A: ${followUps[(i * 5) % followUps.length]}.`,
      `B: ${speakerBLines[(i * 7 + 2) % speakerBLines.length]}.`,
    ].join(" "));
  }

  return [...scenes, ...generatedScenes].map((text, index) => ({
    source: `synthetic movie/TV subtitle-style scene ${index + 1}`,
    kind: "subtitle_style",
    text,
  }));
}

function makeShortForm(): TranscriptSnippet[] {
  const texts = [
    "If you are preparing for an interview, do not try to sound perfect. Give one real example, explain the problem, explain what you did, and then say what changed.",
    "Here is a quick cloud computing explanation. Serverless is nice when traffic is unpredictable, but you still need to think about cold starts, logs, retries, and cost.",
    "Story time. I tried to organize my schedule perfectly, and then one assignment took twice as long as expected, so the whole plan basically collapsed by dinner.",
    "A common mistake in group projects is waiting too long before saying you are blocked. It feels polite, but it usually makes the deadline worse for everyone.",
    "If you are learning machine learning, do not only memorize definitions. Try to connect each concept to a small example, like classifying emails or recommending songs.",
    "People act like productivity is about waking up at 5 AM, but honestly sometimes it is just closing the delivery app and doing the annoying small task first.",
    "This is why context matters for AI. The same sentence can be a question, a lecture point, or background noise depending on what happened before it.",
    "For presentations, the best version is not always the most formal version. Sometimes a simple clear explanation sounds more confident than a memorized paragraph.",
  ];
  return texts.map((text, index) => ({
    source: `synthetic short-form transcript ${index + 1}`,
    kind: "short_form",
    text,
  }));
}

function normalizeAction(result: TelepromptTranscriptResult): ExpectedAction {
  if (result.action === "advance") return "advance";
  if (result.action === "finish") return "finish";
  if (result.action === "cancel") return "cancel";
  return result.consumed ? "hold_consumed" : "hold_open";
}

function runOtherSpeechDuringReady(snippet: TranscriptSnippet, index: number): StressCase {
  const runtime = new TelepromptRuntime();
  runtime.startPending("Can you walk me through your SayNext project?", makeTelepromptOpeningLine("Can you walk me through your SayNext project?"));
  runtime.setScript(baseScript);
  runtime.handleTranscript("SayNext is a mobile app I have been building for real-time conversation support.");
  const result = runtime.handleTranscript(snippet.text);
  const actualAction = normalizeAction(result);
  const expectedAction: ExpectedAction = "cancel";
  return {
    id: `ready-${index}`,
    group: "open transcript interrupts active teleprompt",
    source: snippet.source,
    kind: snippet.kind,
    transcript: snippet.text,
    expectedAction,
    actualAction,
    pass: actualAction === expectedAction,
    note: "A long unrelated open transcript while Xiang is reading should release the teleprompt and let the new context take over.",
  };
}

function runOtherSpeechDuringPending(snippet: TranscriptSnippet, index: number): StressCase {
  const runtime = new TelepromptRuntime();
  runtime.startPending("Can you walk me through your SayNext project?", makeTelepromptOpeningLine("Can you walk me through your SayNext project?"));
  const result = runtime.handleTranscript(snippet.text);
  const actualAction = normalizeAction(result);
  const expectedAction: ExpectedAction = "cancel";
  return {
    id: `pending-${index}`,
    group: "open transcript interrupts pending script generation",
    source: snippet.source,
    kind: snippet.kind,
    transcript: snippet.text,
    expectedAction,
    actualAction,
    pass: actualAction === expectedAction,
    note: "While the long script is generating, a new long transcript should cancel stale generation.",
  };
}

function runStartClassification(snippet: TranscriptSnippet, index: number): StressCase {
  const sceneHint = snippet.kind === "lecture"
    ? "Classroom teacher is explaining a concept"
    : snippet.kind === "meeting"
      ? "Meeting / Group Discussion"
      : snippet.kind === "open_movie_subtitles" || snippet.kind === "public_domain_drama" || snippet.kind === "subtitle_style"
        ? "Movie or TV subtitles playing in the background"
      : "";
  const actualStart = shouldStartTeleprompt(snippet.text, sceneHint);
  const expectedStart = "not_long";
  return {
    id: `start-${index}`,
    group: "public transcript should not start long teleprompt by itself",
    source: snippet.source,
    kind: snippet.kind,
    transcript: snippet.text,
    expectedStart,
    actualStart,
    pass: actualStart !== "long",
    note: "Random public transcript should not become a long read-out unless it is an explicit long-answer prompt.",
  };
}

function runIeltsPrompt(snippet: TranscriptSnippet, index: number): StressCase {
  const actualStart = shouldStartTeleprompt(snippet.text, "IELTS speaking exam");
  const lower = snippet.text.toLowerCase();
  const expectedStart = /\b(describe|talk about a time|talk about an|cue card|part 2)\b/.test(lower)
    ? "long"
    : "not_long";
  return {
    id: `ielts-${index}`,
    group: "IELTS open questions",
    source: snippet.source,
    kind: snippet.kind,
    transcript: snippet.text,
    expectedStart,
    actualStart,
    pass: expectedStart === "long" ? actualStart === "long" : actualStart !== "long",
    note: "IELTS Part 2 style prompts should start long; ordinary follow-ups should not force long teleprompt.",
  };
}

function renderReport(cases: StressCase[], sourceCounts: Record<string, number>, warnings: string[]): string {
  const failed = cases.filter((item) => !item.pass);
  const groups = [...new Set(cases.map((item) => item.group))];
  const lines: string[] = [];

  lines.push("# Open Transcript Teleprompt Stress Eval");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Seed: ${seed}`);
  lines.push(`Cases: ${cases.length}`);
  lines.push(`Passed: ${cases.length - failed.length}`);
  lines.push(`Failed: ${failed.length}`);
  lines.push("");
  lines.push("## Sources");
  for (const [source, count] of Object.entries(sourceCounts)) {
    lines.push(`- ${source}: ${count}`);
  }
  if (warnings.length) {
    lines.push("");
    lines.push("## Source Warnings");
    for (const warning of warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Groups");
  for (const group of groups) {
    const groupCases = cases.filter((item) => item.group === group);
    const groupFailed = groupCases.filter((item) => !item.pass);
    lines.push(`- ${group}: ${groupCases.length - groupFailed.length}/${groupCases.length}`);
  }

  if (failed.length) {
    lines.push("");
    lines.push("## Failures");
    for (const item of failed.slice(0, 80)) {
      lines.push("");
      lines.push(`### ${item.id}`);
      lines.push(`Group: ${item.group}`);
      lines.push(`Source: ${item.source}`);
      lines.push(`Kind: ${item.kind}`);
      if (item.expectedAction) lines.push(`Expected/actual action: ${item.expectedAction} / ${item.actualAction}`);
      if (item.expectedStart) lines.push(`Expected/actual start: ${item.expectedStart} / ${item.actualStart}`);
      lines.push(`Note: ${item.note}`);
      lines.push(`Transcript: ${item.transcript}`);
    }
  }

  lines.push("");
  lines.push("## All Cases");
  for (const item of cases) {
    lines.push("");
    lines.push(`### ${item.pass ? "PASS" : "FAIL"} ${item.id}`);
    lines.push(`Group: ${item.group}`);
    lines.push(`Source: ${item.source}`);
    lines.push(`Kind: ${item.kind}`);
    if (item.expectedAction) lines.push(`Expected/actual action: ${item.expectedAction} / ${item.actualAction}`);
    if (item.expectedStart) lines.push(`Expected/actual start: ${item.expectedStart} / ${item.actualStart}`);
    lines.push(`Transcript: ${item.transcript}`);
  }

  return lines.join("\n");
}

async function loadSource(name: string, loader: () => Promise<TranscriptSnippet[]>, warnings: string[]): Promise<TranscriptSnippet[]> {
  try {
    const snippets = await loader();
    if (!snippets.length) warnings.push(`${name}: loaded 0 snippets`);
    return snippets;
  } catch (error) {
    warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function main(): Promise<void> {
  const warnings: string[] = [];
  const sourceGroups = await Promise.all([
    loadSource("XDailyDialog/DailyDialog", fetchDailyDialog, warnings),
    loadSource("AMI meeting corpus", fetchAmiMeeting, warnings),
    loadSource("IELTS speaking dataset", fetchIelts, warnings),
    loadSource("MIT OCW lecture PDF", fetchMitLecture, warnings),
    loadSource("Wikinews", fetchWikinews, warnings),
    loadSource("Open movie subtitles", fetchOpenMovieSubtitles, warnings),
    loadSource("Project Gutenberg public-domain drama", fetchGutenbergDrama, warnings),
  ]);
  sourceGroups.push(makeShortForm());
  sourceGroups.push(makeSubtitleStyle());

  const allSnippets = sourceGroups.flat().filter((snippet) => wordCount(snippet.text) >= 8);
  const sourceCounts = allSnippets.reduce<Record<string, number>>((acc, snippet) => {
    acc[snippet.kind] = (acc[snippet.kind] || 0) + 1;
    return acc;
  }, {});

  const shuffled = shuffleSeeded(allSnippets, seed);
  const nonIelts = shuffled.filter((snippet) => snippet.kind !== "ielts");
  const ielts = shuffleSeeded(allSnippets.filter((snippet) => snippet.kind === "ielts"), `${seed}:ielts`);
  const cases: StressCase[] = [];

  const perBucket = Math.ceil(targetCount / 4);
  for (const [index, snippet] of nonIelts.slice(0, perBucket).entries()) {
    cases.push(runOtherSpeechDuringReady(snippet, index + 1));
  }
  for (const [index, snippet] of nonIelts.slice(perBucket, perBucket * 2).entries()) {
    cases.push(runOtherSpeechDuringPending(snippet, index + 1));
  }
  for (const [index, snippet] of nonIelts.slice(perBucket * 2, perBucket * 3).entries()) {
    cases.push(runStartClassification(snippet, index + 1));
  }
  for (const [index, snippet] of ielts.slice(0, perBucket).entries()) {
    cases.push(runIeltsPrompt(snippet, index + 1));
  }

  mkdirSync(outputDir, { recursive: true });
  const mdPath = join(outputDir, `open-transcript-teleprompt-stress-${now}.md`);
  const jsonPath = join(outputDir, `open-transcript-teleprompt-stress-${now}.json`);
  writeFileSync(mdPath, renderReport(cases, sourceCounts, warnings), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ seed, sourceCounts, warnings, cases }, null, 2), "utf8");

  const failed = cases.filter((item) => !item.pass);
  console.log("Open transcript teleprompt stress complete.");
  console.log(`Seed: ${seed}`);
  console.log(`Sources: ${JSON.stringify(sourceCounts)}`);
  console.log(`Cases: ${cases.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Report: ${mdPath}`);

  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (failed.length) {
    console.log("");
    console.log("First failures:");
    for (const item of failed.slice(0, 12)) {
      console.log(`- ${item.id} ${item.kind} ${item.source}`);
      if (item.expectedAction) console.log(`  action expected/actual: ${item.expectedAction}/${item.actualAction}`);
      if (item.expectedStart) console.log(`  start expected/actual: ${item.expectedStart}/${item.actualStart}`);
      console.log(`  ${item.transcript.slice(0, 180)}${item.transcript.length > 180 ? "..." : ""}`);
    }
    process.exitCode = 1;
  }
}

await main();
