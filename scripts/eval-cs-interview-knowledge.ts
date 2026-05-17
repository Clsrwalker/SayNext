import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  group: string;
  q: string;
  expected: string[];
};

const cases: EvalCase[] = [
  { group: "framework", q: "How should I structure a technical interview answer?", expected: ["knowledge:cs-interview:answer-framework"] },
  { group: "framework", q: "How do I answer system design questions step by step?", expected: ["knowledge:cs-interview:system-design-fundamentals", "knowledge:cs-interview:answer-framework"] },
  { group: "framework", q: "What should I do before coding in an interview?", expected: ["knowledge:cs-interview:coding-checklist", "knowledge:cs-interview:answer-framework"] },
  { group: "framework", q: "How should I talk about tradeoffs in an interview?", expected: ["knowledge:cs-interview:answer-framework", "knowledge:cs-interview:system-design-fundamentals"] },

  { group: "complexity", q: "Explain Big O notation.", expected: ["knowledge:cs-interview:big-o-complexity"] },
  { group: "complexity", q: "What is O n log n and when does it appear?", expected: ["knowledge:cs-interview:big-o-complexity"] },
  { group: "complexity", q: "Why is nested loop usually O n squared?", expected: ["knowledge:cs-interview:big-o-complexity"] },
  { group: "complexity", q: "How do time complexity and space complexity trade off?", expected: ["knowledge:cs-interview:big-o-complexity"] },

  { group: "data_structures", q: "When should I use a hash map?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "data_structures", q: "What is the difference between array and linked list?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "data_structures", q: "What is a heap used for?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "data_structures", q: "When do I use stack versus queue?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "data_structures", q: "What is a trie good for?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "data_structures", q: "How should I represent a sparse graph?", expected: ["knowledge:cs-interview:data-structures"] },
  { group: "data_structures", q: "Why are hash map lookups average O one?", expected: ["knowledge:cs-interview:data-structures", "knowledge:cs-interview:big-o-complexity"] },
  { group: "data_structures", q: "Which data structure helps with top k elements?", expected: ["knowledge:cs-interview:data-structures", "knowledge:cs-interview:algorithm-patterns"] },

  { group: "algorithms", q: "When is binary search useful?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "How do I recognize a sliding window problem?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "When should I use BFS instead of DFS?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "How do I explain dynamic programming?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "What is greedy algorithm and what is the risk?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "How does prefix sum help range queries?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "What pattern solves shortest path in an unweighted graph?", expected: ["knowledge:cs-interview:algorithm-patterns"] },
  { group: "algorithms", q: "How should I solve merge k sorted lists?", expected: ["knowledge:cs-interview:algorithm-patterns", "knowledge:cs-interview:data-structures"] },

  { group: "coding", q: "What edge cases should I test in coding interviews?", expected: ["knowledge:cs-interview:coding-checklist"] },
  { group: "coding", q: "How do I walk through examples before coding?", expected: ["knowledge:cs-interview:coding-checklist", "knowledge:cs-interview:answer-framework"] },
  { group: "coding", q: "What should I do after writing code in an interview?", expected: ["knowledge:cs-interview:coding-checklist"] },
  { group: "coding", q: "How do I explain brute force then optimize?", expected: ["knowledge:cs-interview:coding-checklist", "knowledge:cs-interview:answer-framework"] },

  { group: "oop", q: "Explain SOLID principles.", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "oop", q: "What is dependency injection?", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "oop", q: "When is composition better than inheritance?", expected: ["knowledge:cs-interview:oop-design-patterns"] },
  { group: "oop", q: "What is the strategy pattern?", expected: ["knowledge:cs-interview:oop-design-patterns"] },

  { group: "testing", q: "What is the difference between unit test and integration test?", expected: ["knowledge:cs-interview:software-engineering-testing"] },
  { group: "testing", q: "How do you debug a production bug?", expected: ["knowledge:cs-interview:software-engineering-testing", "knowledge:cs-interview:sre-observability"] },
  { group: "testing", q: "What is regression testing?", expected: ["knowledge:cs-interview:software-engineering-testing"] },
  { group: "testing", q: "When should I use mocks in tests?", expected: ["knowledge:cs-interview:software-engineering-testing"] },

  { group: "system_design", q: "How would you design a URL shortener?", expected: ["knowledge:cs-interview:system-design-fundamentals"] },
  { group: "system_design", q: "What are non functional requirements?", expected: ["knowledge:cs-interview:system-design-fundamentals"] },
  { group: "system_design", q: "When should I add caching to a system?", expected: ["knowledge:cs-interview:system-design-fundamentals"] },
  { group: "system_design", q: "Why use a queue in system design?", expected: ["knowledge:cs-interview:system-design-fundamentals", "knowledge:cs-interview:distributed-systems"] },
  { group: "system_design", q: "How do I design an API and data model?", expected: ["knowledge:cs-interview:system-design-fundamentals", "knowledge:cs-interview:backend-api-design"] },
  { group: "system_design", q: "What bottlenecks should I discuss in system design?", expected: ["knowledge:cs-interview:system-design-fundamentals"] },
  { group: "system_design", q: "How would you scale reads for a web app?", expected: ["knowledge:cs-interview:system-design-fundamentals", "knowledge:cs-interview:database-sql"] },
  { group: "system_design", q: "Why use CDN for static content?", expected: ["knowledge:cs-interview:system-design-fundamentals", "knowledge:cs-interview:aws-core-services"] },

  { group: "distributed", q: "Explain CAP theorem.", expected: ["knowledge:cs-interview:distributed-systems"] },
  { group: "distributed", q: "What is eventual consistency?", expected: ["knowledge:cs-interview:distributed-systems"] },
  { group: "distributed", q: "Why is idempotency important for retries?", expected: ["knowledge:cs-interview:distributed-systems", "knowledge:cs-interview:backend-api-design"] },
  { group: "distributed", q: "What is exponential backoff and jitter?", expected: ["knowledge:cs-interview:distributed-systems"] },
  { group: "distributed", q: "What is a circuit breaker?", expected: ["knowledge:cs-interview:distributed-systems"] },
  { group: "distributed", q: "How do you handle distributed transaction failure?", expected: ["knowledge:cs-interview:distributed-systems"] },

  { group: "networking", q: "What happens when I type a URL in a browser?", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "networking", q: "Explain DNS.", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "networking", q: "TCP versus UDP.", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "networking", q: "What is HTTPS and TLS?", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "networking", q: "REST versus gRPC.", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "networking", q: "When would you use WebSocket?", expected: ["knowledge:cs-interview:networking-web-protocols"] },
  { group: "networking", q: "What is CORS?", expected: ["knowledge:cs-interview:networking-web-protocols", "knowledge:cs-interview:security-web-app"] },
  { group: "networking", q: "What does HTTP 429 mean?", expected: ["knowledge:cs-interview:networking-web-protocols", "knowledge:cs-interview:backend-api-design"] },

  { group: "database", q: "Explain ACID transactions.", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "database", q: "What is database indexing?", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "database", q: "What is normalization and denormalization?", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "database", q: "How do joins work in SQL?", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "database", q: "How do you optimize a slow query?", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "database", q: "When choose SQL over NoSQL?", expected: ["knowledge:cs-interview:database-sql", "knowledge:cs-interview:nosql-dynamodb"] },
  { group: "database", q: "What is transaction isolation?", expected: ["knowledge:cs-interview:database-sql"] },
  { group: "database", q: "How do you avoid N plus one queries?", expected: ["knowledge:cs-interview:database-sql"] },

  { group: "nosql", q: "How should I design DynamoDB keys?", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "nosql", q: "What is partition key and sort key?", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "nosql", q: "What is a GSI in DynamoDB?", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "nosql", q: "What is hot partition in DynamoDB?", expected: ["knowledge:cs-interview:nosql-dynamodb"] },
  { group: "nosql", q: "Why does DynamoDB design start from access patterns?", expected: ["knowledge:cs-interview:nosql-dynamodb"] },

  { group: "aws", q: "Explain IAM in AWS.", expected: ["knowledge:cs-interview:aws-core-services", "knowledge:cs-interview:security-web-app"] },
  { group: "aws", q: "What is VPC?", expected: ["knowledge:cs-interview:aws-core-services"] },
  { group: "aws", q: "When should I use S3?", expected: ["knowledge:cs-interview:aws-core-services"] },
  { group: "aws", q: "Lambda versus EC2.", expected: ["knowledge:cs-interview:aws-core-services", "knowledge:cs-interview:serverless-lambda"] },
  { group: "aws", q: "What is API Gateway used for?", expected: ["knowledge:cs-interview:aws-core-services", "knowledge:cs-interview:serverless-lambda"] },
  { group: "aws", q: "What is CloudWatch?", expected: ["knowledge:cs-interview:aws-core-services", "knowledge:cs-interview:sre-observability"] },
  { group: "aws", q: "SQS versus SNS versus EventBridge.", expected: ["knowledge:cs-interview:aws-core-services", "knowledge:cs-interview:serverless-lambda"] },
  { group: "aws", q: "What is CloudFront?", expected: ["knowledge:cs-interview:aws-core-services"] },

  { group: "well_architected", q: "What are the AWS Well Architected pillars?", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "well_architected", q: "How do you design reliable AWS architecture?", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "well_architected", q: "How do you think about cost optimization in AWS?", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "well_architected", q: "What does operational excellence mean?", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "well_architected", q: "What does performance efficiency mean in AWS?", expected: ["knowledge:cs-interview:aws-well-architected"] },
  { group: "well_architected", q: "How do you evaluate security in a cloud architecture?", expected: ["knowledge:cs-interview:aws-well-architected", "knowledge:cs-interview:security-web-app"] },

  { group: "serverless", q: "What is serverless?", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "serverless", q: "What is Lambda cold start?", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "serverless", q: "When is serverless a bad fit?", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "serverless", q: "How do SQS and Lambda work together?", expected: ["knowledge:cs-interview:serverless-lambda", "knowledge:cs-interview:aws-core-services"] },
  { group: "serverless", q: "What does Step Functions do?", expected: ["knowledge:cs-interview:serverless-lambda"] },
  { group: "serverless", q: "How do you debug serverless applications?", expected: ["knowledge:cs-interview:serverless-lambda", "knowledge:cs-interview:sre-observability"] },

  { group: "devops", q: "What is CI CD?", expected: ["knowledge:cs-interview:cloud-devops-cicd"] },
  { group: "devops", q: "What is infrastructure as code?", expected: ["knowledge:cs-interview:cloud-devops-cicd"] },
  { group: "devops", q: "Blue green deployment versus canary deployment.", expected: ["knowledge:cs-interview:cloud-devops-cicd"] },
  { group: "devops", q: "How should secrets be managed in deployment?", expected: ["knowledge:cs-interview:cloud-devops-cicd", "knowledge:cs-interview:security-web-app"] },
  { group: "devops", q: "Why is rollback important?", expected: ["knowledge:cs-interview:cloud-devops-cicd", "knowledge:cs-interview:sre-observability"] },

  { group: "security", q: "Authentication versus authorization.", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security", q: "How do you prevent SQL injection?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security", q: "What is XSS?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security", q: "What is CSRF?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security", q: "How should JWT be validated?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security", q: "What is least privilege?", expected: ["knowledge:cs-interview:security-web-app", "knowledge:cs-interview:aws-core-services"] },
  { group: "security", q: "What are OWASP Top 10 risks?", expected: ["knowledge:cs-interview:security-web-app"] },
  { group: "security", q: "How do you store passwords safely?", expected: ["knowledge:cs-interview:security-web-app"] },

  { group: "backend", q: "How do you design REST APIs?", expected: ["knowledge:cs-interview:backend-api-design"] },
  { group: "backend", q: "How do you handle pagination?", expected: ["knowledge:cs-interview:backend-api-design"] },
  { group: "backend", q: "Why use idempotency keys?", expected: ["knowledge:cs-interview:backend-api-design", "knowledge:cs-interview:distributed-systems"] },
  { group: "backend", q: "How do you design API error responses?", expected: ["knowledge:cs-interview:backend-api-design"] },
  { group: "backend", q: "Why add rate limiting?", expected: ["knowledge:cs-interview:backend-api-design", "knowledge:cs-interview:distributed-systems"] },

  { group: "frontend", q: "Explain React props and state.", expected: ["knowledge:cs-interview:frontend-react-web"] },
  { group: "frontend", q: "Why are React keys important?", expected: ["knowledge:cs-interview:frontend-react-web"] },
  { group: "frontend", q: "What is useEffect for?", expected: ["knowledge:cs-interview:frontend-react-web"] },
  { group: "frontend", q: "CSR versus SSR.", expected: ["knowledge:cs-interview:frontend-react-web"] },
  { group: "frontend", q: "How do you improve web performance?", expected: ["knowledge:cs-interview:frontend-react-web"] },
  { group: "frontend", q: "What does frontend accessibility mean?", expected: ["knowledge:cs-interview:frontend-react-web"] },

  { group: "ml", q: "Supervised learning versus unsupervised learning.", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "Explain bias variance tradeoff.", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "What is overfitting and how do you reduce it?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "What is cross validation?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "Precision versus recall.", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "What is F1 score?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "What is data leakage?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "How do you handle class imbalance?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "How do you choose evaluation metrics for ML?", expected: ["knowledge:cs-interview:ml-fundamentals"] },
  { group: "ml", q: "What is regularization in machine learning?", expected: ["knowledge:cs-interview:ml-fundamentals"] },

  { group: "deep_learning", q: "What is backpropagation?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning", q: "What is dropout?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning", q: "What is batch normalization?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning", q: "CNN versus RNN.", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning", q: "What is transformer attention?", expected: ["knowledge:cs-interview:deep-learning"] },
  { group: "deep_learning", q: "What is embedding in neural networks?", expected: ["knowledge:cs-interview:deep-learning"] },

  { group: "recommender", q: "What is collaborative filtering?", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "recommender", q: "Content based recommendation versus collaborative filtering.", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "recommender", q: "What is cold start in recommender systems?", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "recommender", q: "How do you evaluate a recommender system?", expected: ["knowledge:cs-interview:recommender-systems"] },
  { group: "recommender", q: "What is NDCG?", expected: ["knowledge:cs-interview:recommender-systems"] },

  { group: "data_eng", q: "ETL versus ELT.", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "data_eng", q: "What is a data warehouse?", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "data_eng", q: "What is star schema?", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "data_eng", q: "Batch processing versus streaming.", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },
  { group: "data_eng", q: "What data quality checks should a pipeline have?", expected: ["knowledge:cs-interview:data-engineering-warehousing"] },

  { group: "os", q: "Process versus thread.", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "os", q: "Concurrency versus parallelism.", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "os", q: "What is deadlock?", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "os", q: "Mutex versus semaphore.", expected: ["knowledge:cs-interview:os-concurrency"] },
  { group: "os", q: "What is virtual memory?", expected: ["knowledge:cs-interview:os-concurrency"] },

  { group: "sre", q: "Logs versus metrics versus traces.", expected: ["knowledge:cs-interview:sre-observability"] },
  { group: "sre", q: "What are SLI and SLO?", expected: ["knowledge:cs-interview:sre-observability"] },
  { group: "sre", q: "How do you respond to an incident?", expected: ["knowledge:cs-interview:sre-observability"] },
  { group: "sre", q: "What should alerts be based on?", expected: ["knowledge:cs-interview:sre-observability"] },
  { group: "sre", q: "What are RED metrics?", expected: ["knowledge:cs-interview:sre-observability"] },

  { group: "mobile", q: "What should mobile apps consider?", expected: ["knowledge:cs-interview:mobile-apps"] },
  { group: "mobile", q: "What is React Native good for?", expected: ["knowledge:cs-interview:mobile-apps"] },
  { group: "mobile", q: "How do you handle offline state in a mobile app?", expected: ["knowledge:cs-interview:mobile-apps"] },
  { group: "mobile", q: "How do you improve mobile app performance?", expected: ["knowledge:cs-interview:mobile-apps"] },

  { group: "workplace", q: "What does a software engineer do day to day?", expected: ["knowledge:cs-interview:cs-workplace-role"] },
  { group: "workplace", q: "Why is code review important?", expected: ["knowledge:cs-interview:cs-workplace-role"] },
  { group: "workplace", q: "What is agile scrum?", expected: ["knowledge:cs-interview:cs-workplace-role"] },
  { group: "workplace", q: "Why is product thinking important for engineers?", expected: ["knowledge:cs-interview:cs-workplace-role"] },
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

console.log(`CS-KNOWLEDGE cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  console.log(`${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
