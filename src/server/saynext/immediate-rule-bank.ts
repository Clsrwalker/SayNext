import { type ImmediateRule, withImmediateRuleBank } from "./immediate-rule-registry";
import { CASUAL_IMMEDIATE_RULES } from "./immediate-rule-bank-casual";
import { CONVERSATION_IMMEDIATE_RULES } from "./immediate-rule-bank-conversation";
import { CORE_IMMEDIATE_RULES } from "./immediate-rule-bank-core";
import { CURRENT_AFFAIRS_IMMEDIATE_RULES } from "./immediate-rule-bank-current-affairs";
import { LOCALIZED_IMMEDIATE_RULES } from "./immediate-rule-bank-localized";
import { OPEN_TOPIC_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics";
import { OPEN_TOPIC_CASUAL_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-casual";
import { OPEN_TOPIC_PROCESS_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-process";
import { OPEN_TOPIC_RISK_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-risk";
import { OPEN_TOPIC_SERVICE_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-service";
import { PERSONAL_IMMEDIATE_RULES } from "./immediate-rule-bank-personal";
import { PERSONAL_MEMORY_IMMEDIATE_RULES } from "./immediate-rule-bank-personal-memory";
import { PROFILE_IMMEDIATE_RULES } from "./immediate-rule-bank-profile";
import { PROCESS_DEBUG_IMMEDIATE_RULES } from "./immediate-rule-bank-process-debug";
import { PROCESS_IMMEDIATE_RULES } from "./immediate-rule-bank-process";
import { PRODUCTIVITY_IMMEDIATE_RULES } from "./immediate-rule-bank-productivity";
import { PROJECT_PROFILE_IMMEDIATE_RULES } from "./immediate-rule-bank-project-profile";
import { RISK_EVIDENCE_IMMEDIATE_RULES } from "./immediate-rule-bank-risk-evidence";
import { RISK_IMMEDIATE_RULES } from "./immediate-rule-bank-risk";
import { SERVICE_FOOD_IMMEDIATE_RULES } from "./immediate-rule-bank-service-food";
import { SERVICE_LIFE_IMMEDIATE_RULES } from "./immediate-rule-bank-service-life";
import { TECH_IMMEDIATE_RULES } from "./immediate-rule-bank-tech";
import { TECH_CLASSROOM_IMMEDIATE_RULES } from "./immediate-rule-bank-tech-classroom";

// Bank responsibility: central registry composition only; concrete rules belong in domain-specific rule banks.
export const IMMEDIATE_RULES: ImmediateRule[] = [
  ...withImmediateRuleBank("core", CORE_IMMEDIATE_RULES),
  ...withImmediateRuleBank("localized", LOCALIZED_IMMEDIATE_RULES),
  ...withImmediateRuleBank("conversation", CONVERSATION_IMMEDIATE_RULES),
  ...withImmediateRuleBank("current_affairs", CURRENT_AFFAIRS_IMMEDIATE_RULES),
  ...withImmediateRuleBank("productivity", PRODUCTIVITY_IMMEDIATE_RULES),
  ...withImmediateRuleBank("open_topics", OPEN_TOPIC_IMMEDIATE_RULES),
  ...withImmediateRuleBank("open_topics_casual", OPEN_TOPIC_CASUAL_IMMEDIATE_RULES),
  ...withImmediateRuleBank("open_topics_risk", OPEN_TOPIC_RISK_IMMEDIATE_RULES),
  ...withImmediateRuleBank("open_topics_service", OPEN_TOPIC_SERVICE_IMMEDIATE_RULES),
  ...withImmediateRuleBank("open_topics_process", OPEN_TOPIC_PROCESS_IMMEDIATE_RULES),
  ...withImmediateRuleBank("service_life", SERVICE_LIFE_IMMEDIATE_RULES),
  ...withImmediateRuleBank("service_food", SERVICE_FOOD_IMMEDIATE_RULES),
  ...withImmediateRuleBank("risk", RISK_IMMEDIATE_RULES),
  ...withImmediateRuleBank("risk_evidence", RISK_EVIDENCE_IMMEDIATE_RULES),
  ...withImmediateRuleBank("tech", TECH_IMMEDIATE_RULES),
  ...withImmediateRuleBank("tech_classroom", TECH_CLASSROOM_IMMEDIATE_RULES),
  ...withImmediateRuleBank("process_debug", PROCESS_DEBUG_IMMEDIATE_RULES),
  ...withImmediateRuleBank("process", PROCESS_IMMEDIATE_RULES),
  ...withImmediateRuleBank("project_profile", PROJECT_PROFILE_IMMEDIATE_RULES),
  ...withImmediateRuleBank("profile", PROFILE_IMMEDIATE_RULES),
  ...withImmediateRuleBank("personal", PERSONAL_IMMEDIATE_RULES),
  ...withImmediateRuleBank("personal_memory", PERSONAL_MEMORY_IMMEDIATE_RULES),
  ...withImmediateRuleBank("casual", CASUAL_IMMEDIATE_RULES),
];
