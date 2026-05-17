import { conversationLogger } from "../src/server/data/conversation-logger";
import { EventMemoryManager } from "../src/server/memory/event-memory";

const userId = process.argv[2] || "li2897283405@gmail.com";

type RetrievalCase = {
  group: string;
  q: string;
  expected?: string[];
  noMemory?: boolean;
};

type SceneCase = {
  group: string;
  history: string[];
  latest: string;
  expectedScene: string;
  expected?: string[];
  noMemory?: boolean;
};

const retrievalCases: RetrievalCase[] = [
  { group: "asr_aws", q: "lambda cold start not my", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "asr_aws", q: "lambda coldstart just concept", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "asr_aws", q: "lamba cold start general", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "asr_aws", q: "server less lambda cold why", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "asr_aws", q: "cold start lambda not project", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "asr_aws", q: "s3 generally use for", expected: ["knowledge:cs-interview:aws-core-services"] },
  { group: "asr_aws", q: "api gateway lambda s3 in aws", expected: ["knowledge:cs-interview:aws-core-services"] },
  { group: "asr_aws", q: "well architected cost cloud", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "asr_aws", q: "six pillar aws reliable cost", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "asr_aws", q: "event bridge sqs cloud", expected: ["knowledge:cs-interview:aws-core-services", "knowledge:cs-interview:cloud-devops-cicd"] },
  { group: "asr_aws", q: "elder album lambda photo store", expected: ["doc:elderalbum:aws-architecture-deployment", "doc:elderalbum:api-data-model"] },
  { group: "asr_aws", q: "elder album api gateway route", expected: ["doc:elderalbum:api-data-model", "doc:elderalbum:aws-architecture-deployment"] },
  { group: "asr_aws", q: "my aws project album serverless", expected: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"] },

  { group: "asr_ml", q: "classification metric precision recall", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "class imbalance recall precision", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "data leakage train test", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "over fitting regularization", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "supervise learning answer", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "unsupervised learning clustering", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "gradient descent why", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_ml", q: "drop out deep learning", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "asr_ml", q: "back propagation neural network", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "asr_ml", q: "transformer embedding attention", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "asr_ml", q: "recommender cold start user item", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "asr_ml", q: "collaborative filtering content based", expected: ["knowledge:cs-interview:recommender-systems"] },

  { group: "asr_cs", q: "rest api status code", expected: ["knowledge:cs-interview:networking-web-protocols", "knowledge:cs-interview:backend-api-design"] },
  { group: "asr_cs", q: "http 429 rate limit", expected: ["knowledge:cs-interview:networking-web-protocols", "knowledge:cs-interview:backend-api-design"] },
  { group: "asr_cs", q: "dns tcp tls when type url", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "asr_cs", q: "database index slow query", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "asr_cs", q: "sql nosql choose", expected: ["knowledge:cs-interview:database-sql", "knowledge:cs-interview:nosql-dynamodb"] },
  { group: "asr_cs", q: "dynamodb partition hot key", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "asr_cs", q: "queue data structure not food", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "asr_cs", q: "thread operating system process", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "asr_cs", q: "deadlock mutex semaphore", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "asr_cs", q: "solid dependency injection", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "asr_cs", q: "object class oop", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "asr_cs", q: "unit integration regression test", expected: ["knowledge:cs-interview:software-engineering-testing"] },
  { group: "asr_cs", q: "system design cache queue cdn", expected: ["knowledge:cs-interview:system-design-fundamentals"] },
  { group: "asr_cs", q: "cap theorem eventual consistency", expected: ["knowledge:cs-interview:distributed-systems"] },
  { group: "asr_cs", q: "ci cd blue green rollback", expected: ["knowledge:cs-interview:cloud-devops-cicd"] },
  { group: "asr_cs", q: "jwt auth least privilege", expected: ["knowledge:cs-interview:security-web-app"] },

  { group: "asr_project", q: "react native project parking", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "asr_project", q: "parking app weather timetable", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "asr_project", q: "parking crowd report navigation", expected: ["doc:dalparkaid:crowd-reporting-navigation"] },
  { group: "asr_project", q: "job lens resume matching", expected: ["doc:joblens:workflow-features", "doc:joblens:overview-problem"] },
  { group: "asr_project", q: "joblens dynamodb data store", expected: ["doc:joblens:data-storage-security"] },
  { group: "asr_project", q: "saynext why build", expected: ["doc:saynext:interview-story", "doc:saynext:positioning", "xiang-profile:project-saynext"] },
  { group: "asr_project", q: "say next mobile not smart glasses", expected: ["doc:saynext:positioning"] },
  { group: "asr_project", q: "saynext bad context reset pause", expected: ["doc:saynext:ui-ux", "doc:saynext:runtime-flow"] },
  { group: "asr_project", q: "saynext frp vps local travel", expected: ["doc:saynext:llm-deployment"] },
  { group: "asr_project", q: "saynext hybrid fts memory", expected: ["doc:saynext:memory-personalization"] },

  { group: "asr_personal", q: "那个 cloud architecture why", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "asr_personal", q: "deep learning like why", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "asr_personal", q: "what time deep learning class", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "asr_personal", q: "which course summer cloud", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "asr_personal", q: "data management course took", expected: ["xiang-update:2026-05:past-courses"] },
  { group: "asr_personal", q: "high school before canada school", expected: ["xiang-profile:china-school-history"] },
  { group: "asr_personal", q: "high school canada dartmouth", expected: ["xiang-profile:canada-high-school-transition"] },
  { group: "asr_personal", q: "why computer science money project", expected: ["xiang-update:2026-05:why-computer-science"] },
  { group: "asr_personal", q: "english learning youtube vocabulary", expected: ["xiang-update:2026-05:english-learning"] },
  { group: "asr_personal", q: "sleep schedule irregular", expected: ["xiang-update:2026-05:sleep-routine"] },
  { group: "asr_personal", q: "reddit news meme website", expected: ["xiang-update:2026-05:reddit-internet"] },
  { group: "asr_personal", q: "fruit pineapple orange", expected: ["xiang-update:2026-05:fruit"] },
  { group: "asr_personal", q: "swimming exercise good at", expected: ["xiang-update:2026-05:swimming"] },
  { group: "asr_personal", q: "drive campus car license", expected: ["xiang-update:2026-05:driving-car"] },

  { group: "asr_noise", q: "and", noMemory: true },
  { group: "asr_noise", q: "uh uh answer", noMemory: true },
  { group: "asr_noise", q: "this whole gargle hairy nuts", noMemory: true },
  { group: "asr_noise", q: "what orange telecom", noMemory: true },
  { group: "asr_noise", q: "queue for food lunch", noMemory: true },
  { group: "asr_noise", q: "who won hockey yesterday", noMemory: true },
  { group: "asr_noise", q: "photosynthesis explain", noMemory: true },
  { group: "asr_noise", q: "weather tomorrow halifax", noMemory: true },
  { group: "asr_noise", q: "translate hello spanish", noMemory: true },
  { group: "asr_noise", q: "cake recipe chocolate", noMemory: true },
];

const sceneCases: SceneCase[] = [
  { group: "daily_to_interview", history: ["Good morning, how's your day going?", "Sounds chill, just taking it easy today?"], latest: "In this interview, tell me about yourself.", expectedScene: "interview", expected: ["xiang-profile:identity-education"] },
  { group: "daily_to_interview", history: ["What game did you play last night?", "Do you usually stay home on weekends?"], latest: "For this position, what project should I talk about for AWS?", expectedScene: "interview", expected: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"] },
  { group: "daily_to_interview", history: ["Do you like anime?", "What food do you usually order?"], latest: "As a candidate, explain your React Native experience.", expectedScene: "interview", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "daily_to_interview", history: ["How's your weekend?", "Any plans after class?"], latest: "Interview question: why did you build SayNext?", expectedScene: "interview", expected: ["doc:saynext:interview-story", "doc:saynext:positioning"] },
  { group: "daily_to_interview", history: ["Sounds chill.", "What do you eat when you are lazy?"], latest: "Could you introduce yourself as a candidate?", expectedScene: "interview", expected: ["xiang-profile:identity-education"] },
  { group: "daily_to_interview", history: ["Do you go outside much?", "What music do you listen to?"], latest: "In an interview, explain a hard bug you fixed.", expectedScene: "interview", expected: ["xiang-behavioral:saynext-hard-bug-context", "knowledge:cs-interview:software-engineering-testing", "doc:saynext:trial-error"] },
  { group: "daily_to_interview", history: ["Do you like mountains?", "Do you like staying indoors?"], latest: "For the role, what is your strongest technical project?", expectedScene: "interview", expected: ["doc:saynext:interview-story", "xiang-profile:project-saynext"] },
  { group: "daily_to_interview", history: ["What game you played?", "Do you like Coke or Pepsi?"], latest: "Candidate question: how do you handle cloud cost?", expectedScene: "interview", expected: ["knowledge:cs-interview:aws-well-architected"] },

  { group: "daily_to_classroom", history: ["What are you doing this weekend?", "Probably just chilling."], latest: "In class, the professor is explaining Lambda cold start.", expectedScene: "classroom", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "daily_to_classroom", history: ["What food do you like?", "Do you cook often?"], latest: "Lecture topic: class imbalance and recall.", expectedScene: "classroom", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "daily_to_classroom", history: ["Do you like anime?", "What shows are popular?"], latest: "The professor asks what DynamoDB partition key means.", expectedScene: "classroom", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "daily_to_classroom", history: ["Good morning, how's your day?", "Any game news?"], latest: "For today's course, we discuss star schema in data warehouse.", expectedScene: "classroom", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "daily_to_classroom", history: ["What do you do after class?", "Do you go to the park?"], latest: "The lecture is about process versus thread.", expectedScene: "classroom", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "daily_to_classroom", history: ["Are you taking it easy today?", "Sounds good."], latest: "In cloud architecting class, what is Well Architected?", expectedScene: "classroom", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "daily_to_classroom", history: ["Do you like music?", "Where do you listen?"], latest: "Professor says backpropagation updates weights using gradients.", expectedScene: "classroom", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "daily_to_classroom", history: ["What's your favorite room?", "Is your room cozy?"], latest: "Class question: what is REST API pagination?", expectedScene: "classroom", expected: ["knowledge:cs-interview:backend-api-design"] },

  { group: "interview_to_classroom", history: ["This is an interview for a software role.", "Tell me about your AWS project."], latest: "Now in class, professor explains supervised learning.", expectedScene: "classroom", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "interview_to_classroom", history: ["Candidate, tell me about SayNext.", "What was hard in your project?"], latest: "Lecture: why does Lambda cold start happen?", expectedScene: "classroom", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "interview_to_classroom", history: ["For this role, describe your React experience.", "What project did you make?"], latest: "Professor asks: what is object class in OOP?", expectedScene: "classroom", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "interview_to_classroom", history: ["Tell me about yourself as a candidate.", "Why this position?"], latest: "Class lecture about CAP theorem and consistency.", expectedScene: "classroom", expected: ["knowledge:cs-interview:distributed-systems"] },
  { group: "interview_to_classroom", history: ["What project are you proud of?", "Explain your role."], latest: "Course discussion: what is database indexing?", expectedScene: "classroom", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "interview_to_classroom", history: ["Why should we hire you?", "What's your strength?"], latest: "The professor is talking about dropout in deep learning.", expectedScene: "classroom", expected: ["knowledge:cs-interview:deep-learning"] },

  { group: "classroom_to_interview", history: ["Professor explains queue and caching.", "The lecture is about cloud architecture."], latest: "Interview question: which project should I use if they ask about AWS?", expectedScene: "interview", expected: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"] },
  { group: "classroom_to_interview", history: ["Class lecture on dropout.", "We discuss neural networks."], latest: "For the candidate interview, explain why you like deep learning.", expectedScene: "interview", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "classroom_to_interview", history: ["Professor talks about React components.", "Class asks about mobile app performance."], latest: "In an interview, what was the parking mobile app about?", expectedScene: "interview", expected: ["doc:dalparkaid:overview-problem"] },
  { group: "classroom_to_interview", history: ["Lecture topic is REST APIs.", "We discuss status codes."], latest: "Candidate question: why did I choose computer science?", expectedScene: "interview", expected: ["xiang-update:2026-05:why-computer-science"] },
  { group: "classroom_to_interview", history: ["Cloud architecting lecture.", "Professor explains cost optimization."], latest: "Interview question: why did you build SayNext?", expectedScene: "interview", expected: ["doc:saynext:interview-story", "doc:saynext:positioning"] },
  { group: "classroom_to_interview", history: ["Data warehouse class.", "We discuss ETL."], latest: "For this role, what is your future job goal?", expectedScene: "interview", expected: ["xiang-update:2026-05:future-job"] },

  { group: "classroom_to_daily", history: ["Professor explains Lambda and DynamoDB.", "The lecture is about serverless cost."], latest: "Anyway, what game did you play last night?", expectedScene: "daily_chat", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "classroom_to_daily", history: ["Class discusses supervised learning.", "Professor asks about metrics."], latest: "After class, do you usually stay home?", expectedScene: "daily_chat", expected: ["xiang-update:2026-05:sleep-routine", "xiang-profile:personality-social-style"] },
  { group: "classroom_to_daily", history: ["Lecture on cloud architecture.", "We talk about reliability."], latest: "What food do you want for takeout?", expectedScene: "daily_chat", expected: ["xiang-profile:lifestyle-food-health"] },
  { group: "classroom_to_daily", history: ["Professor explains REST API.", "The class is about backend."], latest: "Good morning, how's your day going?", expectedScene: "daily_chat", noMemory: true },
  { group: "classroom_to_daily", history: ["Class topic: data warehouse.", "Professor explains star schema."], latest: "Do you like anime these days?", expectedScene: "daily_chat", expected: ["xiang-update:2026-05:anime-tv-film"] },
  { group: "classroom_to_daily", history: ["Cloud computing lecture.", "Professor says EC2 and Lambda."], latest: "Do you want to hang out this weekend?", expectedScene: "daily_chat", expected: ["xiang-profile:lifestyle-food-health", "xiang-update:2026-05:parks-going-out", "xiang-profile:personality-social-style"] },

  { group: "classroom_noise_should_stay", history: ["Professor explains Lambda cold start.", "The class is about serverless."], latest: "and", expectedScene: "classroom", noMemory: true },
  { group: "classroom_noise_should_stay", history: ["Lecture about deep learning.", "Professor says gradients."], latest: "uh uh", expectedScene: "classroom", noMemory: true },
  { group: "classroom_noise_should_stay", history: ["Class discussion about DynamoDB.", "Partition key topic."], latest: "okay", expectedScene: "classroom", noMemory: true },
  { group: "classroom_noise_should_stay", history: ["Professor explains OOP design pattern.", "Class talks about strategy pattern."], latest: "yeah", expectedScene: "classroom", noMemory: true },
  { group: "interview_noise_should_stay", history: ["This is a job interview for a developer role.", "Tell me about yourself."], latest: "and", expectedScene: "interview", noMemory: true },
  { group: "interview_noise_should_stay", history: ["Candidate, explain your project.", "Why should we hire you?"], latest: "definitely", expectedScene: "interview", noMemory: true },

  { group: "meeting_switch", history: ["What did you do this weekend?", "I just played some games."], latest: "In our team meeting, the task deadline changed.", expectedScene: "group_discussion", noMemory: true },
  { group: "meeting_switch", history: ["Professor explains ML metrics.", "Class is about precision recall."], latest: "In the sprint meeting, what should we do about the bug?", expectedScene: "group_discussion", expected: ["knowledge:cs-interview:software-engineering-testing"] },
  { group: "meeting_switch", history: ["Interview question about AWS.", "Tell me about ElderAlbum."], latest: "Team standup: should we prioritize API pagination or UI first?", expectedScene: "group_discussion", expected: ["knowledge:cs-interview:backend-api-design"] },
  { group: "meeting_switch", history: ["Good morning, how's your day?", "Sounds chill."], latest: "Group project meeting: parking app weather timetable issue.", expectedScene: "group_discussion", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "meeting_switch", history: ["Class lecture about authentication.", "Professor says JWT."], latest: "Meeting question: how should we validate JWT in the app?", expectedScene: "group_discussion", expected: ["knowledge:cs-interview:security-web-app"] },

  { group: "mixed_asr_switch", history: ["Good morning, how's your day going?", "Sounds chill."], latest: "candidate uh project say next why build", expectedScene: "interview", expected: ["xiang-profile:project-saynext", "doc:saynext:interview-story", "doc:saynext:positioning"] },
  { group: "mixed_asr_switch", history: ["Interview question: tell me about yourself.", "Why this role?"], latest: "那个 cloud architecture why", expectedScene: "classroom", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "mixed_asr_switch", history: ["Professor explains Lambda.", "Class about serverless."], latest: "weekend game probably what you play", expectedScene: "daily_chat", expected: ["xiang-profile:favorite-games", "xiang-profile:games-general"] },
  { group: "mixed_asr_switch", history: ["Team meeting about sprint.", "We have a deployment bug."], latest: "interview react native parking project", expectedScene: "interview", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "mixed_asr_switch", history: ["Daily chat about anime.", "What food do you like?"], latest: "class imbalance recall precision professor", expectedScene: "classroom", expected: ["knowledge:cs-interview:ml-fundamentals"] },
];

let total = 0;
let top1 = 0;
let top3 = 0;
let noMemoryOk = 0;
let noMemoryTotal = 0;
let sceneOk = 0;
let sceneTotal = 0;
const byGroup = new Map<string, { total: number; ok: number }>();
const failures: string[] = [];

function mark(group: string, ok: boolean): void {
  const stat = byGroup.get(group) ?? { total: 0, ok: 0 };
  stat.total += 1;
  if (ok) stat.ok += 1;
  byGroup.set(group, stat);
}

function checkRetrieval(group: string, q: string, expected?: string[], noMemory?: boolean): boolean {
  total += 1;
  const results = conversationLogger.searchPersonalMemoriesHybrid(userId, q, 5);
  const refs = results.map((result) => result.sourceRef || `id:${result.id}`);
  const titles = results.map((result) => result.title);

  if (noMemory) {
    noMemoryTotal += 1;
    const ok = refs.length === 0;
    if (ok) {
      top1 += 1;
      top3 += 1;
      noMemoryOk += 1;
    } else {
      failures.push(`[${group}] ${q}
  expected: no memory
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
    }
    mark(group, ok);
    return ok;
  }

  const ok1 = (expected ?? []).includes(refs[0]);
  const ok3 = refs.slice(0, 3).some((ref) => (expected ?? []).includes(ref));
  if (ok1) top1 += 1;
  if (ok3) top3 += 1;
  if (!ok1) {
    failures.push(`[${group}] ${q}
  expected: ${(expected ?? []).join(" | ")}
  top: ${refs.slice(0, 5).map((ref, i) => `${ref} (${titles[i]})`).join(" | ")}`);
  }
  mark(group, ok1);
  return ok1;
}

for (const test of retrievalCases) {
  checkRetrieval(test.group, test.q, test.expected, test.noMemory);
}

for (const [index, test] of sceneCases.entries()) {
  const manager = new EventMemoryManager(`eval-scene-asr-${index}@local`, `eval-scene-${Date.now()}-${index}`, false);
  let ts = 1_800_000_000_000 + index * 100_000;
  for (const text of test.history) {
    manager.addTranscript(text, ts);
    ts += 30_000;
  }
  const snapshot = manager.addTranscript(test.latest, ts);
  sceneTotal += 1;
  const sceneMatches = snapshot.scene === test.expectedScene;
  if (sceneMatches) sceneOk += 1;
  else {
    failures.push(`[${test.group}] scene switch latest="${test.latest}"
  expected scene: ${test.expectedScene}
  actual scene: ${snapshot.scene}
  recent: ${snapshot.recentTranscripts.join(" | ")}`);
  }
  mark(`${test.group}:scene`, sceneMatches);

  checkRetrieval(`${test.group}:retrieval`, test.latest, test.expected, test.noMemory);
}

console.log(`SCENE_ASR retrievalCases=${retrievalCases.length} sceneCases=${sceneCases.length} totalChecks=${total + sceneTotal}`);
console.log(`retrieval top1=${top1}/${total} top3=${top3}/${total} noMemory=${noMemoryOk}/${noMemoryTotal}`);
console.log(`scene=${sceneOk}/${sceneTotal}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  console.log(`${group}: ${stat.ok}/${stat.total}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
