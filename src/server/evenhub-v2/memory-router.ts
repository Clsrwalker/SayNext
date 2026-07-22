import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { classifyMemoryQueryIntent } from "../data/memory-taxonomy";

export const MEMORY_LANES = [
  "none",
  "profile",
  "company_fit",
  "named_project",
  "personal_experience",
  "behavioral",
] as const;

export type MemoryLane = typeof MEMORY_LANES[number];

export type MemoryRouterInput = {
  segmentMinus2: string;
  segmentMinus1: string;
  current: string;
};

export type MemoryRouterResult = {
  lane: MemoryLane;
  confidence: number;
  probabilities: Partial<Record<MemoryLane, number>>;
  model: string;
  latencyMs: number;
};

export interface MemoryRouter {
  predict(input: MemoryRouterInput): Promise<MemoryRouterResult>;
}

function cleanTranscriptSegment(value: string): string {
  return value
    .replace(/^\s*(?:interviewer|xiang|speaker(?:\s+[a-z0-9_-]+)?|user|assistant)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMemoryRouterInput(input: {
  recentTranscript: string;
  current: string;
}): MemoryRouterInput {
  const current = cleanTranscriptSegment(input.current);
  const previous = input.recentTranscript
    .split(/\r?\n+/)
    .map(cleanTranscriptSegment)
    .filter(Boolean)
    .filter((segment) => segment.toLowerCase() !== current.toLowerCase())
    .slice(-2);
  return {
    segmentMinus2: previous.at(-2) || "",
    segmentMinus1: previous.at(-1) || "",
    current,
  };
}

function classifyCurrent(value: string): MemoryLane {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return "none";
  if (classifyMemoryQueryIntent(normalized).canonicalProjectId !== "unknown") return "named_project";
  if (/\b(?:say\s*next|saynext|hybrid search memory|cue\s*flow|cueflow|job\s*lens|joblens|elder\s*album|elderalbum|dal\s*park|meeting monitor|study session tracker)\b/.test(normalized)) {
    return "named_project";
  }
  if (/\b(?:why (?:do|would|should) you (?:want|like)|why (?:this|our)|interested in (?:this|the)|fit for|hire you|this role|this company|the position|collaborat(?:e|ion)|work with (?:us|our team))\b/.test(normalized)) {
    return "company_fit";
  }
  if (/\b(?:tell me (?:about )?(?:a )?time|challenge|conflict|failure|failed|mistake|deadline|pressure|disagreement|feedback|criticism|code review|hardest (?:bug|part|problem)|difficult (?:integration |technical |team )?(?:problem|situation)|debugged|root cause)\b/.test(normalized)) {
    return "behavioral";
  }
  if (/\b(?:tell me (?:a )?(?:little bit )?about yourself|introduce yourself|walk me through your background|who are you|where are you from|your background|your education|what (?:are you studying|is your major|program are you in)|do you work or|are you a student|your strengths?|your weaknesses?|languages? (?:do|have) you|comfortable with .{0,20}(?:python|javascript|typescript|java|c\+\+|c#))\b/.test(normalized)) {
    return "profile";
  }
  const personalSubject = /\b(?:you|your|yourself|xiang)\b/.test(normalized);
  if (
    personalSubject
    && /\b(?:experience|experiment|built|build|worked|working|used|implemented|developed|contributed|project|projects|proud|recently|aws services|llm api|machine learning)\b/.test(normalized)
  ) return "personal_experience";
  return "none";
}

export function fallbackMemoryLane(input: MemoryRouterInput): MemoryLane {
  const currentLane = classifyCurrent(input.current);
  if (currentLane !== "none") return currentLane;

  const previousLane = classifyCurrent(input.segmentMinus1 || input.segmentMinus2);
  if (
    previousLane === "company_fit"
    && /\b(?:why|position|role|fit|precision|experiment|ceramic|interested)\b/i.test(input.current)
  ) return "company_fit";
  if (
    previousLane === "named_project"
    && /\b(?:it|that|system|flow|architecture|project|hardest|trade-?off|speech|queue|cue)\b/i.test(input.current)
  ) return "named_project";
  return "none";
}

export async function prewarmMemoryRouter(router: MemoryRouter): Promise<void> {
  try {
    await router.predict({
      segmentMinus2: "",
      segmentMinus1: "",
      current: "What is the difference between TCP and UDP?",
    });
  } catch (error) {
    console.warn(`[EvenHubV2] memory router warmup failed open: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type PendingRequest = {
  startedAt: number;
  resolve: (value: MemoryRouterResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SidecarMessage = {
  id?: string;
  lane?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  model?: string;
  error?: string;
};

export type OnnxMemoryRouterOptions = {
  pythonPath?: string;
  scriptPath?: string;
  modelPath?: string;
  tokenizerPath?: string;
  timeoutMs?: number;
};

export class OnnxMemoryRouter implements MemoryRouter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly modelPath: string;
  private readonly tokenizerPath: string;
  private readonly timeoutMs: number;

  constructor(options: OnnxMemoryRouterOptions = {}) {
    this.pythonPath = options.pythonPath || process.env.EVENHUB_V2_MEMORY_ROUTER_PYTHON || "python3";
    this.scriptPath = resolve(options.scriptPath || process.env.EVENHUB_V2_MEMORY_ROUTER_SCRIPT || "scripts/memory-router-onnx.py");
    this.modelPath = resolve(options.modelPath || process.env.EVENHUB_V2_MEMORY_ROUTER_MODEL_PATH || "data/models/saynext_memory_router_v1/model.uint8.onnx");
    this.tokenizerPath = resolve(options.tokenizerPath || process.env.EVENHUB_V2_MEMORY_ROUTER_TOKENIZER_PATH || "data/models/saynext_memory_router_v1/tokenizer.json");
    this.timeoutMs = options.timeoutMs ?? Number(process.env.EVENHUB_V2_MEMORY_ROUTER_TIMEOUT_MS || 3000);
  }

  async predict(input: MemoryRouterInput): Promise<MemoryRouterResult> {
    const child = this.ensureChild();
    const id = `memory_router_${Date.now().toString(36)}_${(++this.requestSequence).toString(36)}`;
    return new Promise<MemoryRouterResult>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error("memory_router_timeout"));
      }, this.timeoutMs);
      this.pending.set(id, {
        startedAt: Date.now(),
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, ...input })}\n`);
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    if (!existsSync(this.scriptPath)) throw new Error(`memory_router_script_missing:${this.scriptPath}`);
    if (!existsSync(this.modelPath)) throw new Error(`memory_router_model_missing:${this.modelPath}`);
    if (!existsSync(this.tokenizerPath)) throw new Error(`memory_router_tokenizer_missing:${this.tokenizerPath}`);

    const child = spawn(this.pythonPath, [
      this.scriptPath,
      "--model",
      this.modelPath,
      "--tokenizer",
      this.tokenizerPath,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) console.warn(`[EvenHubV2] memory router: ${message}`);
    });
    child.on("error", (error) => this.handleExit(error));
    child.on("exit", (code, signal) => this.handleExit(new Error(`memory_router_exit:${code ?? "null"}:${signal ?? "none"}`)));
    return child;
  }

  private handleLine(line: string): void {
    let message: SidecarMessage;
    try {
      message = JSON.parse(line) as SidecarMessage;
    } catch {
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }
    if (!MEMORY_LANES.includes(message.lane as MemoryLane)) {
      pending.reject(new Error("memory_router_invalid_lane"));
      return;
    }
    const probabilities = Object.fromEntries(
      Object.entries(message.probabilities || {})
        .filter(([lane, value]) => MEMORY_LANES.includes(lane as MemoryLane) && Number.isFinite(Number(value)))
        .map(([lane, value]) => [lane, Math.max(0, Math.min(1, Number(value)))]),
    ) as Partial<Record<MemoryLane, number>>;
    pending.resolve({
      lane: message.lane as MemoryLane,
      confidence: Math.max(0, Math.min(1, Number(message.confidence) || 0)),
      probabilities,
      model: String(message.model || "saynext_memory_router_v1"),
      latencyMs: Date.now() - pending.startedAt,
    });
  }

  private handleExit(error: Error): void {
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function createMemoryRouterFromEnv(): MemoryRouter | null {
  if (process.env.EVENHUB_V2_MEMORY_ROUTER_ENABLED !== "true") return null;
  const router = new OnnxMemoryRouter();
  void prewarmMemoryRouter(router);
  return router;
}

export const evenHubV2MemoryRouter = createMemoryRouterFromEnv();
