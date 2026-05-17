import { conversationLogger, type PersonalMemorySensitivity } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type BehavioralSeed = {
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  source: "knowledge" | "import";
  sourceRef: string;
};

const xiangStoryUsage =
  "Use as Xiang's interview story only when the question asks for behavioral/project experience. Keep it honest, low-key, and concrete. Do not invent company experience, exact numbers, teammate names, or production scale.";

const knowledgeUsage =
  "Use as behavioral interview guidance. It can shape the answer, but do not claim it is Xiang's personal experience unless it is mapped to one of Xiang's real projects.";

const memories: BehavioralSeed[] = [
  {
    title: "Behavioral interview STAR story patterns from developer forums",
    category: "knowledge_behavioral_interview",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:behavioral-interview:star-patterns",
    keywords: ["behavioral interview", "STAR", "conflict", "failure", "feedback", "leadership", "developer interview"],
    content: `Behavioral interview pattern gathered from common software-engineer interview guidance and developer forum discussions:
- Use STAR: situation, task, action, result.
- Keep the story specific, but avoid fake drama.
- For conflict: frame it as a technical disagreement or priority mismatch, not personal fighting.
- For failure: own the mistake, explain what changed afterward.
- For constructive feedback: say what feedback was, why it was fair, and what behavior changed.
- For leadership: leadership can mean ownership, coordination, reducing ambiguity, or unblocking others; it does not require a formal title.
- For a hard bug: explain symptom, investigation, root cause, fix, and prevention.

Good software-engineer story types:
- A bug caused by bad assumptions, stale state, race/timing, data shape mismatch, or unclear requirements.
- A disagreement about scope, architecture, UX, or trade-offs.
- A moment where the candidate simplified an overcomplicated design.
- A case where feedback changed the way they communicate or test.

Spoken style for Xiang:
"One example I can talk about is from my own project..."
"It was not a big conflict, more like a technical disagreement."
"The main thing I learned was to make the problem visible earlier."
"After that, I changed the way I test / communicate / structure the feature."`,
    usageRule: knowledgeUsage,
  },
  {
    title: "Xiang behavioral story: hard bug in SayNext context and stale output",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:saynext-hard-bug-context",
    keywords: ["hard bug", "recent bug", "SayNext", "stale context", "wrong output", "debugging", "real time"],
    content: `Story candidate for hard bug / debugging:
Project: SayNext.

Situation:
SayNext is a real-time conversation assistant. A hard bug was that the app sometimes showed unrelated replies because old transcripts, previous suggestions, or stale context stayed in the prompt. It made the assistant feel stuck or like it was answering an earlier conversation.

Action:
Xiang traced the flow from transcript capture to response generation and checked what was being sent into the prompt each time. He reduced old context, added session/event memory logic, added reset current session behavior, and tightened rules around when previous transcript/output should affect the next response.

Result:
The app became easier to recover when the context went wrong. It also became clearer which part was a retrieval/context problem versus an LLM quality problem.

Speakable answer:
"One hard bug was in SayNext, where the reply could be affected by old transcript context. It looked like the AI was answering something from earlier. I debugged the prompt input, reduced stale context, and added reset/session handling, so the app could recover instead of staying stuck."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: local LLM JSON and latency problem",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:saynext-local-llm-json-latency",
    keywords: ["Ollama", "Qwen", "JSON parse", "latency", "local LLM", "debugging", "model issue"],
    content: `Story candidate for recent technical bug / model reliability:
Project: SayNext.

Situation:
When testing local LLMs through Ollama, Xiang found that smaller models could be slow, stall, or return malformed JSON. That caused the app to stay in a loading state or fail to parse the response.

Action:
He compared different local models, checked server logs, inspected raw model output, and adjusted the response handling so the app did not rely too blindly on perfect JSON. He also separated local mode from travel mode: local mode uses Ollama to save cost, while travel mode can use an API model when he is away.

Result:
The project gained a clearer deployment strategy and a better understanding of trade-offs between cost, speed, reliability, and output quality.

Speakable answer:
"A recent issue was with local LLM output. Sometimes Qwen through Ollama returned broken JSON or took too long, so the app looked stuck. I checked the raw output and logs, then adjusted the handling and separated local mode from travel mode. It taught me that model integration is not just calling an API; you need fallback and debugging around it."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: failure from over-rigid prompts",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:saynext-prompt-failure",
    keywords: ["failure", "prompt", "too rigid", "AI-like", "repeat", "lesson learned", "SayNext"],
    content: `Story candidate for failure / lesson learned:
Project: SayNext.

Situation:
An early version of SayNext relied too much on fixed prompt rules and sample answers. In classroom and daily-chat tests, replies became repetitive, too complete, or too AI-like. Sometimes it repeated what the other person said instead of giving a useful next thought.

Action:
Xiang changed the design from fixed scene templates toward usefulness: understand, answer, learn, or ask a useful follow-up. He also reduced sample pollution, added scene profiles, and made the prompt emphasize natural, short, Xiang-like responses.

Result:
The lesson was that real-time assistance needs context judgment, not just templates. A technically correct answer can still be bad if it is not useful in that moment.

Speakable answer:
"One failure was that my first prompt design was too rigid. It gave answers that were technically okay, but they sounded like AI and repeated the transcript. I changed the design to focus more on what is useful in the moment, like answering, adding a small point, or helping me understand."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: constructive feedback about AI-like answers",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:constructive-feedback-ai-like",
    keywords: ["constructive feedback", "feedback", "AI-like", "too formal", "natural language", "prompt iteration"],
    content: `Story candidate for constructive feedback:
Project: SayNext.

Situation:
During testing, Xiang noticed feedback that the AI replies sounded too polished, too complete, and not like a real person. Examples included answers starting with "Today I plan..." or sounding like a summary instead of casual speech.

Action:
He treated that feedback as a product requirement, not just a prompt style issue. He added stricter speaking-style rules, removed high-frequency canned answers, reduced project mentions in daily chat, and tuned scene profiles for daily chat, classroom, interview, and meeting.

Result:
The product direction became clearer: SayNext should help Xiang react naturally in the current scene, not generate a perfect essay.

Speakable answer:
"One useful feedback I got was that the replies sounded too AI-like, especially in casual chat. At first I was focusing on correctness, but real conversation needs to sound natural. So I changed the prompt and scene profiles to make answers shorter, less complete, and more like how I would actually talk."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: leadership through ownership in SayNext",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:leadership-ownership-saynext",
    keywords: ["leadership", "ownership", "initiative", "SayNext", "end to end", "product thinking"],
    content: `Story candidate for leadership / ownership:
Project: SayNext.

Situation:
SayNext had many moving parts: real-time transcripts, prompt design, local LLMs, OpenAI API mode, memory retrieval, Prenote, session reset, transcript export, and deployment through local/VPS modes.

Action:
Xiang took ownership of the full loop instead of only building one feature. He tested with real transcripts, found where responses failed, adjusted UX controls like pause/continue/reset, added memory management, and created local/travel deployment modes to balance cost and reliability.

Result:
This shows leadership as product ownership: noticing what makes the app actually usable, making trade-offs, and improving the system through testing.

Speakable answer:
"I do not have a formal leadership title, but in SayNext I took ownership of the whole product loop. I was not only writing code; I tested real conversations, found where the app failed, and added things like reset session, Prenote, memory search, and local/travel modes. I think that is a practical kind of ownership."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: prioritization between local mode and travel mode",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:prioritization-local-travel-mode",
    keywords: ["prioritize", "deadline", "tradeoff", "cost", "local mode", "travel mode", "VPS", "OpenAI API"],
    content: `Story candidate for prioritization / trade-off:
Project: SayNext.

Situation:
Xiang needed SayNext to be cheap enough for daily local development but still usable when traveling. Running everything on a VPS with a large local model would be expensive and unreliable on a small server.

Action:
He separated the product into two modes. Local mode runs the app on his PC with Ollama and uses the VPS/frp mainly for a stable public URL. Travel mode runs the app on the VPS and uses an API model instead of a local model. He also paused some heavy pipeline work so the core app stayed usable.

Result:
This was a practical prioritization decision: solve the real deployment problem first, then improve heavier analysis later.

Speakable answer:
"One prioritization example is SayNext deployment. I wanted low cost for normal use, but also a mode that works when I am away. So I split it into local mode and travel mode instead of forcing one setup to do everything. That made the trade-off clearer: local is cheaper, travel mode is more available."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: vague requirements became Prenote and scene profiles",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:vague-requirements-prenote-scene",
    keywords: ["vague requirements", "requirements", "Prenote", "scene profile", "product design", "ambiguity"],
    content: `Story candidate for vague requirements / product thinking:
Project: SayNext.

Situation:
The original idea was simply "suggest what Xiang should say next," but real use was more complicated. Sometimes Xiang needed an answer, sometimes a knowledge supplement, sometimes preparation before a meeting/class, and sometimes no forced reply.

Action:
Xiang broke the problem into scene profiles and Prenote. Scene profiles let him choose the current context and output strategy. Prenote lets him upload or write background material before a class, interview, or meeting so the assistant has context ready.

Result:
The vague requirement became a clearer product model: not one universal prompt, but user-controlled context plus memory.

Speakable answer:
"At first the requirement was vague: just give me the next thing to say. But real situations are different. So I added scene profiles and Prenote, where I can prepare context before a class or meeting. That made the app less random and more controlled."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: low-drama teammate disagreement pattern",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:team-disagreement-pattern",
    keywords: ["teammate conflict", "conflict", "disagreement", "group project", "scope", "technical tradeoff", "team"],
    content: `Story candidate for teammate conflict / disagreement:
Use this only as a low-drama group-project framing. Do not invent personal arguments.

Likely Xiang-style angle:
In a group project, the disagreement is usually not personal. It is about scope, technical trade-offs, or how much detail to include before the deadline.

Safe project mapping:
- DalParkAid: balancing prediction logic, UI, and report/navigation features.
- JobLens: balancing resume matching features, cloud workflow, and reliability/cost.
- SayNext: balancing speed, cost, memory quality, and natural output.

Answer structure:
Situation: "We had different ideas about what to focus on."
Action: "I tried to make the trade-off clear, like what is necessary for the deadline versus what can be future work."
Result: "We aligned on a smaller working version first, then kept the extra ideas as improvements."

Speakable answer:
"I would describe it more as a technical disagreement than a personal conflict. In a project, people can want to add more features, but the deadline is limited. I usually try to make the trade-off clear and suggest finishing a smaller working version first, then leaving extra features as future work."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: achievement through SayNext prototype",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:achievement-saynext",
    keywords: ["achievement", "proud", "satisfied", "SayNext", "real-time assistant", "useful product"],
    content: `Story candidate for achievement / most satisfying project:
Project: SayNext.

Situation:
Xiang wanted to build something that directly solves his own communication problem, not just a class assignment.

Action:
He built SayNext as a mobile-focused real-time conversation assistant with transcripts, AI reply generation, memory retrieval, Prenote, settings, scene profiles, and local/travel deployment strategies.

Result:
The satisfying part is not that everything is perfect, but that the project became a real product experiment with practical constraints: latency, cost, context quality, privacy, and natural speech.

Speakable answer:
"The project I am most satisfied with is probably SayNext, because it is not just for a grade. It solves a real problem I have: reacting better in different conversations. It also forced me to think about latency, cost, memory, and whether the answer actually sounds human."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Behavioral interview pattern: code review and harsh feedback",
    category: "knowledge_behavioral_interview",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:behavioral-interview:code-review-feedback",
    keywords: ["code review", "harsh feedback", "senior engineer", "criticism", "feedback", "review"],
    content: `Common software-engineer behavioral pattern: code review / harsh feedback.

What interviewers want:
- Do you take technical criticism calmly?
- Can you separate the code from your ego?
- Do you ask for concrete examples and improve the work?
- Can you disagree respectfully if you have a reason?

Safe answer structure:
Situation: "I received feedback that a solution was hard to maintain / not tested enough / too complicated."
Action: "I asked which part was risky, checked the trade-off, added tests or simplified the design, and followed up."
Result: "The code became easier to review, and I changed how I prepare pull requests."

Xiang-style spoken answer:
"I try not to take code review personally. If someone says the code is not good enough, I would ask what part is risky, like readability, edge cases, or maintainability. Then I would fix that and also use it as a checklist next time."`,
    usageRule: knowledgeUsage,
  },
  {
    title: "Xiang behavioral story: going above and beyond with SayNext",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:above-and-beyond-saynext",
    keywords: ["above and beyond", "extra effort", "initiative", "SayNext", "product", "self-driven"],
    content: `Story candidate for "above and beyond" / extra initiative:
Project: SayNext.

Situation:
SayNext started as a real-time reply assistant, but basic reply generation was not enough. The app needed to handle real usage: wrong context, high cost, local model quality, memory retrieval, and preparation for specific scenarios.

Action:
Xiang went beyond a simple chatbot-style implementation. He added Personal Memory, Prenote, scene profiles, reset current session, transcript export, local/travel deployment modes, and many evaluation scripts for IELTS, CS interviews, ASR noise, public transcripts, and database replay.

Result:
The project became more like a real product experiment instead of a simple demo. It shows initiative because he kept finding weak points through testing and adding practical features around them.

Speakable answer:
"One example is SayNext. I could have stopped at just sending transcript to an LLM, but that was not useful enough. I added memory, Prenote, scene profiles, reset session, transcript export, and local/travel modes. I think that was going beyond the basic requirement because I kept testing what would actually fail in real use."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: working independently on SayNext",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:independent-work-saynext",
    keywords: ["working independently", "independent work", "self-directed", "learning", "SayNext", "problem solving"],
    content: `Story candidate for working independently / learning without much guidance:
Project: SayNext.

Situation:
SayNext combined many unfamiliar parts: Mentra/MiniApp integration, streaming transcripts, local LLMs, OpenAI/Gemini-style API modes, SQLite memory, FTS5 hybrid search, file processing, and VPS/frp deployment.

Action:
Xiang worked iteratively: ask AI for a starting plan, test locally, inspect logs, compare behavior with real transcripts, and adjust the implementation. When one approach was unreliable, like cloudflared or ngrok free tunnel, he tested alternatives and moved toward VPS + frp.

Result:
This shows independent execution: he did not know everything at the start, but he broke the system down and verified each part through testing.

Speakable answer:
"SayNext is a good example of independent work. It had a lot of parts I had to figure out, like transcript streaming, memory search, local LLMs, and VPS/frp deployment. I usually started with AI to get a direction, then tested it myself and checked logs until the system actually worked."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: user impact and reliability in SayNext",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:user-impact-reliability-saynext",
    keywords: ["user impact", "customer impact", "reliability", "privacy", "cost", "SayNext", "product impact"],
    content: `Story candidate for user impact / customer focus / reliability:
Project: SayNext.

Situation:
For a real-time conversation assistant, the main user impact is not just answer quality. If it shows stale answers, costs too much, exposes private details, or cannot recover from bad context, the user will stop trusting it.

Action:
Xiang added safeguards around personal memory sensitivity, reduced unnecessary sample retrieval, added reset session, separated local/travel modes for cost and availability, and tested with public transcripts so random media did not pull Xiang personal memories.

Result:
The user-impact lesson was that reliability and privacy are product features. A smart answer is not enough if the system feels unsafe or hard to recover.

Speakable answer:
"For SayNext, I learned that user impact is not only about generating a smart reply. If the app shows stale context or leaks personal memory in the wrong situation, users will not trust it. So I added reset session, memory sensitivity rules, and tests with public transcripts to make the behavior safer."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Behavioral interview pattern: no dramatic conflict available",
    category: "knowledge_behavioral_interview",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:behavioral-interview:no-dramatic-conflict",
    keywords: ["conflict", "no conflict", "disagreement", "teammate", "professor", "safe answer"],
    content: `Forum-style advice for conflict questions when there was no dramatic conflict:
- Do not invent a personal fight.
- Use a normal technical disagreement, scope disagreement, priority mismatch, or communication issue.
- Say it was low-drama: "It was not a big conflict, more like a disagreement on approach."
- Focus on how you aligned: clarify constraints, compare trade-offs, ask for feedback, choose a smaller working version, document future work.

Safe answer:
"I have not had a serious personal conflict, but I have had technical disagreements. I try to keep it about the trade-off, not the person. Usually I clarify the deadline and requirements first, then suggest the simplest version that can work."`,
    usageRule: knowledgeUsage,
  },
  {
    title: "Behavioral interview pattern: why this company or role",
    category: "knowledge_behavioral_interview",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:behavioral-interview:why-company-role",
    keywords: ["why this company", "why this role", "role interest", "company", "motivation", "fit"],
    content: `Common "why this company / why this role" pattern:
- Do not overclaim passion.
- Connect the role to concrete skills and learning direction.
- Mention product/domain only if you genuinely know it.
- Keep it practical: role fit, growth, useful software, team learning, and technical match.

Xiang-style answer:
"To be honest, I am still exploring different tech roles, but this one fits what I have been building and learning. I like full-stack, cloud, and AI-related applications, so I feel I can learn a lot while still contributing with my project experience."`,
    usageRule: knowledgeUsage,
  },
  {
    title: "Behavioral interview pattern: manager disagreement and influence",
    category: "knowledge_behavioral_interview",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:behavioral-interview:manager-influence",
    keywords: ["manager disagreement", "influence", "push for", "approval", "technical tradeoff", "behavioral interview"],
    content: `Common behavioral pattern: disagreement with a manager / influencing without authority / pushing for an idea.

What interviewers want:
- Can you disagree respectfully without sounding defensive?
- Can you use evidence, trade-offs, user impact, and risk instead of ego?
- Can you commit after a decision is made?

Safe answer structure:
Situation: "I had a different view on the approach or priority."
Action: "I explained the trade-off, showed a small test or concrete risk, listened to the other side, and proposed a smaller safer version."
Result: "Even if my original idea was not fully accepted, the final plan became clearer and lower risk."

Xiang-style wording:
"I would not frame it as arguing with a manager. It is more like I had a different technical opinion, so I tried to explain the trade-off with evidence and suggest a smaller version first."`,
    usageRule: knowledgeUsage,
  },
  {
    title: "Xiang behavioral story: pushing for user control in SayNext",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:saynext-pushed-user-control",
    keywords: ["push for", "pushed for", "user control", "scene profiles", "Prenote", "manual scene", "SayNext"],
    content: `Story candidate for "pushed for something" / influence / product judgment:
Project: SayNext.

Situation:
At first, SayNext tried to infer too much automatically: scene, intent, whether to answer, and what style to use. In real transcripts, that could become unstable because classroom, daily chat, and interview content can look similar when ASR is incomplete.

Action:
Xiang shifted the design toward user control. He added scene profiles so the user can choose Daily Chat, Classroom, Interview, Meeting, or a custom scene. He also added Prenote so important context can be prepared before a class, interview, or meeting.

Result:
The app became less random and easier to trust. The product decision was that AI should help with the answer, but the user should control the high-level situation when automatic judgment is unreliable.

Speakable answer:
"One thing I pushed for in SayNext was more user control. At first I wanted the AI to detect everything automatically, but real transcripts are messy. So I added scene profiles and Prenote, where I can tell the app the situation before it answers. That made the output more predictable."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Xiang behavioral story: long iteration and perseverance on SayNext",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:saynext-long-iteration",
    keywords: ["perseverance", "multiple months", "long project", "iteration", "SayNext", "kept improving"],
    content: `Story candidate for perseverance / difficult project over time:
Project: SayNext.

Situation:
SayNext was not solved in one clean implementation. Many parts failed in different ways: sample pollution, AI-like answers, stale context, local model latency, JSON parsing, tunnel instability, and memory retrieval mistakes.

Action:
Xiang kept turning each failure into a smaller design change. He reduced static samples, added Personal Memory with hybrid search, added reset/session recovery, split local/travel modes, added Prenote and scene profiles, and created evaluation scripts for many question types and noisy transcripts.

Result:
The project improved through repeated testing instead of one perfect plan. The main lesson is that real AI products need many feedback loops around the model, not just the model itself.

Speakable answer:
"SayNext is probably my best perseverance example. It kept failing in different ways: stale context, AI-like answers, local model latency, memory retrieval issues. I did not fix it in one step. I kept testing, finding the weak point, and changing the system around it."`,
    usageRule: xiangStoryUsage,
  },
  {
    title: "Behavioral interview pattern: waiting on unresponsive information",
    category: "knowledge_behavioral_interview",
    sensitivity: "low",
    source: "knowledge",
    sourceRef: "knowledge:behavioral-interview:unresponsive-info",
    keywords: ["unresponsive", "needed information", "blocked", "follow up", "communication", "behavioral interview"],
    content: `Common behavioral pattern: needing information from someone who is not responsive.

What interviewers want:
- Do you stay blocked silently, or do you communicate early?
- Can you proceed with assumptions while making risk visible?
- Can you follow up without sounding aggressive?

Safe answer structure:
Situation: "I needed information from another person to finish a task."
Action: "I followed up clearly, explained what was blocked, proposed assumptions or a fallback, and documented what I would do if I did not get a response."
Result: "The work kept moving and the team understood the risk."

Xiang-style wording:
"If I am blocked by missing information, I would not just wait silently. I would ask again, explain what part is blocked, and continue with a reasonable assumption if the deadline is close."`,
    usageRule: knowledgeUsage,
  },
  {
    title: "Xiang behavioral story: overwhelmed workload and scope control",
    category: "behavioral_story",
    sensitivity: "medium",
    source: "import",
    sourceRef: "xiang-behavioral:overwhelmed-scope-control",
    keywords: ["overwhelmed", "tight deadline", "failed deadline", "time management", "scope control", "school project"],
    content: `Story candidate for overwhelmed workload / tight deadline / time management:
Use for school/project interviews, not fake workplace experience.

Situation:
Xiang often has multiple school and project tasks at the same time. With SayNext, there were many possible features: pipeline automation, memory tuning, Prenote, UI, export, local/VPS deployment, and model testing.

Action:
Instead of trying to finish every idea at once, Xiang started separating core usability from future improvements. For example, he paused heavy automatic pipeline work and focused first on the parts that made the app usable: stable session behavior, scene profiles, Prenote, and local/travel deployment.

Result:
This helped him avoid getting stuck in unfinished complexity. The lesson was to cut scope and finish a working path first.

Speakable answer:
"When I feel overwhelmed, I try to cut the scope instead of pretending I can finish everything. In SayNext, there were many features I wanted, but I focused first on the parts that made the app usable, like reset session, scene profiles, Prenote, and deployment mode."`,
    usageRule: xiangStoryUsage,
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
    source: memory.source,
    sourceRef: memory.sourceRef,
    status: "active",
    upsertBySource: true,
  });

  if (result) {
    count += 1;
    console.log(`upserted: ${result.sourceRef} -> ${result.title}`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Seeded behavioral interview stories: ${count}`);
