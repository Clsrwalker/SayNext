import type {
  AsrSeverity,
  InterventionPolicy,
  MemoryPolicy,
  RandomScenarioDistribution,
  RiskLevel,
  TechnicalLevel,
  TopicDomain,
} from "./eval-random-scenario-banks";

export type SceneKey = "daily_chat" | "classroom" | "interview" | "meeting_group" | "service";

export type ScenarioSpec = {
  id: string;
  scene: SceneKey;
  otherPerson: string;
  situation: string;
  style: string;
  maxTurns: number;
  expectAny?: string[];
  rejectAny?: string[];
  shouldUseMemory?: string[];
  shouldAvoidPersonal?: boolean;
  asrNoise?: string;
  strictExpect?: boolean;
  distribution?: RandomScenarioDistribution;
  domain?: TopicDomain;
  technicalLevel?: TechnicalLevel;
  riskLevel?: RiskLevel;
  memoryPolicy?: MemoryPolicy;
  interventionPolicy?: InterventionPolicy;
  asrSeverity?: AsrSeverity;
};

export type TurnResult = {
  scenarioId: string;
  turn: number;
  scene: SceneKey;
  distribution?: RandomScenarioDistribution;
  domain?: TopicDomain;
  technicalLevel?: TechnicalLevel;
  riskLevel?: RiskLevel;
  memoryPolicy?: MemoryPolicy;
  interventionPolicy?: InterventionPolicy;
  asrSeverity?: AsrSeverity;
  otherPerson: string;
  input: string;
  output: string;
  elapsedMs: number;
  memoryRefs: string[];
  flags: string[];
  processTrace?: ProcessTraceSnapshot;
  processTaxonomy?: ProcessBadTaxonomy;
  judge?: LlmJudge;
  reviewClass?: ReviewClass;
  reviewReason?: string;
};

export type ScenarioResult = {
  spec: ScenarioSpec;
  turns: TurnResult[];
};

export type LlmJudge = {
  verdict: "good" | "watch" | "bad";
  score: number;
  issues: string[];
};

export type ReviewClass = "good" | "quality_watch" | "judge_false_positive" | "process_bad";

export type ProcessTraceSnapshot = {
  route?: string;
  source?: string;
  rulesFired?: string[];
  ruleReasoning?: string;
  processContract?: string[];
  promptMode?: string;
  riskLevel?: string;
  shouldUseOldContext?: boolean;
};

export type ProcessBadTaxonomy =
  | "route_misfire"
  | "over_trigger"
  | "context_stale"
  | "multi_intent_drop"
  | "technical_depth_low"
  | "evaluator_false_positive"
  | "grounding_boundary"
  | "risk_template_swallow"
  | "new_taxonomy_candidate";
