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
    title: "Xiang first presentation panic in Canada",
    category: "presentation_anxiety_anchor",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:first-presentation-panic-history-class",
    keywords: [
      "first presentation panic", "presentation anxiety", "history class",
      "early Canada", "new to Canada", "language barrier", "phone translator",
      "read from translator", "nervous", "embarrassed", "awkward presentation",
    ],
    content: `Xiang's first major presentation panic was probably in a history class shortly after he came to Canada.

His English was not really functional for that situation, so he used a phone translator and basically read from it.

The main feeling was nervousness and embarrassment: standing there with a language barrier, trying to get through the presentation by following translated text.`,
    usageRule: "Use only when directly asked about Xiang's first presentation panic, early Canada public speaking, history class, translator use, language-barrier embarrassment, or a difficult presentation. Do not invent a polished success story unless the question asks for growth after the panic.",
  },
  {
    title: "Xiang snow memory boundary",
    category: "place_weather_memory_boundary",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:snow-walk-home-boundary",
    keywords: [
      "first snow walk home", "snow day", "Canada snow", "does not remember",
      "snow too common", "winter memory", "walked home in snow",
    ],
    content: `Xiang does not really remember a specific first time walking home alone in snowy Canada.

Snow happens so often in Canada that this does not stand out as one clear anchor event for him.`,
    usageRule: "Use when asked for a specific first-snow or walking-home-in-snow memory. Answer honestly that there is no clear remembered event; do not invent a cinematic snow scene.",
  },
  {
    title: "Xiang travel preference boundary",
    category: "travel_preference",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:travel-not-alone-preference",
    keywords: [
      "travel preference", "solo travel", "alone travel", "does not like traveling alone",
      "wants to travel", "not fun alone", "Canada travel", "has car but rarely travels",
      "travel style unsure", "tourism",
    ],
    content: `Xiang hopes to travel more, but he does not like traveling alone because it feels less fun.

In Canada, he has basically not gone on solo trips by himself, even after having a car and more convenience.

He is not fully sure what travel style he likes yet.`,
    usageRule: "Use for questions about travel, solo travel, tourism preference, why Xiang does not travel much in Canada, or what type of travel he likes. Do not imply he dislikes travel entirely; the key point is that solo travel lacks enjoyment for him.",
  },
  {
    title: "Xiang relationship preference and autonomy",
    category: "relationship_preference_private",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:relationship-autonomy-no-pressure",
    keywords: [
      "relationship preference", "ideal type", "black straight hair", "quiet", "cute",
      "financially separate", "separate finances", "autonomy", "freedom",
      "does not want children currently", "no kids", "single is okay",
      "no pressure", "not forcing relationship", "girlfriend",
    ],
    content: `Xiang is not fully sure what type of partner he likes, but his tentative preference is someone with black straight hair, quiet personality, and a cute feeling.

His ideal relationship would keep finances separate, with each person managing their own money. Autonomy and freedom matter a lot to him.

He currently does not want children and has not thought deeply about having children. He also does not want external pressure around relationships.

His attitude is that if he cannot find a girlfriend, staying single is acceptable. He does not want to force it or pressure himself.`,
    usageRule: "Use only when directly asked about dating, girlfriend, ideal partner, relationship boundaries, finances in a relationship, children, marriage pressure, or staying single. Do not volunteer relationship details in ordinary social answers.",
  },
  {
    title: "Xiang developer identity and user experience shift",
    category: "developer_identity",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:developer-identity-frontend-to-ux",
    keywords: [
      "developer identity", "frontend developer", "UI finally looks good",
      "user experience", "actual user experience", "AI makes frontend easier",
      "frontend less differentiating", "product feel", "UX matters",
    ],
    content: `One concrete developer-identity feeling for Xiang is when the UI finally looks good.

Earlier, he may have seen himself more like a frontend developer. But as AI gets stronger and frontend implementation becomes easier to generate, he feels the more important thing is caring about the user's actual experience.

The lesson is not that frontend has no value, but that the differentiator is product feel, usability, and whether the experience actually works for users.`,
    usageRule: "Use for questions about Xiang's developer identity, frontend vs UX, why UI quality matters, how AI changes frontend work, or what makes him feel a project is becoming real. Do not phrase it as contempt for frontend developers.",
  },
  {
    title: "Xiang China political values and return boundary",
    category: "political_values_china_private",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:china-political-values-return-boundary",
    keywords: [
      "China political system", "authoritarianism", "dictatorship", "censorship",
      "silencing speech", "propaganda", "fake history", "Tiananmen", "Great Famine",
      "Mao Zedong", "Xi Jinping", "does not want to return to China",
      "rather be lonely", "political values", "freedom of speech",
    ],
    content: `Xiang strongly dislikes China's political system, especially authoritarian power, dictatorship, censorship, silencing speech, deleting unfavorable voices, propaganda, and distorted historical narratives.

Topics that strongly trigger this reaction include Tiananmen, the Great Famine, worship of Mao Zedong despite mass suffering, and Xi Jinping's authoritarian rule.

Thinking about this makes Xiang feel physically uncomfortable and is one reason he does not want to return to China; he would rather tolerate loneliness than live under that system.`,
    usageRule: "Highly sensitive. Use only when directly asked about Xiang's political values, why he does not want to return to China, views on Chinese authoritarianism/censorship/propaganda, or freedom of speech. Do not inject into generic China history, travel, culture, family, or immigration answers.",
  },
  {
    title: "Xiang true happiness and pressure boundary",
    category: "happiness_pressure_boundary",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:true-happiness-no-pressure",
    keywords: [
      "true happiness", "really happy", "no pressure", "not pressure myself",
      "happy every day", "external pressure", "low pressure", "freedom",
      "not forcing myself", "daily happiness",
    ],
    content: `For Xiang, a real form of happiness is not giving himself unnecessary pressure.

If he is not being forced by outside pressure or by self-imposed pressure, he can feel happy in ordinary daily life.`,
    usageRule: "Use for questions about true happiness, what makes Xiang genuinely happy, pressure, low-pressure life, or why freedom matters. Do not turn every casual happy question into a serious life philosophy answer.",
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
console.log(`Upserted ${count} life boundary anchor memories for ${userId}.`);
