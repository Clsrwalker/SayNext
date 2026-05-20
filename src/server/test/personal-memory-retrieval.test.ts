import { expect, test } from "bun:test";
import { conversationLogger } from "../data/conversation-logger";

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

test("cloud experience queries prefer JobLens and ElderAlbum over SayNext-style projects", () => {
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

  const saynext = conversationLogger.createPersonalMemory({
    userId,
    title: "Hybrid Search Memory Assistant",
    category: "technical_projects",
    sensitivity: "low",
    source: "import",
    sourceRef: "redacted-project:ai-context-engine-hybrid-search",
    upsertBySource: true,
    keywords: ["hybrid search", "memory", "conversation assistant", "project", "cloud"],
    content: "Hybrid Search Memory Assistant is a conversation support project, not the preferred cloud project example.",
    usageRule: "Use only when asked about the AI context engine or conversation assistant.",
  });
  if (saynext) createdIds.push(saynext.id);

  try {
    conversationLogger.rebuildPersonalMemoryFts(userId);
    const refs = conversationLogger
      .searchPersonalMemoriesHybrid(userId, "Which project should I talk about for cloud experience?", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("doc:joblens:architecture-aws");
    expect(refs).toContain("doc:elderalbum:aws-architecture-deployment");
    expect(refs).not.toContain("redacted-project:ai-context-engine-hybrid-search");
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

test("hybrid retrieval design questions prefer Hybrid Search Memory Assistant memory", () => {
  const userId = `test-hybrid-retrieval-profile-${Date.now()}`;
  const createdIds: number[] = [];

  const projectMemory = conversationLogger.createPersonalMemory({
    userId,
    title: "Hybrid Search Memory Assistant goal and architecture",
    category: "project_public_framing",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-update:2026-05-18:hybrid-search-memory-assistant-goal-architecture",
    upsertBySource: true,
    keywords: ["hybrid search", "retrieval design", "memory gating", "input token reduction", "SQLite FTS5", "BM25"],
    content: "Hybrid Search Memory Assistant uses SQLite FTS5, local hashed vectors, keyword overlap, intent boosts, sensitivity filters, and prenote retrieval to send less but better context into the LLM.",
    usageRule: "Use for hybrid retrieval design, memory gating, and input token reduction questions.",
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
      .searchPersonalMemoriesHybrid(userId, "What was the trade-off in your hybrid retrieval design?", 3)
      .map((memory) => memory.sourceRef);

    expect(refs[0]).toBe("xiang-update:2026-05-18:hybrid-search-memory-assistant-goal-architecture");
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
