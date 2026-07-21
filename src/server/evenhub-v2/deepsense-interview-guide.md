# DeepSense Full-Stack AI Developer Co-op 面试回答指南

这不是逐字背诵稿。每个英文答案都是一种自然说法，真正练习时只记住关键词和逻辑，再用自己的话说。

## 1. 先看岗位真正要什么

这个岗位不是只找一个会调用 LLM API 的人。面试官主要在确认五件事：

1. 你能不能把 chatbot 从前端、API、检索、LLM 一直做到部署。
2. 你是否理解 RAG、document matching/ranking，而不是只会 prompt。
3. 你能否让 agent 安全地读取或修改内部项目数据。
4. 你是否会测试、监控、分析错误，并根据真实使用情况迭代。
5. 作为四个月的 co-op，你能否快速进入现有系统，写清楚代码和文档，并与其他团队合作。

你最应该反复使用的真实证据：

- SayNext：实时对话辅助、Context Router、DistilBERT、何时应该生成 cue。
- Hybrid Search Memory Assistant：BM25、embeddings、RAG、个人记忆检索、ranking、减少无关 context。
- AI Meeting Bot：React/TypeScript、多个 Python/Node 服务、transcription、summary、agenda、report、异步任务和服务集成。
- AWS：Lambda、API Gateway、DynamoDB、S3、CloudWatch、SQS；也接触过 ECS/Fargate、ECR 和基础设施配置。
- 产品评测：不是只看 accuracy；根据产品代价使用 `3 × FN + FP`，并使用独立 shadow set。

需要诚实保留的边界：

- 如果没有真正用 LangChain、LlamaIndex 或 LangGraph 做过完整项目，不要说成 production experience。
- 不要说可以“prevent all hallucinations”。只能 reduce、detect、abstain 和 monitor。
- 不要把所有 AWS 服务都说成用在 CueFlow 里。可以说它们是你在不同 cloud projects 中使用或实践过的。
- critical feedback 和 team disagreement 必须使用真实发生过的事情。本指南不会替你编一个同事或冲突。

## 2. 怎样回答得自然，而不是像在念稿

### 2.1 四种问题，四种回答方式

**个人问题：现在 → 最近在做什么 → 为什么与岗位有关。**

通常 30–50 秒。不要从出生、搬家或完整教育经历讲起。

**定义问题：普通话解释 → 一个例子 → 一个限制。**

例如 RAG：先搜索资料，再让模型基于资料回答；适合动态或私有信息；但检索错误时生成也会出错。

**系统设计问题：先说明假设 → 给主流程 → 加可靠性和评测。**

不要一开口列十个 AWS 服务。先说：

> I’d first clarify who the users are and what data the bot is allowed to access. Then I’d build the simplest grounded question-answering flow...

**经历问题：问题 → 你做了什么 → 结果 → 你后来改变了什么。**

不需要把 STAR 四个字说出来，也不要用 “This experience taught me the importance of...” 这种书面结尾。更自然的说法是：

> The main thing I changed afterward was...

### 2.2 现场可以自然使用的开头

- “The way I’d approach it is...”
- “A simple way to think about it is...”
- “In my project, the main issue was...”
- “I haven’t used that exact tool heavily, but I have built the same kind of workflow...”
- “I’d probably start simple...”
- “The trade-off there is...”
- “The first thing I’d check is...”

这些词可以用，但不要每题都用：`basically`、`honestly`、`for example`、`so`。自然不等于每句话都塞 filler。

### 2.3 不要背完整句子

例如 “Why this role?” 只记四个点：

`Professor Lu sent it → chatbot problems felt familiar → SayNext/Meeting Bot → interested in project, not only co-op`

每次练习都换一点说法。如果每次标点、停顿和单词完全一样，现场更容易因为忘记一个词而卡住。

### 2.4 少用这些“申请模板词”

尽量不要说：

- “I’m passionate about leveraging cutting-edge AI...”
- “My diverse skill set perfectly aligns with this role.”
- “I thrive in fast-paced environments.”
- “I built a robust and scalable solution.”
- “This experience taught me the importance of teamwork.”

不是因为这些句子一定错误，而是它们没有提供证据，而且很像所有申请人都能复制的模板。换成具体说法：`what I built`、`what failed`、`what I changed`、`what result I saw`。

---

# A. 个人与岗位匹配

## Tell me a little about yourself.

面试官要的不是完整简历，而是你现在是谁、最近在做什么、为什么坐在这里。

> Yeah, sure. I’m Xiang. I’m doing my MACS at Dal right now, and I did my BCS at Acadia. I’m still finishing my summer courses, and outside school I spend a lot of time building my own AI apps. When Professor Lu sent me this role, I read it and honestly thought, wow, this is very close to the kind of work I’ve already been doing. I’ve built SayNext, CueFlow, and an AI meeting bot, all around understanding context and giving people useful help at the right time. So I was excited about the actual project, not just the co-op position.

如果 Professor Lu 本人在场，把 `When Professor Lu sent me this role` 改成 `When you sent me the role`。

## Can you walk me through your background?

这题比自我介绍稍长，但仍然不需要按年份念简历。

> I did my BCS at Acadia, and now I’m in the MACS program at Dal. I started mainly with full-stack development, because I liked being able to take an idea and build the whole product. More recently, most of my projects have moved toward conversational AI. I built an AI meeting bot, then worked on hybrid-search memory, and now SayNext focuses on real-time conversation assistance. So my background has gradually become a mix of full-stack work, cloud, retrieval, and machine learning.

## What have you been working on recently?

主讲 Context Router，不要一次倒出全部指标。

> Recently, I’ve been improving SayNext. It gives people useful cues during a live conversation, but the difficult part is knowing when a cue is actually needed. I built a Context Router that looks at the recent transcript and makes that decision before the system calls the LLM. I first tried rules and TF-IDF, then fine-tuned DistilBERT and improved the data based on its mistakes. The newer version reached about 91% validation accuracy while keeping recall around 96%.

对方追问结果时再补：false positives 从 22 降到 8；独立 shadow set 为 90% accuracy、98% recall。

## Why are you interested in this Full-Stack AI Developer role?

> The role combines several problems I already enjoy working on: chatbots, retrieval, document ranking, internal tools, and actually shipping the full application. When I read the description, it didn’t feel like a random co-op that happened to mention AI. It felt very close to the projects I’ve chosen to build on my own, so I’m genuinely interested in the work itself.

## Why do you want to work with DeepSense?

DeepSense 官方定位不是普通软件公司，而是把学生、技术团队和行业伙伴放在一起，交付解决真实业务问题的 applied AI systems。回答要抓住这一点，不要只说 reputation 或 learning opportunity。

> What I like about DeepSense is that the projects are tied to real problems and real users. The goal isn’t just to make an AI demo; the team scopes a problem with a partner, builds a working solution, and delivers it with documentation. That’s the environment I’m looking for, because I want to learn how an experienced team makes technical trade-offs while still having ownership of something that will actually be used.

来源：[DeepSense 官方介绍](https://deepsense.ca/)说明其与企业、政府和研究人员共同 scope、build、deliver applied AI solutions，并由技术团队和项目管理人员支持实习生完成交付；其[学生项目页面](https://deepsense.ca/students/)也强调真实项目和团队支持。

## What interests you about building applied AI products?

> I like the gap between a model being technically capable and a product actually being useful. With SayNext, generating some text was easy. The harder questions were when to generate it, what context to retrieve, how much delay was acceptable, and whether the cue would interrupt the user. That combination of ML, software engineering, and product decisions is what makes applied AI interesting to me.

## Why did you choose computer science?

这题需要像你自己的原因。下面这版不编童年故事，也不故意煽情。

> I liked that computer science let me turn an idea into something I could actually test and use. At first, I was mostly interested in building applications. Later, AI made it more interesting because the behaviour isn’t completely predictable, so you have to think about data, evaluation, and the user experience, not only whether the code runs.

## What kind of role are you looking for right now?

> I’m looking for a hands-on role where I can work across the product instead of only one isolated part. I’d like to build AI features, connect them to real data and APIs, and then see how users respond. I also want a team where I can get technical feedback, because I’ve built a lot independently and I want to learn how these decisions are handled in a production environment.

## What do you hope to learn during this co-op?

> I want to learn how a real team evaluates and operates RAG and agent systems after deployment. I’ve built retrieval, LLM, and cloud workflows myself, but I’d like more experience with production data, permissions, monitoring, and making changes without breaking existing users. I’d also like to improve how I document technical decisions for other developers.

## Why do you think your experience fits this position?

> I think the overlap is quite direct. I’ve built conversational AI systems, worked on hybrid retrieval and ranking, connected several frontend and backend services, and deployed cloud applications. I’ve also trained a classifier specifically to improve when an AI assistant should respond. I won’t know your existing codebase on day one, but the main problems in the role are problems I’ve already spent a lot of time thinking about.

---

# B. Chatbot 与 RAG

## How would you design a chatbot that answers questions from our website?

先问两个范围问题：网站是公开内容还是还包括内部资料？答案是否必须带引用？然后给简单主线。

> I’d start by crawling or importing the approved website pages and keeping the page title, URL, headings, and update time. I’d clean the content, split it into meaningful chunks, create embeddings, and store both the text and metadata in a searchable index. For each question, I’d use hybrid retrieval, select the strongest passages, and ask the model to answer only from those passages with links back to the source. If the evidence isn’t strong enough, the bot should say it couldn’t find the answer instead of guessing. I’d also build a small evaluation set from real website questions before deciding that it works well.

如果继续追问架构，再补 ingestion job、versioning、access control、cache、monitoring，不要第一轮全说完。

## What is retrieval-augmented generation?

> A simple way to think about RAG is that the model doesn’t answer only from what it learned during training. We first search our own documents for information related to the question, put the best passages into the prompt, and then ask the model to answer from that evidence. It’s useful for private or frequently changing information, and it can also give the user sources.

## Why would you use RAG instead of fine-tuning?

> I’d use RAG when the main problem is giving the model current or private knowledge. Documents can be updated or removed without retraining the model, and the answer can point back to the source. Fine-tuning is more useful when I want to change behaviour, format, style, or teach a repeated task. They can also be used together, but I wouldn’t fine-tune just to make the model memorize documents that change often.

## Can you explain a typical RAG pipeline?

> There are really two sides. Offline, I ingest the documents, clean them, split them into chunks, create embeddings, and save the chunks with their metadata. Online, I take the user’s question, retrieve candidate chunks, rerank or filter them, build a grounded prompt, generate the answer, and return the answer with sources. Then I log retrieval and answer quality so the pipeline can be improved.

记忆顺序：`ingest → clean → chunk → embed/index → retrieve → rerank → prompt → answer/cite → evaluate`。

## How would you split documents into chunks?

> I wouldn’t start with one fixed number for every document. I’d try to preserve meaning by splitting around headings, paragraphs, sections, or complete list items. The chunks need to be small enough for precise retrieval but large enough to contain the answer. I might start with a few hundred tokens and a small overlap, then test it on real questions. For tables, code, or very short FAQ pages, I’d use a structure-specific strategy instead of the same splitter.

关键不是背 `500 tokens, 50 overlap`，而是说明 chunk size 必须通过 retrieval evaluation 决定。

## How would you choose an embedding model?

> I’d choose it using our own retrieval examples, not only a public leaderboard. I’d compare whether it handles the document language and domain well, then look at retrieval quality, latency, cost, vector size, and privacy requirements. I’d start with a strong general model as a baseline and only move to a domain-specific model if the evaluation shows a real gain.

## How would you retrieve relevant context for a user question?

> I’d normally use both semantic and lexical retrieval. Embeddings help when the wording is different but the meaning is similar, while BM25 is strong for exact names, IDs, and technical terms. I’d retrieve a wider candidate set, apply metadata and permission filters, combine the rankings, and then rerank the best candidates before sending only a few useful chunks to the LLM.

这可以马上连接自己的项目：

> That’s similar to my memory assistant, where I used BM25 and embeddings together because personal facts often contain both exact names and paraphrased meaning.

## How would you prevent a chatbot from making up information?

不要承诺完全阻止。

> I don’t think hallucination can be completely prevented, but I can reduce it and make failures safer. I’d give the model only trusted retrieved context, explicitly require support from that context, return citations, and define a clear “I don’t know” path when evidence is weak. I’d also validate important structured fields and test the system on unanswerable and conflicting-document cases, not only easy questions.

## What would you do when the retrieved documents do not contain the answer?

> The bot should be honest about that. I’d have it say that it couldn’t find the answer in the available sources, possibly show what it did find, and offer a useful next step such as rephrasing the question or contacting the correct team. For an internal tool, it could also record the unanswered question so we can identify missing documentation.

## How would you keep chatbot answers up to date when documents change?

> I’d make document ingestion incremental. Each source would have a stable document ID, version or content hash, and updated time. When content changes, a background job would reprocess only the affected chunks, replace the old vectors, and invalidate related caches. I’d also handle deletion, because leaving old embeddings in the index is an easy way to return outdated answers.

---

# C. 文档检索与排序

## How would you build a document matching tool?

先明确“matching”是什么：query 对 document、document 对 team，还是 document 去重。然后再设计。

> First I’d clarify what a good match means for the workflow and collect examples of correct and incorrect matches. As a baseline, I’d index the document text and metadata with BM25 and embeddings. For a new query or document, I’d retrieve candidates with both methods, apply filters such as document type or team, and rerank the top candidates. The output should include a score and a reason or matched passage so the user can understand why it was suggested. I’d evaluate it with a labelled set before adding a more complex model.

## What is the difference between keyword search and semantic search?

> Keyword search looks for matching terms and usually does very well with names, product codes, and exact phrases. Semantic search compares meaning through embeddings, so it can match something like “reset my password” with a document called “account recovery.” Keyword search is more exact and explainable; semantic search handles paraphrases better. In practice, I usually want both.

## What is cosine similarity?

> Cosine similarity measures the angle between two vectors. The formula is the dot product divided by the product of their lengths: `a · b / (||a|| ||b||)`. If two embedding vectors point in a similar direction, the score is closer to one, which usually means the texts are semantically related. It compares direction rather than raw vector size.

## How would you combine lexical and vector search?

> I’d retrieve candidates from BM25 and vector search separately, then combine their rankings. Reciprocal Rank Fusion is a good simple baseline because the two systems may produce scores on completely different scales. If we have enough labelled data, I could learn or tune the weights and add a reranker on the merged candidates.

## What is hybrid search?

> Hybrid search combines lexical search and semantic vector search. It gives us exact matching for things like names and IDs, while still finding documents that express the same idea with different wording. My memory assistant used this approach because relying on only one side caused obvious misses.

## How would you rank several retrieved documents?

> I’d first retrieve a reasonably broad candidate set, then rank it using signals such as BM25 score, vector similarity, metadata match, document freshness, and access rules. For the top candidates, I might use a cross-encoder reranker because it reads the query and passage together and is usually more precise than embedding similarity alone. I’d tune the final ranking against labelled queries instead of choosing weights by intuition.

## What metadata would you store with document embeddings?

> I’d keep a stable document ID, source and URL or path, title, section heading, chunk position, document type, version, updated time, content hash, and any tags used for filtering. For internal documents, access-control metadata is essential. I’d also keep enough information to trace an answer back to the exact source and safely delete or replace old chunks.

## How would you evaluate whether document retrieval is accurate?

> I’d build a set of realistic queries with labelled relevant documents or chunks. Recall at K tells me whether the correct evidence appears in the candidate set, while MRR or NDCG tells me whether it is ranked near the top. I’d also track no-result cases, latency, and performance by query type. For RAG, I’d evaluate retrieval separately from generation so I know which part actually failed.

## How would you handle duplicate or outdated documents?

> I’d use a content hash and a canonical document ID to detect exact duplicates, and similarity checks for near-duplicates. Versions should be connected to the same canonical document, with only the active version searchable by default. When a document is replaced or deleted, its old chunks need to be removed from the vector and lexical indexes as well.

## What would you do if the correct document is consistently ranked too low?

> I’d inspect the pipeline rather than immediately changing the model. I’d check whether the document was parsed and chunked correctly, whether filters are excluding it, and how it scores in BM25 and vector search separately. Then I could improve synonyms or query expansion, adjust fusion, add a reranker, or add hard examples. The fix depends on whether the failure comes from indexing, retrieval, or ranking.

你可以连接真实 bug：SayNext 的正确资料曾经因为同一项目存在多个 identity 而无法稳定进入 top results；最后不是换 embedding model，而是先修 canonical identity 和 evaluation oracle。

---

# D. LLM 与 Prompt Engineering

## What experience do you have working with LLM APIs?

> I’ve mainly used OpenAI APIs in SayNext, CueFlow, and the AI meeting bot. I’ve used them for cue generation, structured classification, meeting summaries, and extracting information such as decisions or action items. Most of my work hasn’t been just sending one prompt; I’ve had to decide what context to retrieve, when to call the model, how to validate the response, and how to handle latency and failures.

## How do you write a reliable prompt?

> I start by making the task and the allowed evidence very clear. Then I define the expected output, important constraints, and what the model should do when information is missing. If the format matters, I use a schema and a few representative examples. After that, reliability comes from testing the prompt against difficult cases, not from making the prompt longer and longer.

## How would you make an LLM return structured JSON?

> If the provider supports structured outputs or tool calling, I’d give it a JSON Schema rather than only saying “return JSON.” I’d keep the schema small, mark required fields, and constrain enums where possible. On the server, I’d still parse and validate the response with something like Pydantic, because model output should be treated as untrusted input.

## How would you validate an LLM’s output?

> I’d validate both structure and meaning. Structure can be checked with Pydantic or a JSON Schema. Then I’d check semantic rules, such as whether an ID exists, whether a cited source was actually retrieved, or whether a requested action is allowed. If validation fails, I can retry once with the error or fall back safely, but I wouldn’t pass invalid output directly into another system.

## How would you handle malformed model responses?

> First I’d try to avoid them with structured output. If parsing still fails, I’d log the response safely, retry with a short validation error, and cap the retry count. If it still fails, the API should return a controlled error or fallback instead of guessing. For agent actions, malformed output should never trigger a tool call.

## How would you reduce LLM latency?

> I’d first measure where the time is going. Common improvements are retrieving fewer and better chunks, shortening repeated prompt content, using a smaller model for simple tasks, streaming the answer, and running independent work in parallel. In SayNext, the Context Router also avoids calling the LLM at all when the user doesn’t need a cue, which improves both latency and the experience.

## How would you reduce the cost of an LLM application?

> I’d avoid unnecessary calls, retrieve only the context needed for the question, cache safe repeated results, and route simple tasks to a smaller model. Long histories can be summarized instead of resent in full. I’d also log token use by feature, because otherwise it’s easy to optimize something that isn’t actually causing the cost.

连接项目：Hybrid Search Memory Assistant 的目的之一，就是不把整个历史记录塞给 LLM，只找当前需要的 memories、notes 和 transcript context。

## How would you select a model for a production chatbot?

> I’d create an evaluation set based on the chatbot’s real tasks and compare models on answer quality, grounding, structured-output reliability, latency, and cost. I’d also consider context length, privacy requirements, rate limits, and provider stability. I wouldn’t choose only from a general benchmark, because the best reasoning model may not be the best choice for a fast FAQ chatbot.

## What are the trade-offs between a small model and a larger model?

> A smaller model is usually faster and cheaper, and it can be enough for routing, extraction, or simple grounded answers. A larger model is generally better when the question is ambiguous or requires more reasoning, but it adds latency and cost. I’d often route between them rather than use the largest model for every request.

## How would you test prompts without relying only on your own judgment?

> I’d keep a versioned set of realistic inputs with expected behaviours, including edge cases and questions the system should refuse or abstain from. Every prompt change would run against that set. I’d combine automated checks, such as valid JSON and citation support, with human review on a sample. After deployment, user feedback and failure logs would become new regression cases.

---

# E. Agent 与内部工具

## What does an AI agent mean to you?

> To me, an agent is an LLM-based system that can choose and use tools to make progress toward a goal, while keeping track of the workflow state. The important part isn’t making it fully autonomous. It’s giving it a controlled set of actions, clear boundaries, and a way to verify what happened.

## How is an agent different from a normal chatbot?

> A normal chatbot mainly produces a response. An agent can also take actions, such as reading a project record, creating a task, or updating a status through an API. That makes it more useful, but also riskier, so permissions, confirmation, idempotency, and audit logs matter much more.

## How would you let a chatbot retrieve project and task information?

> I’d put a small service layer between the model and the project-management platform. The model would call clearly defined read tools such as `get_project`, `list_tasks`, or `search_updates`, using the current user’s identity and permissions. The service would validate the arguments, fetch the data, normalize it into a compact schema, and return it to the model with source IDs. I’d start with read-only access before adding write actions.

## How would you safely let an agent call internal APIs?

> I’d expose only allow-listed operations with typed inputs instead of letting the model create arbitrary HTTP requests. Each tool call would use least-privilege credentials, validate authorization and arguments, enforce rate limits, and log the result. Sensitive write actions would have a preview and confirmation step.

## How would you prevent an agent from performing the wrong action?

> I’d separate planning from execution and keep the action surface small. The server, not the model, must enforce permissions and business rules. Write operations should be idempotent, important state should be checked again before execution, and high-impact actions should require confirmation. If the request is ambiguous, the agent should ask instead of choosing silently.

## When should an AI system ask the user for confirmation?

> It should ask before an action that changes or deletes data, communicates externally, changes permissions, creates a cost, or is difficult to reverse. It should also ask when there are multiple plausible targets, such as two projects with similar names. Simple read-only searches normally don’t need confirmation.

## How would you handle a multi-step agent workflow?

> I’d represent it as explicit states rather than one long prompt. For example: understand the request, retrieve the project, prepare a proposed change, ask for confirmation, execute, and verify. I’d persist the state after important steps, put a limit on the number of tool calls, and make each write idempotent so the workflow can safely resume after a failure.

## What would you log when an agent uses a tool?

> I’d log the request and session ID, model and prompt version, selected tool, sanitized arguments, permission decision, result status, latency, state transition, and whether the user confirmed it. I would not log secrets or unnecessary private document content. The goal is to reconstruct what happened without creating another data-leak risk.

## How would you recover when one step in an agent workflow fails?

> I’d classify the failure first. A temporary network or rate-limit failure can be retried with backoff, while invalid input should go back for correction. The workflow should resume from a saved checkpoint instead of repeating completed actions. If a partial write happened, I’d verify the external state and either compensate safely or hand it to a person rather than blindly retrying.

## Have you worked with LangChain, LlamaIndex, LangGraph, or similar tools?

如果没有深入使用，最好的答案就是准确说明相邻经验：

> I’m familiar with what those frameworks are designed to handle, but I haven’t used them heavily in a production project yet. In my own projects, I built the main pieces directly: retrieval, prompt construction, structured model outputs, routing, tool-like API calls, and workflow state. So the concepts are familiar, and I’d be comfortable learning the framework your codebase already uses. I also wouldn’t add a framework automatically if a small explicit workflow is easier to maintain.

不要只回答 “No, but I can learn quickly.” 上面这版既诚实，也说明你不是没做过相关系统。

---

# F. Python、API 与后端

## How comfortable are you with Python?

> I’m comfortable using Python for backend APIs, data processing, ML training, and LLM workflows. I’ve used it with FastAPI and Flask, and I used PyTorch and Transformers for the SayNext classifier. I still check documentation when I’m working with a new library, but I’m comfortable debugging and building a complete feature in Python.

## Tell me about an API you have built.

> In the AI meeting bot, I worked with APIs that accepted transcription jobs and exposed their status and results. A client could submit the work, receive a job ID, and then check whether it was queued, running, or ready instead of holding one request open. The larger system connected the frontend, transcription worker, processing service, and stored meeting report, so consistent data contracts and error handling were important.

如果面试官更想听 CueFlow，也可以换成 session、live transcript、cue 和 summary endpoints，但不要把两个项目的实现细节混到一起。

## How would you design REST endpoints for a chatbot?

> I’d probably use `POST /conversations` to create a conversation, `GET /conversations/{id}` to load it, and `POST /conversations/{id}/messages` to send a message. Streaming could use SSE from a dedicated endpoint or return a stream from the message request. I’d also separate feedback and document-ingestion endpoints from the chat path, and every response would include a request ID for debugging.

## What is the difference between GET, POST, PUT, PATCH, and DELETE?

> GET reads a resource and should not change it. POST usually creates something or starts an operation. PUT replaces a resource at a known location, while PATCH updates only selected fields. DELETE removes a resource. I’d also think about idempotency: repeating GET, PUT, or DELETE should normally leave the same final state, while POST often needs an idempotency key if clients may retry it.

## How do you validate API input?

> I validate it at the API boundary with a schema, for example Pydantic in FastAPI. That covers types, required fields, lengths, enums, and basic formats. Then the service layer checks business rules, such as whether the project exists and whether the user is allowed to access it. I wouldn’t rely on frontend validation because clients can bypass it.

## How would you return consistent API errors?

> I’d use the correct HTTP status and one error shape everywhere, something like an error code, a user-safe message, optional field details, and a request ID. Internal stack traces should stay in protected logs. Stable error codes are useful because the frontend can handle them without parsing English text.

## How would you authenticate requests to an internal API?

> For users, I’d normally use the organization’s existing identity provider through OAuth or OpenID Connect and validate the access token on the API. For service-to-service calls, I’d use a separate workload identity or short-lived credential with only the required permissions. Authentication tells us who is calling; the API still needs authorization checks for the specific project or action.

## How would you debug a slow API endpoint?

> I’d reproduce it and add timing around each stage: database work, retrieval, external APIs, and the LLM. Then I’d look at p50 and p95 latency and trace a few slow requests instead of guessing. Common causes might be sequential network calls, retrieving too much data, a slow query, or waiting for work that should be asynchronous. I’d optimize the measured bottleneck and compare again.

## When would you use asynchronous processing or a queue?

> I’d use it when work is slow, retryable, or doesn’t need to finish before the user gets a response—for example transcription, document embedding, long summaries, or batch evaluation. The API can create a job and return its ID, while a worker processes it and updates the status. A queue also absorbs traffic spikes, but the worker needs idempotency because messages may be delivered more than once.

## How would you design an API operation so retries do not create duplicates?

> I’d accept an idempotency key from the client and store it with the operation result. A database uniqueness constraint prevents two workers from creating the same logical action. If the same key is retried, the API returns the existing result instead of doing the work again. For external systems, I’d also pass a stable operation ID where possible.

---

# G. JavaScript 与前端

## How comfortable are you with JavaScript or TypeScript?

> I’m comfortable with JavaScript and TypeScript, especially in React applications and API integration. I prefer TypeScript for larger projects because the types catch a lot of data-contract mistakes between the frontend and backend. I’ve also used Node and Express when a JavaScript service made more sense, such as the recording part of the meeting bot.

## What is the difference between props and state in React?

> Props are inputs a component receives from its parent, and the component shouldn’t modify them. State is data owned by the component that can change over time and trigger a render. If several components need the same state, I’d lift it to a common parent or use shared state rather than copy it into multiple places.

## How would you build a chatbot interface in React?

> I’d keep the first version simple: a message list, input area, send and cancel actions, streaming response, source links, retry, and feedback. I’d model the request state clearly so a message can be submitting, streaming, complete, or failed. Conversation data and API logic would be separate from presentation components, which makes the interface easier to test and change.

## How would you display streaming model output?

> For normal server-to-client token streaming, I’d usually use SSE or a fetch response stream. As chunks arrive, I’d append them to the current assistant message and update the UI. I’d use an AbortController for cancel and clean up the connection if the component unmounts. I’d choose WebSocket when the application needs ongoing two-way realtime events, like live transcription plus cues.

## How would you manage loading, empty, and error states?

> I’d treat them as part of the feature, not as an afterthought. The empty state should explain what the user can ask. While waiting or streaming, the input and cancel behaviour should be clear. If a request fails, I’d keep the user’s message, show a useful error, and allow a retry without making them type it again.

## How would you prevent unnecessary React renders?

> I’d profile first, because not every render is a problem. Then I’d keep state close to the component that needs it, split large components, avoid recreating unstable props when it matters, and use `memo`, `useMemo`, or `useCallback` only around measured hot spots. For very long chat histories, list virtualization can make a bigger difference than memoizing everything.

## How would you connect a React frontend to a Python backend?

> I’d expose an HTTPS API with a documented JSON contract and generate or share TypeScript types where possible. The frontend would keep the base URL in environment configuration, send authenticated requests, and handle standard error responses. The backend would configure CORS only for the expected origins. Streaming would use a separate SSE, fetch-stream, or WebSocket connection depending on the interaction.

## How would you handle authentication in a web application?

> I’d use an established identity provider rather than build password handling myself. For a browser app, I’d prefer an OAuth/OIDC flow and secure, HttpOnly, SameSite cookies where the architecture supports them. The backend must validate the session or token and enforce authorization. I’d also handle CSRF where cookies are used and avoid putting long-lived sensitive tokens in browser storage.

## How would you make the chatbot usable on mobile screens?

> I’d design mobile-first: one clear conversation column, touch-friendly controls, readable text, no horizontal scrolling, and an input that stays usable when the keyboard opens. Sources and extra details can collapse instead of occupying the whole screen. I’d also test on real narrow screens because desktop responsive mode doesn’t catch every keyboard and scrolling issue.

## How would you collect useful feedback on chatbot answers?

> I’d start with thumbs up or down and an optional short reason, such as incorrect, outdated, missing information, or not helpful. The feedback record should be connected to the question, answer, retrieved document IDs, and model or prompt version. That makes it actionable instead of just producing a percentage that doesn’t explain what failed.

---

# H. AWS 与架构

## What AWS services have you used?

> I’ve worked most with Lambda, API Gateway, DynamoDB, S3, CloudWatch, and SQS in serverless-style applications. I’ve also had exposure to ECS and Fargate, ECR, and infrastructure tools such as CloudFormation, SAM, and Terraform. I’m most comfortable explaining the first group, and I normally choose services based on the workload rather than trying to use as many as possible.

如果某个服务只是课程或实验中用过，被追问时直接区分：`I used that in a smaller cloud project, not as the main part of SayNext.`

## Tell me about an AWS project you built.

这里必须选择简历里你最确定的那个 cloud project。若使用 serverless 项目，可以这样组织，但要把功能替换成真实功能：

> One project I built used API Gateway and Lambda for the API, DynamoDB for application data, and S3 for files. SQS handled work that didn’t need to finish inside the request, and CloudWatch gave me logs and basic monitoring. The main decision was to keep the request path short and move slower work to a worker. I also used infrastructure configuration so I could recreate the environment instead of setting it up manually.

不要临场把不确定的 CueFlow 部署细节塞进这个答案。面试前确定一个项目、一个真实请求流程、一个遇到的问题。

## How would you deploy a chatbot on AWS?

> I’d choose the simplest architecture that matches the traffic and streaming needs. A React frontend could be served from S3 and CloudFront. For a light, stateless API, API Gateway and Lambda could work; for long-lived streaming connections or a heavier service, I’d consider ECS Fargate behind a load balancer. Documents could live in private S3, with an indexing worker triggered through SQS. I’d keep secrets outside the code and use CloudWatch for logs and alarms. The vector store choice would depend on the existing data stack and scale.

## When would you choose Lambda instead of EC2?

> I’d choose Lambda for short, stateless, event-driven work with variable traffic, especially when I want low operational overhead and scale-to-zero behaviour. I’d choose EC2 when I need a long-running process, full machine control, a custom runtime, predictable steady usage, or workloads that don’t fit Lambda’s limits. For containerized services without managing servers directly, Fargate may sit between those choices.

## When would you choose DynamoDB instead of a relational database?

> I’d choose DynamoDB when the access patterns are known, mostly key-based, and I need simple scaling with low operational work. I’d choose a relational database when the data has important relationships, joins, complex filtering, or multi-record transactions. For project and task management data, relational storage may be more natural; for sessions, idempotency keys, or simple event state, DynamoDB can fit well.

## What would you store in S3?

> I’d use S3 for objects such as source documents, uploads, audio files, static frontend assets, model or evaluation artifacts, and backups. I wouldn’t use it as a replacement for a transactional database. For RAG, I’d keep the original document in S3 and store its searchable chunks and metadata in the retrieval system.

## How would you protect private documents stored in S3?

> I’d block public access, use least-privilege IAM policies, encrypt the bucket with an appropriate KMS key, and expose files only through authorized backend requests or short-lived presigned URLs. I’d keep separate environments and log access. The retrieval layer must enforce the same document permissions, because protecting S3 alone doesn’t help if the chatbot can return a chunk to the wrong user.

## How would you monitor an AI application on AWS?

> I’d use CloudWatch for structured logs, metrics, dashboards, and alarms, and tracing where requests cross several services. I’d monitor API latency and errors, queue depth and worker failures, and infrastructure usage. Then I’d add AI-specific signals such as retrieval success, model latency, token cost, fallback rate, unsupported-answer rate, and user feedback.

## How would you handle traffic spikes?

> I’d keep the API stateless where possible, autoscale the compute, and use a queue to absorb work that can be delayed. I’d add rate limits and backpressure so one user or provider limit doesn’t take down the whole system. Caching can help repeated public questions, and the system should degrade safely—for example, delay a summary instead of blocking the live chat path.

## How would you keep a small AI application inexpensive?

> I’d use managed or scale-to-zero services where they fit, set budgets and alarms, and avoid keeping oversized compute running. On the LLM side, I’d retrieve less context, route simple tasks to smaller models, cache safe repeated work, and avoid unnecessary calls. I’d also review storage lifecycle and log retention, because small background costs can quietly become larger than expected.

---

# I. 测试、监控与可靠性

## How would you test a RAG pipeline?

> I’d test it in layers. First, ingestion tests check parsing, chunking, metadata, updates, and deletion. Retrieval tests use labelled questions and measure whether the right evidence appears in the top results. Generation tests check whether the answer is supported by that evidence and handles missing information correctly. Finally, end-to-end tests cover the real user flow, latency, permissions, and citations.

## What is the difference between unit, integration, and end-to-end testing?

> A unit test checks a small piece of our own logic in isolation, such as score fusion or input validation. An integration test checks that components work together, such as the API writing a job and a worker processing it. An end-to-end test follows a real user flow from the frontend through the backend and external dependencies. I want many fast unit tests, targeted integration tests, and a smaller number of important end-to-end tests.

## What would you mock in an LLM application?

> In unit tests, I’d mock slow or nondeterministic external boundaries such as the LLM provider, embedding API, transcription provider, and AWS clients. I’d use fixed responses to test our parsing, fallback, and retry logic. But I’d still run a smaller integration and evaluation suite against the real model, because a mock can’t tell me whether the prompt or model behaviour is good.

## How would you measure chatbot answer quality?

> I’d use several dimensions: whether the answer is correct, relevant, complete enough, supported by the provided sources, and appropriately refuses when the answer is missing. I’d create a human-reviewed evaluation set and report results by question type. Product feedback and task completion matter too, because a technically correct answer can still be confusing or unhelpful.

## What metrics would you monitor after deployment?

> I’d monitor technical metrics such as error rate, p95 latency, availability, queue age, and timeouts. For the AI pipeline, I’d track retrieval hit rate, fallback or no-answer rate, citation support, token cost, model errors, and user feedback. I’d segment them by feature and version so a regression doesn’t disappear inside an overall average.

## How would you detect hallucinations or unsupported answers?

> I’d require the answer to include citations to retrieved chunks and check whether the important claims are actually supported by those chunks. Automated checks or an evaluator model can flag suspicious cases, but I wouldn’t treat that as perfect ground truth. I’d review samples, especially low-confidence and high-impact answers, and add confirmed failures to the regression set.

## How would you investigate a chatbot that suddenly gives worse answers?

> I’d first look for what changed: model version, prompt, retrieval settings, document ingestion, index contents, or permissions. Then I’d replay a set of known questions and inspect both the retrieved chunks and generated answer. That separates a retrieval regression from a generation problem. If a recent release caused it, I’d roll back or disable the feature while investigating.

## How would you use user feedback to improve the system?

> I’d connect each feedback item to the exact question, response, retrieved sources, and system version. Then I’d group failures into categories such as missing document, bad ranking, outdated source, unsupported generation, or poor wording. High-frequency or high-impact failures become new test cases, and I’d rerun the same set after changing the data, retrieval, or prompt.

这与 Context Router V1 → V2 的方法一致：分析错误类型，增加 completed answers、short requests、noisy ASR 等 targeted hard examples，而不是随便增加数据。

## How would you roll back a bad release?

> I’d version the application, prompts, models, and indexes so I know exactly what changed. A canary or feature flag lets me limit the initial exposure. If metrics get worse, I can route traffic back to the previous version. Database and index changes should be backward-compatible or have a tested restoration plan, because rolling back code alone may not restore the old behaviour.

## What documentation would you leave for future maintainers?

> I’d document the architecture and request flow, local setup, environment variables, API contracts, data model, deployment steps, and common failure procedures. For the AI parts, I’d also document prompt and model versions, document-ingestion rules, evaluation data and metrics, known limitations, and how to reproduce a result. I’d include the reasons behind important decisions, not only what files exist.

---

# J. 项目与行为问题

## Tell me about your SayNext or Hybrid Search Memory Assistant project.

自然的 60–90 秒版本：

> SayNext is a real-time conversation assistant. It processes a live transcript, retrieves relevant personal or situational context, and gives the user a short cue when help is useful. One part I built was a hybrid-search memory system using BM25 and embeddings, because exact facts and semantic meaning behave differently. I also built a Context Router that decides whether a cue is needed before calling the LLM. I started with rules and TF-IDF, but they couldn’t handle things like self-answered questions or noisy transcripts, so I fine-tuned DistilBERT and improved the training data through error analysis. The main goal wasn’t just to generate better text; it was to make the assistant less interruptive, faster, and more relevant.

对方可能继续问：为什么最近三段、怎样标注、怎样避免 leakage、为什么 weighted cost、为什么 DistilBERT。不要在第一段主动全部回答。

## What was the hardest technical problem in SayNext?

> The hardest problem was deciding when the system should stay quiet. A rule could see a question mark and trigger a cue even when the next sentence already answered the question. Rhetorical questions and noisy speech-to-text caused the same problem. I turned it into binary text classification over the recent transcript and fine-tuned DistilBERT. More importantly, I made false negatives three times more costly than false positives, because missing useful help was worse for this product. After targeted error analysis, accuracy improved from 79.5% to 91%, with recall around 96%.

如果问 why top two layers：

> I first trained the classifier head and then unfroze only the top two Transformer layers. It gave the model some task-specific adaptation without making training as heavy or unstable as updating the whole network on a relatively small dataset.

## Tell me about a project where several services had to work together.

> The AI meeting bot had several parts: a React frontend, backend storage and APIs, a recording or transcription component, and a separate processing service for summaries and meeting information. The difficult part wasn’t any single endpoint; it was keeping the data contract and job state consistent across services. We used explicit states such as queued, running, and ready, and I spent time tracing payloads and persistence across the full flow. That project made me much more careful about API contracts, observable job status, and testing the complete path rather than only each service alone.

## Describe a difficult bug and how you found the root cause.

这是你已经有证据支撑、而且与 document matching 直接相关的故事。

> In my hybrid-search memory system, questions about SayNext sometimes retrieved nothing useful even though the information was definitely stored. At first, it looked like an embedding problem. I logged the top results and grouped them by source, and I found that the same project had been stored under several different identities and names. Retrieval treated those pieces as unrelated, and even the evaluation expected literal source IDs. I added a canonical project ID and facet mapping, then changed the evaluation to check the canonical project and topic rather than one exact source name. After that, the correct SayNext source appeared in the top three for 12 out of 13 relevant evaluation cases. The main lesson was to inspect the data model and evaluation assumptions before replacing the search model.

## Tell me about a time you received critical feedback.

目前没有足够事实替你写完整故事。请选择一个真实发生过的场景，最好来自：

- Meeting Bot 队友或教授指出某项设计不现实；
- SayNext 测试者认为 cue 太频繁、太长或不符合场景；
- code review 指出 API、数据模型或测试的问题。

回答骨架：

> One piece of feedback I got was that ____. My first reaction was ____, because ____. Instead of defending the original version, I asked for a concrete example and tested it. I found that ____. I changed ____, and the result was ____. I still think the original decision made sense with the information I had, but the feedback showed me that ____.

不要说 “I always welcome feedback”。用一个具体变化证明即可。

## Tell me about a technical disagreement in a group project.

同样必须选择真实事件。Meeting Bot 比较合适，可回忆是否真的讨论过：接入会议的方式、功能范围、同步/异步处理、数据库设计或 deadline 下的优先级。

> We disagreed about whether to ____. I preferred ____ because ____, while another teammate was concerned about ____. We wrote down the actual constraints and compared the options using ____. We decided to ____. It wasn’t exactly my original choice, but it gave us ____, and I supported the decision once we agreed on the trade-off.

重点不是证明你赢了，而是说明你怎样把“个人意见”变成“共同约束下的技术取舍”。

## Describe a time you had to learn a new tool quickly.

如果这部分设备适配已经实际完成，可以使用 SayNext 的 SDK 和事件系统；如果仍然只是设计方案，就不要把它讲成完成结果：

> When I was adapting SayNext to a newer glasses and controller setup, I had to learn the device SDK and event model quickly. The documentation didn’t answer every integration question, so I built small probes, logged the actual events, and tested one gesture at a time before connecting it to the main application. That helped me separate SDK behaviour from bugs in my own state logic and stopped me from redesigning the application around assumptions that hadn’t been verified.

如果被追问具体动作，可以讲 single tap generate、double tap regenerate、swipe page、hold clear，以及 transcript 继续记录。

## Tell me about a mistake you made and what you changed afterward.

使用早期 Context Router 方法，不需要假装发生严重事故：

> An early mistake in SayNext was underestimating how much context the routing decision needed. I started with question marks, keywords, and a few rules. They looked reasonable on simple examples, but they failed on self-answered questions, rhetorical questions, and noisy transcripts. I stopped adding more special cases, changed the problem into a text-classification task, and built a targeted error set. Since then, I try to test a simple baseline early, but I also define what would prove that the baseline is no longer enough.

## How do you handle unclear requirements or missing information?

这题直接用 “helpful cue” 如何变成 ML objective。

> I try to turn the unclear part into examples and decisions. In SayNext, “give a helpful cue” was too vague to train or evaluate. I separated it into whether a cue was needed and whether the generated cue was useful, then collected positive, negative, and difficult examples. I also made the error cost explicit: missing a needed cue counted more than showing an extra one. Once that was written down, model selection and threshold tuning became much less subjective.

## Do you have any questions for us?

准备五个，现场选两到三个，不要全部连续问。

1. > What would a successful four months look like for the person in this role?
2. > Of the chatbot, document-matching tool, and existing agentic tools, which one would be the first priority?
3. > What parts of the system are already working, and where do you see the biggest technical problem right now?
4. > How does the team currently evaluate retrieval and chatbot answer quality?
5. > How much ownership would the co-op have over architecture decisions, and how are those decisions usually reviewed?
6. > Would I mainly work with the DeepSense technical team, internal users, or an external project partner?

如果对方在面试中已经回答过某题，不要重复问。可以说：

> You already covered part of this earlier, but I was also curious about...

---

# 3. 十个核心模块：真正需要练的不是 100 个答案

## 模块 1：30 秒个人介绍

关键词：`MACS / Acadia → own AI apps → role felt familiar → interested in project itself`

## 模块 2：SayNext 一分钟项目介绍

关键词：`live transcript → relevant memory → useful cue → Context Router → less interruption`

## 模块 3：Context Router 深挖

关键词：`rules/TF-IDF failed → three transcript segments → DistilBERT → 3FN+FP → hard examples → shadow set`

## 模块 4：Hybrid Search

关键词：`BM25 exact terms → embeddings meaning → merge/RRF → rerank → Recall@K/MRR`

## 模块 5：完整 RAG

关键词：`ingest → clean/chunk → metadata → embed/index → hybrid retrieve → rerank → grounded answer/citations → abstain → eval`

## 模块 6：LLM reliability

关键词：`structured output → schema validation → evidence → bounded retry → fallback → versioned eval set`

## 模块 7：安全 Agent

关键词：`small allow-listed tools → least privilege → server validation → confirmation → idempotency → audit log → checkpoint`

## 模块 8：多服务系统

关键词：`React → API → transcription/worker → processing → persistence → queued/running/ready → contract + observability`

## 模块 9：AWS 部署

关键词：`frontend → API/compute → data/documents → queue/worker → monitoring → permissions → cost`

## 模块 10：三个行为故事

已经可以练：

- difficult bug：project identity drift。
- mistake/technical lesson：rules 无法理解 conversation context。
- unclear requirements：把 helpful cue 变成 labels、weighted cost 和 evaluation。

仍需补充真实经历：

- critical feedback。
- technical disagreement。

---

# 4. 练习方法

## 第一轮：只说逻辑，不管英文是否漂亮

看到问题后，只用 3–5 个关键词回答。控制在 30–60 秒。

## 第二轮：允许停顿，但不能看完整稿

可以看模块关键词。忘词时不要从头重来，可以说：

- “Let me think about the best example for that.”
- “The main issue was...”
- “I’m not sure about the exact number, but the overall result was...”
- “I haven’t implemented that exact setup, but this is how I’d approach it.”

## 第三轮：只纠正三类问题

1. 有没有直接回答问题。
2. 有没有真实例子或 trade-off。
3. 是否在回答结束后停下来，而不是不断补充。

不要追求每个语法细节都像书面英语。面试官更容易相信一个会停顿、会修正、能解释取舍的人，而不是一段没有呼吸的完美答案。

## 最优先练习顺序

1. Tell me about yourself。
2. Why this role / Why DeepSense。
3. Tell me about SayNext。
4. Hardest problem / Context Router。
5. RAG pipeline。
6. Hybrid search 和 ranking。
7. Chatbot hallucination / missing answer。
8. Agent 如何安全调用内部 API。
9. Meeting Bot 多服务故事。
10. difficult bug、mistake、unclear requirements。
11. 选定一个真实 AWS project。
12. 补齐 critical feedback 和 technical disagreement 两个真实故事。
