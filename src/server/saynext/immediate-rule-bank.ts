import type { ImmediateRule } from "./immediate-rule-registry";
import { CASUAL_IMMEDIATE_RULES } from "./immediate-rule-bank-casual";
import { CONVERSATION_IMMEDIATE_RULES } from "./immediate-rule-bank-conversation";
import { CORE_IMMEDIATE_RULES } from "./immediate-rule-bank-core";
import { CURRENT_AFFAIRS_IMMEDIATE_RULES } from "./immediate-rule-bank-current-affairs";
import { LOCALIZED_IMMEDIATE_RULES } from "./immediate-rule-bank-localized";
import { OPEN_TOPIC_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics";
import { OPEN_TOPIC_PROCESS_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-process";
import { OPEN_TOPIC_RISK_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-risk";
import { OPEN_TOPIC_SERVICE_IMMEDIATE_RULES } from "./immediate-rule-bank-open-topics-service";
import { PERSONAL_IMMEDIATE_RULES } from "./immediate-rule-bank-personal";
import { PROFILE_IMMEDIATE_RULES } from "./immediate-rule-bank-profile";
import { PROCESS_IMMEDIATE_RULES } from "./immediate-rule-bank-process";
import { PRODUCTIVITY_IMMEDIATE_RULES } from "./immediate-rule-bank-productivity";
import { PROJECT_PROFILE_IMMEDIATE_RULES } from "./immediate-rule-bank-project-profile";
import { RISK_IMMEDIATE_RULES } from "./immediate-rule-bank-risk";
import { SERVICE_LIFE_IMMEDIATE_RULES } from "./immediate-rule-bank-service-life";
import { TECH_IMMEDIATE_RULES } from "./immediate-rule-bank-tech";
import { TECH_CLASSROOM_IMMEDIATE_RULES } from "./immediate-rule-bank-tech-classroom";

export const IMMEDIATE_RULES: ImmediateRule[] = [
  ...CORE_IMMEDIATE_RULES,
  ...LOCALIZED_IMMEDIATE_RULES,
  ...CONVERSATION_IMMEDIATE_RULES,
  ...CURRENT_AFFAIRS_IMMEDIATE_RULES,
  ...PRODUCTIVITY_IMMEDIATE_RULES,
  ...OPEN_TOPIC_IMMEDIATE_RULES,
  ...OPEN_TOPIC_RISK_IMMEDIATE_RULES,
  ...OPEN_TOPIC_SERVICE_IMMEDIATE_RULES,
  ...OPEN_TOPIC_PROCESS_IMMEDIATE_RULES,
  ...SERVICE_LIFE_IMMEDIATE_RULES,
  ...RISK_IMMEDIATE_RULES,
  ...TECH_IMMEDIATE_RULES,
  ...TECH_CLASSROOM_IMMEDIATE_RULES,
  ...PROCESS_IMMEDIATE_RULES,
  ...PROJECT_PROFILE_IMMEDIATE_RULES,
  ...PROFILE_IMMEDIATE_RULES,
  ...PERSONAL_IMMEDIATE_RULES,
  ...CASUAL_IMMEDIATE_RULES,
];
