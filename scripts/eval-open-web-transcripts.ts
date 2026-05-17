import { PDFParse } from "pdf-parse";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { EventMemoryManager } from "../src/server/memory/event-memory";

const userId = process.argv[2] || "li2897283405@gmail.com";

type WebCase = {
  source: string;
  kind: "dialogue" | "meeting" | "lecture" | "news" | "short_video";
  text: string;
  expectedScene?: string;
  expectedScenes?: string[];
  allowKnowledge?: boolean;
  expectNoMemory?: boolean;
};

type Flag = {
  source: string;
  kind: string;
  issue: string;
  text: string;
  scene?: string;
  top?: string[];
};

const DAILY_DIALOG_URL = "https://raw.githubusercontent.com/liuzeming01/XDailyDialog/master/data/1k_part_data/dialogues_text_En.txt";
const AMI_DEV_URL = "https://raw.githubusercontent.com/tsuruoka-lab/AMI-Meeting-Parallel-Corpus/master/dev.json";
const MIT_OCW_PDF_URL = "https://ocw.mit.edu/courses/18-085-computational-science-and-engineering-i-fall-2008/1b9d3132350905168127c7d42421f0a0_18-085F08-L14.pdf";
const WIKINEWS_LIST_URL = "https://en.wikinews.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Published&cmlimit=18&format=json&origin=*";

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return compact(text).split(/\s+/).filter(Boolean);
}

function chunkWords(text: string, size: number, limit: number): string[] {
  const all = words(text);
  const chunks: string[] = [];
  for (let i = 0; i < all.length && chunks.length < limit; i += size) {
    const chunk = all.slice(i, i + size).join(" ");
    if (chunk.length >= 40) chunks.push(chunk);
  }
  return chunks;
}

function sampleEvery<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = Math.max(1, Math.floor(items.length / count));
  const result: T[] = [];
  for (let i = 0; i < items.length && result.length < count; i += step) result.push(items[i]);
  return result;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SayNext local evaluation script",
      "Accept": "text/plain,application/json,application/pdf,*/*",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function fetchDailyDialogCases(): Promise<WebCase[]> {
  const text = await fetchText(DAILY_DIALOG_URL);
  const dialogues = text
    .split(/\r?\n/)
    .map((line) => line.split("__eou__").map(compact).filter(Boolean))
    .filter((turns) => turns.length >= 3);

  const selected = sampleEvery(dialogues, 35);
  return selected.map((turns, index) => {
    const slice = turns.slice(0, Math.min(4, turns.length)).join(" ");
    return {
      source: `DailyDialog/XDailyDialog#${index + 1}`,
      kind: "dialogue",
      text: slice,
      allowKnowledge: false,
    };
  });
}

async function fetchAmiCases(): Promise<WebCase[]> {
  const raw = await fetchText(AMI_DEV_URL);
  const docs = JSON.parse(raw) as Array<{ id: string; conversation: Array<{ en_speaker: string; en_sentence: string }> }>;
  const cases: WebCase[] = [];

  for (const doc of docs.slice(0, 5)) {
    const turns = doc.conversation
      .map((turn) => `${turn.en_speaker}: ${compact(turn.en_sentence)}`)
      .filter((line) => line.length > 10);

    for (let i = 0; i < turns.length && cases.length < 35; i += 7) {
      const chunk = turns.slice(i, i + 5).join(" ");
      if (chunk.length < 60) continue;
      cases.push({
        source: `AMI meeting parallel corpus ${doc.id}`,
        kind: "meeting",
        text: chunk,
        expectedScenes: ["group_discussion", "work_discussion"],
        allowKnowledge: true,
      });
    }
  }

  return cases;
}

async function fetchMitLectureCases(): Promise<WebCase[]> {
  const response = await fetch(MIT_OCW_PDF_URL);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for MIT OCW PDF`);

  const parser = new PDFParse({ data: Buffer.from(await response.arrayBuffer()) });
  try {
    const parsed = await parser.getText();
    return chunkWords(parsed.text, 95, 28).map((text, index) => ({
      source: `MIT OCW 18.085 lecture transcript #${index + 1}`,
      kind: "lecture",
      text,
      expectedScene: "classroom",
      allowKnowledge: true,
    }));
  } finally {
    await parser.destroy();
  }
}

async function fetchWikinewsCases(): Promise<WebCase[]> {
  const list = JSON.parse(await fetchText(WIKINEWS_LIST_URL)) as {
    query?: { categorymembers?: Array<{ title: string }> };
  };
  const titles = (list.query?.categorymembers ?? []).map((item) => item.title).slice(0, 12);
  const cases: WebCase[] = [];

  for (const title of titles) {
    const url = `https://en.wikinews.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&origin=*&titles=${encodeURIComponent(title)}`;
    const data = JSON.parse(await fetchText(url)) as { query?: { pages?: Record<string, { extract?: string }> } };
    const extract = Object.values(data.query?.pages ?? {})[0]?.extract ?? "";
    const chunks = chunkWords(extract, 70, 2);
    for (const [index, text] of chunks.entries()) {
      cases.push({
        source: `Wikinews ${title} #${index + 1}`,
        kind: "news",
        text,
        allowKnowledge: false,
        expectNoMemory: true,
      });
    }
  }

  return cases.slice(0, 24);
}

function makeShortVideoStyleCases(): WebCase[] {
  const cases = [
    "Here is the thing nobody tells you about staying productive. If your desk is a mess and your phone is buzzing every two minutes, your brain is basically trying to do three jobs at once.",
    "Quick story time. I tried meal prepping for one week, and by day three I was already ordering takeout because the same chicken and rice combo was making me question my life choices.",
    "If you are learning a new skill, stop waiting until you feel ready. Just make the bad first version, because the first version is supposed to be kind of ugly.",
    "This is why people get confused by AI tools. They expect magic, but most of the real value comes from giving the tool better context and checking the output like a normal person.",
    "Three small habits that helped me save money: stop buying random drinks outside, check subscriptions once a month, and do not open food delivery apps when you are already hungry.",
    "A lot of people think confidence means acting like you know everything. Honestly, it is more like being comfortable saying you are not sure and still trying the next step.",
    "Here is a simple explanation of cloud storage. Instead of keeping files only on your own computer, you store them on remote servers and access them through the internet.",
    "The easiest way to make a group project worse is pretending everything is fine until the deadline. Say the blocker early, even if it feels awkward.",
    "If you are watching this before an interview, remember this. You do not need a perfect answer. You need a clear answer with one real example and one thing you learned.",
    "People romanticize working all night, but most of the time it just means you started too late and tomorrow you will feel like a low battery laptop.",
  ];

  return cases.map((text, index) => ({
    source: `short-form public-style transcript #${index + 1}`,
    kind: "short_video",
    text,
    allowKnowledge: index === 3 || index === 6 || index === 7 || index === 8,
    expectedScene: index === 7 ? "group_discussion" : index === 8 ? "interview" : undefined,
  }));
}

function isPersonalOrProjectRef(ref: string): boolean {
  return ref.startsWith("xiang-") || ref.startsWith("doc:");
}

function isHighSignalLeakRef(ref: string): boolean {
  const normalized = ref.toLowerCase();
  return normalized.startsWith("doc:")
    || normalized.includes(":project")
    || normalized.includes("technical-skills")
    || normalized.includes("identity")
    || normalized.includes("family")
    || normalized.includes("driving-car");
}

function shouldAllowPersonalForDirectDialogue(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(your|you|yourself)\b/.test(normalized)
    && /\b(school|study|project|family|mother|father|game|food|home|room|job|interview|course|class)\b/.test(normalized);
}

function checkCase(test: WebCase, index: number): Flag[] {
  const flags: Flag[] = [];
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, test.text, 5);
  const top = results.map((result) => `${result.sourceRef || `id:${result.id}`} :: ${result.title}`);
  const refs = results.map((result) => result.sourceRef || `id:${result.id}`);

  const manager = new EventMemoryManager(`open-web-eval-${index}@local`, `open-web-${Date.now()}-${index}`, false);
  const seed = test.kind === "lecture"
    ? "This is a lecture transcript from an open course."
    : test.kind === "meeting"
      ? "This is a project meeting transcript."
      : "";
  if (seed) manager.addTranscript(seed, 1_800_000_000_000 + index * 100_000);
  const snapshot = manager.addTranscript(test.text, 1_800_000_010_000 + index * 100_000);

  const expectedScenes = test.expectedScenes ?? (test.expectedScene ? [test.expectedScene] : []);
  if (expectedScenes.length > 0 && !expectedScenes.includes(snapshot.scene)) {
    flags.push({
      source: test.source,
      kind: test.kind,
      issue: `scene_mismatch expected=${expectedScenes.join("|")} actual=${snapshot.scene}`,
      text: test.text,
      scene: snapshot.scene,
      top,
    });
  }

  const personalRefs = refs.filter(isPersonalOrProjectRef);
  const highSignalLeakRefs = refs.filter(isHighSignalLeakRef);
  const directDialoguePersonal = test.kind === "dialogue" && shouldAllowPersonalForDirectDialogue(test.text);

  if (test.expectNoMemory && refs.length > 0) {
    flags.push({
      source: test.source,
      kind: test.kind,
      issue: "retrieval_on_public_news_or_noise",
      text: test.text,
      scene: snapshot.scene,
      top,
    });
  } else if (highSignalLeakRefs.length && !directDialoguePersonal) {
    flags.push({
      source: test.source,
      kind: test.kind,
      issue: "personal_or_project_memory_on_public_transcript",
      text: test.text,
      scene: snapshot.scene,
      top,
    });
  } else if (!test.allowKnowledge && refs.some((ref) => ref.startsWith("knowledge:"))) {
    flags.push({
      source: test.source,
      kind: test.kind,
      issue: "knowledge_memory_on_generic_public_transcript",
      text: test.text,
      scene: snapshot.scene,
      top,
    });
  }

  return flags;
}

function printFlags(flags: Flag[], limit = 40): void {
  for (const flag of flags.slice(0, limit)) {
    console.log(`\n[${flag.kind}] ${flag.source} :: ${flag.issue}`);
    if (flag.scene) console.log(`scene=${flag.scene}`);
    console.log(`text=${flag.text.slice(0, 360)}${flag.text.length > 360 ? "..." : ""}`);
    if (flag.top?.length) console.log(`top=${flag.top.slice(0, 5).join(" | ")}`);
  }
  if (flags.length > limit) console.log(`\n... ${flags.length - limit} more flags`);
}

const sourceLoaders = [
  fetchDailyDialogCases,
  fetchAmiCases,
  fetchMitLectureCases,
  fetchWikinewsCases,
  async () => makeShortVideoStyleCases(),
];

const cases: WebCase[] = [];
for (const loader of sourceLoaders) {
  try {
    cases.push(...await loader());
  } catch (error) {
    console.warn(`[open-web-eval] source skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const flags: Flag[] = [];
const byKind = new Map<string, { cases: number; flags: number }>();

for (const [index, test] of cases.entries()) {
  const nextFlags = checkCase(test, index);
  flags.push(...nextFlags);
  const stat = byKind.get(test.kind) ?? { cases: 0, flags: 0 };
  stat.cases += 1;
  stat.flags += nextFlags.length;
  byKind.set(test.kind, stat);
}

console.log(`OPEN_WEB_TRANSCRIPT_EVAL cases=${cases.length} flags=${flags.length}`);
for (const [kind, stat] of [...byKind.entries()].sort()) {
  console.log(`${kind}: cases=${stat.cases} flags=${stat.flags}`);
}

printFlags(flags);

if (flags.length > 0) {
  process.exitCode = 1;
}
