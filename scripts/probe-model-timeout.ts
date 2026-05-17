import { EventMemoryManager } from "../src/server/memory/event-memory";
import { processConversation } from "../src/server/mastra/agents/initial-agent";

const userId = process.argv[2] || "li2897283405@gmail.com";
const provider = process.env.LLM_PROVIDER || "openai";
const startedAt = Date.now();

try {
  const eventMemory = new EventMemoryManager(userId, `timeout-probe-${provider}-${startedAt}`, false);
  const snapshot = eventMemory.addTranscript(
    "Can you explain a small technical trade-off in a simple way?",
    startedAt,
  );

  const response = await processConversation(
    [{ type: "transcript", text: "Can you explain a small technical trade-off in a simple way?", timestamp: startedAt }],
    "high",
    snapshot,
    "english",
    "",
    "",
    "",
  );

  console.log(JSON.stringify({
    ok: true,
    provider,
    durationMs: Date.now() - startedAt,
    outputLength: response.type === "insight" ? response.output.length : 0,
    responseType: response.type,
  }));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    provider,
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
}
