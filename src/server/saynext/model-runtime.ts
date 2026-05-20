import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { sayNextInstructions, telepromptInstructions } from "./prompts";

export function resolveOpenAiModelConfig(env: NodeJS.ProcessEnv = process.env): {
  liveModel: string;
  longModel: string;
} {
  return {
    liveModel: env.OPENAI_MODEL || env.MODEL_NAME || "gpt-5.4-nano",
    longModel: env.OPENAI_LONG_MODEL || env.OPENAI_HIGH_RISK_MODEL || env.OPENAI_FALLBACK_MODEL || "gpt-5.4-mini",
  };
}

const OPENAI_MODEL_CONFIG = resolveOpenAiModelConfig();

export const MODEL_NAME = OPENAI_MODEL_CONFIG.liveModel;
export const LONG_MODEL_NAME = OPENAI_MODEL_CONFIG.longModel;
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
export const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || process.env.MODEL_TIMEOUT_MS || 30000);
export const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();
export const ACTIVE_MODEL_NAME = LLM_PROVIDER === "ollama" ? OLLAMA_MODEL : MODEL_NAME;

export const initialAgentHigh = new Agent({
  name: "SayNextAgentHigh",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions,
});

export const initialAgentMedium = new Agent({
  name: "SayNextAgentMedium",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions,
});

export const initialAgentLow = new Agent({
  name: "SayNextAgentLow",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions,
});

export const telepromptAgent = new Agent({
  name: "SayNextTelepromptAgent",
  model: openai(LONG_MODEL_NAME),
  instructions: telepromptInstructions,
});

export async function generateWithOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: `${sayNextInstructions}\n\nDo not return JSON for Ollama. Return only the short useful text to show on the display.`,
      prompt: `${prompt}\n\nReturn only one short useful text. Use 2-4 short sentences if a professional or academic question needs depth. Obey the Output language exactly. If Output language is English, do not output Chinese. No JSON. No labels. No reasoning.`,
      stream: false,
      options: {
        temperature: 0.35,
        top_p: 0.9,
        num_ctx: 4096,
        num_predict: 120,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "");
}

export async function generateOptionalContinuationWithOllama(prompt: string): Promise<string> {
  const timeoutMs = Math.min(
    OLLAMA_TIMEOUT_MS,
    Number(process.env.READBACK_CONTINUATION_MODEL_TIMEOUT_MS || 8000),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: `${sayNextInstructions}\n\nReturn only the next optional sentence Xiang can say, or NO_CONTINUATION. No JSON. No labels.`,
      prompt: `${prompt}\n\nReturn only one short optional continuation sentence, or NO_CONTINUATION. No JSON. No labels. No reasoning.`,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.85,
        num_ctx: 3072,
        num_predict: 55,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama readback continuation request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "");
}

export async function withModelTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function generateLongWithOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(OLLAMA_TIMEOUT_MS, 60000));

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: telepromptInstructions,
      prompt,
      stream: false,
      options: {
        temperature: 0.45,
        top_p: 0.9,
        num_ctx: 4096,
        num_predict: 420,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama teleprompt request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "");
}
