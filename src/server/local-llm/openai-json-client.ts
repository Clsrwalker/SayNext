const DEFAULT_OPENAI_MODEL = "gpt-5.4-nano";
const DEFAULT_TIMEOUT_MS = 180000;

export interface OpenAiJsonGenerateOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  model?: string;
  system?: string;
  prompt: string;
  conversationId?: string;
  promptCacheKey?: string;
  includeJsonInstruction?: boolean;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  temperature?: number | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OpenAiJsonResult<T> {
  data: T;
  rawText: string;
  model: string;
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function extractResponseText(data: any): string {
  if (typeof data.output_text === "string") return data.output_text.trim();

  const texts: string[] = [];
  for (const item of data.output ?? []) {
    for (const contentItem of item.content ?? []) {
      if (typeof contentItem.text === "string") texts.push(contentItem.text);
    }
  }

  return texts.join("\n").trim();
}

export function getSessionMemoryOpenAiModel(): string {
  return process.env.SESSION_MEMORY_OPENAI_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

export async function generateOpenAiJson<T>(options: OpenAiJsonGenerateOptions): Promise<OpenAiJsonResult<T>> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = options.model || getSessionMemoryOpenAiModel();
  const controller = new AbortController();
  const abortFromExternalSignal = () => controller.abort();
  if (options.signal?.aborted) abortFromExternalSignal();
  else options.signal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const system = [
    options.system,
    options.includeJsonInstruction === false
      ? ""
      : "Return valid JSON only. Do not include markdown, explanation, or extra text.",
  ].filter(Boolean).join("\n\n");

  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: system ? `${system}\n\n${options.prompt}` : options.prompt,
          },
        ],
      },
    ],
  };
  if (options.conversationId) body.conversation = options.conversationId;
  if (options.promptCacheKey) body.prompt_cache_key = options.promptCacheKey;
  if (options.reasoningEffort) {
    body.reasoning = { effort: options.reasoningEffort };
  }
  if (options.temperature !== null) {
    body.temperature = options.temperature ?? 0.05;
  }

  const baseUrl = (options.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const response = await (options.fetchImpl || fetch)(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: controller.signal,
    body: JSON.stringify(body),
  }).finally(() => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromExternalSignal);
  });

  if (!response.ok) {
    throw new Error(`OpenAI JSON request failed: ${response.status} ${await response.text()}`);
  }

  const raw = await response.json();
  const text = extractResponseText(raw);
  const jsonText = extractJsonObject(text) ?? text;

  try {
    return {
      data: JSON.parse(jsonText) as T,
      rawText: text,
      model,
    };
  } catch (error) {
    throw new Error(`Failed to parse OpenAI JSON: ${error instanceof Error ? error.message : String(error)}\nRaw response: ${text}`);
  }
}
