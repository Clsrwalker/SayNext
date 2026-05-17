import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  topic: string;
  q: string;
  expected?: string[];
  noMemory?: boolean;
};

const cases: EvalCase[] = [
  // Hobbies and interests
  { topic: "hobbies", q: "What do you usually do in your free time?", expected: ["xiang-profile:personality-social-style", "xiang-profile:favorite-games", "xiang-profile:games-general", "xiang-profile:lifestyle-food-health"] },
  { topic: "hobbies", q: "Do you enjoy reading books?", noMemory: true },
  { topic: "hobbies", q: "Do you write stories or poems?", noMemory: true },
  { topic: "hobbies", q: "Do you play any musical instruments?", expected: ["xiang-profile:game-scripting-music", "xiang-profile:games-general"] },
  { topic: "hobbies", q: "Would you like to learn a musical instrument?", expected: ["xiang-profile:game-scripting-music"] },
  { topic: "hobbies", q: "What hobbies are common in your country?", noMemory: true },
  { topic: "hobbies", q: "Do you like computer games?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { topic: "hobbies", q: "Do you have creative hobbies like music or game scripting?", expected: ["xiang-profile:game-scripting-music"] },
  { topic: "hobbies", q: "Do you enjoy active hobbies like sports or hiking?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "hobbies", q: "Do you prefer doing hobbies alone or with other people?", expected: ["xiang-profile:personality-social-style", "xiang-profile:games-general"] },

  // Studying
  { topic: "study", q: "What are you studying?", expected: ["xiang-profile:identity-education", "xiang-update:2026-05:summer-courses"] },
  { topic: "study", q: "Why did you choose your major?", expected: ["xiang-profile:identity-education", "xiang-profile:learning-presentations", "xiang-profile:technical-skills", "xiang-update:2026-05:why-computer-science"] },
  { topic: "study", q: "Which subject do you enjoy studying most?", expected: ["xiang-profile:identity-education", "xiang-profile:technical-skills", "xiang-update:2026-05:favorite-subjects"] },
  { topic: "study", q: "Do you prefer studying alone or with classmates?", expected: ["xiang-profile:learning-presentations", "xiang-profile:personality-social-style"] },
  { topic: "study", q: "What subject was hardest for you at school?", expected: ["xiang-profile:learning-presentations", "xiang-update:2026-05:childhood-biology", "xiang-update:2026-05:favorite-subjects"] },
  { topic: "study", q: "Did you have a favourite teacher in school?", expected: ["xiang-profile:china-school-history", "xiang-profile:canada-high-school-transition"] },
  { topic: "study", q: "Are you planning to take any courses soon?", expected: ["xiang-update:2026-05:summer-courses"] },
  { topic: "study", q: "How long have you been learning English?", expected: ["xiang-profile:canada-high-school-transition", "xiang-profile:speaking-style", "xiang-update:2026-05:english-learning"] },
  { topic: "study", q: "Will English be important for your future?", expected: ["xiang-profile:speaking-style", "xiang-profile:values-immigration"] },
  { topic: "study", q: "Would you like to learn another language?", noMemory: true },

  // Work and career
  { topic: "work", q: "Do you work or study?", expected: ["xiang-profile:identity-education"] },
  { topic: "work", q: "What kind of job do you want in the future?", expected: ["xiang-profile:values-immigration", "xiang-profile:interview-style", "xiang-update:2026-05:future-job"] },
  { topic: "work", q: "Do you prefer working alone or in a team?", expected: ["xiang-profile:personality-social-style", "xiang-profile:interview-style"] },
  { topic: "work", q: "What do you like about software or tech work?", expected: ["xiang-profile:technical-skills", "xiang-profile:work-motivation"] },
  { topic: "work", q: "What do you not like about work?", expected: ["xiang-profile:work-motivation", "xiang-profile:lifestyle-food-health"] },
  { topic: "work", q: "Why did you choose computer science?", expected: ["xiang-profile:identity-education", "xiang-profile:technical-skills", "xiang-profile:game-scripting-music", "xiang-update:2026-05:why-computer-science"] },
  { topic: "work", q: "Do you work long hours?", expected: ["xiang-profile:work-motivation", "xiang-update:2026-05:work-life-balance"] },
  { topic: "work", q: "Is work-life balance important to you?", expected: ["xiang-profile:values-immigration", "xiang-profile:lifestyle-food-health", "xiang-profile:work-motivation", "xiang-update:2026-05:work-life-balance", "xiang-update:2026-05:future-job"] },
  { topic: "work", q: "How do you usually travel to work or school?", noMemory: true },
  { topic: "work", q: "What is your dream job?", expected: ["xiang-profile:interview-style", "xiang-profile:values-immigration", "xiang-update:2026-05:future-job"] },

  // Home, neighbourhood, country
  { topic: "home", q: "Do you live in a house or an apartment?", expected: ["xiang-update:2026-05:home-room"] },
  { topic: "home", q: "What is your favourite room at home?", expected: ["xiang-profile:personality-social-style", "xiang-profile:lifestyle-food-health", "xiang-update:2026-05:home-room"] },
  { topic: "home", q: "Which room do you spend the most time in?", expected: ["xiang-profile:personality-social-style", "xiang-profile:lifestyle-food-health", "xiang-update:2026-05:home-room"] },
  { topic: "home", q: "Do you like the area where you live?", expected: ["xiang-profile:values-immigration", "xiang-profile:personality-social-style", "xiang-update:2026-05:home-room"] },
  { topic: "home", q: "What facilities are there near your neighbourhood?", noMemory: true },
  { topic: "home", q: "What would you change about your neighbourhood?", noMemory: true },
  { topic: "home", q: "What do you like about Canada?", expected: ["xiang-profile:values-immigration"] },
  { topic: "home", q: "Tell me about people in China.", noMemory: true },
  { topic: "home", q: "Is China popular with tourists?", noMemory: true },
  { topic: "home", q: "Where is a good place to visit in Chengdu?", expected: ["xiang-profile:identity-education", "xiang-profile:china-school-history"] },

  // Technology and internet
  { topic: "technology", q: "How often do you use a computer?", expected: ["xiang-profile:technical-skills", "xiang-profile:ai-cognitive-style"] },
  { topic: "technology", q: "What do you use computers for?", expected: ["xiang-profile:technical-skills", "xiang-profile:ai-cognitive-style", "xiang-profile:game-scripting-music"] },
  { topic: "technology", q: "Do you use your mobile phone a lot?", noMemory: true },
  { topic: "technology", q: "Should children have mobile phones?", noMemory: true },
  { topic: "technology", q: "Do you like modern technology?", expected: ["xiang-profile:technical-skills", "xiang-profile:ai-cognitive-style"] },
  { topic: "technology", q: "What modern technology do you dislike?", noMemory: true },
  { topic: "technology", q: "How often do you use the internet?", noMemory: true },
  { topic: "technology", q: "Do you use social media often?", expected: ["xiang-profile:personality-social-style"] },
  { topic: "technology", q: "What website or app do you use often?", noMemory: true },
  { topic: "technology", q: "Is it bad to spend too much time online?", noMemory: true },

  // Sports and leisure
  { topic: "sports", q: "How often do you exercise?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "sports", q: "What sports are popular in China?", noMemory: true },
  { topic: "sports", q: "Did you play sports at school?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "sports", q: "Do you prefer playing sports or watching them?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "sports", q: "How often do you watch sports?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "sports", q: "Have you ever joined a sports team?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "sports", q: "What type of exercise do you enjoy?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { topic: "sports", q: "Do you have a favourite athlete?", noMemory: true },
  { topic: "sports", q: "Do you like watching the Olympics?", noMemory: true },
  { topic: "sports", q: "What new sport would you like to try?", noMemory: true },

  // Food and health
  { topic: "food", q: "What is your favourite food?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "Do you usually eat healthy food?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "Do you enjoy cooking?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "What meals can you cook?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "What is a traditional meal from Sichuan?", expected: ["xiang-profile:lifestyle-food-health", "xiang-profile:identity-education"] },
  { topic: "food", q: "Do you eat fast food?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "What food from other countries do you like?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "What fruit and vegetables do you like?", noMemory: true },
  { topic: "food", q: "Do you think you are a healthy person?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "food", q: "Have you ever been on a diet?", expected: ["xiang-profile:lifestyle-food-health"] },

  // Family
  { topic: "family", q: "Do you have any brothers or sisters?", expected: ["xiang-profile:family-background", "xiang-profile:personal-loss-and-sister"] },
  { topic: "family", q: "Tell me about someone in your family.", expected: ["xiang-profile:family-background", "xiang-profile:personal-loss-and-sister"] },
  { topic: "family", q: "Do you live with your family now?", expected: ["xiang-profile:identity-education", "xiang-profile:family-background"] },
  { topic: "family", q: "How often do you spend time with your family?", expected: ["xiang-profile:family-background"] },
  { topic: "family", q: "What do you usually do with your family?", expected: ["xiang-profile:family-background"] },
  { topic: "family", q: "Do you prefer chatting with family or friends?", expected: ["xiang-profile:personality-social-style", "xiang-profile:family-background"] },
  { topic: "family", q: "How often do you call your family?", expected: ["xiang-profile:family-background"] },
  { topic: "family", q: "Is family important to you?", expected: ["xiang-profile:family-background", "xiang-profile:values-immigration"] },
  { topic: "family", q: "Have you celebrated anything with your family recently?", expected: ["xiang-profile:family-background"] },
  { topic: "family", q: "Who do you admire in your family?", expected: ["xiang-profile:family-background", "xiang-profile:personal-loss-and-sister"] },

  // Childhood
  { topic: "childhood", q: "Tell me about your school when you were a child.", expected: ["xiang-profile:china-school-history"] },
  { topic: "childhood", q: "What was your favourite subject as a child?", expected: ["xiang-profile:china-school-history", "xiang-profile:learning-presentations", "xiang-update:2026-05:childhood-biology"] },
  { topic: "childhood", q: "Who was your favourite teacher when you were young?", noMemory: true },
  { topic: "childhood", q: "Were you a good student when you were a child?", noMemory: true },
  { topic: "childhood", q: "Where did you live as a child?", expected: ["xiang-profile:identity-education", "xiang-profile:china-school-history", "xiang-update:2026-05:childhood-home"] },
  { topic: "childhood", q: "Do you still have friends from childhood?", expected: ["xiang-profile:personality-social-style", "xiang-update:2026-05:childhood-home"] },
  { topic: "childhood", q: "What did you do with friends as a child?", noMemory: true },
  { topic: "childhood", q: "What did you do during summer holidays as a child?", noMemory: true },
  { topic: "childhood", q: "What was your favourite toy as a child?", noMemory: true },
  { topic: "childhood", q: "Tell me about a birthday you remember from childhood.", noMemory: true },

  // Shopping and fashion
  { topic: "shopping", q: "Do you enjoy shopping?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:shopping-clothes"] },
  { topic: "shopping", q: "How often do you go shopping?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:shopping-clothes"] },
  { topic: "shopping", q: "Do you like shopping centres?", noMemory: true },
  { topic: "shopping", q: "What do you think about online shopping?", expected: ["xiang-update:2026-05:shopping-clothes", "xiang-profile:lifestyle-food-health"] },
  { topic: "shopping", q: "Do you enjoy traditional markets?", noMemory: true },
  { topic: "shopping", q: "How much money do you spend on clothes?", noMemory: true },
  { topic: "shopping", q: "What kind of clothes do you like wearing?", noMemory: true },
  { topic: "shopping", q: "Do you prefer summer clothes or winter clothes?", noMemory: true },
  { topic: "shopping", q: "What would you wear to a formal event?", noMemory: true },
  { topic: "shopping", q: "Are you a fashionable person?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:shopping-clothes"] },

  // Daily routines
  { topic: "routine", q: "What do you normally do in the morning?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "Do you prefer morning or evening?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "What is your breakfast routine?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "Is exercise part of your routine?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "Is your routine similar every day?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "What do you usually do for lunch?", expected: ["xiang-profile:lifestyle-food-health"] },
  { topic: "routine", q: "What do you like doing after school?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general", "xiang-profile:lifestyle-food-health", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "How much time do you spend relaxing every day?", expected: ["xiang-profile:lifestyle-food-health", "xiang-profile:games-general", "xiang-update:2026-05:sleep-routine"] },
  { topic: "routine", q: "What do you like doing on weekends?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general", "xiang-profile:personality-social-style", "xiang-profile:lifestyle-food-health"] },
  { topic: "routine", q: "Do you have enough free time?", expected: ["xiang-profile:lifestyle-food-health", "xiang-profile:work-motivation", "xiang-profile:personality-social-style"] },

  // Entertainment
  { topic: "entertainment", q: "What is your favourite type of music?", expected: ["xiang-profile:game-scripting-music", "xiang-profile:games-general"] },
  { topic: "entertainment", q: "Do you enjoy listening to music?", expected: ["xiang-update:2026-05:music-listening", "xiang-profile:game-scripting-music", "xiang-profile:games-general"] },
  { topic: "entertainment", q: "Where do you normally listen to music?", expected: ["xiang-update:2026-05:music-listening", "xiang-profile:game-scripting-music", "xiang-profile:games-general"] },
  { topic: "entertainment", q: "How often do you watch TV?", noMemory: true },
  { topic: "entertainment", q: "Do you watch TV alone or with other people?", expected: ["xiang-profile:personality-social-style"] },
  { topic: "entertainment", q: "What TV programmes do you like?", expected: ["xiang-update:2026-05:anime-tv-film"] },
  { topic: "entertainment", q: "Do you prefer TV series or films?", noMemory: true },
  { topic: "entertainment", q: "What kinds of films do you like?", expected: ["xiang-update:2026-05:anime-tv-film", "xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { topic: "entertainment", q: "What kinds of films are popular in China?", noMemory: true },
  { topic: "entertainment", q: "How often do you go to the cinema?", noMemory: true },
];

let top1 = 0;
let top3 = 0;
let noMemoryOk = 0;
let noMemoryTotal = 0;
const byTopic = new Map<string, { total: number; top1: number; top3: number; noMemoryOk: number; noMemoryTotal: number }>();
const failures: string[] = [];

for (const [index, test] of cases.entries()) {
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, test.q, 5);
  const refs = results.map((result) => result.sourceRef || `id:${result.id}`);
  const titles = results.map((result) => result.title);
  const stat = byTopic.get(test.topic) ?? { total: 0, top1: 0, top3: 0, noMemoryOk: 0, noMemoryTotal: 0 };
  stat.total += 1;

  if (test.noMemory) {
    noMemoryTotal += 1;
    stat.noMemoryTotal += 1;
    const ok = refs.length === 0;
    if (ok) {
      noMemoryOk += 1;
      stat.noMemoryOk += 1;
      top1 += 1;
      top3 += 1;
      stat.top1 += 1;
      stat.top3 += 1;
    } else {
      failures.push(`#${index + 1} [${test.topic}] ${test.q}
  expected: no memory
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
    }
    byTopic.set(test.topic, stat);
    continue;
  }

  const expected = test.expected ?? [];
  const ok1 = expected.includes(refs[0]);
  const ok3 = refs.slice(0, 3).some((ref) => expected.includes(ref));
  if (ok1) {
    top1 += 1;
    stat.top1 += 1;
  }
  if (ok3) {
    top3 += 1;
    stat.top3 += 1;
  }
  if (!ok1) {
    failures.push(`#${index + 1} [${test.topic}] ${test.q}
  expected: ${expected.join(" | ")}
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
  }
  byTopic.set(test.topic, stat);
}

console.log(`IELTS cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length} noMemory=${noMemoryOk}/${noMemoryTotal}`);
for (const [topic, stat] of [...byTopic.entries()].sort()) {
  const noMemory = stat.noMemoryTotal ? ` noMemory=${stat.noMemoryOk}/${stat.noMemoryTotal}` : "";
  console.log(`${topic}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}${noMemory}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
