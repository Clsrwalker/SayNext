import { conversationLogger, type PersonalMemorySensitivity } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type LectureKnowledgeSeed = {
  title: string;
  sourceRef: string;
  keywords: string[];
  content: string;
};

const sensitivity: PersonalMemorySensitivity = "low";
const category = "knowledge_lecture_cloud_ai";
const usageRule =
  "Use as classroom, technical interview, or meeting knowledge. Explain it clearly and practically. Treat it as general course knowledge, not Xiang's personal experience unless the user explicitly asks Xiang to connect it to his projects.";

const memories: LectureKnowledgeSeed[] = [
  {
    title: "Lecture knowledge: Kinesis Data Streams and Kafka",
    sourceRef: "knowledge:lecture:kinesis-kafka-streaming",
    keywords: [
      "kinesis", "kds", "kafka", "data stream", "topic", "partition", "shard", "broker",
      "consumer group", "offset", "partition key", "ordering", "retention", "streaming",
    ],
    content: `Kinesis Data Streams and Kafka both handle streaming data, but their vocabulary and control model differ.

Kinesis Data Streams:
- A stream is split into shards.
- A partition key decides which shard receives a record.
- Ordering is guaranteed inside one shard, not across all shards.
- Data is retained for a configured retention period, so consumers can replay from older positions.
- AWS manages the service, so it is convenient when the system is already on AWS.

Kafka:
- A topic is split into partitions.
- A partition is hosted by brokers in the Kafka cluster.
- Ordering is guaranteed inside one partition.
- Consumer groups let multiple consumers share the work; each partition is consumed by one consumer in the group at a time.
- Offsets track what each consumer group has already read, which allows replay and failure recovery.

Practical comparison:
- Kinesis is simpler for AWS-native pipelines and integrates easily with Lambda, Firehose, S3, and CloudWatch.
- Kafka gives more control and is cloud-agnostic, but usually requires more operational work unless using a managed Kafka service.
- For both systems, partitioning/sharding design matters because it affects ordering, throughput, and hot partitions.`,
  },
  {
    title: "Lecture knowledge: Kinesis producer, Lambda trigger, and S3 pipeline",
    sourceRef: "knowledge:lecture:kinesis-lambda-s3-pipeline",
    keywords: [
      "kinesis producer", "boto3", "putRecord", "put_record", "streamName", "partitionKey",
      "lambda trigger", "event context", "base64", "cloudwatch logs", "s3 put object", "batch size",
    ],
    content: `A common AWS streaming pipeline is: producer -> Kinesis Data Stream -> Lambda -> S3.

Producer side:
- In Python, create a Kinesis client with boto3.
- Send records with put_record or putRecord-style parameters: stream name, data payload, and partition key.
- The partition key determines the target shard and affects ordering.
- Data payloads are usually JSON strings or bytes.

Kinesis viewing/reading:
- Latest starts from new incoming records.
- Trim horizon starts from the oldest retained record.
- Kinesis keeps records for its retention period, so reading a record does not automatically remove it from the stream.

Lambda consumer:
- Configure Kinesis as a Lambda trigger.
- Lambda receives an event object and context object.
- The event contains a batch of records; batch size controls how many records Lambda processes at once.
- Kinesis records in Lambda are commonly base64 encoded, so the function often decodes and parses JSON.
- The Lambda can write processed output to S3 using putObject or put_object.
- CloudWatch Logs are the first place to debug Lambda execution, errors, and print output.

Useful explanation:
"Kinesis buffers streaming events, Lambda processes them in batches, and S3 stores the processed result. The main design points are partition key, batch size, retry behavior, and how to handle decoding and failures."`,
  },
  {
    title: "Lecture knowledge: AWS Lambda runtime, layers, Docker image, and limits",
    sourceRef: "knowledge:lecture:lambda-runtime-layers-docker",
    keywords: [
      "lambda", "runtime", "handler", "event", "context", "environment variables", "layers",
      "docker image", "container image", "dependency", "cloudwatch", "timeout", "250 mb", "15 minutes",
    ],
    content: `AWS Lambda is serverless compute triggered by events.

Core ideas:
- A handler function receives event and context.
- Event contains the trigger payload, such as API Gateway request, S3 event, or Kinesis records.
- Context contains runtime metadata like request id and remaining execution time.
- Runtime chooses the language environment, such as Python or Node.js.
- Environment variables store configuration, but secrets should normally use a secret manager or IAM-based access.
- CloudWatch Logs capture Lambda output and errors.

Packaging options:
- A normal deployment package works for small code and dependencies.
- Lambda layers can share libraries across functions and avoid duplicating dependencies.
- If dependencies or runtime requirements become too custom, a Docker/container image is often easier.

Limits and trade-offs from the lecture:
- Lambda has execution time limits, commonly up to 15 minutes.
- Package/layer size limits matter; large dependencies can force a layer or Docker image approach.
- Lambda is good for event-driven tasks, but less suitable for long-running jobs, persistent connections, or heavy custom runtime needs.

Short answer:
"Lambda is convenient for event-driven processing, but I still need to think about cold starts, package size, timeout, IAM permissions, and observability through CloudWatch."`,
  },
  {
    title: "Lecture knowledge: AWS CI/CD with CodePipeline, CodeBuild, and CodeDeploy",
    sourceRef: "knowledge:lecture:aws-cicd-codepipeline",
    keywords: [
      "codepipeline", "codebuild", "codedeploy", "codecommit", "cicd", "buildspec",
      "appspec", "artifact", "pipeline", "rollback", "deployment",
    ],
    content: `An AWS CI/CD pipeline can connect CodeCommit, CodeBuild, CodeDeploy, and CodePipeline.

Service roles:
- CodeCommit or GitHub stores the source code.
- CodeBuild runs commands defined in buildspec.yml.
- CodeDeploy deploys the application to EC2, Lambda, Fargate, or on-prem servers.
- CodePipeline orchestrates the whole flow: source -> build -> deploy.
- Build artifacts are often passed through S3 between stages.

buildspec.yml:
- Defines install, pre_build, build, and post_build phases.
- Can run tests, install dependencies, package artifacts, and copy files.
- Must produce the files CodeDeploy needs.

appspec.yml:
- Tells CodeDeploy where files should go.
- Defines hooks/scripts such as BeforeInstall, AfterInstall, ApplicationStart, and ValidateService.
- For an EC2 web app, it might copy files to /var/www/html and run a start script.

Why it matters:
- CI/CD makes deployment repeatable.
- It reduces manual copying and inconsistent server state.
- CodeDeploy and CodePipeline provide deployment history, failure visibility, and rollback options.`,
  },
  {
    title: "Lecture knowledge: CodeDeploy EC2 setup, IAM roles, and user data",
    sourceRef: "knowledge:lecture:cicd-iam-ec2-setup",
    keywords: [
      "codedeploy agent", "ec2 user data", "iam role", "trust relationship", "instance profile",
      "codebuild role", "codedeploy role", "codepipeline role", "security group", "httpd",
    ],
    content: `For CodeDeploy to deploy to EC2, the infrastructure setup matters.

Typical setup:
- EC2 instance runs Amazon Linux or another supported OS.
- Security group allows needed traffic such as SSH for admin and HTTP/HTTPS for the app.
- User data can install packages like httpd, Ruby, and the CodeDeploy agent on boot.
- The CodeDeploy agent must be running on the EC2 instance.
- EC2 needs an instance profile/IAM role so the agent can fetch deployment artifacts.

IAM roles:
- CodeBuild service role lets CodeBuild read source, write logs, and store artifacts.
- CodeDeploy service role lets CodeDeploy manage deployments.
- CodePipeline service role lets the pipeline call CodeCommit/GitHub, CodeBuild, CodeDeploy, and artifact storage.
- Trust relationships define which AWS service is allowed to assume each role.

Common failure causes:
- CodeDeploy agent not installed or not running.
- EC2 role cannot access S3 artifacts.
- AppSpec file path is wrong.
- Deployment scripts are not executable.
- Security group blocks the app port.

Practical answer:
"CI/CD is not only YAML files. The IAM roles, trust relationships, deployment agent, and EC2 bootstrap script are all part of making the pipeline actually work."`,
  },
  {
    title: "Lecture knowledge: S3 object storage, presigned URLs, and S3 Vectors",
    sourceRef: "knowledge:lecture:s3-object-storage-vectors",
    keywords: [
      "s3", "object storage", "bucket", "presigned url", "object url", "static assets",
      "s3 vectors", "opensearch", "vector database", "storage class", "data transfer",
    ],
    content: `Amazon S3 is serverless object storage.

Core S3 ideas:
- Data is stored as objects inside buckets.
- Objects are accessed through APIs, SDKs, object URLs, or presigned URLs.
- Presigned URLs allow temporary controlled access without making the object public.
- Common use cases include static assets, media files, backups, logs, staging files, and data lakes.
- Costs include storage class, API requests, and data transfer.

S3 security:
- Access is controlled through IAM, bucket policies, ACL settings, encryption, and public access block.
- A bucket should not be made public unless the use case really requires it.

S3 Vectors vs OpenSearch:
- S3 Vectors is useful for cheaper vector storage and lower-traffic or prototype retrieval workloads.
- OpenSearch is better for low-latency, high-query, production search workloads with richer indexing/search features.
- The trade-off is cost and simplicity versus query speed and advanced search capability.

Simple explanation:
"S3 is not a normal file system. It is object storage accessed through APIs, and it is excellent for durable files, static assets, backups, and data lake style storage."`,
  },
  {
    title: "Lecture knowledge: EFS, S3 Glacier, and lifecycle policies",
    sourceRef: "knowledge:lecture:s3-efs-glacier-lifecycle",
    keywords: [
      "efs", "elastic file system", "glacier", "s3 glacier", "lifecycle policy",
      "standard ia", "archive", "retrieval", "object size", "latency", "file storage",
    ],
    content: `EFS, S3, and S3 Glacier solve different storage problems.

EFS:
- Elastic File System is a managed network file system.
- It can be mounted by EC2 instances.
- It is useful when applications need shared file-system semantics instead of object APIs.

S3:
- Object storage for files, media, backups, logs, data lake objects, and static assets.
- Access latency is usually low enough for online object retrieval.
- Individual S3 objects can be very large.

S3 Glacier:
- Archival storage for low-cost long-term retention.
- Retrieval can take minutes or hours depending on the retrieval tier.
- It is good for compliance, backups, and rarely accessed data.

Lifecycle policy:
- Automatically moves objects between storage classes over time.
- Example: S3 Standard -> S3 Standard-IA -> Glacier -> delete after a retention period.
- This reduces cost without manually moving old data.

Short comparison:
"Use EFS when the app needs a mounted shared file system. Use S3 for durable object storage. Use Glacier when the data is mostly archive data and slow retrieval is acceptable."`,
  },
  {
    title: "Lecture knowledge: Managed versus unmanaged databases and cloud security reasoning",
    sourceRef: "knowledge:lecture:managed-unmanaged-db-security",
    keywords: [
      "managed database", "unmanaged database", "rds", "database security", "iam",
      "nist", "hipaa", "gdpr", "on premise", "cloud security", "patching", "backups",
    ],
    content: `Managed and unmanaged databases have different responsibility models.

Unmanaged database:
- You run the database on your own VM or server.
- You control everything: OS, database engine, patches, backups, monitoring, scaling, and security hardening.
- It gives flexibility, but creates more operational burden and more ways to misconfigure the system.

Managed database such as RDS:
- AWS manages many operational tasks like backups, patching options, monitoring integrations, replication features, and infrastructure maintenance.
- The user still owns schema design, access control, query performance, and correct security configuration.

Security reasoning from the lecture:
- Do not say "sensitive data should always be on-premise" as a vague rule.
- Cloud can be more secure than on-prem if configured correctly, because providers offer strong internal networks, IAM, encryption, logging, and compliance tooling.
- Good reasoning should refer to security frameworks and requirements, such as NIST, HIPAA, GDPR, data residency, auditability, and threat model.

Good answer:
"I would choose managed RDS if the team wants reliability and less operational overhead. I would choose unmanaged only if we need special control that managed services cannot provide."`,
  },
  {
    title: "Lecture knowledge: RDS high availability, read replicas, backups, and disaster recovery",
    sourceRef: "knowledge:lecture:rds-ha-backups-dr",
    keywords: [
      "rds", "multi az", "standby", "read replica", "failover", "disaster recovery",
      "route 53", "health check", "backup", "s3 backup", "cross region", "iops",
    ],
    content: `RDS high availability and scaling features should not be mixed up.

Multi-AZ standby:
- Provides high availability and failover.
- A standby instance is kept in another Availability Zone.
- It is mainly for failure recovery, not for serving normal read traffic.

Read replica:
- Used for read scaling and sometimes read-heavy workloads.
- It can reduce load on the primary database.
- It is not the same thing as a standby failover target, although replicas can sometimes be promoted depending on design.

Backups:
- RDS backups are managed by AWS and are commonly stored in S3-backed infrastructure.
- Costs can include storage, deployment time, I/O, and data transfer depending on workload and setup.

Cross-region DR:
- Disaster recovery across regions often needs explicit architecture.
- Route 53 health checks, DNS failover, scripts, or infrastructure-as-code can help switch traffic.
- The design should consider RPO, RTO, replication lag, and failover testing.

Simple answer:
"Multi-AZ is mainly for availability, read replicas are mainly for read scaling, and cross-region DR needs a broader plan around replication, DNS failover, and recovery objectives."`,
  },
  {
    title: "Lecture knowledge: Cloud architecture best practices",
    sourceRef: "knowledge:lecture:cloud-architecture-best-practices",
    keywords: [
      "cloud architecture", "best practices", "auto scaling", "automate recovery", "infrastructure as code",
      "loose coupling", "load balancer", "sqs", "sns", "caching", "cloudfront", "redis", "ttl", "devsecops",
    ],
    content: `Cloud architecture best practices from the lecture:

Automation:
- Automate scaling instead of manually changing capacity.
- Automate recovery and deployment where possible.
- Use infrastructure as code so environments are repeatable.
- Treat servers/resources as disposable, not hand-maintained pets.

Reliability:
- Avoid single points of failure.
- Use load balancers, multiple Availability Zones, backups, health checks, and monitoring.
- Use queues such as SQS or pub/sub such as SNS/EventBridge to loosely couple components.

Performance and cost:
- Use caching where it makes sense: CloudFront for edge/static/global caching, Redis/ElastiCache for low-latency app data.
- TTL and cache invalidation must match how fresh the data needs to be.
- Right-size resources and shut down idle resources.
- Choose the right database/storage for access patterns.

Security:
- Use least privilege IAM.
- Apply security at multiple layers: identity, network, encryption, logging, and deployment pipeline.
- DevSecOps means security is included in development and deployment, not only checked at the end.`,
  },
  {
    title: "Lecture knowledge: GenAI app lifecycle, prompt engineering, RAG, and fine-tuning",
    sourceRef: "knowledge:lecture:genai-rag-finetuning",
    keywords: [
      "genai", "llm application", "prompt engineering", "in context learning", "few shot",
      "rag", "retrieval augmented generation", "vector database", "fine tuning", "foundation model",
    ],
    content: `For GenAI applications, the usual path is prompt engineering -> retrieval/RAG -> fine-tuning only when justified.

Prompt engineering:
- Make the task clear.
- Provide context, constraints, format, and examples.
- Few-shot examples help the model imitate the desired style or structure.
- In-context learning means the model adapts from examples in the prompt without changing model weights.

RAG:
- Retrieval-Augmented Generation pulls relevant documents or memory into the prompt.
- Vector databases help find semantically related chunks.
- RAG is useful when the model needs private, current, or domain-specific knowledge.
- Good chunking, metadata, ranking, and source quality matter.

Fine-tuning:
- Fine-tuning changes model behavior or domain style using training data.
- It needs high-quality examples, evaluation, governance, and cost control.
- It is not the first solution for missing knowledge; RAG is usually safer for factual knowledge.

Good answer:
"I would start with prompt engineering and RAG first, because they are easier to update and evaluate. I would only fine-tune if I repeatedly need a specific behavior that prompting and retrieval cannot reliably produce."`,
  },
  {
    title: "Lecture knowledge: LLM API access, cloud-hosted models, and security",
    sourceRef: "knowledge:lecture:llm-api-cloud-security",
    keywords: [
      "llm api", "api token", "cloud hosted model", "iam role", "internal network",
      "bedrock", "openai api", "security", "token management", "private access",
    ],
    content: `The lecture compared public LLM API access with cloud-hosted model access.

Public API style:
- The app calls an external model API over the internet.
- It usually uses API keys or tokens.
- The team must protect tokens, handle network exposure, and manage usage/cost.

Cloud-hosted model style:
- A model service inside the cloud provider can often be accessed through IAM roles and cloud networking.
- This can reduce direct token management and keep traffic closer to internal cloud infrastructure.
- It can integrate better with audit logs, IAM policies, VPC/network controls, and enterprise security requirements.

Key idea:
- Security is not only "which model is smarter."
- It also includes where data flows, how credentials are managed, who can call the model, and how requests are logged.

Simple answer:
"For a quick prototype, a public API is easy. For enterprise or sensitive data, a cloud-native model service with IAM and internal network controls may be safer and easier to govern."`,
  },
  {
    title: "Lecture knowledge: ML paradigms: supervised, unsupervised, and reinforcement learning",
    sourceRef: "knowledge:lecture:ml-paradigms-supervised-unsupervised-rl",
    keywords: [
      "supervised learning", "unsupervised learning", "reinforcement learning", "labels",
      "clustering", "anomaly detection", "reward", "policy", "agent", "environment", "chess",
    ],
    content: `Three major ML paradigms:

Supervised learning:
- The model learns from input-output examples with labels.
- Examples: spam classification, house price prediction, medical image classification, translation.
- The model generalizes from labeled training data to unseen data.

Unsupervised learning:
- The model finds structure without explicit labels.
- Examples: clustering related news articles, customer segmentation, anomaly detection, dimensionality reduction.
- It is useful when labeling is expensive or when you want to discover patterns.

Reinforcement learning:
- An agent interacts with an environment and learns from rewards or penalties.
- Key terms: state, action, reward, policy, environment.
- Useful when there is no simple labeled dataset but actions can be evaluated over time.
- In chess, supervised learning from human games is limited by human examples, while reinforcement learning can self-play and potentially exceed human patterns.
- Robotics often uses RL ideas because it can be hard to label every correct movement manually.

Good short answer:
"Supervised learning learns from labeled answers, unsupervised learning finds hidden structure, and reinforcement learning learns by trying actions and getting rewards."`,
  },
  {
    title: "Lecture knowledge: Firehose and Apache Flink in streaming systems",
    sourceRef: "knowledge:lecture:firehose-flink-stream-processing",
    keywords: [
      "firehose", "kinesis firehose", "apache flink", "stream processing", "real time analytics",
      "kinesis data analytics", "delivery stream", "s3 delivery", "transformation",
    ],
    content: `Kinesis-related services can be used at different levels of streaming complexity.

Kinesis Data Streams:
- Lower-level stream where producers write records and consumers process them.
- Good when you need control over consumers, replay, partition key, and custom processing.

Kinesis Firehose:
- Managed delivery service for loading streaming data into destinations such as S3, Redshift, OpenSearch, or other endpoints.
- Good when the goal is mainly ingestion and delivery, not complex custom stream processing.
- It can buffer, batch, compress, and optionally transform data.

Apache Flink / Kinesis Data Analytics:
- Used for more advanced stream processing.
- Supports stateful processing, windows, aggregations, joins, and real-time analytics.

Simple comparison:
"Use Kinesis Data Streams when you need custom consumers and replay. Use Firehose when you mainly want managed delivery into storage or analytics tools. Use Flink when the stream processing logic itself is complex and stateful."`,
  },
  {
    title: "Lecture knowledge: VPC, subnets, route tables, NAT, and internet gateway",
    sourceRef: "knowledge:lecture:vpc-subnets-route-tables",
    keywords: [
      "vpc", "subnet", "public subnet", "private subnet", "route table", "local route",
      "internet gateway", "nat gateway", "cidr", "availability zone", "networking",
    ],
    content: `VPC networking lecture notes:

- A VPC is a logically isolated network in one AWS region.
- A VPC uses a CIDR block, and subnets use smaller non-overlapping CIDR blocks inside the VPC range.
- A subnet belongs to one Availability Zone.
- A subnet being named "public" or "private" is not enough; what matters is the route table.
- A public subnet normally has a route to an Internet Gateway for 0.0.0.0/0.
- A private subnet does not have direct inbound internet access.
- Resources in a private subnet can access the internet for updates through a NAT Gateway placed in a public subnet.
- Route tables control where traffic goes. Every VPC route table has a local route for internal VPC communication, and that local route cannot be deleted.
- Custom route tables are used because real architectures usually need tighter traffic control than the default routes.

Good answer:
"A public subnet is public because its route table sends internet-bound traffic to an Internet Gateway. A private subnet usually avoids direct internet routes and may use a NAT Gateway for outbound-only access."`,
  },
  {
    title: "Lecture knowledge: Security groups versus network ACLs",
    sourceRef: "knowledge:lecture:security-groups-nacls",
    keywords: [
      "security group", "network acl", "nacl", "stateful", "stateless", "inbound",
      "outbound", "allow rule", "deny rule", "rule order", "firewall", "subnet",
    ],
    content: `Security groups and network ACLs are both firewall controls, but they work at different layers.

Security group:
- Applies at the instance/network-interface level.
- Stateful: if outbound traffic is allowed, the response traffic is automatically allowed back.
- Uses allow rules only; traffic not explicitly allowed is denied.
- Rules are evaluated together, not by order.

Network ACL / NACL:
- Applies at the subnet level.
- Stateless: inbound and outbound directions must both be allowed separately.
- Supports both allow and deny rules.
- Rules are evaluated by rule number from low to high; the first matching rule takes effect.
- The default NACL can allow all inbound/outbound, but custom NACLs are usually tightened.

Important distinction:
- IAM explicit deny overrides allow, but NACL logic is different: NACLs evaluate by rule number and first match.

Good short answer:
"Security groups are stateful instance-level allow-only firewalls. NACLs are stateless subnet-level firewalls with allow and deny rules, evaluated from the lowest rule number first."`,
  },
  {
    title: "Lecture knowledge: VPC endpoints, PrivateLink, interface endpoint, and gateway endpoint",
    sourceRef: "knowledge:lecture:vpc-endpoints-privatelink",
    keywords: [
      "vpc endpoint", "interface endpoint", "gateway endpoint", "privatelink", "private link",
      "s3 endpoint", "dynamodb endpoint", "aws backbone", "private network", "internal network",
    ],
    content: `VPC endpoints let resources in a VPC access AWS services without going through the public internet.

Interface endpoint:
- Uses AWS PrivateLink.
- Creates elastic network interfaces in subnets.
- Supports many AWS services.
- Traffic stays private inside AWS networking.
- More flexible, but usually costs more.

Gateway endpoint:
- Used mainly for S3 and DynamoDB.
- Added as a target in route tables.
- No hourly endpoint charge, though normal data transfer/request charges still apply.
- It does not use PrivateLink in the same interface-endpoint way, but still keeps traffic on AWS networking instead of public internet.

Practical answer:
"Use an interface endpoint when you need PrivateLink access to many AWS services. Use a gateway endpoint when the service is S3 or DynamoDB and you want a simpler cheaper private route from the VPC."`,
  },
  {
    title: "Lecture knowledge: VPN, Direct Connect, and private AWS connectivity",
    sourceRef: "knowledge:lecture:vpc-vpn-direct-connect",
    keywords: [
      "vpn", "direct connect", "private network", "private connection", "public internet",
      "dedicated connection", "on-premise", "on premise", "hybrid cloud", "bandwidth",
    ],
    content: `AWS private connectivity lecture notes:

- VPN connects an on-premises network to AWS through an encrypted tunnel over the public internet.
- AWS Direct Connect uses a dedicated private network connection into AWS instead of normal public internet routing.
- Direct Connect is usually for organizations that need more predictable bandwidth, lower latency, or private connectivity at scale.
- It is more expensive and more operationally involved than a simple VPN, so it is normally not for small personal projects.
- VPC peering connects VPCs directly; Transit Gateway is often used as a hub when many VPCs or networks need to connect.
- The main idea is that private connectivity reduces exposure to the public internet and can make network performance more predictable.

Good answer:
"VPN is encrypted over the public internet, while Direct Connect gives a dedicated private connection to AWS. Direct Connect is better for predictable bandwidth and enterprise hybrid-cloud traffic, but it costs more and is heavier to set up."`,
  },
  {
    title: "Lecture knowledge: Route 53, DNS routing policies, CloudFront, and POPs",
    sourceRef: "knowledge:lecture:route53-cloudfront-cdn",
    keywords: [
      "route 53", "dns", "dns resolver", "domain name", "health check", "routing policy",
      "latency routing", "geolocation routing", "cloudfront", "cdn", "edge location", "pop",
    ],
    content: `Route 53 and CloudFront lecture notes:

Route 53:
- AWS managed DNS service.
- Translates domain names into IP addresses.
- Can register domain names and connect user requests to AWS or external infrastructure.
- Supports health checks.
- Supports routing policies such as simple, weighted, latency-based, geolocation, geoproximity, failover, and multivalue answer routing.
- Route 53 is named after DNS port 53.

CloudFront:
- AWS CDN service.
- Uses edge locations and regional edge caches to serve content closer to users.
- Helps reduce latency and offload origin servers.
- Can improve security with HTTPS/TLS and DDoS protections.

POPs:
- Points of Presence are edge locations close to users.
- They help route/cache content closer to users for faster access.

Good answer:
"Route 53 decides where DNS traffic should go, while CloudFront caches and serves content near users through edge locations."`,
  },
  {
    title: "Lecture knowledge: AWS compute choices: EC2, Lambda, ECS, EKS, Fargate, and Beanstalk",
    sourceRef: "knowledge:lecture:aws-compute-service-choice",
    keywords: [
      "ec2", "lambda", "ecs", "eks", "ecr", "fargate", "elastic beanstalk", "beanstalk",
      "compute service", "virtual machine", "serverless", "container", "use case",
    ],
    content: `AWS compute service choice should start with "it depends on the use case."

EC2:
- Virtual machines.
- Most control over OS, networking, packages, and runtime.
- Good when you need persistent servers or custom environments.

Lambda:
- Serverless/function-based compute.
- Good for event-driven tasks and short-running functions.
- Less OS control; watch timeout, cold start, package size, and state management.

ECS/EKS/ECR/Fargate:
- Container-based application platforms.
- EKS is managed Kubernetes.
- ECS is AWS-native container orchestration.
- ECR stores container images.
- Fargate runs containers without managing servers.

Elastic Beanstalk:
- Platform-style service where you focus more on code and let AWS manage much of the deployment environment.
- Easier for traditional web apps if you do not need detailed infrastructure control.

Good answer:
"I would choose based on workload shape. EC2 gives maximum control, Lambda is best for event-driven serverless work, ECS/EKS/Fargate are for containerized apps, and Beanstalk is useful when I want a simpler managed application platform."`,
  },
  {
    title: "Lecture knowledge: EC2 AMI, instance type, storage, public IP, and Elastic IP",
    sourceRef: "knowledge:lecture:ec2-ami-instance-networking",
    keywords: [
      "ec2", "ami", "amazon machine image", "golden ami", "marketplace ami", "community ami",
      "instance type", "cpu", "memory", "storage", "network performance", "public ip", "elastic ip",
    ],
    content: `EC2 lecture notes:

AMI:
- Amazon Machine Image is a template used to launch an EC2 virtual machine.
- It includes an OS and can include preinstalled software.
- Quick Start AMIs are common AWS-provided images.
- Marketplace AMIs are verified by AWS Marketplace but may cost extra.
- Community AMIs can be convenient but are not verified in the same way.
- A customized reusable AMI is often called a golden AMI.
- AMIs can be copied to other regions/accounts for sharing.

Instance type:
- Choose based on CPU, memory, storage, and network performance.
- General purpose, compute optimized, memory optimized, storage optimized, and accelerated computing families serve different workloads.
- Accelerated computing often implies GPU-style workloads.

Networking:
- EC2 instances have private IPs through network interfaces.
- A dynamic public IP can be assigned, but it may change.
- Elastic IP is a static public IP that can be associated with an instance.

Good answer:
"An AMI is the launch template for the machine. The instance type decides the resource profile, like CPU, memory, storage, and network performance."`,
  },
  {
    title: "Lecture knowledge: Infrastructure as Code, Terraform, CloudFormation, and state files",
    sourceRef: "knowledge:lecture:iac-terraform-cloudformation",
    keywords: [
      "infrastructure as code", "iac", "terraform", "cloudformation", "cloud formation",
      "hcl", "hashicorp configuration language", "state file", "tfstate", "configuration drift",
      "devops", "cloud agnostic", "aws native", "stack", "reproducible environment",
    ],
    content: `Infrastructure as Code / Terraform / CloudFormation lecture notes:

- Infrastructure as Code means defining infrastructure with code instead of manually clicking through console settings.
- The main goal is reproducibility: teammates can create the same environment from the same files.
- IaC reduces manual configuration errors and helps avoid configuration drift between dev, test, and production.
- IaC fits DevOps because infrastructure changes can move together with build, test, and deployment pipelines.

Terraform:
- Cloud-agnostic IaC tool from HashiCorp.
- Uses HCL, HashiCorp Configuration Language.
- Uses providers, such as the AWS provider, to manage cloud resources.
- Uses a state file, often terraform.tfstate, to track what resources already exist.
- If the state file is lost, Terraform may not know what it created, which makes cleanup and updates messy.
- Common commands: terraform init, terraform plan, terraform apply, terraform destroy.

CloudFormation:
- AWS-native IaC service.
- Uses JSON or YAML templates.
- Manages resources as stacks.
- Better when the system is fully AWS and needs deep AWS service integration.

Good answer:
"IaC lets us define infrastructure in code, so environments are repeatable and less error-prone. Terraform is cloud-agnostic and tracks resources with a state file, while CloudFormation is AWS-native and manages resources through stacks."`,
  },
  {
    title: "Lecture knowledge: Terraform AWS lab resources, AWS CLI, VPC, EC2, RDS, user data, and ports",
    sourceRef: "knowledge:lecture:terraform-aws-lab-resources",
    keywords: [
      "terraform init", "terraform plan", "terraform apply", "terraform destroy",
      "provider block", "resource block", "main.tf", "aws_vpc", "aws_subnet", "aws_instance",
      "aws cli", "session token", "learner lab", "learnlab", "user data", "rds", "mysql",
      "port 80", "port 22", "port 3306", "security group",
    ],
    content: `Terraform AWS hands-on lab notes:

- AWS CLI is configured with access key ID, secret access key, default region, output format, and in Learner Lab also a session token.
- terraform init initializes a Terraform working directory and downloads provider plugins.
- terraform plan previews what Terraform will create, change, or destroy.
- terraform apply actually provisions the resources.
- terraform destroy removes the resources.

Terraform file structure:
- provider block selects the cloud provider, for example AWS and a region such as us-east-1.
- resource blocks define infrastructure components, for example aws_vpc, aws_subnet, aws_instance, security groups, and RDS.
- output blocks print useful values after apply, such as an EC2 public IP.

AWS resources in the lab:
- VPC is the private network container.
- Subnets split the VPC CIDR range into smaller networks, often public and private.
- Internet Gateway lets public subnets access the internet.
- EC2 is a virtual server.
- AMI selects the OS/image for the EC2 instance.
- User data runs startup scripts when the instance boots, for example installing httpd and serving a web page.
- RDS is managed relational database service, often MySQL or PostgreSQL.
- Security groups are virtual firewalls. Common ports: 80 for HTTP, 22 for SSH, 3306 for MySQL.

Good answer:
"In the Terraform lab, the provider block sets AWS, resource blocks create things like VPC, subnet, EC2, security group, and RDS, and user data can run startup scripts on EC2. The security group controls ports like 80 for HTTP, 22 for SSH, and 3306 for MySQL."`,
  },
];

let upserted = 0;

for (const memory of memories) {
  const record = conversationLogger.createPersonalMemory({
    userId,
    title: memory.title,
    category,
    sensitivity,
    content: memory.content,
    usageRule,
    keywords: memory.keywords,
    source: "knowledge",
    sourceRef: memory.sourceRef,
    status: "active",
    upsertBySource: true,
  });

  if (record) {
    upserted += 1;
    console.log(`${memory.sourceRef} -> ${record.id} ${record.title}`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Seeded lecture knowledge memories: ${upserted}/${memories.length}`);
