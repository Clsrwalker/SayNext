import { conversationLogger, type PersonalMemorySensitivity } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type MemorySeed = {
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  sourceRef: string;
};

const memories: MemorySeed[] = [
  {
    title: "Project SayNext / EvenHub v2 - current architecture and product flow",
    category: "technical_projects",
    sensitivity: "low",
    sourceRef: "saynext-project:evenhub-v2-architecture:2026-07-20",
    keywords: [
      "SayNext", "EvenHub v2", "G2", "smart glasses", "real-time transcript",
      "AssemblyAI", "Deepgram", "WebSocket", "auto cue", "personal memory", "SQLite",
      "RAG", "chatbot", "hybrid retrieval", "conversational assistant",
    ],
    usageRule: "Use for questions about SayNext, conversational AI, full-stack AI, real-time systems, RAG/memory, wearable apps, debugging, or project architecture. Keep it as an active personal project, not production customer experience.",
    content: `SayNext is Xiang's active real-time conversation assistant and chatbot/RAG-style project. It uses hybrid retrieval over Xiang's personal, project, interview, and technical knowledge memories to ground LLM responses in relevant context. The EvenHub v2 client provides a phone interface and an Even Reality G2 glasses interface. It captures audio from the selected phone or glasses microphone, streams PCM audio over WebSocket, receives live partial/final transcription, and displays short suggestions for what Xiang can say next.

Current architecture and flow:
- EvenHub phone/glasses client controls conversation lifecycle, microphone source, live transcript, cue history, settings, and glasses rendering.
- A TypeScript/Bun server owns the v2 WebSocket protocol and a runtime with independent conversation, audio, and background cue-job state.
- STT is behind a provider adapter and has been tested with AssemblyAI and Deepgram. The runtime records audio/STT diagnostics, keeps partial revisions out of canonical transcript storage, and can use a stable partial for hidden cue pre-generation before the matching provider final arrives.
- Final or stable transcript context feeds a local DistilBERT cue-opportunity router. The router predicts whether the current context likely needs a cue; it does not write the cue text.
- An OpenAI model writes the final response/concept/suggestion/person cue using recent transcript, selected prenote, and retrieved personal/project/knowledge memory.
- SQLite stores conversations, final transcript lines, cue attempts, displayed cues, settings, and asynchronous post-conversation summaries.
- The glasses menu keeps prenote and cue history available while transcript updates continue without intentionally interrupting a menu or detail view.

Important engineering challenges included microphone source mismatches, STT sensitivity and finalization, connection/render timing on the glasses SDK, keeping transcript updates from rebuilding the cue list, stale generation after conversation state changes, settings persistence, and diagnosing why a cue was generated or skipped.

Honest role framing: Xiang designed and iterated on this as his own active project, including frontend, WebSocket/backend runtime, STT integration, LLM prompting, memory retrieval, ML router integration, persistence, testing, VPS deployment, and device debugging. Do not claim production customer scale or a finished commercial product.` ,
  },
  {
    title: "Project SayNext Context Router v2 - deep learning training and evaluation",
    category: "technical_projects_ml",
    sensitivity: "low",
    sourceRef: "saynext-project:context-router-v2:2026-07-19",
    keywords: [
      "SayNext context router", "DistilBERT", "deep learning", "binary classifier", "cue needed",
      "PyTorch", "ONNX", "quantization", "recall", "validation", "threshold", "training data",
    ],
    usageRule: "Use for ML/deep-learning project, model evaluation, imbalanced costs, deployment, or SayNext cue-timing questions. Preserve the development-candidate limitation and do not say the unopened internal test was evaluated.",
    content: `Xiang trained SayNext Context Router v2 as a binary deep-learning classifier for cue timing. Its job is only to predict NO_CUE versus CUE_NEEDED from the latest three transcript segments; cue category and final wording stay outside this model.

Verified training design from the July 19, 2026 report:
- 2,100 annotation rows were audited. The formal NATURAL_PRIMARY training set had 1,783 rows across 1,472 canonical groups, with 975 positive and 808 negative labels.
- Input serialization is SEG_MINUS_2, SEG_MINUS_1, CURRENT. It excludes speaker identity, source, labels, audit metadata, and reference next turns. Left-side truncation preserves the newest CURRENT content within a maximum length of 256 tokens.
- Base model: distilbert-base-uncased. Stage 1 trained the classifier/pre-classifier for one epoch. Stage 2 trained the top two transformer layers plus the classifier; the selected schedule used three top-layer epochs.
- Epoch/threshold selection treated false negatives as three times as costly as false positives because missing a needed cue is especially harmful for SayNext.
- On the locked natural validation set of 122 rows, the selected threshold was 0.519233. Results were TN=41, FP=8, FN=3, TP=70, recall=0.9589, precision=0.8974, F1=0.9272, ROC-AUC=0.9634, and PR-AUC=0.9786.
- The model was exported and quantized to ONNX for lightweight server inference and integrated into the EvenHub v2 cue pipeline as a routing signal.

Limitations and honest framing:
- The report calls it a development candidate, not a deployment-final model.
- The reserved INTERNAL_TEST remained unopened in the report, so do not claim internal-test performance.
- The model improves cue-opportunity detection, but an LLM still handles retrieval-aware cue content.

Speakable summary: "I trained a small DistilBERT classifier to decide when SayNext should generate a cue. I used the latest three transcript segments, kept the task binary, and weighted false negatives more heavily because missing a question is worse for my use case. It reached about 95.9% recall on a locked natural validation set, then I exported a quantized ONNX model and integrated it before the LLM generation step."`,
  },
  {
    title: "SayNext interview stories - ownership, debugging, and trade-offs",
    category: "behavioral_story",
    sensitivity: "medium",
    sourceRef: "saynext-project:interview-stories:2026-07-20",
    keywords: [
      "SayNext interview", "hard bug", "debugging", "ownership", "trade-off", "latency",
      "STT", "glasses render", "memory retrieval", "testing", "VPS deployment",
    ],
    usageRule: "Use only for interview questions about a difficult bug, ownership, failure, trade-offs, iteration, or an AI project. Pick one concrete story and keep the answer short; do not combine every issue into one exaggerated story.",
    content: `Safe SayNext interview story options:

1. Real-time UI/render bug:
Transcript updates were causing the glasses cue list to rebuild or lose its navigation state. Xiang traced the problem to mixing high-frequency transcript updates with structural page renders. The lesson was to separate stable UI structure from incremental transcript updates and to test device event timing, not only browser state.

2. Microphone/STT reliability bug:
The app could show listening while receiving no usable transcript, and phone/glasses source mismatches made diagnosis difficult. Xiang added source diagnostics, chunk/byte/audio statistics, provider-level partial/final counts, startup buffering, and clearer audio states. This separated device capture problems from STT-provider quality problems.

3. Cue quality and timing trade-off:
Hard cooldown, rate limits, and an LLM confidence threshold suppressed useful cues. Xiang changed the architecture so a small local ML router detects likely cue opportunities while the LLM focuses on producing useful content. The trade-off is more cues and some false positives versus fewer missed questions; for SayNext, recall is intentionally more important.

4. Memory grounding:
Generic interview answers sounded fluent but were not reliably tied to Xiang's real projects. Xiang added hybrid personal-memory retrieval, separate project/knowledge grounding, traceable memory IDs, and prompt rules that general technical knowledge cannot prove personal experience.

Honest result framing: these changes made the system easier to diagnose and closer to Xiang's actual real-time use, but it remains an actively iterated personal/student project rather than a mature production service.` ,
  },
  {
    title: "DeepSense Full-Stack AI Developer co-op - role fit and interview grounding",
    category: "interview_job",
    sensitivity: "low",
    sourceRef: "job:deepsense-full-stack-ai-developer-fall-2026",
    keywords: [
      "DeepSense", "Full-Stack AI Developer", "co-op", "Fall 2026", "RAG chatbot",
      "document matching", "document ranking", "agentic tools", "AWS", "Python", "JavaScript",
    ],
    usageRule: "Use when preparing for or answering DeepSense Full-Stack AI Developer co-op interview questions. Ground personal claims in the listed projects and clearly separate current experience from skills Xiang is still learning.",
    content: `The DeepSense Fall 2026 Full-Stack AI Developer co-op is a four-month hands-on role. The posting emphasizes public/internal chatbots, RAG over website and internal knowledge, integration with project/application portals, document matching/ranking, maintenance of agentic project-management tools, tests, monitoring, documentation, AWS, Python or JavaScript, REST APIs, and LLM APIs/frameworks.

Professor Lu sent Xiang this role description. After reading it, Xiang felt it was unusually close to the AI applications he had already been building, so his interest is in the project itself rather than only finding any co-op.

At the time of this interview, Xiang is completing his Summer 2026 MACS courses. CueFlow, SayNext, and AI Meeting Monitor share a useful theme for this role: understanding live or recorded conversations and turning context into timely, useful assistance.

Xiang's strongest honest matches:
- CueFlow: a mobile-first cloud-native conversation intelligence MVP with live transcript, AI cue cards, prepared context, asynchronous cue/summary workers, API Gateway WebSocket, Lambda, SQS, DynamoDB, S3, CloudFront, CDK, and OpenAI Realtime transcription. This maps to full-stack AI product work, AWS, real-time conversational systems, and reliable asynchronous processing.
- SayNext / Hybrid Search Memory Assistant: a real-time conversational assistant using transcript context, hybrid personal-memory retrieval, prenotes, LLM generation, a local cue-timing classifier, testing, observability, persistence, and VPS/device deployment. This maps directly to conversational AI, retrieval grounding, prompt design, and iteration from real usage.
- AI Meeting Monitor: a multi-service React/Flask/FastAPI/Node system using speech-to-text and Gemini analysis. Xiang's safest contribution framing is integration, API/data mapping, debugging, testing, and demo stabilization.
- JobLens AI: cloud job aggregation, normalization/deduplication, resume parsing and matching, stored job data, and application tracking. Its detailed cloud design uses React/S3, API Gateway, FastAPI/Lambda, DynamoDB, S3, CloudWatch, EventBridge/manual ingestion, and Terraform. This maps to document matching/ranking, REST APIs, data pipelines, and AWS.
- ElderAlbum: a smaller AWS serverless app using React/S3, API Gateway, Lambda, DynamoDB, SAM/CloudFormation, share links, and deployment automation. This is a clear second AWS architecture example.
- Current languages and tools: strongest in JavaScript/TypeScript for web apps, with Python/FastAPI experience, React, REST APIs, databases, AWS serverless, GitLab CI/CD, testing, and LLM integration.

Gaps to state honestly:
- Do not claim production-scale chatbot users, formal company experience, or senior-level ML/DevOps/security depth.
- Do not claim strong hands-on LangChain, LlamaIndex, LangGraph, AutoGen, CrewAI, Pinecone, Chroma, or Weaviate experience unless Xiang confirms it. SayNext has custom hybrid retrieval and embeddings, which provides transferable RAG knowledge without those framework claims.

Suggested answer direction: "This role is unusually close to what I have been building. SayNext gave me hands-on experience with a conversational assistant, retrieval and memory grounding, LLM prompts, real-time evaluation, and deployment. JobLens gave me a document-matching and AWS example, and ElderAlbum gave me another serverless AWS project. I am still early in my career and have not used every agent framework in production, but the core workflow is very aligned with my projects, and I can contribute while learning the team's stack."`,
  },
  {
    title: "Project CueFlow - current cloud architecture and product flow",
    category: "technical_projects",
    sensitivity: "low",
    sourceRef: "cueflow-project:architecture:2026-07-20",
    keywords: [
      "CueFlow", "CSCI 5411", "conversation intelligence", "OpenAI Realtime", "WebRTC",
      "API Gateway WebSocket", "Lambda", "SQS", "DynamoDB", "S3", "CloudFront", "CDK",
    ],
    usageRule: "Use for CueFlow, AWS/cloud architecture, real-time AI, WebSocket, async processing, conversation intelligence, or full-stack project questions. Treat documented NFR numbers as design targets, not measured production results.",
    content: `CueFlow is Xiang's CSCI 5411 mobile-first cloud-native conversation intelligence MVP. A user signs in, manages prepared notes, starts a phone/browser-microphone conversation, sees live transcript and lightweight AI cue cards, pauses or ends the session, and later reviews history, transcript, cues, and a structured summary.

Current implementation and cloud flow:
- Frontend: React, TypeScript, and Vite with mobile-first session list, prepared-note manager, live conversation workspace, cue cards, transcript, settings, and history/summary views.
- Current live transcription path: the browser microphone connects to OpenAI Realtime transcription through WebRTC using a short-lived client secret created by the backend. The client handles transcript deltas/completions and has voice-activity/finalization logic. A MediaRecorder/cloud transcription fallback also exists.
- Final transcript chunks are sent through API Gateway WebSocket. The WebSocket Lambda validates and persists them, evaluates cue-trigger context, acknowledges ingest, and enqueues cue work when needed.
- Cue generation is asynchronous: SQS delivers work to a cue-worker Lambda, which loads recent transcript/prepared context, calls the configured OpenAI provider, validates and stores a cue, then pushes cue.created through API Gateway WebSocket.
- Session end uses a separate SQS summary queue and summary-worker Lambda. It builds a structured summary with key topics, action items, and risks, persists it, and pushes summary.ready.
- DynamoDB uses a single-table metadata model for conversations, transcript metadata, cues, jobs, and WebSocket connections. S3 stores larger raw transcript and summary objects.
- Infrastructure is defined with AWS CDK. It includes API Gateway HTTP/WebSocket APIs, Lambda handlers/workers, SQS queues and DLQs, DynamoDB, S3, Secrets Manager, CloudWatch dashboards/alarms, and S3/CloudFront frontend hosting. An API Gateway HTTPS static-frontend fallback handles restricted AWS Learner Lab environments.
- GitHub Actions runs install, unit tests, typecheck, build, and CDK synth, with optional OIDC-based deployment.

Prepared notes are background prompt context, not automatic conversation facts. The AI layer is isolated behind a provider abstraction with deterministic mock providers for tests and OpenAI for the deployed path.` ,
  },
  {
    title: "Project CueFlow - AWS trade-offs, testing, and honest limitations",
    category: "project_experience",
    sensitivity: "low",
    sourceRef: "cueflow-project:tradeoffs-limitations:2026-07-20",
    keywords: [
      "CueFlow trade-off", "AWS Well-Architected", "SQS worker", "Lambda vs Fargate",
      "DynamoDB vs RDS", "WebSocket vs polling", "Learner Lab", "testing", "limitations",
    ],
    usageRule: "Use for system-design, AWS, reliability, cost, testing, difficult-decision, or project-limitation interview questions. State the course-MVP constraints and do not present NFR targets or mocked AWS tests as measured production evidence.",
    content: `CueFlow provides several concrete cloud/system-design trade-offs:

- WebSocket versus REST polling: WebSocket gives timely cue delivery, while REST remains simpler for history and summaries. The cost is connection-state management; CueFlow stores connection records and removes stale connections after failed pushes.
- Synchronous AI versus SQS workers: transcript ingest persists and acknowledges before model generation, so LLM latency does not block the real-time ingest path. SQS and DLQs add retry isolation, but the UI must represent pending states and eventual consistency.
- Lambda versus ECS/Fargate: Lambda fits short, bursty course-demo workloads and lowers operations work. It is less suitable for long-running streaming compute, so CueFlow keeps handlers short and moves AI work to queues.
- DynamoDB versus RDS: known access patterns such as user history, conversation chunks, cue lists, and connection state fit a key-oriented single-table design. The trade-off is weaker ad hoc relational querying.
- DynamoDB plus S3: queryable metadata stays in DynamoDB while larger transcript and summary objects use S3. This reduces cost and item-size pressure but creates a two-store consistency problem, so transcript metadata/raw content is persisted before AI work.
- OpenAI versus deterministic mock: real AI is used in the deployed path, while mock providers keep unit tests deterministic and inexpensive. The provider boundary also isolates model/key handling.
- CloudFront versus Learner Lab fallback: private S3 plus CloudFront is the preferred frontend, but restricted lab IAM/CloudFront policies required an API Gateway HTTPS static frontend option so browser microphone permissions still work.

Testing covers shared validation/key builders, cue trigger policy, AI provider normalization, REST and WebSocket handlers, in-memory storage/queues, conversation service, cue worker, and summary worker. CI also runs typecheck, builds, and CDK synth.

Honest limitations:
- It is a course MVP, not verified production scale. NFR figures such as p95 ingest/cue latency and 100 concurrent conversations are architecture targets rather than measured load-test results.
- Authentication is intentionally minimal and uses a user-id header; production should use Cognito or a JWT authorizer and stricter CORS/authorization.
- Local AWS integration tests use mocks because there is no permanent unrestricted AWS account.
- Persistent conversation delete/archive and stable cloud integration testing remain future work.

Good interview framing: CueFlow demonstrates how Xiang reasons about reliable asynchronous AI systems on AWS, while SayNext demonstrates deeper real-device iteration and personalized live assistance.` ,
  },
];

let count = 0;
for (const memory of memories) {
  const result = await conversationLogger.createPersonalMemoryAsync({
    userId,
    title: memory.title,
    category: memory.category,
    sensitivity: memory.sensitivity,
    content: memory.content,
    usageRule: memory.usageRule,
    keywords: memory.keywords,
    source: "import",
    sourceRef: memory.sourceRef,
    status: "active",
    upsertBySource: true,
  });

  if (result) {
    count += 1;
    console.log(`upserted: ${result.id} ${result.sourceRef} -> ${result.title}`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Seeded SayNext/ML/interview memories: ${count}`);
