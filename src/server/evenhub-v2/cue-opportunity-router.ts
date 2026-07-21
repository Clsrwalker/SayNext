import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

export type CueOpportunityRouterInput = {
  segmentMinus2: string;
  segmentMinus1: string;
  current: string;
};

export type CueOpportunityRouterResult = {
  probability: number;
  decision: "cue_needed" | "no_cue";
  threshold: number;
  model: string;
  latencyMs: number;
};

export interface CueOpportunityRouter {
  predict(input: CueOpportunityRouterInput): Promise<CueOpportunityRouterResult>;
}

export async function prewarmCueOpportunityRouter(router: CueOpportunityRouter): Promise<void> {
  try {
    await router.predict({
      segmentMinus2: "",
      segmentMinus1: "",
      current: "Thanks, that makes sense.",
    });
  } catch (error) {
    console.warn(`[EvenHubV2] cue router warmup failed open: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type PendingRequest = {
  startedAt: number;
  resolve: (value: CueOpportunityRouterResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SidecarMessage = {
  id?: string;
  probability?: number;
  decision?: string;
  threshold?: number;
  model?: string;
  error?: string;
};

export type OnnxCueOpportunityRouterOptions = {
  pythonPath?: string;
  scriptPath?: string;
  modelPath?: string;
  tokenizerPath?: string;
  threshold?: number;
  timeoutMs?: number;
};

export class OnnxCueOpportunityRouter implements CueOpportunityRouter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly modelPath: string;
  private readonly tokenizerPath: string;
  private readonly threshold: number;
  private readonly timeoutMs: number;

  constructor(options: OnnxCueOpportunityRouterOptions = {}) {
    this.pythonPath = options.pythonPath || process.env.EVENHUB_V2_CUE_ROUTER_PYTHON || "python3";
    this.scriptPath = resolve(options.scriptPath || process.env.EVENHUB_V2_CUE_ROUTER_SCRIPT || "scripts/cue-router-onnx.py");
    this.modelPath = resolve(options.modelPath || process.env.EVENHUB_V2_CUE_ROUTER_MODEL_PATH || "data/models/saynext_context_router_v2/model.uint8.onnx");
    this.tokenizerPath = resolve(options.tokenizerPath || process.env.EVENHUB_V2_CUE_ROUTER_TOKENIZER_PATH || "data/models/saynext_context_router_v2/tokenizer.json");
    this.threshold = options.threshold ?? Number(process.env.EVENHUB_V2_CUE_ROUTER_THRESHOLD || 0.519233227);
    this.timeoutMs = options.timeoutMs ?? Number(process.env.EVENHUB_V2_CUE_ROUTER_TIMEOUT_MS || 5000);
  }

  async predict(input: CueOpportunityRouterInput): Promise<CueOpportunityRouterResult> {
    const child = this.ensureChild();
    const id = `router_${Date.now().toString(36)}_${(++this.requestSequence).toString(36)}`;
    return new Promise<CueOpportunityRouterResult>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error("cue_router_timeout"));
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
    if (!existsSync(this.scriptPath)) throw new Error(`cue_router_script_missing:${this.scriptPath}`);
    if (!existsSync(this.modelPath)) throw new Error(`cue_router_model_missing:${this.modelPath}`);
    if (!existsSync(this.tokenizerPath)) throw new Error(`cue_router_tokenizer_missing:${this.tokenizerPath}`);

    const child = spawn(this.pythonPath, [
      this.scriptPath,
      "--model",
      this.modelPath,
      "--tokenizer",
      this.tokenizerPath,
      "--threshold",
      String(this.threshold),
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) console.warn(`[EvenHubV2] cue router: ${message}`);
    });
    child.on("error", (error) => this.handleExit(error));
    child.on("exit", (code, signal) => this.handleExit(new Error(`cue_router_exit:${code ?? "null"}:${signal ?? "none"}`)));
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
    const probability = Number(message.probability);
    const threshold = Number(message.threshold);
    if (!Number.isFinite(probability) || !Number.isFinite(threshold)) {
      pending.reject(new Error("cue_router_invalid_response"));
      return;
    }
    pending.resolve({
      probability: Math.max(0, Math.min(1, probability)),
      decision: message.decision === "cue_needed" ? "cue_needed" : "no_cue",
      threshold,
      model: String(message.model || "saynext_context_router_v2"),
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

export function createCueOpportunityRouterFromEnv(): CueOpportunityRouter | null {
  if (process.env.EVENHUB_V2_CUE_ROUTER_ENABLED !== "true") return null;
  const router = new OnnxCueOpportunityRouter();
  void prewarmCueOpportunityRouter(router);
  return router;
}

export const evenHubV2CueOpportunityRouter = createCueOpportunityRouterFromEnv();
