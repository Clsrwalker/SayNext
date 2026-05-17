import { conversationLogger, type PersonalMemorySensitivity } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type KnowledgeSeed = {
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  sourceRef: string;
};

const defaultUsage =
  "Use as technical interview knowledge. Keep the spoken answer clear, structured, and practical. Do not claim this is Xiang's personal experience unless the question asks to connect it to his projects.";

const memories: KnowledgeSeed[] = [
  {
    title: "CS interview answer framework",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:answer-framework",
    keywords: ["interview", "framework", "clarify", "tradeoff", "STAR", "technical answer", "problem solving"],
    content: `Strong CS interview answer pattern:
- Clarify the question and constraints first.
- State the simple idea before details.
- Mention trade-offs: time, memory, cost, reliability, security, maintainability.
- For coding: restate input/output, give examples, handle edge cases, explain algorithm, code, test, then complexity.
- For system design: requirements, API, data model, core components, scaling bottlenecks, failure handling, monitoring, cost/security.
- For behavioral: use a short setup, action, result, and what was learned.

Useful phrases:
- "The main trade-off is..."
- "If scale is small, I would start simple. If traffic grows, I would add..."
- "I would first measure the bottleneck instead of guessing."
- "The simple version is..., and the production version needs..."

Avoid:
- Jumping into implementation before clarifying.
- Listing buzzwords without explaining why.
- Pretending everything is production-grade.
- Over-answering when the interviewer asks for a short explanation.`,
    usageRule: defaultUsage,
  },
  {
    title: "Big O and complexity interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:big-o-complexity",
    keywords: ["big o", "time complexity", "space complexity", "algorithm analysis", "complexity"],
    content: `Core Big O answers:
- Big O describes how runtime or memory grows as input size grows.
- O(1): constant, like hash map lookup average case.
- O(log n): repeatedly halves the search space, like binary search.
- O(n): one pass through input.
- O(n log n): common efficient sorting bound, like merge sort.
- O(n^2): nested comparison over pairs.
- O(2^n): explores subsets or binary decisions recursively.

Interview answer:
"Time complexity is about how the algorithm scales. I would not only give the Big O, but also explain what causes it. For example, two nested loops over n items is usually O(n^2), while sorting then scanning is usually O(n log n)."

Common trade-offs:
- Faster lookup often needs extra memory.
- Preprocessing can make repeated queries faster.
- Worst case matters when data can be adversarial.
- Average case is fine only if the assumptions are realistic.`,
    usageRule: defaultUsage,
  },
  {
    title: "Data structures interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:data-structures",
    keywords: ["data structures", "array", "hash map", "tree", "graph", "heap", "queue", "stack", "linked list"],
    content: `Common data structure answers:
- Array/list: fast index access, good cache locality, but insertion in the middle can be O(n).
- Linked list: cheap insert/delete if node is known, but poor random access and cache locality.
- Stack: LIFO, useful for parsing, backtracking, DFS, undo.
- Queue: FIFO, useful for BFS, scheduling, producer/consumer.
- Hash map: average O(1) lookup/insert/delete; worst-case can degrade; depends on hashing and collision handling.
- Set: uniqueness and fast membership check.
- Heap/priority queue: get min/max in O(1), insert/pop in O(log n), good for top-k and scheduling.
- Tree: hierarchical data; BST supports ordered operations if balanced.
- Trie: prefix search and autocomplete; memory heavy.
- Graph: models relationships; adjacency list is common for sparse graphs.

How to choose:
"I choose based on the operation I need most: lookup, ordered traversal, top-k, prefix search, or graph traversal. Then I explain the time and memory trade-off."`,
    usageRule: defaultUsage,
  },
  {
    title: "Algorithm patterns interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:algorithm-patterns",
    keywords: ["algorithm", "binary search", "two pointers", "sliding window", "dfs", "bfs", "dynamic programming", "greedy"],
    content: `Common algorithm patterns:
- Binary search: sorted/searchable monotonic condition. Answer: "I can reduce the search space by half each step."
- Two pointers: sorted arrays, pairs, partitioning, merging.
- Sliding window: contiguous subarray/substring with expanding and shrinking window.
- Prefix sum: range sum queries and subarray sums.
- Hash map counting: frequency, complements, deduplication.
- DFS: explore depth, recursion/backtracking, connected components.
- BFS: shortest path in unweighted graph, level-order traversal.
- Heap: top-k, merge k sorted lists, scheduling.
- Greedy: choose local optimum when exchange argument or invariant supports it.
- Dynamic programming: overlapping subproblems + optimal substructure. Define state, transition, base case, answer.

Interview answer:
"I would first identify the pattern from the constraints. If n is large, O(n^2) may be too slow, so I look for hashing, sorting, binary search, or a linear scan pattern."`,
    usageRule: defaultUsage,
  },
  {
    title: "Coding interview implementation checklist",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:coding-checklist",
    keywords: ["coding interview", "edge cases", "test cases", "debug", "implementation", "code"],
    content: `Coding interview checklist:
1. Repeat the problem in simple words.
2. Ask about input constraints, duplicates, empty input, sorted/unsorted, negative numbers, nulls.
3. Walk through one small example.
4. Start with brute force if useful, then optimize.
5. Explain algorithm before coding.
6. Code clearly with meaningful variable names.
7. Test normal case, edge case, and failure case.
8. State time and space complexity.

Common edge cases:
- Empty input, one element, duplicates.
- Very large input.
- Negative numbers or zero.
- Already sorted / reverse sorted.
- Cycles in graph/list.
- Overflow or precision.

Good short answer:
"I would first solve it with a simple approach to confirm correctness, then optimize based on the constraint. After coding, I would test empty input, duplicate values, and the largest expected case."`,
    usageRule: defaultUsage,
  },
  {
    title: "Object oriented design and design patterns",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:oop-design-patterns",
    keywords: ["oop", "object oriented", "solid", "design pattern", "dependency injection", "encapsulation"],
    content: `OOP and design answer notes:
- Encapsulation: hide internal state behind clear methods.
- Abstraction: expose essential behavior, not implementation details.
- Inheritance: reuse or specialize behavior, but can create tight coupling.
- Composition: often safer than inheritance; build behavior from smaller objects.
- Polymorphism: same interface, different implementations.

SOLID:
- Single responsibility: one reason to change.
- Open/closed: extend without editing stable code.
- Liskov substitution: subclasses should behave like base class.
- Interface segregation: small focused interfaces.
- Dependency inversion: depend on abstractions, not concrete classes.

Common patterns:
- Factory: centralize object creation.
- Strategy: swap algorithms at runtime.
- Observer/pub-sub: event notifications.
- Adapter: make incompatible interfaces work.
- Repository: isolate data access.

Interview answer:
"I try to keep the design simple first. I use patterns when they reduce coupling or make changing behavior easier, not just to make the code look complicated."`,
    usageRule: defaultUsage,
  },
  {
    title: "Software engineering, testing, and debugging",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:software-engineering-testing",
    keywords: ["software engineering", "testing", "debugging", "unit test", "integration test", "e2e", "regression"],
    content: `Testing and debugging answers:
- Unit tests: test small functions/classes in isolation.
- Integration tests: test multiple components together, like API + database.
- End-to-end tests: test user flow through the system.
- Regression tests: prevent a fixed bug from coming back.
- Mocking: useful for external services, but over-mocking can hide integration issues.

Debugging process:
1. Reproduce the issue.
2. Narrow the scope with logs, breakpoints, or experiments.
3. Form a hypothesis.
4. Test one change at a time.
5. Add a test or guard if the bug is important.

Good interview answer:
"I try not to randomly change code. First I reproduce the bug, then isolate whether it is frontend, API, database, or external service. After fixing it, I add a small test or logging so the same issue is easier to catch next time."`,
    usageRule: defaultUsage,
  },
  {
    title: "System design fundamentals",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:system-design-fundamentals",
    keywords: ["system design", "requirements", "api", "database", "cache", "queue", "scaling", "availability"],
    content: `System design answer structure:
1. Clarify functional requirements: what users can do.
2. Clarify non-functional requirements: scale, latency, availability, consistency, security, cost.
3. Define APIs and data model.
4. Draw high-level components: client, API service, database, cache, object storage, queue, workers.
5. Discuss bottlenecks and scaling.
6. Discuss failure handling, monitoring, and security.

Common tools:
- Load balancer for distributing traffic.
- Cache for repeated reads.
- Queue for async work and smoothing spikes.
- CDN for static/global content.
- Object storage for files.
- Database indexes for query speed.
- Replication/backups for reliability.

Good answer:
"I would start simple: one API service, a relational database, and object storage if files are involved. If traffic grows, I would add caching, async queues, read replicas, and better monitoring based on the actual bottleneck."`,
    usageRule: defaultUsage,
  },
  {
    title: "Distributed systems interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:distributed-systems",
    keywords: ["distributed systems", "cap", "consistency", "availability", "partition", "idempotency", "retry", "rate limiting"],
    content: `Distributed systems concepts:
- CAP: during a network partition, a distributed system must trade off consistency and availability.
- Consistency: users see correct/current data.
- Availability: system keeps responding.
- Partition tolerance: network failures happen and must be handled.
- Eventual consistency: replicas converge over time.
- Idempotency: repeating the same request has the same effect; important for retries.
- Retry with exponential backoff and jitter prevents retry storms.
- Rate limiting protects services from abuse or overload.
- Circuit breaker stops repeatedly calling an unhealthy dependency.
- Saga pattern handles multi-step distributed transactions with compensating actions.

Good answer:
"In distributed systems, failure is normal. I would design retries carefully with idempotency keys, add timeouts, monitor errors and latency, and choose consistency based on the business requirement."`,
    usageRule: defaultUsage,
  },
  {
    title: "Networking and web protocols interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:networking-web-protocols",
    keywords: ["networking", "tcp", "udp", "dns", "http", "https", "tls", "cors", "rest", "grpc", "websocket"],
    content: `Networking standard answers:
- DNS maps domain names to IP addresses.
- TCP is connection-oriented and reliable; it handles ordering, retransmission, and congestion control.
- UDP is connectionless and lower overhead; useful for real-time media or cases where some loss is acceptable.
- HTTP is request/response; HTTPS is HTTP over TLS for encryption and server authentication.
- TLS protects data in transit and helps prevent eavesdropping/tampering.
- REST uses resources, HTTP methods, status codes, and stateless requests.
- gRPC uses HTTP/2 and protobuf; good for internal service-to-service APIs.
- WebSocket keeps a persistent full-duplex connection for real-time updates.
- CORS is a browser security mechanism controlling cross-origin requests.

Common HTTP status codes:
- 200 OK, 201 Created, 204 No Content.
- 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 429 Too Many Requests.
- 500 Internal Server Error, 502 Bad Gateway, 503 Unavailable.

Good answer:
"For normal CRUD APIs I would use REST. For real-time bidirectional updates I would consider WebSocket. For internal high-performance service communication, gRPC can be a good option."`,
    usageRule: defaultUsage,
  },
  {
    title: "Database and SQL interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:database-sql",
    keywords: ["database", "sql", "index", "transaction", "acid", "normalization", "join", "isolation", "query optimization"],
    content: `Database/SQL answers:
- SQL databases are strong for structured data, joins, transactions, and consistency.
- ACID: atomicity, consistency, isolation, durability.
- Indexes speed reads but add write overhead and storage cost.
- Composite indexes help when query filters match index order.
- Normalization reduces duplication; denormalization can improve read performance at the cost of consistency complexity.
- Transactions group operations so they succeed or fail together.
- Isolation levels control how concurrent transactions see each other's changes.
- Query optimization: inspect query plan, add proper indexes, avoid N+1 queries, select only needed columns, paginate large results.

Common joins:
- INNER JOIN: matching rows only.
- LEFT JOIN: all rows from left table plus matches.
- RIGHT JOIN: all rows from right table plus matches.
- FULL OUTER JOIN: all rows from both sides.

Good answer:
"I would choose relational DB if the data has clear relationships and needs transactions. If reads are slow, I would check query plans before adding indexes blindly."`,
    usageRule: defaultUsage,
  },
  {
    title: "NoSQL and DynamoDB interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:nosql-dynamodb",
    keywords: ["nosql", "dynamodb", "partition key", "sort key", "gsi", "lsi", "single table", "hot partition"],
    content: `NoSQL/DynamoDB answers:
- NoSQL is useful when access patterns are known and horizontal scaling is important.
- DynamoDB tables use partition keys to distribute data and sort keys to organize related items.
- Good DynamoDB design starts from access patterns, not ER diagrams.
- GSI supports alternative query patterns; it has separate throughput/cost implications.
- LSI uses same partition key but different sort key; must be created with table.
- Hot partition happens when too much traffic hits the same partition key.
- Single-table design can store multiple entity types together, but needs careful key design.
- DynamoDB supports eventually consistent reads by default and strongly consistent reads in supported cases.

Good answer:
"For DynamoDB, I first list the exact queries the app needs. Then I design partition and sort keys around those access patterns. The biggest mistake is treating DynamoDB like a relational database and expecting arbitrary joins."`,
    usageRule: defaultUsage,
  },
  {
    title: "AWS core services interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:aws-core-services",
    keywords: ["aws", "iam", "vpc", "ec2", "s3", "rds", "dynamodb", "lambda", "api gateway", "cloudwatch", "cloudfront"],
    content: `AWS core service quick answers:
- IAM: identities, roles, policies, least privilege.
- VPC: private network boundary with subnets, routing, security groups, NAT, internet gateway.
- EC2: virtual servers; flexible but requires server management.
- S3: durable object storage for files/static assets/backups.
- RDS: managed relational databases.
- DynamoDB: managed NoSQL key-value/document database.
- Lambda: serverless functions triggered by events.
- API Gateway: managed API front door for HTTP APIs and Lambda integrations.
- CloudWatch: logs, metrics, alarms.
- CloudFront: CDN for low-latency global content delivery.
- SQS: queue for decoupling async workers.
- SNS: pub/sub notifications.
- EventBridge: event bus for event-driven architecture.

Good answer:
"I choose AWS services based on control versus management. EC2 gives more control, but Lambda and managed services reduce operations work. For a student project or MVP, serverless can be faster and cheaper if traffic is unpredictable."`,
    usageRule: defaultUsage,
  },
  {
    title: "AWS Well-Architected interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:aws-well-architected",
    keywords: ["aws well architected", "operational excellence", "security", "reliability", "performance efficiency", "cost optimization", "sustainability"],
    content: `AWS Well-Architected Framework pillars:
- Operational excellence: run and improve systems with observability, automation, and safe changes.
- Security: protect data, systems, and assets with IAM, encryption, logging, and least privilege.
- Reliability: recover from failures, test recovery, scale, backup, and design for resilience.
- Performance efficiency: use resources efficiently as demand changes.
- Cost optimization: deliver business value at the lowest reasonable cost.
- Sustainability: reduce resource waste and improve efficiency.

Interview answer:
"I would evaluate an AWS architecture using the six pillars. For example, for reliability I would think about multi-AZ, retries, backups, and monitoring. For cost I would check whether the workload really needs always-on servers or if serverless/on-demand services fit better."

Common trade-off:
More reliability and performance often increase cost and complexity, so the right design depends on business impact and traffic.`,
    usageRule: `${defaultUsage} Based on AWS Well-Architected official pillar concepts.`,
  },
  {
    title: "Serverless and AWS Lambda interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:serverless-lambda",
    keywords: ["serverless", "lambda", "cold start", "api gateway", "s3", "dynamodb", "sqs", "eventbridge", "step functions"],
    content: `Serverless answers:
- Serverless means the cloud provider manages server provisioning/scaling; you still manage code, configuration, security, and costs.
- Lambda is good for event-driven, bursty, short-running tasks.
- Cold start is latency when a new execution environment is initialized.
- API Gateway + Lambda is common for HTTP APIs.
- S3 events can trigger processing for uploaded files.
- DynamoDB pairs well with Lambda for scalable serverless storage.
- SQS decouples producers and consumers; helps retry and smooth traffic spikes.
- Step Functions orchestrate multi-step workflows.

Pros:
- Less server management, automatic scaling, pay-per-use.
Cons:
- Cold starts, runtime limits, debugging complexity, vendor lock-in, distributed tracing challenges.

Good answer:
"Serverless is great when traffic is unpredictable and operations time is limited. But I would watch cold starts, timeouts, IAM permissions, observability, and cost if requests become very high."`,
    usageRule: `${defaultUsage} Based partly on AWS Lambda best-practice themes such as monitoring, security, concurrency, and event-source design.`,
  },
  {
    title: "Cloud deployment, DevOps, and CI/CD interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:cloud-devops-cicd",
    keywords: ["cloud deployment", "devops", "ci cd", "docker", "iac", "terraform", "cloudformation", "monitoring", "rollback"],
    content: `Cloud/DevOps answers:
- CI: automatically build, lint, and test code on changes.
- CD: automatically or safely deploy to environments.
- Docker packages app + dependencies into containers.
- IaC: define infrastructure with code, like Terraform, CloudFormation, or AWS SAM.
- Blue/green deployment: switch traffic between old and new versions.
- Canary deployment: release to small percentage first.
- Rollback: quickly return to last stable version.
- Secrets should use managed secret stores, not hardcoded env files in repo.
- Monitoring should include logs, metrics, traces, alerts, and health checks.

Good answer:
"A basic production pipeline should build, test, and deploy consistently. I would also make rollback easy, keep secrets out of source code, and monitor errors/latency after release."`,
    usageRule: defaultUsage,
  },
  {
    title: "Security interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:security-web-app",
    keywords: ["security", "owasp", "authentication", "authorization", "jwt", "oauth", "xss", "csrf", "sql injection", "encryption"],
    content: `Security answers:
- Authentication verifies who the user is.
- Authorization controls what the user can access.
- Least privilege: give only necessary permissions.
- Hash passwords with strong password hashing algorithms, never store plaintext.
- Encrypt sensitive data in transit with TLS and at rest where needed.
- SQL injection: prevent with parameterized queries.
- XSS: sanitize/escape output, use safe rendering, Content Security Policy when appropriate.
- CSRF: use SameSite cookies, CSRF tokens, and proper auth design.
- Broken access control: always check permissions server-side.
- JWT: signed token with claims; validate signature, expiration, issuer/audience; avoid storing sensitive data in it.
- OAuth/OIDC: delegated authorization and identity layer for login flows.

Good answer:
"Security is not one feature. I would combine authentication, authorization, input validation, least privilege, secure secrets, logging, and dependency updates. For web apps, OWASP Top 10 is a good baseline checklist."`,
    usageRule: `${defaultUsage} Based partly on OWASP Top 10 web security concepts.`,
  },
  {
    title: "Backend API design interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:backend-api-design",
    keywords: ["backend", "api design", "rest", "pagination", "validation", "idempotency", "error handling", "rate limit"],
    content: `Backend/API answers:
- Use clear resource names: /users, /orders, /albums.
- Use HTTP methods correctly: GET, POST, PUT/PATCH, DELETE.
- Validate input on server side.
- Return consistent error format.
- Use pagination for list endpoints.
- Use filtering/sorting carefully with indexes.
- Use idempotency keys for payment or retry-sensitive operations.
- Add rate limiting for abuse and overload protection.
- Version APIs when breaking changes are needed.
- Log request IDs/correlation IDs for debugging.

Good answer:
"A good API is predictable and hard to misuse. I would define clear resources, validate input, use proper status codes, paginate large lists, and make retry-sensitive operations idempotent."`,
    usageRule: defaultUsage,
  },
  {
    title: "Frontend React and web performance interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:frontend-react-web",
    keywords: ["frontend", "react", "state", "props", "hooks", "render", "performance", "accessibility", "csr", "ssr"],
    content: `React/frontend answers:
- Props pass data from parent to child.
- State stores component data that changes over time.
- Hooks like useState/useEffect manage state and side effects.
- Re-render happens when state/props/context changes.
- Keys help React track list items.
- Controlled components store form input in React state.
- Memoization can reduce unnecessary expensive renders, but should not be overused.
- CSR renders mainly in browser; SSR renders initial HTML on server for faster first paint/SEO.
- Accessibility: semantic HTML, labels, keyboard navigation, contrast, ARIA when needed.
- Web performance: code splitting, lazy loading, image optimization, caching, avoid unnecessary renders, measure Core Web Vitals.

Good answer:
"In React, I try to keep state close to where it is used, split components by responsibility, and only optimize after measuring performance issues."`,
    usageRule: defaultUsage,
  },
  {
    title: "Machine learning fundamentals interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:ml-fundamentals",
    keywords: ["machine learning", "supervised", "unsupervised", "overfitting", "regularization", "cross validation", "precision", "recall", "f1", "auc", "decision tree", "random forest", "logistic regression", "p value", "ab testing", "pca", "k-means", "cosine similarity"],
    content: `ML fundamentals:
- Supervised learning: train on labeled data, like classification/regression.
- Unsupervised learning: find structure without labels, like clustering/dimensionality reduction.
- Overfitting: model fits training data too closely and generalizes poorly.
- Reduce overfitting: more data, simpler model, regularization, dropout, early stopping, cross-validation.
- Bias-variance tradeoff: high bias underfits, high variance overfits.
- Cross-validation estimates generalization across different splits.
- Precision: among predicted positives, how many are correct.
- Recall: among actual positives, how many were found.
- F1: harmonic mean of precision and recall.
- ROC-AUC: ranking quality across thresholds.
- Data leakage: training uses information not available at prediction time.
- Train/test split: train on one part of data and evaluate on held-out data.
- Logistic regression: linear model with sigmoid/logistic output for classification.
- Decision tree: recursively splits data by features to reduce impurity.
- Random forest: many decision trees trained with bagging/random feature subsets; reduces variance.
- A/B testing: compare control and treatment groups to measure product impact.
- P-value: probability of observing data at least as extreme if the null hypothesis were true.
- PCA: dimensionality reduction by projecting data onto directions of maximum variance.
- K-means: clustering algorithm that assigns points to nearest centroid and updates centroids.
- Cosine similarity: measures angle similarity between vectors; common for embeddings and retrieval.

Good answer:
"I would choose the metric based on the cost of mistakes. If false positives are costly, precision matters more. If missing positives is costly, recall matters more."`,
    usageRule: defaultUsage,
  },
  {
    title: "Deep learning interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:deep-learning",
    keywords: ["deep learning", "neural network", "backpropagation", "optimizer", "dropout", "batch normalization", "cnn", "rnn", "transformer", "embedding"],
    content: `Deep learning answers:
- Neural network: layers of weighted transformations and nonlinear activations.
- Backpropagation computes gradients of loss with respect to parameters.
- Optimizers like SGD/Adam update weights using gradients.
- Activation functions add nonlinearity.
- Dropout reduces overfitting by randomly disabling units during training.
- Batch normalization stabilizes and speeds training by normalizing activations.
- CNNs are strong for spatial/image patterns.
- RNN/LSTM handle sequences but can be harder to parallelize.
- Transformers use attention to model relationships between tokens and parallelize better.
- Embeddings represent discrete items like words/users/items as dense vectors.
- Vanishing gradients make early layers learn slowly in deep networks.

Good answer:
"Deep learning is powerful when there is enough data and the pattern is complex. But I would still compare it with simpler models, because simpler models are easier to debug and may be enough."`,
    usageRule: defaultUsage,
  },
  {
    title: "Recommender systems interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:recommender-systems",
    keywords: ["recommender systems", "collaborative filtering", "content based", "hybrid", "cold start", "ranking", "precision at k", "ndcg"],
    content: `Recommender systems answers:
- Collaborative filtering: recommend based on user-item interaction patterns.
- Content-based: recommend similar items based on item/user features.
- Hybrid: combine collaborative and content signals.
- Cold start: hard to recommend for new users/items with little interaction data.
- Popularity baseline is simple but can be biased toward already popular items.
- Matrix factorization learns latent user/item vectors.
- Embedding-based retrieval can find candidate items.
- Ranking model orders candidates by predicted relevance.
- Evaluation metrics: precision@k, recall@k, MAP, NDCG, CTR, conversion, retention.
- Offline metrics are not enough; A/B testing is often needed for product impact.

Good answer:
"I would start with a simple baseline like popularity or content similarity, then add collaborative filtering if enough interaction data exists. For evaluation, I would use ranking metrics offline and validate with A/B testing if possible."`,
    usageRule: defaultUsage,
  },
  {
    title: "Data engineering and warehousing interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:data-engineering-warehousing",
    keywords: ["data engineering", "etl", "elt", "data warehouse", "star schema", "fact table", "dimension table", "batch", "streaming"],
    content: `Data engineering answers:
- ETL: extract, transform, load.
- ELT: extract, load, transform inside the warehouse.
- Data warehouse: optimized for analytics, reporting, historical queries.
- OLTP: transactional system for app operations.
- OLAP: analytical queries over large datasets.
- Star schema: fact table for events/measures, dimension tables for descriptive attributes.
- Batch processing: periodic large jobs.
- Streaming: continuous event processing with lower latency.
- Data quality checks: completeness, uniqueness, validity, freshness, schema consistency.
- Slowly changing dimensions track changes in dimension attributes over time.

Good answer:
"For analytics, I would separate operational data from analytical workloads. I would design clean ETL/ELT, validate data quality, and use a schema like star schema if the reporting queries fit it."`,
    usageRule: defaultUsage,
  },
  {
    title: "Operating systems and concurrency interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:os-concurrency",
    keywords: ["operating system", "process", "thread", "concurrency", "deadlock", "mutex", "semaphore", "memory", "virtual memory"],
    content: `OS/concurrency answers:
- Process: isolated execution unit with its own memory space.
- Thread: lighter execution unit inside a process sharing memory.
- Concurrency: tasks make progress during overlapping time.
- Parallelism: tasks literally run at the same time on multiple cores.
- Mutex: lock for exclusive access.
- Semaphore: controls access to limited resources.
- Race condition: output depends on timing of concurrent operations.
- Deadlock: tasks wait forever for each other's resources.
- Deadlock conditions: mutual exclusion, hold and wait, no preemption, circular wait.
- Virtual memory gives each process an abstraction of large isolated memory.
- Paging maps virtual pages to physical frames.

Good answer:
"For concurrency bugs, I would identify shared mutable state first. Then I would use locks or message passing carefully, keep critical sections small, and test under concurrent load."`,
    usageRule: defaultUsage,
  },
  {
    title: "SRE observability and incident response interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:sre-observability",
    keywords: ["sre", "observability", "logs", "metrics", "traces", "sli", "slo", "incident", "alert", "rollback"],
    content: `SRE/observability answers:
- Logs: detailed event records for debugging.
- Metrics: numeric time-series like latency, error rate, CPU, memory.
- Traces: follow one request across services.
- RED metrics: rate, errors, duration.
- USE metrics: utilization, saturation, errors.
- SLI: service level indicator, measured reliability signal.
- SLO: target level for that signal.
- Alert should indicate user impact or imminent risk, not just noise.
- Incident response: detect, mitigate, communicate, root cause, postmortem, prevention.
- Rollback is often safer than debugging in production.

Good answer:
"I would monitor latency, error rate, throughput, and resource usage. During an incident, I would first restore service, then analyze root cause and add prevention after the system is stable."`,
    usageRule: defaultUsage,
  },
  {
    title: "Mobile app interview answers",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:mobile-apps",
    keywords: ["mobile app", "react native", "offline", "push notification", "permissions", "battery", "performance"],
    content: `Mobile app answers:
- Mobile apps must consider network instability, offline state, permissions, battery, performance, and small screens.
- React Native enables shared JavaScript/TypeScript code across iOS/Android, but native modules may still be needed.
- Offline support needs local storage, sync strategy, and conflict handling.
- Push notifications require careful permission timing and relevance.
- Performance: avoid unnecessary renders, large bundles, heavy work on UI thread, oversized images.
- Security: do not store sensitive tokens insecurely, use HTTPS, validate server-side, avoid leaking secrets in app bundle.

Good answer:
"For mobile, I care about real user conditions: bad network, small screen, permissions, and battery. I would keep the UI responsive, cache what makes sense, and handle offline or failed requests gracefully."`,
    usageRule: defaultUsage,
  },
  {
    title: "CS workplace and software engineering role knowledge",
    category: "knowledge_cs_interview",
    sensitivity: "low",
    sourceRef: "knowledge:cs-interview:cs-workplace-role",
    keywords: ["cs job", "software engineer", "agile", "scrum", "code review", "requirements", "product", "teamwork"],
    content: `Software engineering job knowledge:
- Typical work includes understanding requirements, designing solutions, coding, testing, reviewing, deploying, debugging, and maintaining features.
- Code review improves correctness, readability, maintainability, and knowledge sharing.
- Agile/scrum often uses sprints, tickets, backlog, standups, sprint planning, reviews, and retrospectives.
- Good engineers communicate trade-offs, ask clarifying questions, and make small safe changes.
- Product thinking matters: a technically impressive solution is not useful if it does not solve the user problem.
- Documentation helps onboarding and long-term maintenance.

Good answer:
"Software engineering is not just writing code. A lot of the work is understanding the problem, making trade-offs, testing, reviewing, deploying safely, and communicating with the team."`,
    usageRule: defaultUsage,
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
    source: "knowledge",
    sourceRef: memory.sourceRef,
    upsertBySource: true,
  });

  if (result) {
    count += 1;
    console.log(`${result.id}: ${result.title} [${result.category}]`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Upserted ${count} CS interview knowledge memories for ${userId}.`);
