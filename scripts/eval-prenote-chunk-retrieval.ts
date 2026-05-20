import { conversationLogger } from "../src/server/data/conversation-logger";
import { buildLosslessRuntimeContext } from "../src/server/prenotes/prenote-processor";

const userId = process.argv[2] || `eval-prenote-${Date.now()}`;
const title = `Eval Prenote Chunk Retrieval ${Date.now()}`;

const sections = [
  `# Presentation Rubric
CRITICAL_PRESENTATION_RUBRIC: The final presentation grading depends on a rollback plan, exact API contract, and privacy risk mitigation.
The team should explain what happens if deployment fails, which request and response fields are stable, and how uploaded files or transcripts are protected.`,
  Array.from({ length: 80 }, (_, index) => `Filler project note ${index}: this line exists to force chunking and should not be used as a summary.`).join("\n"),
  `# AWS Lambda Operations
CRITICAL_LAMBDA_COLD_START: Lambda cold starts are reduced by smaller packages, avoiding heavy initialization, using provisioned concurrency when latency matters, and keeping dependencies lean.
API Gateway should validate request shape before invoking the function when possible.`,
  Array.from({ length: 80 }, (_, index) => `More unrelated filler ${index}: parking, UI, meeting, notes, placeholder text.`).join("\n"),
  `# Deep Learning Regularization
CRITICAL_DEEP_LEARNING: Dropout randomly disables activations during training, which reduces co-adaptation and helps the model generalize.
Batch normalization stabilizes activation distributions and can allow higher learning rates.`,
].join("\n\n");

const cases = [
  {
    id: "presentation_rubric",
    query: "What does the final presentation grading depend on?",
    expect: "CRITICAL_PRESENTATION_RUBRIC",
    reject: "CRITICAL_LAMBDA_COLD_START",
  },
  {
    id: "lambda_cold_start",
    query: "How should I explain lambda cold start optimization?",
    expect: "CRITICAL_LAMBDA_COLD_START",
    reject: "CRITICAL_DEEP_LEARNING",
  },
  {
    id: "deep_learning_dropout",
    query: "Why does dropout help deep learning generalization?",
    expect: "CRITICAL_DEEP_LEARNING",
    reject: "CRITICAL_PRESENTATION_RUBRIC",
  },
  {
    id: "negative_unrelated_food",
    query: "What is my favorite food for casual daily chat?",
    expect: "",
    reject: "CRITICAL_PRESENTATION_RUBRIC",
  },
];

const prenote = conversationLogger.createPrenote({
  userId,
  title,
  sourceText: sections,
  contentHash: `eval-${Date.now()}`,
});

if (!prenote) {
  throw new Error("Failed to create eval prenote");
}

conversationLogger.updatePrenoteProcessing(prenote.id, {
  status: "ready",
  extractedText: sections,
  processedJson: JSON.stringify({ title, eval: true }),
  runtimeContext: buildLosslessRuntimeContext(title, sections),
  model: "eval",
  contentHash: `eval-${Date.now()}`,
});
conversationLogger.setPrenoteActive(userId, prenote.id, true);

let failed = 0;
try {
  const chunks = await conversationLogger.rebuildPrenoteChunks(prenote.id);
  console.log(`PRENOTE_CHUNK_EVAL user=${userId} chunks=${chunks.length} embeddingModel=${chunks[0]?.embeddingModel || "none"}`);

  for (const mode of ["fast", "semantic"] as const) {
    for (const test of cases) {
      const context = await conversationLogger.getActivePrenoteRuntimeContextForQuery(userId, test.query, mode);
      const hasExpected = test.expect ? context.includes(test.expect) : true;
      const hasRejected = test.reject ? context.includes(test.reject) : false;
      const ok = hasExpected && !hasRejected;
      if (!ok) failed += 1;

      console.log(`\n[${ok ? "OK" : "FAIL"}] ${mode}:${test.id}`);
      console.log(`query: ${test.query}`);
      console.log(`expected: ${test.expect || "(none)"}`);
      console.log(`rejected: ${test.reject || "(none)"}`);
      console.log(`contextChars: ${context.length}`);
      console.log(context.slice(0, 900).replace(/\n{3,}/g, "\n\n"));
    }
  }
} finally {
  conversationLogger.deletePrenote(userId, prenote.id);
}

if (failed > 0) {
  console.error(`PRENOTE_CHUNK_EVAL_FAILED failed=${failed}`);
  process.exit(1);
}

console.log("\nPRENOTE_CHUNK_EVAL_DONE failed=0");
