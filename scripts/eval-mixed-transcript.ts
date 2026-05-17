import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation, type OutputLanguage } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import { EventMemoryManager } from "../src/server/memory/event-memory";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import { shouldStartTeleprompt } from "../src/server/teleprompt/teleprompt-runtime";

const userId = process.argv[2] || "li2897283405@gmail.com";
const limitArg = Number(process.argv[3] || 0);
const transcriptPath = process.argv[4] && !process.argv[4].startsWith("--")
  ? process.argv[4]
  : "docs/transcript3.md";

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const seedArg = optionValue("--seed") || "mixed-transcript-v1";
const generatedArg = Number(optionValue("--generated") || 70);

type MixedKind = "direct_question" | "public_statement" | "online_class_discussion" | "technical_lecture";

type TopicRule = {
  name: string;
  terms: string[];
  expectAny?: string[];
  expectedScenes: string[];
  allowKnowledge: boolean;
};

type MixedCase = {
  id: string;
  latest: string;
  history: string[];
  anchor: string;
  kind: MixedKind;
  topicName: string;
  expectedScenes: string[];
  expectedStart: ReturnType<typeof shouldStartTeleprompt>;
  expectAny?: string[];
  rejectAny?: string[];
  forbiddenMemoryRefs?: string[];
  allowKnowledge: boolean;
  maxWords: number;
  language?: OutputLanguage;
  note: string;
};

type MixedResult = {
  test: MixedCase;
  sourceSnippet: string;
  scene: string;
  startActual: ReturnType<typeof shouldStartTeleprompt>;
  memoryRefs: string[];
  output: string;
  flags: string[];
};

const rawTranscript = readFileSync(transcriptPath, "utf8");
const normalizedTranscript = rawTranscript.replace(/\s+/g, " ").trim();

function createSeededRandom(seed: string): () => number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: string): T[] {
  const random = createSeededRandom(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => termMatches(normalized, term));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termMatches(normalizedText: string, term: string): boolean {
  const normalizedTerm = term.toLowerCase().trim();
  if (!normalizedTerm) return false;

  if (/^[a-z0-9]+$/.test(normalizedTerm) && normalizedTerm.length <= 4) {
    return new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, "i").test(normalizedText);
  }

  if (/^[a-z0-9 ]+$/.test(normalizedTerm)) {
    return new RegExp(`\\b${escapeRegex(normalizedTerm).replace(/\s+/g, "\\s+")}\\b`, "i").test(normalizedText);
  }

  return normalizedText.includes(normalizedTerm);
}

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function sourceSnippet(anchor: string, radius = 420): string {
  const lower = normalizedTranscript.toLowerCase();
  const index = lower.indexOf(anchor.toLowerCase());
  if (index < 0) return "";
  return compact(normalizedTranscript.slice(Math.max(0, index - radius), Math.min(normalizedTranscript.length, index + anchor.length + radius)));
}

function splitSegments(): string[] {
  return normalizedTranscript
    .split(/(?<=[.!?])\s+/)
    .map(compact)
    .filter((segment) => {
      const words = wordCount(segment);
      return words >= 6 && words <= 65;
    });
}

const topicRules: TopicRule[] = [
  {
    name: "iac_terraform_cloudformation",
    terms: ["infrastructure as code", "iac", "terraform", "cloudformation", "cloud formation", "state file", "tfstate", "configuration drift", "devops"],
    expectAny: ["terraform", "infrastructure", "state", "environment", "automation"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "terraform_lab_resources",
    terms: ["terraform init", "terraform plan", "terraform apply", "terraform destroy", "provider block", "resource block", "main.tf", "aws_vpc", "aws_subnet", "aws_instance", "user data"],
    expectAny: ["terraform", "resource", "provider", "apply", "state"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "aws_cli_learner_lab",
    terms: ["aws cli", "access key", "secret access key", "session token", "learner lab", "learnlab", "default region", "aws configure"],
    expectAny: ["cli", "access", "token", "region", "configure"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "vpc_ec2_rds_security",
    terms: ["vpc", "subnet", "internet gateway", "route table", "ec2", "ami", "rds", "mysql", "security group", "port 80", "port 22", "3306"],
    expectAny: ["vpc", "subnet", "security", "instance", "database"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "online_meeting_communication",
    terms: ["online meeting", "virtual background", "turn your camera", "look at the camera", "looking at the screen", "speaking online", "mobile phone", "mute", "echo", "bandwidth", "screen time"],
    expectAny: ["online", "camera", "meeting", "background", "blur", "video", "communication", "speaking"],
    expectedScenes: ["classroom", "group_discussion"],
    allowKnowledge: false,
  },
  {
    name: "video_cloud_storage_cost",
    terms: ["cloud storage", "keep the videos", "camera catched", "pay for every single camera", "storage costs", "subscribe that from the vendors"],
    expectAny: ["storage", "cloud", "video", "camera", "cost", "data"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "ai_tools_education_policy",
    terms: ["ai tools", "students not to use it", "professors are also using ai", "copy-paste the response", "using the ai tools"],
    expectAny: ["ai", "students", "use", "verify", "policy"],
    expectedScenes: ["classroom"],
    allowKnowledge: false,
  },
  {
    name: "cloud_virtualization_scaling",
    terms: ["virtual machine", "virtual machines", "vm", "gpu", "cpu", "virtual gpu", "virtualization", "resource sharing", "cloud computing", "edge", "netflix", "stream the videos", "smooth", "scale up", "scalability", "lambda function", "15 minutes"],
    expectAny: ["cloud", "virtual", "scale", "resource", "compute", "server", "edge", "cache", "gpu"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "containers_images_runtime",
    terms: ["containers", "container", "docker", "container image", "docker image", "images and containers", "repositories on the cloud", "runtime instances"],
    expectAny: ["image", "container", "runtime", "dependencies"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "api_payment_web",
    terms: ["api", "apis", "pos system", "payment systems", "small businesses", "square", "checkout", "shopping cart", "place your order", "client and the server"],
    expectAny: ["api", "payment", "business", "data", "server", "integration"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "storage_cache_database",
    terms: ["cache", "caching", "database is also kind of storage", "data persistence", "primary key", "auto-increment", "row and column", "retrieve an email", "query this using this row"],
    expectAny: ["cache", "storage", "database", "query", "primary", "key", "data"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "react_hooks_state",
    terms: ["useeffect", "use effect", "dependency array", "usestate", "use state", "fetch the api", "store data", "state is used"],
    expectAny: ["effect", "dependency", "state", "hook", "fetch", "data"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "url_web_protocols",
    terms: ["port number", "service you are calling", "path representing", "fragment means", "query", "url", "html", "web server"],
    expectAny: ["port", "path", "query", "fragment", "url", "server"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "ip_contract_rights",
    terms: ["what your ip is", "protect it", "your rights", "sign something", "contracts", "assets as a developer", "intellectual property", "copyright"],
    expectAny: ["ip", "rights", "contract", "protect", "developer"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "react_navigation_ui",
    terms: ["react", "react native", "component", "components", "route", "routes", "navigation", "navigator", "screen", "screens", "login component", "firebase auth", "props", "state visible", "text input"],
    expectAny: ["react", "component", "screen", "route", "state", "navigation", "navigator", "hook", "signin", "firebase", "import"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "database_schema_rest_web",
    terms: ["database schema", "schema", "tables", "columns", "attributes", "shopping list", "purchase history", "web server", "web client", "restful", "rest api", "html", "fetch data"],
    expectAny: ["table", "attribute", "database", "data", "server"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "prototype_ui_ux",
    terms: ["prototype", "prototyping", "wireframe", "low fidelity", "medium fidelity", "high fidelity", "user experience", "usability", "functionalities", "content on each screen"],
    expectAny: ["prototype", "user", "screen", "design", "fidelity"],
    expectedScenes: ["classroom"],
    allowKnowledge: false,
  },
  {
    name: "sensors_animation",
    terms: ["sensors", "x y z", "rotation", "rotations", "axis", "axes", "gesture", "gestures", "gesture detector", "animation", "pinch", "pattern movement", "lottie", "z-axis", "key framing", "justify-content", "align-items", "cross axis", "main axis"],
    expectAny: ["sensor", "sensors", "axis", "rotation", "animation", "movement", "gesture", "pinch", "ui", "layout", "z-axis"],
    expectedScenes: ["classroom"],
    allowKnowledge: true,
  },
  {
    name: "communication_model",
    terms: ["sender", "receiver", "channel", "decoded", "decoding", "digital devices", "communicating with devices"],
    expectAny: ["sender", "receiver", "channel", "message", "decode"],
    expectedScenes: ["classroom"],
    allowKnowledge: false,
  },
  {
    name: "daily_small_talk",
    terms: ["how are you", "how was your weekend", "samosas"],
    expectedScenes: ["classroom", "daily_chat"],
    allowKnowledge: false,
  },
];

function topicFor(text: string): TopicRule | undefined {
  const normalized = text.toLowerCase();
  return topicRules.find((rule) => rule.terms.some((term) => termMatches(normalized, term)));
}

function isQuestion(segment: string): boolean {
  const normalized = segment.toLowerCase();
  if (!segment.includes("?")) return false;
  if (wordCount(segment) > 45) return false;
  return /\b(what|why|how|can|could|do|does|did|is|are|any questions|can somebody|does anybody|where)\b/.test(normalized);
}

function isUsefulCandidate(segment: string): boolean {
  if (topicFor(segment)) return true;
  if (isQuestion(segment) && wordCount(segment) >= 5) return true;
  return false;
}

function previousSegments(segments: string[], index: number): string[] {
  const history: string[] = [];
  for (let i = Math.max(0, index - 2); i < index; i += 1) {
    if (segments[i] && wordCount(segments[i]) <= 70) history.push(segments[i]);
  }
  return history;
}

function inferKind(segment: string, topic?: TopicRule): MixedKind {
  if (isQuestion(segment)) return "direct_question";
  if (topic?.name.includes("online") || topic?.name.includes("communication")) return "online_class_discussion";
  if (topic?.allowKnowledge) return "technical_lecture";
  return "public_statement";
}

function expectedStartFor(segment: string, kind: MixedKind): ReturnType<typeof shouldStartTeleprompt> {
  const normalized = segment.toLowerCase();
  if (/\b(any questions|are you able to find|is it working|can i get a raise of hands|do all of you have access)\b/.test(normalized)) {
    return "none";
  }
  if (/\b(how are you|are you on mobile|are you on laptop|what'?s your name|what you name)\b/.test(normalized)) {
    return "none";
  }
  if (kind === "direct_question" && /\b(tell me about|describe|explain in detail|walk me through|presentation|ielts part 2|part 2|long answer)\b/.test(normalized)) {
    return "expandable";
  }
  return "none";
}

function makeCase(segment: string, ordinal: number, sourceIndex: number, history: string[]): MixedCase {
  const topic = topicFor([...history, segment].join(" ")) ?? topicFor(segment);
  const kind = inferKind(segment, topic);
  const expectedStart = expectedStartFor(segment, kind);
  const allowKnowledge = topic?.allowKnowledge ?? false;
  return {
    id: `mixed_${String(ordinal + 1).padStart(3, "0")}_${topic?.name ?? (kind === "direct_question" ? "question" : "general")}`,
    latest: segment,
    history,
    anchor: segment.slice(0, Math.min(segment.length, 90)),
    kind,
    topicName: topic?.name ?? "general",
    expectedScenes: topic?.expectedScenes ?? ["classroom", "group_discussion", "daily_chat"],
    expectedStart,
    expectAny: topic?.expectAny,
    rejectAny: ["saynext", "my project", "my family", "back in chengdu"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    allowKnowledge,
    maxWords: expectedStart === "expandable" ? 75 : 70,
    note: `Auto-sampled from mixed transcript near segment ${sourceIndex}. Check scene, memory isolation, teleprompt start, and output tone.`,
  };
}

function generateCases(count: number, seed: string): MixedCase[] {
  const segments = splitSegments();
  const candidates = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => isUsefulCandidate(segment));
  const selected = shuffle(candidates, seed);
  const cases: MixedCase[] = [];
  const seen = new Set<string>();

  for (const item of selected) {
    if (cases.length >= count) break;
    const fingerprint = item.segment.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    cases.push(makeCase(item.segment, cases.length, item.index, previousSegments(segments, item.index)));
  }

  return cases;
}

function getSceneProfile(scene: string): string {
  const nameByScene: Record<string, string> = {
    classroom: "Classroom",
    group_discussion: "Meeting / Group Discussion",
    work_discussion: "Meeting / Group Discussion",
    interview: "Interview",
    daily_chat: "Daily Chat",
  };
  const name = nameByScene[scene] ?? "Daily Chat";
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === name);
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${name}`;
}

function makeEventMemory(test: MixedCase): EventMemorySnapshot {
  const timestamp = 1_800_000_000_000;
  const manager = new EventMemoryManager(`mixed-transcript-eval-${test.id}@local`, `mixed-${test.id}`, false);
  for (const [index, text] of [...test.history, test.latest].entries()) {
    manager.addTranscript(text, timestamp + index * 20_000);
  }
  return manager.getSnapshot();
}

function isForbiddenRef(ref: string, matchers: string[] = []): boolean {
  const normalized = ref.toLowerCase();
  return matchers.some((matcher) => normalized.startsWith(matcher.toLowerCase()) || normalized.includes(matcher.toLowerCase()));
}

function outputFlags(test: MixedCase, output: string, refs: string[], startActual: ReturnType<typeof shouldStartTeleprompt>, scene: string): string[] {
  const flags: string[] = [];
  const normalizedOutput = output.toLowerCase();

  if (!test.expectedScenes.includes(scene)) flags.push(`scene_mismatch:${scene}`);
  if (startActual !== test.expectedStart) flags.push(`teleprompt_start:${startActual}!=${test.expectedStart}`);

  const forbidden = refs.filter((ref) => isForbiddenRef(ref, test.forbiddenMemoryRefs));
  if (forbidden.length) flags.push(`process_forbidden_memory:${forbidden.join("|")}`);

  if (test.allowKnowledge && !refs.some((ref) => ref.startsWith("knowledge:"))) {
    flags.push("missing_knowledge_memory");
  }
  if (!test.allowKnowledge && refs.some((ref) => ref.startsWith("knowledge:")) && !includesAny(test.latest, ["terraform", "aws", "vpc", "ec2", "security group", "communication"])) {
    flags.push("unexpected_knowledge_memory");
  }

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|you could say|answer:|reply:|suggested)/i.test(output)) flags.push("label_or_meta_prefix");
  if (normalizedOutput.includes("as an ai")) flags.push("as_an_ai");
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (hasChinese(output) && test.language !== "chinese") flags.push("unexpected_chinese");
  if (includesAny(output, ["yeah that makes sense", "that's interesting", "sounds good"])) flags.push("fake_smalltalk");
  if (includesAny(output, ["xiang", "dalhousie", "chengdu", "my sister", "my mother", "my father"])) flags.push("personal_leak");

  return flags;
}

async function runCase(test: MixedCase): Promise<MixedResult> {
  const timestamp = Date.now();
  const transcripts = [...test.history, test.latest];
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: timestamp + index,
  }));
  const eventMemory = makeEventMemory(test);
  const memoryQuery = transcripts.slice(-4).join("\n") || test.latest;
  const refs = conversationLogger.searchPersonalMemoriesHybrid(userId, memoryQuery, 3).map((memory) => memory.sourceRef || memory.title);
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 3);
  const sceneHint = `${eventMemory.scene} mixed transcript`;
  const startActual = shouldStartTeleprompt(test.latest, sceneHint);
  const response = await processConversation(
    conversation,
    "high",
    eventMemory,
    test.language ?? "english",
    "",
    getSceneProfile(eventMemory.scene),
    relevantMemory,
  );
  const output = response.type === "insight" ? response.output : "";
  const flags = outputFlags(test, output, refs, startActual, eventMemory.scene);

  return {
    test,
    sourceSnippet: sourceSnippet(test.anchor),
    scene: eventMemory.scene,
    startActual,
    memoryRefs: refs,
    output,
    flags,
  };
}

function writeReport(results: MixedResult[]): string {
  const dir = join(process.cwd(), "data", "eval");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(dir, `mixed-transcript-eval-${stamp}.md`);
  const jsonPath = join(dir, `mixed-transcript-eval-${stamp}.json`);
  const flagged = results.filter((result) => result.flags.length > 0).length;
  const byTopic = new Map<string, { cases: number; flags: number }>();

  for (const result of results) {
    const stat = byTopic.get(result.test.topicName) ?? { cases: 0, flags: 0 };
    stat.cases += 1;
    if (result.flags.length) stat.flags += 1;
    byTopic.set(result.test.topicName, stat);
  }

  const lines = [
    "# Mixed Transcript Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Transcript: ${transcriptPath}`,
    `Characters: ${normalizedTranscript.length}`,
    `Seed: ${seedArg}`,
    `Generated cases requested: ${generatedArg}`,
    `Cases: ${results.length}`,
    `Flagged: ${flagged}`,
    "",
    "## Topic Summary",
    "",
    ...[...byTopic.entries()].sort().map(([topic, stat]) => `- ${topic}: ${stat.flags}/${stat.cases} flagged`),
    "",
  ];

  for (const [index, result] of results.entries()) {
    lines.push(
      `## ${index + 1}. ${result.test.id} ${result.flags.length ? "[FLAG]" : "[OK]"}`,
      "",
      `- Kind: ${result.test.kind}`,
      `- Topic: ${result.test.topicName}`,
      `- Scene: ${result.scene}`,
      `- shouldStartTeleprompt: ${result.startActual}`,
      `- Memory: ${result.memoryRefs.join(" | ") || "none"}`,
      `- Flags: ${result.flags.join(", ") || "none"}`,
      `- Note: ${result.test.note}`,
      "",
      "**Source Snippet**",
      "",
      "```text",
      result.sourceSnippet || "(anchor not found in transcript)",
      "```",
      "",
      "**History**",
      "",
      "```text",
      result.test.history.join("\n") || "(none)",
      "```",
      "",
      "**Latest Transcript**",
      "",
      "```text",
      result.test.latest,
      "```",
      "",
      "**SayNext Output**",
      "",
      "```text",
      result.output,
      "```",
      "",
    );
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ transcriptPath, seed: seedArg, generatedArg, results }, null, 2), "utf8");
  return mdPath;
}

const cases = generateCases(generatedArg, seedArg);
const selected = limitArg > 0 ? cases.slice(0, limitArg) : cases;
const started = Date.now();
const results: MixedResult[] = [];

console.log(`MIXED_TRANSCRIPT_EVAL provider=${process.env.LLM_PROVIDER || "openai"} model=${process.env.OLLAMA_MODEL || "openai"} cases=${selected.length} seed=${seedArg} transcript=${transcriptPath}`);

for (const [index, test] of selected.entries()) {
  const result = await runCase(test);
  results.push(result);
  console.log(`[${index + 1}/${selected.length}] ${result.flags.length ? "FLAG" : "OK"} ${test.id}: scene=${result.scene} output=${result.output}`);
  if (result.flags.length) console.log(`flags=${result.flags.join(", ")}`);
}

const report = writeReport(results);
const flagged = results.filter((result) => result.flags.length > 0).length;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`MIXED_TRANSCRIPT_EVAL_DONE cases=${results.length} flagged=${flagged} elapsedSec=${elapsed}`);
console.log(`report=${report}`);

if (flagged > 0) {
  process.exitCode = 1;
}
