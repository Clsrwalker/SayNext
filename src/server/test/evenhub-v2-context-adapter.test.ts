import { expect, test } from "bun:test";
import {
  LightweightEvenHubV2ContextAdapter,
  resolveEvenHubV2MemorySearchMode,
  selectDirectExperienceMemories,
  selectDirectProjectMemories,
  type EvenHubV2MemoryCandidate,
  type EvenHubV2MemoryRetriever,
} from "../evenhub-v2/context-adapter";
import { defaultEvenHubV2Settings } from "../evenhub-v2/protocol";
import type { InterviewAnswerCard } from "../evenhub-v2/interview-guide";
import type { MemoryRouter } from "../evenhub-v2/memory-router";

test("EvenHub v2 uses adaptive memory retrieval unless a fixed mode is explicit", () => {
  expect(resolveEvenHubV2MemorySearchMode(undefined)).toBe("adaptive");
  expect(resolveEvenHubV2MemorySearchMode("lexical")).toBe("lexical");
  expect(resolveEvenHubV2MemorySearchMode("semantic")).toBe("semantic");
  expect(resolveEvenHubV2MemorySearchMode("unknown")).toBe("adaptive");
});

class FakeMemoryRetriever implements EvenHubV2MemoryRetriever {
  calls: Array<{ userId: string; query: string; limit: number }> = [];

  constructor(private readonly result: EvenHubV2MemoryCandidate[] | Error) {}

  async search(userId: string, query: string, limit: number): Promise<EvenHubV2MemoryCandidate[]> {
    this.calls.push({ userId, query, limit });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function fixedMemoryRouter(lane: "none" | "profile" | "company_fit" | "named_project" | "personal_experience" | "behavioral"): MemoryRouter {
  return {
    async predict() {
      return {
        lane,
        confidence: 0.95,
        probabilities: { [lane]: 0.95 },
        model: "test-memory-router",
        latencyMs: 1,
      };
    },
  };
}

test("EvenHub v2 memory router can abstain before retrieval", async () => {
  const retriever = new FakeMemoryRetriever([{
    id: 32,
    title: "Resume - Xiang skills and profile",
    category: "technical_skills",
    content: "Xiang is a MACS student.",
    score: 1,
  }]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryRouter: fixedMemoryRouter("none"),
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "How would you design a website chatbot?",
    triggerWindow: "How would you design a website chatbot?",
    recentTranscript: "",
  });

  expect(retriever.calls).toHaveLength(0);
  expect(snapshot.memoryUsedIds).toEqual([]);
});

test("EvenHub v2 routed personal questions use lane-scoped semantic retrieval with the actual transcript", async () => {
  const calls: Array<{ query: string; semantic: boolean | undefined; lane: string | undefined }> = [];
  const retriever: EvenHubV2MemoryRetriever = {
    async search(_userId, query, _limit, options) {
      calls.push({ query, semantic: options?.semantic, lane: options?.lane });
      return [{
        id: 230,
        title: "Xiang programming languages and framework experience",
        category: "career_profile",
        content: "Xiang currently uses JavaScript and TypeScript most often and has project experience with Python.",
        score: 0.9,
        vectorScore: 0.72,
      }];
    },
  };
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryRouter: fixedMemoryRouter("profile"),
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "How are you comfortable with you- with Python?",
    triggerWindow: "How are you comfortable with you- with Python?",
    recentTranscript: "",
  });

  expect(calls).toEqual([{
    query: expect.stringContaining("How are you comfortable with you- with Python?"),
    semantic: true,
    lane: "profile",
  }]);
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:230"]);
});

function contextInput() {
  return {
    userId: "evenhub-v2-user",
    conversationId: "conv-1",
    triggerWindow: "What was the main AWS trade-off in JobLens AI?",
    recentTranscript: "Interviewer: Tell me about your strongest cloud project.",
    selectedPrenoteIds: [],
    selectedPrenoteText: "",
    settings: defaultEvenHubV2Settings(),
  };
}

test("EvenHub v2 directly recalls a named project even when generic cloud memory scores higher", () => {
  const candidates: EvenHubV2MemoryCandidate[] = [
    {
      id: 36,
      title: "Project JobLens AI - cloud architecture",
      category: "technical_projects",
      content: "JobLens uses AWS serverless services.",
      score: 0.96,
    },
    {
      id: 4725,
      title: "Project CueFlow - current cloud architecture and product flow",
      category: "technical_projects",
      content: "CueFlow uses API Gateway, Lambda, SQS, DynamoDB, S3, and OpenAI Realtime.",
      score: 0.45,
    },
  ];

  expect(selectDirectProjectMemories("Explain your CueFlow AWS architecture", candidates))
    .toEqual([expect.objectContaining({ id: 4725 })]);
  expect(selectDirectProjectMemories("Explain an AWS architecture", candidates)).toEqual([]);
});

test("EvenHub v2 does not treat a passing project mention as project-owned memory", () => {
  const candidates: EvenHubV2MemoryCandidate[] = [
    {
      id: 4721,
      title: "Project SayNext - architecture",
      category: "technical_projects",
      sourceRef: "project:saynext:architecture",
      content: "SayNext uses a transcript buffer and personal-memory retrieval.",
      score: 0.72,
    },
    {
      id: 182,
      title: "Cloud project selection: JobLens AI and ElderAlbum",
      category: "technical_projects",
      sourceRef: "doc:cloud-projects:joblens-elderalbum-selection",
      content: "JobLens is the strongest cloud example. Do not use SayNext for this answer.",
      usageRule: "Avoid SayNext unless it is explicitly requested.",
      score: 0.99,
    },
  ];

  expect(selectDirectProjectMemories("Explain the SayNext architecture", candidates))
    .toEqual([expect.objectContaining({ id: 4721 })]);
});

test("EvenHub v2 directly recalls project evidence for a personal technical experience question", () => {
  const candidates: EvenHubV2MemoryCandidate[] = [
    {
      id: 4721,
      title: "Project SayNext / EvenHub v2",
      category: "technical_projects",
      content: "A conversational assistant with hybrid retrieval.",
      keywords: ["RAG", "chatbot", "hybrid retrieval"],
      score: 0,
    },
    {
      id: 4725,
      title: "Project CueFlow",
      category: "technical_projects",
      content: "A cloud-native conversation intelligence app.",
      keywords: ["AWS", "WebSocket"],
      score: 0,
    },
    {
      id: 134,
      title: "RAG lecture knowledge",
      category: "knowledge_lecture_cloud_ai",
      content: "General RAG concepts.",
      keywords: ["RAG"],
      score: 0,
    },
  ];

  expect(selectDirectExperienceMemories(
    "What kind of experience do you have with RAG and chatbots?",
    candidates,
  )).toEqual([expect.objectContaining({ id: 4721 })]);
  expect(selectDirectExperienceMemories("What is RAG?", candidates)).toEqual([]);
});

test("EvenHub v2 context retrieves detailed project facts but excludes generic knowledge", async () => {
  const retriever = new FakeMemoryRetriever([
    {
      id: 36,
      title: "Project JobLens AI - cloud architecture",
      category: "technical_projects",
      content: "JobLens uses React on S3, API Gateway, FastAPI on Lambda, DynamoDB, and S3. The demo chose inline sync for Learner Lab reliability.",
      score: 0.91,
    },
    {
      id: 98,
      title: "AWS Well-Architected interview answers",
      category: "knowledge_cs_interview",
      content: "Explain reliability, security, performance, cost, operational excellence, and sustainability as trade-offs.",
      score: 0.72,
    },
  ]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
    memoryLimit: 4,
    memoryMaxChars: 1800,
  });

  const snapshot = await adapter.build(contextInput());

  expect(retriever.calls).toHaveLength(1);
  expect(retriever.calls[0].userId).toBe("xiang-memory-user");
  expect(retriever.calls[0].limit).toBe(4);
  expect(retriever.calls[0].query).toContain("What was the main AWS trade-off in JobLens AI?");
  expect(snapshot.contextSnapshot).toContain("Project JobLens AI - cloud architecture");
  expect(snapshot.contextSnapshot).toContain("inline sync for Learner Lab reliability");
  expect(snapshot.contextSnapshot).not.toContain("AWS Well-Architected interview answers");
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:36"]);
});

test("EvenHub v2 context fails open when memory retrieval is unavailable", async () => {
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: new FakeMemoryRetriever(new Error("embedding service unavailable")),
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build(contextInput());

  expect(snapshot.contextSnapshot).toContain("What was the main AWS trade-off in JobLens AI?");
  expect(snapshot.contextSnapshot).not.toContain("embedding service unavailable");
  expect(snapshot.memoryUsedIds).toEqual([]);
});

test("EvenHub v2 context supplements weak recall with specific profile facts but excludes a shallow project list", async () => {
  const calls: string[] = [];
  const retriever: EvenHubV2MemoryRetriever = {
    async search(_userId, query) {
      calls.push(query);
      if (query.includes("Why are you a strong fit for this full-stack AI developer job?")) {
        return [
          {
            id: 32,
            title: "Resume - Xiang skills and profile",
            category: "technical_skills",
            content: "Xiang has hands-on experience building AI-powered web, mobile, and cloud applications.",
            score: 0.9,
          },
          {
            id: 33,
            title: "Resume - selected project list",
            category: "technical_projects",
            content: "Selected projects include SayNext, JobLens AI, ElderAlbum, DalParkAid, and AI Meeting Monitor.",
            score: 0.8,
          },
        ];
      }
      return [{
        id: 134,
        title: "RAG lifecycle knowledge",
        category: "knowledge_lecture_cloud_ai",
        content: "RAG retrieves relevant private or current documents before generation.",
        score: 0.7,
      }];
    },
  };
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
    memoryLimit: 5,
    memoryMaxChars: 2200,
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    triggerWindow: "Why are you a strong fit for this full-stack AI developer job?",
    recentTranscript: "Interviewer: Why should we hire you?",
  });

  expect(calls).toEqual([
    expect.stringContaining("Why are you a strong fit for this full-stack AI developer job?"),
  ]);
  expect(snapshot.contextSnapshot).toContain("Resume - Xiang skills and profile");
  expect(snapshot.contextSnapshot).not.toContain("RAG lifecycle knowledge");
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:32"]);
  expect(snapshot.contextSnapshot).not.toContain("Resume - selected project list");
});

test("EvenHub v2 context prioritizes an explicitly named project over generic knowledge", async () => {
  const retriever = new FakeMemoryRetriever([
    {
      id: 133,
      title: "Cloud architecture best practices",
      category: "knowledge_lecture_cloud_ai",
      content: "Use managed services and separate system tiers.",
      score: 0.9,
    },
    {
      id: 4725,
      title: "Project CueFlow - current cloud architecture and product flow",
      category: "technical_projects",
      content: "CueFlow uses API Gateway, Lambda, SQS, DynamoDB, S3, and OpenAI Realtime.",
      score: 0.7,
    },
    {
      id: 36,
      title: "Project JobLens AI - cloud architecture",
      category: "technical_projects",
      content: "JobLens uses a React SPA, API Gateway, Lambda, DynamoDB, and S3.",
      score: 0.8,
    },
  ]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    triggerWindow: "Explain your CueFlow AWS architecture.",
    recentTranscript: "Interviewer: What did you build in CueFlow?",
  });

  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:4725"]);
  expect(snapshot.contextSnapshot).not.toContain("Cloud architecture best practices");
  expect(snapshot.contextSnapshot).not.toContain("Project JobLens AI");
});

test("EvenHub v2 does not treat a job card as personal memory", async () => {
  const retriever = new FakeMemoryRetriever([{
    id: 4724,
    title: "DeepSense Full-Stack AI Developer co-op - role fit",
    category: "interview_job",
    content: "SayNext, JobLens, and CueFlow provide direct grounding for the role.",
    score: 1,
  }]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    triggerWindow: "Why are you a strong fit for the DeepSense full-stack AI developer co-op?",
    recentTranscript: "Interviewer: Why should we hire you?",
  });

  expect(retriever.calls).toHaveLength(1);
  expect(snapshot.memoryUsedIds).toEqual([]);
  expect(snapshot.contextSnapshot).not.toContain("SayNext, JobLens, and CueFlow");
});

test("EvenHub v2 intro questions use profile memory and exclude generic lecture cards", async () => {
  const calls: string[] = [];
  const retriever: EvenHubV2MemoryRetriever = {
    async search(_userId, query) {
      calls.push(query);
      if (query.includes("Tell me a little bit about yourself.")) {
        return [
          {
            id: 32,
            title: "Resume - Xiang skills and profile",
            category: "technical_skills",
            content: "Xiang is a MACS student with full-stack AI and cloud application experience.",
            score: 0.95,
          },
          {
            id: 33,
            title: "Resume - selected project list",
            category: "technical_projects",
            content: "Relevant projects include SayNext, CueFlow, and JobLens AI.",
            score: 0.9,
          },
        ];
      }
      return [{
        id: 133,
        title: "Cloud architecture best practices",
        category: "knowledge_lecture_cloud_ai",
        content: "Use managed services and separate system tiers.",
        score: 0.99,
      }];
    },
  };
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "Tell me a little bit about yourself.",
    triggerWindow: "Tell me a little bit about yourself.",
    recentTranscript: "Conversation turn: We were discussing CSS scaling.",
  });

  expect(calls).toEqual([
    expect.stringContaining("Tell me a little bit about yourself."),
  ]);
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:32"]);
  expect(snapshot.contextSnapshot).not.toContain("Cloud architecture best practices");
  expect(snapshot.contextSnapshot).toContain("Current question or request, this is the authoritative topic");
});

test("EvenHub v2 intro gets role framing from an approved answer card instead of job memory", async () => {
  const calls: string[] = [];
  const activeInterviewQuery = "DeepSense Full-Stack AI Developer Fall 2026 interview";
  const retriever: EvenHubV2MemoryRetriever = {
    async search(_userId, query) {
      calls.push(query);
      if (query === activeInterviewQuery) {
        return [{
          id: 4724,
          title: "DeepSense Full-Stack AI Developer co-op - role fit and interview grounding",
          category: "interview_job",
          content: "Professor Lu shared this role with Xiang. CueFlow, SayNext, and AI Meeting Monitor are relevant conversation AI projects.",
          score: 1,
        }];
      }
      if (query.includes("tell me a little bit about yourself")) {
        return [
          {
            id: 32,
            title: "Resume - Xiang skills and profile",
            category: "technical_skills",
            content: "Xiang is a MACS student at Dalhousie and completed his BCS at Acadia.",
            score: 0.95,
          },
          {
            id: 33,
            title: "Resume - selected project list",
            category: "technical_projects",
            content: "Relevant projects include SayNext, CueFlow, and AI Meeting Monitor.",
            score: 0.9,
          },
        ];
      }
      return [{
        id: 133,
        title: "Cloud architecture best practices",
        category: "knowledge_lecture_cloud_ai",
        content: "Use managed services and automate scaling.",
        score: 0.99,
      }];
    },
  };
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
    activeInterviewQuery,
    interviewCards: [{
      id: "deepsense:intro",
      question: "Tell me a little bit about yourself.",
      guidance: "Professor Lu shared this role with Xiang. Connect CueFlow, SayNext, and AI Meeting Monitor to it.",
      exampleAnswer: "Yeah, sure. I'm Xiang. I'm doing my MACS at Dal right now.",
      section: "A. Opening and fit",
    }],
    memoryLimit: 5,
    memoryMaxChars: 2600,
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "So tell me a little bit about yourself, okay?",
    triggerWindow: "So tell me a little bit about yourself, okay?",
    recentTranscript: "",
  });

  expect(calls).toEqual([
    expect.stringContaining("tell me a little bit about yourself"),
  ]);
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:32"]);
  expect(snapshot.interviewAnswerCardIds).toEqual(["interview-answer:deepsense:intro"]);
  expect(snapshot.contextSnapshot).toContain("Professor Lu shared this role with Xiang");
  expect(snapshot.contextSnapshot).toContain("CueFlow, SayNext, and AI Meeting Monitor");
  expect(snapshot.contextSnapshot).not.toContain("personal-memory:4724");
  expect(snapshot.contextSnapshot).not.toContain("Resume - selected project list");
  expect(snapshot.contextSnapshot).not.toContain("Cloud architecture best practices");
});

test("EvenHub v2 does not inject personal project memory into a generic technical question", async () => {
  const retriever = new FakeMemoryRetriever([{
    id: 4725,
    title: "Project CueFlow - current cloud architecture and product flow",
    category: "technical_projects",
    content: "CueFlow uses AWS services and WebSocket messaging.",
    score: 0.91,
  }]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "What is the difference between precision and recall?",
    triggerWindow: "What is the difference between precision and recall?",
    recentTranscript: "",
  });

  expect(snapshot.memoryUsedIds).toEqual([]);
  expect(snapshot.contextSnapshot).not.toContain("Project CueFlow");
  expect(retriever.calls).toHaveLength(0);
});

test("EvenHub v2 skips dynamic memory retrieval for generic code and system-design questions", async () => {
  const retriever = new FakeMemoryRetriever([{
    id: 145,
    title: "Terraform deployment note",
    category: "knowledge_cloud_architecture",
    content: "A generic infrastructure note that must not leak into an unrelated code answer.",
    score: 0.99,
  }]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const code = await adapter.build({
    ...contextInput(),
    currentQuestion: "write a function that returns the first duplicate number and explain the complexity",
    triggerWindow: "write a function that returns the first duplicate number and explain the complexity",
    recentTranscript: "Interviewer: Let's move to a coding question.",
  });
  const design = await adapter.build({
    ...contextInput(),
    currentQuestion: "how would you design a URL shortener for ten million links",
    triggerWindow: "how would you design a URL shortener for ten million links",
    recentTranscript: "Interviewer: Now a general system design question.",
  });

  expect(retriever.calls).toHaveLength(0);
  expect(code.memoryUsedIds).toEqual([]);
  expect(design.memoryUsedIds).toEqual([]);
});

test("EvenHub v2 reuses one retrieval result for speculative and final forms of the same question", async () => {
  const retriever = new FakeMemoryRetriever([{
    id: 4721,
    title: "Project SayNext - architecture",
    category: "technical_projects",
    sourceRef: "project:saynext:architecture",
    content: "SayNext combines live transcripts, retrieval, and generation.",
    score: 0.92,
  }]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });
  const partialQuestion = "uh okay can you explain your SayNext architecture";
  const finalQuestion = "Can you explain your SayNext architecture?";

  await adapter.build({
    ...contextInput(),
    currentQuestion: partialQuestion,
    triggerWindow: partialQuestion,
    recentTranscript: "",
  });
  await adapter.build({
    ...contextInput(),
    currentQuestion: finalQuestion,
    triggerWindow: finalQuestion,
    recentTranscript: "Interviewer: Can you explain your SayNext architecture?",
  });

  expect(retriever.calls).toHaveLength(1);
});

test("EvenHub v2 resolves a referential follow-up to the recently named project", async () => {
  const retriever = new FakeMemoryRetriever([
    {
      id: 4723,
      title: "Project SayNext - integration challenge",
      category: "project_experience",
      sourceRef: "project:saynext:integration-challenge",
      content: "The hardest part was keeping live transcript updates and glasses navigation independent.",
      score: 0.71,
    },
    {
      id: 36,
      title: "Project JobLens AI - cloud architecture",
      category: "technical_projects",
      sourceRef: "project:joblens:architecture",
      content: "JobLens uses Lambda and DynamoDB.",
      score: 0.98,
    },
  ]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "what was the hardest part of that?",
    triggerWindow: "what was the hardest part of that?",
    recentTranscript: "Interviewer: Can you explain the SayNext architecture?",
  });

  expect(retriever.calls[0]?.query).toContain("SayNext");
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:4723"]);
  expect(snapshot.contextSnapshot).not.toContain("Project JobLens AI");
});

test("EvenHub v2 prioritizes query-specific project evidence over generic profile memory", async () => {
  const calls: string[] = [];
  const retriever: EvenHubV2MemoryRetriever = {
    async search(_userId, query) {
      calls.push(query);
      if (query === "Resume Xiang skills profile selected project list interview answer style") {
        return [{
          id: 32,
          title: "Resume - Xiang skills and profile",
          category: "technical_skills",
          content: "Xiang builds AI-powered web, mobile, and cloud applications.",
          score: 0.95,
        }];
      }
      return [{
        id: 4721,
        title: "Project SayNext / EvenHub v2 - current architecture and product flow",
        category: "technical_projects",
        content: "SayNext is a conversational assistant with hybrid personal-memory retrieval and LLM generation.",
        score: 1.1,
      }];
    },
  };
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "What kind of experience do you have with RAG and chatbots?",
    triggerWindow: "What kind of experience do you have with RAG and chatbots?",
    recentTranscript: "",
  });

  expect(calls[0]).toBe("What kind of experience do you have with RAG and chatbots?");
  expect(calls).toEqual(["What kind of experience do you have with RAG and chatbots?"]);
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:4721"]);
  expect(snapshot.contextSnapshot).toContain("cards are ordered by relevance");
  expect(snapshot.contextSnapshot).not.toContain("Resume - Xiang skills and profile");
});

test("EvenHub v2 adds one matching interview answer card and caps dynamic cards at three", async () => {
  const answerCards: InterviewAnswerCard[] = [{
    id: "deepsense:intro",
    question: "Tell me a little about yourself.",
    guidance: "Start with the current degree, then connect recent AI projects to the role.",
    exampleAnswer: "Yeah, sure. I'm Xiang. I'm doing my MACS at Dal right now.",
    section: "A. Opening and fit",
  }];
  const retriever = new FakeMemoryRetriever([
    {
      id: 32,
      title: "Resume - Xiang skills and profile",
      category: "technical_skills",
      content: "Xiang is a MACS student at Dalhousie and completed his BCS at Acadia.",
      score: 1,
    },
    {
      id: 4724,
      title: "DeepSense Full-Stack AI Developer co-op - role fit",
      category: "interview_job",
      content: "Professor Lu sent Xiang the role, which closely matches his conversation AI work.",
      score: 0.95,
    },
    {
      id: 4721,
      title: "Project SayNext",
      category: "technical_projects",
      content: "SayNext gives useful conversation help at the right time.",
      score: 0.9,
    },
  ]);
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: retriever,
    memoryUserId: "xiang-memory-user",
    interviewCards: answerCards,
    activeInterviewQuery: "DeepSense Full-Stack AI Developer Fall 2026 interview",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "so tell me little bit about yourself okay",
    triggerWindow: "so tell me little bit about yourself okay",
    recentTranscript: "",
  });

  expect(snapshot.interviewAnswerCardIds).toEqual(["interview-answer:deepsense:intro"]);
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:32"]);
  expect(snapshot.contextSnapshot).not.toContain("Project SayNext");
  expect(snapshot.contextSnapshot).toContain("Approved interview answer context");
  expect(snapshot.contextSnapshot).toContain("approved answer direction and question-scoped facts");
  expect(snapshot.contextSnapshot).toContain("never transfer them to another topic");
  expect(snapshot.contextSnapshot).toContain("Current question or request, this is the authoritative topic");
  expect(snapshot.contextSnapshot).toContain("The current question decides what to answer");
  expect(snapshot.contextSnapshot).toContain("approved interview context overrides retrieved memory");
  expect(snapshot.contextSnapshot.indexOf("Approved interview answer context"))
    .toBeLessThan(snapshot.contextSnapshot.indexOf("Verified detailed personal memory facts"));
});

test("EvenHub v2 strips generated answer advice from otherwise useful personal memory", async () => {
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: new FakeMemoryRetriever([{
      id: 7100,
      title: "AI Meeting Monitor integration incident",
      category: "project_experience",
      content: [
        "Near the deadline, the frontend and backend disagreed on API field names.",
        "Xiang fixed the frontend mapping, verified backend write-back, and smoke-tested the demo flow.",
        "The final demo worked and the project received an A grade.",
        "Suggested answer direction: Say I am a strong integration engineer.",
        "Good answer: This experience taught me the importance of teamwork.",
      ].join("\n"),
      score: 1,
    }]),
    memoryUserId: "xiang-memory-user",
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "Tell me about a difficult integration problem you handled.",
    triggerWindow: "Tell me about a difficult integration problem you handled.",
    recentTranscript: "",
  });

  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:7100"]);
  expect(snapshot.contextSnapshot).toContain("frontend mapping");
  expect(snapshot.contextSnapshot).toContain("received an A grade");
  expect(snapshot.contextSnapshot).not.toContain("Suggested answer direction");
  expect(snapshot.contextSnapshot).not.toContain("Good answer");
  expect(snapshot.contextSnapshot).not.toContain("importance of teamwork");
});

test("EvenHub v2 adds one reusable answer policy card without treating it as memory", async () => {
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: new FakeMemoryRetriever([{
      id: 7100,
      title: "AI Meeting Monitor integration incident",
      category: "project_experience",
      content: "Xiang traced an API field mismatch, fixed frontend mapping, verified backend write-back, and smoke-tested the final demo flow.",
      score: 1,
    }]),
    memoryUserId: "xiang-memory-user",
    interviewCards: [],
  });

  const snapshot = await adapter.build({
    ...contextInput(),
    currentQuestion: "Tell me about some harsh feedback you received in code review.",
    triggerWindow: "Tell me about some harsh feedback you received in code review.",
    recentTranscript: "",
  });

  expect(snapshot.answerPolicyCardIds).toEqual([
    "answer-policy:behavioral-code-review-feedback",
  ]);
  expect(snapshot.contextSnapshot).toContain("Reusable answer policy");
  expect(snapshot.contextSnapshot).toContain("not personal-memory evidence");
  expect(snapshot.contextSnapshot).toContain("verified Xiang memory");
  expect(snapshot.memoryUsedIds).toEqual(["personal-memory:7100"]);
});

test("EvenHub v2 tracks selected prenote ids without repeating prenote text per turn", async () => {
  const adapter = new LightweightEvenHubV2ContextAdapter({
    memoryRetriever: new FakeMemoryRetriever([]),
    memoryUserId: "xiang-memory-user",
    interviewCards: [],
  });
  const selectedPrenote = "Prepared once at conversation startup, not repeated in each cue request.";

  const snapshot = await adapter.build({
    ...contextInput(),
    selectedPrenoteIds: ["pn-once"],
    selectedPrenoteText: selectedPrenote,
    recentTranscript: "",
  });

  expect(snapshot.prenoteUsedIds).toEqual(["pn-once"]);
  expect(snapshot.contextSnapshot).not.toContain(selectedPrenote);
  expect(snapshot.contextSnapshot).not.toContain("Selected prenote");
});
