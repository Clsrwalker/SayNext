import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation, type OutputLanguage } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import { shouldStartTeleprompt } from "../src/server/teleprompt/teleprompt-runtime";

const userId = process.argv[2] || "li2897283405@gmail.com";
const limitArg = Number(process.argv[3] || 0);
const transcriptPath = process.argv[4] && !process.argv[4].startsWith("--")
  ? process.argv[4]
  : "docs/lecture_transcript.md";

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const seedArg = optionValue("--seed") || "lecture-auto-v1";
const generatedArg = Number(optionValue("--generated") || 47);

type LectureCase = {
  id: string;
  latest: string;
  history?: string[];
  anchor: string;
  kind: "direct_question" | "lecture_statement" | "teacher_style";
  expectedStart: ReturnType<typeof shouldStartTeleprompt>;
  expectAny?: string[];
  rejectAny?: string[];
  forbiddenMemoryRefs?: string[];
  expectNoPersonalMemory?: boolean;
  maxWords?: number;
  language?: OutputLanguage;
  note: string;
};

type CaseResult = {
  test: LectureCase;
  sourceSnippet: string;
  startActual: ReturnType<typeof shouldStartTeleprompt>;
  memoryRefs: string[];
  output: string;
  flags: string[];
};

const rawLecture = readFileSync(transcriptPath, "utf8");
const normalizedLecture = rawLecture.replace(/\s+/g, " ").trim();

function createSeededRandom(seed: string): () => number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: string): T[] {
  const random = createSeededRandom(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return compact(text).split(/\s+/).filter(Boolean).length;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function isPersonalOrProjectMemoryRef(ref: string): boolean {
  const normalized = ref.toLowerCase();
  return normalized.startsWith("xiang-")
    || normalized.startsWith("doc:resume")
    || normalized.startsWith("doc:saynext")
    || normalized.startsWith("doc:elderalbum")
    || normalized.startsWith("doc:joblens")
    || normalized.startsWith("doc:dalparkaid");
}

function memoryRefMatches(ref: string, matcher: string): boolean {
  const normalizedRef = ref.toLowerCase();
  const normalizedMatcher = matcher.toLowerCase();
  return normalizedRef === normalizedMatcher
    || normalizedRef.startsWith(normalizedMatcher)
    || normalizedRef.includes(normalizedMatcher);
}

function sourceSnippet(anchor: string, radius = 380): string {
  const lower = normalizedLecture.toLowerCase();
  const index = lower.indexOf(anchor.toLowerCase());
  if (index < 0) return "";
  return compact(normalizedLecture.slice(Math.max(0, index - radius), Math.min(normalizedLecture.length, index + anchor.length + radius)));
}

function splitLectureSegments(): string[] {
  return normalizedLecture
    .split(/(?<=[.!?])\s+/)
    .map(compact)
    .filter((segment) => {
      const words = wordCount(segment);
      return words >= 8 && words <= 55;
    });
}

type TopicRule = {
  name: string;
  terms: string[];
  expectAny: string[];
  rejectAny?: string[];
};

const topicRules: TopicRule[] = [
  {
    name: "supervised",
    terms: ["supervised learning", "right answers", "labels", "output labels", "spam filtering", "house price"],
    expectAny: ["label", "input", "output", "generalize", "example"],
  },
  {
    name: "unsupervised",
    terms: ["unsupervised learning", "clustering", "unlabeled data", "anomaly detection", "structure in the data"],
    expectAny: ["cluster", "structure", "label", "pattern", "similar"],
  },
  {
    name: "reinforcement",
    terms: ["reinforcement learning", "reward", "agent", "actions", "trial and error", "robotics"],
    expectAny: ["reward", "action", "agent", "policy", "feedback"],
  },
  {
    name: "cloud_containers",
    terms: ["containerd", "docker", "container registry", "kubernetes", "config map", "configmap", "secret manager", "emptydir"],
    expectAny: ["container", "configuration", "secret", "runtime", "kubernetes"],
  },
  {
    name: "object_storage",
    terms: ["object storage", "what is an object", "s3 path", "s3 source", "image data, audio data", "files, but now what is an object"],
    expectAny: ["object", "metadata", "file", "storage", "s3"],
  },
  {
    name: "computer_vision",
    terms: ["computer vision", "image classification", "pixels", "cnn"],
    expectAny: ["image", "feature", "pixel", "class", "model"],
  },
  {
    name: "prompting",
    terms: ["prompt", "prompt engineering", "in-context learning", "few-shot", "chain of thought", "language model"],
    expectAny: ["prompt", "example", "context", "model", "clear"],
  },
  {
    name: "rag",
    terms: ["rag", "retrieval", "vector database", "enterprise content", "embedding", "chunks"],
    expectAny: ["retrieve", "relevant", "vector", "chunk", "prompt"],
  },
  {
    name: "cloud_architecture",
    terms: ["cloud", "aws", "auto-scaling", "load balancer", "sqs", "sns", "multi-az", "cloudfront", "iam", "lambda"],
    expectAny: ["scaling", "load", "availability", "security", "cost", "managed"],
  },
  {
    name: "streaming_kinesis_kafka",
    terms: ["kinesis", "kds", "kafka", "partition key", "shard", "consumer group", "offset tracking", "broker", "topic", "partition"],
    expectAny: ["stream", "partition", "shard", "consumer", "offset"],
  },
  {
    name: "lambda_kinesis_s3",
    terms: ["lambda handler", "event and context", "kinesis.putrecord", "boto3", "cloudwatch logs", "lambda layer", "docker image", "s3 put object"],
    expectAny: ["lambda", "event", "trigger", "s3", "cloudwatch"],
  },
  {
    name: "cicd_aws",
    terms: ["codecommit", "codebuild", "codedeploy", "codepipeline", "buildspec", "appspec", "codedeploy agent", "deployment group"],
    expectAny: ["pipeline", "build", "deploy", "artifact", "role"],
  },
  {
    name: "vpc_networking",
    terms: ["vpc", "subnet", "route table", "internet gateway", "private subnet", "public subnet", "gateway endpoint", "interface endpoint"],
    expectAny: ["vpc", "subnet", "route", "security", "network"],
  },
  {
    name: "security_group_nacl",
    terms: ["security group", "network acl", "nacl", "stateful", "stateless", "inbound", "outbound", "allow and deny"],
    expectAny: ["stateful", "stateless", "rule", "inbound", "outbound"],
  },
  {
    name: "route53_dns",
    terms: ["route 53", "dns", "simple routing", "latency routing", "geolocation", "health check", "domain name"],
    expectAny: ["dns", "route", "health", "latency", "domain"],
  },
  {
    name: "compute_choice",
    terms: ["ec2", "lambda", "ecs", "eks", "fargate", "beanstalk", "compute service", "it depends on your use case"],
    expectAny: ["use case", "control", "serverless", "container", "virtual machine"],
  },
  {
    name: "ec2_ami_instance",
    terms: ["ami", "amazon machine image", "instance type", "t3 micro", "golden ami", "marketplace ami", "community ami"],
    expectAny: ["ami", "instance", "image", "cpu", "memory"],
  },
  {
    name: "security",
    terms: ["security", "secure", "iam", "vpc", "encrypt", "data at rest", "public internet"],
    expectAny: ["identity", "network", "data", "encrypt", "layer"],
  },
  {
    name: "data",
    terms: ["database", "data management", "caching", "redis", "ttl", "storage", "latency"],
    expectAny: ["data", "latency", "cache", "database", "trade-off"],
  },
];

function topicFor(text: string): TopicRule | undefined {
  const normalized = text.toLowerCase();
  return topicRules.find((rule) => rule.terms.some((term) => normalized.includes(term)));
}

function isLikelyLectureQuestion(segment: string): boolean {
  const normalized = segment.toLowerCase();
  if (!segment.includes("?")) return false;
  if (wordCount(segment) > 40) return false;
  return /\b(can somebody|does anybody|anybody|what is|what are|why|how|can people think|give other examples|any questions)\b/i.test(normalized);
}

function isLikelyLectureStatement(segment: string): boolean {
  if (segment.includes("?")) return false;
  if (!topicFor(segment)) return false;
  if (/^(okay|yes|no|good|very good)[,. ]/i.test(segment)) return false;
  return wordCount(segment) >= 12 && wordCount(segment) <= 46;
}

function previousSegmentFor(segments: string[], index: number): string[] {
  const previous = segments[index - 1];
  if (!previous || wordCount(previous) > 45) return [];
  return [previous];
}

function makeAutoCase(segment: string, index: number, sourceIndex: number, kind: LectureCase["kind"], history: string[] = []): LectureCase {
  const topic = topicFor(segment);
  const idTopic = topic?.name || "general";
  const question = kind === "direct_question";
  return {
    id: `auto_${String(index + 1).padStart(3, "0")}_${idTopic}_${question ? "question" : "statement"}`,
    kind,
    anchor: segment.slice(0, Math.min(90, segment.length)),
    latest: segment,
    history,
    expectedStart: question ? "expandable" : "none",
    // Auto cases are sampled from noisy real lecture ASR, so term-level answer
    // checks are too brittle. Keep the auto test focused on process: memory
    // isolation, teleprompt decision, length, and conversational tone.
    expectAny: undefined,
    rejectAny: ["saynext", "my project", "yeah that makes sense"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: question ? 65 : 70,
    note: `Auto-sampled from real lecture transcript near segment ${sourceIndex}. Check process, memory isolation, and classroom tone.`,
  };
}

function generateAutoCases(count: number, seed: string): LectureCase[] {
  if (count <= 0) return [];
  const segments = splitLectureSegments();
  const candidates = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => isLikelyLectureQuestion(segment) || isLikelyLectureStatement(segment));
  const selected = shuffle(candidates, seed);
  const cases: LectureCase[] = [];
  const seen = new Set<string>();

  for (const item of selected) {
    if (cases.length >= count) break;
    const normalized = item.segment.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const fingerprint = normalized.slice(0, 120);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const kind: LectureCase["kind"] = isLikelyLectureQuestion(item.segment) ? "direct_question" : "lecture_statement";
    cases.push(makeAutoCase(item.segment, cases.length, item.index, kind, previousSegmentFor(segments, item.index)));
  }

  return cases;
}

function makeEventMemory(test: LectureCase): EventMemorySnapshot {
  const recentTranscripts = [...(test.history ?? []), test.latest];
  return {
    eventId: `lecture-transcript-${test.id}`,
    scene: "classroom",
    title: "Real lecture transcript eval",
    summary: "source=lecture_transcript real classroom lecture. Treat professor monologue as classroom explanation. Do not use Xiang personal/project memory unless Xiang is directly asked.",
    transcriptCount: recentTranscripts.length,
    aiReplyCount: 0,
    recentTranscripts,
  };
}

function formatClassroomProfile(): string {
  const profile = conversationLogger.listSceneProfiles(userId).find((item) => item.name === "Classroom");
  const prompt = profile?.prompt || "Classroom: answer direct concept questions; for lecture statements add one useful supplement.";
  return `Active scene profile: Classroom\n${prompt}`;
}

const baseCases: LectureCase[] = [
  {
    id: "supervised_learning_question",
    kind: "direct_question",
    anchor: "So can somebody say what is supervised learning?",
    history: ["The professor is reviewing supervised, unsupervised, and reinforcement learning."],
    latest: "So can somebody say what is supervised learning?",
    expectedStart: "expandable",
    expectAny: ["label", "input", "output", "correct", "mapping"],
    rejectAny: ["saynext", "my project", "yeah that makes sense"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 55,
    note: "Direct professor question should get a short sayable concept answer.",
  },
  {
    id: "supervised_learning_statement",
    kind: "lecture_statement",
    anchor: "learning from the correct answers",
    latest: "Supervised learning is like learning from the correct answers. You have inputs and output labels and learn a function that maps between them.",
    expectedStart: "none",
    expectAny: ["unseen", "generalize", "label", "new"],
    rejectAny: ["saynext", "my project", "yeah", "i like"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 55,
    note: "Lecture statement should become a useful supplement, not a restatement.",
  },
  {
    id: "supervised_examples_question",
    kind: "direct_question",
    anchor: "Can somebody give other examples of applications which could be well modeled as a supervised learning problem",
    latest: "Can somebody give other examples of applications which could be well modeled as a supervised learning problem?",
    expectedStart: "expandable",
    expectAny: ["house", "spam", "label", "price", "example"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should answer with concrete examples like the lecture tone.",
  },
  {
    id: "unsupervised_learning_statement",
    kind: "lecture_statement",
    anchor: "finding structure in unlabeled data",
    latest: "Unsupervised learning is finding structure in unlabeled data. There are no labels, you just have the data.",
    expectedStart: "none",
    expectAny: ["clustering", "structure", "group", "labels"],
    rejectAny: ["saynext", "my project", "classification"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 55,
    note: "Should add the clustering angle instead of repeating the definition.",
  },
  {
    id: "google_news_clustering",
    kind: "lecture_statement",
    anchor: "Google News used to work like this",
    latest: "Google News used clustering to group related news articles based on similar features, titles, topics, and time.",
    expectedStart: "none",
    expectAny: ["same event", "features", "cluster", "similar"],
    rejectAny: ["my project", "saynext"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 55,
    note: "Lecture supplement should connect the example back to unsupervised learning.",
  },
  {
    id: "reinforcement_learning_statement",
    kind: "lecture_statement",
    anchor: "learning from trial and error with evaluative feedback",
    latest: "Reinforcement learning is learning from trial and error with evaluative feedback. The agent observes the state and takes actions to maximize long-term reward.",
    expectedStart: "none",
    expectAny: ["reward", "action", "policy", "trial", "feedback"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should produce one useful RL supplement.",
  },
  {
    id: "chess_supervised_limitation",
    kind: "lecture_statement",
    anchor: "you cannot perform better than the data that you have",
    history: ["The professor is comparing supervised learning and reinforcement learning for chess engines."],
    latest: "If you use supervised learning and try to predict the right answers from expert chess data, you cannot perform better than the data that you have.",
    expectedStart: "none",
    expectAny: ["limitation", "limited", "capped", "imitate", "beyond", "reinforcement", "explore"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should capture the professor's reasoning process: limitation, not just definition.",
  },
  {
    id: "prompt_engineering_statement",
    kind: "lecture_statement",
    anchor: "Prompt engineers bridge the gap between end users and add-ons",
    latest: "Prompt engineering bridges the gap between end users and applications. Developers format open-ended user input into a clearer prompt for the language model.",
    expectedStart: "none",
    expectAny: ["structure", "prompt", "format", "clear", "model"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should not pull SayNext memory just because prompt engineering sounds related.",
  },
  {
    id: "in_context_learning_statement",
    kind: "lecture_statement",
    anchor: "that is called in-context learning",
    latest: "In-context learning means you tell the model, in my application, when I have A, what I want is B.",
    expectedStart: "none",
    expectAny: ["examples", "context", "previous", "messages", "chatbot", "without", "training", "prompt"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should explain the idea in student language.",
  },
  {
    id: "few_shot_learning_statement",
    kind: "lecture_statement",
    anchor: "N is the number of new categories or classes",
    latest: "Few-shot learning: N is the number of categories the model has to learn, and K is the number of labeled examples for each category.",
    expectedStart: "none",
    expectAny: ["example", "category", "label", "few", "prompt"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should make n-way k-shot concrete.",
  },
  {
    id: "rag_enterprise_statement",
    kind: "lecture_statement",
    anchor: "construct your own vector database",
    latest: "RAG can incorporate enterprise information by constructing a vector database and copying relevant enterprise content into application-specific repositories.",
    expectedStart: "none",
    expectAny: ["retrieve", "retrieving", "retrieval", "relevant", "chunks", "embedding", "embeddings", "prompt", "domain"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should explain RAG as retrieval before generation.",
  },
  {
    id: "fine_tuning_practicality",
    kind: "lecture_statement",
    anchor: "fine-tuning is not practical",
    latest: "Most companies do not fine-tune or train their own models because it requires mature data management practices and a lot of resources.",
    expectedStart: "none",
    expectAny: ["data", "cost", "quality", "prompt", "rag", "practical"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should connect data management to why prompt/RAG is often more practical.",
  },
  {
    id: "cloud_security_direction",
    kind: "lecture_statement",
    anchor: "cloud security is very important",
    latest: "Cloud security is becoming important because many applications are developed on the cloud, and organizations need security across every layer.",
    expectedStart: "none",
    expectAny: ["identity", "network", "data", "application", "layer"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should add a professional security layer breakdown.",
  },
];

const lectureTranscript2Cases: LectureCase[] = [
  {
    id: "kds_partition_retention_ordering",
    kind: "lecture_statement",
    anchor: "ordering the records with the same partition key are strictly ordered within a shard",
    latest: "In Kinesis, records are retained for a period of time, and records with the same partition key are strictly ordered within a shard.",
    expectedStart: "none",
    expectAny: ["partition", "shard", "ordering", "retention", "throughput"],
    rejectAny: ["saynext", "my project", "yeah that makes sense"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Lecture statement should add the design tradeoff: partition key affects ordering and load.",
  },
  {
    id: "kafka_consumer_group_offset_question",
    kind: "direct_question",
    anchor: "how do they track which message was read in each partition",
    history: ["The professor is explaining Kafka consumer groups and partition assignment."],
    latest: "How do they track which message was read in each partition?",
    expectedStart: "expandable",
    expectAny: ["offset", "consumer", "partition", "continue", "failure"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Direct lecture question should answer offset tracking, not generic Kafka.",
  },
  {
    id: "kinesis_vs_kafka_question",
    kind: "direct_question",
    anchor: "Let's see Kinesis vs Kafka. When would you use what",
    latest: "Kinesis versus Kafka, when would you use what?",
    expectedStart: "expandable",
    expectAny: ["aws", "managed", "control", "cloud", "kafka"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should explain use-case boundary: AWS-managed simplicity vs Kafka control/cloud-agnostic.",
  },
  {
    id: "firehose_flink_statement",
    kind: "lecture_statement",
    anchor: "Apache Flink is for analyzing streaming data and gain actionable insights",
    latest: "KDS captures real-time data streams, Firehose can load data into data lakes or analytics tools, and Apache Flink can analyze streaming data for actionable insights.",
    expectedStart: "none",
    expectAny: ["firehose", "delivery", "flink", "stateful", "analytics"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should add simple distinction between stream capture, delivery, and stateful analytics.",
  },
  {
    id: "boto3_kinesis_putrecord_question",
    kind: "direct_question",
    anchor: "The stream name",
    latest: "What fields do we need when sending a record to Kinesis using boto3?",
    expectedStart: "expandable",
    expectAny: ["stream", "data", "partition key", "put", "record"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 55,
    note: "Should answer producer API details from tutorial.",
  },
  {
    id: "lambda_layer_docker_statement",
    kind: "lecture_statement",
    anchor: "you want to spin up the docker image such that everything is in that image",
    latest: "Lambda layers help package extra libraries, but if the layer becomes too large or the runtime version is different, a Docker image can be a better deployment option.",
    expectedStart: "none",
    expectAny: ["dependency", "runtime", "layer", "docker", "package"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should add practical packaging tradeoff.",
  },
  {
    id: "cicd_four_roles_question",
    kind: "direct_question",
    anchor: "you only need these four roles to get the CI/CD running",
    latest: "What are the main IAM roles needed to get this AWS CI/CD pipeline running?",
    expectedStart: "expandable",
    expectAny: ["codebuild", "codedeploy", "ec2", "codepipeline", "role"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 70,
    note: "Should retrieve CodeBuild/CodeDeploy/EC2/CodePipeline role details.",
  },
  {
    id: "buildspec_appspec_question",
    kind: "direct_question",
    anchor: "the build spec file",
    latest: "What is the difference between a buildspec file and an appspec file?",
    expectedStart: "expandable",
    expectAny: ["build", "deploy", "artifact", "hook", "script"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should separate CodeBuild build steps from CodeDeploy deployment instructions.",
  },
  {
    id: "vpc_public_private_subnet_question",
    kind: "direct_question",
    anchor: "public subnet and this one is private subnet",
    latest: "What makes a subnet public instead of private in a VPC?",
    expectedStart: "expandable",
    expectAny: ["internet gateway", "route table", "subnet", "public", "private"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should answer routing/internet gateway, not just subnet name.",
  },
  {
    id: "security_group_nacl_difference_question",
    kind: "direct_question",
    anchor: "Security groups and NACOs",
    latest: "What is the difference between security groups and network ACLs?",
    expectedStart: "expandable",
    expectAny: ["stateful", "stateless", "instance", "subnet", "allow"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 70,
    note: "Should answer instance-level stateful allow-only vs subnet-level stateless allow/deny.",
  },
  {
    id: "nacl_rule_order_statement",
    kind: "lecture_statement",
    anchor: "NACO evaluated in a general order to allow traffic from low to high",
    latest: "Network ACL rules are evaluated by rule number from low to high, and the first matching rule takes effect.",
    expectedStart: "none",
    expectAny: ["order", "first", "match", "allow", "deny"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 60,
    note: "Should add why NACL differs from IAM explicit deny behavior.",
  },
  {
    id: "route53_dns_statement",
    kind: "lecture_statement",
    anchor: "Route 53 is a DNS service offered by AWS",
    latest: "Route 53 is AWS's DNS service. It translates domain names to IP addresses, supports routing policies, and can check resource health.",
    expectedStart: "none",
    expectAny: ["dns", "domain", "routing", "health", "latency"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 65,
    note: "Should add routing policies or health-check use, not a generic DNS definition only.",
  },
  {
    id: "compute_choice_question",
    kind: "direct_question",
    anchor: "Choosing the optimal compute service",
    latest: "How do you choose between EC2, Lambda, ECS, EKS, Fargate, and Elastic Beanstalk?",
    expectedStart: "expandable",
    expectAny: ["use case", "control", "serverless", "container", "managed"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 80,
    note: "Should follow the professor's 'it depends on use case' reasoning.",
  },
  {
    id: "ec2_ami_instance_type_question",
    kind: "direct_question",
    anchor: "AMI is Amazon machine image",
    latest: "What is an AMI and how do instance types affect EC2 selection?",
    expectedStart: "expandable",
    expectAny: ["image", "instance", "cpu", "memory", "network"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 75,
    note: "Should combine AMI as template and instance type as resource profile.",
  },
  {
    id: "vpc_endpoint_question",
    kind: "direct_question",
    anchor: "Interface endpoints represent can be can connect your VPC",
    latest: "What is the difference between an interface endpoint and a gateway endpoint?",
    expectedStart: "expandable",
    expectAny: ["private", "s3", "dynamodb", "privatelink", "cost"],
    rejectAny: ["saynext", "my project"],
    forbiddenMemoryRefs: ["xiang-", "doc:"],
    maxWords: 75,
    note: "Should explain PrivateLink/interface vs gateway endpoint for S3/DynamoDB.",
  },
];

function fixedCasesForTranscript(): LectureCase[] {
  return transcriptPath.toLowerCase().includes("lecture_transcript2")
    ? lectureTranscript2Cases
    : baseCases;
}

const cases = fixedCasesForTranscript();

function outputFlags(test: LectureCase, output: string, refs: string[], startActual: ReturnType<typeof shouldStartTeleprompt>): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  const topRefs = refs.slice(0, 3);

  if (startActual !== test.expectedStart) flags.push(`process_start_mismatch:${test.expectedStart}->${startActual}`);
  if (test.expectNoPersonalMemory && refs.some(isPersonalOrProjectMemoryRef)) flags.push(`process_unexpected_personal_memory:${refs.join("|")}`);
  const forbiddenHits = test.forbiddenMemoryRefs?.length
    ? topRefs.filter((ref) => test.forbiddenMemoryRefs?.some((matcher) => memoryRefMatches(ref, matcher)))
    : [];
  if (forbiddenHits.length) flags.push(`process_forbidden_memory:${forbiddenHits.join("|")}`);

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|you could say|answer:|reply:|suggested)/i.test(output)) flags.push("label_or_meta_prefix");
  if (normalized.includes("as an ai")) flags.push("as_an_ai");
  if (test.maxWords && wordCount(output) > test.maxWords) flags.push(`too_long:${wordCount(output)}>${test.maxWords}`);
  if (test.expectAny?.length && !includesAny(output, test.expectAny)) flags.push(`missing_expected:${test.expectAny.join("|")}`);
  if (test.rejectAny?.length && includesAny(output, test.rejectAny)) flags.push(`contains_rejected:${test.rejectAny.join("|")}`);
  if (includesAny(output, ["yeah that makes sense", "sounds good", "that's interesting", "that's great to hear", "really fascinating"])) flags.push("fake_smalltalk");
  if (includesAny(output, ["xiang", "my school", "my course", "my family", "my project"])) flags.push("personal_leak");

  return flags;
}

async function runCase(test: LectureCase): Promise<CaseResult> {
  const timestamp = Date.now();
  const transcripts = [...(test.history ?? []), test.latest];
  const conversation: Conversation = transcripts.map((text, index) => ({
    type: "transcript",
    text,
    timestamp: timestamp + index,
  }));
  const eventMemory = makeEventMemory(test);
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.latest, 3);
  const refs = conversationLogger.searchPersonalMemoriesHybrid(userId, test.latest, 3).map((memory) => memory.sourceRef || memory.title);
  const startActual = shouldStartTeleprompt(test.latest, `${eventMemory.scene} teacher lecture explaining concept`);
  const response = await processConversation(
    conversation,
    "high",
    eventMemory,
    test.language ?? "english",
    "",
    formatClassroomProfile(),
    relevantMemory,
  );
  const output = response.type === "insight" ? response.output : "";
  const flags = outputFlags(test, output, refs, startActual);

  return {
    test,
    sourceSnippet: sourceSnippet(test.anchor),
    startActual,
    memoryRefs: refs,
    output,
    flags,
  };
}

function renderStyleNotes(): string[] {
  return [
    "## Real Lecture Style Notes",
    "",
    "- The teacher often starts from a rough student answer, accepts the useful part, then makes it slightly more precise.",
    "- Explanations usually follow: definition -> one concrete example -> boundary/limitation.",
    "- Good classroom answers should not be polished essays. They should sound like one capable student adding a useful point.",
    "- Useful sentence shapes from the lecture: `The key difference is...`, `A quick example is...`, `One way to think about it is...`, `So the limitation is...`.",
    "- When the professor is explaining, SayNext should add a connection or limitation, not repeat the sentence or fake small talk.",
    "- When the professor asks the class a question, SayNext should give a direct short answer that can be spoken immediately.",
    "",
  ];
}

function writeReport(results: CaseResult[], autoCases: LectureCase[]): string {
  const dir = join(process.cwd(), "data", "eval");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(dir, `lecture-transcript-eval-${stamp}.md`);
  const jsonPath = join(dir, `lecture-transcript-eval-${stamp}.json`);
  const flagged = results.filter((result) => result.flags.length > 0).length;
  const lines = [
    "# Lecture Transcript Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Transcript: ${transcriptPath}`,
    `Characters: ${normalizedLecture.length}`,
    `Seed: ${seedArg}`,
    `Generated cases requested: ${generatedArg}`,
    `Generated cases selected: ${autoCases.length}`,
    `Fixed cases: ${cases.length}`,
    `Cases: ${results.length}`,
    `Flagged: ${flagged}`,
    "",
    ...renderStyleNotes(),
  ];

  for (const [index, result] of results.entries()) {
    lines.push(
      `## ${index + 1}. ${result.test.id} ${result.flags.length ? "[FLAG]" : "[OK]"}`,
      "",
      `- Kind: ${result.test.kind}`,
      `- shouldStartTeleprompt: ${result.startActual}`,
      `- Memory: ${result.memoryRefs.join(" | ") || "none"}`,
      `- Flags: ${result.flags.join(", ") || "none"}`,
      `- Note: ${result.test.note}`,
      "",
      "**Source Snippet**",
      "",
      "```text",
      result.sourceSnippet || "(anchor not found in transcript)",
      "```",
      "",
      "**Latest Transcript**",
      "",
      "```text",
      result.test.latest,
      "```",
      "",
      "**SayNext Output**",
      "",
      "```text",
      result.output,
      "```",
      "",
    );
  }

  writeFileSync(mdPath, lines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ transcriptPath, seed: seedArg, generatedArg, fixedCases: cases.length, autoCases: autoCases.length, results }, null, 2), "utf8");
  return mdPath;
}

const autoCases = generateAutoCases(generatedArg, seedArg);
const allCases = [...cases, ...autoCases];
const selected = limitArg > 0 ? allCases.slice(0, limitArg) : allCases;
const started = Date.now();
const results: CaseResult[] = [];

console.log(`LECTURE_TRANSCRIPT_EVAL provider=${process.env.LLM_PROVIDER || "openai"} model=${process.env.OLLAMA_MODEL || "openai"} cases=${selected.length} fixed=${cases.length} auto=${autoCases.length} seed=${seedArg}`);

for (const [index, test] of selected.entries()) {
  const result = await runCase(test);
  results.push(result);
  console.log(`[${index + 1}/${selected.length}] ${result.flags.length ? "FLAG" : "OK"} ${test.id}: ${result.output}`);
  if (result.flags.length) console.log(`flags=${result.flags.join(", ")}`);
}

const report = writeReport(results, autoCases);
const flagged = results.filter((result) => result.flags.length > 0).length;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`LECTURE_TRANSCRIPT_EVAL_DONE cases=${results.length} flagged=${flagged} elapsedSec=${elapsed}`);
console.log(`report=${report}`);

if (flagged > 0) {
  process.exitCode = 1;
}
