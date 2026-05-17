import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { conversationLogger } from "../src/server/data/conversation-logger";
import {
  extractSessionMemoryCandidatesFromText,
  type ExtractSessionMemoryFromTextOutput,
  type ExtractedSessionMemoryCandidate,
} from "../src/server/memory/session-memory-extractor";

type SourceKind =
  | "daily_dialogue"
  | "meeting"
  | "ielts"
  | "lecture"
  | "news"
  | "movie_subtitle"
  | "public_domain_drama"
  | "short_form"
  | "mixed";

type TranscriptSnippet = {
  source: string;
  kind: SourceKind;
  text: string;
};

type StressCase = {
  id: string;
  source: string;
  sourceKinds: SourceKind[];
  transcript: string;
  injectedNoise: boolean;
};

type FastCheckResult = {
  caseId: string;
  source: string;
  sourceKinds: SourceKind[];
  memoryRefs: string[];
  flags: string[];
};

type LlmCheckResult = {
  caseId: string;
  source: string;
  sourceKinds: SourceKind[];
  transcript: string;
  output?: ExtractSessionMemoryFromTextOutput;
  flags: string[];
  error?: string;
};

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const userId = positional[0] || "li2897283405@gmail.com";
const targetCases = Math.max(1, Number(positional[1] || 100));
const extractCases = Math.max(0, Number(args.find((arg) => arg.startsWith("--extract="))?.slice("--extract=".length) || 12));
const seed = args.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length) || new Date().toISOString().replace(/[:.]/g, "-");
const skipLlm = args.includes("--no-llm");
const providerArg = args.find((arg) => arg.startsWith("--provider="))?.slice("--provider=".length);
const provider = providerArg === "openai" ? "openai" : "ollama";
const now = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join("data", "eval");

const DAILY_DIALOG_URL = "https://raw.githubusercontent.com/liuzeming01/XDailyDialog/master/data/1k_part_data/dialogues_text_En.txt";
const AMI_DEV_URL = "https://raw.githubusercontent.com/tsuruoka-lab/AMI-Meeting-Parallel-Corpus/master/dev.json";
const IELTS_SPEAKING_URL = "https://huggingface.co/datasets/qwertyuiopasdfg/IELTs-Speaking-answer/resolve/main/ielts_new.json";
const MIT_OCW_PDF_URL = "https://ocw.mit.edu/courses/18-085-computational-science-and-engineering-i-fall-2008/1b9d3132350905168127c7d42421f0a0_18-085F08-L14.pdf";
const WIKINEWS_LIST_URL = "https://en.wikinews.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Published&cmlimit=24&format=json&origin=*";
const TEARS_OF_STEEL_SRT_URL = "https://commons.wikimedia.org/w/index.php?title=TimedText:Tears_of_Steel_1080p.webm.en.srt&action=raw";
const GUTENBERG_FIRST_FOLIO_URL = "https://www.gutenberg.org/ebooks/2270.txt.utf-8";

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
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

function shuffleSeeded<T>(items: T[], rng: () => number): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function sampleEvery<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const output: T[] = [];
  for (let index = 0; index < items.length && output.length < count; index += step) {
    output.push(items[Math.floor(index)]);
  }
  return output;
}

function chunkWords(text: string, size: number, limit: number): string[] {
  const all = compact(text).split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < all.length && chunks.length < limit; index += size) {
    const chunk = all.slice(index, index + size).join(" ");
    if (wordCount(chunk) >= Math.max(12, Math.floor(size * 0.55))) chunks.push(chunk);
  }
  return chunks;
}

function extractStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    const cleaned = compact(value);
    if (cleaned.length >= 20) output.push(cleaned);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractStrings(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) extractStrings(item, output);
  }
  return output;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain,application/json,application/pdf,*/*",
      "User-Agent": "SayNext open transcript random stress test",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
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
          if (/^\d+$/.test(line)) return false;
          if (/^WEBVTT/i.test(line)) return false;
          if (/^NOTE\b/i.test(line)) return false;
          if (/-->/i.test(line)) return false;
          return true;
        });
      return stripSubtitleMarkup(lines.join(" "));
    })
    .filter((cue) => wordCount(cue) >= 2);
}

function chunkCues(cues: string[], cueWindow: number, limit: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < cues.length && chunks.length < limit; index += cueWindow) {
    const chunk = compact(cues.slice(index, index + cueWindow).join(" "));
    if (wordCount(chunk) >= 10) chunks.push(chunk);
  }
  return chunks;
}

function injectAsrNoise(text: string, rng: () => number): string {
  const words = compact(text).split(/\s+/).filter(Boolean);
  const output: string[] = [];
  for (const word of words) {
    if (rng() < 0.035) output.push(word);
    if (rng() < 0.02) output.push(rng() < 0.5 ? "uh" : "like");
    if (rng() < 0.015 && word.length > 6) output.push(word.slice(0, Math.max(2, Math.floor(word.length * 0.45))));
    output.push(word);
  }
  return output.join(" ").replace(/[.,;:]/g, rng() < 0.5 ? "" : "$&");
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
    for (let index = 0; index < turns.length && snippets.length < 90; index += 7) {
      const chunk = turns.slice(index, index + 6).join(" ");
      if (wordCount(chunk) >= 20) snippets.push({ source: `AMI meeting ${doc.id} chunk ${index}`, kind: "meeting", text: chunk });
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
    .map((text, index) => ({ source: `IELTS speaking dataset ${index + 1}`, kind: "ielts", text }));
}

async function fetchMitLecture(): Promise<TranscriptSnippet[]> {
  const response = await fetch(MIT_OCW_PDF_URL, { headers: { "User-Agent": "SayNext open transcript random stress test" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for MIT OCW PDF`);
  const parser = new PDFParse({ data: Buffer.from(await response.arrayBuffer()) });
  try {
    const parsed = await parser.getText();
    return chunkWords(parsed.text, 90, 50).map((text, index) => ({
      source: `MIT OCW 18.085 lecture transcript ${index + 1}`,
      kind: "lecture",
      text,
    }));
  } finally {
    await parser.destroy();
  }
}

async function fetchWikinews(): Promise<TranscriptSnippet[]> {
  const list = JSON.parse(await fetchText(WIKINEWS_LIST_URL)) as { query?: { categorymembers?: Array<{ title: string }> } };
  const snippets: TranscriptSnippet[] = [];
  const titles = (list.query?.categorymembers ?? []).map((item) => item.title).slice(0, 14);

  for (const title of titles) {
    const url = `https://en.wikinews.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&origin=*&titles=${encodeURIComponent(title)}`;
    const data = JSON.parse(await fetchText(url)) as { query?: { pages?: Record<string, { extract?: string }> } };
    const extract = Object.values(data.query?.pages ?? {})[0]?.extract ?? "";
    for (const [index, text] of chunkWords(extract, 70, 2).entries()) {
      snippets.push({ source: `Wikinews ${title} chunk ${index + 1}`, kind: "news", text });
    }
  }

  return snippets;
}

async function fetchMovieSubtitles(): Promise<TranscriptSnippet[]> {
  const cues = parseSubtitleCues(await fetchText(TEARS_OF_STEEL_SRT_URL));
  return chunkCues(cues, 8, 50).map((text, index) => ({
    source: `Wikimedia Tears of Steel subtitles ${index + 1}`,
    kind: "movie_subtitle",
    text,
  }));
}

async function fetchPublicDomainDrama(): Promise<TranscriptSnippet[]> {
  const text = await fetchText(GUTENBERG_FIRST_FOLIO_URL);
  return chunkWords(text.replace(/\[[^\]]+\]/g, " "), 80, 55).map((chunk, index) => ({
    source: `Project Gutenberg Shakespeare First Folio ${index + 1}`,
    kind: "public_domain_drama",
    text: chunk,
  }));
}

function makeShortFormCases(): TranscriptSnippet[] {
  const texts = [
    "Quick note on technical interviews: a clear trade-off answer usually beats a fancy answer. Say what you would try first, what might break, and how you would measure it.",
    "If a meeting is going nowhere, the useful move is to ask what decision we need today. It sounds simple, but it saves everyone from looping.",
    "For cloud apps, serverless is nice when traffic is spiky, but you still have to think about cold starts, retries, idempotency, and cost visibility.",
    "For a presentation, do not memorize every word. Keep the structure in your head: problem, why it matters, what you built, result, and limitation.",
    "Daily life hack: do the smallest version first. If the task feels too big, make the first step so easy that it feels almost stupid.",
    "A common ML mistake is treating accuracy as the whole story. If the data is imbalanced, precision, recall, calibration, and error cases matter more.",
  ];
  return texts.map((text, index) => ({ source: `public short-form transcript ${index + 1}`, kind: "short_form", text }));
}

async function loadSource(name: string, loader: () => Promise<TranscriptSnippet[]>, warnings: string[]): Promise<TranscriptSnippet[]> {
  try {
    const snippets = await loader();
    if (snippets.length === 0) warnings.push(`${name}: no snippets loaded`);
    return snippets;
  } catch (error) {
    warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function buildStressCases(snippets: TranscriptSnippet[], count: number, rng: () => number): StressCase[] {
  const shuffled = shuffleSeeded(snippets, rng);
  const cases: StressCase[] = [];

  for (let index = 0; index < shuffled.length && cases.length < count; index += 1) {
    const base = shuffled[index];
    const useMixed = rng() < 0.32 && shuffled.length > 3;
    const selected = useMixed
      ? [base, shuffled[Math.floor(rng() * shuffled.length)], shuffled[Math.floor(rng() * shuffled.length)]]
      : [base];
    const sourceKinds = [...new Set(selected.map((item) => item.kind))];
    const source = selected.map((item) => item.source).join(" + ");
    const transcript = selected.map((item, selectedIndex) => {
      const prefix = useMixed ? `[segment ${selectedIndex + 1}] ` : "";
      return `${prefix}${item.text}`;
    }).join("\n");
    const injectedNoise = rng() < 0.28;
    cases.push({
      id: `open-random-${cases.length + 1}`,
      source,
      sourceKinds: useMixed ? [...sourceKinds, "mixed"] : sourceKinds,
      transcript: injectedNoise ? injectAsrNoise(transcript, rng) : transcript,
      injectedNoise,
    });
  }

  return cases;
}

function isPersonalOrProjectRef(ref: string): boolean {
  const normalized = ref.toLowerCase();
  return normalized.startsWith("xiang-")
    || normalized.startsWith("doc:resume")
    || normalized.startsWith("doc:saynext")
    || normalized.startsWith("doc:elderalbum")
    || normalized.startsWith("doc:joblens")
    || normalized.startsWith("doc:dalparkaid")
    || normalized.includes("family")
    || normalized.includes("identity");
}

function runFastChecks(testCase: StressCase): FastCheckResult {
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, testCase.transcript, 5);
  const memoryRefs = results.map((result) => result.sourceRef || `id:${result.id}`);
  const flags: string[] = [];
  const personalRefs = memoryRefs.filter(isPersonalOrProjectRef);
  const looksLikeDirectXiangQuestion = /\b(your|you|yourself|xiang)\b/i.test(testCase.transcript)
    && /\b(school|project|family|game|food|course|job|interview|experience|car|drive)\b/i.test(testCase.transcript);

  if (personalRefs.length > 0 && !looksLikeDirectXiangQuestion) {
    flags.push(`fast_public_transcript_retrieved_personal_memory:${personalRefs.slice(0, 3).join("|")}`);
  }

  return {
    caseId: testCase.id,
    source: testCase.source,
    sourceKinds: testCase.sourceKinds,
    memoryRefs,
    flags,
  };
}

function candidateProcessFlags(item: ExtractedSessionMemoryCandidate, sourceKinds: SourceKind[]): string[] {
  const flags: string[] = [];
  const candidate = item.candidate;
  const validation = item.validation;
  const publicSource = sourceKinds.some((kind) => kind !== "short_form");
  const personalTypes = new Set(["personal_fact", "preference", "speaking_style", "project_detail", "correction"]);
  const nonCorePublicKinds = new Set<SourceKind>(["daily_dialogue", "ielts", "news", "movie_subtitle", "public_domain_drama"]);

  if (publicSource && personalTypes.has(candidate.candidateType) && item.status === "pending") {
    flags.push(`llm_public_source_pending_personal_candidate:${candidate.candidateType}`);
  }

  if (validation.safeToPromote && candidate.candidateType !== "knowledge_fact") {
    flags.push(`llm_safe_to_promote_non_knowledge:${candidate.candidateType}`);
  }

  if (candidate.candidateType === "event_summary" && validation.safeToPromote) {
    flags.push("llm_event_summary_safe_to_promote");
  }

  if (candidate.candidateType === "knowledge_fact"
    && item.status === "pending"
    && sourceKinds.every((kind) => kind === "mixed" || nonCorePublicKinds.has(kind))
    && !validation.flags.includes("outside_core_memory_domain_review_only")) {
    flags.push("llm_generic_public_source_knowledge_not_review_flagged");
  }

  if (/\b(today|tomorrow|yesterday|recently|currently|this week|next week)\b/i.test(candidate.content)
    && !validation.flags.includes("ambiguous_time_in_content")
    && validation.dateMetadata.dateSource === "session_time_only") {
    flags.push("llm_unstable_time_not_flagged");
  }

  if (/\bxiang\b/i.test(candidate.content)
    && item.status !== "rejected"
    && sourceKinds.some((kind) => ["news", "lecture", "movie_subtitle", "public_domain_drama"].includes(kind))) {
    flags.push("llm_public_source_mentions_xiang_in_candidate");
  }

  return flags;
}

async function runLlmCheck(testCase: StressCase, index: number): Promise<LlmCheckResult> {
  try {
    const sessionStart = new Date(Date.UTC(2026, 4, 17, 12, index, 0)).toISOString();
    const output = await extractSessionMemoryCandidatesFromText({
      userId,
      sessionId: `open-transcript-stress-${seed}-${index}`,
      sessionStartTimestamp: sessionStart,
      sessionLastTimestamp: new Date(Date.parse(sessionStart) + 12 * 60 * 1000).toISOString(),
      transcriptText: provider === "openai" ? testCase.transcript : testCase.transcript.slice(0, 9000),
      aiOutputText: "",
      limitCandidates: 5,
      provider,
    });
    const flags = output.candidates.flatMap((candidate) => candidateProcessFlags(candidate, testCase.sourceKinds));
    return {
      caseId: testCase.id,
      source: testCase.source,
      sourceKinds: testCase.sourceKinds,
      transcript: testCase.transcript,
      output,
      flags,
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      source: testCase.source,
      sourceKinds: testCase.sourceKinds,
      transcript: testCase.transcript,
      flags: ["llm_check_error"],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function truncate(text: string, length = 320): string {
  const cleaned = compact(text);
  return cleaned.length > length ? `${cleaned.slice(0, length)}...` : cleaned;
}

function formatCandidate(candidate: ExtractedSessionMemoryCandidate): string {
  const flags = candidate.validation.flags.length ? candidate.validation.flags.join(", ") : "none";
  return [
    `- ${candidate.status.toUpperCase()} ${candidate.candidate.candidateType}: ${candidate.candidate.title}`,
    `  content: ${truncate(candidate.candidate.content, 260)}`,
    `  confidence/value/risk: ${candidate.candidate.confidence.toFixed(2)}/${candidate.candidate.valueScore.toFixed(2)}/${candidate.candidate.riskScore.toFixed(2)}`,
    `  validation: ${candidate.validation.valid ? "valid" : "invalid"}, safe=${candidate.validation.safeToPromote}, flags=${flags}`,
    `  date: ${candidate.validation.dateMetadata.mentionedDate || "null"} (${candidate.validation.dateMetadata.dateSource}, ${candidate.validation.dateMetadata.dateConfidence.toFixed(2)})`,
  ].join("\n");
}

function buildReport(input: {
  snippets: TranscriptSnippet[];
  cases: StressCase[];
  fastChecks: FastCheckResult[];
  llmChecks: LlmCheckResult[];
  warnings: string[];
}): string {
  const byKind = new Map<string, number>();
  for (const snippet of input.snippets) byKind.set(snippet.kind, (byKind.get(snippet.kind) ?? 0) + 1);
  const fastFlags = input.fastChecks.flatMap((result) => result.flags);
  const llmFlags = input.llmChecks.flatMap((result) => result.flags);
  const llmCandidateCount = input.llmChecks.reduce((sum, result) => sum + (result.output?.candidates.length ?? 0), 0);
  const pendingPersonal = input.llmChecks.flatMap((result) => result.output?.candidates ?? [])
    .filter((candidate) => candidate.status === "pending" && ["personal_fact", "preference", "speaking_style", "project_detail"].includes(candidate.candidate.candidateType));

  const lines = [
    "# Open Transcript Session Memory Random Stress",
    "",
    `- userId: ${userId}`,
    `- seed: ${seed}`,
    `- requested cases: ${targetCases}`,
    `- generated cases: ${input.cases.length}`,
    `- LLM provider: ${provider}`,
    `- LLM extraction cases: ${input.llmChecks.length}`,
    `- loaded snippets: ${input.snippets.length}`,
    `- LLM candidates: ${llmCandidateCount}`,
    `- fast flags: ${fastFlags.length}`,
    `- LLM process flags: ${llmFlags.length}`,
    `- pending personal/project/style candidates from public transcripts: ${pendingPersonal.length}`,
    "",
    "## Sources Loaded",
    "",
    ...[...byKind.entries()].sort().map(([kind, count]) => `- ${kind}: ${count}`),
    "",
  ];

  if (input.warnings.length) {
    lines.push("## Source Warnings", "", ...input.warnings.map((warning) => `- ${warning}`), "");
  }

  lines.push("## Fast Process Flags", "");
  if (input.fastChecks.some((result) => result.flags.length)) {
    for (const result of input.fastChecks.filter((item) => item.flags.length).slice(0, 40)) {
      lines.push(
        `### ${result.caseId}`,
        "",
        `- source: ${result.source}`,
        `- kinds: ${result.sourceKinds.join(", ")}`,
        `- flags: ${result.flags.join(", ")}`,
        `- top memory refs: ${result.memoryRefs.slice(0, 5).join(" | ") || "none"}`,
        "",
      );
    }
  } else {
    lines.push("No fast process flags.", "");
  }

  lines.push("## LLM Extraction Checks", "");
  for (const result of input.llmChecks) {
    lines.push(
      `### ${result.caseId}`,
      "",
      `- source: ${result.source}`,
      `- kinds: ${result.sourceKinds.join(", ")}`,
      `- flags: ${result.flags.join(", ") || "none"}`,
      `- transcript: ${truncate(result.transcript, 420)}`,
      "",
    );
    if (result.error) {
      lines.push(`error: ${result.error}`, "");
      continue;
    }
    if (!result.output?.candidates.length) {
      lines.push("No candidates.", "");
      continue;
    }
    lines.push(...result.output.candidates.map(formatCandidate), "");
  }

  return `${lines.join("\n")}\n`;
}

const warnings: string[] = [];
const snippets = [
  ...await loadSource("XDailyDialog/DailyDialog", fetchDailyDialog, warnings),
  ...await loadSource("AMI meeting corpus", fetchAmiMeeting, warnings),
  ...await loadSource("IELTS speaking dataset", fetchIelts, warnings),
  ...await loadSource("MIT OCW lecture transcript", fetchMitLecture, warnings),
  ...await loadSource("Wikinews", fetchWikinews, warnings),
  ...await loadSource("Wikimedia movie subtitles", fetchMovieSubtitles, warnings),
  ...await loadSource("Project Gutenberg public domain drama", fetchPublicDomainDrama, warnings),
  ...makeShortFormCases(),
].filter((snippet) => wordCount(snippet.text) >= 8);

const rng = mulberry32(hashSeed(seed));
const cases = buildStressCases(snippets, targetCases, rng);
const fastChecks = cases.map(runFastChecks);
const llmSelection = skipLlm ? [] : shuffleSeeded(cases, rng).slice(0, Math.min(extractCases, cases.length));
const llmChecks: LlmCheckResult[] = [];

for (const [index, testCase] of llmSelection.entries()) {
  console.log(`[open-transcript-stress] LLM ${index + 1}/${llmSelection.length}: ${testCase.id} ${testCase.sourceKinds.join("+")}`);
  llmChecks.push(await runLlmCheck(testCase, index));
}

mkdirSync(outputDir, { recursive: true });
const report = buildReport({ snippets, cases, fastChecks, llmChecks, warnings });
const mdPath = join(outputDir, `session-memory-open-transcript-stress-${now}.md`);
const jsonPath = join(outputDir, `session-memory-open-transcript-stress-${now}.json`);
writeFileSync(mdPath, report);
writeFileSync(jsonPath, JSON.stringify({
  userId,
  seed,
  provider,
  targetCases,
  extractCases: llmSelection.length,
  warnings,
  snippetsLoaded: snippets.length,
  cases,
  fastChecks,
  llmChecks,
}, null, 2));

const fastFlagCount = fastChecks.reduce((sum, result) => sum + result.flags.length, 0);
const llmFlagCount = llmChecks.reduce((sum, result) => sum + result.flags.length, 0);
console.log(`OPEN_TRANSCRIPT_SESSION_MEMORY_STRESS provider=${provider} cases=${cases.length} llm=${llmChecks.length} fastFlags=${fastFlagCount} llmFlags=${llmFlagCount}`);
console.log(`Report: ${mdPath}`);

if (llmFlagCount > 0) process.exitCode = 1;
