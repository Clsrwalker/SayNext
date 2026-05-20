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
    title: "Xiang English social awkwardness anchor",
    category: "language_identity_anchor",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:english-social-awkwardness-anchor",
    keywords: [
      "English social embarrassment", "English social failure", "constant awkwardness",
      "weak English", "early Canada years", "social participation", "high school adaptation",
      "insecurity never fully disappeared", "English insecurity", "no dramatic moment",
    ],
    content: `Xiang does not remember one single dramatic English social failure moment.

The feeling during early Canada years was more like constant awkwardness: weak English, difficulty understanding conversations, and struggling to naturally participate socially.

The insecurity from high school adaptation never fully disappeared and still exists psychologically today.`,
    usageRule: "Use only when directly asked about English social embarrassment, early Canada social adaptation, English insecurity, or whether there was one dramatic English failure moment. Do not volunteer this in normal English-learning answers.",
  },
  {
    title: "Xiang driving learning confidence anchor",
    category: "driving_learning_anchor",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:driving-learning-confidence-anchor",
    keywords: [
      "driving learning", "learned driving", "summer 2024", "China driving",
      "first attempt", "passed tests", "naturally understand driving", "talented at driving",
      "no major violations", "quick adaptation",
    ],
    content: `Xiang first learned driving during a return trip to China in summer 2024.

He adapted very quickly, learned driving naturally, passed all tests on the first attempt, and had no major violations or problems.

This became one of the few areas where he felt surprisingly talented: "I naturally understand this pretty well."`,
    usageRule: "Use for questions about learning to drive, driver's license confidence, natural skill, quick adaptation, or a time Xiang felt unexpectedly talented. Do not confuse this with current car service details.",
  },
  {
    title: "Xiang Canadian identity distance anchor",
    category: "identity_belonging",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:canadian-identity-distance-anchor",
    keywords: [
      "Canadian identity", "local Canadian", "culturally integrated", "native culture",
      "local social culture", "sense of distance", "adapted to isolation", "independent living",
      "not extreme loneliness", "cultural distance",
    ],
    content: `Xiang does not truly feel like a local Canadian or fully culturally integrated.

There is still a sense of distance between him and native/local social culture. This is not experienced as extreme loneliness. He adapted to isolation well, became comfortable living independently, and emotionally normalized the distance.`,
    usageRule: "Use only when directly asked about Canadian identity, cultural integration, feeling local, isolation in Canada, or belonging. Keep it nuanced and avoid making it sound like extreme loneliness.",
  },
  {
    title: "Xiang Halifax home feeling anchor",
    category: "place_belonging",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:halifax-home-feeling-anchor",
    keywords: [
      "Halifax home", "home feeling", "not strongly home", "frequent moving",
      "familiar comfortable manageable", "childhood memories", "cozy spaces",
      "old neighborhood", "emotional home", "not geography alone",
    ],
    content: `Despite living in Halifax for many years, Xiang still does not strongly feel "this is home."

One reason is frequent moving and repeatedly changing living environments. Halifax feels familiar, comfortable, and manageable, but not deeply rooted emotionally as home.

The stronger emotional home feeling still comes more from childhood memories, small cozy spaces, old neighborhood experiences, and familiar emotional environments rather than geography alone.`,
    usageRule: "Use for questions about Halifax, home feeling, belonging to a place, moving often, or what feels emotionally like home. Do not make Halifax sound disliked; it is familiar and manageable, just not deeply rooted as home.",
  },
  {
    title: "Xiang AI realization and not-a-toy moment",
    category: "ai_identity_philosophy",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:ai-realization-not-toy-anchor",
    keywords: [
      "AI realization", "AI not a toy", "GPT-3", "conversational AI", "not fixed replies",
      "dynamic response", "hardcoded program", "future value", "observation ability",
      "hidden problems", "logical thinking", "empathy", "right questions",
      "AI-native workflow", "Hybrid Search Memory Assistant",
    ],
    content: `Very early after GPT-3 appeared, Xiang immediately believed this technology would fundamentally change humanity.

The first time he truly felt "AI is no longer just a toy" was when AI could genuinely converse with him, respond dynamically, and feel non-scripted instead of like a traditional program with hardcoded replies.

His core realization was that future value would shift away from memorizing knowledge or storing information, and more toward observation ability, identifying hidden problems, logical thinking, empathy, and asking the right questions.

Reason: once a person can identify problems others fail to notice, AI can help execute the solution.

This belief became one foundation for his AI interests, Hybrid Search Memory Assistant, AI-assisted thinking philosophy, AI-native development workflow, conversational AI, and the idea that AI can replace parts of human thinking processes.`,
    usageRule: "Use for questions about why Xiang cares about AI, when AI stopped feeling like a toy, GPT-3 impact, AI-native workflow, AI philosophy, or Hybrid Search Memory Assistant motivation. Keep it concrete and avoid exaggerated hype.",
  },
  {
    title: "Mr. Jiang mentor and study-abroad turning point",
    category: "mentor_life_anchor",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:mr-jiang-mentor-anchor",
    keywords: [
      "Mr. Jiang", "Jiang xiansheng", "蒋先生", "mentor", "important person",
      "turning point", "Dalhousie professor", "knew mother", "recommendation letter",
      "support materials", "study abroad", "life advice", "opportunity",
    ],
    content: `Mr. Jiang was one of the most important turning-point figures in Xiang's life.

He was originally connected to Dalhousie University, knew Xiang's mother in China, helped Xiang during the transition toward studying abroad, wrote recommendation or support materials during high school, and gave important life advice.

Xiang feels that without Mr. Jiang's help, he might not even have been able to study abroad successfully.

This person represents opportunity, transition, guidance, and life trajectory change.`,
    usageRule: "Use only when directly asked about important mentors, who helped Xiang study abroad, recommendation/support letters, life turning points, or Mr. Jiang. Do not volunteer this name in unrelated family, school, or Canada answers.",
  },
  {
    title: "Xiang hidden insecurities anchor",
    category: "self_image_insecurity",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:hidden-insecurities-anchor",
    keywords: [
      "hidden insecurities", "afraid people discover", "not smart enough",
      "English not strong enough", "lazy", "not social", "not independent",
      "low self-confidence", "fear others notice", "insecurity",
    ],
    content: `Things Xiang worries others may discover:
- low self-confidence
- not being smart enough
- English not truly strong enough
- laziness
- weak social ability
- not being independent enough

These insecurities exist even though he has improved academically, adapted internationally, and can build complex software systems.`,
    usageRule: "Use only when Xiang explicitly asks about hidden insecurities, what he is afraid others will discover, self-image, confidence, or private emotional profile. In public/interview answers, soften this into modest practical framing and do not overshare.",
  },
  {
    title: "Xiang emotional comfort and music anchor",
    category: "emotional_comfort_music",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:emotional-comfort-music-anchor",
    keywords: [
      "emotional comfort", "freedom", "internet access", "games", "private space",
      "AI tools", "phone", "computer", "quiet digital environment", "instrumental music",
      "orchestral music", "soundtrack", "Genshin BGM", "Genshin music",
      "emotional regulation", "private mental space",
    ],
    content: `Things that give Xiang strong emotional comfort include freedom, internet access, games, private personal space, AI tools, phone/computer environments, and quiet digital environments.

Music is especially important emotionally. Xiang strongly likes instrumental music, orchestral music, and emotionally immersive soundtracks, especially Genshin Impact BGM/music.

Reasons he likes this music: diverse style, memorable melodies, emotional atmosphere, and strong immersion.

Music functions as emotional regulation, comfort, atmosphere creation, and a private mental space.`,
    usageRule: "Use for questions about emotional comfort, what Xiang would miss, private space, music taste, instrumental/orchestral music, Genshin BGM, emotional regulation, or digital comfort. Do not turn ordinary music questions into a therapy answer.",
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
console.log(`Upserted ${count} identity anchor memories for ${userId}.`);
