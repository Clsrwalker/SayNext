import type { Context } from "hono";
import { getSayNextRuntimeMode, getSessionMemoryProvider, isSessionMemoryBatchEnabled } from "../config";

export const getHealth = (c: Context) => {
  return c.json({
    status: "ok",
    app: "saynext",
    runtimeMode: getSayNextRuntimeMode(),
    llmProvider: process.env.LLM_PROVIDER || "openai",
    sessionMemoryProvider: getSessionMemoryProvider(),
    sessionMemoryBatchEnabled: isSessionMemoryBatchEnabled(),
    timestamp: new Date().toISOString(),
  });
};
