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
    title: "Xiang food allergy profile",
    category: "lifestyle_food",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05-18:no-food-allergies",
    keywords: [
      "food allergy", "food allergies", "allergy", "allergies", "dietary restriction",
      "ingredient check", "restaurant", "eat anything", "no known food allergies",
    ],
    content: `Xiang has no known food allergies and generally can eat all kinds of food.

If a restaurant, server, or form asks about allergies, the natural answer is: "I don't have any food allergies."

This does not mean he must like every food; it only means there is no food allergy or dietary restriction to report.`,
    usageRule: "Use for restaurant allergy checks, forms, dietary restrictions, ingredient questions, or food safety questions. Keep it short and do not invent medical details.",
  },
  {
    title: "Xiang deposit and contract pressure risk",
    category: "high_stakes_preferences",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05-18:deposit-contract-pressure-risk",
    keywords: [
      "deposit", "non-refundable deposit", "lease", "contract", "payment terms",
      "high pressure", "opportunity disappear", "pay quickly", "skim contracts",
      "signing", "written terms", "receipt", "refund policy",
    ],
    content: `Xiang may pay quickly under high-pressure deposit situations, especially when someone says the opportunity will disappear. He also often only skims contracts or payment terms before paying or signing.

This is a personal risk pattern. In high-stakes payment, lease, contract, deposit, or non-refundable situations, SayNext should slow him down rather than encourage immediate agreement.

Useful response style:
"Could you send me the lease/payment terms in writing first? I want to check the deposit, refund policy, and receipt before I pay."

Do not say "sure, I can pay now" under pressure. Ask to verify written terms, confirm total amount, refund policy, identity/payment method, and receipt first.`,
    usageRule: "Use for deposits, lease/addendum/contract pressure, payment terms, non-refundable payments, signing, and high-pressure sales. This memory should make the response more cautious, not more trusting.",
  },
  {
    title: "Xiang family communication, money, and property profile",
    category: "family_communication",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05-18:family-communication-money-profile",
    keywords: [
      "mother", "mom", "late reply", "read and not reply", "family property", "family money",
      "rent", "lease details", "market rent", "sister", "father", "admire father",
      "family role", "observer", "quiet", "video call", "games warning",
    ],
    content: `Xiang's communication with his mother is mostly passive. They usually communicate by video call. Sometimes Xiang reads messages and does not reply because he wants some quiet time. His mother usually does not chase him or argue; the content is mostly daily sharing and ordinary conversation. If there is conflict, Xiang tries to avoid it.

If he replies late by about one day, natural simple excuses include:
- "I had a group meeting."
- "I went to eat."
- "I just went out."
- "I had something just now."

Family money/property: Xiang knows the broad situation, but has never actively participated and does not understand specific lease/rent/property details. He may participate more after returning to China in the future. Do not invent market rent, contract strategy, property details, or financial decisions. Ask for numbers and background first.

Sister: Xiang and his sister rarely talk, but the relationship is not distant; they can speak normally when there is something to say.

Family role: Xiang is more quiet, observer-like, cared-for, and not very expressive in the family.

Father: The father topic is not forbidden; it is more nostalgic. Xiang thinks his father treated him best when he was young, was very capable, and is the person Xiang admires most. Xiang sees him as someone who went from having nothing in the countryside to becoming a successful boss.

Repeated family topic from childhood: family often worried that Xiang played games every day. Xiang's mother can talk a lot once she starts, and Xiang usually gives simple responses.`,
    usageRule: "Use only when directly asked about mother, late replies, family communication, family property/money, sister, father, or family role. Do not volunteer sensitive father or property details in unrelated answers.",
  },
  {
    title: "Xiang ceremony and formal speaking style",
    category: "speaking_style_formal",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05-18:formal-speaking-style",
    keywords: [
      "formal speaking", "ceremony", "graduation", "wedding", "presentation",
      "self introduction", "toast", "not official", "not corporate", "not HR",
      "natural", "light humor", "humble", "relaxed", "conversational",
    ],
    content: `In formal moments such as graduation, wedding, presentations, or self-introductions, Xiang prefers speech that is natural, a little relaxed or lightly humorous, and not too official.

Preferred tone: humble, relaxed, slightly warm, conversational, and mildly nerdy/technical if relevant.

Avoid: sounding memorized, corporate/HR style, over-polished motivational speech, exaggerated passion, over-dramatic emotion, or template greeting-card language.

Ideal effect: it should sound like a real person speaking naturally in the moment, not like a memorized script.`,
    usageRule: "Use for formal events, ceremony lines, graduation/wedding toasts, presentations, or self-introductions. Make output warm but not corporate or over-emotional.",
  },
  {
    title: "Xiang classroom question style",
    category: "classroom_style",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05-18:classroom-question-style",
    keywords: [
      "classroom question", "ask in class", "edge case", "architecture", "clarification",
      "practical implementation", "short question", "not show off", "uncertain tone",
      "I think", "probably", "would it be", "so basically",
    ],
    content: `Xiang's realistic classroom questions are usually about edge cases, architecture, clarification, or practical implementation.

Question style should be one sentence, short, not too visible, not show-off, and with a little uncertainty.

Natural phrasing:
- "I think..."
- "probably..."
- "would it be..."
- "so basically..."

Avoid questions that are too basic and make it sound like he understood nothing, too long, too show-off, or too theoretical like a paper discussion.`,
    usageRule: "Use for classroom Q&A, professor asks for questions, lecture follow-ups, or when Xiang wants to ask something in class. Keep it short and student-like.",
  },
  {
    title: "Xiang career target and workplace preference",
    category: "career_profile",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05-18:career-target-workplace-preferences",
    keywords: [
      "target role", "career", "job", "full-stack developer", "AI cloud application",
      "backend", "database", "cloud deployment", "frontend", "API integration",
      "system architecture", "remote friendly", "low politics", "async communication",
      "quiet work environment", "DevOps", "ML", "security",
    ],
    content: `Xiang is best packaged as a Full-stack Developer, more specifically: full-stack developer with AI/cloud application experience.

Preferred company/team style: remote-friendly, engineering-heavy, low-politics, small or technical-oriented teams, async communication, and a quiet work environment with fewer interruptions.

Dislikes: noisy offices, high-pressure social culture, excessive meetings, office politics, 996/hustle culture.

Skill confidence:
- More experienced: backend, database, cloud deployment, frontend, API integration, system/application architecture.
- Less experienced: DevOps, ML, and security.

There is currently no clearly forbidden project that Xiang cannot mention.`,
    usageRule: "Use for career direction, target role, job preference, workplace preference, skill confidence, or interview positioning. Keep it honest and practical.",
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
console.log(`Upserted ${count} family/career preference memories for ${userId}.`);
