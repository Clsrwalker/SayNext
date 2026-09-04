export type OpenAiConversationSession = {
  id: string;
};

export type OpenAiConversationClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export class OpenAiConversationClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  constructor(options: OpenAiConversationClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = (options.baseUrl || "https://api.openai.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs
      ?? Number(process.env.EVENHUB_V2_OPENAI_CONVERSATION_TIMEOUT_MS || 2500);
  }

  async createSession(input: {
    seed: string;
    localConversationId: string;
    userId: string;
    signal?: AbortSignal;
  }): Promise<OpenAiConversationSession> {
    const result = await this.request("/v1/conversations", {
      method: "POST",
      signal: input.signal,
      body: JSON.stringify({
        items: [{
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: input.seed }],
        }],
        metadata: {
          local_conversation_id: input.localConversationId.slice(0, 512),
          user_id: input.userId.slice(0, 512),
        },
      }),
    }) as { id?: unknown };
    if (typeof result.id !== "string" || !result.id) {
      throw new Error("OpenAI conversation create returned no id");
    }
    return { id: result.id };
  }

  async commitCanonicalTurn(input: {
    conversationId: string;
    question: string;
    answerJson: string;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.request(`/v1/conversations/${encodeURIComponent(input.conversationId)}/items`, {
      method: "POST",
      signal: input.signal,
      body: JSON.stringify({
        items: [
          {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `Current authoritative question:\n${input.question.trim()}`,
            }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: input.answerJson }],
          },
        ],
      }),
    });
  }

  async deleteSession(conversationId: string, signal?: AbortSignal): Promise<void> {
    await this.request(`/v1/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
      signal,
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const controller = new AbortController();
    const abortFromExternalSignal = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abortFromExternalSignal();
    else init.signal?.addEventListener("abort", abortFromExternalSignal, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let rejectAborted!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    try {
      controller.signal.throwIfAborted();
      return await Promise.race([aborted, (async () => {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...(init.headers || {}),
          },
        });
        controller.signal.throwIfAborted();
        if (!response.ok) {
          throw new Error(`OpenAI conversation request failed: ${response.status} ${await response.text()}`);
        }
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      })()]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectAborted);
      init.signal?.removeEventListener("abort", abortFromExternalSignal);
    }
  }
}
