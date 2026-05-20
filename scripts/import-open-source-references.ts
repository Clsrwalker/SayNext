import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";

type Manifest = {
  version: number;
  updatedAt: string;
  policy: Record<string, string>;
  sources: OpenSourceManifestSource[];
};

type OpenSourceManifestSource = {
  id: string;
  name: string;
  homepageUrl: string;
  sourceType: string;
  status: "enabled" | "access_check" | "disabled";
  license: string;
  licenseUrl?: string;
  requiresAttribution: boolean;
  canUseForEval: boolean;
  canStoreRawTranscript: boolean;
  canStoreGeneratedCases: boolean;
  canUseForPersonalMemory: boolean;
  allowedUse?: string[];
  notAllowedUse?: string[];
  intendedCoverage?: string[];
  fetch?: {
    kind: "ucsb_sbc_trn";
    baseTranscriptUrl: string;
    maxCasesPerTranscript?: number;
    defaultMaxTranscripts?: number;
  };
  selection?: Array<{
    code: string;
    title: string;
    scene: SceneKey;
    kind: string;
    stressTags: string[];
  }>;
};

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
};

type RawUnit = {
  speaker: string;
  text: string;
};

type Turn = {
  speaker: string;
  text: string;
};

const rawArgs = process.argv.slice(2);
const sourceArg = valueAfter("--source") || "all";
const requestedLimit = Number(valueAfter("--limit") || 48);
const maxTranscriptsArg = valueAfter("--max-transcripts");
const outputRoot = join("data", "reference", "open-sources");
const generatedDir = join(outputRoot, "generated");
const manifestPath = join(outputRoot, "manifest.json");
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
  if (!normalized) return 0;
  return normalized.split(/\s+/).length;
}

function slugify(text: string): string {
  return compact(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SayNext local open-source reference importer",
      "Accept": "text/plain,text/html,application/json,*/*",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function cleanSbcText(text: string): string {
  return compact(text
    .replace(/\[[0-9]*|\]/g, " ")
    .replace(/\((?:H|Hx|THROAT|TSK|SWALLOW|LAUGH|COUGH)[^)]*\)/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[~!%@=+_*]+/g, "")
    .replace(/\bX{1,6}\b/g, " ")
    .replace(/\b(?:YWN|PAR|SM|HI|P|F|SING)\b/g, " ")
    .replace(/\s+([,.?!])/g, "$1"));
}

function parseSbcTrn(text: string): RawUnit[] {
  const units: RawUnit[] = [];
  let currentSpeaker = "Speaker";

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+(?:(?<speaker>[A-Za-z][A-Za-z _.-]{1,30}):)?\s*(?<text>.*)$/);
    if (!match?.groups?.text) continue;
    const speaker = compact(match.groups.speaker || "");
    if (speaker) currentSpeaker = speaker.toUpperCase().replace(/\s+/g, "_");
    const cleaned = cleanSbcText(match.groups.text);
    if (cleaned && cleaned.length >= 2) units.push({ speaker: currentSpeaker, text: cleaned });
  }

  return units;
}

function aggregateTurns(units: RawUnit[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | undefined;

  const flush = () => {
    if (!current) return;
    const text = compact(current.text);
    if (wordCount(text) >= 3) turns.push({ speaker: current.speaker, text });
    current = undefined;
  };

  for (const unit of units) {
    if (!current || current.speaker !== unit.speaker || wordCount(current.text) >= 32) {
      flush();
      current = { speaker: unit.speaker, text: unit.text };
    } else {
      current.text = `${current.text} ${unit.text}`;
    }
  }
  flush();

  return turns.filter((turn) => {
    const words = wordCount(turn.text);
    return words >= 4 && words <= 55 && !/^\W*$/.test(turn.text);
  });
}

function sceneMaxWords(scene: SceneKey): number {
  if (scene === "Daily Chat") return 45;
  if (scene === "Classroom") return 75;
  if (scene === "Interview") return 90;
  return 70;
}

function expectedBehavior(scene: SceneKey, kind: string): string {
  if (scene === "Classroom") {
    return `Give a short classroom-style answer or useful supplement for this third-party ${kind} transcript. Do not pretend the transcript is Xiang's personal experience.`;
  }
  if (scene === "Meeting / Group Discussion") {
    return `Give one practical meeting-style sentence that moves the third-party ${kind} discussion forward. Do not inject Xiang personal/project memory.`;
  }
  if (scene === "Interview") {
    return `Answer in a grounded interview style only if Xiang is directly addressed; otherwise respond neutrally. Do not invent personal facts.`;
  }
  return `Give a short, natural continuation for this third-party ${kind} transcript. Do not inject Xiang personal/project memory.`;
}

function buildCasesFromTurns(source: OpenSourceManifestSource, selection: NonNullable<OpenSourceManifestSource["selection"]>[number], turns: Turn[], importedAt: string): OpenReferenceCase[] {
  const cases: OpenReferenceCase[] = [];
  const maxCases = source.fetch?.maxCasesPerTranscript ?? 4;
  const usableIndices = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn, index }) => {
      if (index < 2) return false;
      const words = wordCount(turn.text);
      if (words < 5 || words > 42) return false;
      return /[A-Za-z]/.test(turn.text);
    });

  const stride = Math.max(1, Math.floor(usableIndices.length / Math.max(1, maxCases)));
  for (let cursor = 0; cursor < usableIndices.length && cases.length < maxCases; cursor += stride) {
    const { index } = usableIndices[cursor];
    const history = turns.slice(Math.max(0, index - 3), index).map((turn) => `${turn.speaker}: ${turn.text}`);
    const latest = `${turns[index].speaker}: ${turns[index].text}`;
    if (history.length < 2 || compact(latest).length < 25) continue;

    cases.push({
      id: `${source.id}-${selection.code.toLowerCase()}-${String(cases.length + 1).padStart(2, "0")}-${slugify(turns[index].text)}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: `${source.fetch?.baseTranscriptUrl}/${selection.code}.trn`,
      transcriptCode: selection.code,
      transcriptTitle: selection.title,
      license: source.license,
      licenseUrl: source.licenseUrl,
      importedAt,
      scene: selection.scene,
      kind: selection.kind,
      stressTags: selection.stressTags,
      history,
      latest,
      expectedBehavior: expectedBehavior(selection.scene, selection.kind),
      canUseForPersonalMemory: false,
      expectNoPersonalMemory: true,
      allowProjectMention: false,
      maxWords: sceneMaxWords(selection.scene),
    });
  }

  return cases;
}

async function importUcsbSbc(source: OpenSourceManifestSource, importedAt: string): Promise<OpenReferenceCase[]> {
  if (!source.fetch || source.fetch.kind !== "ucsb_sbc_trn") return [];
  const selections = (source.selection || []).slice(0, Number(maxTranscriptsArg || source.fetch.defaultMaxTranscripts || 12));
  const cases: OpenReferenceCase[] = [];

  for (const selection of selections) {
    const transcriptUrl = `${source.fetch.baseTranscriptUrl}/${selection.code}.trn`;
    console.log(`Fetching ${source.id} ${selection.code}: ${selection.title}`);
    const transcript = await fetchText(transcriptUrl);
    const turns = aggregateTurns(parseSbcTrn(transcript));
    const generated = buildCasesFromTurns(source, selection, turns, importedAt);
    cases.push(...generated);
    console.log(`  turns=${turns.length}, cases=${generated.length}`);
    if (cases.length >= requestedLimit) break;
  }

  return cases.slice(0, requestedLimit);
}

async function importSource(source: OpenSourceManifestSource, importedAt: string): Promise<OpenReferenceCase[]> {
  if (source.status !== "enabled") {
    console.log(`Skipping ${source.id}: status=${source.status}`);
    return [];
  }
  if (!source.canUseForEval || !source.canStoreGeneratedCases) {
    console.log(`Skipping ${source.id}: eval/storage policy does not allow generated cases yet`);
    return [];
  }
  if (source.canUseForPersonalMemory) {
    throw new Error(`Manifest safety violation: ${source.id} canUseForPersonalMemory must be false for public sources.`);
  }

  if (source.fetch?.kind === "ucsb_sbc_trn") return importUcsbSbc(source, importedAt);
  console.log(`Skipping ${source.id}: no importer for fetch kind ${source.fetch?.kind || "none"}`);
  return [];
}

function renderMarkdown(cases: OpenReferenceCase[], manifest: Manifest): string {
  const lines: string[] = [];
  const groups = new Map<string, OpenReferenceCase[]>();
  for (const item of cases) {
    const key = `${item.sourceId}/${item.scene}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }

  lines.push("# Open Source Reference Import");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Manifest version: ${manifest.version}`);
  lines.push(`Cases: ${cases.length}`);
  lines.push("");
  lines.push("## Policy");
  for (const [key, value] of Object.entries(manifest.policy)) lines.push(`- ${key}: ${value}`);
  lines.push("");
  lines.push("## Groups");
  for (const [key, items] of groups) lines.push(`- ${key}: ${items.length}`);
  lines.push("");
  lines.push("## Cases");

  for (const item of cases) {
    lines.push("");
    lines.push(`### ${item.id}`);
    lines.push(`Source: ${item.sourceName} (${item.transcriptCode || item.sourceId})`);
    lines.push(`Scene: ${item.scene}`);
    lines.push(`Kind: ${item.kind}`);
    lines.push(`Tags: ${item.stressTags.join(", ")}`);
    lines.push(`Policy: personalMemory=${item.canUseForPersonalMemory}, expectNoPersonalMemory=${item.expectNoPersonalMemory}`);
    lines.push(`Latest: ${item.latest}`);
    lines.push(`History: ${item.history.join(" / ")}`);
  }

  return lines.join("\n");
}

mkdirSync(generatedDir, { recursive: true });

const manifest = readManifest();
const importedAt = new Date().toISOString();
const selectedSources = manifest.sources.filter((source) => sourceArg === "all" || source.id === sourceArg);
const allCases: OpenReferenceCase[] = [];

for (const source of selectedSources) {
  const remaining = Math.max(0, requestedLimit - allCases.length);
  if (remaining === 0) break;
  const imported = await importSource(source, importedAt);
  allCases.push(...imported.slice(0, remaining));
}

const jsonl = allCases.map((item) => JSON.stringify(item)).join("\n");
const outputBase = `open-reference-cases-${timestamp}`;
const jsonlPath = join(generatedDir, `${outputBase}.jsonl`);
const mdPath = join(generatedDir, `${outputBase}.md`);
const metaPath = join(generatedDir, `${outputBase}.meta.json`);
const latestJsonlPath = join(outputRoot, "latest-cases.jsonl");
const latestMetaPath = join(outputRoot, "latest-meta.json");

const meta = {
  generatedAt: importedAt,
  manifestVersion: manifest.version,
  requestedSource: sourceArg,
  requestedLimit,
  caseCount: allCases.length,
  sources: [...new Set(allCases.map((item) => item.sourceId))],
  scenes: allCases.reduce<Record<string, number>>((acc, item) => {
    acc[item.scene] = (acc[item.scene] || 0) + 1;
    return acc;
  }, {}),
};

writeFileSync(jsonlPath, jsonl, "utf8");
writeFileSync(mdPath, renderMarkdown(allCases, manifest), "utf8");
writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
writeFileSync(latestJsonlPath, jsonl, "utf8");
writeFileSync(latestMetaPath, JSON.stringify(meta, null, 2), "utf8");

console.log(`Open reference import complete. cases=${allCases.length}`);
console.log(`Cases: ${jsonlPath}`);
console.log(`Report: ${mdPath}`);
console.log(`Latest: ${latestJsonlPath}`);
