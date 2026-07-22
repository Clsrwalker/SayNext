import { performance } from "node:perf_hooks";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { LightweightEvenHubV2ContextAdapter } from "../src/server/evenhub-v2/context-adapter";
import { getDeepSenseInterviewCards } from "../src/server/evenhub-v2/interview-guide";
import { defaultEvenHubV2Settings } from "../src/server/evenhub-v2/protocol";

const userId = process.argv[2]
  || process.env.EVENHUB_V2_MEMORY_USER_ID
  || process.env.DEFAULT_USER_ID
  || "";
if (!userId) {
  throw new Error("Pass a user ID as the first argument or set EVENHUB_V2_MEMORY_USER_ID");
}
const questions = [
  "yeah sure, so uh could you tell me a little bit about yourself",
  "okay nice, can you walk me through SayNext and like what was the hardest technical part",
  "say we need a chatbot for our public site and internal docs, how would you design the RAG pipeline",
  "all right, can you write a TypeScript function that returns the first pair of indexes whose values add up to a target",
  "cool, now walk me through that code and tell me the time and space complexity",
  "what edge cases would you test for that function and why",
  "tell me about a time something broke during integration, like how did you actually narrow it down",
  "last one, why DeepSense and why this full stack AI co-op specifically",
];

const adapter = new LightweightEvenHubV2ContextAdapter({
  memoryUserId: userId,
  memorySearchMode: "lexical",
  interviewCards: getDeepSenseInterviewCards(),
});
const memoryById = new Map(
  conversationLogger
    .listPersonalMemories(userId, { status: "active", limit: 1000 })
    .map((memory) => [memory.id, memory]),
);
const recentQuestions: string[] = [];

for (const [index, question] of questions.entries()) {
  const startedAt = performance.now();
  const context = await adapter.build({
    userId,
    conversationId: "memory-routing-eval",
    currentQuestion: question,
    triggerWindow: question,
    recentTranscript: recentQuestions.slice(-3).map((value) => `Interviewer: ${value}`).join("\n"),
    selectedPrenoteIds: [],
    selectedPrenoteText: "",
    settings: defaultEvenHubV2Settings(),
  });
  const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const memories = context.memoryUsedIds.map((id) => {
    const numericId = Number(id.replace("personal-memory:", ""));
    const memory = memoryById.get(numericId);
    return `${id} ${memory?.title || "unknown"}`;
  });
  console.log(JSON.stringify({
    turn: index + 1,
    question,
    latencyMs,
    memories,
    answerCards: context.interviewAnswerCardIds,
  }));
  recentQuestions.push(question);
}
