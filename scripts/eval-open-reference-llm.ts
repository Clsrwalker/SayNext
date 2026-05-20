import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation, type OutputLanguage } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";

type OpenReferenceCase = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  transcriptCode?: string;
  transcriptTitle?: string;
  license: string;
  licenseUrl?: string;
  importedAt: string;
  scene: SceneKey;
  kind: string;
  stressTags: string[];
  history: string[];
  latest: string;
  expectedBehavior: string;
  canUseForPersonalMemory: false;
  expectNoPersonalMemory: true;
  allowProjectMention: false;
  maxWords: number;
  language?: OutputLanguage;
};

type EvalResult = {
  test: OpenReferenceCase;
  output: string;
  flags: string[];
  verdict: "good" | "watch" | "bad";
  memoryRefs: string[];
  analysis: string;
};

const rawArgs = process.argv.slice(2);
const userId = rawArgs.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const casesPath = valueAfter("--cases") || join("data", "reference", "open-sources", "latest-cases.jsonl");
const requestedLimit = Number(valueAfter("--limit") || 24);
const outputDir = join("data", "eval");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

function valueAfter(name: string): string | undefined {
  const prefix = `${name}=`;
  const matched = rawArgs.find((arg) => arg.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : undefined;
}

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const normalized = compact(text);
  return normalized ? normalized.split(/\s+/).length : 0;
}

function includesAny(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function readCases(): OpenReferenceCase[] {
  const content = readFileSync(casesPath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OpenReferenceCase)
    .slice(0, requestedLimit);
}

function sceneToEventScene(scene: SceneKey): string {
  if (scene === "Daily Chat") return "daily_chat";
  if (scene === "Classroom") return "classroom";
  if (scene === "Interview") return "interview";
  return "group_discussion";
}

function formatSceneProfile(scene: SceneKey): string {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === scene);
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${scene}`;
}

function getMemoryRefs(query: string): string[] {
  const context = conversationLogger.getRelevantPersonalMemoryContext(userId, query, 4);
  return [...context.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]).filter(Boolean);
}

function makeEventMemory(test: OpenReferenceCase, transcripts: string[]): EventMemorySnapshot {
  return {
    eventId: `open-ref-${test.id}`,
    scene: sceneToEventScene(test.scene),
    title: compact(test.latest).slice(0, 90),
    summary: [
      `Open-source reference evaluation case.`,
      `source=${test.sourceId}.`,
      `transcript=${test.transcriptCode || "unknown"}.`,
      test.expectedBehavior,
    ].join(" "),
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function outputFlags(test: OpenReferenceCase, output: string, memoryRefs: string[]): string[] {
  const flags: string[] = [];
  const termsThatShouldNotLeak = [
    "xiang", "saynext", "say next", "dalhousie", "chengdu", "macs",
    "joblens", "elderalbum", "elder album", "dalparkaid", "dal parking",
    "my father", "my mother", "my sister", "my family", "my honda", "civic hatchback",
    "permanent residency", "fatty liver", "uric acid",
  ];
  const projectTechTerms = ["lambda", "dynamodb", "firebase", "react native", "ollama", "mentra", "prenote", "teleprompt"];

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|you could say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("label_or_meta_prefix");
  if (/^\s*[A-Z][A-Z_ .'-]{0,30}\s*:/i.test(output)) flags.push("speaker_label_prefix");
  if (/[\uFFFD\u9225\u9227\u650A\u6501\u6A9A\u6A9B\u6A99\u6A9D\u6A87\u6A92\u95B3\u4FBD]/.test(output)) flags.push("mojibake_output");
  if (/\b(as an ai|the assistant should|this transcript|the speaker is saying|a good response would be)\b/i.test(output)) {
    flags.push("meta_instruction_in_output");
  }
  if (/\b(useful takeaway is to keep the design simpler|reduce the extra friction for users|that point makes sense)\b/i.test(output)
    && !/\b(design|prototype|user|interface|friction|feature)\b/i.test(test.latest)) {
    flags.push("generic_public_leak_fallback");
  }
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (includesAny(output, termsThatShouldNotLeak)) flags.push("personal_or_project_leak_in_output");
  if (!test.allowProjectMention && includesAny(output, projectTechTerms)) flags.push("unwanted_xiang_tech_stack_in_output");

  const personalRefs = memoryRefs.filter((ref) => /^(xiang-|doc:saynext|doc:elderalbum|doc:joblens|doc:dalparkaid|doc:resume)/i.test(ref));
  if (personalRefs.length) flags.push(`process_personal_memory_retrieved:${personalRefs.slice(0, 4).join("|")}`);

  if (test.scene === "Classroom") {
    if (/^(yeah|yes|right|okay|sounds good)[,.! ]*$/i.test(compact(output))) flags.push("classroom_too_empty");
    if (/\b(that's crazy|lol|haha)\b/i.test(output)) flags.push("classroom_too_casual");
  }

  if (test.scene === "Meeting / Group Discussion") {
    if (/^(yeah|okay|sounds good|i agree)[,.! ]*$/i.test(compact(output))) flags.push("meeting_too_empty");
    if (/\b(i already fixed|i finished|i just implemented)\b/i.test(output) && !/\b(update|progress)\b/i.test(test.latest)) {
      flags.push("meeting_claimed_completed_work");
    }
  }

  if (test.scene === "Daily Chat" && wordCount(output) > 38 && !/[?]$/.test(compact(output))) {
    flags.push("daily_too_monologue_like");
  }

  return flags;
}

function verdictFromFlags(flags: string[]): "good" | "watch" | "bad" {
  if (flags.some((flag) => [
    "empty_output",
    "label_or_meta_prefix",
    "speaker_label_prefix",
    "mojibake_output",
    "meta_instruction_in_output",
    "personal_or_project_leak_in_output",
    "unwanted_xiang_tech_stack_in_output",
    "classroom_too_empty",
    "meeting_too_empty",
    "meeting_claimed_completed_work",
    "generic_public_leak_fallback",
  ].some((bad) => flag.startsWith(bad)))) {
    return "bad";
  }
  return flags.length ? "watch" : "good";
}

function analyze(test: OpenReferenceCase, flags: string[], memoryRefs: string[]): string {
  const notes: string[] = [];
  notes.push(flags.length ? `Needs review: ${flags.join(", ")}.` : "Looks usable.");
  notes.push(`Source ${test.sourceId}/${test.transcriptCode || "unknown"} is third-party reference data, so output must not become Xiang personal memory.`);
  if (memoryRefs.length) notes.push(`Memory refs: ${memoryRefs.slice(0, 4).join(" | ")}.`);
  return notes.join(" ");
}

async function runCase(test: OpenReferenceCase): Promise<EvalResult> {
  const timestampMs = Date.now();
  const transcripts = [...test.history, test.latest].map(compact).filter(Boolean);
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: timestampMs - (transcripts.length - index) * 1000,
  }));
  const memoryQuery = transcripts.slice(-4).join("\n");
  const relevantPersonalMemoryContext = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 4);
  const memoryRefs = getMemoryRefs(memoryQuery);
  const response = await processConversation(
    conversation,
    "high",
    makeEventMemory(test, transcripts),
    test.language || "english",
    "",
    formatSceneProfile(test.scene),
    relevantPersonalMemoryContext,
  );

  const output = response.type === "insight" ? response.output : "";
  const flags = outputFlags(test, output, memoryRefs);
  const verdict = verdictFromFlags(flags);
  return {
    test,
    output,
    flags,
    verdict,
    memoryRefs,
    analysis: analyze(test, flags, memoryRefs),
  };
}

function renderReport(results: EvalResult[]): string {
  const good = results.filter((result) => result.verdict === "good").length;
  const watch = results.filter((result) => result.verdict === "watch").length;
  const bad = results.filter((result) => result.verdict === "bad").length;
  const lines: string[] = [];
  const groups = new Map<string, EvalResult[]>();
  for (const result of results) {
    const key = `${result.test.sourceId}/${result.test.scene}`;
    groups.set(key, [...(groups.get(key) || []), result]);
  }

  lines.push("# Open Reference LLM Output Regression");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Provider: ${process.env.LLM_PROVIDER || "openai"}`);
  lines.push(`Model: ${(process.env.LLM_PROVIDER || "openai").toLowerCase() === "ollama" ? process.env.OLLAMA_MODEL : "gpt-4.1-mini"}`);
  lines.push(`Cases path: ${casesPath}`);
  lines.push(`Cases: ${results.length}`);
  lines.push(`Good/watch/bad: ${good}/${watch}/${bad}`);
  lines.push("");
  lines.push("## Groups");
  for (const [group, items] of groups) {
    const counts = {
      good: items.filter((item) => item.verdict === "good").length,
      watch: items.filter((item) => item.verdict === "watch").length,
      bad: items.filter((item) => item.verdict === "bad").length,
    };
    lines.push(`- ${group}: good/watch/bad ${counts.good}/${counts.watch}/${counts.bad}`);
  }

  const review = results.filter((result) => result.verdict !== "good");
  if (review.length) {
    lines.push("");
    lines.push("## Review Needed");
    for (const result of review) {
      lines.push("");
      lines.push(`### ${result.verdict.toUpperCase()} ${result.test.id}`);
      lines.push(`Source: ${result.test.sourceName} ${result.test.transcriptCode || ""}`);
      lines.push(`Scene: ${result.test.scene}`);
      lines.push(`Latest: ${result.test.latest}`);
      lines.push(`Output: ${result.output}`);
      lines.push(`Flags: ${result.flags.join(", ")}`);
      lines.push(`Analysis: ${result.analysis}`);
    }
  }

  lines.push("");
  lines.push("## All Cases");
  for (const result of results) {
    lines.push("");
    lines.push(`### ${result.verdict.toUpperCase()} ${result.test.id}`);
    lines.push(`Scene: ${result.test.scene}`);
    lines.push(`Kind: ${result.test.kind}`);
    lines.push(`Tags: ${result.test.stressTags.join(", ")}`);
    lines.push(`Latest: ${result.test.latest}`);
    lines.push(`Output: ${result.output}`);
    lines.push(`Flags: ${result.flags.length ? result.flags.join(", ") : "none"}`);
    if (result.memoryRefs.length) lines.push(`Memory refs: ${result.memoryRefs.slice(0, 6).join(" | ")}`);
  }

  return lines.join("\n");
}

mkdirSync(outputDir, { recursive: true });

const cases = readCases();
const results: EvalResult[] = [];

for (const test of cases) {
  console.log(`Running ${results.length + 1}/${cases.length}: ${test.id}`);
  try {
    results.push(await runCase(test));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      test,
      output: "",
      flags: [`exception:${message}`],
      verdict: "bad",
      memoryRefs: [],
      analysis: `Exception while running case: ${message}`,
    });
  }
}

const report = renderReport(results);
const mdPath = join(outputDir, `open-reference-llm-${timestamp}.md`);
const jsonlPath = join(outputDir, `open-reference-llm-${timestamp}.jsonl`);
const metaPath = join(outputDir, `open-reference-llm-${timestamp}.meta.json`);

writeFileSync(mdPath, report, "utf8");
writeFileSync(jsonlPath, results.map((result) => JSON.stringify(result)).join("\n"), "utf8");
writeFileSync(metaPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  casesPath,
  provider: process.env.LLM_PROVIDER || "openai",
  model: (process.env.LLM_PROVIDER || "openai").toLowerCase() === "ollama" ? process.env.OLLAMA_MODEL : "gpt-4.1-mini",
  cases: results.length,
  good: results.filter((result) => result.verdict === "good").length,
  watch: results.filter((result) => result.verdict === "watch").length,
  bad: results.filter((result) => result.verdict === "bad").length,
}, null, 2), "utf8");

const good = results.filter((result) => result.verdict === "good").length;
const watch = results.filter((result) => result.verdict === "watch").length;
const bad = results.filter((result) => result.verdict === "bad").length;
console.log(`Open reference LLM regression complete. good/watch/bad=${good}/${watch}/${bad}`);
console.log(`Report: ${mdPath}`);

if (bad > 0) {
  console.log("Bad cases:");
  for (const result of results.filter((item) => item.verdict === "bad").slice(0, 10)) {
    console.log(`- ${result.test.id}: ${result.flags.join(", ")}`);
    console.log(`  output: ${result.output}`);
  }
  process.exitCode = 1;
}
