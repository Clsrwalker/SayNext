const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 60000;

export interface LocalLlmGenerateOptions {
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  topP?: number;
  numCtx?: number;
  numPredict?: number;
  timeoutMs?: number;
}

export interface LocalLlmJsonResult<T> {
  data: T;
  rawText: string;
  model: string;
}

function getOllamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
}

export function getPipelineOllamaModel(): string {
  return process.env.PIPELINE_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
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

export async function generateLocalText(options: LocalLlmGenerateOptions): Promise<{ text: string; model: string }> {
  const model = options.model || getPipelineOllamaModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const response = await fetch(`${getOllamaBaseUrl()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      system: options.system,
      prompt: options.prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.15,
        top_p: options.topP ?? 0.9,
        num_ctx: options.numCtx ?? 8192,
        num_predict: options.numPredict ?? 1200,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return { text: String(data.response ?? "").trim(), model };
}

export async function generateLocalJson<T>(options: LocalLlmGenerateOptions): Promise<LocalLlmJsonResult<T>> {
  const { text, model } = await generateLocalText({
    ...options,
    system: [
      options.system,
      "Return valid JSON only. Do not include markdown, explanation, or extra text.",
    ].filter(Boolean).join("\n\n"),
  });

  const jsonText = extractJsonObject(text) ?? text;

  try {
    return {
      data: JSON.parse(jsonText) as T,
      rawText: text,
      model,
    };
  } catch (error) {
    throw new Error(`Failed to parse local LLM JSON: ${error instanceof Error ? error.message : String(error)}\nRaw response: ${text}`);
  }
}
