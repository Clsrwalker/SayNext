import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  group: string;
  q: string;
  expected?: string[];
  noMemory?: boolean;
};

const cases: EvalCase[] = [
  // Same keyword, different intent: AWS / cloud
  { group: "aws_disambiguation", q: "Explain Lambda cold start, not from my project, just the concept.", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "aws_disambiguation", q: "In ElderAlbum, where did Lambda fit in the architecture?", expected: ["doc:elderalbum:aws-architecture-deployment"] },
  { group: "aws_disambiguation", q: "Which project should I use if an interviewer asks about AWS?", expected: ["doc:elderalbum:aws-architecture-deployment", "xiang-profile:project-elder-album"] },
  { group: "aws_disambiguation", q: "What is S3 generally used for?", expected: ["knowledge:cs-interview:aws-core-services"] },
  { group: "aws_disambiguation", q: "How did ElderAlbum store photos in S3?", expected: ["doc:elderalbum:api-data-model", "doc:elderalbum:aws-architecture-deployment"] },
  { group: "aws_disambiguation", q: "What does Well Architected mean for cloud cost?", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "aws_disambiguation", q: "Why do you like cloud architecture as a course?", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "aws_disambiguation", q: "Which cloud course are you taking this summer?", expected: ["xiang-update:2026-05:summer-courses"] },

  // Same keyword: mobile / React Native
  { group: "mobile_disambiguation", q: "What is React Native good for in general?", expected: ["knowledge:cs-interview:mobile-apps", "knowledge:cs-interview:frontend-react-web"] },
  { group: "mobile_disambiguation", q: "Which project should I talk about for React Native experience?", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "mobile_disambiguation", q: "How should a mobile app handle offline state?", expected: ["knowledge:cs-interview:mobile-apps"] },
  { group: "mobile_disambiguation", q: "Is SayNext a mobile app or smart glasses app?", expected: ["doc:saynext:positioning"] },
  { group: "mobile_disambiguation", q: "What mobile computing course did you take in winter?", expected: ["xiang-update:2026-05:past-courses"] },
  { group: "mobile_disambiguation", q: "What was the parking mobile app about?", expected: ["doc:dalparkaid:overview-problem"] },
  { group: "mobile_disambiguation", q: "How do you improve mobile app performance?", expected: ["knowledge:cs-interview:mobile-apps"] },

  // Same keyword: class / classification / classroom
  { group: "class_disambiguation", q: "What is class imbalance in machine learning?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "class_disambiguation", q: "What class are you taking for deep learning?", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "class_disambiguation", q: "Which class do you like most this term?", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "class_disambiguation", q: "What is a classification metric?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "class_disambiguation", q: "Who teaches your advanced cloud class?", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "class_disambiguation", q: "What is an object class in OOP?", expected: ["knowledge:cs-interview:oop-design-patterns"] },

  // Same keyword: deep learning
  { group: "deep_learning_disambiguation", q: "Why do you personally like deep learning?", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "deep_learning_disambiguation", q: "What is dropout in deep learning?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning_disambiguation", q: "What time is your deep learning class?", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "deep_learning_disambiguation", q: "What is backpropagation?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning_disambiguation", q: "How does deep learning connect with your AI software goal?", expected: ["xiang-update:2026-05:favorite-subjects", "xiang-update:2026-05:future-job"] },

  // Same keyword: project / generic knowledge
  { group: "project_disambiguation", q: "What does product thinking mean for engineers?", expected: ["knowledge:cs-interview:cs-workplace-role"] },
  { group: "project_disambiguation", q: "What project should I use to explain product thinking?", expected: ["doc:saynext:interview-story", "doc:saynext:positioning", "xiang-profile:project-saynext"] },
  { group: "project_disambiguation", q: "Explain API pagination as a backend concept.", expected: ["knowledge:cs-interview:backend-api-design"] },
  { group: "project_disambiguation", q: "Which project had API routes for albums and photos?", expected: ["doc:elderalbum:api-data-model"] },
  { group: "project_disambiguation", q: "What is a design pattern, not my project design?", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "project_disambiguation", q: "What design choices did SayNext go through?", expected: ["doc:saynext:trial-error", "doc:saynext:ui-ux"] },

  // Same keyword: security / privacy
  { group: "security_privacy_disambiguation", q: "What is least privilege in security?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security_privacy_disambiguation", q: "Why is privacy and personal space important to you?", expected: ["xiang-update:2026-05:work-life-balance", "xiang-profile:values-immigration"] },
  { group: "security_privacy_disambiguation", q: "What security problem did ElderAlbum have?", expected: ["doc:elderalbum:security-cost-future"] },
  { group: "security_privacy_disambiguation", q: "What is JWT validation?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security_privacy_disambiguation", q: "What privacy-sensitive place should SayNext avoid saying?", expected: ["xiang-profile:identity-education"] },
  { group: "security_privacy_disambiguation", q: "What does authorization mean?", expected: ["knowledge:cs-interview:security-web-app"] },

  // Same keyword: data / database / personal data
  { group: "data_disambiguation", q: "What data did JobLens store in DynamoDB?", expected: ["doc:joblens:data-storage-security"] },
  { group: "data_disambiguation", q: "What is DynamoDB partition key?", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "data_disambiguation", q: "What courses did you take for data management?", expected: ["xiang-update:2026-05:past-courses"] },
  { group: "data_disambiguation", q: "How do you handle missing data in a dataset?", expected: ["knowledge:cs-interview:ml-fundamentals", "knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "data_disambiguation", q: "What personal data should not be overshared?", expected: ["xiang-profile:identity-education", "xiang-profile:values-immigration"] },
  { group: "data_disambiguation", q: "What is star schema in data warehouse?", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },

  // Daily words that look like technical terms
  { group: "lexical_traps", q: "What food from other countries do you like?", expected: ["xiang-profile:lifestyle-food-health"] },
  { group: "lexical_traps", q: "What is a trie data structure good for?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "lexical_traps", q: "Do you like class or staying home after class?", expected: ["xiang-update:2026-05:sleep-routine", "xiang-profile:personality-social-style"] },
  { group: "lexical_traps", q: "What is class in object oriented programming?", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "lexical_traps", q: "Do you like orange or pineapple?", expected: ["xiang-update:2026-05:fruit"] },
  { group: "lexical_traps", q: "What is Orange the telecom company?", noMemory: true },
  { group: "lexical_traps", q: "Do you swim as exercise?", expected: ["xiang-update:2026-05:swimming"] },
  { group: "lexical_traps", q: "What is thread in operating system?", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "lexical_traps", q: "Do you thread messages online a lot?", noMemory: true },
  { group: "lexical_traps", q: "What is queue in data structure?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "lexical_traps", q: "Do you queue for food often?", noMemory: true },

  // Incomplete / ASR-like confusing queries
  { group: "asr_confusing", q: "lambda cold start project no general", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "asr_confusing", q: "elder album lambda photo store", expected: ["doc:elderalbum:aws-architecture-deployment", "doc:elderalbum:api-data-model"] },
  { group: "asr_confusing", q: "react native project parking", expected: ["doc:dalparkaid:overview-problem", "xiang-profile:project-dal-parking-aid"] },
  { group: "asr_confusing", q: "react native generally mobile", expected: ["knowledge:cs-interview:mobile-apps"] },
  { group: "asr_confusing", q: "deep learning like why", expected: ["xiang-update:2026-05:favorite-subjects"] },
  { group: "asr_confusing", q: "deep learning dropout", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "asr_confusing", q: "class cloud professor", expected: ["xiang-update:2026-05:summer-courses"] },
  { group: "asr_confusing", q: "class imbalance recall precision", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "asr_confusing", q: "privacy work space china overtime", expected: ["xiang-update:2026-05:work-life-balance"] },
  { group: "asr_confusing", q: "security jwt token", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "asr_confusing", q: "game scripting programming interest", expected: ["xiang-profile:game-scripting-music"] },
  { group: "asr_confusing", q: "algorithm game scripting music", expected: ["xiang-profile:game-scripting-music", "knowledge:cs-interview:algorithm-patterns"] },
  { group: "asr_confusing", q: "drive campus parking app", expected: ["xiang-update:2026-05:driving-car", "doc:dalparkaid:overview-problem"] },
  { group: "asr_confusing", q: "parking app weather timetable", expected: ["doc:dalparkaid:prediction-engine"] },
  { group: "asr_confusing", q: "reddit app news meme", expected: ["xiang-update:2026-05:reddit-internet"] },
  { group: "asr_confusing", q: "rest api status code", expected: ["knowledge:cs-interview:networking-web-protocols", "knowledge:cs-interview:backend-api-design"] },

  // Should not retrieve anything strong
  { group: "no_memory_noise", q: "What is the capital city of France?", noMemory: true },
  { group: "no_memory_noise", q: "How do I bake a chocolate cake?", noMemory: true },
  { group: "no_memory_noise", q: "What is the weather tomorrow?", noMemory: true },
  { group: "no_memory_noise", q: "Translate hello into Spanish.", noMemory: true },
  { group: "no_memory_noise", q: "Who won the hockey game yesterday?", noMemory: true },
  { group: "no_memory_noise", q: "What is the best tourist place in Paris?", noMemory: true },
  { group: "no_memory_noise", q: "Tell me a random joke about cats.", noMemory: true },
  { group: "no_memory_noise", q: "What is photosynthesis?", noMemory: true },
  { group: "no_memory_noise", q: "How far is the moon?", noMemory: true },
  { group: "no_memory_noise", q: "What is a good recipe for noodles?", noMemory: true },
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

console.log(`ADVERSARIAL cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length} noMemory=${noMemoryOk}/${noMemoryTotal}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  const noMemory = stat.noMemoryTotal ? ` noMemory=${stat.noMemoryOk}/${stat.noMemoryTotal}` : "";
  console.log(`${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}${noMemory}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
