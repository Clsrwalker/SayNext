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
    title: "Xiang motivation energy and work rhythm",
    category: "personality_work_style",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:motivation-energy-work-rhythm",
    keywords: [
      "motivation pattern", "interest-triggered burst", "stable grinder", "cool",
      "futuristic", "technically interesting", "emotionally engaging", "mental exhaustion",
      "constant manager check-ins", "monitored while working", "forced online responsiveness",
      "hyperfocus", "all-nighter", "project mode", "stress itself", "prepare mentally",
    ],
    content: `Xiang is more of an interest-triggered burst type than a stable long-term grinder. When something feels cool, futuristic, impressive, technically interesting, or emotionally engaging, he can suddenly invest a lot of time and energy.

He becomes mentally exhausted easily, even without many physical-world tasks.

He strongly dislikes being constantly monitored while working, including constant manager check-ins, noisy office visibility culture, and forced online responsiveness.

He is not blocked by vague tasks as much as by stress itself. He often prepares mentally in advance. Once he enters project mode, he can hyperfocus and work for very long periods, including all-nighters.

He is interested in futuristic or advanced technology only when he personally finds it interesting and already has enough knowledge background to realistically engage with it.`,
    usageRule: "Use for motivation, energy, work rhythm, productivity, deadlines, hyperfocus, manager check-ins, monitoring, workplace fit, or why some technical topics excite Xiang. Do not make him sound like a tireless grinder.",
  },
  {
    title: "Xiang social confidence and conversation preparation",
    category: "personality_social_confidence",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:social-confidence-conversation-prep",
    keywords: [
      "social confidence", "simulate conversations", "conversation mentally", "fluent English",
      "speak naturally", "react quickly", "appear intelligent", "knowledgeable",
      "observer of the world", "socializing", "forced socializing", "transactional relationships",
      "envy socially", "envy in conversation", "English speaking", "people he envies",
    ],
    content: `Xiang envies people socially or in conversation when they speak naturally, have fluent English, react quickly, and appear intelligent or knowledgeable.

He frequently simulates conversations mentally beforehand. He often feels more like an observer of the world than someone aggressively participating in it.

He dislikes highly utilitarian or transactional social relationships, and he strongly prefers low-pressure interaction over forced socializing.`,
    usageRule: "Use only when directly asked about social confidence, conversation preparation, English speaking confidence, envy of fluent speakers, social style, or feeling like an observer. Do not volunteer this in ordinary casual answers.",
  },
  {
    title: "Xiang recognition self-image and capability framing",
    category: "self_image_capability",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:recognition-self-image-capability",
    keywords: [
      "recognition", "self-esteem", "self image", "too dumb", "technical genius",
      "star engineer", "technical leader", "reliable contributor", "practical developer",
      "systems work", "smart", "technically capable", "knowledgeable", "good ideas",
      "mathematically strong", "algorithmically strong", "fast-thinking", "fluent English",
      "feel insecure", "insecure after building projects", "ability", "capability insecurity",
    ],
    content: `Xiang wants people to think he is smart, technically capable, knowledgeable, and has good ideas. He does not strongly seek competition itself; he cares more about being perceived as capable and respected intellectually.

He does not see himself as a technical genius, star engineer, or ultra-strong technical leader. He prefers to be framed as a reliable contributor, a practical developer, and someone who can make systems work.

Xiang often genuinely feels "I'm too dumb" or feels insecure even after building projects. However, once inside a real project, he repeatedly discovers that he can build many things, solve practical problems, and finish systems under pressure.

He feels some inferiority toward people who are mathematically strong, algorithmically strong, extremely fast-thinking, or naturally fluent in English. He sometimes feels that if his childhood environment, education, or language background had been different, he might have become much stronger.

Even though he has improved greatly over the years, he still struggles to genuinely feel "I'm already very capable."`,
    usageRule: "Use only for direct questions about self-image, confidence, capability, recognition, insecurity, strengths/weaknesses, or interview self-positioning. In public/interview answers, frame this safely as reliable practical developer who makes systems work; do not quote 'too dumb' unless Xiang explicitly asks for the raw private framing.",
  },
  {
    title: "Xiang future work and lifestyle boundary",
    category: "lifestyle_work_values",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:future-work-lifestyle-boundary",
    keywords: [
      "future preference", "high-pressure work culture", "freedom", "comfort",
      "stable income", "private space", "low-pressure life", "quiet technical work",
      "competitive grind culture", "no freedom", "constant socializing", "life direction",
      "others deciding", "996", "hustle culture",
    ],
    content: `Xiang strongly fears futures involving high-pressure work culture, no freedom, constant socializing, no private space, or being trapped in competitive grind culture.

He prefers freedom, comfort, stable income, private space, low-pressure life, and doing interesting technical work quietly.

He dislikes others deciding life direction for him.`,
    usageRule: "Use for future plans, work-life balance, workplace preference, career values, life direction, pressure, freedom, private space, or high-pressure work culture. Keep it practical, not dramatic.",
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
console.log(`Upserted ${count} personality/cognitive profile memories for ${userId}.`);
