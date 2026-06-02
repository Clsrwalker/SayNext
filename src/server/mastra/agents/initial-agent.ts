import type { Agent } from "@mastra/core/agent";
import { Action, AgentType, type AgentResponse, type Conversation } from "../types";
import type { EventMemorySnapshot } from "../../memory/event-memory";
import {
  type OpenAiConversationSession,
  type TranscriptCommitReason,
  isOpenAiConversationStateEnabled,
  shouldCommitTranscriptToOpenAiConversation,
} from "./openai-conversation-state";
import { normalizeKnownProjectAsrAliases } from "../../text/asr-corrections";
import { buildProcessTrace } from "../../saynext/process-router";
import {
  LLM_PROVIDER,
  MODEL_NAME,
  OLLAMA_MODEL,
  OPENAI_TIMEOUT_MS,
  generateWithOllama,
  initialAgentHigh,
  initialAgentLow,
  initialAgentMedium,
  resolveOpenAiModelConfig,
  withModelTimeout,
} from "../../saynext/model-runtime";
import { buildSayNextLiveTaskPrompt, sayNextInstructions } from "../../saynext/prompts";
import {
  buildLiveXiangProfile,
  compactRuntimeContextBlock,
  detectPromptMode,
  estimateTokens,
  filterRuntimePersonalMemoryContext,
  findLatestTranscriptIndex,
  formatCompactEventMemory,
} from "../../saynext/context-builder";
import {
  extractOutputField,
  finalizeSayNextOutput,
  sanitizeSayNextOutput,
  type OutputLanguage,
} from "../../saynext/output-postprocess";
import {
  createAgentInputMetadata,
  withProcessTrace,
} from "../../saynext/response-factory";
import {
  generateOptionalContinuation,
  generateTelepromptScript,
} from "../../saynext/teleprompt-runtime";
import {
  formatImmediateRouteHints,
  getContextAwareProjectImmediateResponse,
  getFallbackResponse,
  getImmediateDecision,
  getPrenoteExactAnswerImmediateResponse,
  getUnsupportedPremiseImmediateResponse,
} from "../../saynext/immediate-response";

export {
  PROCESS_RULES,
  matchSayNextProcessRules,
  routeSayNextProcess,
  type ProcessRoute,
  type ProcessRule,
  type ProcessRuleMatch,
  type ProcessTrace,
  type ProcessTraceSource,
  type PromptMode,
} from "../../saynext/process-router";

export {
  extractOutputField,
  finalizeSayNextOutput,
  generateOptionalContinuation,
  generateTelepromptScript,
  initialAgentHigh,
  initialAgentLow,
  initialAgentMedium,
  resolveOpenAiModelConfig,
  sanitizeSayNextOutput,
};
export type { OutputLanguage };

function getLatestTranscript(conversation: Conversation): string {
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const item = conversation[i];
    if (item.type === "transcript") return item.text;
  }
  return "";
}

export interface ProcessConversationOptions {
  openAiConversationSession?: OpenAiConversationSession;
  transcriptCommitReason?: TranscriptCommitReason;
}

export async function processConversation(
  conversation: Conversation,
  frequency: "low" | "medium" | "high" = "high",
  eventMemory?: EventMemorySnapshot,
  outputLanguage: OutputLanguage = "english",
  activePrenoteContext = "",
  activeSceneProfilePrompt = "",
  relevantPersonalMemoryContext = "",
  options: ProcessConversationOptions = {},
): Promise<AgentResponse> {
  const currentTimestamp = Date.now();
  const rawLatestTranscript = getLatestTranscript(conversation);
  const latestTranscript = normalizeKnownProjectAsrAliases(rawLatestTranscript);
  const promptMode = detectPromptMode(latestTranscript, eventMemory);
  const isClassroomMode = promptMode === "classroom";
  const latestTranscriptIndex = findLatestTranscriptIndex(conversation);
  const compactConversation = conversation
    .filter((_, index) => index !== latestTranscriptIndex)
    .slice(-4);
  const previousTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const hasRecentAgentOutput = compactConversation.some((item) => item.type === "insight" || item.type === "silent" || item.type === "route");

  const immediateDecision = isClassroomMode
    ? { response: null, routeHints: [] }
    : getImmediateDecision(latestTranscript, currentTimestamp, outputLanguage, {
      previousTranscriptTexts,
      hasPriorTranscript: previousTranscriptTexts.length > 0,
      hasRecentAgentOutput,
    });
  const immediateResponse = immediateDecision.response;
  if (immediateResponse) {
    return withProcessTrace(immediateResponse, latestTranscript, "immediate_rule", promptMode);
  }

  const immediateRouteHints = immediateDecision.routeHints;
  const formattedImmediateRouteHints = isClassroomMode ? "" : formatImmediateRouteHints(immediateRouteHints);
  const immediateHintRuleIds = immediateRouteHints.map((hint) => `hint:${hint.id}`);
  const retrievedSamples: { id: string }[] = [];

  const historyTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const formattedProfile = isClassroomMode ? "" : buildLiveXiangProfile(promptMode);
  const formattedEventMemory = isClassroomMode
    ? ""
    : formatCompactEventMemory(eventMemory, [latestTranscript, ...historyTranscriptTexts]);
  const formattedPrenoteContext = activePrenoteContext.trim()
    ? compactRuntimeContextBlock(activePrenoteContext.trim(), 1200)
    : "";
  const filteredPersonalMemoryContext = isClassroomMode
    ? ""
    : filterRuntimePersonalMemoryContext(
      relevantPersonalMemoryContext,
      latestTranscript,
      promptMode,
      eventMemory,
    );
  const formattedPersonalMemory = isClassroomMode
    ? ""
    : compactRuntimeContextBlock(filteredPersonalMemoryContext.trim() || "No relevant personal memory.", 1400);
  const trustedSupportContext = [
    formattedProfile,
    formattedEventMemory,
    formattedPersonalMemory,
    formattedPrenoteContext,
  ].filter(Boolean).join("\n");

  const prenoteExactResponse = getPrenoteExactAnswerImmediateResponse(latestTranscript, formattedPrenoteContext, currentTimestamp);
  if (prenoteExactResponse) {
    return withProcessTrace(prenoteExactResponse, latestTranscript, "context_rule", promptMode);
  }

  if (!isClassroomMode) {
    const unsupportedPremiseResponse = getUnsupportedPremiseImmediateResponse(latestTranscript, currentTimestamp, trustedSupportContext);
    if (unsupportedPremiseResponse) {
      return withProcessTrace(unsupportedPremiseResponse, latestTranscript, "context_rule", promptMode);
    }

    const recentTranscriptContext = previousTranscriptTexts.join("\n");
    const contextAwareProjectResponse = getContextAwareProjectImmediateResponse(latestTranscript, trustedSupportContext, currentTimestamp, recentTranscriptContext);
    if (contextAwareProjectResponse) {
      return withProcessTrace(contextAwareProjectResponse, latestTranscript, "context_rule", promptMode);
    }
  }

  const stablePromptPrefix = buildSayNextLiveTaskPrompt({
    formattedSceneProfile: isClassroomMode
      ? ""
      : compactRuntimeContextBlock(activeSceneProfilePrompt.trim(), 900),
    promptMode,
    supportContext: isClassroomMode ? formattedPrenoteContext : compactRuntimeContextBlock(trustedSupportContext, 2600),
    routeHints: formattedImmediateRouteHints,
  });

  const outputLanguageText = outputLanguage === "chinese" ? "Chinese" : "English";
  const dynamicPromptCore = `Output language: ${outputLanguageText}`;
  const dynamicPromptSuffix = `${dynamicPromptCore}\n\nCurrent transcript: ${latestTranscript}`;
  const openAiConversationInstructions = `${sayNextInstructions}\n\n${stablePromptPrefix}\n\n${dynamicPromptCore}`;

  const prompt = `${stablePromptPrefix}\n\n${dynamicPromptSuffix}`;
  const cacheablePrefix = `${sayNextInstructions}\n\n${stablePromptPrefix}`;
  const openAiConversationReady = Boolean(options.openAiConversationSession)
    && isOpenAiConversationStateEnabled(LLM_PROVIDER)
    && shouldCommitTranscriptToOpenAiConversation(options.transcriptCommitReason ?? "final");

  console.log(
    `[SayNext] Input approx tokens: system=${estimateTokens(sayNextInstructions)} prompt=${estimateTokens(prompt)} cacheablePrefix=${estimateTokens(cacheablePrefix)} dynamic=${estimateTokens(dynamicPromptSuffix)} total=${estimateTokens(`${sayNextInstructions}\n\n${prompt}`)} mode=${promptMode}${openAiConversationReady ? ` openaiConversation=enabled conversationRequest=${estimateTokens(openAiConversationInstructions) + estimateTokens(latestTranscript)}` : ""}`,
  );

  try {
    let agent: Agent<any, any>;
    switch (frequency) {
      case "low":
        agent = initialAgentLow;
        break;
      case "medium":
        agent = initialAgentMedium;
        break;
      case "high":
      default:
        agent = initialAgentHigh;
        break;
    }

    console.log(`>> Using agent brain: ${LLM_PROVIDER === "ollama" ? `Ollama:${OLLAMA_MODEL}` : openAiConversationReady ? `${agent.name}:conversation-state` : agent.name}`);

    let openAiConversationMetadata: Record<string, unknown> | undefined;
    let responseText: string;
    if (LLM_PROVIDER === "ollama") {
      responseText = await generateWithOllama(prompt);
    } else if (openAiConversationReady && options.openAiConversationSession) {
      try {
        const result = await options.openAiConversationSession.generate({
          model: MODEL_NAME,
          instructions: openAiConversationInstructions,
          latestTranscript,
          timeoutMs: OPENAI_TIMEOUT_MS,
        });
        responseText = result.text;
        openAiConversationMetadata = {
          enabled: true,
          conversationId: result.conversationId,
          responseId: result.responseId,
          deletedAssistantOutputItemIds: result.deletedOutputItemIds,
          omittedRecentHistoryFromPrompt: true,
          transcriptCommitReason: options.transcriptCommitReason ?? "final",
          estimatedInstructionTokens: estimateTokens(openAiConversationInstructions),
          estimatedUserInputTokens: estimateTokens(latestTranscript),
        };
      } catch (error) {
        console.warn(`OpenAI conversation-state request failed; falling back to normal OpenAI prompt: ${error instanceof Error ? error.message : String(error)}`);
        responseText = (await withModelTimeout(agent.generate(prompt), OPENAI_TIMEOUT_MS, "OpenAI SayNext fallback request")).text;
        openAiConversationMetadata = {
          enabled: true,
          fallback: true,
          error: error instanceof Error ? error.message : String(error),
          transcriptCommitReason: options.transcriptCommitReason ?? "final",
        };
      }
    } else {
      responseText = (await withModelTimeout(agent.generate(prompt), OPENAI_TIMEOUT_MS, "OpenAI SayNext request")).text;
    }

    if (responseText) {
      if (LLM_PROVIDER === "ollama") {
        const extractedOutput = extractOutputField(responseText);
        const looksLikeJson = /^\s*\{/.test(responseText);

        if (looksLikeJson && !extractedOutput) {
          const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
          if (fallback.type === Action.INSIGHT) {
            fallback.reasoning = "Fallback after Ollama returned malformed JSON without an output field";
            fallback.metadata.agentInput = createAgentInputMetadata({
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
              processTrace: buildProcessTrace({
                transcript: latestTranscript,
                output: fallback.output,
                reasoning: fallback.reasoning,
                source: "fallback",
                promptMode,
              }),
            });
          }
          return fallback;
        }

        const reasoning = extractedOutput
          ? "Ollama returned partial JSON; extracted output field"
          : "Generated SayNext reply with Ollama";
        const output = finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory, promptMode);
        return {
          type: Action.INSIGHT,
          reasoning,
          timestamp: currentTimestamp,
          output,
          confidence: extractedOutput ? 0.5 : 0.7,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: createAgentInputMetadata({
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
              openAiConversation: openAiConversationMetadata,
              processTrace: buildProcessTrace({
                transcript: latestTranscript,
                output,
                reasoning,
                source: "model_generation",
                promptMode,
                rulesFired: immediateHintRuleIds.length
                  ? [...immediateHintRuleIds, "model-ollama-generation"]
                  : undefined,
                ruleId: "model-ollama-generation",
              }),
            }),
          },
        };
      }

      const extractedOutput = extractOutputField(responseText);
      const reasoning = extractedOutput
        ? "OpenAI returned structured text; extracted output field"
        : "Generated SayNext reply with OpenAI";
      const output = finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory, promptMode);
      return {
        type: Action.INSIGHT,
        reasoning,
        timestamp: currentTimestamp,
        output,
        confidence: extractedOutput ? 0.6 : 0.8,
        metadata: {
          agentType: AgentType.Initial,
          agentInput: createAgentInputMetadata({
            retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            openAiConversation: openAiConversationMetadata,
            processTrace: buildProcessTrace({
              transcript: latestTranscript,
              output,
              reasoning,
              source: "model_generation",
              promptMode,
              rulesFired: immediateHintRuleIds.length
                ? [...immediateHintRuleIds, "model-openai-generation"]
                : undefined,
              ruleId: "model-openai-generation",
            }),
          }),
        },
      };
    }

    return {
      type: Action.INSIGHT,
      reasoning: "No model text returned",
      timestamp: currentTimestamp,
      output: "Sorry, could you say that again?",
      confidence: 0.3,
      metadata: {
        agentType: AgentType.Initial,
        agentInput: createAgentInputMetadata({
          retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
          openAiConversation: openAiConversationMetadata,
          processTrace: buildProcessTrace({
            transcript: latestTranscript,
            output: "Sorry, could you say that again?",
            reasoning: "No model text returned",
            source: "fallback",
            promptMode,
          }),
        }),
      },
    };
  } catch (error) {
    console.error("Error in processConversation:", error);
    const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
    if (fallback.type === Action.INSIGHT) {
      fallback.reasoning = `Fallback after model error: ${error instanceof Error ? error.message : "Unknown error"}`;
      fallback.metadata.agentInput = createAgentInputMetadata({
        retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
        processTrace: buildProcessTrace({
          transcript: latestTranscript,
          output: fallback.output,
          reasoning: fallback.reasoning,
          source: "fallback",
          promptMode,
        }),
      });
    }
    return fallback;
  }
}
