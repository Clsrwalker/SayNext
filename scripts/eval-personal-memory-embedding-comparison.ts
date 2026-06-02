import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger, type PersonalMemoryRecord } from "../src/server/data/conversation-logger";

type EvalCase = {
  group: string;
  q: string;
  expected: string[];
};

type EmbeddingRun = {
  name: "openai" | "local";
  top1: number;
  top3: number;
  byGroup: Map<string, { total: number; top1: number; top3: number }>;
  failures: Array<{
    index: number;
    group: string;
    query: string;
    expected: string[];
    top: Array<{ sourceRef: string; title: string; score: number }>;
  }>;
};

const userId = process.argv.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) || 1000);
const outDir = "data/eval";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const SEARCH_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "what", "how", "why", "who", "when", "where",
  "you", "your", "yours", "me", "my", "mine", "i", "im", "am", "are", "is", "was", "were",
  "do", "does", "did", "doing", "can", "could", "would", "should", "will", "tell", "about",
  "one", "some", "any", "a", "an", "to", "of", "in", "on", "at", "by", "from", "as", "or",
  "it", "its", "be", "been", "being", "have", "has", "had", "usually", "really", "like",
  "enjoy", "normally", "often", "favourite", "favorite", "popular",
]);

function tokenizeSearchText(text: string): string[] {
  const baseTokens = String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token))
    ?? [];
  const expandedTokens = [...baseTokens];

  for (const token of baseTokens) {
    if (!/[\p{Script=Han}]/u.test(token) || token.length <= 2) continue;
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= token.length - size; index += 1) {
        expandedTokens.push(token.slice(index, index + size));
      }
    }
  }

  return Array.from(new Set(expandedTokens));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function localHybridEmbedding(text: string, dimensions = 256): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenizeSearchText(text);
  const features: string[] = [...tokens];

  for (const token of tokens) {
    if (token.length <= 3) continue;
    for (let index = 0; index <= token.length - 3; index += 1) {
      features.push(token.slice(index, index + 3));
    }
  }

  for (const feature of features) {
    const hash = fnv1a(feature);
    const index = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
}

function normalizeVector(values: number[]): number[] {
  const finite = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const norm = Math.sqrt(finite.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? finite.map((value) => Number((value / norm).toFixed(8))) : finite;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) dot += a[index] * b[index];
  return dot;
}

function memorySearchText(memory: Pick<PersonalMemoryRecord, "title" | "category" | "content" | "usageRule" | "keywords">): string {
  return [
    memory.title,
    memory.category,
    memory.keywords.join(" "),
    memory.content,
    memory.usageRule,
  ].filter(Boolean).join("\n");
}

function loadCases(): EvalCase[] {
  const source = readFileSync(join(process.cwd(), "scripts", "eval-personal-memory.ts"), "utf8");
  const cases: EvalCase[] = [];
  const linePattern = /\{\s*group:\s*"([^"]+)",\s*q:\s*"([^"]+)",\s*expected:\s*\[([^\]]*)\]\s*\}/g;
  for (const match of source.matchAll(linePattern)) {
    const expected = [...match[3].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    cases.push({ group: match[1], q: match[2], expected });
  }
  return cases;
}

async function createOpenAiQueryEmbeddings(queries: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI embedding comparison");

  const embeddings: number[][] = [];
  const batchSize = 64;
  for (let index = 0; index < queries.length; index += batchSize) {
    const batch = queries.slice(index, index + batchSize);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.PERSONAL_MEMORY_EMBEDDING_MODEL || "text-embedding-3-small",
        input: batch,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embedding request failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    embeddings.push(
      ...[...(data.data ?? [])]
        .sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0))
        .map((item: any) => normalizeVector(Array.isArray(item.embedding) ? item.embedding : [])),
    );
  }

  if (embeddings.length !== queries.length) {
    throw new Error(`OpenAI embedding count mismatch: expected ${queries.length}, received ${embeddings.length}`);
  }
  return embeddings;
}

function makeRun(name: "openai" | "local"): EmbeddingRun {
  return { name, top1: 0, top3: 0, byGroup: new Map(), failures: [] };
}

function addGroupResult(run: EmbeddingRun, test: EvalCase, ok1: boolean, ok3: boolean): void {
  const stat = run.byGroup.get(test.group) ?? { total: 0, top1: 0, top3: 0 };
  stat.total += 1;
  if (ok1) stat.top1 += 1;
  if (ok3) stat.top3 += 1;
  run.byGroup.set(test.group, stat);
}

function renderGroupStats(run: EmbeddingRun): string[] {
  return [...run.byGroup.entries()].sort().map(([group, stat]) =>
    `- ${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}`
  );
}

async function main(): Promise<void> {
  const cases = loadCases();
  const memories = conversationLogger
    .listPersonalMemories(userId, { status: "active", limit })
    .filter((memory) => memory.embeddingProvider === "openai" && memory.embedding.length > 0);

  if (!cases.length) throw new Error("No eval cases parsed from scripts/eval-personal-memory.ts");
  if (!memories.length) throw new Error(`No OpenAI-embedded memories found for user ${userId}`);

  const openAiQueryEmbeddings = await createOpenAiQueryEmbeddings(cases.map((test) => test.q));
  const localQueryEmbeddings = cases.map((test) => localHybridEmbedding(test.q));
  const openAiMemoryVectors = memories.map((memory) => memory.embedding);
  const localMemoryVectors = memories.map((memory) => localHybridEmbedding(memorySearchText(memory)));

  const runs = [makeRun("openai"), makeRun("local")];

  for (const [caseIndex, test] of cases.entries()) {
    for (const run of runs) {
      const queryVector = run.name === "openai" ? openAiQueryEmbeddings[caseIndex] : localQueryEmbeddings[caseIndex];
      const memoryVectors = run.name === "openai" ? openAiMemoryVectors : localMemoryVectors;
      const ranked = memories
        .map((memory, memoryIndex) => ({
          sourceRef: memory.sourceRef || `id:${memory.id}`,
          title: memory.title,
          score: cosineSimilarity(queryVector, memoryVectors[memoryIndex]),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const refs = ranked.map((item) => item.sourceRef);
      const ok1 = test.expected.includes(refs[0]);
      const ok3 = refs.slice(0, 3).some((ref) => test.expected.includes(ref));
      if (ok1) run.top1 += 1;
      if (ok3) run.top3 += 1;
      addGroupResult(run, test, ok1, ok3);
      if (!ok3) {
        run.failures.push({
          index: caseIndex + 1,
          group: test.group,
          query: test.q,
          expected: test.expected,
          top: ranked,
        });
      }
    }
  }

  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, `personal-memory-embedding-comparison-${stamp}.md`);
  const jsonPath = join(outDir, `personal-memory-embedding-comparison-${stamp}.json`);

  const lines = [
    "# Personal Memory Embedding Comparison",
    "",
    `Generated: ${new Date().toISOString()}`,
    `User: ${userId}`,
    `Cases: ${cases.length}`,
    `Memories: ${memories.length}`,
    "",
    "This compares vector-only retrieval. It intentionally excludes lexical ranks, deterministic boosts, soft penalties, and GPT reranking.",
    "",
  ];

  for (const run of runs) {
    lines.push(
      `## ${run.name}`,
      "",
      `Top1: ${run.top1}/${cases.length}`,
      `Top3: ${run.top3}/${cases.length}`,
      "",
      "### Groups",
      ...renderGroupStats(run),
      "",
      "### Top3 Misses",
      ...run.failures.slice(0, 40).flatMap((failure) => [
        `- #${failure.index} [${failure.group}] ${failure.query}`,
        `  expected: ${failure.expected.join(" | ")}`,
        `  top: ${failure.top.map((item) => `${item.sourceRef} (${item.score.toFixed(4)})`).join(" | ")}`,
      ]),
      run.failures.length > 40 ? `- ... ${run.failures.length - 40} more` : "",
      "",
    );
  }

  writeFileSync(mdPath, lines.filter((line) => line !== "").join("\n"));
  writeFileSync(jsonPath, JSON.stringify({ userId, cases, memories: memories.length, runs }, null, 2));

  console.log(`EMBEDDING_COMPARISON ${mdPath}`);
  for (const run of runs) {
    console.log(`${run.name}: top1=${run.top1}/${cases.length} top3=${run.top3}/${cases.length}`);
  }
}

await main();
