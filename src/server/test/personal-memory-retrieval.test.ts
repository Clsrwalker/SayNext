import { expect, test } from "bun:test";
import {
  conversationLogger,
  createPersonalMemoryRetrievalDebug,
  packPersonalMemoryContextForTest,
  type PersonalMemorySearchResult,
} from "../data/conversation-logger";

function memorySearchFixture(params: {
  id: number;
  title: string;
  sourceRef: string;
  keywords: string[];
  content: string;
  usageRule: string;
  score?: number;
}): PersonalMemorySearchResult {
  const now = new Date().toISOString();
  return {
    id: params.id,
    userId: "test-user",
    title: params.title,
    category: "technical_projects",
    sensitivity: "low",
    content: params.content,
    usageRule: params.usageRule,
    keywords: params.keywords,
    embedding: [],
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: null,
    embeddingInputHash: "",
    embeddingInputVersion: "test",
    embeddingUpdatedAt: now,
    embeddingStatus: "ready",
    embeddingError: "",
    status: "active",
    source: "import",
    sourceRef: params.sourceRef,
    contentHash: "",
    createdAt: now,
    updatedAt: now,
    score: params.score ?? 1,
    keywordScore: 0,
  };
}

test("programming language queries prefer technical profile over spoken-language memory", () => {
  const userId = `test-programming-language-profile-${Date.now()}`;
  const createdIds: number[] = [];

  const technical = conversationLogger.createPersonalMemory({
    userId,
    title: "Test programming language framework profile",
    category: "career_profile",
    sensitivity: "low",
    source: "import",
    sourceRef: "test:programming-language-framework-profile",
    upsertBySource: true,
    keywords: ["programming language", "JavaScript", "TypeScript", "React Native", "database"],
    content: "Current stronger languages are JavaScript and TypeScript. Older school languages include C++, Java, Python, and C#.",
    usageRule: "Use for programming language and framework questions.",
  });
  if (technical) createdIds.push(technical.id);

  const spokenLanguage = conversationLogger.createPersonalMemory({
    userId,
    title: "Test spoken language background",
    category: "language_learning",
    sensitivity: "low",
    source: "import",
    sourceRef: "test:languages-german-japanese",
    upsertBySource: true,
    keywords: ["language", "languages", "English", "German", "Japanese"],
    content: "English is Xiang's second language. He studied German and might learn Japanese.",
    usageRule: "Use for spoken language learning questions.",
  });
  if (spokenLanguage) createdIds.push(spokenLanguage.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "What programming languages do you have experience with?", 2)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("test:programming-language-framework-profile");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("cloud experience queries prefer JobLens and ElderAlbum over non-cloud assistant projects", () => {
  const userId = `test-cloud-project-profile-${Date.now()}`;
  const createdIds: number[] = [];

  const joblens = conversationLogger.createPersonalMemory({
    userId,
    title: "Project JobLens AI - cloud architecture",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:joblens:architecture-aws",
    upsertBySource: true,
    keywords: ["joblens", "cloud project", "aws", "lambda", "api gateway", "dynamodb", "s3", "fargate"],
    content: "JobLens AI is a cloud project with React on S3, API Gateway, FastAPI on Lambda, DynamoDB, S3, and a future EventBridge/SQS/Fargate sync path.",
    usageRule: "Use for cloud project and AWS project questions.",
  });
  if (joblens) createdIds.push(joblens.id);

  const elder = conversationLogger.createPersonalMemory({
    userId,
    title: "Project ElderAlbum - AWS architecture",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:elderalbum:aws-architecture-deployment",
    upsertBySource: true,
    keywords: ["elderalbum", "cloud project", "aws", "serverless", "lambda", "api gateway", "dynamodb", "s3"],
    content: "ElderAlbum is an AWS serverless album-sharing project using Lambda, API Gateway, DynamoDB, S3, and SAM.",
    usageRule: "Use as a simpler AWS serverless project example.",
  });
  if (elder) createdIds.push(elder.id);

  const assistantProject = conversationLogger.createPersonalMemory({
    userId,
    title: "Conversation support assistant",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "redacted-project:conversation-support-assistant",
    upsertBySource: true,
    keywords: ["hybrid search", "memory", "conversation assistant", "project", "cloud"],
    content: "This conversation support assistant is an AI context project, not the preferred cloud project example.",
    usageRule: "Use only when asked about the AI context engine or conversation assistant.",
  });
  if (assistantProject) createdIds.push(assistantProject.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "Which project should I talk about for cloud experience?", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("doc:joblens:architecture-aws");
    expect(refs).toContain("doc:elderalbum:aws-architecture-deployment");
    expect(refs).not.toContain("redacted-project:conversation-support-assistant");

    const debug = createPersonalMemoryRetrievalDebug("Which project should I talk about for cloud experience?");
    conversationLogger.searchPersonalMemoriesHybrid(userId, debug.query, 3, debug);
    const assistantCandidate = debug.candidates.find((candidate) => candidate.sourceRef === "redacted-project:conversation-support-assistant");
    expect(assistantCandidate?.included).toBe(false);
    expect(assistantCandidate?.softPenalty).toBeLessThan(0);
    expect(assistantCandidate?.reasons.some((reason) => reason.startsWith("soft_penalty:cloud_project_question_prefers_cloud_project"))).toBe(true);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("JobLens ASR aliases still retrieve JobLens cloud memory", () => {
  const userId = `test-joblens-asr-alias-${Date.now()}`;
  const createdIds: number[] = [];

  const joblens = conversationLogger.createPersonalMemory({
    userId,
    title: "Project JobLens AI - cloud architecture",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:joblens:architecture-aws",
    upsertBySource: true,
    keywords: ["JobLens AI", "job matching", "cloud project", "aws", "lambda", "api gateway", "dynamodb", "s3"],
    content: "JobLens AI is a cloud-based job platform using React on S3, API Gateway, FastAPI on Lambda, DynamoDB, and S3 storage.",
    usageRule: "Use for JobLens AI, job matching, cloud, and AWS project questions.",
  });
  if (joblens) createdIds.push(joblens.id);

  const generic = conversationLogger.createPersonalMemory({
    userId,
    title: "Generic job search advice",
    category: "knowledge_general",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:generic:job-search",
    upsertBySource: true,
    keywords: ["jobless", "job level", "job search"],
    content: "Generic advice about job searching and career levels.",
    usageRule: "Use for general career questions.",
  });
  if (generic) createdIds.push(generic.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "Jobless AI. Could you explain more?", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("doc:joblens:architecture-aws");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("project retrieval design questions prefer matching project memory", () => {
  const userId = `test-hybrid-retrieval-profile-${Date.now()}`;
  const createdIds: number[] = [];

  const projectMemory = conversationLogger.createPersonalMemory({
    userId,
    title: "JobLens resume matching retrieval design",
    category: "project_public_framing",
    sensitivity: "medium",
    source: "import",
    sourceRef: "doc:joblens:resume-matching-retrieval-design",
    upsertBySource: true,
    keywords: ["JobLens", "resume matching", "retrieval design", "job matching", "ranking", "trade-off"],
    content: "JobLens uses resume and job-posting signals to retrieve and rank matching opportunities. The trade-off is balancing explainable filters with flexible matching quality.",
    usageRule: "Use for JobLens resume matching retrieval design and trade-off questions.",
  });
  if (projectMemory) createdIds.push(projectMemory.id);

  const lectureMemory = conversationLogger.createPersonalMemory({
    userId,
    title: "Generic cloud storage tradeoffs",
    category: "knowledge_cloud",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:lecture:s3-efs-glacier-lifecycle",
    upsertBySource: true,
    keywords: ["trade-off", "storage", "retrieval", "design"],
    content: "S3, EFS, and Glacier have different cost and access tradeoffs.",
    usageRule: "Use for general cloud storage questions.",
  });
  if (lectureMemory) createdIds.push(lectureMemory.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "What was the trade-off in your JobLens resume matching retrieval design?", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("doc:joblens:resume-matching-retrieval-design");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("named project queries prefer canonical project memory over generic study memories", () => {
  const userId = `test-study-session-project-${Date.now()}`;
  const createdIds: number[] = [];

  const project = conversationLogger.createPersonalMemory({
    userId,
    title: "Project Study Session Tracker - architecture and data flow",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:study-session-tracker:architecture-data-flow",
    upsertBySource: true,
    keywords: ["Study Session Tracker", "study timer", "Firebase", "Firestore", "dashboard"],
    content: "Study Session Tracker uses Firebase Authentication, Firestore, a study timer, dashboard, reminders, tasks, and calendar-style planning. The data flow is user login, timer/task updates, Firestore writes, then dashboard aggregation.",
    usageRule: "Use for Study Session Tracker architecture and data flow questions.",
  });
  if (project) createdIds.push(project.id);

  const genericStudy = conversationLogger.createPersonalMemory({
    userId,
    title: "Xiang early study avoidance and academic turnaround",
    category: "learning_style",
    sensitivity: "medium",
    source: "manual",
    sourceRef: "xiang-update:2026-05-18:study-avoidance-turnaround",
    upsertBySource: true,
    keywords: ["study", "student", "high school", "academic turnaround"],
    content: "Xiang did not like studying much in middle school and high school, then improved after coming to Canada.",
    usageRule: "Use for personal questions about study habits or academic turnaround.",
  });
  if (genericStudy) createdIds.push(genericStudy.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const results = conversationLogger.searchPersonalMemoriesHybrid(
      userId,
      "Can you explain Study Session Tracker architecture and data flow?",
      2,
    );

    expect(results[0]?.sourceRef).toBe("doc:study-session-tracker:architecture-data-flow");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("meeting transcript pipeline queries retrieve AI Meeting Monitor memory", () => {
  const userId = `test-ai-meeting-monitor-profile-${Date.now()}`;
  const createdIds: number[] = [];

  const aiMeetingMonitor = conversationLogger.createPersonalMemory({
    userId,
    title: "AI Meeting Monitor project integration story",
    category: "technical_projects",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-update:2026-05-18:ai-meeting-monitor",
    upsertBySource: true,
    keywords: ["AI Meeting Monitor", "meeting recording", "transcript pipeline", "Discord bot", "Faster Whisper", "Gemini", "Flask", "PostgreSQL"],
    content: "AI Meeting Monitor connected a Discord recording bot, FastAPI data-processing service, Faster Whisper transcription, Gemini meeting analysis, Flask/PostgreSQL backend write-back, and React dashboard/report views.",
    usageRule: "Use for AI Meeting Monitor architecture, meeting recording, transcript pipeline, and integration questions.",
  });
  if (aiMeetingMonitor) createdIds.push(aiMeetingMonitor.id);

  const lecture = conversationLogger.createPersonalMemory({
    userId,
    title: "Lecture knowledge: AWS CI/CD",
    category: "knowledge_cloud",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:lecture:aws-cicd-codepipeline",
    upsertBySource: true,
    keywords: ["pipeline", "recording", "deployment", "transcript"],
    content: "A lecture about CI/CD pipelines, CodePipeline, CodeBuild, and deployment automation.",
    usageRule: "Use for general AWS CI/CD lecture questions.",
  });
  if (lecture) createdIds.push(lecture.id);

  const programmingProfile = conversationLogger.createPersonalMemory({
    userId,
    title: "Xiang programming languages and framework experience",
    category: "career_profile",
    sensitivity: "low",
    source: "import",
    sourceRef: "xiang-update:2026-05-19:programming-language-framework-profile",
    upsertBySource: true,
    keywords: ["programming language", "technical stack", "JavaScript", "TypeScript", "React", "Python"],
    content: "Xiang is strongest in JavaScript and TypeScript, with experience in React, Python, Java, C++, C#, and databases.",
    usageRule: "Use for general programming language and framework questions, not named project architecture questions.",
  });
  if (programmingProfile) createdIds.push(programmingProfile.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "How did the meeting recording and transcript pipeline work?", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("xiang-update:2026-05-18:ai-meeting-monitor");

    const stackRefs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "What was the technical stack of AI Meeting Monitor?", 3)
      .map((memory) => memory.sourceRef);

    expect(stackRefs[0]).toBe("xiang-update:2026-05-18:ai-meeting-monitor");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("React Native parking questions do not get pulled toward AI Meeting Monitor", () => {
  const userId = `test-project-cross-talk-${Date.now()}`;
  const createdIds: number[] = [];

  const aiMeetingMonitor = conversationLogger.createPersonalMemory({
    userId,
    title: "AI Meeting Monitor project integration story",
    category: "technical_projects",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-update:2026-05-18:ai-meeting-monitor",
    upsertBySource: true,
    keywords: ["AI Meeting Monitor", "React", "TypeScript", "integration", "dashboard"],
    content: "AI Meeting Monitor used React and TypeScript for meeting dashboard and report pages.",
    usageRule: "Use only for AI Meeting Monitor and meeting-analysis project questions.",
  });
  if (aiMeetingMonitor) createdIds.push(aiMeetingMonitor.id);

  const dalParkAid = conversationLogger.createPersonalMemory({
    userId,
    title: "DalParkAid React Native parking project",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:dalparkaid:overview-problem",
    upsertBySource: true,
    keywords: ["DalParkAid", "React Native", "parking project", "Dalhousie", "weather", "timetable"],
    content: "DalParkAid was a React Native campus parking app for Dalhousie using parking reports, location context, weather, and timetable data.",
    usageRule: "Use for React Native parking project questions.",
  });
  if (dalParkAid) createdIds.push(dalParkAid.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "Tell me about your React Native parking project.", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("doc:dalparkaid:overview-problem");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("personal memory search debug traces candidates without private content", () => {
  const userId = `test-memory-debug-trace-${Date.now()}`;
  const createdIds: number[] = [];

  const joblens = conversationLogger.createPersonalMemory({
    userId,
    title: "JobLens retrieval debug memory",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:joblens:retrieval-debug",
    upsertBySource: true,
    keywords: ["JobLens", "resume matching", "retrieval debug", "debug trace", "ranking"],
    content: "JobLens has a retrieval debug trace for resume matching and ranking behavior.",
    usageRule: "Use for JobLens retrieval debug questions.",
  });
  if (joblens) createdIds.push(joblens.id);

  const privateMemory = conversationLogger.createPersonalMemory({
    userId,
    title: "Sensitive unrelated private marker",
    category: "health_private",
    sensitivity: "high",
    source: "manual",
    sourceRef: "test:sensitive-private-marker",
    upsertBySource: true,
    keywords: ["private marker"],
    content: "VERY_PRIVATE_DEBUG_TRACE_CONTENT_SHOULD_NOT_APPEAR",
    usageRule: "Do not use unless directly requested.",
  });
  if (privateMemory) createdIds.push(privateMemory.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const query = "What was the trade-off in your JobLens resume matching retrieval debug design?";
    const debug = createPersonalMemoryRetrievalDebug(query);
    const results = conversationLogger.searchPersonalMemoriesHybrid(userId, query, 3, debug);

    expect(results[0]?.sourceRef).toBe("doc:joblens:retrieval-debug");

    const included = debug.candidates.find((candidate) => candidate.sourceRef === "doc:joblens:retrieval-debug");
    expect(included?.included).toBe(true);
    expect(included?.canonicalProjectId).toBe("joblens");
    expect(included?.queryIntent).toBe("memory_personalization");
    expect(included?.reasons).toContain("included");
    expect(debug.packedContextChars).toBeGreaterThan(0);

    const rejected = debug.candidates.find((candidate) => candidate.sourceRef === "test:sensitive-private-marker");
    expect(rejected?.included).toBe(false);
    expect(rejected?.reasons).toContain("rejected:high_sensitivity_requires_direct_signal");
    expect(JSON.stringify(debug)).not.toContain("VERY_PRIVATE_DEBUG_TRACE_CONTENT_SHOULD_NOT_APPEAR");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("excerpt memory packing remains available as a compact fallback", () => {
  const memory = memorySearchFixture({
    id: 1,
    title: "JobLens matching context and token reduction",
    sourceRef: "doc:joblens:matching-context-test",
    keywords: ["JobLens", "resume matching", "input token reduction", "retrieval"],
    content: [
      "JobLens uses retrieved resume and job-posting context, keyword overlap, and gating to reduce prompt input tokens.",
      Array.from({ length: 120 }, () => "UNRELATED_LONG_MARKER").join(" "),
    ].join(" "),
    usageRule: "Use for JobLens matching context and token reduction questions.",
  });

  const context = packPersonalMemoryContextForTest(
    [memory],
    "How does JobLens reduce prompt input tokens with resume matching context?",
    "excerpt",
  );

  expect(context.length).toBeLessThanOrEqual(1400);
  expect(context).toContain("Relevant facts:");
  expect(context).toContain("reduce prompt input tokens");
  expect(context).not.toContain("UNRELATED_LONG_MARKER");
});

test("tagged memory cards expose candidate labels and fuller detail for GPT selection", () => {
  const memories: PersonalMemorySearchResult[] = [
    memorySearchFixture({
      id: 1,
      title: "JobLens workflow and architecture",
      sourceRef: "doc:joblens:architecture-workflow",
      keywords: ["JobLens", "architecture", "workflow", "resume", "job posting", "matching"],
      content: [
        "JobLens has a resume upload flow, job-posting ingestion, matching service, and result explanation screen.",
        "The backend separates document parsing, embedding lookup, scoring, and user-facing explanation so each step can be debugged independently.",
      ].join(" "),
      usageRule: "Use for JobLens architecture and workflow questions.",
    }),
    memorySearchFixture({
      id: 2,
      title: "JobLens overview and product scope",
      sourceRef: "doc:joblens:overview-scope",
      keywords: ["JobLens", "overview", "definition", "resume", "job matching", "student project"],
      content: [
        "JobLens is a student job-matching assistant that compares a resume with job postings and explains fit, missing skills, and improvement areas.",
        "The useful answer should say it is not just a generic chatbot: it grounds the response in retrieved resume/job context and turns that into practical matching feedback.",
        "For deeper questions, explain that the project value comes from combining structured resume data, job requirements, retrieval, and a short explanation layer instead of dumping raw scores.",
      ].join(" "),
      usageRule: "Use as the primary factual definition when asked what JobLens is.",
    }),
    memorySearchFixture({
      id: 3,
      title: "JobLens interview impact story",
      sourceRef: "xiang-behavioral:joblens-impact-story",
      keywords: ["JobLens", "impact", "interview", "story"],
      content: "The JobLens story focuses on making job-search feedback less vague for students by turning resume gaps into concrete improvement points.",
      usageRule: "Use only when asked for motivation, impact, or a behavioral story.",
    }),
  ];

  const context = packPersonalMemoryContextForTest(memories, "What is JobLens?", "tagged_cards");

  expect(context).toContain("Memory candidates. Use the best matching candidate");
  expect(context).toContain("Possible memory candidates:");
  expect(context).toContain("Type: architecture");
  expect(context).toContain("Type: overview / definition");
  expect(context).toContain("Grounding: story / behavior memory");
  expect(context).toContain("Detailed candidate: JobLens overview and product scope");
  expect(context).toContain("Fuller detail:");
  expect(context).toContain("not just a generic chatbot");
  expect(context).toContain("Secondary candidate:");
  expect(context).not.toContain("confidence");
});

test("legacy sync personal memory writes pending OpenAI embedding metadata instead of local vectors", () => {
  const userId = `test-memory-embedding-metadata-${Date.now()}`;
  const createdIds: number[] = [];

  const memory = conversationLogger.createPersonalMemory({
    userId,
    title: "Embedding metadata test memory",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "test:embedding-metadata-local",
    upsertBySource: true,
    keywords: ["embedding", "metadata"],
    content: "This memory is used to verify local embedding metadata is persisted.",
    usageRule: "Use only for embedding metadata tests.",
  });
  if (memory) createdIds.push(memory.id);

  try {
    expect(memory?.embeddingProvider).toBe("openai");
    expect(memory?.embeddingModel).toBe("text-embedding-3-small");
    expect(memory?.embeddingDimensions).toBe(null);
    expect(memory?.embeddingInputVersion).toBeTruthy();
    expect(memory?.embeddingInputHash).toHaveLength(64);
    expect(memory?.embeddingStatus).toBe("error");
    expect(memory?.embeddingError).toContain("openai_embedding_not_generated_in_sync_path");
    expect(memory?.embedding).toEqual([]);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("async personal memory retrieval uses lexical fallback without local vectors for pending corpus", async () => {
  const userId = `test-memory-async-local-fallback-${Date.now()}`;
  const createdIds: number[] = [];

  const memory = conversationLogger.createPersonalMemory({
    userId,
    title: "Async local fallback retrieval memory",
    category: "knowledge_retrieval",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:test:async-local-fallback",
    upsertBySource: true,
    keywords: ["async retrieval", "local fallback", "memory context"],
    content: "Async personal memory retrieval should still find local-hybrid memories when OpenAI embeddings have not been reindexed.",
    usageRule: "Use for async retrieval fallback tests.",
  });
  if (memory) createdIds.push(memory.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const debug = createPersonalMemoryRetrievalDebug("How does async retrieval local fallback work?");
    const results = await conversationLogger.searchPersonalMemoriesHybridAsync(
      userId,
      debug.query,
      3,
      debug,
    );

    expect(results[0]?.sourceRef).toBe("knowledge:test:async-local-fallback");
    expect(debug.embeddingProvider).toBe("openai");
    expect(debug.embeddingModel).toBe("text-embedding-3-small");
    expect(debug.embeddingDimensions).toBe(null);
    expect(debug.candidates.find((candidate) => candidate.sourceRef === "knowledge:test:async-local-fallback")?.vectorScore).toBe(0);

    const context = await conversationLogger.getRelevantPersonalMemoryContextAsync(
      userId,
      "How does async retrieval local fallback work?",
      3,
    );
    expect(context).toContain("Async local fallback retrieval memory");
    expect(context).toContain("Key facts:");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("async create and update personal memory use OpenAI embeddings", async () => {
  const userId = `test-memory-openai-embedding-${Date.now()}`;
  const createdIds: number[] = [];
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  let callCount = 0;

  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body || "{}"));
    const input = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(JSON.stringify({
      data: input.map((_text: string, index: number) => ({
        index,
        embedding: [1, index + 1, 0.5],
      })),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const created = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: "OpenAI embedding create test",
      category: "knowledge_retrieval",
      sensitivity: "low",
      source: "knowledge",
      sourceRef: "knowledge:test:openai-create-update",
      upsertBySource: true,
      keywords: ["openai embedding", "create update"],
      content: "OpenAI embeddings should be generated during async memory creation.",
      usageRule: "Use for OpenAI embedding tests.",
    });
    if (created) createdIds.push(created.id);

    expect(created?.embeddingProvider).toBe("openai");
    expect(created?.embeddingModel).toBe("text-embedding-3-small");
    expect(created?.embeddingDimensions).toBe(3);
    expect(created?.embeddingStatus).toBe("ready");
    expect(created?.embedding.length).toBe(3);

    const updated = await conversationLogger.updatePersonalMemoryAsync(userId, created?.id ?? -1, {
      content: "OpenAI embeddings should also be regenerated during async memory updates.",
    });

    expect(updated?.embeddingProvider).toBe("openai");
    expect(updated?.embeddingStatus).toBe("ready");
    expect(callCount).toBeGreaterThanOrEqual(2);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
    if (oldApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = oldApiKey;
    }
    globalThis.fetch = oldFetch;
  }
});

test("async personal memory retrieval keeps a strong OpenAI vector-only match", async () => {
  const userId = `test-memory-vector-only-${Date.now()}`;
  const createdIds: number[] = [];
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(JSON.stringify({
      data: inputs.map((text: string, index: number) => {
        const normalized = String(text).toLowerCase();
        const embedding = normalized.includes("relational index distraction")
          ? [0, 1, 0]
          : [1, 0, 0];
        return { index, embedding };
      }),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const relevant = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: "Paraphrase recovery evidence",
      category: "personal_preference",
      sensitivity: "low",
      source: "import",
      sourceRef: "test:vector-only:relevant",
      upsertBySource: true,
      keywords: [],
      content: "Semantic embeddings recover paraphrases whose wording changes completely.",
      usageRule: "Use for semantic retrieval tests.",
    });
    const distraction = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: "Relational index distraction",
      category: "personal_preference",
      sensitivity: "low",
      source: "import",
      sourceRef: "test:vector-only:distraction",
      upsertBySource: true,
      keywords: [],
      content: "A separate database indexing note.",
      usageRule: "Use for unrelated database tests.",
    });
    if (relevant) createdIds.push(relevant.id);
    if (distraction) createdIds.push(distraction.id);

    conversationLogger.rebuildPersonalMemoryFts(userId);
    const debug = createPersonalMemoryRetrievalDebug("Which method did your project select for unfamiliar phrasing?");
    const results = await conversationLogger.searchPersonalMemoriesHybridAsync(
      userId,
      debug.query,
      2,
      debug,
    );
    const targetDebug = debug.candidates.find((candidate) => candidate.sourceRef === "test:vector-only:relevant");
    expect(results[0]?.sourceRef).toBe("test:vector-only:relevant");
    expect(results[0]?.lexicalRank).toBeUndefined();
    expect(results[0]?.vectorScore).toBeGreaterThan(0.99);
    expect(targetDebug?.reasons).toContain("included");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
    globalThis.fetch = oldFetch;
    if (oldApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldApiKey;
  }
});

test("concurrent identical personal-memory searches share one query embedding request", async () => {
  const userId = `test-memory-query-inflight-${Date.now()}`;
  const createdIds: number[] = [];
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  let callCount = 0;

  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body || "{}"));
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({
      data: inputs.map((_text: string, index: number) => ({ index, embedding: [1, 0, 0] })),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const memory = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: "Concurrent embedding retrieval evidence",
      category: "project_experience",
      sensitivity: "low",
      source: "import",
      sourceRef: "test:query-inflight:memory",
      upsertBySource: true,
      keywords: [],
      content: "Xiang diagnosed an integration failure by tracing an API payload across services.",
      usageRule: "Use for a behavioral debugging question.",
    });
    if (memory) createdIds.push(memory.id);
    callCount = 0;
    const query = `How did you diagnose that integration incident ${Date.now()}?`;

    const [first, second] = await Promise.all([
      conversationLogger.searchPersonalMemoriesHybridAsync(userId, query, 2),
      conversationLogger.searchPersonalMemoriesHybridAsync(userId, query, 2),
    ]);

    expect(callCount).toBe(1);
    expect(second).toEqual(first);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
    globalThis.fetch = oldFetch;
    if (oldApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldApiKey;
  }
});

test("vector-only personal-memory search ranks compatible OpenAI embeddings without intent boosts", async () => {
  const userId = `test-vector-only-search-${Date.now()}`;
  const createdIds: number[] = [];
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(JSON.stringify({
      data: inputs.map((text: string, index: number) => ({
        index,
        embedding: String(text).toLowerCase().includes("database distraction")
          ? [0, 1, 0]
          : [1, 0, 0],
      })),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const relevant = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: "Live cue flow evidence",
      category: "technical_projects",
      sensitivity: "low",
      source: "import",
      sourceRef: "test:vector-only-api:relevant",
      upsertBySource: true,
      keywords: [],
      content: "Xiang built a live speech-to-cue pipeline for smart glasses.",
      usageRule: "Use for SayNext architecture questions.",
    });
    const distraction = await conversationLogger.createPersonalMemoryAsync({
      userId,
      title: "Database distraction",
      category: "technical_projects",
      sensitivity: "low",
      source: "import",
      sourceRef: "test:vector-only-api:distraction",
      upsertBySource: true,
      keywords: [],
      content: "Database distraction about relational indexing.",
      usageRule: "Use for database questions.",
    });
    if (relevant) createdIds.push(relevant.id);
    if (distraction) createdIds.push(distraction.id);

    const results = await conversationLogger.searchPersonalMemoriesVectorAsync(
      userId,
      `How does the unfamiliar live assistance pipeline work ${Date.now()}?`,
      2,
    );

    expect(results.map((result) => result.sourceRef)).toEqual([
      "test:vector-only-api:relevant",
      "test:vector-only-api:distraction",
    ]);
    expect(results[0]?.vectorScore).toBeGreaterThan(0.99);
    expect(results[0]?.keywordScore).toBe(0);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
    globalThis.fetch = oldFetch;
    if (oldApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldApiKey;
  }
});

test("general technical queries soft-penalize project memory instead of silently dropping it", () => {
  const userId = `test-soft-penalty-technical-${Date.now()}`;
  const createdIds: number[] = [];

  const knowledge = conversationLogger.createPersonalMemory({
    userId,
    title: "Knowledge: backpropagation definition",
    category: "knowledge_ml",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:test:backpropagation-definition",
    upsertBySource: true,
    keywords: ["backpropagation", "neural network", "gradient", "training"],
    content: "Backpropagation computes gradients through a neural network so training can update model weights.",
    usageRule: "Use for general machine learning concept questions.",
  });
  if (knowledge) createdIds.push(knowledge.id);

  const project = conversationLogger.createPersonalMemory({
    userId,
    title: "JobLens project note with backpropagation wording",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "doc:joblens:backpropagation-noise",
    upsertBySource: true,
    keywords: ["JobLens", "backpropagation", "project", "memory retrieval"],
    content: "JobLens is a personal project; this test memory mentions backpropagation only as noisy overlap.",
    usageRule: "Use only for JobLens project questions.",
  });
  if (project) createdIds.push(project.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const query = "What is backpropagation?";
    const debug = createPersonalMemoryRetrievalDebug(query);
    const results = conversationLogger.searchPersonalMemoriesHybrid(userId, query, 3, debug);

    expect(results[0]?.sourceRef).toBe("knowledge:test:backpropagation-definition");

    const projectCandidate = debug.candidates.find((candidate) => candidate.sourceRef === "doc:joblens:backpropagation-noise");
    expect(projectCandidate?.included).toBe(false);
    expect(projectCandidate?.softPenalty).toBeLessThan(0);
    expect(projectCandidate?.reasons.some((reason) => reason.startsWith("soft_penalty:non_knowledge_memory_in_general_or_public_learning_context"))).toBe(true);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("personal experience queries soft-penalize generic knowledge memory", () => {
  const userId = `test-soft-penalty-personal-${Date.now()}`;
  const createdIds: number[] = [];

  const personal = conversationLogger.createPersonalMemory({
    userId,
    title: "Xiang family business background",
    category: "family_background",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-profile:family-background-test",
    upsertBySource: true,
    keywords: ["family business", "factory", "what happened"],
    content: "Xiang has private family-business background context for questions about what happened to the family business.",
    usageRule: "Use carefully for direct family business questions.",
  });
  if (personal) createdIds.push(personal.id);

  const genericKnowledge = conversationLogger.createPersonalMemory({
    userId,
    title: "Generic family business explanation",
    category: "knowledge_business",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:test:generic-family-business",
    upsertBySource: true,
    keywords: ["family business", "business", "what happened"],
    content: "A generic explanation of family businesses and why small companies can change over time.",
    usageRule: "Use for general business knowledge, not Xiang personal background.",
  });
  if (genericKnowledge) createdIds.push(genericKnowledge.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const query = "What happened to your family business?";
    const debug = createPersonalMemoryRetrievalDebug(query);
    const results = conversationLogger.searchPersonalMemoriesHybrid(userId, query, 3, debug);

    expect(results.map((memory) => memory.sourceRef)).toContain("xiang-profile:family-background-test");

    const knowledgeCandidate = debug.candidates.find((candidate) => candidate.sourceRef === "knowledge:test:generic-family-business");
    expect(knowledgeCandidate?.included).toBe(false);
    expect(knowledgeCandidate?.softPenalty).toBeLessThan(0);
    expect(knowledgeCandidate?.reasons.some((reason) => reason.startsWith("soft_penalty:knowledge_memory_for_personal_experience_question"))).toBe(true);
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});

test("high sensitivity remains a hard rejection while other mismatches are soft penalties", () => {
  const userId = `test-soft-penalty-hard-gate-${Date.now()}`;
  const createdIds: number[] = [];

  const safeKnowledge = conversationLogger.createPersonalMemory({
    userId,
    title: "Knowledge: supervised learning",
    category: "knowledge_ml",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:test:supervised-learning",
    upsertBySource: true,
    keywords: ["supervised learning", "labels", "training data"],
    content: "Supervised learning trains a model using labeled examples.",
    usageRule: "Use for general ML concept questions.",
  });
  if (safeKnowledge) createdIds.push(safeKnowledge.id);

  const sensitive = conversationLogger.createPersonalMemory({
    userId,
    title: "Sensitive unrelated project marker",
    category: "health_private",
    sensitivity: "high",
    source: "import",
    sourceRef: "test:high-sensitive-hard-gate",
    upsertBySource: true,
    keywords: ["private marker"],
    content: "VERY_PRIVATE_HIGH_SENSITIVITY_CONTENT_SHOULD_NOT_APPEAR",
    usageRule: "Do not use without a direct high-sensitivity signal.",
  });
  if (sensitive) createdIds.push(sensitive.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const query = "What is supervised learning?";
    const debug = createPersonalMemoryRetrievalDebug(query);
    conversationLogger.searchPersonalMemoriesHybrid(userId, query, 3, debug);

    const candidate = debug.candidates.find((item) => item.sourceRef === "test:high-sensitive-hard-gate");
    expect(candidate?.included).toBe(false);
    expect(candidate?.reasons).toContain("rejected:high_sensitivity_requires_direct_signal");
    expect(JSON.stringify(debug)).not.toContain("VERY_PRIVATE_HIGH_SENSITIVITY_CONTENT_SHOULD_NOT_APPEAR");
  } finally {
    for (const id of createdIds) {
      conversationLogger.deletePersonalMemory(userId, id);
    }
  }
});
