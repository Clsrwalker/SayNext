import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import { routeFastScene, type SceneBuiltinKey } from "../src/server/scene/fast-scene-router";

type SceneKey = "Daily Chat" | "Classroom" | "Interview" | "Meeting / Group Discussion";
type SourceKind = "hand" | "open_reference" | "previous_stress" | "asr_mutation";

type MixedCase = {
  id: string;
  sourceKind: SourceKind;
  scene: SceneKey;
  expectedScene: SceneBuiltinKey;
  latest: string;
  history?: string[];
  expectAny?: string[];
  rejectAny?: string[];
  maxWords?: number;
  allowProject?: boolean;
  allowPersonal?: boolean;
  thirdParty?: boolean;
  strictScene?: boolean;
  note: string;
};

type Result = {
  test: MixedCase;
  usedScene: SceneBuiltinKey;
  routeConfidence: number;
  output: string;
  elapsedMs: number;
  flags: string[];
  verdict: "good" | "watch" | "bad";
};

const args = process.argv.slice(2);
const userId = args.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const limit = Number(args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) || 100);
const seed = args.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length) || new Date().toISOString().slice(0, 19);
const outputDir = join("data", "eval");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const normalized = compact(text);
  return normalized ? normalized.split(/\s+/).length : 0;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seedValue: number): () => number {
  let value = seedValue >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded<T>(items: T[], seedValue: string): T[] {
  const rng = mulberry32(hashSeed(seedValue));
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function sceneNameToKey(scene: string): SceneBuiltinKey {
  if (/class/i.test(scene)) return "classroom";
  if (/interview|ielts/i.test(scene)) return "interview";
  if (/meeting|group/i.test(scene)) return "meeting_group";
  return "daily_chat";
}

function sceneKeyToName(scene: SceneBuiltinKey): SceneKey {
  if (scene === "classroom") return "Classroom";
  if (scene === "interview") return "Interview";
  if (scene === "meeting_group") return "Meeting / Group Discussion";
  return "Daily Chat";
}

function eventScene(scene: SceneBuiltinKey): string {
  if (scene === "meeting_group") return "group_discussion";
  return scene;
}

function formatAutoSceneProfile(sceneKey: SceneBuiltinKey): string {
  const profile = conversationLogger.getSceneProfileByBuiltinKey(userId, sceneKey);
  if (!profile) return `Active scene profile: Auto -> ${sceneKey}`;
  return `Active scene profile: Auto -> ${profile.name}\n${profile.prompt.trim()}`;
}

function makeEventMemory(test: MixedCase, usedScene: SceneBuiltinKey, transcripts: string[]): EventMemorySnapshot {
  return {
    eventId: `auto-random-${test.id}`,
    scene: eventScene(usedScene),
    title: compact(test.latest).slice(0, 90),
    summary: `Auto random mixed LLM test. source=${test.sourceKind}; expectedScene=${test.expectedScene}; ${test.note}`,
    transcriptCount: transcripts.length,
    aiReplyCount: 0,
    recentTranscripts: transcripts.slice(-6),
  };
}

function baseHandCases(): MixedCase[] {
  return [
    { id: "daily_slacking_after_class", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "what are you doing after class, wanna grab food?", expectAny: ["sure", "food", "sounds", "maybe"], rejectAny: ["lambda", "interview"], maxWords: 35, strictScene: true, note: "Daily food plan." },
    { id: "daily_weather_meme", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "This weather is giving NPC side quest energy.", expectAny: ["yeah", "weather", "npc", "side quest", "honestly"], rejectAny: ["AWS"], maxWords: 35, strictScene: true, note: "Meme tone." },
    { id: "daily_car_question", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "What car do you drive?", expectAny: ["Honda", "Civic", "black"], rejectAny: ["Tesla"], maxWords: 40, allowPersonal: true, strictScene: true, note: "Personal car fact." },
    { id: "daily_instrument", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "Can you play any instruments?", expectAny: ["saxophone", "piano", "used to", "school"], rejectAny: ["concert pianist"], maxWords: 60, allowPersonal: true, strictScene: true, note: "Music facts." },
    { id: "daily_mom_message", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "My mom is upset because I didn't reply, what should I say right now?", expectAny: ["sorry", "didn't mean", "ignore", "saw"], rejectAny: ["father"], maxWords: 45, allowPersonal: true, strictScene: true, note: "Family de-escalation." },
    { id: "daily_cashier", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "The total is forty two eighty, do you want to tap or insert?", expectAny: ["Tap"], rejectAny: ["maybe"], maxWords: 8, strictScene: true, note: "Payment." },
    { id: "daily_shop_return", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "If this hoodie doesn't fit can I return it with the receipt or is it final sale?", expectAny: ["return", "receipt", "final sale"], maxWords: 35, strictScene: true, note: "Shopping return." },
    { id: "daily_medical_caution", sourceKind: "hand", scene: "Daily Chat", expectedScene: "daily_chat", latest: "This medicine might affect liver right, should I still take it tonight?", expectAny: ["doctor", "pharmacist", "check", "guess"], rejectAny: ["yes"], maxWords: 45, strictScene: true, note: "Medical caution." },

    { id: "class_lambda", sourceKind: "hand", scene: "Classroom", expectedScene: "classroom", latest: "lambda cold start not my why it happen when function sleep long time", expectAny: ["cold start", "initialize", "idle"], rejectAny: ["anime"], maxWords: 90, allowProject: true, strictScene: true, note: "Broken technical English." },
    { id: "class_attention", sourceKind: "hand", scene: "Classroom", expectedScene: "classroom", latest: "What is the point of attention in a transformer?", expectAny: ["token", "context", "relevant", "weight"], rejectAny: ["my project"], maxWords: 85, strictScene: true, note: "DL concept." },
    { id: "class_replica_statement", sourceKind: "hand", scene: "Classroom", expectedScene: "classroom", history: ["The professor is explaining eventual consistency and replicas."], latest: "So replicas may briefly return different values after a write.", expectAny: ["replica", "consistent", "stale", "eventual"], rejectAny: ["takeout"], maxWords: 85, strictScene: true, note: "Lecture statement with classroom context." },
    { id: "class_sql_injection", sourceKind: "hand", scene: "Classroom", expectedScene: "classroom", latest: "How do prepared statements prevent SQL injection?", expectAny: ["parameter", "query", "data", "code"], rejectAny: ["SayNext"], maxWords: 90, strictScene: true, note: "Security concept." },
    { id: "class_precision_recall", sourceKind: "hand", scene: "Classroom", expectedScene: "classroom", latest: "Why is accuracy not enough for imbalanced classification?", expectAny: ["precision", "recall", "minority", "class"], rejectAny: ["game"], maxWords: 90, strictScene: true, note: "ML metric concept." },
    { id: "class_final_report_room", sourceKind: "hand", scene: "Classroom", expectedScene: "classroom", latest: "where is the rehearsal room, the classroom room number?", expectAny: ["Goldberg", "134"], rejectAny: ["maybe"], maxWords: 35, strictScene: true, note: "Prenote exact." },

    { id: "interview_student", sourceKind: "hand", scene: "Interview", expectedScene: "interview", latest: "Okay, so do you work or are you a student?", expectAny: ["MACS", "Dalhousie", "student"], rejectAny: ["math"], maxWords: 45, allowPersonal: true, strictScene: true, note: "IELTS/interview intro." },
    { id: "interview_tradeoff", sourceKind: "hand", scene: "Interview", expectedScene: "interview", latest: "Okay let's start, tell me about a technical trade-off you made.", expectAny: ["trade-off", "SayNext", "latency", "context"], rejectAny: ["microservices", "monolith"], maxWords: 100, allowProject: true, strictScene: true, note: "Supported trade-off." },
    { id: "interview_conflict", sourceKind: "hand", scene: "Interview", expectedScene: "interview", latest: "Tell me about a time you had conflict with a teammate.", expectAny: ["team", "clarify", "project", "communicat"], rejectAny: ["senior"], maxWords: 130, allowProject: true, strictScene: true, note: "Behavioral." },
    { id: "interview_google_fake", sourceKind: "hand", scene: "Interview", expectedScene: "interview", latest: "Tell me about your Google internship project.", expectAny: ["haven't", "Google", "internship"], rejectAny: ["at Google I"], maxWords: 95, allowProject: true, strictScene: true, note: "Unsupported premise." },
    { id: "interview_mobile", sourceKind: "hand", scene: "Interview", expectedScene: "interview", latest: "What mobile app experience do you have?", expectAny: ["mobile", "SayNext", "React Native", "DalParkAid"], rejectAny: ["smart glasses app"], maxWords: 100, allowProject: true, strictScene: true, note: "Mobile projects." },

    { id: "meeting_privacy_blocker", sourceKind: "hand", scene: "Meeting / Group Discussion", expectedScene: "meeting_group", history: ["We are deciding the API contract for uploaded prenote files."], latest: "The main blocker is the privacy issue with uploaded files, what should we do next?", expectAny: ["privacy", "storage", "access", "delete"], rejectAny: ["anime"], maxWords: 85, allowProject: true, strictScene: true, note: "Meeting blocker." },
    { id: "meeting_scope_cut", sourceKind: "hand", scene: "Meeting / Group Discussion", expectedScene: "meeting_group", latest: "We probably can't finish file upload, search, summary, and sharing by tomorrow.", expectAny: ["must", "demo", "scope", "upload", "cut", "prioritize"], rejectAny: ["do everything"], maxWords: 85, allowProject: true, strictScene: true, note: "Scope cut." },
    { id: "meeting_flow", sourceKind: "hand", scene: "Meeting / Group Discussion", expectedScene: "meeting_group", history: ["We are reviewing the mobile flow and API response."], latest: "I don't think it works with the current flow, what do you think?", expectAny: ["clarify", "flow", "test", "step"], rejectAny: ["I agree completely"], maxWords: 75, allowProject: true, strictScene: true, note: "Ambiguous meeting flow." },
    { id: "meeting_owner", sourceKind: "hand", scene: "Meeting / Group Discussion", expectedScene: "meeting_group", latest: "Actually for our team meeting, who owns the API contract before demo?", expectAny: ["owner", "API contract", "demo", "confirm"], rejectAny: ["interview"], maxWords: 70, allowProject: true, strictScene: true, note: "Owner confirmation." },
    { id: "meeting_bad_data", sourceKind: "hand", scene: "Meeting / Group Discussion", expectedScene: "meeting_group", latest: "Our test data is too clean compared with real user speech.", expectAny: ["noisy", "ASR", "real", "test"], rejectAny: ["not a problem"], maxWords: 80, allowProject: true, strictScene: true, note: "Testing quality." },
  ];
}

function loadOpenReferenceCases(): MixedCase[] {
  const generatedDir = join("data", "reference", "open-sources", "generated");
  if (!existsSync(generatedDir)) return [];
  const jsonl = readdirSync(generatedDir)
    .filter((name) => /^open-reference-cases-.*\.jsonl$/i.test(name))
    .sort()
    .at(-1);
  if (!jsonl) return [];

  const content = readFileSync(join(generatedDir, jsonl), "utf8");
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line);
      const expectedScene = sceneNameToKey(parsed.scene || "Daily Chat");
      return {
        id: `open_${index}_${parsed.id || "case"}`,
        sourceKind: "open_reference" as const,
        scene: sceneKeyToName(expectedScene),
        expectedScene,
        latest: compact(parsed.latest),
        history: Array.isArray(parsed.history) ? parsed.history.map(compact).filter(Boolean).slice(-3) : [],
        maxWords: Math.min(Number(parsed.maxWords || 55), 70),
        allowProject: false,
        allowPersonal: false,
        thirdParty: true,
        strictScene: false,
        note: `Open reference ${parsed.sourceId || "unknown"} ${parsed.kind || ""}`,
      };
    })
    .filter((item) => item.latest.length >= 8);
}

function loadPreviousStressCases(): MixedCase[] {
  const evalDir = join("data", "eval");
  if (!existsSync(evalDir)) return [];
  const files = readdirSync(evalDir)
    .filter((name) => /^llm-output-stress-.*\.jsonl$/i.test(name))
    .sort()
    .slice(-8);
  const cases: MixedCase[] = [];
  for (const file of files) {
    const content = readFileSync(join(evalDir, file), "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const test = parsed.test || {};
        const latest = compact(test.latest);
        if (!latest || latest.length < 6) continue;
        const expectedScene = sceneNameToKey(test.scene || "Daily Chat");
        cases.push({
          id: `prev_${cases.length}_${test.id || "case"}`,
          sourceKind: "previous_stress",
          scene: sceneKeyToName(expectedScene),
          expectedScene,
          latest,
          history: Array.isArray(test.history) ? test.history.map(compact).filter(Boolean).slice(-3) : [],
          expectAny: Array.isArray(test.expectAny) ? test.expectAny.slice(0, 4) : undefined,
          rejectAny: Array.isArray(test.rejectAny) ? test.rejectAny.slice(0, 4) : undefined,
          maxWords: Number(test.maxWords || 90),
          allowProject: Boolean(test.allowProjectMention),
          allowPersonal: !Boolean(test.expectNoPersonalMemory),
          thirdParty: /^open_|short_form/.test(String(test.sourceKind || "")),
          strictScene: false,
          note: `Previous stress case from ${file}`,
        });
      } catch {
        // skip malformed historical lines
      }
    }
  }
  return cases;
}

function asrMutations(seedValue: string): MixedCase[] {
  const rng = mulberry32(hashSeed(`${seedValue}:asr`));
  const bases = baseHandCases();
  const fillers = ["uh", "like", "you know", "actually", "wait", "sorry"];
  const mutate = (text: string): string => {
    const words = text.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const word of words) {
      if (rng() < 0.12) out.push(fillers[Math.floor(rng() * fillers.length)]);
      if (rng() < 0.08) continue;
      let value = word;
      if (rng() < 0.07) {
        value = value
          .replace(/privacy/gi, "private sea")
          .replace(/rubric/gi, "rub brick")
          .replace(/deadline/gi, "dead line")
          .replace(/rollback/gi, "roll back")
          .replace(/Dalhousie/gi, "Dal house");
      }
      out.push(value);
    }
    return out.join(" ");
  };

  return bases.map((item, index) => ({
    ...item,
    id: `asr_${index}_${item.id}`,
    sourceKind: "asr_mutation" as const,
    latest: mutate(item.latest),
    history: item.history?.map(mutate),
    note: `${item.note} ASR mutation.`,
  }));
}

function buildPool(): MixedCase[] {
  const pool = [
    ...baseHandCases(),
    ...asrMutations(seed),
    ...loadOpenReferenceCases(),
    ...loadPreviousStressCases(),
  ];
  const seen = new Set<string>();
  return pool.filter((item) => {
    const key = `${item.expectedScene}:${compact(item.latest).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function judge(test: MixedCase, usedScene: SceneBuiltinKey, output: string): { flags: string[]; verdict: Result["verdict"] } {
  const flags: string[] = [];
  if (!output.trim()) flags.push("empty_output");
  if (usedScene !== test.expectedScene) flags.push(`wrong_scene:${usedScene}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (/^\s*(you can say|suggested reply|answer:|reply:|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (/\b(as an ai|the assistant should|respond neutrally|take over that speaker|this transcript)\b/i.test(output)) flags.push("meta_instruction");
  if (!test.allowProject && /\b(saynext|say next|joblens|elderalbum|dalparkaid|lambda|dynamodb|aws|react native|ollama|prenote|teleprompt)\b/i.test(output)) {
    flags.push("unwanted_project_or_tech");
  }
  if (!test.allowPersonal && /\b(xiang|dalhousie|macs|chengdu|acadia|my mom|my mother|my sister|my father|honda civic|uric acid|fatty liver|permanent residency|bullying)\b/i.test(output)) {
    flags.push("unwanted_personal_detail");
  }
  if (test.thirdParty && /\b(my project|my school|my family|i built|i study|i'm a macs|i am a macs)\b/i.test(output)) {
    flags.push("third_party_role_leak");
  }
  if (/\b(at Google I|during my Google internship|when I worked at Google|as a senior|production users)\b/i.test(output)) {
    flags.push("unsupported_experience_claim");
  }
  if (test.sourceKind === "hand" && test.strictScene && flags.some((flag) => flag.startsWith("wrong_scene"))) {
    return { flags, verdict: "bad" };
  }
  const bad = flags.some((flag) => [
    "empty_output",
    "meta_prefix",
    "meta_instruction",
    "third_party_role_leak",
    "unsupported_experience_claim",
  ].some((badFlag) => flag.startsWith(badFlag)));
  return { flags, verdict: bad ? "bad" : flags.length ? "watch" : "good" };
}

async function runCase(test: MixedCase): Promise<Result> {
  const started = performance.now();
  const route = routeFastScene({
    latestTranscript: test.latest,
    recentTranscripts: test.history || [],
  });
  const usedScene = route.sceneKey;
  const transcripts = [...(test.history || []), test.latest].map(compact).filter(Boolean);
  const now = Date.now();
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: now - (transcripts.length - index) * 1000,
  }));
  const memoryQuery = transcripts.slice(-4).join("\n");
  const relevantPersonalMemoryContext = test.thirdParty
    ? ""
    : conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 4);
  const response = await processConversation(
    conversation,
    "high",
    makeEventMemory(test, usedScene, transcripts),
    "english",
    "",
    formatAutoSceneProfile(usedScene),
    relevantPersonalMemoryContext,
  );
  const output = response.type === "insight" ? response.output : "";
  const judgment = judge(test, usedScene, output);
  return {
    test,
    usedScene,
    routeConfidence: route.confidence,
    output,
    elapsedMs: Math.round(performance.now() - started),
    ...judgment,
  };
}

function renderReport(results: Result[], poolSize: number): string {
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] || 0) + 1;
    return acc;
  }, {});
  const groups = results.reduce<Record<string, Result[]>>((acc, result) => {
    const key = `${result.test.sourceKind}/${result.test.expectedScene}`;
    acc[key] = acc[key] || [];
    acc[key].push(result);
    return acc;
  }, {});

  const lines = [
    "# Auto Scene Random Mixed LLM Eval",
    "",
    `- timestamp: ${new Date().toISOString()}`,
    `- userId: ${userId}`,
    `- seed: ${seed}`,
    `- requested limit: ${limit}`,
    `- pool size: ${poolSize}`,
    `- cases: ${results.length}`,
    `- provider: ${process.env.LLM_PROVIDER || "auto/default"}`,
    `- good/watch/bad: ${counts.good || 0}/${counts.watch || 0}/${counts.bad || 0}`,
    `- avg elapsed: ${Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / Math.max(1, results.length))}ms`,
    "",
    "## Groups",
  ];

  for (const [group, items] of Object.entries(groups).sort()) {
    const good = items.filter((item) => item.verdict === "good").length;
    const watch = items.filter((item) => item.verdict === "watch").length;
    const bad = items.filter((item) => item.verdict === "bad").length;
    lines.push(`- ${group}: ${good}/${watch}/${bad}`);
  }

  const review = results.filter((item) => item.verdict !== "good");
  if (review.length) {
    lines.push("", "## Review Needed");
    for (const item of review) {
      lines.push("");
      lines.push(`### ${item.verdict.toUpperCase()} ${item.test.id}`);
      lines.push(`- source: ${item.test.sourceKind}`);
      lines.push(`- expectedScene: ${item.test.expectedScene}`);
      lines.push(`- usedScene: ${item.usedScene}`);
      lines.push(`- confidence: ${item.routeConfidence}`);
      lines.push(`- elapsedMs: ${item.elapsedMs}`);
      lines.push(`- flags: ${item.flags.join(", ")}`);
      lines.push(`- note: ${item.test.note}`);
      lines.push(`- latest: ${item.test.latest}`);
      if (item.test.history?.length) lines.push(`- history: ${item.test.history.join(" | ")}`);
      lines.push(`- output: ${item.output}`);
    }
  }

  lines.push("", "## All Cases");
  for (const item of results) {
    lines.push("");
    lines.push(`### ${item.verdict.toUpperCase()} ${item.test.id}`);
    lines.push(`- source: ${item.test.sourceKind}`);
    lines.push(`- expectedScene: ${item.test.expectedScene}`);
    lines.push(`- usedScene: ${item.usedScene}`);
    lines.push(`- confidence: ${item.routeConfidence}`);
    lines.push(`- elapsedMs: ${item.elapsedMs}`);
    lines.push(`- flags: ${item.flags.join(", ") || "(none)"}`);
    lines.push(`- latest: ${item.test.latest}`);
    lines.push("```text");
    lines.push(item.output);
    lines.push("```");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outputDir, { recursive: true });
  conversationLogger.listSceneProfiles(userId);
  const pool = buildPool();
  const selected = shuffleSeeded(pool, seed).slice(0, Math.min(limit, pool.length));
  const results: Result[] = [];
  for (const test of selected) {
    console.log(`[auto-random] ${results.length + 1}/${selected.length} ${test.id}`);
    results.push(await runCase(test));
  }
  const mdPath = join(outputDir, `auto-scene-random-mixed-${stamp}.md`);
  const jsonPath = join(outputDir, `auto-scene-random-mixed-${stamp}.json`);
  const metaPath = join(outputDir, `auto-scene-random-mixed-${stamp}.meta.json`);
  writeFileSync(mdPath, renderReport(results, pool.length));
  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  writeFileSync(metaPath, JSON.stringify({ seed, limit, poolSize: pool.length, selectedIds: selected.map((item) => item.id) }, null, 2));
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] || 0) + 1;
    return acc;
  }, {});
  console.log(`AUTO_SCENE_RANDOM_MIXED_REPORT ${mdPath}`);
  console.log(`good/watch/bad: ${counts.good || 0}/${counts.watch || 0}/${counts.bad || 0}`);
  if (counts.bad) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
