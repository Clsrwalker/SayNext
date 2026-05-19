import { createHash } from "node:crypto";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";

export type TranscriptCommitReason = "final" | "timeout";

export interface OpenAiConversationGenerateOptions {
  model: string;
  instructions: string;
  latestTranscript: string;
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
  instructions: string;
  input: Array<{
    role: "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
  temperature: number;
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

export function buildOpenAiConversationInput(latestTranscript: string): string {
  return `Transcript: "${latestTranscript.trim()}"`;
}

export function buildOpenAiConversationPayload(options: {
  model: string;
  conversationId: string;
  instructions: string;
  latestTranscript: string;
}): OpenAiConversationPayload {
  return {
    model: options.model,
    conversation: options.conversationId,
    instructions: options.instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildOpenAiConversationInput(options.latestTranscript),
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
    const conversationId = await this.ensureConversation(options.timeoutMs);
    const apiKey = getOpenAiApiKey();
    const payload = buildOpenAiConversationPayload({
      model: options.model,
      conversationId,
      instructions: options.instructions,
      latestTranscript: options.latestTranscript,
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

  async warmup(timeoutMs: number): Promise<string> {
    return this.ensureConversation(timeoutMs);
  }

  private async ensureConversation(timeoutMs: number): Promise<string> {
    if (this.conversationId) return this.conversationId;
    if (this.conversationCreatePromise) return this.conversationCreatePromise;

    this.conversationCreatePromise = this.createConversation(timeoutMs)
      .then((conversationId) => {
        this.conversationId = conversationId;
        return conversationId;
      })
      .finally(() => {
        this.conversationCreatePromise = null;
      });

    return this.conversationCreatePromise;
  }

  private async createConversation(timeoutMs: number): Promise<string> {
    const apiKey = getOpenAiApiKey();
    const response = await fetchWithTimeout(
      OPENAI_CONVERSATIONS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          metadata: {
            userHash: metadataHash(this.metadata.userId),
            sessionHash: metadataHash(this.metadata.sessionId),
            purpose: "session_clean_transcript_state",
          },
        }),
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

    const conversationId = data.id.trim();
    return conversationId;
  }

  private scheduleOutputCleanup(conversationId: string, outputItemIds: string[]): void {
    if (outputItemIds.length === 0) return;
    if (/^(1|true|yes|on)$/i.test(process.env.OPENAI_CONVERSATION_KEEP_ASSISTANT_OUTPUTS || "")) return;

    this.cleanupQueue = this.cleanupQueue
      .catch(() => undefined)
      .then(async () => {
        const apiKey = getOpenAiApiKey();
        for (const itemId of outputItemIds) {
          const response = await fetch(`${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });
          if (!response.ok) {
            console.warn(`OpenAI conversation output cleanup failed for ${itemId}: ${response.status} ${await response.text()}`);
          }
        }
      });
  }

  private async waitForCleanup(): Promise<void> {
    try {
      await this.cleanupQueue;
    } catch (error) {
      console.warn(`OpenAI conversation cleanup queue failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
