import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processPrenote } from "../src/server/prenotes/prenote-processor";
import { queuePrenoteKnowledgeReview } from "../src/server/prenotes/prenote-review";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const userId = `eval-prenote-review-${Date.now()}`;
const outDir = join("data", "eval");

const sourceText = [
  "# Prenote Review Flow Eval",
  "",
  "PRENOTE_REVIEW_FLOW_FACT: Uploaded prenote material must become a pending Memory Review candidate first, not active long-term memory.",
  "",
  "PRENOTE_REVIEW_FLOW_RETRIEVAL: After user review and promotion, the promoted memory should be retrievable for questions about prenote upload review policy.",
].join("\n");

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const processed = await processPrenote({
    title: "Prenote Review Flow Eval",
    sourceText,
    files: [],
  });

  const prenote = conversationLogger.createPrenote({
    userId,
    title: "Prenote Review Flow Eval",
    sourceText,
    contentHash: processed.contentHash,
  }) ?? fail("failed to create prenote");

  const createdIds: { candidateId?: number; memoryId?: number } = {};
  const rows: string[] = [];

  try {
    conversationLogger.updatePrenoteProcessing(prenote.id, {
      status: "ready",
      extractedText: processed.extractedText,
      processedJson: processed.processedJson,
      runtimeContext: processed.runtimeContext,
      model: processed.model,
      contentHash: processed.contentHash,
      error: "",
    });
    conversationLogger.setPrenoteActive(userId, prenote.id, true);
    await conversationLogger.rebuildPrenoteChunks(prenote.id);

    const beforeMemories = conversationLogger.listPersonalMemories(userId, { status: "all" });
    const candidate = queuePrenoteKnowledgeReview({
      userId,
      prenoteId: prenote.id,
      title: "Prenote review flow policy",
      content: processed.runtimeContext,
      keywords: ["prenote", "review", "memory", "policy"],
    }) ?? fail("failed to queue prenote review candidate");
    createdIds.candidateId = candidate.id;

    const afterQueueMemories = conversationLogger.listPersonalMemories(userId, { status: "all" });
    const pending = conversationLogger.listSessionMemoryCandidates(userId, {
      sessionId: `prenote:${prenote.id}`,
      status: "pending",
      limit: 10,
    });

    const queuedOnly = beforeMemories.length === afterQueueMemories.length
      && candidate.status === "pending"
      && pending.some((item) => item.id === candidate.id)
      && candidate.candidateType === "knowledge_fact";

    rows.push(`- queuedOnly: ${queuedOnly}`);
    rows.push(`- candidateId: ${candidate.id}`);
    rows.push(`- candidateStatus: ${candidate.status}`);
    rows.push(`- memoryCountBefore: ${beforeMemories.length}`);
    rows.push(`- memoryCountAfterQueue: ${afterQueueMemories.length}`);

    if (!queuedOnly) fail("prenote review candidate was not queued as pending-only");

    const promoted = conversationLogger.promoteSessionMemoryCandidate(userId, candidate.id)
      ?? fail("failed to promote queued candidate");
    createdIds.memoryId = promoted.memory.id;
    conversationLogger.rebuildPersonalMemoryFts(userId);

    const searchResults = conversationLogger.searchPersonalMemoriesHybrid(
      userId,
      "what is the prenote upload review policy before memory promotion",
      3,
    );
    const retrievedPromotedMemory = searchResults.some((memory) => memory.id === promoted.memory.id);
    rows.push(`- promotedMemoryId: ${promoted.memory.id}`);
    rows.push(`- retrievedPromotedMemory: ${retrievedPromotedMemory}`);
    rows.push(`- topResults: ${searchResults.map((memory) => `${memory.id}:${memory.title}`).join(" | ")}`);

    if (!retrievedPromotedMemory) fail("promoted prenote review memory was not retrievable");

    const report = [
      "# Prenote Review Flow Eval",
      "",
      `- timestamp: ${new Date().toISOString()}`,
      `- userId: ${userId}`,
      `- prenoteId: ${prenote.id}`,
      "",
      "## Checks",
      "",
      ...rows,
    ].join("\n");

    const reportPath = join(outDir, `prenote-review-flow-${timestamp}.md`);
    writeFileSync(reportPath, report, "utf8");
    console.log(`PRENOTE_REVIEW_FLOW_REPORT ${reportPath}`);
  } finally {
    if (createdIds.memoryId) conversationLogger.deletePersonalMemory(userId, createdIds.memoryId);
    if (createdIds.candidateId) conversationLogger.deleteSessionMemoryCandidate(userId, createdIds.candidateId);
    conversationLogger.deletePrenote(userId, prenote.id);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
