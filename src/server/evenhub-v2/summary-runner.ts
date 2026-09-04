import { makeEvenHubV2Id } from "./protocol";
import {
  buildEvenHubV2SummaryPrompt,
  normalizeConversationSummaryOutput,
  OpenAiConversationSummaryGenerator,
  type ConversationSummaryGenerator,
} from "./summary-generator";
import {
  evenHubV2Store,
  parseStoredJson,
  type EvenHubV2CueRecord,
  type EvenHubV2Store,
  type EvenHubV2TranscriptLineRecord,
} from "./store";

export const EVENHUB_V2_SUMMARY_PROMPT_VERSION = "evenhub-v2-summary-v1";

export type EvenHubV2SummaryRunnerOptions = {
  store?: EvenHubV2Store;
  generator?: ConversationSummaryGenerator;
  minTranscriptChars?: number;
  staleRunningMs?: number;
  scanIntervalMs?: number;
  concurrency?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function transcriptText(lines: EvenHubV2TranscriptLineRecord[]): string {
  return lines.map((line) => line.text).join("\n");
}

function cueHistoryText(cues: EvenHubV2CueRecord[]): string {
  return cues
    .map((cue) => `[${cue.category}] ${cue.title}: ${cue.category === "code" ? "Code solution shown." : cue.output}`)
    .join("\n");
}

function withKeyPointIds(keyPoints: Array<{ title: string; details: string[] }>) {
  return keyPoints.map((item) => ({
    id: makeEvenHubV2Id("kp"),
    title: item.title,
    details: item.details,
  }));
}

function withActionItemIds(actionItems: Array<{ text: string }>) {
  return actionItems.map((item) => ({
    id: makeEvenHubV2Id("act"),
    text: item.text,
    checked: true,
  }));
}

export class EvenHubV2SummaryRunner {
  private readonly store: EvenHubV2Store;
  private readonly generator: ConversationSummaryGenerator;
  private readonly minTranscriptChars: number;
  private readonly staleRunningMs: number;
  private readonly inFlight = new Set<string>();
  private readonly concurrency: number;
  private readonly scanIntervalMs: number;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly jobs = new Map<string, Promise<void>>();
  private pumping = false;

  constructor(options: EvenHubV2SummaryRunnerOptions = {}) {
    this.store = options.store || evenHubV2Store;
    this.generator = options.generator || new OpenAiConversationSummaryGenerator();
    this.minTranscriptChars = options.minTranscriptChars ?? Number(process.env.EVENHUB_V2_SUMMARY_MIN_TRANSCRIPT_CHARS || 80);
    this.staleRunningMs = options.staleRunningMs ?? Number(process.env.EVENHUB_V2_SUMMARY_STALE_RUNNING_MS || 10 * 60 * 1000);
    this.concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 2)));
    this.scanIntervalMs = Math.max(10, options.scanIntervalMs ?? 30_000);
  }

  start(): void {
    if (this.scanTimer) return;
    this.stopped = false;
    this.recoverQueuedAndStale();
    this.scanTimer = setInterval(() => this.recoverQueuedAndStale(), this.scanIntervalMs);
    this.scanTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    await Promise.allSettled([...this.jobs.values()]);
  }

  retry(conversationId: string, userId: string): "queued" | "busy" | "not_found" | "active" | "not_failed" {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation || conversation.userId !== userId) return "not_found";
    if (conversation.status === "active" || conversation.status === "ending") return "active";
    const summary = this.store.getSummary(conversationId);
    if (!summary) return "not_found";
    if (summary.status === "queued" || summary.status === "running") return "busy";
    if (summary.status !== "failed") return "not_failed";
    if (!this.store.retryFailedSummary(conversationId, userId, nowIso())) return "busy";
    this.enqueue(conversationId);
    return "queued";
  }

  queueAndEnqueue(input: { conversationId: string; userId: string; queuedAt?: string }): void {
    this.queueSummary(input);
    this.enqueue(input.conversationId);
  }

  queueSummary(input: { conversationId: string; userId: string; queuedAt?: string }): void {
    this.store.queueSummary({
      id: makeEvenHubV2Id("summary"),
      conversationId: input.conversationId,
      userId: input.userId,
      queuedAt: input.queuedAt || nowIso(),
    });
  }

  enqueue(conversationId: string): void {
    if (this.stopped) return;
    this.pump();
  }

  private pump(): void {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      const available = this.concurrency - this.inFlight.size;
      if (available <= 0) return;
      for (const summary of this.store.listQueuedSummaries(available)) {
        const conversationId = summary.conversationId;
        if (this.inFlight.has(conversationId)) continue;
        this.inFlight.add(conversationId);
        const job = this.runSummaryJob(conversationId).catch((error) => {
          console.warn(`[EvenHubV2] summary worker failed: ${error instanceof Error ? error.message : String(error)}`);
        }).finally(() => {
          this.inFlight.delete(conversationId);
          this.jobs.delete(conversationId);
          this.pump();
        });
        this.jobs.set(conversationId, job);
      }
    } finally {
      this.pumping = false;
    }
  }

  recoverQueuedAndStale(nowMs = Date.now()): void {
    const cutoff = new Date(nowMs - this.staleRunningMs).toISOString();
    if (this.stopped) return;
    this.store.resetStaleRunningSummaries(cutoff, this.inFlight);
    this.pump();
  }

  async runSummaryJob(conversationId: string): Promise<void> {
    const startedAt = nowIso();
    if (!this.store.claimQueuedSummary(conversationId, startedAt)) return;
    const claimedSummary = this.store.getSummary(conversationId)!;
    const claim = { attemptCount: claimedSummary.attemptCount, startedAt };

    const detail = this.store.getConversationDetail(conversationId);
    if (!detail) {
      this.store.failSummary({
        claim,
        conversationId,
        error: "conversation_not_found",
        promptVersion: EVENHUB_V2_SUMMARY_PROMPT_VERSION,
        completedAt: nowIso(),
      });
      return;
    }

    const text = transcriptText(detail.transcript);
    const inputTranscriptChars = text.length;
    const inputLineCount = detail.transcript.length;
    if (inputTranscriptChars < this.minTranscriptChars) {
      this.store.completeSummary({
        claim,
        conversationId,
        title: detail.conversation.title || "Untitled conversation",
        overview: "-",
        keyPoints: [],
        actionItems: [],
        model: "",
        promptVersion: EVENHUB_V2_SUMMARY_PROMPT_VERSION,
        rawOutput: "",
        inputTranscriptChars,
        inputLineCount,
        inputTruncated: false,
        emptyReason: "too_short",
        trace: { reason: "too_short" },
        completedAt: nowIso(),
      });
      return;
    }

    const usedPrenote = parseStoredJson<{ ids?: string[]; text?: string }>(detail.conversation.usedPrenoteJson, {});
    const settings = parseStoredJson<{ language?: "english" | "chinese" | "auto" }>(detail.conversation.settingsJson, {});
    const input = {
      transcriptText: text,
      cueHistoryText: cueHistoryText(detail.cues),
      prenoteText: usedPrenote.text || "",
      language: settings.language || "english" as const,
    };

    try {
      const result = await this.generator.generate(input);
      const normalized = normalizeConversationSummaryOutput(result.data);
      this.store.completeSummary({
        claim,
        conversationId,
        title: normalized.title,
        overview: normalized.overview,
        keyPoints: withKeyPointIds(normalized.keyPoints),
        actionItems: withActionItemIds(normalized.actionItems),
        model: result.model,
        promptVersion: EVENHUB_V2_SUMMARY_PROMPT_VERSION,
        rawOutput: result.rawText,
        inputTranscriptChars,
        inputLineCount,
        inputTruncated: false,
        trace: {
          promptVersion: EVENHUB_V2_SUMMARY_PROMPT_VERSION,
          promptPreview: buildEvenHubV2SummaryPrompt(input).slice(0, 2000),
        },
        completedAt: nowIso(),
      });
    } catch (error) {
      this.store.failSummary({
        claim,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
        promptVersion: EVENHUB_V2_SUMMARY_PROMPT_VERSION,
        inputTranscriptChars,
        inputLineCount,
        inputTruncated: false,
        completedAt: nowIso(),
      });
    }
  }
}

export const evenHubV2SummaryRunner = new EvenHubV2SummaryRunner();
