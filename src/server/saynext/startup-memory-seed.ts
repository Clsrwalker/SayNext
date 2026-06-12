import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedStartupMemorySeed: string | null = null;

export function getSayNextStartupMemorySeed(): string {
  if (cachedStartupMemorySeed !== null) return cachedStartupMemorySeed;

  const path = join(process.cwd(), "src", "server", "saynext", "startup-memory-seed.md");
  cachedStartupMemorySeed = readFileSync(path, "utf8").trim();
  return cachedStartupMemorySeed;
}

export function estimateSayNextStartupMemorySeedTokens(): number {
  return Math.ceil(getSayNextStartupMemorySeed().length / 4);
}
