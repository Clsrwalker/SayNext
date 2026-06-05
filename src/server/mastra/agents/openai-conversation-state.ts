import { createHash } from "node:crypto";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";
const OPENAI_CONVERSATION_CLEANUP_WAIT_TIMEOUT_MS = Number(process.env.OPENAI_CONVERSATION_CLEANUP_WAIT_TIMEOUT_MS || 1500);
const OPENAI_CONVERSATION_CLEANUP_DELETE_TIMEOUT_MS = Number(process.env.OPENAI_CONVERSATION_CLEANUP_DELETE_TIMEOUT_MS || 5000);

export type TranscriptCommitReason = "final" | "timeout";

export interface OpenAiConversationGenerateOptions {
  model: string;
  seedInstructions: string;
  latestTranscript: string;
  transcriptContext?: string;
  outputLanguage?: string;
  promptMode?: string;
  answerIntent?: string;
  answerStrategy?: string;
  taskHint?: string;
  preparedNote?: string;
  supportContext?: string;
  timeoutMs: number;
}

export interface OpenAiConversationGenerateResult {
  text: string;
  conversationId: string;
  responseId?: string;
  deletedOutputItemIds: string[];
}

export interface OpenAiConversationPayload {
  model: string;
  conversation: string;
  input: Array<{
    role: "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
  temperature: number;
}

export interface OpenAiConversationCreatePayload {
  metadata: Record<string, string>;
  items?: Array<{
    type: "message";
    role: "developer";
    content: string;
  }>;
}

export interface OpenAiConversationInputOptions {
  outputLanguage?: string;
  promptMode?: string;
  answerIntent?: string;
  answerStrategy?: string;
  taskHint?: string;
  transcriptContext?: string;
  preparedNote?: string;
  supportContext?: string;
}

export function isOpenAiConversationStateEnabled(provider: string): boolean {
  if (provider.toLowerCase() !== "openai") return false;
  const raw = process.env.OPENAI_CONVERSATION_STATE_ENABLED;
  if (raw !== undefined && raw.trim() !== "") {
    return /^(1|true|yes|on)$/i.test(raw);
  }
  const runtimeMode = String(process.env.SAYNEXT_RUNTIME_MODE || process.env.SAYNEXT_MODE || "local").toLowerCase();
  return runtimeMode === "travel" || runtimeMode === "vps" || runtimeMode === "remote";
}

export function shouldCommitTranscriptToOpenAiConversation(reason: TranscriptCommitReason): boolean {
  return reason === "final";
}

export function buildOpenAiConversationInput(latestTranscript: string, options: OpenAiConversationInputOptions = {}): string {
  const lines = [
    options.outputLanguage?.trim() ? `Language: ${options.outputLanguage.trim()}` : "",
    options.promptMode?.trim() ? `Mode: ${options.promptMode.trim()}` : "",
    options.answerStrategy?.trim()
      ? `Strategy: ${options.answerStrategy.trim()}`
      : options.answerIntent?.trim()
        ? `Intent: ${options.answerIntent.trim()}`
        : "",
    options.taskHint?.trim() ? `Task: ${options.taskHint.trim()}` : "",
    options.supportContext?.trim() ? `Relevant context candidates, use only if helpful:\n${options.supportContext.trim()}` : "",
    options.preparedNote?.trim() ? `Prepared note:\n${options.preparedNote.trim()}` : "",
    options.transcriptContext?.trim()
      ? `Transcript context since last request, use as background only:\n${options.transcriptContext.trim()}`
      : "",
    `Transcript: ${latestTranscript.trim()}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildOpenAiConversationCreatePayload(options: {
  userId: string;
  sessionId: string;
  seedInstructions?: string;
}): OpenAiConversationCreatePayload {
  const payload: OpenAiConversationCreatePayload = {
    metadata: {
      userHash: metadataHash(options.userId),
      sessionHash: metadataHash(options.sessionId),
      purpose: "session_clean_transcript_state",
    },
  };
  const seedInstructions = options.seedInstructions?.trim();
  if (seedInstructions) {
    payload.items = [
      {
        type: "message",
        role: "developer",
        content: seedInstructions,
      },
    ];
  }
  return payload;
}

export function buildOpenAiConversationPayload(options: {
  model: string;
  conversationId: string;
  latestTranscript: string;
  inputOptions?: OpenAiConversationInputOptions;
}): OpenAiConversationPayload {
  return {
    model: options.model,
    conversation: options.conversationId,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildOpenAiConversationInput(options.latestTranscript, options.inputOptions),
          },
        ],
      },
    ],
    temperature: 0.35,
  };
}

export function extractResponseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text.trim();

  const texts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const contentItem of item?.content ?? []) {
      if (typeof contentItem?.text === "string") texts.push(contentItem.text);
    }
  }

  return texts.join("\n").trim();
}

export function extractOutputItemIds(data: any): string[] {
  const ids: string[] = [];
  for (const item of data?.output ?? []) {
    if (typeof item?.id === "string" && item.id.trim()) {
      ids.push(item.id.trim());
    }
  }
  return ids;
}

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return apiKey;
}

function metadataHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAiConversationSession {
  private conversationId: string | null = null;
  private conversationCreatePromise: Promise<string> | null = null;
  private cleanupQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly metadata: {
      userId: string;
      sessionId: string;
    },
  ) {}

  get id(): string | null {
    return this.conversationId;
  }

  async generate(options: OpenAiConversationGenerateOptions): Promise<OpenAiConversationGenerateResult> {
    await this.waitForCleanup();
    const conversationId = await this.ensureConversation(options.timeoutMs, options.seedInstructions);
    const apiKey = getOpenAiApiKey();
    const payload = buildOpenAiConversationPayload({
      model: options.model,
      conversationId,
      latestTranscript: options.latestTranscript,
      inputOptions: {
        outputLanguage: options.outputLanguage,
        promptMode: options.promptMode,
        answerIntent: options.answerIntent,
        answerStrategy: options.answerStrategy,
        taskHint: options.taskHint,
        transcriptContext: options.transcriptContext,
        supportContext: options.supportContext,
        preparedNote: options.preparedNote,
      },
    });

    const response = await fetchWithTimeout(
      OPENAI_RESPONSES_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      options.timeoutMs,
    );

    if (!response.ok) {
      throw new Error(`OpenAI conversation response failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const outputItemIds = extractOutputItemIds(data);
    this.scheduleOutputCleanup(conversationId, outputItemIds);

    return {
      text: extractResponseText(data),
      conversationId,
      responseId: typeof data?.id === "string" ? data.id : undefined,
      deletedOutputItemIds: outputItemIds,
    };
  }

  reset(): void {
    this.conversationId = null;
    this.conversationCreatePromise = null;
    this.cleanupQueue = Promise.resolve();
  }

  async warmup(timeoutMs: number, seedInstructions?: string): Promise<string> {
    return this.ensureConversation(timeoutMs, seedInstructions);
  }

  private async ensureConversation(timeoutMs: number, seedInstructions?: string): Promise<string> {
    if (this.conversationId) return this.conversationId;
    if (this.conversationCreatePromise) return this.conversationCreatePromise;

    this.conversationCreatePromise = this.createConversation(timeoutMs, seedInstructions)
      .then((conversationId) => {
        this.conversationId = conversationId;
        return conversationId;
      })
      .finally(() => {
        this.conversationCreatePromise = null;
      });

    return this.conversationCreatePromise;
  }

  private async createConversation(timeoutMs: number, seedInstructions?: string): Promise<string> {
    const apiKey = getOpenAiApiKey();
    const response = await fetchWithTimeout(
      OPENAI_CONVERSATIONS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildOpenAiConversationCreatePayload({
          userId: this.metadata.userId,
          sessionId: this.metadata.sessionId,
          seedInstructions,
        })),
      },
      timeoutMs,
    );

    if (!response.ok) {
      throw new Error(`OpenAI conversation create failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    if (typeof data?.id !== "string" || !data.id.trim()) {
      throw new Error("OpenAI conversation create returned no id");
    }

    return data.id.trim();
  }

  private scheduleOutputCleanup(conversationId: string, outputItemIds: string[]): void {
    if (outputItemIds.length === 0) return;
    if (/^(1|true|yes|on)$/i.test(process.env.OPENAI_CONVERSATION_KEEP_ASSISTANT_OUTPUTS || "")) return;

    this.cleanupQueue = this.cleanupQueue
      .catch(() => undefined)
      .then(async () => {
        const apiKey = getOpenAiApiKey();
        for (const itemId of outputItemIds) {
          const response = await fetchWithTimeout(
            `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            },
            OPENAI_CONVERSATION_CLEANUP_DELETE_TIMEOUT_MS,
          );
          if (!response.ok) {
            console.warn(`OpenAI conversation output cleanup failed for ${itemId}: ${response.status} ${await response.text()}`);
          }
        }
      });
  }

  private async waitForCleanup(): Promise<void> {
    try {
      await Promise.race([
        this.cleanupQueue,
        sleep(OPENAI_CONVERSATION_CLEANUP_WAIT_TIMEOUT_MS).then(() => {
          throw new Error(`cleanup wait timed out after ${OPENAI_CONVERSATION_CLEANUP_WAIT_TIMEOUT_MS}ms`);
        }),
      ]);
    } catch (error) {
      console.warn(`OpenAI conversation cleanup queue skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
