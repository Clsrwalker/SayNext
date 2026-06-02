import { describe, expect, test } from "bun:test";
import {
  classifyMemoryQueryIntent,
  isEvalExpectedHit,
  rerankMemoryCandidatesForIntent,
  resolveMemoryIdentity,
  validateEvalTop1,
  type CanonicalProjectId,
  type EvalExpectedMemoryTarget,
  type MemoryFacet,
  type MemoryPool,
  type MemoryQueryIntent,
} from "../data/memory-taxonomy";

describe("resolveMemoryIdentity", () => {
  test("resolves canonical project identity from doc sourceRef without treating sourceRef as the identity field", () => {
    const result = resolveMemoryIdentity({
      sourceRef: "doc:joblens:overview-scope",
      title: "Project JobLens AI - overview and scope",
      content: "JobLens AI is a cloud-based job aggregation, resume matching, and application tracking app.",
      keywords: ["JobLens AI", "job matching", "resume upload"],
      category: "technical_projects",
    });

    expect(result.canonicalProjectId).toBe("joblens");
    expect(result.origin).toBe("doc");
    expect(result.facet).toBe("project_definition");
  });

  test("resolves project identity from title/content when sourceRef has drifted", () => {
    const result = resolveMemoryIdentity({
      sourceRef: "xiang-update:2026-05-19:cloud-project-selection",
      title: "Cloud project selection: JobLens AI",
      content: "Use JobLens AI for cloud architecture questions because it uses S3, Lambda, API Gateway, and DynamoDB.",
      keywords: ["cloud project", "aws", "lambda", "dynamodb"],
      category: "technical_projects",
    });

    expect(result.canonicalProjectId).toBe("joblens");
    expect(result.origin).toBe("xiang_update");
    expect(["architecture", "technical_decision"]).toContain(result.facet);
  });

  test("resolves redacted/imported origin separately from project identity", () => {
    const result = resolveMemoryIdentity({
      sourceRef: "redacted-project:elderalbum-serverless-album-sharing",
      title: "Serverless album sharing app",
      content: "ElderAlbum uses Lambda, API Gateway, DynamoDB, S3, and SAM for a photo album sharing project.",
      keywords: ["ElderAlbum", "serverless", "album sharing", "AWS"],
      category: "technical_projects",
    });

    expect(result.canonicalProjectId).toBe("elderalbum");
    expect(result.origin).toBe("redacted_project");
    expect(result.facet).toBe("architecture");
  });

  test("resolves behavioral memory to the same project but keeps story facet", () => {
    const result = resolveMemoryIdentity({
      sourceRef: "xiang-behavioral:achievement-joblens",
      title: "Achievement story about JobLens",
      content: "A story about improving JobLens under pressure and creating user impact.",
      keywords: ["achievement", "impact", "JobLens"],
      category: "behavioral",
    });

    expect(result.canonicalProjectId).toBe("joblens");
    expect(result.origin).toBe("xiang_behavioral");
    expect(["behavioral_story", "achievement_story", "impact_story"]).toContain(result.facet);
  });

  test("does not over-resolve generic technical knowledge to a project", () => {
    const result = resolveMemoryIdentity({
      sourceRef: "knowledge:generic:hybrid-search",
      title: "Hybrid search overview",
      content: "BM25 and vector retrieval can be combined for generic search quality.",
      keywords: ["BM25", "embedding", "hybrid search"],
      category: "technical_knowledge",
    });

    expect(result.canonicalProjectId).toBe("unknown");
    expect(result.facet).toBe("memory_personalization");
  });

  test("resolves additional project aliases without sourceRef special-casing", () => {
    const studyTracker = resolveMemoryIdentity({
      sourceRef: "xiang-profile:project-study-session-tracker",
      title: "Project Study Session Tracker",
      content: "Study Session Tracker uses Firebase Authentication, Firestore, a study timer, dashboard, reminders, to-do list, and calendar.",
      keywords: ["Firebase", "study timer", "Study Session Tracker"],
      category: "technical_projects",
    });

    const meetingMonitor = resolveMemoryIdentity({
      sourceRef: "xiang-update:project-integration-story",
      title: "AI Meeting Monitor integration story",
      content: "AI Meeting Monitor turns meeting transcripts into summaries, decisions, action items, and follow-up tasks.",
      keywords: ["meeting transcript", "AI Meeting Monitor"],
      category: "project_experience",
    });

    expect(studyTracker.canonicalProjectId).toBe("study_session_tracker");
    expect(meetingMonitor.canonicalProjectId).toBe("ai_meeting_monitor");
  });
});

describe("classifyMemoryQueryIntent", () => {
  const cases: Array<[string, MemoryQueryIntent, MemoryPool, CanonicalProjectId]> = [
    ["What is JobLens AI?", "project_definition", "factual", "joblens"],
    ["How does JobLens resume upload and matching work?", "architecture", "factual", "joblens"],
    ["What API routes did ElderAlbum have?", "architecture", "factual", "elderalbum"],
    ["What did the user evaluation find for DalParkAid?", "technical_decision", "factual", "dalparkaid"],
    ["Tell me a time you improved JobLens", "behavioral_story", "behavioral", "joblens"],
    ["What impact did ElderAlbum have?", "impact_story", "behavioral", "elderalbum"],
    ["What is backpropagation?", "project_definition", "factual", "unknown"],
  ];

  for (const [query, expectedIntent, expectedPool, expectedProject] of cases) {
    test(query, () => {
      const result = classifyMemoryQueryIntent(query);
      expect(result.intent).toBe(expectedIntent);
      expect(result.preferredPool).toBe(expectedPool);
      expect(result.canonicalProjectId).toBe(expectedProject);
    });
  }
});

describe("facet-aware rerank guardrail", () => {
  type TestCandidate = {
    id: string;
    sourceRef: string;
    canonicalProjectId: "joblens";
    facet: MemoryFacet;
    baseScore: number;
    reasons: string[];
  };

  test("factual project query does not allow a close behavioral story as top1", () => {
    const queryIntent = classifyMemoryQueryIntent("What is JobLens AI?");
    const candidates: TestCandidate[] = [
      {
        id: "behavioral",
        sourceRef: "xiang-behavioral:achievement-joblens",
        canonicalProjectId: "joblens",
        facet: "achievement_story",
        baseScore: 0.91,
        reasons: ["vector_rank:1"],
      },
      {
        id: "factual",
        sourceRef: "doc:joblens:overview-scope",
        canonicalProjectId: "joblens",
        facet: "project_definition",
        baseScore: 0.78,
        reasons: ["vector_rank:2"],
      },
    ];

    const reranked = rerankMemoryCandidatesForIntent(candidates, queryIntent, {
      factualRepairThreshold: 0.18,
    });

    expect(reranked[0]?.candidate.id).toBe("factual");
    expect(reranked[0]?.reasons).toContain("repair:factual_query_prefers_factual_memory");
  });

  test("behavioral project query can rank behavioral story top1", () => {
    const queryIntent = classifyMemoryQueryIntent("Tell me a time you improved JobLens");
    const candidates: TestCandidate[] = [
      {
        id: "behavioral",
        sourceRef: "xiang-behavioral:achievement-joblens",
        canonicalProjectId: "joblens",
        facet: "achievement_story",
        baseScore: 0.91,
        reasons: [],
      },
      {
        id: "factual",
        sourceRef: "doc:joblens:overview-scope",
        canonicalProjectId: "joblens",
        facet: "project_definition",
        baseScore: 0.86,
        reasons: [],
      },
    ];

    const reranked = rerankMemoryCandidatesForIntent(candidates, queryIntent, {
      factualRepairThreshold: 0.18,
    });

    expect(reranked[0]?.candidate.id).toBe("behavioral");
  });

  test("factual repair does not promote a very weak factual candidate", () => {
    const queryIntent = classifyMemoryQueryIntent("What is JobLens AI?");
    const candidates: TestCandidate[] = [
      {
        id: "behavioral",
        sourceRef: "xiang-behavioral:achievement-joblens",
        canonicalProjectId: "joblens",
        facet: "achievement_story",
        baseScore: 0.95,
        reasons: [],
      },
      {
        id: "weak-factual",
        sourceRef: "doc:joblens:overview-scope",
        canonicalProjectId: "joblens",
        facet: "project_definition",
        baseScore: 0.5,
        reasons: [],
      },
    ];

    const reranked = rerankMemoryCandidatesForIntent(candidates, queryIntent, {
      factualRepairThreshold: 0.18,
    });

    expect(reranked[0]?.candidate.id).toBe("behavioral");
    expect(reranked[0]?.reasons).not.toContain("repair:factual_query_prefers_factual_memory");
  });
});

describe("memory eval oracle", () => {
  const expected: EvalExpectedMemoryTarget = {
    expectedCanonicalProjectId: "joblens",
    acceptedFacets: ["project_definition", "positioning", "architecture"],
    acceptedSourceRefPatterns: [/^doc:joblens:/, /cloud-project-selection/],
    disallowedTop1Facets: ["behavioral_story", "achievement_story"],
  };

  test("accepts canonical project alias even when sourceRef is not the old doc anchor", () => {
    const result = {
      sourceRef: "xiang-update:2026-05-19:cloud-project-selection",
      canonicalProjectId: "joblens" as const,
      facet: "architecture" as const,
    };

    expect(isEvalExpectedHit(result, expected)).toBe(true);
  });

  test("rejects behavioral story as top1 for factual expected target", () => {
    const top1 = {
      sourceRef: "xiang-behavioral:achievement-joblens",
      canonicalProjectId: "joblens" as const,
      facet: "achievement_story" as const,
    };

    const validation = validateEvalTop1(top1, expected);
    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe("disallowed_top1_facet");
  });

  test("still accepts legacy project doc source refs", () => {
    const result = {
      sourceRef: "doc:joblens:overview-scope",
      canonicalProjectId: "joblens" as const,
      facet: "project_definition" as const,
    };

    expect(isEvalExpectedHit(result, expected)).toBe(true);
  });
});
