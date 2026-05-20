import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LocationManager } from "../src/server/manager/LocationManager";
import { MergeResponseHandler } from "../src/server/mastra/agents/response-handler";
import type { TelepromptDisplay } from "../src/server/teleprompt/teleprompt-runtime";

type DisplayEvent = {
  text: string;
  durationMs?: number;
};

type StatusEvent = {
  type: string;
  [key: string]: unknown;
};

type CheckResult = {
  id: string;
  pass: boolean;
  expected: string;
  actual: string;
};

class MockSession {
  public displays: DisplayEvent[] = [];
  public logs: string[] = [];

  layouts = {
    showTextWall: (text: string, options: { durationMs?: number } = {}) => {
      this.displays.push({ text, durationMs: options.durationMs });
    },
  };

  logger = {
    info: (...args: unknown[]) => this.logs.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => this.logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => this.logs.push(args.map(String).join(" ")),
  };
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");

function makeDisplay(index: number, total: number, current: string, next = ""): TelepromptDisplay {
  return {
    currentIndex: index,
    total,
    status: "ready",
    text: [
      `${index + 1} / ${total}`,
      "",
      current,
      next ? `\nNext:\n${next}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function currentChunk(display: TelepromptDisplay): string {
  return display.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\d+\s*\/\s*\d+$/.test(line) && !/^next:?$/i.test(line))[0] || "";
}

function createHarness(): {
  handler: any;
  session: MockSession;
  statuses: StatusEvent[];
} {
  const session = new MockSession();
  const handler = new MergeResponseHandler(
    session as any,
    `eval-teleprompt-display-${Date.now()}`,
    new LocationManager("eval-teleprompt-display"),
    "high",
    "english",
  ) as any;
  const statuses: StatusEvent[] = [];
  handler.onStatus = (event: StatusEvent) => statuses.push(event);
  return { handler, session, statuses };
}

function expectEqual(results: CheckResult[], id: string, actual: unknown, expected: unknown): void {
  results.push({
    id,
    pass: actual === expected,
    expected: String(expected),
    actual: String(actual),
  });
}

async function run(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const first = makeDisplay(
    0,
    3,
    "SayNext is a mobile app that helps with real-time conversation support.",
    "It listens to live transcripts and suggests a natural next response.",
  );
  const second = makeDisplay(
    1,
    3,
    "It listens to live transcripts and suggests a natural next response.",
    "The hard part is handling interruptions and messy context.",
  );

  {
    const { handler, session, statuses } = createHarness();
    try {
      handler.showTelepromptDisplay(first);
      expectEqual(results, "initial teleprompt page should draw once", session.displays.length, 1);

      handler.showTelepromptDisplay(first, undefined, "refresh");
      expectEqual(results, "same page refresh with enough remaining time should not redraw", session.displays.length, 1);
      expectEqual(
        results,
        "same page refresh should report kept display",
        statuses.some((event) => event.type === "display_kept" && event.reason === "teleprompt_refresh"),
        true,
      );

      handler.currentDisplayExpiresAt = Date.now() + 1000;
      handler.showTelepromptDisplay(first, undefined, "refresh");
      expectEqual(results, "same page refresh near expiry should redraw", session.displays.length, 2);

      handler.showTelepromptDisplay(second, undefined, "refresh");
      expectEqual(results, "different teleprompt page should redraw", session.displays.length, 3);
    } finally {
      handler.close();
    }
  }

  {
    const { handler, session } = createHarness();
    try {
      const runtime = handler.teleprompt;
      const opening = "Yeah, I can talk about SayNext.";
      runtime.startPending("Can you explain your project in detail?", opening);
      runtime.setScript([
        first.text.replace(/^1\s*\/\s*3\s*/m, "").replace(/\nNext:\n[\s\S]*$/i, "").trim(),
        second.text.replace(/^2\s*\/\s*3\s*/m, "").replace(/\nNext:\n[\s\S]*$/i, "").trim(),
        "The hard part is handling interruptions and messy context.",
      ].join(" "));

      const activeDisplay = runtime.getDisplay() as TelepromptDisplay;
      handler.showTelepromptDisplay(activeDisplay);
      const before = session.displays.length;
      handler.currentDisplayExpiresAt = Date.now() + 50_000;
      await handler.processTranscript(currentChunk(activeDisplay).split(/\s+/).slice(0, 7).join(" "), Date.now());
      expectEqual(results, "teleprompt hold should not redraw when display still has time", session.displays.length, before);

      handler.currentDisplayExpiresAt = Date.now() + 1000;
      await handler.processTranscript(currentChunk(activeDisplay).split(/\s+/).slice(0, 7).join(" "), Date.now());
      expectEqual(results, "teleprompt hold should redraw when current page is about to expire", session.displays.length, before + 1);
    } finally {
      handler.close();
    }
  }

  return results;
}

mkdirSync(outDir, { recursive: true });
const results = await run();
const failed = results.filter((result) => !result.pass);
const lines = [
  "# Teleprompt Display Lifecycle Eval",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Checks: ${results.length}`,
  `Failed: ${failed.length}`,
  "",
  "## Checks",
  ...results.map((result) => `- ${result.pass ? "PASS" : "FAIL"} ${result.id} (expected ${result.expected}, actual ${result.actual})`),
];

const mdPath = join(outDir, `teleprompt-display-lifecycle-${timestamp}.md`);
const jsonPath = join(outDir, `teleprompt-display-lifecycle-${timestamp}.json`);
writeFileSync(mdPath, lines.join("\n"), "utf8");
writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

console.log("Teleprompt display lifecycle eval complete.");
console.log(`Checks: ${results.length}`);
console.log(`Failed: ${failed.length}`);
console.log(`Report: ${mdPath}`);

if (failed.length) {
  process.exitCode = 1;
}
