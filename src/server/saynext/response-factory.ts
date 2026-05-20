import { Action, AgentType, type AgentResponse } from "../mastra/types";
import {
  buildProcessTrace,
  type ProcessTrace,
  type ProcessTraceSource,
  type PromptMode,
} from "./process-router";
import { sanitizeSayNextOutput } from "./output-postprocess";
import { ACTIVE_MODEL_NAME } from "./model-runtime";

export const PROFILE_VERSION = "3.0";

export function createAgentInputMetadata(params: {
  model?: string;
  retrievedSampleIds?: string[];
  processTrace: ProcessTrace;
  openAiConversation?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    model: params.model || ACTIVE_MODEL_NAME,
    profileVersion: PROFILE_VERSION,
    retrievedSampleIds: params.retrievedSampleIds || [],
    processTrace: params.processTrace,
    ...(params.openAiConversation ? { openAiConversation: params.openAiConversation } : {}),
  };
}

export function withProcessTrace(
  response: AgentResponse,
  transcript: string,
  source: ProcessTraceSource,
  promptMode?: PromptMode,
): AgentResponse {
  if (response.type !== Action.INSIGHT) return response;
  const existingTrace = (response.metadata.agentInput as any)?.processTrace as ProcessTrace | undefined;
  response.metadata.agentInput = {
    ...(response.metadata.agentInput || {}),
    processTrace: buildProcessTrace({
      transcript,
      output: response.output,
      reasoning: response.reasoning,
      source,
      promptMode,
      ruleId: existingTrace?.rulesFired?.[0],
    }),
  };
  return response;
}

export function createInsight(
  output: string,
  reasoning: string,
  timestamp: number,
  confidence = 0.9,
  ruleId?: string,
): AgentResponse {
  const cleanedOutput = sanitizeSayNextOutput(output);
  return {
    type: Action.INSIGHT,
    reasoning,
    timestamp,
    output: cleanedOutput,
    confidence,
    metadata: {
      agentType: AgentType.Initial,
      agentInput: createAgentInputMetadata({
        processTrace: buildProcessTrace({
          output: cleanedOutput,
          reasoning,
          source: "immediate_rule",
          ruleId,
        }),
      }),
    },
  };
}
