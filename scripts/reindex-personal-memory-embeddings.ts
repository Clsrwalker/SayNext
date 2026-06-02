import { conversationLogger } from "../src/server/data/conversation-logger";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const positionalUserId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
const userId = argValue("userId") || positionalUserId || "li2897283405@gmail.com";
const limit = Math.max(1, Number(argValue("limit") || 500));
const status = argValue("status") || "active";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const memories = conversationLogger.listPersonalMemories(userId, { status, limit });
  console.log(`[reindex-personal-memory-embeddings] userId=${userId} status=${status} limit=${limit} dryRun=${dryRun ? "true" : "false"} count=${memories.length}`);
  console.log(`[reindex-personal-memory-embeddings] provider=${process.env.PERSONAL_MEMORY_EMBEDDING_PROVIDER || "openai"} model=${process.env.PERSONAL_MEMORY_EMBEDDING_MODEL || "text-embedding-3-small"}`);

  let updated = 0;
  let failed = 0;

  for (const memory of memories) {
    if (dryRun) {
      console.log(`- dry-run id=${memory.id} sourceRef=${memory.sourceRef || "(none)"} current=${memory.embeddingProvider}/${memory.embeddingModel}/${memory.embeddingDimensions ?? memory.embedding.length}`);
      continue;
    }

    try {
      const refreshed = await conversationLogger.refreshPersonalMemoryEmbedding(userId, memory.id);
      if (!refreshed) {
        failed += 1;
        console.log(`- failed id=${memory.id} sourceRef=${memory.sourceRef || "(none)"} reason=not_found`);
        continue;
      }
      updated += 1;
      console.log(`- updated id=${refreshed.id} sourceRef=${refreshed.sourceRef || "(none)"} embedding=${refreshed.embeddingProvider}/${refreshed.embeddingModel}/${refreshed.embeddingDimensions ?? refreshed.embedding.length} status=${refreshed.embeddingStatus}`);
    } catch (error) {
      failed += 1;
      console.log(`- failed id=${memory.id} sourceRef=${memory.sourceRef || "(none)"} error=${error instanceof Error ? error.message : String(error)}`);
      if ((process.env.PERSONAL_MEMORY_EMBEDDING_PROVIDER || "openai").toLowerCase() === "openai") {
        throw error;
      }
    }
  }

  console.log(`[reindex-personal-memory-embeddings] done updated=${updated} failed=${failed}`);
}

await main();
