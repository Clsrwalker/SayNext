import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  group: string;
  q: string;
  expected: string[];
};

const cases: EvalCase[] = [
  {
    group: "streaming",
    q: "What is the difference between Kinesis Data Streams and Kafka partitions?",
    expected: ["knowledge:lecture:kinesis-kafka-streaming"],
  },
  {
    group: "streaming",
    q: "How does a Kafka consumer group use offsets to recover after failure?",
    expected: ["knowledge:lecture:kinesis-kafka-streaming"],
  },
  {
    group: "streaming",
    q: "In Kinesis, why does the partition key matter for ordering and hot shards?",
    expected: ["knowledge:lecture:kinesis-kafka-streaming"],
  },
  {
    group: "streaming",
    q: "When should I use Kinesis Firehose instead of Kinesis Data Streams?",
    expected: ["knowledge:lecture:firehose-flink-stream-processing", "knowledge:lecture:kinesis-kafka-streaming"],
  },
  {
    group: "streaming",
    q: "What is Apache Flink used for in real time stream processing?",
    expected: ["knowledge:lecture:firehose-flink-stream-processing"],
  },
  {
    group: "lambda",
    q: "How do I build a Kinesis to Lambda to S3 pipeline in AWS?",
    expected: ["knowledge:lecture:kinesis-lambda-s3-pipeline"],
  },
  {
    group: "lambda",
    q: "What does the Lambda event and context contain when triggered by Kinesis?",
    expected: ["knowledge:lecture:kinesis-lambda-s3-pipeline", "knowledge:lecture:lambda-runtime-layers-docker"],
  },
  {
    group: "lambda",
    q: "Why do Kinesis Lambda records often need base64 decoding before writing to S3?",
    expected: ["knowledge:lecture:kinesis-lambda-s3-pipeline"],
  },
  {
    group: "lambda",
    q: "When should I use Lambda layers versus a Docker image?",
    expected: ["knowledge:lecture:lambda-runtime-layers-docker"],
  },
  {
    group: "lambda",
    q: "What are Lambda runtime environment variables CloudWatch logs and timeout limits?",
    expected: ["knowledge:lecture:lambda-runtime-layers-docker"],
  },
  {
    group: "cicd",
    q: "Explain CodePipeline CodeBuild CodeDeploy and CodeCommit in an AWS CI CD pipeline.",
    expected: ["knowledge:lecture:aws-cicd-codepipeline"],
  },
  {
    group: "cicd",
    q: "What is the difference between buildspec.yml and appspec.yml?",
    expected: ["knowledge:lecture:aws-cicd-codepipeline"],
  },
  {
    group: "cicd",
    q: "Why does CodeDeploy need an agent installed on EC2?",
    expected: ["knowledge:lecture:cicd-iam-ec2-setup"],
  },
  {
    group: "cicd",
    q: "What IAM roles and trust relationships are needed for CodeBuild CodeDeploy and EC2?",
    expected: ["knowledge:lecture:cicd-iam-ec2-setup", "knowledge:lecture:aws-cicd-codepipeline"],
  },
  {
    group: "storage",
    q: "What is S3 object storage and when would I use a presigned URL?",
    expected: ["knowledge:lecture:s3-object-storage-vectors"],
  },
  {
    group: "storage",
    q: "Compare S3 Vectors with OpenSearch for vector database search.",
    expected: ["knowledge:lecture:s3-object-storage-vectors"],
  },
  {
    group: "storage",
    q: "When should I use EFS instead of S3?",
    expected: ["knowledge:lecture:s3-efs-glacier-lifecycle"],
  },
  {
    group: "storage",
    q: "How does an S3 lifecycle policy move objects to Glacier?",
    expected: ["knowledge:lecture:s3-efs-glacier-lifecycle"],
  },
  {
    group: "database",
    q: "What is the tradeoff between managed RDS and running my own database on EC2?",
    expected: ["knowledge:lecture:managed-unmanaged-db-security"],
  },
  {
    group: "database",
    q: "Why is saying sensitive data should always be on premise too simple?",
    expected: ["knowledge:lecture:managed-unmanaged-db-security"],
  },
  {
    group: "database",
    q: "What is the difference between RDS Multi AZ standby and read replica?",
    expected: ["knowledge:lecture:rds-ha-backups-dr"],
  },
  {
    group: "database",
    q: "How would Route 53 health checks help with cross region disaster recovery for RDS?",
    expected: ["knowledge:lecture:rds-ha-backups-dr"],
  },
  {
    group: "architecture",
    q: "What are cloud architecture best practices around loose coupling and automated recovery?",
    expected: ["knowledge:lecture:cloud-architecture-best-practices"],
  },
  {
    group: "architecture",
    q: "How do CloudFront Redis TTL and cache invalidation fit into cloud performance design?",
    expected: ["knowledge:lecture:cloud-architecture-best-practices"],
  },
  {
    group: "genai",
    q: "When should I use prompt engineering RAG or fine tuning in a GenAI app?",
    expected: ["knowledge:lecture:genai-rag-finetuning"],
  },
  {
    group: "genai",
    q: "Why is RAG usually safer than fine tuning for private factual knowledge?",
    expected: ["knowledge:lecture:genai-rag-finetuning"],
  },
  {
    group: "genai",
    q: "What is the security difference between public LLM API keys and cloud hosted models with IAM?",
    expected: ["knowledge:lecture:llm-api-cloud-security"],
  },
  {
    group: "ml",
    q: "Explain supervised unsupervised and reinforcement learning with examples.",
    expected: ["knowledge:lecture:ml-paradigms-supervised-unsupervised-rl"],
  },
  {
    group: "ml",
    q: "Why can reinforcement learning beat supervised learning from human chess games?",
    expected: ["knowledge:lecture:ml-paradigms-supervised-unsupervised-rl"],
  },
  {
    group: "asr",
    q: "kinesis lambda s3 base sixty four decode event context cloud watch",
    expected: ["knowledge:lecture:kinesis-lambda-s3-pipeline"],
  },
  {
    group: "asr",
    q: "code deploy agent easy two user data ruby http d app spec",
    expected: ["knowledge:lecture:cicd-iam-ec2-setup"],
  },
  {
    group: "asr",
    q: "multi easy standby read replica route fifty three disaster recover",
    expected: ["knowledge:lecture:rds-ha-backups-dr"],
  },
  {
    group: "vpc",
    q: "What makes a subnet public instead of private in a VPC?",
    expected: ["knowledge:lecture:vpc-subnets-route-tables"],
  },
  {
    group: "vpc",
    q: "Why does a private subnet use a NAT gateway in the public subnet?",
    expected: ["knowledge:lecture:vpc-subnets-route-tables"],
  },
  {
    group: "vpc",
    q: "What is the difference between an interface endpoint and a gateway endpoint?",
    expected: ["knowledge:lecture:vpc-endpoints-privatelink"],
  },
  {
    group: "vpc",
    q: "Direct Connect keeps traffic on a private network instead of the public internet.",
    expected: ["knowledge:lecture:vpc-vpn-direct-connect"],
  },
  {
    group: "vpc",
    q: "VPN versus Direct Connect for on premise hybrid cloud bandwidth.",
    expected: ["knowledge:lecture:vpc-vpn-direct-connect"],
  },
  {
    group: "vpc",
    q: "SubNet one contains app servers and SubNet two contains database servers, so multiple subnets help separate traffic.",
    expected: ["knowledge:lecture:vpc-subnets-route-tables"],
  },
  {
    group: "cicd",
    q: "In CodeDeploy you create the application first and then create a deployment group.",
    expected: ["knowledge:lecture:aws-cicd-codepipeline"],
  },
  {
    group: "security",
    q: "Security groups versus network ACLs stateful stateless inbound outbound.",
    expected: ["knowledge:lecture:security-groups-nacls"],
  },
  {
    group: "security",
    q: "How does NACL rule order work compared with IAM explicit deny?",
    expected: ["knowledge:lecture:security-groups-nacls"],
  },
  {
    group: "networking",
    q: "What is Route 53 and how do DNS routing policies and health checks work?",
    expected: ["knowledge:lecture:route53-cloudfront-cdn"],
  },
  {
    group: "networking",
    q: "How do CloudFront edge locations and POPs reduce latency?",
    expected: ["knowledge:lecture:route53-cloudfront-cdn"],
  },
  {
    group: "compute",
    q: "How do you choose between EC2 Lambda ECS EKS Fargate and Elastic Beanstalk?",
    expected: ["knowledge:lecture:aws-compute-service-choice"],
  },
  {
    group: "compute",
    q: "What is an AMI and how do instance types affect EC2 selection?",
    expected: ["knowledge:lecture:ec2-ami-instance-networking"],
  },
  {
    group: "iac",
    q: "What is Infrastructure as Code and why does Terraform help reproduce environments?",
    expected: ["knowledge:lecture:iac-terraform-cloudformation"],
  },
  {
    group: "iac",
    q: "Why is the Terraform state file important and what happens if terraform.tfstate is deleted?",
    expected: ["knowledge:lecture:iac-terraform-cloudformation"],
  },
  {
    group: "iac",
    q: "What is the difference between Terraform and AWS CloudFormation stacks?",
    expected: ["knowledge:lecture:iac-terraform-cloudformation"],
  },
  {
    group: "terraform_lab",
    q: "In main.tf what do provider blocks resource blocks and output blocks do?",
    expected: ["knowledge:lecture:terraform-aws-lab-resources"],
  },
  {
    group: "terraform_lab",
    q: "What does user data do when an EC2 instance boots in the Terraform lab?",
    expected: ["knowledge:lecture:terraform-aws-lab-resources"],
  },
  {
    group: "terraform_lab",
    q: "Security group ports 80 22 and 3306 mean HTTP SSH and MySQL.",
    expected: ["knowledge:lecture:terraform-aws-lab-resources", "knowledge:lecture:security-groups-nacls"],
  },
  {
    group: "asr",
    q: "security group nacl state full state less rule number inbound outbound",
    expected: ["knowledge:lecture:security-groups-nacls"],
  },
];

let top1 = 0;
let top3 = 0;
const failures: string[] = [];
const byGroup = new Map<string, { total: number; top1: number; top3: number }>();

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

console.log(`LECTURE-KNOWLEDGE cases=${cases.length} top1=${top1}/${cases.length} top3=${top3}/${cases.length}`);
for (const [group, stat] of [...byGroup.entries()].sort()) {
  console.log(`${group}: top1=${stat.top1}/${stat.total} top3=${stat.top3}/${stat.total}`);
}

if (failures.length) {
  console.log(`\nFAILURES\n${failures.join("\n")}`);
  process.exitCode = 1;
}
