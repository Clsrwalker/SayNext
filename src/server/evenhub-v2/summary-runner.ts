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
};

function nowIso(): string {
  return new Date().toISOString();
}

function transcriptText(lines: EvenHubV2TranscriptLineRecord[]): string {
  return lines.map((line) => line.text).join("\n");
}

function cueHistoryText(cues: EvenHubV2CueRecord[]): string {
  return cues
    .map((cue) => `[${cue.category}] ${cue.title}: ${cue.output}`)
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

  constructor(options: EvenHubV2SummaryRunnerOptions = {}) {
    this.store = options.store || evenHubV2Store;
    this.generator = options.generator || new OpenAiConversationSummaryGenerator();
    this.minTranscriptChars = options.minTranscriptChars ?? Number(process.env.EVENHUB_V2_SUMMARY_MIN_TRANSCRIPT_CHARS || 80);
    this.staleRunningMs = options.staleRunningMs ?? Number(process.env.EVENHUB_V2_SUMMARY_STALE_RUNNING_MS || 10 * 60 * 1000);
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
    if (this.inFlight.has(conversationId)) return;
    this.inFlight.add(conversationId);
    void this.runSummaryJob(conversationId).finally(() => {
      this.inFlight.delete(conversationId);
    });
  }

  recoverQueuedAndStale(nowMs = Date.now()): void {
    const cutoff = new Date(nowMs - this.staleRunningMs).toISOString();
    this.store.resetStaleRunningSummaries(cutoff);
    for (const summary of this.store.listQueuedSummaries(100)) {
      this.enqueue(summary.conversationId);
    }
  }

  async runSummaryJob(conversationId: string): Promise<void> {
    const startedAt = nowIso();
    if (!this.store.claimQueuedSummary(conversationId, startedAt)) return;

    const detail = this.store.getConversationDetail(conversationId);
    if (!detail) {
      this.store.failSummary({
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
