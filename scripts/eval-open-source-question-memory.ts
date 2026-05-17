import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  group: string;
  q: string;
  expected?: string[];
  noMemory?: boolean;
};

type GapProbe = {
  group: string;
  q: string;
  missingInfo: string;
};

// Inspired by open interview-question resources:
// - Tech Interview Handbook behavioral/software interview questions.
// - Data Science Interviews ML/data-science question categories.
// Questions are paraphrased or newly composed so this script does not depend on
// exact wording from any one source.
const cases: EvalCase[] = [
  // Behavioral / career interview questions
  { group: "behavioral", q: "Tell me about a project that was difficult but meaningful for you.", expected: ["xiang-behavioral:achievement-saynext", "xiang-behavioral:vague-requirements-prenote-scene", "doc:saynext:interview-story", "doc:saynext:trial-error", "xiang-profile:project-saynext", "xiang-profile:project-elder-album"] },
  { group: "behavioral", q: "What kind of role are you looking for after graduation?", expected: ["xiang-update:2026-05:future-job", "xiang-profile:values-immigration", "xiang-profile:interview-style"] },
  { group: "behavioral", q: "What type of work environment fits you best?", expected: ["xiang-update:2026-05:work-life-balance", "xiang-profile:values-immigration", "xiang-profile:personality-social-style"] },
  { group: "behavioral", q: "How do you handle a tight deadline on a school project?", expected: ["xiang-behavioral:prioritization-local-travel-mode", "xiang-profile:work-motivation", "doc:saynext:trial-error"] },
  { group: "behavioral", q: "How do you usually learn a new technical topic?", expected: ["xiang-profile:learning-presentations", "xiang-profile:ai-cognitive-style", "xiang-profile:work-motivation"] },
  { group: "behavioral", q: "How do you use AI when you are stuck on a technical problem?", expected: ["xiang-profile:ai-cognitive-style", "xiang-behavioral:saynext-local-llm-json-latency", "doc:saynext:memory-personalization"] },
  { group: "behavioral", q: "What motivates you to make a project look polished?", expected: ["xiang-profile:work-motivation"] },
  { group: "behavioral", q: "How would your classmates probably describe your communication style?", expected: ["xiang-profile:speaking-style", "xiang-profile:personality-social-style"] },
  { group: "behavioral", q: "What frustrates you in a workplace?", expected: ["xiang-update:2026-05:work-life-balance", "xiang-profile:values-immigration"] },
  { group: "behavioral", q: "Where do you see yourself in a few years?", expected: ["xiang-update:2026-05:future-job", "xiang-profile:values-immigration", "xiang-profile:interview-style"] },
  { group: "behavioral", q: "What are you excited to learn right now?", expected: ["xiang-update:2026-05:favorite-subjects", "xiang-update:2026-05:summer-courses"] },
  { group: "behavioral", q: "What is one strength that helps you in software projects?", expected: ["xiang-profile:ai-cognitive-style", "xiang-profile:work-motivation", "xiang-profile:technical-skills"] },
  { group: "behavioral", q: "What is one area you are still trying to improve?", expected: ["xiang-update:2026-05:english-learning", "xiang-profile:speaking-style", "xiang-profile:learning-presentations"] },
  { group: "behavioral", q: "How do you prepare when you need to explain a project?", expected: ["xiang-profile:learning-presentations", "doc:saynext:interview-story"] },
  { group: "behavioral", q: "What kind of project do you enjoy building?", expected: ["xiang-update:2026-05:future-job", "xiang-profile:technical-skills", "xiang-profile:game-scripting-music"] },
  { group: "behavioral", q: "What made you become more interested in computer science?", expected: ["xiang-update:2026-05:why-computer-science", "xiang-profile:game-scripting-music", "xiang-profile:technical-skills"] },
  { group: "behavioral", q: "Why do you care about building useful software?", expected: ["xiang-profile:work-motivation", "xiang-update:2026-05:future-job", "doc:saynext:positioning"] },
  { group: "behavioral", q: "What do you do when requirements are vague?", expected: ["xiang-behavioral:vague-requirements-prenote-scene", "xiang-profile:ai-cognitive-style", "doc:saynext:trial-error"] },
  { group: "behavioral", q: "How do you keep a project moving when you feel stuck?", expected: ["xiang-behavioral:saynext-local-llm-json-latency", "xiang-behavioral:leadership-ownership-saynext", "xiang-profile:ai-cognitive-style", "xiang-profile:work-motivation"] },
  { group: "behavioral", q: "What does a good work-life balance mean to you?", expected: ["xiang-update:2026-05:work-life-balance", "xiang-profile:values-immigration"] },

  // Project follow-up questions
  { group: "project_saynext", q: "Give me a short overview of SayNext.", expected: ["doc:saynext:positioning", "doc:saynext:interview-story", "xiang-profile:project-saynext"] },
  { group: "project_saynext", q: "Why did you decide to build SayNext?", expected: ["doc:saynext:interview-story", "doc:saynext:positioning", "xiang-profile:project-saynext"] },
  { group: "project_saynext", q: "What was the hardest part of making SayNext useful in real time?", expected: ["doc:saynext:trial-error", "doc:saynext:runtime-flow"] },
  { group: "project_saynext", q: "How does SayNext decide what memory to use?", expected: ["doc:saynext:memory-personalization"] },
  { group: "project_saynext", q: "How did you reduce prompt cost in SayNext?", expected: ["xiang-behavioral:prioritization-local-travel-mode", "doc:saynext:trial-error", "doc:saynext:llm-deployment"] },
  { group: "project_saynext", q: "How do local mode and travel mode work in SayNext?", expected: ["xiang-behavioral:prioritization-local-travel-mode", "doc:saynext:llm-deployment"] },
  { group: "project_saynext", q: "What is Prenote and why did you add it?", expected: ["xiang-behavioral:vague-requirements-prenote-scene", "doc:saynext:memory-personalization", "doc:saynext:ui-ux"] },
  { group: "project_saynext", q: "What UI controls did you add to recover from bad context?", expected: ["xiang-behavioral:saynext-hard-bug-context", "doc:saynext:ui-ux", "doc:saynext:runtime-flow"] },
  { group: "project_saynext", q: "How does SayNext handle partial transcripts?", expected: ["doc:saynext:runtime-flow"] },
  { group: "project_saynext", q: "Is SayNext mainly a mobile app or a smart glasses app?", expected: ["doc:saynext:positioning"] },

  { group: "project_elder", q: "Explain ElderAlbum in one minute.", expected: ["doc:elderalbum:overview-features", "xiang-profile:project-elder-album"] },
  { group: "project_elder", q: "Which AWS services did you use for ElderAlbum?", expected: ["doc:elderalbum:aws-architecture-deployment"] },
  { group: "project_elder", q: "How did photos and albums get stored in ElderAlbum?", expected: ["doc:elderalbum:api-data-model"] },
  { group: "project_elder", q: "What security limitations did ElderAlbum have?", expected: ["doc:elderalbum:security-cost-future"] },
  { group: "project_elder", q: "What would you improve in ElderAlbum next?", expected: ["doc:elderalbum:security-cost-future"] },

  { group: "project_joblens", q: "What problem does JobLens AI solve?", expected: ["doc:joblens:overview-scope"] },
  { group: "project_joblens", q: "How does JobLens compare a resume with a job posting?", expected: ["doc:joblens:workflow-features"] },
  { group: "project_joblens", q: "What was the AWS architecture for JobLens?", expected: ["doc:joblens:architecture-aws"] },
  { group: "project_joblens", q: "What data did JobLens store in DynamoDB?", expected: ["doc:joblens:data-storage-security"] },
  { group: "project_joblens", q: "What were the main limitations of JobLens?", expected: ["doc:joblens:reliability-cost-limitations"] },

  { group: "project_dalparkaid", q: "What is DalParkAid?", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "project_dalparkaid", q: "How did DalParkAid predict parking availability?", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "project_dalparkaid", q: "How did weather and class timetable affect DalParkAid?", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "project_dalparkaid", q: "How did crowd reports work in the parking app?", expected: ["doc:dalparkaid:crowd-reporting-navigation"] },
  { group: "project_dalparkaid", q: "What did the evaluation show for DalParkAid?", expected: ["doc:dalparkaid:evaluation-limitations"] },

  // Data science / ML technical questions should hit knowledge memory, not personal/project memory.
  { group: "ml_knowledge", q: "Explain the bias variance tradeoff.", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is overfitting and how can you reduce it?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is the difference between L1 and L2 regularization?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "How does cross validation help model evaluation?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is a confusion matrix?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "When would you use precision instead of recall?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is gradient descent?", expected: ["knowledge:cs-interview:ml-fundamentals", "knowledge:cs-interview:deep-learning"] },
  { group: "ml_knowledge", q: "How do decision trees split data?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is the difference between bagging and boosting?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "How does random forest reduce variance?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is feature selection?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "How do you handle missing values in a dataset?", expected: ["knowledge:cs-interview:ml-fundamentals", "knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "ml_knowledge", q: "What is class imbalance and how do you deal with it?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is PCA used for?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "Explain k-means clustering.", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is the difference between supervised and unsupervised learning?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "How would you evaluate a recommender system?", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "ml_knowledge", q: "What is collaborative filtering?", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "ml_knowledge", q: "What is content based recommendation?", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "ml_knowledge", q: "What is a train test split?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is data leakage?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "How do you choose a metric for a classification model?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "Explain A B testing for a product feature.", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is a p value?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "How does logistic regression work?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is the vanishing gradient problem?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "ml_knowledge", q: "What is dropout in neural networks?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "ml_knowledge", q: "What is batch normalization?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "ml_knowledge", q: "What is an embedding in machine learning?", expected: ["knowledge:cs-interview:deep-learning", "knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml_knowledge", q: "What is cosine similarity?", expected: ["knowledge:cs-interview:ml-fundamentals"] },

  // School / personal questions that should hit the new memories.
  { group: "school", q: "What courses are you taking this summer?", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "school", q: "Which course do you like most this term?", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "school", q: "Why do you like deep learning?", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "school", q: "Why did you choose computer science?", expected: ["xiang-update:2026-05:why-computer-science", "xiang-profile:identity-education"] },
  { group: "school", q: "What did you study in Winter 2026?", expected: ["xiang-update:2026-05:past-courses"] },
  { group: "school", q: "Which professor teaches your advanced cloud class this summer?", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "school", q: "How did you learn English after moving to Canada?", expected: ["xiang-update:2026-05:english-learning", "xiang-profile:canada-high-school-transition"] },
  { group: "school", q: "What is your weak point in English?", expected: ["xiang-update:2026-05:english-learning"] },
  { group: "school", q: "What subject did you like when you were younger?", expected: ["xiang-update:2026-05:childhood-biology"] },
  { group: "school", q: "Why did you not choose biology as your major?", expected: ["xiang-update:2026-05:childhood-biology"] },

  // Daily / social style
  { group: "daily", q: "What do you normally do after class?", expected: ["xiang-update:2026-05:sleep-routine"] },
  { group: "daily", q: "Do you usually go outside a lot?", expected: ["xiang-profile:personality-social-style", "xiang-update:2026-05:parks-going-out"] },
  { group: "daily", q: "Where do you like to relax when you are at home?", expected: ["xiang-update:2026-05:home-room"] },
  { group: "daily", q: "What website do you check often?", expected: ["xiang-update:2026-05:reddit-internet"] },
  { group: "daily", q: "What kind of shows do you watch?", expected: ["xiang-update:2026-05:anime-tv-film"] },
  { group: "daily", q: "Where do you usually listen to music?", expected: ["xiang-update:2026-05:music-listening"] },
  { group: "daily", q: "Do you like shopping for clothes?", expected: ["xiang-update:2026-05:shopping-clothes"] },
  { group: "daily", q: "How do you usually get to campus?", expected: ["xiang-update:2026-05:driving-car"] },
  { group: "daily", q: "What fruit do you like?", expected: ["xiang-update:2026-05:fruit"] },
  { group: "daily", q: "What sport are you actually good at?", expected: ["xiang-update:2026-05:swimming"] },

  // Messy / incomplete ASR style.
  { group: "asr", q: "project hard part say next real time", expected: ["doc:saynext:trial-error", "doc:saynext:runtime-flow"] },
  { group: "asr", q: "job lens resume match how work", expected: ["doc:joblens:workflow-features"] },
  { group: "asr", q: "elder album photo store aws", expected: ["doc:elderalbum:aws-architecture-deployment", "doc:elderalbum:api-data-model"] },
  { group: "asr", q: "dal parking weather class time prediction", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "asr", q: "summer class deep learning cloud", expected: ["xiang-update:2026-05:summer-courses", "xiang-update:2026-05:favorite-subjects"] },
  { group: "asr", q: "why computer science money project", expected: ["xiang-update:2026-05:why-computer-science"] },
  { group: "asr", q: "english weak vocabulary youtube canada", expected: ["xiang-update:2026-05:english-learning"] },
  { group: "asr", q: "free time reddit anime games", expected: ["xiang-update:2026-05:reddit-internet", "xiang-update:2026-05:anime-tv-film", "xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "asr", q: "drive school license china canada", expected: ["xiang-update:2026-05:driving-car"] },
  { group: "asr", q: "sport swimming butterfly", expected: ["xiang-update:2026-05:swimming"] },
];

const gapProbes: GapProbe[] = [
  { group: "gap_behavioral", q: "Tell me about a time you had a conflict with a teammate.", missingInfo: "需要一个真实小组冲突/意见不同的故事：项目、冲突点、你怎么说、结果。" },
  { group: "gap_behavioral", q: "What was the hardest bug you fixed recently?", missingInfo: "需要一个具体 bug 故事：项目名、bug 表现、定位过程、修复方法。" },
  { group: "gap_behavioral", q: "What constructive feedback have you received?", missingInfo: "需要一个别人给过你的具体反馈，比如表达、代码质量、时间管理。" },
  { group: "gap_behavioral", q: "Tell me about a time you showed leadership.", missingInfo: "需要一个低调但真实的 leadership/initiative 例子，不要夸大。" },
  { group: "gap_behavioral", q: "Tell me about a failure and what you learned.", missingInfo: "需要一个可以公开讲的失败/踩坑例子，最好和项目或学习有关。" },
  { group: "gap_behavioral", q: "Describe a time you disagreed with a professor or teammate.", missingInfo: "需要一个 disagreement 例子，说明你怎么处理，不要听起来冲突太大。" },
  { group: "gap_behavioral", q: "What achievement are you most satisfied with?", missingInfo: "需要一个你愿意说的 achievement。可以是 SayNext、ElderAlbum、英语适应、或课程项目。" },
  { group: "gap_behavioral", q: "How do you prioritize tasks when several deadlines happen together?", missingInfo: "需要一个真实多 deadline 的例子，最好有课程/项目时间线。" },
];

let top1 = 0;
let top3 = 0;
let noMemoryOk = 0;
let noMemoryTotal = 0;
const byGroup = new Map<string, { total: number; top1: number; top3: number; noMemoryOk: number; noMemoryTotal: number }>();
const failures: string[] = [];

for (const [index, test] of cases.entries()) {
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, test.q, 5);
  const refs = results.map((result) => result.sourceRef || `id:${result.id}`);
  const titles = results.map((result) => result.title);
  const stat = byGroup.get(test.group) ?? { total: 0, top1: 0, top3: 0, noMemoryOk: 0, noMemoryTotal: 0 };
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
      failures.push(`#${index + 1} [${test.group}] ${test.q}
  expected: no memory
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
    }
    byGroup.set(test.group, stat);
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
    failures.push(`#${index + 1} [${test.group}] ${test.q}
  expected: ${expected.join(" | ")}
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
  }
  byGroup.set(test.group, stat);
}

console.log(`OPEN-SOURCE-STYLE cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length} noMemory=${noMemoryOk}/${noMemoryTotal}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  const noMemory = stat.noMemoryTotal ? ` noMemory=${stat.noMemoryOk}/${stat.noMemoryTotal}` : "";
  console.log(`${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}${noMemory}`);
}

console.log("\nCOVERAGE GAP PROBES");
for (const probe of gapProbes) {
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, probe.q, 3);
  const top = results.map((result) => `${result.sourceRef || `id:${result.id}`} (${result.title})`).join(" | ") || "no strong memory";
  console.log(`[${probe.group}] ${probe.q}
  top: ${top}
  missing: ${probe.missingInfo}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
