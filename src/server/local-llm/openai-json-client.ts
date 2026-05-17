const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 180000;

export interface OpenAiJsonGenerateOptions {
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = options.model || getSessionMemoryOpenAiModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const system = [
    options.system,
    "Return valid JSON only. Do not include markdown, explanation, or extra text.",
  ].filter(Boolean).join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: controller.signal,
    body: JSON.stringify({
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
      temperature: options.temperature ?? 0.05,
    }),
  }).finally(() => clearTimeout(timeout));

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
