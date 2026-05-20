import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Conversation, AgentResponse } from "../src/server/mastra/types";

type TurnResult = {
  transcript: string;
  output: string;
  latencyMs: number;
  conversationId?: string;
  fallback?: boolean;
  omittedRecentHistory?: boolean;
};

type SequenceResult = {
  id: string;
  mode: "baseline" | "conversation_state";
  warmupMs?: number;
  turns: TurnResult[];
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");

const sequences = [
  {
    id: "technical_followup",
    turns: [
      "Could you explain Kubernetes in simple words?",
      "Can you give me a small example?",
    ],
  },
  {
    id: "interview_project_followup",
    turns: [
      "What is a technical project you are proud of?",
      "What was the main trade-off in that project?",
    ],
  },
  {
    id: "daily_context_followup",
    turns: [
      "I'm thinking of buying a used monitor for my desk.",
      "What should I check before I pay?",
    ],
  },
];

function getConversationMetadata(response: AgentResponse): Record<string, any> {
  if (response.type !== "insight") return {};
  return response.metadata?.agentInput?.openAiConversation || {};
}

async function runSequence(
  sequence: (typeof sequences)[number],
  mode: "baseline" | "conversation_state",
): Promise<SequenceResult> {
  process.env.OPENAI_CONVERSATION_STATE_ENABLED = mode === "conversation_state" ? "true" : "false";
  const { processConversation } = await import("../src/server/mastra/agents/initial-agent");
  const { OpenAiConversationSession } = await import("../src/server/mastra/agents/openai-conversation-state");

  const session = new OpenAiConversationSession({
    userId: `eval-openai-conversation-${mode}`,
    sessionId: `${sequence.id}-${mode}-${Date.now()}`,
  });
  const conversation: Conversation = [];
  const turns: TurnResult[] = [];
  let warmupMs: number | undefined;

  if (mode === "conversation_state") {
    const start = performance.now();
    await session.warmup(Number(process.env.OPENAI_CONVERSATION_WARMUP_TIMEOUT_MS || 8000));
    warmupMs = Math.round(performance.now() - start);
  }

  for (const transcript of sequence.turns) {
    conversation.push({ type: "transcript", text: transcript, timestamp: Date.now() });
    const start = performance.now();
    const response = await processConversation(
      [...conversation],
      "high",
      undefined,
      "english",
      "",
      "",
      "",
      {
        openAiConversationSession: session,
        transcriptCommitReason: "final",
      },
    );
    const latencyMs = Math.round(performance.now() - start);
    conversation.push(response);
    const meta = getConversationMetadata(response);
    turns.push({
      transcript,
      output: response.type === "insight" ? response.output : response.reasoning,
      latencyMs,
      conversationId: typeof meta.conversationId === "string" ? meta.conversationId : undefined,
      fallback: Boolean(meta.fallback),
      omittedRecentHistory: Boolean(meta.omittedRecentHistoryFromPrompt),
    });
  }

  return { id: sequence.id, mode, warmupMs, turns };
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY is not configured; skipping OpenAI conversation-state eval.");
    return;
  }

  process.env.LLM_PROVIDER = "openai";
  mkdirSync(outDir, { recursive: true });

  const results: SequenceResult[] = [];
  for (const sequence of sequences) {
    results.push(await runSequence(sequence, "baseline"));
    results.push(await runSequence(sequence, "conversation_state"));
  }

  const lines: string[] = [
    "# OpenAI Conversation State Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Purpose: compare current prompt-history mode with OpenAI conversation-per-session mode.",
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.id} / ${result.mode}`, "");
    if (typeof result.warmupMs === "number") lines.push(`Warmup: ${result.warmupMs}ms`, "");
    for (const [index, turn] of result.turns.entries()) {
      lines.push(`### Turn ${index + 1}`);
      lines.push(`Transcript: ${turn.transcript}`);
      lines.push(`Latency: ${turn.latencyMs}ms`);
      if (turn.conversationId) lines.push(`Conversation: ${turn.conversationId}`);
      if (turn.omittedRecentHistory) lines.push("Recent history omitted from prompt: yes");
      if (turn.fallback) lines.push("Fallback: yes");
      lines.push(`Output: ${turn.output}`, "");
    }
  }

  const mdPath = join(outDir, `openai-conversation-state-${timestamp}.md`);
  const jsonPath = join(outDir, `openai-conversation-state-${timestamp}.json`);
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

  console.log(`OpenAI conversation-state eval written: ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
