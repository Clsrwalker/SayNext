import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Flag = {
  area: string;
  severity: "warning" | "critical";
  message: string;
  sample?: unknown;
};

const args = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=") || "true"];
    }),
);

const baseUrl = (args.get("base") || "http://localhost:3000").replace(/\/$/, "");
const userId = args.get("user") || "li2897283405@gmail.com";
const minutes = Number(args.get("minutes") || 30);
const expectActive = args.get("expect-active") === "true";
const startedAt = Date.now();
const endsAt = startedAt + minutes * 60_000;
const outputDir = join("data", "eval");
const now = new Date().toISOString().replace(/[:.]/g, "-");

const flags: Flag[] = [];
const healthSamples: unknown[] = [];
const settingsSamples: unknown[] = [];
const memoryProbeSamples: unknown[] = [];
const sseEvents: Array<{ timestamp: string; type: string; active?: boolean; textLength?: number }> = [];

let healthChecks = 0;
let healthFailures = 0;
let settingsChecks = 0;
let settingsFailures = 0;
let memoryChecks = 0;
let memoryFailures = 0;
let sseReconnects = 0;
let sseFailures = 0;
let sseDataEvents = 0;
let insightEvents = 0;
let statusEvents = 0;
let heartbeatEvents = 0;
let activeHeartbeatCount = 0;
let inactiveHeartbeatCount = 0;
let lastSseDataAt = 0;
let maxSseDataGapMs = 0;
let stopped = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordSseEvent(event: any): void {
  const nowMs = Date.now();
  if (lastSseDataAt) {
    maxSseDataGapMs = Math.max(maxSseDataGapMs, nowMs - lastSseDataAt);
  }
  lastSseDataAt = nowMs;
  sseDataEvents += 1;

  const type = String(event?.type || "unknown");
  if (type === "insight") insightEvents += 1;
  if (type === "processing" || type === "processing_done" || type.startsWith("teleprompt")) statusEvents += 1;
  if (type === "session_heartbeat") {
    heartbeatEvents += 1;
    if (event.active) activeHeartbeatCount += 1;
    else inactiveHeartbeatCount += 1;
  }

  if (sseEvents.length < 500) {
    sseEvents.push({
      timestamp: new Date().toISOString(),
      type,
      active: typeof event.active === "boolean" ? event.active : undefined,
      textLength: typeof event.text === "string" ? event.text.length : undefined,
    });
  }
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollHealth(): Promise<void> {
  while (!stopped && Date.now() < endsAt) {
    healthChecks += 1;
    const started = Date.now();
    try {
      const json = await fetchJson("/api/health");
      healthSamples.push({ at: new Date().toISOString(), latencyMs: Date.now() - started, status: json.status });
    } catch (error) {
      healthFailures += 1;
      flags.push({
        area: "health",
        severity: "critical",
        message: "Health check failed.",
        sample: { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) },
      });
    }
    await sleep(10_000);
  }
}

async function pollSettings(): Promise<void> {
  while (!stopped && Date.now() < endsAt) {
    settingsChecks += 1;
    const started = Date.now();
    try {
      const json = await fetchJson(`/api/settings?userId=${encodeURIComponent(userId)}`);
      settingsSamples.push({
        at: new Date().toISOString(),
        latencyMs: Date.now() - started,
        pausedForReading: json.pausedForReading,
        outputLanguage: json.outputLanguage,
      });
    } catch (error) {
      settingsFailures += 1;
      flags.push({
        area: "settings",
        severity: "warning",
        message: "Settings poll failed.",
        sample: { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) },
      });
    }
    await sleep(30_000);
  }
}

async function pollMemorySearch(): Promise<void> {
  const queries = [
    "lambda cold start and serverless trade off",
    "what project did I build for real time conversation support",
    "describe a room where I like to study",
    "database index slow query access pattern",
  ];
  let index = 0;
  while (!stopped && Date.now() < endsAt) {
    memoryChecks += 1;
    const query = queries[index % queries.length];
    index += 1;
    const started = Date.now();
    try {
      const json = await fetchJson("/api/personal-memories/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, query, limit: 3 }),
      });
      memoryProbeSamples.push({
        at: new Date().toISOString(),
        latencyMs: Date.now() - started,
        query,
        count: Array.isArray(json.memories) ? json.memories.length : 0,
        refs: Array.isArray(json.memories) ? json.memories.map((memory: any) => memory.sourceRef).slice(0, 3) : [],
      });
    } catch (error) {
      memoryFailures += 1;
      flags.push({
        area: "memory",
        severity: "warning",
        message: "Personal memory search failed.",
        sample: { at: new Date().toISOString(), query, error: error instanceof Error ? error.message : String(error) },
      });
    }
    await sleep(60_000);
  }
}

async function watchSse(): Promise<void> {
  while (!stopped && Date.now() < endsAt) {
    const controller = new AbortController();
    const remaining = Math.max(1_000, endsAt - Date.now());
    const timeout = setTimeout(() => controller.abort(), remaining);

    try {
      const response = await fetch(`${baseUrl}/api/insight-stream?userId=${encodeURIComponent(userId)}`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!response.ok || !response.body) {
        throw new Error(`SSE failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!stopped && Date.now() < endsAt) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const raw = dataLine.slice("data: ".length);
          try {
            recordSseEvent(JSON.parse(raw));
          } catch {
            recordSseEvent({ type: "unparseable", raw: raw.slice(0, 200) });
          }
        }
      }
    } catch (error) {
      if (Date.now() < endsAt && !stopped) {
        sseFailures += 1;
        flags.push({
          area: "sse",
          severity: "critical",
          message: "SSE stream disconnected or failed before test ended.",
          sample: { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) },
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!stopped && Date.now() < endsAt) {
      sseReconnects += 1;
      await sleep(2_000);
    }
  }
}

console.log(`Starting wall-clock soak test for ${minutes} minutes`);
console.log(`Base URL: ${baseUrl}`);
console.log(`User ID: ${userId}`);
console.log(`Open the MiniApp and use it normally while this runs.`);

await Promise.race([
  Promise.all([watchSse(), pollHealth(), pollSettings(), pollMemorySearch()]),
  sleep(minutes * 60_000),
]);
stopped = true;
await sleep(250);

if (sseDataEvents === 0) {
  flags.push({
    area: "sse",
    severity: "critical",
    message: "No SSE data events were received.",
  });
}

if (maxSseDataGapMs > 45_000) {
  flags.push({
    area: "sse",
    severity: "warning",
    message: "SSE data heartbeat gap exceeded 45 seconds.",
    sample: { maxSseDataGapMs },
  });
}

if (expectActive && activeHeartbeatCount === 0) {
  flags.push({
    area: "session",
    severity: "warning",
    message: "Expected an active MiniApp session, but all heartbeats were inactive.",
    sample: { activeHeartbeatCount, inactiveHeartbeatCount },
  });
}

const report = {
  baseUrl,
  userId,
  minutes,
  startedAt: new Date(startedAt).toISOString(),
  endedAt: new Date().toISOString(),
  health: { healthChecks, healthFailures, samples: healthSamples.slice(-20) },
  settings: { settingsChecks, settingsFailures, samples: settingsSamples.slice(-20) },
  memory: { memoryChecks, memoryFailures, samples: memoryProbeSamples.slice(-20) },
  sse: {
    sseDataEvents,
    insightEvents,
    statusEvents,
    heartbeatEvents,
    activeHeartbeatCount,
    inactiveHeartbeatCount,
    sseReconnects,
    sseFailures,
    maxSseDataGapMs,
    events: sseEvents.slice(-100),
  },
  flags,
};

mkdirSync(outputDir, { recursive: true });
const jsonPath = join(outputDir, `wall-clock-soak-${now}.json`);
const mdPath = join(outputDir, `wall-clock-soak-${now}.md`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const criticalCount = flags.filter((flag) => flag.severity === "critical").length;
const warningCount = flags.filter((flag) => flag.severity === "warning").length;
writeFileSync(mdPath, [
  "# Wall Clock Soak Test",
  "",
  `Base URL: \`${baseUrl}\``,
  `User: \`${userId}\``,
  `Duration: ${minutes} minutes`,
  "",
  "## Summary",
  "",
  `- Critical: ${criticalCount}`,
  `- Warnings: ${warningCount}`,
  `- Health checks: ${healthChecks}, failures: ${healthFailures}`,
  `- Settings checks: ${settingsChecks}, failures: ${settingsFailures}`,
  `- Memory checks: ${memoryChecks}, failures: ${memoryFailures}`,
  `- SSE data events: ${sseDataEvents}`,
  `- SSE insights: ${insightEvents}`,
  `- SSE status events: ${statusEvents}`,
  `- SSE heartbeats: ${heartbeatEvents}`,
  `- Active heartbeats: ${activeHeartbeatCount}`,
  `- Inactive heartbeats: ${inactiveHeartbeatCount}`,
  `- SSE reconnects: ${sseReconnects}`,
  `- SSE failures: ${sseFailures}`,
  `- Max SSE data gap: ${maxSseDataGapMs}ms`,
  "",
  "## Flags",
  "",
  flags.length ? flags.map((flag, index) => [
    `### ${index + 1}. ${flag.area} / ${flag.severity}`,
    "",
    flag.message,
    "",
    "```json",
    JSON.stringify(flag.sample ?? null, null, 2),
    "```",
  ].join("\n")).join("\n\n") : "No flags.",
  "",
  `JSON report: \`${jsonPath}\``,
].join("\n"));

console.log(`Wall-clock soak report: ${mdPath}`);
console.log(`Critical=${criticalCount} Warning=${warningCount}`);

if (criticalCount > 0) {
  process.exitCode = 1;
}
