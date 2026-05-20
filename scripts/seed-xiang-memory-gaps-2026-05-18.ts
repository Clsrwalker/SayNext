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
    title: "Hybrid Search Memory Assistant origin and public framing",
    category: "project_public_framing",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:hybrid-search-memory-assistant-origin",
    keywords: [
      "Hybrid Search Memory Assistant", "AI assistant", "real-time AI assistant", "Canada high school",
      "weak English", "translation software", "conversation support", "social confidence",
      "awkward silence", "transcript understanding", "personal memory", "context-aware AI",
    ],
    content: `Public-facing project name: Hybrid Search Memory Assistant.

If asked why Xiang built it or why he became interested in real-time AI assistants, lead with the Canada high-school English/conversation pain first, then mention the technical retrieval/token design.

Xiang's interest in real-time AI assistants came partly from his early years in Canada. When he first arrived during high school, his English was very weak and translation software was limited. Tools could translate individual words, but they could not help him continue a real conversation or know how to reply naturally.

The real pain points were awkward silence, not knowing how to respond, difficulty continuing conversations, weak social confidence, and no useful real-time feedback. That experience became one emotional origin behind his later AI assistant ideas.

Public framing: "I built a Hybrid Search Memory Assistant because when I first came to Canada, translation tools could translate words, but they could not help me continue a real conversation. Later I turned that problem into a technical system around transcript understanding, hybrid retrieval, memory, and token-efficient context."`,
    usageRule: "Use for interview or public explanations of why Xiang built the project. For why/origin questions, mention weak English in Canada, awkward real-time conversation, and translation tools not being enough before discussing architecture. Prefer the public name Hybrid Search Memory Assistant. Do not expose private product naming unless the user explicitly asks in a private/dev context.",
  },
  {
    title: "Hybrid Search Memory Assistant goal and architecture",
    category: "project_public_framing",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:hybrid-search-memory-assistant-goal-architecture",
    keywords: [
      "Hybrid Search Memory Assistant", "hybrid retrieval", "input tokens", "token cost",
      "personal memories", "course notes", "project context", "interview stories",
      "real-time transcripts", "pre-notes", "long-term profile memory", "context window",
      "scene router", "OpenAI", "Ollama",
    ],
    content: `Core technical goal of Hybrid Search Memory Assistant: reduce unnecessary API input tokens while improving contextual relevance.

The system can retrieve personal memories, course notes, project context, interview stories, real-time transcripts, pre-notes, and long-term profile memory. The philosophy is to send only relevant context into the LLM instead of putting every possible memory into a large prompt.

Architecture concepts Xiang can mention publicly:
- transcript stream and recent context window
- scene/context routing
- hybrid search over memories and notes
- personal memory retrieval and review flow
- prenote retrieval for uploaded or prepared notes
- local/API model split, such as Ollama for local testing and OpenAI for higher-quality or travel mode
- duplicate transcript handling, ASR echo handling, stale response dropping, long teleprompt pagination, token reduction, and memory review

Do not claim production users, revenue, or paid pilots unless Xiang confirms them. If asked, say it is a personal/experimental system tested through many scenarios and eval scripts, not a commercial product with verified users.`,
    usageRule: "Use for project architecture, token reduction, retrieval design, and trade-off questions. Keep claims precise: personal/experimental system, many tests, no unconfirmed production users or revenue.",
  },
  {
    title: "Xiang personal growth achievement and lowest period",
    category: "personal_growth",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:personal-growth-achievement",
    keywords: [
      "proudest achievement", "personal achievement", "lowest period", "difficult period",
      "poor academic habits", "struggling international student", "novels", "games",
      "weak English", "working software", "graduate-level projects", "working systems",
    ],
    content: `Xiang's proudest achievement is his long-term transformation: from an unmotivated student with poor academic habits and a struggling international student with weak English into someone who can build real software systems, create working apps/websites, complete graduate-level projects, and apply knowledge practically.

The most meaningful part is turning ideas into real working systems.

One of the lowest periods was earlier academic struggle in China, lack of direction, escaping into novels/games, and then arriving in Canada with extremely weak English. The feeling was: "I did not know what I was doing or where I was going."

This later influenced his interest in AI assistance, communication support systems, and AI-enhanced thinking tools.`,
    usageRule: "Use for proudest achievement, difficult period, personal growth, motivation, or why practical software matters to Xiang. Keep it reflective and avoid making it sound overly dramatic.",
  },
  {
    title: "Xiang technical strengths and weaknesses",
    category: "technical_profile",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05-18:technical-strengths-weaknesses",
    keywords: [
      "technical strengths", "technical weaknesses", "architecture design", "API integration",
      "AI-assisted development", "practical systems", "real-world software", "LeetCode",
      "algorithms", "advanced math", "competitive programming",
    ],
    content: `Xiang's stronger technical areas are turning ideas into apps, practical system/architecture design, API integration, AI-assisted development workflows, connecting components together, and making software actually work.

He is much more comfortable with practical development, integration, architecture, and real-world software systems than competitive programming.

His weaker areas are LeetCode, algorithms, and advanced mathematics. He should be honest about this rather than pretending to be strongest at algorithm-heavy work.`,
    usageRule: "Use for questions about strengths, weaknesses, technical profile, target role fit, or what kind of development Xiang is comfortable with.",
  },
  {
    title: "Xiang procrastination and common project blockers",
    category: "work_style",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:procrastination-project-blockers",
    keywords: [
      "procrastination", "avoid starting", "deadline", "pressure avoidance", "stress avoidance",
      "Git conflicts", "unclear requirements", "small mistakes", "large codebase",
      "integration confusion", "project blockers",
    ],
    content: `Xiang's procrastination pattern is that he may mentally think about tasks constantly while physically avoiding starting them. The main cause is stress or pressure avoidance. Even so, he usually completes projects and assignments, and he can become highly focused near deadlines.

Common project blockers for Xiang are Git conflicts, unclear requirements, small mistakes that waste hours, forgetting the structure of a large codebase, and integration confusion. A common feeling is that projects become too large to mentally track.`,
    usageRule: "Use for questions about work habits, procrastination, stress, deadlines, debugging frustration, or common project problems. Do not frame procrastination as laziness.",
  },
  {
    title: "Xiang preferred AI-assisted development workflow",
    category: "ai_workflow",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05-18:ai-assisted-development-workflow",
    keywords: [
      "AI-assisted development", "project structure", "TDD", "diff-based output",
      "trade-offs", "checklists", "manual review", "test final result", "honest uncertainty",
      "inspect files", "avoid filler", "fake confidence",
    ],
    content: `Xiang's preferred AI-assisted development workflow:
1. The AI understands the project structure first.
2. Break tasks into smaller pieces.
3. Define clear boundaries.
4. Use TDD-style thinking for deterministic modules.
5. Prefer diff-based output.
6. Explain trade-offs.
7. Generate checklists.
8. Xiang manually reviews and tests the final result.

Core philosophy: AI structures the work; the human verifies it.

Xiang strongly dislikes AI responses with useless filler, fake confidence, pretending to understand, or refusing to admit uncertainty. He prefers concise, concrete, practical answers with honest uncertainty.

Preferred uncertainty handling: inspect files/code/context first, investigate before guessing, provide multiple likely interpretations when needed, and clearly label uncertainty.`,
    usageRule: "Use for questions about how Xiang uses AI to code, what AI style he prefers, how he wants uncertainty handled, or how he works with assistants.",
  },
  {
    title: "Xiang English confidence turning point",
    category: "language_learning",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:english-confidence-turning-point",
    keywords: [
      "English confidence", "Canadian high school", "host family", "weak English",
      "guessing context", "mentally translating", "conversation", "participate",
      "surviving conversation", "language turning point",
    ],
    content: `Xiang's first English confidence turning point happened during Canadian high school while living with a host family.

At first, conversations felt extremely difficult and he relied on guessing from context. Over time, he gradually started to understand conversations more naturally and respond without mentally translating everything.

The emotional realization was: "I can finally participate in conversations instead of just surviving them."`,
    usageRule: "Use for English learning, Canada transition, host family communication, or confidence speaking English. Keep it concrete and not overly polished.",
  },
  {
    title: "Blood Donation Management System first software project",
    category: "project_experience",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:blood-donation-first-software-project",
    keywords: [
      "Blood Donation Management System", "first software project", "ASP.NET", "C#",
      "database-backed web architecture", "backend logic", "database work", "debugging",
      "integration", "login session", "form submission", "field mismatch",
    ],
    content: `Xiang's first major project where he felt he could build real software was the Blood Donation Management System, an undergraduate group project using ASP.NET, C#, and a database-backed web architecture.

His main responsibilities were backend logic, database work, debugging, and integration. The main lesson was understanding how frontend, backend, and database pieces connect together.

Problems included database connection issues, field mismatches, form submission bugs, login/session problems, integration issues, code merge problems, and small bugs wasting hours.

After finishing, his strongest feeling was relief rather than excitement: "Finally it works. I can finally escape from this project." Later, it became psychologically important because it proved he could finish real software and that computer science was not only theory.`,
    usageRule: "Use for first software project, undergraduate project, backend/database experience, first technical confidence, or debugging/integration lessons.",
  },
  {
    title: "AI Meeting Monitor project integration story",
    category: "project_experience",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:ai-meeting-monitor",
    keywords: [
      "AI Meeting Monitor", "graduate project", "React", "TypeScript", "Vite",
      "meeting summary", "action item extraction", "transcript navigation", "dashboard",
      "report generation", "integration testing", "smoke testing", "A grade",
    ],
    content: `AI Meeting Monitor was a graduate-level project with features such as meeting summary, action item extraction, transcript navigation, dashboard/report generation, and AI meeting feedback.

Confirmed stack: React, TypeScript, Vite, and an API-based architecture. Features included authentication, dashboard, transcript navigation, report generation, and meeting analysis.

Xiang's main role was integration, debugging, testing, and stabilization before presentation. Near the deadline, frontend/backend integration was unfinished and the frontend, backend, bot, and ML parts had been developed separately. There were CI/CD issues, messy API coordination, unclear architecture, and many integration errors. The core problem was unclear integration boundaries and ownership.

Xiang helped stabilize the project through manual testing, fixing frontend API calls, unit tests, module tests, integration tests, API tests, and smoke tests. The goal was to make the demo flow stable enough before presentation.

The final demo worked successfully, the project was complete enough, and it received an A grade. Main lesson: integration/testing matter more than isolated features. If rebuilding it, Xiang would define ownership and API contracts earlier, assign a testing/integration owner, use smaller integration milestones, shared documentation/checklists, and continuous smoke testing.`,
    usageRule: "Use for team project, integration, testing, deadline pressure, coordination problems, technical capability, or graduate project stories.",
  },
  {
    title: "Xiang solitude and communication preferences",
    category: "personality_preferences",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:solitude-communication-preferences",
    keywords: [
      "solitude", "prefer being alone", "communication style", "preaching", "commands",
      "moral pressure", "forced socialization", "fake authority", "interruption",
      "dismissal", "logic", "respect", "freedom", "low-pressure interaction",
    ],
    content: `Xiang's preference for solitude started early. One reason was that many relatives felt superstitious, narrow-minded, illogical, or difficult to communicate with. As a result, he gradually talked less and became more comfortable alone.

Communication styles Xiang strongly dislikes: preaching, commands, moral pressure, forced socialization, fake authority, interruption, dismissal, and pretending to understand.

Values in communication: logic, respect, freedom, and low-pressure interaction.`,
    usageRule: "Use only when asked about solitude, being alone, communication preferences, disliked communication style, family/social pressure, or values. Keep it private and do not volunteer sensitive family framing in unrelated answers.",
  },
  {
    title: "Xiang nostalgic childhood neighborhood before smartphones",
    category: "childhood_memories",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:nostalgic-childhood-neighborhood",
    keywords: [
      "childhood neighborhood", "nostalgic", "before smartphones", "lively environment",
      "close friendships", "role-playing games", "outdoor play", "natural social interaction",
      "warmest period",
    ],
    content: `Xiang's warmest and most nostalgic period is his childhood neighborhood before smartphones were everywhere.

Memories include a lively environment, close friendships, role-playing games, outdoor play, and natural social interaction. The core feeling is that life felt happier and more genuine before constant internet/social media culture.`,
    usageRule: "Use for nostalgic childhood memories, warmest period, childhood neighborhood, or before-smartphone social life. Avoid inventing exact scenery or events beyond these facts.",
  },
  {
    title: "Xiang ideal low-pressure day",
    category: "lifestyle_preferences",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:ideal-day-low-pressure",
    keywords: [
      "ideal day", "perfect day", "no deadlines", "no work pressure",
      "no forced social interaction", "wake up naturally", "private space",
      "relax at own pace", "freedom", "comfort", "low pressure",
    ],
    content: `Xiang's ideal day has no deadlines, no work pressure, and no forced social interaction. He would wake up naturally, stay in a comfortable private space, and relax at his own pace.

Core values behind this: freedom, comfort, low pressure, and personal control over time.`,
    usageRule: "Use for ideal day, relaxing day, free time values, or lifestyle preference questions. Keep it simple and natural.",
  },
];

let count = 0;
for (const memory of memories) {
  const result = conversationLogger.createPersonalMemory({
    userId,
    title: memory.title,
    category: memory.category,
    sensitivity: memory.sensitivity,
    content: memory.content,
    usageRule: memory.usageRule,
    keywords: memory.keywords,
    source: "import",
    sourceRef: memory.sourceRef,
    upsertBySource: true,
  });

  if (result) {
    count += 1;
    console.log(`${result.id}: ${result.title} [${result.category}] ${result.sourceRef}`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Upserted ${count} memory-gap facts for ${userId}.`);
