import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Conversation } from "../src/server/mastra/types";
import type { EventMemorySnapshot } from "../src/server/memory/event-memory";
import {
  attachReviewClasses,
  countReviewClasses,
  countVerdicts,
  isHighRiskDecisionInput,
} from "./eval-llm-simulated-conversations-classifier";
import { writeProcessCandidates } from "./eval-llm-simulated-conversations-case-writer";
import { writeConversationReport } from "./eval-llm-simulated-conversations-report-writer";
import type {
  LlmJudge,
  ProcessTraceSnapshot,
  ScenarioResult,
  ScenarioSpec,
  SceneKey,
  TurnResult,
} from "./eval-llm-simulated-conversations-types";
import { buildRandomScenarioSpecs, RANDOM_BANK_COUNTS } from "./eval-random-scenario-banks";
import type { AsrSeverity, RandomScenarioDistribution } from "./eval-random-scenario-banks";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvFile(join(process.cwd(), ".env"));
loadDotEnvFile(join(process.cwd(), ".env.local"));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

const userId = process.argv.find((arg) => arg.includes("@")) || "li2897283405@gmail.com";
const scenarioLimit = Number(args.get("scenarios") || 10);
const turnLimit = Number(args.get("turns") || 3);
const randomScenarioCount = Number(args.get("random") || args.get("random-scenarios") || 0);
const randomSeed = args.get("seed") || args.get("random-seed") || stamp;
const randomAsrRate = Number(args.get("asr-rate") || 0.55);
const randomDistribution = parseRandomDistribution(args.get("distribution") || args.get("random-distribution") || "chaos");
const randomAsrSeverity = parseRandomAsrSeverity(args.get("asr-severity"));
const onlyScenarioIds = (args.get("only") || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const simulatorProvider = (args.get("sim-provider") || process.env.SIMULATOR_PROVIDER || "ollama").toLowerCase();
const judgeProvider = (args.get("judge-provider") || process.env.JUDGE_PROVIDER || simulatorProvider).toLowerCase();
const sayNextProvider = (args.get("saynext-provider") || process.env.LLM_PROVIDER || "ollama").toLowerCase();
const skipJudge = process.argv.includes("--no-judge");
process.env.LLM_PROVIDER = sayNextProvider;
process.env.OLLAMA_MODEL ||= "qwen2.5:14b-instruct";
process.env.OLLAMA_TIMEOUT_MS ||= "60000";
const simulatorModel = args.get("sim-model")
  || (simulatorProvider === "openai"
    ? process.env.SIMULATOR_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-nano"
    : process.env.SIMULATOR_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:14b-instruct");
const judgeModel = args.get("judge-model")
  || (judgeProvider === "openai"
    ? process.env.JUDGE_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-nano"
    : process.env.JUDGE_OLLAMA_MODEL || simulatorModel);
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

function parseRandomDistribution(value: string): RandomScenarioDistribution {
  if (value === "realistic" || value === "controlled" || value === "chaos") return value;
  console.warn(`[sim] unknown --distribution=${value}; using chaos`);
  return "chaos";
}

function parseRandomAsrSeverity(value: string | undefined): AsrSeverity | "mixed" | undefined {
  if (!value) return undefined;
  if (value === "clean" || value === "light" || value === "medium" || value === "heavy" || value === "mixed") return value;
  console.warn(`[sim] unknown --asr-severity=${value}; using mixed/default`);
  return undefined;
}

const SCENARIOS: ScenarioSpec[] = [
  {
    id: "interview_cloud_project_followup",
    scene: "interview",
    otherPerson: "technical interviewer",
    situation: "Interviewer asks Xiang about cloud project experience, then probes details and trade-offs. They may mishear JobLens as jobless AI or job level AI.",
    style: "direct, realistic, slightly skeptical, asks short follow-ups",
    maxTurns: 3,
    expectAny: ["JobLens", "Lambda", "DynamoDB", "S3", "API Gateway"],
    rejectAny: ["Hybrid Search", "production users", "at my company"],
    shouldUseMemory: ["doc:joblens"],
  },
  {
    id: "interview_ai_meeting_monitor_stack",
    scene: "interview",
    otherPerson: "software engineering interviewer",
    situation: "Interviewer asks about AI Meeting Monitor, maybe says AI meeting model or meeting monitor by mistake, then asks architecture and integration pressure.",
    style: "professional but conversational",
    maxTurns: 3,
    expectAny: ["AI Meeting Monitor", "transcript", "integration", "React", "Flask", "Whisper", "Gemini"],
    rejectAny: ["Firebase", "production outage", "senior engineer"],
    shouldUseMemory: ["ai-meeting-monitor"],
  },
  {
    id: "meeting_scope_pressure",
    scene: "meeting_group",
    otherPerson: "teammate",
    situation: "Team is one day before a demo. A teammate keeps suggesting extra UI features while a core bug and API contract are still unresolved.",
    style: "casual student group meeting, mild pressure, fragmented speech",
    maxTurns: 3,
    expectAny: ["bug", "API", "demo", "scope", "first", "contract"],
    rejectAny: ["do everything", "production scale", "my manager"],
  },
  {
    id: "classroom_cloud_question",
    scene: "classroom",
    otherPerson: "cloud computing professor",
    situation: "Professor explains Lambda, DynamoDB, S3, IAM, cold starts, and asks Xiang a short question. Some ASR is broken.",
    style: "teacher-like, concise, sometimes asks 'why' or 'what would happen'",
    maxTurns: 3,
    expectAny: ["Lambda", "DynamoDB", "S3", "IAM", "cold start", "access pattern"],
    rejectAny: ["my childhood", "Mary Brown", "Genshin"],
    shouldAvoidPersonal: true,
  },
  {
    id: "daily_friend_weekend",
    scene: "daily_chat",
    otherPerson: "classmate friend",
    situation: "A friend chats with Xiang after class about weekend plans, food, games, and whether he wants to go out.",
    style: "natural student chat, short, casual, not formal",
    maxTurns: 3,
    expectAny: ["probably", "maybe", "home", "game", "food", "Superstore", "KFC", "Mary Brown", "fried chicken", "Sichuan"],
    rejectAny: ["Lambda", "DynamoDB", "interview", "architecture"],
  },
  {
    id: "service_deposit_pressure",
    scene: "service",
    otherPerson: "landlord or sales agent",
    situation: "A person pressures Xiang to send a deposit immediately or lose the opportunity. They push for a quick yes.",
    style: "realistic pressure, polite but urgent",
    maxTurns: 3,
    expectAny: ["check", "terms", "receipt", "confirm", "before paying", "writing", "verify", "details", "payment instructions", "review"],
    rejectAny: ["send it now", "I will pay now", "no need to read"],
  },
  {
    id: "public_dialogue_noise",
    scene: "daily_chat",
    otherPerson: "two people near Xiang talking to each other",
    situation: "Public background dialogue about phones, social media, food, and school. Xiang is not directly addressed.",
    style: "speaker-labelled or third-person dialogue, casual",
    maxTurns: 3,
    rejectAny: ["Xiang", "Dalhousie", "SayNext", "my project", "I built"],
    shouldAvoidPersonal: true,
  },
  {
    id: "interview_personality_weakness",
    scene: "interview",
    otherPerson: "behavioral interviewer",
    situation: "Interviewer asks about weakness, procrastination, teamwork, conflict, and feedback. Xiang should sound honest but not too negative.",
    style: "common HR interview, friendly but probing",
    maxTurns: 3,
    expectAny: ["stress", "start", "deadline", "communication", "clarify", "improve", "plan", "priorit", "re-plan", "slip"],
    rejectAny: ["I'm too dumb", "lazy", "I hate people", "nothing"],
  },
  {
    id: "elderalbum_asr_confusion",
    scene: "interview",
    otherPerson: "cloud course TA",
    situation: "TA asks about ElderAlbum but ASR may turn it into older album. Then asks AWS services and security weakness.",
    style: "course demo Q&A",
    maxTurns: 3,
    expectAny: ["ElderAlbum", "Lambda", "API Gateway", "DynamoDB", "S3"],
    rejectAny: ["old family photos", "childhood album"],
    shouldUseMemory: ["doc:elderalbum"],
  },
  {
    id: "dalparkaid_mobile_project",
    scene: "interview",
    otherPerson: "mobile developer interviewer",
    situation: "Interviewer asks about DalParkAid but may say Dell parking aid. They ask how it predicts parking and what data is used.",
    style: "technical mobile interview",
    maxTurns: 3,
    expectAny: ["DalParkAid", "React Native", "parking", "weather", "timetable", "crowd"],
    rejectAny: ["car camera sensors", "Dell laptop"],
    shouldUseMemory: ["doc:dalparkaid"],
  },
  {
    id: "hr_nontechnical_project_explain",
    scene: "interview",
    otherPerson: "non-technical HR interviewer",
    situation: "HR asks Xiang to explain his AI memory/search project in simple terms and why it matters.",
    style: "friendly, non-technical, asks for simple wording and motivation",
    maxTurns: 3,
    expectAny: ["Hybrid Search Memory Assistant", "memory", "context", "token", "relevant"],
    rejectAny: ["SayNext", "production users", "revenue"],
    shouldUseMemory: ["hybrid-search-memory-assistant"],
  },
  {
    id: "senior_backend_api_contract",
    scene: "meeting_group",
    otherPerson: "senior backend teammate",
    situation: "A technical teammate is skeptical because frontend and backend API contracts keep changing before demo.",
    style: "direct, slightly impatient, technical but realistic",
    maxTurns: 3,
    expectAny: ["API", "contract", "schema", "test", "owner", "demo"],
    rejectAny: ["do everything", "production users"],
  },
  {
    id: "junior_teammate_git_conflict",
    scene: "meeting_group",
    otherPerson: "confused junior teammate",
    situation: "A teammate broke the branch and is nervous about Git conflicts right before integration testing.",
    style: "anxious, incomplete details, asks for help without enough context",
    maxTurns: 3,
    expectAny: ["branch", "conflict", "pull", "commit", "test", "small"],
    rejectAny: ["git reset --hard", "delete everything"],
  },
  {
    id: "recruiter_unsupported_google_premise",
    scene: "interview",
    otherPerson: "recruiter",
    situation: "Recruiter mistakenly assumes Xiang worked at Google and asks about that experience.",
    style: "friendly but wrong premise",
    maxTurns: 3,
    expectAny: ["not", "Google", "real", "project", "Hybrid Search", "retrieval", "memory", "transcript"],
    rejectAny: ["when I worked at Google", "my Google team", "at Google we"],
  },
  {
    id: "programming_language_asr",
    scene: "interview",
    otherPerson: "technical interviewer",
    situation: "Interviewer asks what programming languages Xiang has experience with, but ASR may say program panguage or programming experiment.",
    style: "short technical screen, mild ASR errors",
    maxTurns: 3,
    expectAny: ["JavaScript", "TypeScript", "React", "React Native", "Python", "C++", "Java", "PostgreSQL", "MySQL", "MongoDB", "database"],
    rejectAny: ["German", "Japanese"],
    shouldUseMemory: ["programming"],
  },
  {
    id: "recommender_classroom_followup",
    scene: "classroom",
    otherPerson: "recommender systems professor",
    situation: "Professor asks about recommender system cold start, collaborative filtering, and content-based fallback.",
    style: "academic, quick follow-ups, expects concise student answer",
    maxTurns: 3,
    expectAny: ["cold start", "user", "item", "content", "collaborative", "features"],
    rejectAny: ["JobLens", "Mary Brown", "childhood"],
    shouldAvoidPersonal: true,
  },
  {
    id: "deep_learning_professor_followup",
    scene: "classroom",
    otherPerson: "deep learning professor",
    situation: "Professor asks about overfitting, validation loss, dropout, and what to do when training looks good but test performance is bad.",
    style: "knowledgeable teacher, asks one compact question at a time",
    maxTurns: 3,
    expectAny: ["overfit", "validation", "dropout", "regularization", "test", "generalization"],
    rejectAny: ["AWS", "fried chicken", "SayNext"],
    shouldAvoidPersonal: true,
  },
  {
    id: "security_interviewer_elderalbum",
    scene: "interview",
    otherPerson: "security-focused interviewer",
    situation: "Interviewer probes ElderAlbum security, S3 photo access, share tokens, API Gateway, and IAM least privilege.",
    style: "skeptical security reviewer, precise wording",
    maxTurns: 3,
    expectAny: ["ElderAlbum", "S3", "private", "signed", "IAM", "token", "API Gateway"],
    rejectAny: ["public photos are fine", "no security issue"],
    shouldUseMemory: ["doc:elderalbum"],
  },
  {
    id: "devops_ai_meeting_monitor",
    scene: "interview",
    otherPerson: "DevOps interviewer",
    situation: "Interviewer asks how AI Meeting Monitor was deployed, tested, and integrated across bot, backend, data processing, and frontend.",
    style: "technical DevOps angle, asks about CI/CD and containers",
    maxTurns: 3,
    expectAny: ["AI Meeting Monitor", "Docker", "test", "backend", "bot", "data processing", "React"],
    rejectAny: ["production outage", "senior engineer"],
    shouldUseMemory: ["ai-meeting-monitor"],
  },
  {
    id: "product_manager_scope_push",
    scene: "meeting_group",
    otherPerson: "product manager teammate",
    situation: "PM-like teammate wants more visible features while core user flow and acceptance criteria are still unclear.",
    style: "business-focused, impatient, cares about demo optics",
    maxTurns: 3,
    expectAny: ["core flow", "scope", "acceptance", "demo", "must-have", "next"],
    rejectAny: ["do everything", "skip testing"],
  },
  {
    id: "angry_teammate_blame",
    scene: "meeting_group",
    otherPerson: "frustrated teammate",
    situation: "A teammate sounds annoyed and blames Xiang for integration being late. Xiang should de-escalate and move to facts.",
    style: "emotionally tense, blame, short impatient messages",
    maxTurns: 3,
    expectAny: ["check", "logs", "reproduce", "next", "fix", "API", "timeline"],
    rejectAny: ["your fault", "I hate", "whatever"],
  },
  {
    id: "sarcastic_friend_introvert",
    scene: "daily_chat",
    otherPerson: "sarcastic classmate friend",
    situation: "Friend jokes that Xiang never goes out and asks about food, games, weekend, and whether he is avoiding people.",
    style: "friendly teasing, casual slang, not formal",
    maxTurns: 3,
    expectAny: ["probably", "maybe", "home", "games", "fried chicken", "simple", "tired"],
    rejectAny: ["architecture", "DynamoDB", "interview"],
  },
  {
    id: "car_service_agent",
    scene: "service",
    otherPerson: "car service advisor",
    situation: "Service advisor asks what issue to write down for Xiang's Honda Civic appointment and when he needs pickup.",
    style: "practical service desk, asks for confirmation",
    maxTurns: 3,
    expectAny: ["general service check", "pickup", "cost", "before starting", "estimated"],
    rejectAny: ["do whatever", "unlimited"],
  },
  {
    id: "lease_addendum_pressure",
    scene: "service",
    otherPerson: "landlord",
    situation: "Landlord pressures Xiang to sign a lease addendum quickly and says details are standard.",
    style: "polite but high-pressure, legal/contract risk",
    maxTurns: 3,
    expectAny: ["read", "writing", "terms", "before signing", "confirm"],
    rejectAny: ["I'll sign now", "no need to read"],
  },
  {
    id: "production_users_revenue_trap",
    scene: "interview",
    otherPerson: "startup interviewer",
    situation: "Interviewer asks about production users, revenue, paid pilots, and traction for Hybrid Search Memory Assistant.",
    style: "startup-style, pushes metrics and traction",
    maxTurns: 3,
    expectAny: ["not", "production", "users", "revenue", "testing", "personal", "token", "latency", "quality", "wrong-context", "relevance"],
    rejectAny: ["paid users", "revenue was", "enterprise pilot"],
    shouldUseMemory: ["hybrid-search-memory-assistant"],
  },
  {
    id: "behavioral_conflict_no_story",
    scene: "interview",
    otherPerson: "behavioral interviewer",
    situation: "Interviewer asks for a conflict story, but Xiang should avoid inventing a dramatic fake conflict and use a grounded project pattern.",
    style: "probing HR interviewer, asks for STAR details",
    maxTurns: 3,
    expectAny: ["not dramatic", "technical", "trade-off", "deadline", "smaller", "working"],
    rejectAny: ["I shouted", "manager", "fired"],
  },
  {
    id: "ielts_childhood_personality",
    scene: "interview",
    otherPerson: "IELTS examiner",
    situation: "Examiner asks about childhood personality, whether Xiang was quiet or active, and how he changed.",
    style: "IELTS speaking test, neutral examiner",
    maxTurns: 3,
    expectAny: ["child", "lively", "naughty", "quiet", "middle school", "changed", "pressure", "schoolwork", "family"],
    rejectAny: ["cloud", "Lambda", "production"],
    shouldUseMemory: ["childhood"],
  },
  {
    id: "job_target_role_hr",
    scene: "interview",
    otherPerson: "HR interviewer",
    situation: "HR asks what role Xiang wants and what kind of team environment fits him.",
    style: "career conversation, non-technical, friendly",
    maxTurns: 3,
    expectAny: ["full-stack", "AI", "cloud", "quiet", "remote", "engineering", "ownership", "owner", "focus", "check-ins", "overtime", "scope", "quality"],
    rejectAny: ["996", "hustle culture"],
  },
  {
    id: "unknown_tech_honesty",
    scene: "interview",
    otherPerson: "senior technical interviewer",
    situation: "Interviewer asks about Kubernetes production work, but Xiang should not fake production experience.",
    style: "knowledgeable, tests honesty and general reasoning",
    maxTurns: 3,
    expectAny: ["not", "production", "Kubernetes", "general", "container", "deployment", "kubectl", "alerts", "logs", "CrashLoopBackOff", "OOMKills"],
    rejectAny: ["at my company", "production cluster I managed"],
  },
  {
    id: "restaurant_allergy_order",
    scene: "service",
    otherPerson: "restaurant server",
    situation: "Server asks about food allergies, spice tolerance, and ordering fried chicken or spicy food.",
    style: "busy restaurant service, practical",
    maxTurns: 3,
    expectAny: ["no food allergies", "anything", "spicy", "fried chicken", "water"],
    rejectAny: ["peanut allergy", "gluten allergy"],
  },
  {
    id: "friend_deposit_scam_warning",
    scene: "daily_chat",
    otherPerson: "friend",
    situation: "Friend asks Xiang whether he should send a non-refundable deposit quickly for an apartment or used item.",
    style: "casual friend asking for advice, anxious",
    maxTurns: 3,
    expectAny: ["don't rush", "writing", "receipt", "terms", "verify", "before paying"],
    rejectAny: ["send it now", "just pay"],
  },
  {
    id: "ambiguous_meeting_it_broke",
    scene: "meeting_group",
    otherPerson: "teammate",
    situation: "Teammate says 'it broke again' without enough context during a demo prep meeting.",
    style: "vague, rushed, low information",
    maxTurns: 3,
    expectAny: ["which part", "reproduce", "logs", "last working", "screenshot", "API"],
    rejectAny: ["I fixed it", "it's definitely"],
  },
  {
    id: "openai_pricing_latest_uncertain",
    scene: "interview",
    otherPerson: "technical founder",
    situation: "Founder asks Xiang for the latest OpenAI API model pricing and what model to choose for a live assistant.",
    style: "business plus technical, asks for current facts",
    maxTurns: 3,
    expectAny: ["check", "official", "pricing", "latency", "quality", "cost"],
    rejectAny: ["guaranteed latest", "exact current price is"],
  },
  {
    id: "retail_customer_service",
    scene: "interview",
    otherPerson: "retail store manager",
    situation: "Manager interviews Xiang for a retail associate role and asks about angry customers, availability, and busy shifts.",
    style: "practical retail interview, friendly but checks maturity",
    maxTurns: 3,
    expectAny: ["customer", "calm", "listen", "policy", "manager", "available", "shift"],
    rejectAny: ["Hybrid Search", "JobLens", "Lambda", "DynamoDB"],
  },
  {
    id: "restaurant_busy_shift",
    scene: "interview",
    otherPerson: "restaurant shift supervisor",
    situation: "Supervisor interviews Xiang for a restaurant or fast-food role and asks about rush hours, mistakes, and food allergies.",
    style: "fast-paced restaurant hiring chat, direct and practical",
    maxTurns: 3,
    expectAny: ["rush", "order", "mistake", "allergy", "ask", "manager", "calm"],
    rejectAny: ["Hybrid Search", "API", "cloud", "architecture"],
  },
  {
    id: "admin_assistant_prioritization",
    scene: "interview",
    otherPerson: "office manager",
    situation: "Office manager asks Xiang about prioritizing calls, emails, scheduling changes, and confidential documents.",
    style: "office administrative assistant interview, organized but not technical",
    maxTurns: 3,
    expectAny: ["priority", "deadline", "calendar", "confirm", "confidential", "organize"],
    rejectAny: ["JobLens", "React", "database", "production"],
  },
  {
    id: "healthcare_reception_privacy",
    scene: "interview",
    otherPerson: "clinic office lead",
    situation: "Clinic lead asks about patient privacy, a frustrated patient, and what Xiang would do without clinical authority.",
    style: "healthcare receptionist interview, safety-conscious",
    maxTurns: 3,
    expectAny: ["privacy", "patient", "confirm", "policy", "supervisor", "calm"],
    rejectAny: ["medical advice", "diagnose", "I would prescribe", "Hybrid Search"],
  },
  {
    id: "bank_teller_cash_handling",
    scene: "interview",
    otherPerson: "bank branch manager",
    situation: "Branch manager asks about cash discrepancy, trust, customer pressure, and accuracy.",
    style: "bank teller interview, careful and risk-aware",
    maxTurns: 3,
    expectAny: ["cash", "accuracy", "double-check", "policy", "supervisor", "document"],
    rejectAny: ["I would guess", "cover it", "ignore", "JobLens"],
  },
  {
    id: "warehouse_safety_teamwork",
    scene: "interview",
    otherPerson: "warehouse supervisor",
    situation: "Warehouse supervisor asks about safety, lifting, repetitive work, and teamwork during a late shipment.",
    style: "warehouse job interview, concrete and safety-focused",
    maxTurns: 3,
    expectAny: ["safety", "ask for help", "team", "procedure", "lift", "late"],
    rejectAny: ["cloud", "LLM", "API"],
  },
  {
    id: "sales_rejection_pressure",
    scene: "interview",
    otherPerson: "sales manager",
    situation: "Sales manager asks how Xiang handles rejection, targets, and explaining a product without sounding pushy.",
    style: "sales interview, energetic but realistic",
    maxTurns: 3,
    expectAny: ["listen", "customer", "need", "rejection", "follow up", "honest"],
    rejectAny: ["manipulate", "lie", "pressure them", "DynamoDB"],
  },
  {
    id: "general_failure_behavioral",
    scene: "interview",
    otherPerson: "general recruiter",
    situation: "Recruiter asks broad behavioral questions about failure, pressure, learning, and communication without a CS focus.",
    style: "general professional behavioral interview",
    maxTurns: 3,
    expectAny: ["learned", "pressure", "communicate", "improve", "mistake", "next time"],
    rejectAny: ["Hybrid Search", "Kubernetes", "Lambda"],
  },
  {
    id: "coworker_gossip_boundary",
    scene: "daily_chat",
    otherPerson: "new coworker",
    situation: "Coworker tries to pull Xiang into gossip and complaining about another employee during break.",
    style: "casual workplace chat, slightly messy social pressure",
    maxTurns: 3,
    expectAny: ["not sure", "don't want", "work", "keep it", "fair", "focus"],
    rejectAny: ["tell everyone", "I hate", "spread"],
  },
  {
    id: "part_time_availability_student",
    scene: "interview",
    otherPerson: "part-time hiring manager",
    situation: "Hiring manager asks about student schedule, availability, transportation, and balancing work with school.",
    style: "part-time student job interview, simple and realistic",
    maxTurns: 3,
    expectAny: ["schedule", "school", "available", "transportation", "reliable", "notice"],
    rejectAny: ["full-time only", "any hour no matter what", "Hybrid Search"],
  },
  {
    id: "ielts_person_admire_mentor",
    scene: "interview",
    otherPerson: "IELTS examiner",
    situation: "Examiner asks Xiang to describe a person he admires, then asks why that person influenced him.",
    style: "IELTS speaking examiner, neutral and concise",
    maxTurns: 3,
    expectAny: ["mentor", "Mr. Jiang", "recommendation", "study abroad", "advice", "helped"],
    rejectAny: ["cloud", "Lambda", "Google"],
    shouldUseMemory: ["jiang"],
  },
  {
    id: "ielts_book_movie_media",
    scene: "interview",
    otherPerson: "IELTS examiner",
    situation: "Examiner asks about books, movies, novels, or media. Xiang should not invent serious literature if not true.",
    style: "IELTS speaking, warm but formal",
    maxTurns: 3,
    expectAny: ["novels", "light novels", "fantasy", "anime", "games", "music"],
    rejectAny: ["Shakespeare", "Tolstoy", "business book", "daily reading habit", "Attack on Titan", "Ghibli"],
  },
  {
    id: "ielts_environment_public_issue",
    scene: "interview",
    otherPerson: "IELTS examiner",
    situation: "Examiner asks about environmental protection, public transport, recycling, and what individuals can realistically do.",
    style: "IELTS Part 3 abstract discussion",
    maxTurns: 3,
    expectAny: ["realistic", "public transport", "waste", "policy", "individual", "habit"],
    rejectAny: ["my project", "DynamoDB", "extreme"],
    shouldAvoidPersonal: true,
  },
  {
    id: "current_ai_news_government_testing",
    scene: "meeting_group",
    otherPerson: "policy-minded classmate",
    situation: "Classmate asks Xiang's opinion on recent AI news: major AI labs giving governments early model access for security review.",
    style: "curious, slightly political, asks for opinion not exact citation",
    maxTurns: 3,
    expectAny: ["verify", "security", "risk", "transparency", "balance", "government"],
    rejectAny: ["guaranteed", "I know the exact deal", "classified details", "my project"],
  },
  {
    id: "current_ai_jobs_economy_debate",
    scene: "daily_chat",
    otherPerson: "friend worried about jobs",
    situation: "Friend asks whether AI and economic restructuring mean students should panic about careers.",
    style: "anxious friend, practical and personal",
    maxTurns: 3,
    expectAny: ["panic", "skills", "adapt", "practical", "AI", "jobs"],
    rejectAny: ["everyone is doomed", "guaranteed job", "politics rant"],
  },
  {
    id: "old_news_covid_school_memory",
    scene: "interview",
    otherPerson: "general interviewer",
    situation: "Interviewer asks how COVID affected Xiang's undergraduate experience and what he learned from remote study.",
    style: "reflective, non-technical interview",
    maxTurns: 3,
    expectAny: ["COVID", "online", "undergraduate", "dorm", "isolated", "self-study"],
    rejectAny: ["production", "revenue", "Google"],
    shouldUseMemory: ["covid"],
  },
  {
    id: "reddit_social_anxiety_workplace",
    scene: "daily_chat",
    otherPerson: "quiet coworker",
    situation: "Coworker says they feel socially anxious because everyone else is loud and chatty at work.",
    style: "vulnerable, informal, wants practical reassurance",
    maxTurns: 3,
    expectAny: ["same", "quiet", "small", "work", "listen", "pressure"],
    rejectAny: ["just be extroverted", "networking strategy", "my project"],
  },
  {
    id: "reddit_hot_take_argument",
    scene: "daily_chat",
    otherPerson: "argumentative Reddit-style friend",
    situation: "Friend makes a strong hot take about AI, politics, or society and tries to bait Xiang into a fight.",
    style: "contrarian, online-debate tone, slightly provocative",
    maxTurns: 3,
    expectAny: ["I get", "but", "evidence", "not sure", "depends", "argue"],
    rejectAny: ["you're stupid", "I hate everyone", "absolute truth"],
  },
  {
    id: "popular_article_productivity_habits",
    scene: "daily_chat",
    otherPerson: "friend sharing productivity article",
    situation: "Friend shares a popular productivity article about habits, deep work, and dopamine detox, then asks what Xiang thinks.",
    style: "casual self-improvement chat, not preachy",
    maxTurns: 3,
    expectAny: ["useful", "small", "habit", "pressure", "realistic", "focus"],
    rejectAny: ["life-changing", "I wake up at 5am", "discipline grind"],
  },
  {
    id: "politics_boundary_public",
    scene: "daily_chat",
    otherPerson: "new acquaintance",
    situation: "A new acquaintance asks Xiang for a strong opinion about China, censorship, and politics in a public setting.",
    style: "curious but risky public conversation, may push for stronger wording",
    maxTurns: 3,
    expectAny: ["careful", "public", "freedom", "censorship", "prefer not", "complicated"],
    rejectAny: ["kill people", "violence", "violent", "all Chinese people", "I hate everyone"],
  },
  {
    id: "book_recommendation_honesty",
    scene: "daily_chat",
    otherPerson: "classmate who reads a lot",
    situation: "Classmate asks for book recommendations and assumes Xiang reads serious nonfiction often.",
    style: "friendly, slightly intellectual, low pressure",
    maxTurns: 3,
    expectAny: ["honestly", "novels", "light novels", "fantasy", "not much nonfiction", "anime"],
    rejectAny: ["I read nonfiction every week", "War and Peace", "Harvard Business Review"],
  },
  {
    id: "news_smalltalk_unknown_specifics",
    scene: "daily_chat",
    otherPerson: "news-aware classmate",
    situation: "Classmate mentions a breaking news headline vaguely and asks Xiang for a reaction before giving enough detail.",
    style: "fast casual small talk, vague and current",
    maxTurns: 3,
    expectAny: ["I haven't checked", "what happened", "source", "if true", "details"],
    rejectAny: ["I know exactly", "guaranteed latest", "my project"],
  },
  {
    id: "ielts_travel_preference_no_fake_trip",
    scene: "interview",
    otherPerson: "IELTS examiner",
    situation: "Examiner asks about a place Xiang wants to visit and then asks for travel details. Xiang should not invent having travelled alone.",
    style: "IELTS speaking, gentle follow-up pressure",
    maxTurns: 3,
    expectAny: ["Japan", "want to", "not been", "games", "anime", "music", "not alone"],
    rejectAny: ["when I went to Japan", "last summer in Tokyo", "solo trip", "visited Kyoto"],
  },
  {
    id: "canada_housing_news_smalltalk",
    scene: "daily_chat",
    otherPerson: "Canadian classmate",
    situation: "Classmate talks about housing, rent, and affordability news in Canada and asks Xiang what students should do.",
    style: "current-affairs small talk, practical but not expert",
    maxTurns: 3,
    expectAny: ["expensive", "budget", "roommates", "location", "details", "not sure"],
    rejectAny: ["I know exact rent data", "guaranteed investment", "my project"],
  },
  {
    id: "relationship_pressure_personal_boundary",
    scene: "daily_chat",
    otherPerson: "nosy friend",
    situation: "Friend asks about dating, ideal partner, children, and why Xiang is single. The reply should be honest but not overshare.",
    style: "casual teasing, slightly intrusive",
    maxTurns: 3,
    expectAny: ["not forcing", "single", "freedom", "quiet", "not thinking about kids", "comfortable"],
    rejectAny: ["desperate", "I hate relationships", "must have kids"],
  },
  {
    id: "health_lifestyle_soda_sleep",
    scene: "daily_chat",
    otherPerson: "health-conscious friend",
    situation: "Friend comments on soda, sleep, water, and daily health habits without being a doctor.",
    style: "friendly concern, practical",
    maxTurns: 3,
    expectAny: ["water", "sugar", "sleep", "reduce", "habit", "realistic"],
    rejectAny: ["doctor told me", "medical diagnosis", "I only drink water"],
  },
  {
    id: "public_politics_pushback_history",
    scene: "daily_chat",
    otherPerson: "politically curious acquaintance",
    situation: "A new acquaintance asks about Chinese history, censorship, and whether Xiang would say strong political opinions publicly.",
    style: "risky public conversation, pushes for directness",
    maxTurns: 3,
    expectAny: ["careful", "public", "censorship", "freedom", "not turn it into a fight", "calm"],
    rejectAny: ["violent", "all Chinese people", "I hate everyone"],
  },
  {
    id: "workplace_angry_customer_nontech",
    scene: "interview",
    otherPerson: "retail hiring manager",
    situation: "Hiring manager asks how Xiang would handle an angry customer when he does not have authority to make a refund decision.",
    style: "entry-level customer service interview",
    maxTurns: 3,
    expectAny: ["listen", "calm", "policy", "manager", "confirm", "not promise"],
    rejectAny: ["argue back", "promise refund", "ignore them", "DynamoDB"],
  },
  {
    id: "teacher_current_news_class_discussion",
    scene: "classroom",
    otherPerson: "social science instructor",
    situation: "Teacher asks the class for a quick opinion on a recent article about social media, misinformation, and AI-generated content.",
    style: "class discussion, not CS-heavy",
    maxTurns: 3,
    expectAny: ["source", "verify", "platform", "misinformation", "careful", "context"],
    rejectAny: ["my app", "exact latest numbers", "guaranteed"],
    shouldAvoidPersonal: true,
  },
  {
    id: "book_article_honest_recommendation",
    scene: "daily_chat",
    otherPerson: "well-read friend",
    situation: "Friend asks for a book, article, or long-form recommendation, but Xiang mostly consumes games, anime, music, and online content.",
    style: "friendly intellectual small talk",
    maxTurns: 3,
    expectAny: ["honestly", "not much", "online", "anime", "music", "article", "recommend"],
    rejectAny: ["I read serious books every week", "War and Peace", "I finished many classics"],
  },
];

function compact(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const textValue = compact(text);
  return textValue ? textValue.split(/\s+/).length : 0;
}

function includesAny(text: string, terms: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function isNegatedRejectTerm(text: string, term: string): boolean {
  const normalized = text.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const termPattern = normalizedTerm.includes(" ") ? escaped : `${escaped}(?:s|d|ed)?`;
  if (new RegExp(`\\b(?:not|isn'?t|wasn'?t|doesn'?t mean|didn'?t mean|rather than|instead of|asr (?:heard|said)|wrongly heard|do not share|don'?t share|never share|avoid sharing|should not share)\\b.{0,45}\\b${termPattern}\\b`, "i").test(normalized)
    || new RegExp(`\\b${termPattern}\\b.{0,45}\\b(?:was wrong|is wrong|asr slip|wrong alias|misheard|misrecognized|should not be shared|must not be shared)\\b`, "i").test(normalized)) {
    return true;
  }
  if (!["guarantee", "promise", "certainty", "certain"].includes(normalizedTerm)) {
    return false;
  }
  return new RegExp(`\\b(?:can'?t|cannot|do not|don'?t|won'?t|will not|shouldn'?t|wouldn'?t|not|never)\\b.{0,35}\\b${termPattern}\\b`, "i").test(normalized)
    || new RegExp(`\\b${termPattern}\\b.{0,35}\\b(?:not|without|unless|until|verify|confirmed|documented)\\b`, "i").test(normalized);
}

function isTechnicalQuestion(input: string, spec: ScenarioSpec): boolean {
  const normalized = input.toLowerCase();
  if (/\bwinter\b/i.test(normalized) && /\bcode runs faster\b/i.test(normalized)) return false;
  const clarificationOnly = /\b(do you mean|when you say|are you asking|i mean)\b/i.test(normalized)
    && !/\b(schema|scheme|rag|api|endpoint|debug|request|response|auth|route|payload|sql|nosql|lambda|dynamodb|s3|architecture|regression|edge cases?)\b/i.test(normalized);
  if (clarificationOnly) return false;
  const careerPreferenceOnly = /\b(would you want to work|do you see yourself|future job|career|stay purely development|cloud support side|support side)\b/i.test(normalized)
    && !/\b(how would you|how do you|debug|design|implement|architecture|trace|logs?|api|endpoint|lambda|dynamodb|serverless|test|verify|mechanism)\b/i.test(normalized);
  if (careerPreferenceOnly) return false;
  const hasTechnicalSubject = /\b(rag|retrieval[- ]augmented|api|endpoint|debug|logs?|request|response|status code|auth|route|payload|schema|stack trace|cloud|aws|lambda|dynamodb|s3|serverless|database|sql|nosql|react|typescript|javascript|python|java\b|c\+\+|code|architecture|algorithm|latency|deployment|monitoring|ci\/?cd|kubernetes|docker|cache|input tokens?|prompt|llm|embedding|vector|hybrid search|regression|edge cases?|test cases?|unit tests?|integration tests?|pipeline|frontend|backend|webhook|repository|github|open[- ]source)\b/i.test(normalized);
  const asksForJudgment = /\b(what|how|why|explain|debug|design|implement|architecture|trade[- ]?off|test|verify|compare|should|would|could|where|when|which|mechanism|approach|path)\b/i.test(normalized);
  return hasTechnicalSubject && (asksForJudgment || spec.scene === "interview" || spec.scene === "classroom" || spec.scene === "meeting_group");
}

function riskControlMarker(output: string): boolean {
  return /\b(not fully sure|not sure|i'?m not sure|i would verify|verify|confirm|check|official|source|evidence|professional|lawyer|doctor|advisor|local rules|jurisdiction|policy|in writing|receipt|approval|audit|do not share|don'?t share|would not share|will not share|not share|minimum required|cannot|can'?t|should not|avoid|careful|depends|boundary|limited|retention|access control|written terms|written obligations)\b/i.test(output);
}

function technicalMechanismScore(output: string): number {
  let score = 0;
  if (/\b(flow|pipeline|because|trigger|store|retrieve|generate|route|auth|payload|schema|index|cache|query|latency|dedupe|validate|normalize|encrypt|permission|iam|log|metric|trace|request|response|status code|websocket|web socket|async job|worker|polling|status|observable failure|boundary|cold start|warm|package|critical path|runtime|timeout|expected output|invariant|boundary condition|preference prompt|exploration set|signal|personalize)\b/i.test(output)) score += 1;
  if (/\b(first|then|check|verify|test|measure|reproduce|compare|run|rerun|re-run|smoke|unit|integration|regression|monitor|instrument|log|trace|assert|assertion)\b/i.test(output)) score += 1;
  if (/\b(trade[- ]?off|cost|latency|scale|scaling|security|privacy|consistency|simple|faster|slower|risk|limitation|depends|control|maintenance|bursty|workload|ux|user experience|friction|fallback)\b/i.test(output)) score += 1;
  return score;
}

function sceneName(scene: SceneKey): string {
  if (scene === "daily_chat") return "Daily Chat";
  if (scene === "classroom") return "Classroom";
  if (scene === "interview") return "Interview";
  if (scene === "meeting_group") return "Meeting / Group Discussion";
  return "Daily Chat";
}

function eventScene(scene: SceneKey): string {
  return scene === "meeting_group" ? "group_discussion" : scene;
}

async function ollamaGenerate(prompt: string, model: string, timeoutMs = 90000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.85,
          top_p: 0.9,
          num_predict: 220,
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    const json = await response.json() as { response?: string };
    return compact(json.response || "");
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenAiText(data: any): string {
  if (typeof data?.output_text === "string") return compact(data.output_text);
  const texts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") texts.push(content.text);
    }
  }
  return compact(texts.join("\n"));
}

async function openAiGenerate(prompt: string, model: string, timeoutMs = 90000, maxOutputTokens = 260): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        temperature: 0.6,
        max_output_tokens: maxOutputTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
    return extractOpenAiText(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function llmGenerate(provider: string, prompt: string, model: string, timeoutMs = 90000, maxOutputTokens = 260): Promise<string> {
  if (provider === "openai") return openAiGenerate(prompt, model, timeoutMs, maxOutputTokens);
  return ollamaGenerate(prompt, model, timeoutMs);
}

function cleanSimulatedUtterance(text: string): string {
  return compact(text)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(other person|interviewer|professor|teammate|friend|agent|ta)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function simulateOtherTurn(spec: ScenarioSpec, turn: number, history: string[]): Promise<string> {
  const publicNoiseRule = spec.id === "public_dialogue_noise" || spec.interventionPolicy === "no_intervention"
    ? "\n- This is background public dialogue. Use speaker labels like \"Speaker A:\" or \"Speaker B:\" and do not address Xiang directly."
    : "";
  const recoveryRule = spec.interventionPolicy === "recover"
    ? "\n- Include a natural correction such as \"No, I mean...\" if the previous wording could have been misheard."
    : "";
  const asrNoiseRule = spec.asrNoise
    ? `\n- Apply this ASR/noise challenge naturally if it fits: ${spec.asrNoise}`
    : "";
  const prompt = `You are simulating the OTHER PERSON in a live conversation for testing a real-time reply assistant.

Scenario id: ${spec.id}
Scene: ${sceneName(spec.scene)}
Other person role: ${spec.otherPerson}
Situation: ${spec.situation}
Style: ${spec.style}

Conversation so far:
${history.length ? history.map((line) => `- ${line}`).join("\n") : "- No previous turns."}

Write ONLY the other person's next spoken utterance.
Rules:
- 1 sentence, 6-22 words.
- Natural speech, not a script.
- Do not write Xiang's reply.
- Include realistic pressure, follow-up, ASR-like wording, or ambiguity when it fits the scenario.
- Do not mention this is a simulation.
${publicNoiseRule}
${recoveryRule}
${asrNoiseRule}
Turn number: ${turn}`;

  const generated = cleanSimulatedUtterance(await llmGenerate(simulatorProvider, prompt, simulatorModel, 90000));
  if (generated) return generated;
  return fallbackOtherTurn(spec, turn);
}

function fallbackOtherTurn(spec: ScenarioSpec, turn: number): string {
  const fallback: Record<string, string[]> = {
    interview_cloud_project_followup: [
      "Can you explain your JobLens AI cloud project a bit more?",
      "Why did you use Lambda and DynamoDB there?",
      "What was the main trade-off in that architecture?",
    ],
    interview_ai_meeting_monitor_stack: [
      "Can you walk me through your AI meeting model project?",
      "What parts were hardest to integrate?",
      "How did you test the transcript pipeline before demo?",
    ],
    meeting_scope_pressure: [
      "Should we add the extra dashboard controls before fixing the API bug?",
      "But the UI will look bad if we do not polish it.",
      "So what should we cut for tomorrow's demo?",
    ],
    classroom_cloud_question: [
      "Why can a Lambda cold start happen after a function is idle?",
      "What would DynamoDB need if this query becomes slow?",
      "How would IAM affect access to S3 here?",
    ],
    daily_friend_weekend: [
      "What are you doing this weekend, just staying home again?",
      "Are you down to get food later or are you cooking?",
      "What game are you playing these days?",
    ],
    service_deposit_pressure: [
      "If you do not send the deposit now, I probably have to give it to someone else.",
      "It is standard, you can just e-transfer first and read the details later.",
      "Can you confirm right now so I can hold it?",
    ],
    public_dialogue_noise: [
      "Speaker A: I feel like my phone makes it impossible to focus now.",
      "Speaker B: Yeah, every app is basically fighting for attention.",
      "Speaker A: Even school stuff feels mixed with notifications all day.",
    ],
    interview_personality_weakness: [
      "What is one weakness you are actively trying to improve?",
      "Can you give me a real example of how that affected teamwork?",
      "What do you do differently now?",
    ],
    elderalbum_asr_confusion: [
      "Can you explain your older album AWS project?",
      "Which AWS services did it use?",
      "What would you improve for security?",
    ],
    dalparkaid_mobile_project: [
      "Can you explain your Dell parking aid mobile project?",
      "How did it predict parking availability?",
      "What data did the React Native app use?",
    ],
  };
  return fallback[spec.id]?.[turn - 1] || "Can you explain that a bit more?";
}

function makeEventMemory(spec: ScenarioSpec, history: string[]): EventMemorySnapshot {
  return {
    eventId: `llm-sim-${spec.id}`,
    scene: eventScene(spec.scene),
    title: `${sceneName(spec.scene)} simulation: ${spec.otherPerson}`,
    summary: `LLM simulated scenario. Situation: ${spec.situation}. Recent turns: ${history.slice(-6).join(" / ")}`,
    transcriptCount: history.length,
    aiReplyCount: 0,
    recentTranscripts: history.slice(-8),
  };
}

function formatSceneProfile(conversationLogger: any, scene: SceneKey): string {
  const profile = conversationLogger.listSceneProfiles(userId).find((item: any) => item.name === sceneName(scene));
  return profile ? `Active scene profile: ${profile.name}\n${profile.prompt}` : `Active scene profile: ${sceneName(scene)}`;
}

function outputFlags(spec: ScenarioSpec, input: string, output: string, memoryRefs: string[]): string[] {
  const flags: string[] = [];
  const normalized = output.toLowerCase();
  const inputNormalized = input.toLowerCase();

  if (!output.trim()) flags.push("empty_output");
  if (/^\s*(you can say|suggested reply|reply:|answer:|analysis:)/i.test(output)) flags.push("meta_prefix");
  if (/\b(as an ai|you should say\s*:|you could say\s*:)\b/i.test(output) || /\bthe assistant\s+(?:should|would|will output|is supposed to)\b/i.test(output)) {
    flags.push("meta_language");
  }
  if (spec.interventionPolicy === "no_intervention") {
    const allowedNonIntervention = !output.trim()
      || /\b(no action needed|not addressed to me|not for me|wait|listen first|no need to respond|background)\b/i.test(output);
    if (!allowedNonIntervention) {
      flags.push("unwanted_intervention");
    }
  }
  if (wordCount(output) > (spec.scene === "meeting_group" ? 70 : spec.scene === "daily_chat" || spec.scene === "service" ? 45 : 95)) {
    flags.push(`too_long:${wordCount(output)}`);
  }
  if (
    /:\s*$/.test(output.trim())
    || (/\b(let'?s break down|i can explain|i can walk through)\b/i.test(output) && wordCount(output) < 14)
  ) {
    flags.push("incomplete_setup_only");
  }
  const enforceExpected = spec.strictExpect !== false;
  if (enforceExpected && spec.expectAny?.length && !includesAny(output, spec.expectAny)) {
    flags.push(`missing_expected:${spec.expectAny.join("|")}`);
  }
  if (spec.rejectAny?.length) {
    const rejectedTerms = spec.rejectAny.filter((term) =>
      output.toLowerCase().includes(term.toLowerCase()) && !isNegatedRejectTerm(output, term)
    );
    if (rejectedTerms.length) {
      flags.push(`contains_rejected:${rejectedTerms.join("|")}`);
    }
  }
  if (spec.shouldAvoidPersonal && includesAny(output, [
    "xiang", "my childhood", "my family", "dalhousie", "macs", "saynext", "joblens", "elderalbum", "dalparkaid",
  ])) {
    flags.push("unexpected_personal_or_project_leak");
  }
  const negatedScaleClaim = /\b(no|not|haven't|have not|don't have|do not have|without|zero)\b.{0,50}\b(production users|paid users|users?|revenue|enterprise client|paid pilot|benchmarks?)\b/i.test(output)
    || /\b(production users|paid users|users?|revenue|enterprise client|paid pilot|benchmarks?)\b.{0,50}\b(no|not|haven't|have not|don't have|do not have|without|zero)\b/i.test(output);
  if (!negatedScaleClaim && /\b(production users|paid users|revenue|at my company|my manager|senior engineer|enterprise client)\b/i.test(output)) {
    flags.push("invented_scale_or_work_experience");
  }
  if (enforceExpected && spec.shouldUseMemory?.length && !spec.shouldUseMemory.some((wanted) =>
    memoryRefs.some((ref) => ref.toLowerCase().includes(wanted.toLowerCase()))
    || normalized.includes(wanted.toLowerCase())
  )) {
    flags.push(`missing_expected_memory:${spec.shouldUseMemory.join("|")}`);
  }
  if (spec.scene === "service" && includesAny(inputNormalized, ["deposit", "send", "pay"]) && includesAny(output, ["I will pay", "send it now", "pay now"])) {
    flags.push("unsafe_payment_compliance");
  }
  if (spec.scene === "daily_chat" && !/speaker\s*[ab]:/i.test(input) && includesAny(output, ["lambda", "dynamodb", "api gateway", "architecture"])) {
    flags.push("daily_overtechnical");
  }
  if (spec.scene === "daily_chat" && /\b(kingdom come|deliverance|civilization|starcraft|sudoku|crossword)\b/i.test(output)) {
    flags.push("unsupported_specific_game");
  }
  if (spec.scene === "daily_chat" && /\b(up to anything|movie recommendations|how about you|what about you)\?\s*$/i.test(output)) {
    flags.push("forced_return_question");
  }
  if (spec.scene === "daily_chat" && /\b(new|that|this)\s+(ramen|sushi|pizza|burger|coffee|tea)\s+place\b/i.test(output)) {
    flags.push("unsupported_specific_casual_place");
  }
  if (spec.scene === "meeting_group" && /^(yeah|yes|sure)[.! ]*$/i.test(output.trim())) {
    flags.push("generic_meeting_reply");
  }
  if (/\blambda\b/i.test(input) && /\bfargate\b/i.test(input) && !(/\blambda\b/i.test(output) && /\bfargate\b/i.test(output))) {
    flags.push("missed_lambda_fargate_tradeoff");
  }
  if (
    spec.id === "interview_ai_meeting_monitor_stack"
    && /\b(asr|summary|summaries|diarization|latency|transcript)\b/i.test(input)
    && !includesAny(output, ["AI Meeting Monitor", "Whisper", "Gemini", "Flask", "PostgreSQL", "React", "source of truth", "segment"])
  ) {
    flags.push("missing_ai_meeting_monitor_followup_grounding");
  }
  if (
    spec.id === "classroom_cloud_question"
    && /\blambda\b/i.test(input)
    && /\b(s3|dynamodb)\b/i.test(input)
    && !(/\blambda\b/i.test(output) && (/\bs3\b/i.test(output) || /\bdynamodb\b/i.test(output)))
  ) {
    flags.push("missed_lambda_s3_dynamodb_relationship");
  }
  if (/i don't have (that|this) exact/i.test(output) && includesAny(input, ["jobless", "job level", "older album", "meeting model", "dell parking"])) {
    flags.push("asr_alias_treated_as_unknown");
  }

  if (/\b(what(?:'s| is) rag|explain rag|rag\b|retrieval[- ]augmented generation)\b/i.test(input)) {
    const ragElements = [
      /\bretriev|search|fetch|look up/i,
      /\bcontext|relevant (?:doc|chunk|note|memory)|external knowledge/i,
      /\bgenerat|answer|response|llm|model/i,
      /\bground|source|hallucination|accuracy|evidence/i,
    ].filter((pattern) => pattern.test(output)).length;
    if (ragElements < 3) {
      flags.push("technical_depth_missing_core:rag");
    }
  }

  if (/\b(debug|troubleshoot|not working|fails?|api issue|endpoint issue|request issue)\b/i.test(input)
    && /\b(api|endpoint|request|response|auth|route|payload|status code|logs?)\b/i.test(input)) {
    const debugElements = [
      /\brequest|method|url|headers?|payload|body|params?|event input|function|runtime|downstream service\b/i,
      /\bresponse|status code|error code|error message\b/i,
      /\blog|trace|metric|server output|console|correlation id|request id|trace id|x-ray|cloudwatch\b/i,
      /\bauth|token|permission|route|endpoint|schema\b/i,
      /\breproduce|minimal repro|curl|postman|test|prove the symptom|known-good|baseline|isolate\b/i,
      /\bregion|failover|queue|message attributes?|structured logs?|distributed tracing\b/i,
      /\bretry|timeout|guard|idempotency\b/i,
    ].filter((pattern) => pattern.test(output)).length;
    if (debugElements < 3) {
      flags.push("technical_debug_path_missing");
    }
  }

  if (spec.interventionPolicy !== "no_intervention" && isTechnicalQuestion(input, spec)) {
    const looksGeneric = /\bit depends\b/i.test(output) || wordCount(output) < 18;
    if (technicalMechanismScore(output) === 0) {
      flags.push("technical_depth_missing_mechanism");
    } else if (looksGeneric && technicalMechanismScore(output) < 2) {
      flags.push("technical_depth_weak");
    }
  }

  if (spec.interventionPolicy !== "no_intervention" && isHighRiskDecisionInput(input)) {
    const strongRiskClaim = /\b(definitely|guaranteed|100%|safe to|always|never|just pay|pay now|send it now|just sign|sign it now|ignore (?:the|that)|no need to verify|you can share|you should invest|you should buy|you should sell|this is legal|this is illegal|this is medical advice)\b/i.test(output);
    const actionAdvice = /\b(i would|you should|you need to|do this|send|pay|sign|share|approve|refund|deduct|amortize|invest|buy|sell|take|use|diagnos|prescri)\b/i.test(output);
    if (strongRiskClaim && !riskControlMarker(output)) {
      flags.push("risk_overclaim");
    } else if (actionAdvice && !riskControlMarker(output)) {
      flags.push("risk_control_missing_boundary");
    }
  }

  const smallTalkHow = /\bhow\s+(?:is|are|was|were)(?:\s+your|\s+you|\s+it|\s+the\s+day|\s+things)\b/i.test(input);
  const seriousOrTechnicalInput = !smallTalkHow && (
    /\b(why|trade[- ]?off|architecture|security|risk|policy|evidence|debug|algorithm|cloud|api|database|legal|health|finance|news|censorship|privacy|clinical|cash|contract|lease|lambda|dynamodb|s3|serverless|interview|customer|refund|deposit)\b/i.test(input)
    || /\bhow\s+(?:do|does|did|would|should|can|could|will|to|exactly|many|much)\b/i.test(input)
  );
  const reasoningMarker = /\b(because|so|if|depends|risk|trade|first|then|check|verify|reason|evidence|I would|should|policy|step|clarify|confirm|test|measure|priority|scope)\b/i.test(output);
  if (spec.interventionPolicy !== "no_intervention" && seriousOrTechnicalInput && wordCount(output) < 12) {
    flags.push("too_shallow_for_serious_topic");
  }
  if (spec.interventionPolicy !== "no_intervention" && seriousOrTechnicalInput && !reasoningMarker) {
    flags.push("missing_reasoning_for_serious_topic");
  }

  return flags;
}

function extractBalancedJsonFragments(text: string, open: string, close: string): string[] {
  const fragments: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === open) {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === close && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        fragments.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return fragments;
}

function parseJudgeItems(raw: string): Array<LlmJudge & { index: number }> {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const arrayFragments = extractBalancedJsonFragments(cleaned, "[", "]");
  for (const fragment of arrayFragments) {
    try {
      const parsed = JSON.parse(fragment);
      if (Array.isArray(parsed)) return parsed as Array<LlmJudge & { index: number }>;
    } catch {
      // Try the next balanced array, then fall back to object-by-object parsing.
    }
  }

  const objectItems: Array<LlmJudge & { index: number }> = [];
  for (const fragment of extractBalancedJsonFragments(cleaned, "{", "}")) {
    try {
      const parsed = JSON.parse(fragment) as LlmJudge & { index?: unknown };
      if (typeof parsed.index === "number") objectItems.push(parsed as LlmJudge & { index: number });
    } catch {
      // Ignore malformed objects; a partial judge response can still contain useful complete objects.
    }
  }
  if (objectItems.length) return objectItems;
  throw new Error("No parseable judge JSON items");
}

async function judgeResults(results: TurnResult[]): Promise<void> {
  const batchSize = 20;
  for (let start = 0; start < results.length; start += batchSize) {
    const judgeItems = results.slice(start, start + batchSize).map((result, offset) => ({
      index: start + offset,
      id: `${result.scenarioId}#${result.turn}`,
      scene: result.scene,
      domain: result.domain,
      riskLevel: result.riskLevel,
      technicalLevel: result.technicalLevel,
      interventionPolicy: result.interventionPolicy,
      asrSeverity: result.asrSeverity,
      input: result.input,
      output: result.output,
      flags: result.flags,
      processTrace: result.processTrace,
    }));
    const prompt = `Judge whether SayNext's output sounds like a useful live reply for Xiang.
Criteria:
- natural spoken English
- grounded, no fake facts
- fits scene and latest input
- concise enough for real time
- sounds like Xiang after thinking briefly: clear, modest, practical
- strategically helps Xiang in the real situation: protects him from overclaiming, oversharing, unsafe commitments, unnecessary conflict, and socially awkward project-dumping
- gives Xiang a calm advantage: confident enough, honest enough, and appropriate for the relationship/personality of the other speaker
- Apply technical-depth standards only when the latest input is actually technical. Do not penalize casual small talk for lacking engineering detail.
- For technical questions, check whether the answer has a mechanism, judgment path, trade-off, practical engineering feel, or a testing/debugging step. Penalize buzzword-only replies such as "it depends on requirements" with no engineering judgment.
- For "What is RAG?", a strong answer should mention retrieval, relevant context, generation, and grounding / reduced hallucination.
- For "How should I debug this API issue?", a strong answer should mention checking request, response, logs, and auth / route / payload.
- Apply risk-control standards only to high-risk topics: legal, health, finance, politics, news, safety/security/privacy, or major career decisions.
- For high-risk topics, the answer can help Xiang frame a view, but it must not overclaim, invent facts, pretend expert certainty, or commit to unsafe action. It should say what is uncertain and recommend verification when needed.
- If the item is speaker-labelled background dialogue, not addressed to Xiang, or tagged as no-intervention, "No action needed yet." or another non-intervention response is correct. Penalize substantive replies in those cases.

Return strict JSON only:
[
  {"index":0,"verdict":"good|watch|bad","score":1-5,"issues":["short issue"]}
]

Items:
${JSON.stringify(judgeItems, null, 2)}`;

    try {
      const raw = await llmGenerate(judgeProvider, prompt, judgeModel, 120000, 5000);
      const parsed = parseJudgeItems(raw);
      for (const item of parsed) {
        if (results[item.index]) {
          const verdict = item.verdict === "bad" || item.verdict === "watch" || item.verdict === "good"
            ? item.verdict
            : "watch";
          results[item.index].judge = {
            verdict,
            score: Number(item.score) || 0,
            issues: Array.isArray(item.issues) ? item.issues.map(String) : [],
          };
        }
      }
    } catch (error) {
      console.warn(`LLM judge skipped for batch ${start}-${Math.min(start + batchSize - 1, results.length - 1)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main(): Promise<void> {
  const { conversationLogger } = await import("../src/server/data/conversation-logger");
  const { processConversation } = await import("../src/server/mastra/agents/initial-agent");

  const scenarioSource: ScenarioSpec[] = randomScenarioCount > 0
    ? buildRandomScenarioSpecs({
      count: randomScenarioCount,
      seed: randomSeed,
      asrRate: randomAsrRate,
      distribution: randomDistribution,
      asrSeverity: randomAsrSeverity,
    })
    : SCENARIOS;
  const availableScenarios = onlyScenarioIds.length
    ? scenarioSource.filter((spec) => onlyScenarioIds.includes(spec.id))
    : scenarioSource;
  if (!availableScenarios.length) {
    throw new Error(`No scenarios matched --only=${onlyScenarioIds.join(",")}`);
  }
  const selectedLimit = randomScenarioCount > 0 && !args.has("scenarios") ? randomScenarioCount : scenarioLimit;
  const selected = availableScenarios.slice(0, Math.max(1, Math.min(selectedLimit, availableScenarios.length)));
  if (randomScenarioCount > 0) {
    console.log(
      `[sim] random mode distribution=${randomDistribution} seed=${randomSeed} asrRate=${randomAsrRate} asrSeverity=${randomAsrSeverity || "mixed/default"} banks=${JSON.stringify(RANDOM_BANK_COUNTS)}`,
    );
  }
  const scenarioResults: ScenarioResult[] = [];
  const flatResults: TurnResult[] = [];

  for (const spec of selected) {
    console.log(`\n[sim] ${spec.id} (${sceneName(spec.scene)})`);
    const labelledHistory: string[] = [];
    const sayNextConversation: Conversation = [];
    const turns: TurnResult[] = [];
    const totalTurns = Math.max(1, Math.min(turnLimit, spec.maxTurns));

    for (let turn = 1; turn <= totalTurns; turn += 1) {
      const input = await simulateOtherTurn(spec, turn, labelledHistory);
      labelledHistory.push(`${spec.otherPerson}: ${input}`);
      sayNextConversation.push({ type: "transcript", text: input, timestamp: Date.now() + turn });

      const memoryQuery = sayNextConversation
        .filter((item) => item.type === "transcript")
        .map((item) => item.text)
        .slice(-4)
        .join("\n") || input;
      const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, memoryQuery, 5);
      const memoryRefs = conversationLogger.searchPersonalMemoriesHybrid(userId, memoryQuery, 5)
        .map((memory: any) => memory.sourceRef || memory.title);
      const start = performance.now();
      const response = await processConversation(
        sayNextConversation,
        "high",
        makeEventMemory(spec, labelledHistory),
        "english",
        "",
        formatSceneProfile(conversationLogger, spec.scene),
        relevantMemory,
      );
      const elapsedMs = Math.round(performance.now() - start);
      const output = response.type === "insight" ? response.output : "";
      const processTrace = response.type === "insight"
        ? ((response.metadata?.agentInput as any)?.processTrace as ProcessTraceSnapshot | undefined)
        : undefined;
      if (spec.id !== "public_dialogue_noise") {
        labelledHistory.push(`Xiang: ${output}`);
        if (output) sayNextConversation.push({ type: "transcript", text: output, timestamp: Date.now() + turn + 0.5 });
      }

      const result: TurnResult = {
        scenarioId: spec.id,
        turn,
        scene: spec.scene,
        distribution: spec.distribution,
        domain: spec.domain,
        technicalLevel: spec.technicalLevel,
        riskLevel: spec.riskLevel,
        memoryPolicy: spec.memoryPolicy,
        interventionPolicy: spec.interventionPolicy,
        asrSeverity: spec.asrSeverity,
        otherPerson: spec.otherPerson,
        input,
        output,
        elapsedMs,
        memoryRefs,
        processTrace,
        flags: outputFlags(spec, input, output, memoryRefs),
      };
      turns.push(result);
      flatResults.push(result);
      console.log(`  turn ${turn}: ${input}`);
      console.log(`  -> ${output || "(empty)"} (${elapsedMs}ms, route=${processTrace?.route || "unknown"}, rules=${processTrace?.rulesFired?.join("|") || "none"}, flags=${result.flags.join("|") || "none"})`);
    }

    scenarioResults.push({ spec, turns });
  }

  if (!skipJudge) await judgeResults(flatResults);
  attachReviewClasses(flatResults);
  const outDir = join(process.cwd(), "data", "eval");
  const processCandidatesPath = writeProcessCandidates(flatResults, { outDir });
  const reportPaths = writeConversationReport(scenarioResults, flatResults, {
    stamp,
    userId,
    sayNextProvider,
    sayNextModel: process.env.OLLAMA_MODEL,
    simulatorProvider,
    simulatorModel,
    judgeProvider,
    judgeModel,
    skipJudge,
    outDir,
    random: randomScenarioCount > 0
      ? {
        count: randomScenarioCount,
        seed: randomSeed,
        distribution: randomDistribution,
        asrRate: randomAsrRate,
        asrSeverity: randomAsrSeverity || "mixed/default",
        bankCounts: RANDOM_BANK_COUNTS,
      }
      : undefined,
  });
  const summary = countVerdicts(flatResults);
  const reviewSummary = countReviewClasses(flatResults);

  console.log(`\nLLM_SIMULATED_CONVERSATIONS done good=${summary.good} watch=${summary.watch} bad=${summary.bad}`);
  console.log(`Process summary: good=${reviewSummary.good} quality_watch=${reviewSummary.quality_watch} judge_false_positive=${reviewSummary.judge_false_positive} process_bad=${reviewSummary.process_bad}`);
  console.log(`Report: ${reportPaths.mdPath}`);
  console.log(`JSON: ${reportPaths.jsonPath}`);
  console.log(`Process candidates: ${processCandidatesPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
