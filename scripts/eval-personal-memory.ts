import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  group: string;
  q: string;
  expected: string[];
};

const cases: EvalCase[] = [
  { group: "education", q: "Where are you studying now?", expected: ["xiang-profile:identity-education", "xiang-update:2026-05:summer-courses"] },
  { group: "education", q: "What program are you in at Dal?", expected: ["xiang-profile:identity-education"] },
  { group: "education", q: "Where did you do your bachelor degree?", expected: ["xiang-profile:identity-education"] },
  { group: "education", q: "What high school did you go to in Canada?", expected: ["xiang-profile:canada-high-school-transition"] },
  { group: "education", q: "Where did you study after moving to Halifax?", expected: ["xiang-profile:canada-high-school-transition"] },
  { group: "education", q: "What school did you attend in China before Canada?", expected: ["xiang-profile:china-school-history"] },
  { group: "education", q: "Where were you from before coming to Canada school wise?", expected: ["xiang-profile:china-school-history", "xiang-profile:canada-high-school-transition"] },
  { group: "education", q: "What was your middle school in Chengdu?", expected: ["xiang-profile:china-school-history"] },
  { group: "education", q: "Where are you study during your high school?", expected: ["xiang-profile:canada-high-school-transition", "xiang-profile:china-school-history"] },
  { group: "education", q: "What school you studying? What high school you studying in China?", expected: ["xiang-profile:china-school-history"] },
  { group: "daily", q: "Do you prefer to spend free time indoors or outdoors?", expected: ["xiang-profile:personality-social-style", "xiang-profile:lifestyle-food-health"] },
  { group: "daily", q: "Are you more outgoing or more homebody?", expected: ["xiang-profile:personality-social-style"] },
  { group: "daily", q: "What do you usually do on weekends?", expected: ["xiang-profile:personality-social-style", "xiang-profile:favorite-games", "xiang-profile:games-general", "xiang-profile:lifestyle-food-health"] },
  { group: "daily", q: "What food do you like?", expected: ["xiang-profile:lifestyle-food-health"] },
  { group: "daily", q: "Do you cook often or order delivery?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:shopping-clothes"] },
  { group: "daily", q: "What drink do you usually like?", expected: ["xiang-profile:lifestyle-food-health"] },
  { group: "daily", q: "Do you exercise a lot?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:swimming"] },
  { group: "daily", q: "How is your sleep schedule?", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:sleep-routine"] },
  { group: "daily", q: "How would you describe your speaking style?", expected: ["xiang-profile:speaking-style"] },
  { group: "daily", q: "Why do your answers sound casual and not formal?", expected: ["xiang-profile:speaking-style", "xiang-profile:personality-social-style"] },
  { group: "games", q: "What games do you play?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "games", q: "What game you played?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "games", q: "Do you like Pokemon?", expected: ["xiang-profile:favorite-games"] },
  { group: "games", q: "Do you like open world RPG games?", expected: ["xiang-profile:favorite-games"] },
  { group: "games", q: "What kind of gacha games do you play?", expected: ["xiang-profile:games-general", "xiang-profile:favorite-games"] },
  { group: "games", q: "How are games related to your programming interest?", expected: ["xiang-profile:game-scripting-music"] },
  { group: "games", q: "Tell me about your piano scripts in games", expected: ["xiang-profile:game-scripting-music"] },
  { group: "games", q: "Do you care about trophies or 100 percent completion?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "personal", q: "What did your family business do?", expected: ["xiang-profile:family-background"] },
  { group: "personal", q: "What happened to your family company after 2018?", expected: ["xiang-profile:family-background"] },
  { group: "personal", q: "What happened to your father?", expected: ["xiang-profile:personal-loss-and-sister"] },
  { group: "personal", q: "What did your sister study?", expected: ["xiang-profile:personal-loss-and-sister"] },
  { group: "personal", q: "Why do you care about Canada and long term stability?", expected: ["xiang-profile:values-immigration"] },
  { group: "personal", q: "Why is freedom important for you?", expected: ["xiang-profile:values-immigration", "xiang-profile:emotional-background-values"] },
  { group: "personal", q: "How do you react under stress?", expected: ["xiang-profile:stress-insecurity-romance"] },
  { group: "personal", q: "Do you have much dating experience?", expected: ["xiang-profile:stress-insecurity-romance"] },
  { group: "personal", q: "Why are you nervous talking to girls?", expected: ["xiang-profile:stress-insecurity-romance"] },
  { group: "personal", q: "Why do you dislike bullying?", expected: ["xiang-profile:emotional-background-values"] },
  { group: "learning", q: "How do you usually use AI to solve problems?", expected: ["xiang-profile:ai-cognitive-style"] },
  { group: "learning", q: "Do you use AI as first thinker or just helper?", expected: ["xiang-profile:ai-cognitive-style"] },
  { group: "learning", q: "Why do you need notes for presentations?", expected: ["xiang-profile:learning-presentations"] },
  { group: "learning", q: "How do you learn technical topics best?", expected: ["xiang-profile:learning-presentations", "xiang-profile:work-motivation"] },
  { group: "learning", q: "Do you procrastinate on assignments?", expected: ["xiang-profile:work-motivation"] },
  { group: "learning", q: "What motivates you to do good work?", expected: ["xiang-profile:work-motivation"] },
  { group: "interview", q: "How should I answer interview questions?", expected: ["xiang-profile:interview-style"] },
  { group: "interview", q: "What should I avoid saying in interviews?", expected: ["xiang-profile:interview-style"] },
  { group: "interview", q: "Tell me about yourself interview answer", expected: ["xiang-profile:interview-style", "xiang-profile:identity-education"] },
  { group: "resume", q: "What skills are on my resume?", expected: ["doc:resume:skills-profile"] },
  { group: "resume", q: "What technologies do I know?", expected: ["xiang-profile:technical-skills", "doc:resume:skills-profile"] },
  { group: "resume", q: "What projects are listed on my resume?", expected: ["doc:resume:selected-projects"] },
  { group: "resume", q: "Which project should I talk about for AWS?", expected: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"] },
  { group: "resume", q: "Which project should I talk about for React Native?", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "elder", q: "What is ElderAlbum?", expected: ["doc:elderalbum:overview-features"] },
  { group: "elder", q: "Tell me about the serverless album sharing app", expected: ["doc:elderalbum:overview-features", "doc:elderalbum:aws-architecture-deployment"] },
  { group: "elder", q: "What AWS services did ElderAlbum use?", expected: ["doc:elderalbum:aws-architecture-deployment"] },
  { group: "elder", q: "What API routes did ElderAlbum have?", expected: ["doc:elderalbum:api-data-model"] },
  { group: "elder", q: "How did ElderAlbum store albums and photos?", expected: ["doc:elderalbum:api-data-model"] },
  { group: "elder", q: "What were ElderAlbum security limitations?", expected: ["doc:elderalbum:security-cost-future"] },
  { group: "elder", q: "What was hard about connecting AWS services together?", expected: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"] },
  { group: "dal", q: "What is DalParkAid?", expected: ["doc:dalparkaid:overview-problem"] },
  { group: "dal", q: "Tell me about my parking app", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "dal", q: "How does the parking prediction score work?", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "dal", q: "How did DalParkAid use weather and timetable data?", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "dal", q: "How do crowd reports work in DalParkAid?", expected: ["doc:dalparkaid:crowd-reporting-navigation"] },
  { group: "dal", q: "What is the 30 meter proximity gate?", expected: ["doc:dalparkaid:crowd-reporting-navigation"] },
  { group: "dal", q: "What did the user evaluation find for DalParkAid?", expected: ["doc:dalparkaid:evaluation-limitations"] },
  { group: "dal", q: "What are DalParkAid future improvements?", expected: ["doc:dalparkaid:evaluation-limitations"] },
  { group: "joblens", q: "What is JobLens AI?", expected: ["doc:joblens:overview-scope"] },
  { group: "joblens", q: "Tell me about my job matching app", expected: ["doc:joblens:overview-scope", "doc:joblens:workflow-features"] },
  { group: "joblens", q: "How does JobLens resume upload and matching work?", expected: ["doc:joblens:workflow-features"] },
  { group: "joblens", q: "What is the cloud architecture of JobLens?", expected: ["doc:joblens:architecture-aws"] },
  { group: "joblens", q: "What DynamoDB tables does JobLens use?", expected: ["doc:joblens:data-storage-security"] },
  { group: "joblens", q: "What security gaps did JobLens have?", expected: ["doc:joblens:data-storage-security"] },
  { group: "joblens", q: "What are JobLens cost and limitations?", expected: ["doc:joblens:reliability-cost-limitations"] },
  { group: "joblens", q: "Tell me about resume job matching project", expected: ["doc:joblens:overview-scope", "doc:joblens:workflow-features"] },
  { group: "saynext", q: "What is SayNext?", expected: ["doc:saynext:positioning"] },
  { group: "saynext", q: "Is SayNext a smart glasses app or mobile app?", expected: ["doc:saynext:positioning"] },
  { group: "saynext", q: "Why did I build SayNext?", expected: ["doc:saynext:positioning", "doc:saynext:interview-story", "xiang-profile:project-saynext"] },
  { group: "saynext", q: "How does SayNext process transcripts?", expected: ["doc:saynext:runtime-flow"] },
  { group: "saynext", q: "How does SayNext avoid stale responses?", expected: ["doc:saynext:runtime-flow"] },
  { group: "saynext", q: "How does SayNext personal memory work?", expected: ["doc:saynext:memory-personalization"] },
  { group: "saynext", q: "What is Prenote in SayNext?", expected: ["doc:saynext:memory-personalization", "doc:saynext:ui-ux"] },
  { group: "saynext", q: "How do local mode and travel mode work?", expected: ["doc:saynext:llm-deployment"] },
  { group: "saynext", q: "What problems did I run into developing SayNext?", expected: ["doc:saynext:trial-error"] },
  { group: "saynext", q: "What UI UX controls did I add?", expected: ["doc:saynext:ui-ux"] },
  { group: "saynext", q: "How should I explain SayNext in an interview?", expected: ["doc:saynext:interview-story"] },
  { group: "saynext", q: "What project you did for next", expected: ["xiang-profile:project-saynext", "doc:saynext:interview-story", "doc:saynext:positioning"] },
  { group: "asr", q: "where high school china", expected: ["xiang-profile:china-school-history"] },
  { group: "asr", q: "before Canada what school", expected: ["xiang-profile:china-school-history"] },
  { group: "asr", q: "game you play?", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "asr", q: "project small made", expected: ["xiang-profile:project-elder-album", "doc:elderalbum:overview-features", "doc:resume:selected-projects"] },
  { group: "asr", q: "parking prediction weather timetable", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "asr", q: "album api share token", expected: ["doc:elderalbum:api-data-model"] },
  { group: "asr", q: "joblens dynamodb table", expected: ["doc:joblens:data-storage-security"] },
  { group: "asr", q: "saynext prompt cost openai", expected: ["doc:saynext:trial-error", "doc:saynext:llm-deployment"] },
];

let top1 = 0;
let top3 = 0;
const byGroup = new Map<string, { total: number; top1: number; top3: number }>();
const failures: string[] = [];

for (const [index, test] of cases.entries()) {
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, test.q, 5);
  const refs = results.map((result) => result.sourceRef || `id:${result.id}`);
  const titles = results.map((result) => result.title);
  const ok1 = test.expected.includes(refs[0]);
  const ok3 = refs.slice(0, 3).some((ref) => test.expected.includes(ref));

  if (ok1) top1 += 1;
  if (ok3) top3 += 1;

  const stat = byGroup.get(test.group) ?? { total: 0, top1: 0, top3: 0 };
  stat.total += 1;
  if (ok1) stat.top1 += 1;
  if (ok3) stat.top3 += 1;
  byGroup.set(test.group, stat);

  if (!ok1) {
    failures.push(`#${index + 1} [${test.group}] ${test.q}
  expected: ${test.expected.join(" | ")}
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
  }
}

console.log(`TOTAL cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  console.log(`${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
