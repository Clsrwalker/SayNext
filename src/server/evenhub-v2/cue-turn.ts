function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function sameSpokenText(left: string, right: string): boolean {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  return leftWords.length > 0
    && leftWords.length === rightWords.length
    && leftWords.every((word, index) => word === rightWords[index]);
}

export function isLikelyCueReadback(transcript: string, cueOutput: string): boolean {
  const transcriptWords = normalizedWords(transcript);
  const cueWords = normalizedWords(cueOutput);
  if (transcriptWords.length < 5 || cueWords.length < 5) return false;

  const cueCounts = new Map<string, number>();
  for (const word of cueWords) cueCounts.set(word, (cueCounts.get(word) || 0) + 1);

  let overlap = 0;
  for (const word of transcriptWords) {
    const remaining = cueCounts.get(word) || 0;
    if (remaining <= 0) continue;
    overlap += 1;
    cueCounts.set(word, remaining - 1);
  }

  const shorterLength = Math.min(transcriptWords.length, cueWords.length);
  const shorterCoverage = overlap / shorterLength;
  const transcriptCoverage = overlap / transcriptWords.length;
  return shorterCoverage >= 0.72 && transcriptCoverage >= 0.62;
}
