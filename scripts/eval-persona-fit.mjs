import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const evalDir = join(process.cwd(), "data", "eval");

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

const noRuntime = process.argv.includes("--no-runtime");

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function words(value) {
  const text = compact(value);
  return text ? text.split(/\s+/).length : 0;
}

function latestFile(pattern) {
  if (!existsSync(evalDir)) return "";
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const files = readdirSync(evalDir)
    .filter((name) => regex.test(name))
    .map((name) => join(evalDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || "";
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function latestOutputFromDisplays(displays = []) {
  return displays.map((item) => item?.text).filter(Boolean).at(-1) || "";
}

function latestOutputFromInsights(insights = []) {
  return insights.map((item) => item?.text).filter(Boolean).at(-1) || "";
}

function loadLlmSamples(path) {
  return readJsonl(path).map((row) => ({
    id: row.test?.id || "unknown",
    sourceFile: path,
    sourceKind: row.test?.sourceKind || "llm-output-stress",
    scene: row.test?.scene || "Unknown",
    input: row.test?.latest || "",
    output: row.output || "",
    originalVerdict: row.verdict || "unknown",
    memoryRefs: row.memoryRefs || [],
    desired: row.test?.desired || "",
  }));
}

function loadAppRuntimeSamples(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  const scenarioById = new Map((json.scenarios || []).map((scenario) => [scenario.id, scenario]));
  return (json.results || [])
    .map((result) => {
      const scenario = scenarioById.get(result.scenarioId);
      const output = latestOutputFromInsights(result.newInsights) || latestOutputFromDisplays(result.newDisplays);
      return {
        id: `${result.scenarioId || "scenario"}:${result.stepId || "step"}`,
        sourceFile: path,
        sourceKind: "app-runtime",
        scene: scenario?.scene || "Unknown",
        input: result.input || "",
        output,
        originalVerdict: result.verdict || "unknown",
        memoryRefs: [],
        desired: scenario?.description || "",
        elapsedMs: result.elapsedMs,
      };
    })
    .filter((sample) => sample.output);
}

function loadAsrRuntimeSamples(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  return (json.results || [])
    .map((result) => ({
      id: result.id || "asr",
      sourceFile: path,
      sourceKind: "asr-runtime",
      scene: result.scene || "Unknown",
      input: (result.processed || []).map((item) => item?.text).filter(Boolean).at(-1) || "",
      output: latestOutputFromInsights(result.insights) || latestOutputFromDisplays(result.displays),
      originalVerdict: result.verdict || "unknown",
      memoryRefs: [],
      desired: result.description || result.category || "",
      elapsedMs: result.elapsedMs,
    }))
    .filter((sample) => sample.output);
}

const KNOWN_PERSONAL_SPECIFICS = [
  "kfc",
  "mary brown",
  "superstore",
  "dalhousie",
  "macs",
  "master of applied computer science",
  "hybrid search memory assistant",
  "blood donation management system",
  "ai meeting monitor",
  "genshin",
  "halifax",
  "chengdu",
  "shishi",
  "grace",
  "michael",
  "mr. jiang",
  "jiang",
  "e-bike",
  "winter and steep roads",
];

const RISKY_UNVERIFIED_SPECIFICS = [
  "cozy apartment",
  "big window",
  "couch",
  "game night",
  "game nights",
  "gaming night",
  "board games",
  "pizza",
  "favorite gaming controller",
  "gaming headset",
  "custom settings",
  "black coffee",
  "hot tea",
  "piggy bank",
  "piggy banks",
  "parking meter",
  "parking meters",
  "vending machine",
  "vending machines",
  "friend's place",
  "little corner store",
  "corner store",
  "coffee shop",
  "barista",
  "usual order",
  "noodle shop",
  "owner knows me",
  "extra veggies",
  "victoria park",
  "small park near my",
  "peggy's cove",
  "mountain in alberta",
  "blew my mind",
  "fresh air",
  "spring garden road",
  "pop atlantic",
  "music festival",
  "food vendor",
  "food vendors",
  "live music stage",
  "live music stages",
  "sunset",
  "squirrel",
  "squirrels",
  "chipmunk",
  "chipmunks",
  "ducks",
  "picnic",
  "pax",
  "gaming convention",
  "gaming conventions",
  "detective conan",
  "scarlet bullet",
  "game of thrones",
  "breaking bad",
  "the boys",
  "animated series",
  "recently watched",
  "participation in a coding competition",
  "coding competition once",
  "award for participation",
  "favorite sichuan pepper grinder",
  "my friend alex",
  "nose-deep",
  "i know someone who",
  "workshop",
  "making everything from scratch",
  "became a doctor",
  "sister with her math homework",
  "couple of hours",
  "silly jokes",
  "left it there by accident",
  "mailed it back",
  "called them to ask",
  "library",
  "unknown number",
  "basketball together",
  "different colleges",
  "last year",
  "spring festival",
  "chinatown",
  "lantern",
  "lanterns",
  "dim sum",
  "five main roads",
  "residential streets",
  "share them with friends",
  "escrow",
  "home stretch",
  "super supportive and collaborative",
  "production users",
  "revenue",
  "paid pilot",
  "guitar",
  "playing some guitar",
  "complex programming assignment",
  "last semester",
];

const STYLE_FILLERS = [
  "honestly",
  "pretty chill",
  "kinda",
  "kind of",
  "not really",
  "definitely",
  "super cool",
  "cool stuff",
  "awesome",
];

const OVER_FORMAL_TERMS = [
  "indispensable",
  "mitigate",
  "provisioned concurrency",
  "apparent capabilities",
  "crucial for tasks",
  "sequence context matters",
  "seamlessly",
  "robust",
  "utilize",
  "leverage",
  "facilitate",
];

const LOW_VALUE_SAFE_PATTERNS = [
  /^(yeah,?\s*)?(that makes sense|sounds good|okay|got it|sure|i agree|no problem)[.!]?$/i,
  /\b(i would just|maybe just|you can just)\s+(say|ask|mention|tell)\b/i,
  /\bthere'?s not much (to add|else to say)\b/i,
  /\bi don'?t know\b(?!.*\b(check|verify|look|ask|confirm|safe|honest|from memory|not pretend)\b)/i,
];

const WRITTEN_NOT_SAYABLE_PATTERNS = [
  /\bfor the next iteration\b/i,
  /\bversion it\b/i,
  /\brequest\/response\b/i,
  /\be\.g\./i,
  /["`][^"`]{2,}["`]/,
  /\([^()]{2,80}\)/,
];

const CONNECTOR_STARTS = [
  "yeah",
  "honestly",
  "not really",
  "i think",
  "probably",
  "so basically",
  "for me",
  "before i",
  "one example",
  "maybe",
  "could",
  "sure",
];

function includesAny(text, terms) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function countMatches(text, terms) {
  const normalized = text.toLowerCase();
  return terms.reduce((count, term) => count + (normalized.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function endsWithQuestion(text) {
  return /[?？]\s*$/.test(text);
}

function startsWithConnector(text) {
  const normalized = compact(text).toLowerCase();
  return CONNECTOR_STARTS.some((start) => normalized.startsWith(start));
}

function isQuestionInput(input) {
  return /[?？]\s*$/.test(compact(input)) || /^(what|why|how|when|where|who|can|could|would|do|does|did|is|are|should)\b/i.test(compact(input));
}

function sceneGoal(scene) {
  if (scene === "Daily Chat") return "sound like Xiang while keeping the exchange easy, grounded, and not forced";
  if (scene === "Classroom") return "help Xiang look capable with a short clarification, edge case, practical question, or exact note";
  if (scene === "Interview") return "make Xiang sound prepared and credible using grounded stories and modest confidence";
  if (scene === "Meeting / Group Discussion") return "help Xiang gain advantage by clarifying the next decision, owner, blocker, risk, or trade-off";
  return "stay concise, grounded, and useful in the live moment";
}

function evaluatePersona(sample) {
  const flags = [];
  const output = compact(sample.output);
  const input = compact(sample.input);
  const lower = output.toLowerCase();
  const outputWords = words(output);
  const fillerCount = countMatches(output, STYLE_FILLERS);

  if (!output) flags.push(issue("bad", "empty_output", "No visible output."));

  if (/[\u0400-\u04FF]|\?{2,}/.test(output)) {
    flags.push(issue("bad", "unexpected_non_english_script", "English output contains non-English script characters."));
  }

  if (/^(oh, okay\.|okay\.|i see\.|got it\.)\s*(what happened after that\?|what happened next\?|can you tell me more\??)?$/i.test(output)) {
    flags.push(issue("watch", "generic_fallback", "Safe but template-like; does not use the situation."));
  }

  if (LOW_VALUE_SAFE_PATTERNS.some((pattern) => pattern.test(output))) {
    flags.push(issue("watch", "weak_advantage_no_value", "Safe, but does not help Xiang become clearer, calmer, or more effective in the moment."));
  }

  if (endsWithQuestion(output)) {
    const allowQuestion = /return|refund|receipt|final sale|appointment|pickup|estimated.*cost|before starting|ask|question|what should i ask|say that again|in english|can you|could you|do you want|how about you/i.test(input)
      || /could you say that again in english/i.test(output);
    if (!allowQuestion && ["Daily Chat", "Meeting / Group Discussion"].includes(sample.scene)) {
      flags.push(issue("watch", "forced_question_back", "Ends by pushing the turn back instead of adding useful content."));
    }
  }

  if (fillerCount >= 2 || /pretty chill/i.test(output)) {
    flags.push(issue("watch", "casual_style_mask", "Uses Xiang-like casual markers, but risks becoming repetitive."));
  }

  if (includesAny(output, OVER_FORMAL_TERMS)) {
    flags.push(issue("watch", "over_formal_or_textbook", "Word choice is more written/technical than real speech."));
  }

  if ((outputWords > 55 && sample.scene !== "Interview") || WRITTEN_NOT_SAYABLE_PATTERNS.some((pattern) => pattern.test(output))) {
    flags.push(issue("watch", "not_sayable_under_pressure", "Output may be too written, long, or formatted for Xiang to say naturally in a live moment."));
  }

  if (includesAny(output, RISKY_UNVERIFIED_SPECIFICS)) {
    flags.push(issue("bad", "unsupported_specific_detail", "Contains concrete personal/life detail that needs verified memory."));
  }

  const unsupportedStoryShape = /\b(describe|tell me about|time when|occasion|person who|family member|helped your family|place where|place in your city|photo|picture|view|crowded|good service|lost|valuable item|answered a phone|career in the medical|read a lot|make things by hand)\b/i.test(input)
    && /\b(I once|one time|there was this one|this local|my friend|I know someone|I have this|last time|last year|near my|at a coffee shop|at the library|in Chinatown|at Peggy'?s Cove)\b/i.test(output)
    && !includesAny(output, KNOWN_PERSONAL_SPECIFICS);
  if (sample.scene === "Daily Chat" && sample.sourceKind === "ielts" && unsupportedStoryShape) {
    flags.push(issue("bad", "unsupported_story_shape", "IELTS answer is shaped like a real personal anecdote without verified support."));
  }

  const hasPersonalSpecific = /my|i |i'|me\b/i.test(output)
    && /\b(apartment|friend|movie|controller|party|restaurant|weekend|watched|lost|favorite|recently|childhood|home)\b/i.test(output);
  const hasKnownSpecific = includesAny(output, KNOWN_PERSONAL_SPECIFICS);
  if (sample.scene === "Daily Chat" && sample.sourceKind === "ielts" && hasPersonalSpecific && !hasKnownSpecific && sample.memoryRefs.length === 0) {
    flags.push(issue("watch", "ungrounded_personal_color", "Personal-sounding detail appears without supporting memory."));
  }

  if (/\bSayNext\b/i.test(output)) {
    flags.push(issue("watch", "public_project_name_boundary", "Public-facing persona should normally say Hybrid Search Memory Assistant."));
  }

  if (sample.scene === "Classroom" && outputWords > 35 && !/deadline|room|due|11:59|Goldberg|short answer/i.test(input)) {
    flags.push(issue("watch", "classroom_too_explanatory", "Classroom persona should usually be a short low-profile clarification or note."));
  }

  if (sample.scene === "Meeting / Group Discussion") {
    const hasAction = /\b(next|owner|assign|decide|clarify|confirm|test|write|check|focus|prioritize|blocker|risk|deadline|contract|step|before finalizing|no action needed|wait before moving on)\b/i.test(output);
    if (!hasAction && outputWords > 8) {
      flags.push(issue("watch", "meeting_weak_next_step", "Meeting response sounds reasonable but may not move ownership or decision forward."));
    }
  }

  if (sample.scene === "Interview") {
    if (/\b(production users|real users|active users|paying users|customers|revenue|paid pilot|launched publicly|deployed to production)\b/i.test(lower)
      && !/\bno verified|don't have|do not have|can't share|not have\b/i.test(lower)) {
      flags.push(issue("bad", "unsupported_interview_claim", "Interview answer may imply unverified traction."));
    }
    if (outputWords > 65 && !/\bexample|what i did|result|learned\b/i.test(lower)) {
      flags.push(issue("watch", "interview_broad_without_story", "Interview answer is long but not anchored to a concrete story arc."));
    }
  }

  if (sample.scene === "Daily Chat" && outputWords > 40 && !isQuestionInput(input)) {
    flags.push(issue("watch", "daily_too_dense", "Daily reply may be too dense for real-time conversation."));
  }

  if (sample.elapsedMs && sample.elapsedMs > 2400) {
    flags.push(issue("watch", "latency_risk", `Runtime elapsed ${sample.elapsedMs}ms, too slow for realtime use.`));
  }

  if (!startsWithConnector(output) && outputWords > 8 && !/^\$?\d|^[A-Z][a-z]+, please\.$/.test(output)) {
    flags.push(issue("info", "thin_transition", "No natural opening bridge; may feel abrupt depending on context."));
  }

  const severity = flags.some((flag) => flag.severity === "bad")
    ? "bad"
    : flags.some((flag) => flag.severity === "watch")
      ? "watch"
      : "good";
  const score = Math.max(0, 100 - flags.reduce((sum, flag) => sum + (flag.severity === "bad" ? 25 : flag.severity === "watch" ? 10 : 2), 0));

  return {
    ...sample,
    personaVerdict: severity,
    personaScore: score,
    sceneGoal: sceneGoal(sample.scene),
    personaIssues: flags,
  };
}

function issue(severity, code, reason) {
  return { severity, code, reason };
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return map;
}

function summarize(results) {
  const byVerdict = { good: 0, watch: 0, bad: 0 };
  const byIssue = new Map();
  const byScene = new Map();
  for (const result of results) {
    byVerdict[result.personaVerdict] += 1;
    const sceneStat = byScene.get(result.scene) || { total: 0, good: 0, watch: 0, bad: 0, avgScore: 0 };
    sceneStat.total += 1;
    sceneStat[result.personaVerdict] += 1;
    sceneStat.avgScore += result.personaScore;
    byScene.set(result.scene, sceneStat);
    for (const issueItem of result.personaIssues) {
      const stat = byIssue.get(issueItem.code) || { count: 0, severity: issueItem.severity, reason: issueItem.reason };
      stat.count += 1;
      byIssue.set(issueItem.code, stat);
    }
  }
  for (const stat of byScene.values()) stat.avgScore = Math.round(stat.avgScore / Math.max(1, stat.total));
  return { byVerdict, byIssue, byScene };
}

function writeReports(results, inputs) {
  mkdirSync(evalDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(evalDir, `persona-fit-${stamp}.md`);
  const jsonPath = join(evalDir, `persona-fit-${stamp}.json`);
  const { byVerdict, byIssue, byScene } = summarize(results);

  const lines = [
    "# Persona Fit Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Samples: ${results.length}`,
    `Good: ${byVerdict.good}`,
    `Watch: ${byVerdict.watch}`,
    `Bad: ${byVerdict.bad}`,
    "",
    "## Inputs",
    "",
    ...inputs.filter(Boolean).map((path) => `- ${path}`),
    "",
    "## Rubric",
    "",
    "- Daily Chat: natural, low-pressure, no fake personal detail, no forced enthusiasm.",
    "- Classroom: short, low-profile clarification, edge case, or exact note.",
    "- Interview: grounded, public-safe, concrete, not over-polished.",
    "- Meeting / Group Discussion: clarify blocker, owner, next step, decision, or risk.",
    "- Persona target: Xiang after thinking for a few seconds, not generic AI and not a fake extrovert.",
    "- Conversation advantage target: clearer logic, calmer confidence, smoother turn-taking, and grounded personal detail when available.",
    "- Sayability target: something Xiang could plausibly say out loud under pressure, without doc-style wording, quotes, parentheses, or over-polished structure.",
    "- Public/private boundary: prefer Hybrid Search Memory Assistant over SayNext in public-facing answers.",
    "",
    "## Summary By Scene",
    "",
    "| Scene | Total | Good | Watch | Bad | Avg Persona Score |",
    "|---|---:|---:|---:|---:|---:|",
    ...[...byScene.entries()].sort().map(([scene, stat]) => `| ${scene} | ${stat.total} | ${stat.good} | ${stat.watch} | ${stat.bad} | ${stat.avgScore} |`),
    "",
    "## Issue Counts",
    "",
    "| Issue | Severity | Count | Meaning |",
    "|---|---|---:|---|",
    ...[...byIssue.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([code, stat]) => `| ${code} | ${stat.severity} | ${stat.count} | ${stat.reason} |`),
    "",
    "## Highest Priority Samples",
    "",
  ];

  const issueGroups = groupBy(
    results.filter((result) => result.personaVerdict !== "good"),
    (result) => result.personaIssues.find((item) => item.severity === "bad")?.code
      || result.personaIssues.find((item) => item.severity === "watch")?.code
      || "other",
  );

  for (const [code, samples] of [...issueGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${code}`, "");
    for (const sample of samples.slice(0, 8)) {
      lines.push(
        `- ${sample.personaVerdict.toUpperCase()} score=${sample.personaScore} ${sample.id} (${sample.scene}, ${sample.sourceKind}, original=${sample.originalVerdict})`,
        `  - input: ${sample.input || "(none)"}`,
        `  - output: ${sample.output}`,
        `  - issues: ${sample.personaIssues.map((item) => `${item.code}:${item.severity}`).join(", ")}`,
        "",
      );
    }
  }

  lines.push("## All Non-Good Samples", "");
  for (const sample of results.filter((result) => result.personaVerdict !== "good")) {
    lines.push(
      `### ${sample.id} [${sample.personaVerdict.toUpperCase()} score=${sample.personaScore}]`,
      "",
      `- Source file: ${basename(sample.sourceFile)}`,
      `- Source kind: ${sample.sourceKind}`,
      `- Scene: ${sample.scene}`,
      `- Original verdict: ${sample.originalVerdict}`,
      `- Goal: ${sample.sceneGoal}`,
      `- Issues: ${sample.personaIssues.map((item) => `${item.code} (${item.severity})`).join(", ")}`,
      "",
      "**Input**",
      "",
      "```text",
      sample.input || "(none)",
      "```",
      "",
      "**Output**",
      "",
      "```text",
      sample.output,
      "```",
      "",
    );
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ inputs, summary: { byVerdict, byIssue: Object.fromEntries(byIssue), byScene: Object.fromEntries(byScene) }, results }, null, 2), "utf8");
  return { mdPath, jsonPath };
}

const llmPath = args.get("llm") || latestFile(/^llm-output-stress-.*\.jsonl$/);
const appPath = noRuntime ? "" : (args.get("app") || latestFile(/^app-realistic-runtime-.*\.json$/));
const asrPath = noRuntime ? "" : (args.get("asr") || latestFile(/^asr-stream-runtime-.*\.json$/));

const samples = [];
if (llmPath) samples.push(...loadLlmSamples(llmPath));
if (appPath) samples.push(...loadAppRuntimeSamples(appPath));
if (asrPath) samples.push(...loadAsrRuntimeSamples(asrPath));

if (samples.length === 0) {
  console.error("No eval samples found. Pass --llm=path or run an LLM stress eval first.");
  process.exit(1);
}

const results = samples.map(evaluatePersona);
const paths = writeReports(results, [llmPath, appPath, asrPath]);
const { byVerdict, byIssue } = summarize(results);

console.log(`PERSONA_FIT_DONE samples=${results.length} good=${byVerdict.good} watch=${byVerdict.watch} bad=${byVerdict.bad}`);
console.log(
  [...byIssue.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([code, stat]) => `${code}:${stat.count}`)
    .join(" "),
);
console.log(`report=${paths.mdPath}`);
console.log(`json=${paths.jsonPath}`);

if (byVerdict.bad > 0) {
  process.exitCode = 1;
}
