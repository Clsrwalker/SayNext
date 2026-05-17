import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger, type PersonalMemoryRecord } from "../src/server/data/conversation-logger";

type KnowledgeSeed = {
  key: string;
  title: string;
  category: string;
  content: string;
  usageRule: string;
  keywords: string[];
  evidence: string[];
};

type TestCase = {
  group: string;
  query: string;
  expectedKeys: string[];
  shouldPreferKnowledge?: boolean;
};

type PromotedKnowledge = KnowledgeSeed & {
  candidateId: number;
  memory: PersonalMemoryRecord;
};

const args = process.argv.slice(2);
const userId = args.find((arg) => !arg.startsWith("--")) || "li2897283405@gmail.com";
const now = new Date().toISOString().replace(/[:.]/g, "-");
const sessionId = "eval-promoted-safe-knowledge-retrieval";

const seeds: KnowledgeSeed[] = [
  {
    key: "aws-ha-ecommerce",
    title: "AWS HA Low Latency E-Commerce Architecture",
    category: "knowledge_cloud_architecture",
    content: [
      "A highly available, fault-tolerant, low-latency e-commerce application on AWS can use EC2 Auto Scaling groups across multiple Availability Zones, an Application Load Balancer, RDS Multi-AZ, DynamoDB global tables for multi-region low latency, CloudFront for edge caching, EKS for container orchestration, S3 for backups, and least-privilege IAM.",
      "For interviews, explain the design as layers: entry and CDN, compute, database, cache, security, and observability.",
    ].join("\n"),
    usageRule: "Use for AWS architecture, cloud design, e-commerce infrastructure, high availability, low latency, or system design answers.",
    keywords: [
      "aws", "cloud", "ecommerce", "high availability", "low latency", "ec2", "auto scaling",
      "application load balancer", "rds", "multi-az", "dynamodb global tables", "cloudfront", "eks",
    ],
    evidence: [
      "EC2 autoscaling group with multiple AZ",
      "Application load balancer for traffic distribution",
      "DynamoDB global tables",
      "CDN layer caches data and reduces latency",
    ],
  },
  {
    key: "aws-elasticache",
    title: "AWS ElastiCache Database Caching Strategy",
    category: "knowledge_cloud_architecture",
    content: [
      "AWS ElastiCache with Redis or Memcached can cache frequently accessed database data to reduce latency and lower database load.",
      "Do not cache every old or rarely used record because cache storage and invalidation cost can grow. Cache hot reads, define TTLs, and keep invalidation rules clear.",
    ].join("\n"),
    usageRule: "Use for database performance, Redis, Memcached, AWS ElastiCache, caching trade-offs, cost control, and latency optimization.",
    keywords: [
      "aws", "elasticache", "redis", "memcached", "database cache", "mysql", "latency",
      "performance", "ttl", "cache invalidation", "cost optimization",
    ],
    evidence: [
      "Elastic Cache to fast track your speed of the website",
      "do not store very old data into Elastic Cache because that will add up a cost",
    ],
  },
  {
    key: "aws-security-observability",
    title: "AWS Security and Observability Services",
    category: "knowledge_cloud_security",
    content: [
      "AWS cloud applications should keep sensitive secrets in Secrets Manager, store less sensitive configuration in Parameter Store, use CloudTrail for auditing API actions, use VPC Flow Logs to inspect network traffic, and enforce least-privilege IAM policies.",
      "In an interview, connect each service to a concrete risk: leaked credentials, untraceable changes, suspicious network traffic, and excessive permissions.",
    ].join("\n"),
    usageRule: "Use for AWS security, credentials, auditing, IAM, CloudTrail, VPC Flow Logs, and secure cloud architecture answers.",
    keywords: [
      "aws", "security", "secrets manager", "parameter store", "cloudtrail", "vpc flow logs",
      "iam", "least privilege", "audit", "credentials",
    ],
    evidence: [
      "AWS Secrets Manager for API key security",
      "CloudTrail and VPC flow logs for security and monitoring",
    ],
  },
  {
    key: "llm-training-next-token",
    title: "Large Language Model Training and Next Token Prediction",
    category: "knowledge_ai_ml",
    content: [
      "Large language models are trained on massive text datasets. During training, backpropagation adjusts model parameters so the model becomes better at predicting the next token given previous context.",
      "At generation time, the model assigns probabilities to possible next tokens and samples or selects tokens to produce natural language output.",
    ].join("\n"),
    usageRule: "Use for explaining GPT-style models, LLM training, backpropagation, parameters, next-token prediction, and generation.",
    keywords: [
      "llm", "large language model", "gpt", "backpropagation", "parameters", "training",
      "next token", "probability", "text generation", "machine learning", "ai",
    ],
    evidence: [
      "backpropagation is used to tweak all of the parameters",
      "models learn by processing an enormous amount of text",
      "assign a probability to all possible next words",
    ],
  },
];

const tests: TestCase[] = [
  {
    group: "aws_architecture",
    query: "How would you design a highly available low latency e-commerce app on AWS?",
    expectedKeys: ["aws-ha-ecommerce"],
    shouldPreferKnowledge: true,
  },
  {
    group: "aws_architecture",
    query: "What should I say about DynamoDB global tables and CloudFront for low latency?",
    expectedKeys: ["aws-ha-ecommerce"],
    shouldPreferKnowledge: true,
  },
  {
    group: "aws_architecture_asr",
    query: "cloud front dynamo db global table latency ecommerce multi az",
    expectedKeys: ["aws-ha-ecommerce"],
    shouldPreferKnowledge: true,
  },
  {
    group: "cache",
    query: "How can ElastiCache help database performance and cost?",
    expectedKeys: ["aws-elasticache"],
    shouldPreferKnowledge: true,
  },
  {
    group: "cache",
    query: "When should I use Redis or Memcached cache for a database?",
    expectedKeys: ["aws-elasticache"],
    shouldPreferKnowledge: true,
  },
  {
    group: "cache_asr",
    query: "elastic cash database speed old data cost",
    expectedKeys: ["aws-elasticache"],
    shouldPreferKnowledge: true,
  },
  {
    group: "security",
    query: "How do Secrets Manager CloudTrail and VPC Flow Logs help in AWS security?",
    expectedKeys: ["aws-security-observability"],
    shouldPreferKnowledge: true,
  },
  {
    group: "security",
    query: "What AWS services should I mention for API keys auditing network traffic and IAM least privilege?",
    expectedKeys: ["aws-security-observability"],
    shouldPreferKnowledge: true,
  },
  {
    group: "llm",
    query: "How are large language models trained with backpropagation?",
    expectedKeys: ["llm-training-next-token"],
    shouldPreferKnowledge: true,
  },
  {
    group: "llm",
    query: "What does next token prediction mean in GPT style models?",
    expectedKeys: ["llm-training-next-token"],
    shouldPreferKnowledge: true,
  },
  {
    group: "llm_asr",
    query: "llm train back propagation next word probability",
    expectedKeys: ["llm-training-next-token"],
    shouldPreferKnowledge: true,
  },
];

function promoteSeed(seed: KnowledgeSeed): PromotedKnowledge {
  const candidate = conversationLogger.upsertSessionMemoryCandidate({
    userId,
    sessionId,
    candidateType: "knowledge_fact",
    title: seed.title,
    category: seed.category,
    sensitivity: "low",
    content: seed.content,
    usageRule: seed.usageRule,
    keywords: seed.keywords,
    evidence: seed.evidence,
    confidence: 0.95,
    valueScore: 0.9,
    riskScore: 0.02,
    validation: {
      valid: true,
      safeToPromote: true,
      flags: [],
      groundedEvidence: seed.evidence,
      duplicateMemoryRefs: [],
      dateMetadata: {
        eventTime: new Date().toISOString(),
        mentionedDate: null,
        dateSource: "session_time_only",
        dateConfidence: 0.3,
        dateEvidence: [],
      },
      reason: "Eval seed: clean low-risk technical knowledge.",
    },
    status: "pending",
    model: "eval-seed",
    rawJson: JSON.stringify({ seed: seed.key }),
    rejectionReason: "",
  });

  if (!candidate) throw new Error(`Failed to create candidate for ${seed.key}`);
  const promoted = conversationLogger.promoteSessionMemoryCandidate(userId, candidate.id);
  if (!promoted) throw new Error(`Failed to promote candidate for ${seed.key}`);
  return { ...seed, candidateId: candidate.id, memory: promoted.memory };
}

function isKnowledge(memory: { source: string; category: string }): boolean {
  return memory.source === "knowledge" || memory.category.startsWith("knowledge");
}

function isExpected(memory: { id: number; title: string; sourceRef: string }, expected: PromotedKnowledge[]): boolean {
  return expected.some((item) => item.memory.id === memory.id || item.title === memory.title || item.memory.sourceRef === memory.sourceRef);
}

const promoted = seeds.map(promoteSeed);
conversationLogger.rebuildPersonalMemoryFts(userId);

const promotedByKey = new Map(promoted.map((item) => [item.key, item]));
let top1 = 0;
let top3 = 0;
let personalTop1 = 0;
const failures: string[] = [];
const rows = tests.map((test, index) => {
  const expected = test.expectedKeys.map((key) => promotedByKey.get(key)).filter(Boolean) as PromotedKnowledge[];
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, test.query, 5);
  const top = results[0];
  const ok1 = !!top && isExpected(top, expected);
  const ok3 = results.slice(0, 3).some((memory) => isExpected(memory, expected));
  const personalTop = !!top && !isKnowledge(top);

  if (ok1) top1 += 1;
  if (ok3) top3 += 1;
  if (test.shouldPreferKnowledge && personalTop) personalTop1 += 1;

  if (!ok1 || (test.shouldPreferKnowledge && personalTop)) {
    failures.push(`#${index + 1} [${test.group}] ${test.query}
  expected: ${expected.map((item) => item.title).join(" | ")}
  top: ${results.map((memory, rank) => `${rank + 1}. ${memory.sourceRef || `id:${memory.id}`} [${memory.source}/${memory.category}] score=${memory.score.toFixed(4)} title=${memory.title}`).join(" | ") || "none"}`);
  }

  return {
    ...test,
    ok1,
    ok3,
    personalTop,
    results: results.map((memory, rank) => ({
      rank: rank + 1,
      id: memory.id,
      title: memory.title,
      source: memory.source,
      sourceRef: memory.sourceRef,
      category: memory.category,
      score: memory.score,
      lexicalRank: memory.lexicalRank,
      vectorRank: memory.vectorRank,
      keywordScore: memory.keywordScore,
    })),
  };
});

mkdirSync(join("data", "eval"), { recursive: true });
const reportPath = join("data", "eval", `promoted-knowledge-retrieval-${now}.md`);
const jsonPath = join("data", "eval", `promoted-knowledge-retrieval-${now}.json`);

const report = [
  "# Promoted Knowledge Retrieval Eval",
  "",
  `- userId: ${userId}`,
  `- sessionId: ${sessionId}`,
  `- promoted knowledge: ${promoted.length}`,
  `- cases: ${tests.length}`,
  `- top1: ${top1}/${tests.length}`,
  `- top3: ${top3}/${tests.length}`,
  `- personal top1 on technical queries: ${personalTop1}`,
  "",
  "## Promoted Knowledge",
  "",
  ...promoted.map((item) => `- ${item.key}: memoryId=${item.memory.id}, candidateId=${item.candidateId}, sourceRef=${item.memory.sourceRef}, title=${item.memory.title}`),
  "",
  "## Cases",
  "",
  ...rows.flatMap((row, index) => [
    `### ${index + 1}. ${row.group}`,
    "",
    `Query: ${row.query}`,
    "",
    `- top1 expected: ${row.ok1 ? "yes" : "no"}`,
    `- top3 expected: ${row.ok3 ? "yes" : "no"}`,
    `- personal top1: ${row.personalTop ? "yes" : "no"}`,
    "",
    ...row.results.map((memory) => `  ${memory.rank}. ${memory.sourceRef || `id:${memory.id}`} [${memory.source}/${memory.category}] score=${memory.score.toFixed(4)} lexical=${memory.lexicalRank ?? "-"} vector=${memory.vectorRank ?? "-"} keyword=${memory.keywordScore.toFixed(2)} - ${memory.title}`),
    "",
  ]),
  failures.length ? "## Failures" : "## Failures",
  "",
  failures.length ? failures.join("\n\n") : "None.",
  "",
].join("\n");

writeFileSync(reportPath, report, "utf8");
writeFileSync(jsonPath, JSON.stringify({ userId, sessionId, promoted, rows, failures }, null, 2), "utf8");

console.log(`PROMOTED_KNOWLEDGE_RETRIEVAL cases=${tests.length} top1=${top1}/${tests.length} top3=${top3}/${tests.length} personalTop1=${personalTop1}`);
console.log(`Report: ${reportPath}`);

if (failures.length) process.exitCode = 1;
