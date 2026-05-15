import { formatXiangProfileForPrompt, personalSamples, type PersonalSample } from "./samples";

export interface RetrievedSample extends PersonalSample {
  score: number;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "about",
  "and",
  "are",
  "as",
  "can",
  "do",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "just",
  "like",
  "me",
  "my",
  "of",
  "on",
  "or",
  "right",
  "that",
  "the",
  "to",
  "you",
  "your",
]);

function tokenize(text: string): string[] {
  const asciiTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

  const chinesePhraseTokens = Array.from(text.matchAll(/[\u4e00-\u9fff]{2,}/g)).map((match) => match[0]);
  const chineseText = Array.from(text.matchAll(/[\u4e00-\u9fff]/g)).map((match) => match[0]).join("");
  const chineseBigramTokens: string[] = [];
  for (let i = 0; i < chineseText.length - 1; i++) {
    chineseBigramTokens.push(chineseText.slice(i, i + 2));
  }

  return [...asciiTokens, ...chinesePhraseTokens, ...chineseBigramTokens];
}

function countOverlap(queryTokens: string[], sampleTokens: Set<string>): number {
  let overlap = 0;
  for (const token of queryTokens) {
    if (sampleTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function hasAnyToken(tokens: Set<string>, words: string[]): boolean {
  return words.some((word) => tokens.has(word));
}

function scoreSample(queryTokens: string[], sample: PersonalSample): number {
  if (queryTokens.length === 0) return 0;

  const queryTokenSet = new Set(queryTokens);
  const technicalQuery = hasAnyToken(queryTokenSet, [
    "api",
    "app",
    "architecture",
    "aws",
    "backend",
    "cloud",
    "code",
    "coding",
    "database",
    "debugging",
    "deployment",
    "develop",
    "development",
    "engineering",
    "experience",
    "firebase",
    "frontend",
    "interview",
    "job",
    "lambda",
    "project",
    "react",
    "serverless",
    "software",
    "technical",
    "technology",
    "work",
  ]);
  const interviewQuery = hasAnyToken(queryTokenSet, [
    "candidate",
    "experience",
    "hire",
    "interview",
    "job",
    "position",
    "project",
    "role",
    "tell",
    "yourself",
  ]);
  const projectHeavySample =
    sample.tags.some((tag) => ["project", "aws", "cloud", "firebase", "react", "serverless", "elder-album"].includes(tag)) ||
    /\b(project|aws|firebase|react|lambda|dynamodb|api gateway|elder album|dal parking|saynext)\b/i.test(
      `${sample.scene} ${sample.transcript} ${sample.idealAnswer}`,
    );

  const primarySampleText = [
    sample.scene,
    sample.transcript,
    sample.tags.join(" "),
  ].join(" ");
  const secondarySampleText = [
    sample.idealAnswer,
    sample.formalSafeAnswer ?? "",
    sample.styleNotes ?? "",
    sample.avoid?.join(" ") ?? "",
  ].join(" ");

  const primaryOverlap = countOverlap(queryTokens, new Set(tokenize(primarySampleText)));
  const secondaryOverlap = countOverlap(queryTokens, new Set(tokenize(secondarySampleText)));
  const totalOverlap = primaryOverlap + secondaryOverlap;

  if (totalOverlap === 0) return 0;

  const qualityBoost =
    sample.scores.directlySayable && !sample.scores.inventedInfo && !sample.scores.tooOfficial
      ? 0.08
      : 0;

  const primaryScore = primaryOverlap / queryTokens.length;
  const secondaryScore = secondaryOverlap / queryTokens.length;
  const primaryBoost = primaryOverlap > 0 ? 0.12 : 0;

  const projectPenalty = projectHeavySample && !interviewQuery ? (technicalQuery ? 0.18 : 0.45) : 0;

  return primaryScore + secondaryScore * 0.25 + primaryBoost + qualityBoost - projectPenalty;
}

export function retrievePersonalSamples(query: string, limit = 3): RetrievedSample[] {
  const queryTokens = tokenize(query);

  return personalSamples
    .map((sample) => ({
      ...sample,
      score: scoreSample(queryTokens, sample),
    }))
    .filter((sample) => sample.score > 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatRetrievedSamples(samples: RetrievedSample[]): string {
  if (samples.length === 0) {
    return "No personal examples found.";
  }

  return samples
    .map((sample, index) => {
      return [
        `Example ${index + 1}:`,
        `Scene: ${sample.scene}`,
        `Transcript: ${sample.transcript}`,
        `Ideal answer: ${sample.idealAnswer}`,
        sample.formalSafeAnswer ? `Formal-safe answer: ${sample.formalSafeAnswer}` : "",
        sample.styleNotes ? `Style notes: ${sample.styleNotes}` : "",
        sample.avoid?.length ? `Avoid: ${sample.avoid.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export { formatXiangProfileForPrompt };
