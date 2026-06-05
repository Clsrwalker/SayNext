import type { Agent } from "@mastra/core/agent";
import { Action, AgentType, type AgentResponse, type Conversation } from "../types";
import type { EventMemorySnapshot } from "../../memory/event-memory";
import {
  buildOpenAiConversationInput,
  type OpenAiConversationSession,
  type TranscriptCommitReason,
  isOpenAiConversationStateEnabled,
  shouldCommitTranscriptToOpenAiConversation,
} from "./openai-conversation-state";
import { classifyAnswerIntent } from "../../saynext/answer-intent";
import {
  generateAnswerPlanShadow,
  shouldApplyAnswerPlannerMemoryPolicy,
  type AnswerPlannerShadowMetadata,
} from "../../saynext/answer-planner-runtime";
import { resolveFinalAnswerStrategy } from "../../saynext/answer-strategy";
import { normalizeKnownProjectAsrAliases } from "../../text/asr-corrections";
import { buildProcessTrace } from "../../saynext/process-router";
import type { PromptMode } from "../../saynext/process-router";
import type { PlannerMemoryRetrievalDecision } from "../../saynext/planner-memory-policy";
import {
  LLM_PROVIDER,
  MODEL_NAME,
  OLLAMA_MODEL,
  OPENAI_TIMEOUT_MS,
  evenHubAgentHigh,
  evenHubAgentLow,
  evenHubAgentMedium,
  generateWithOllama,
  initialAgentHigh,
  initialAgentLow,
  initialAgentMedium,
  resolveOpenAiModelConfig,
  withModelTimeout,
} from "../../saynext/model-runtime";
import { buildSayNextLiveTaskPrompt, sayNextConversationStateInstructions, sayNextInstructions } from "../../saynext/prompts";
import {
  buildEvenHubLiveTaskPrompt,
  evenHubConversationStateInstructions,
  evenHubManualResponseInstruction,
  evenHubSystemInstructions,
} from "../../evenhub/prompts";
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
  responseStyle?: "auto" | "manual";
  promptModeOverride?: PromptMode;
  promptPreset?: "saynext" | "evenhub";
  transcriptContext?: string;
  answerPlannerMetadata?: AnswerPlannerShadowMetadata;
  memoryRetrievalDecision?: PlannerMemoryRetrievalDecision;
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
  const promptMode = options.promptModeOverride || detectPromptMode(latestTranscript, eventMemory);
  const formattedTranscriptContext = options.transcriptContext?.trim() || "";
  const outputLanguageText = outputLanguage === "chinese" ? "Chinese" : "English";
  const transcriptForIntent = [
    formattedTranscriptContext,
    latestTranscript,
  ].filter(Boolean).join("\n");
  const answerIntent = classifyAnswerIntent(transcriptForIntent || latestTranscript, promptMode, eventMemory);
  const promptPreset = options.promptPreset === "evenhub" ? "evenhub" : "saynext";
  const systemInstructions = promptPreset === "evenhub" ? evenHubSystemInstructions : sayNextInstructions;
  const conversationStateInstructions = promptPreset === "evenhub" ? evenHubConversationStateInstructions : sayNextConversationStateInstructions;
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
  const baseFilteredPersonalMemoryContext = isClassroomMode
    ? ""
    : filterRuntimePersonalMemoryContext(
      relevantPersonalMemoryContext,
      latestTranscript,
      promptMode,
      eventMemory,
    );
  const answerPlannerMetadata: AnswerPlannerShadowMetadata | undefined = options.answerPlannerMetadata ?? await generateAnswerPlanShadow({
    activeScene: promptMode,
    sceneLocked: Boolean(options.promptModeOverride),
    latestUtterance: latestTranscript,
    recentTranscript: formattedTranscriptContext || previousTranscriptTexts.join("\n"),
    outputLanguage: outputLanguageText,
    legacyAnswerIntent: answerIntent,
    eventMemorySummary: [
      eventMemory?.scene ? `scene=${eventMemory.scene}` : "",
      eventMemory?.title ? `title=${eventMemory.title}` : "",
      eventMemory?.summary ? `summary=${eventMemory.summary}` : "",
    ].filter(Boolean).join("; "),
    hasPreparedNote: Boolean(formattedPrenoteContext.trim()),
    hasPersonalMemoryCandidates: Boolean(baseFilteredPersonalMemoryContext.trim()),
  });
  if (answerPlannerMetadata?.enabled) {
    const plan = answerPlannerMetadata.plan || answerPlannerMetadata.fallbackPlan;
    console.log(
      `[SayNextPlanner] task=${plan?.task || "unknown"} shape=${plan?.outputShape || "unknown"} depth=${plan?.answerDepth || "unknown"} memory=${answerPlannerMetadata.resolvedPolicy?.needsMemory ? "yes" : "no"} code=${answerPlannerMetadata.resolvedPolicy?.needsCode ? "yes" : "no"}${answerPlannerMetadata.error ? ` error=${answerPlannerMetadata.error}` : ""}`,
    );
  }
  const applyPlannerMemoryPolicy = shouldApplyAnswerPlannerMemoryPolicy(answerPlannerMetadata);
  const filteredPersonalMemoryContext = applyPlannerMemoryPolicy && !answerPlannerMetadata?.resolvedPolicy?.needsMemory
    ? ""
    : baseFilteredPersonalMemoryContext;
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

  const finalAnswerStrategy = resolveFinalAnswerStrategy({
    legacyAnswerIntent: answerIntent,
    answerPlannerMetadata,
  });
  const outputPostprocessOptions = {
    answerIntent,
    answerOutputShape: finalAnswerStrategy.answerOutputShape,
  };
  const answerPlannerMetadataForLog = answerPlannerMetadata && options.memoryRetrievalDecision
    ? {
      ...answerPlannerMetadata,
      finalAnswerStrategy: {
        source: finalAnswerStrategy.source,
        conversationStrategy: finalAnswerStrategy.conversationStrategy,
        legacyAnswerIntent: answerIntent,
      },
      memoryRetrievalDecision: options.memoryRetrievalDecision,
    }
    : answerPlannerMetadata
      ? {
        ...answerPlannerMetadata,
        finalAnswerStrategy: {
          source: finalAnswerStrategy.source,
          conversationStrategy: finalAnswerStrategy.conversationStrategy,
          legacyAnswerIntent: answerIntent,
        },
      }
    : answerPlannerMetadata;

  const stablePromptPrefix = (promptPreset === "evenhub" ? buildEvenHubLiveTaskPrompt : buildSayNextLiveTaskPrompt)({
    formattedSceneProfile: isClassroomMode
      ? ""
      : compactRuntimeContextBlock(activeSceneProfilePrompt.trim(), 900),
    promptMode,
    supportContext: isClassroomMode ? formattedPrenoteContext : compactRuntimeContextBlock(trustedSupportContext, 2600),
    routeHints: formattedImmediateRouteHints,
    answerIntentHint: finalAnswerStrategy.promptHint,
  });

  const manualResponseInstruction = options.responseStyle === "manual"
    ? promptPreset === "evenhub"
      ? evenHubManualResponseInstruction
      : "Manual G2 display: write the exact words Xiang can say now, usually in first person. No word-count target or minimum; use only the length needed. Technical or interview answers can use more detail when depth is useful. For explicit coding interview requests, include the actual code or pseudocode plus a short explanation, not only a verbal plan; code indentation and short comments are allowed. Do not use labels or advice about how to answer."
    : "";
  const conversationStateTaskHint = [
    finalAnswerStrategy.promptHint,
    isClassroomMode
      ? "Classroom mode: if the transcript is a clear question, answer it directly using general knowledge; do not ask for repetition unless the transcript is genuinely unclear."
      : "",
    manualResponseInstruction,
  ].filter(Boolean).join("\n");
  const conversationStateSupportContext = isClassroomMode
    ? ""
    : compactRuntimeContextBlock([
      formattedProfile,
      formattedEventMemory,
      formattedPersonalMemory,
    ].filter(Boolean).join("\n"), 2200);
  const dynamicPromptCore = [
    `Output language: ${outputLanguageText}`,
    manualResponseInstruction,
  ].filter(Boolean).join("\n");
  const dynamicPromptSuffix = [
    dynamicPromptCore,
    formattedTranscriptContext
      ? `Transcript context since last request, use as background only:\n${formattedTranscriptContext}`
      : "",
    `Current transcript: ${latestTranscript}`,
  ].filter(Boolean).join("\n\n");
  const openAiConversationInput = buildOpenAiConversationInput(latestTranscript, {
    outputLanguage: outputLanguageText,
    promptMode,
    answerIntent: finalAnswerStrategy.conversationIntent,
    answerStrategy: finalAnswerStrategy.conversationStrategy,
    supportContext: conversationStateSupportContext,
    preparedNote: formattedPrenoteContext,
    taskHint: conversationStateTaskHint,
    transcriptContext: formattedTranscriptContext,
  });

  const prompt = `${stablePromptPrefix}\n\n${dynamicPromptSuffix}`;
  const cacheablePrefix = `${systemInstructions}\n\n${stablePromptPrefix}`;
  const openAiConversationReady = Boolean(options.openAiConversationSession)
    && isOpenAiConversationStateEnabled(LLM_PROVIDER)
    && shouldCommitTranscriptToOpenAiConversation(options.transcriptCommitReason ?? "final");

  console.log(
    `[SayNext] Input approx tokens: preset=${promptPreset} system=${estimateTokens(systemInstructions)} prompt=${estimateTokens(prompt)} cacheablePrefix=${estimateTokens(cacheablePrefix)} dynamic=${estimateTokens(dynamicPromptSuffix)} total=${estimateTokens(`${systemInstructions}\n\n${prompt}`)} mode=${promptMode}${openAiConversationReady ? ` openaiConversation=enabled conversationSeed=${estimateTokens(conversationStateInstructions)} conversationInput=${estimateTokens(openAiConversationInput)}` : ""}`,
  );

  try {
    let agent: Agent<any, any>;
    switch (frequency) {
      case "low":
        agent = promptPreset === "evenhub" ? evenHubAgentLow : initialAgentLow;
        break;
      case "medium":
        agent = promptPreset === "evenhub" ? evenHubAgentMedium : initialAgentMedium;
        break;
      case "high":
      default:
        agent = promptPreset === "evenhub" ? evenHubAgentHigh : initialAgentHigh;
        break;
    }

    console.log(`>> Using agent brain: ${LLM_PROVIDER === "ollama" ? `Ollama:${OLLAMA_MODEL}` : openAiConversationReady ? `${agent.name}:conversation-state` : agent.name}`);

    let openAiConversationMetadata: Record<string, unknown> | undefined;
    let responseText: string;
    if (LLM_PROVIDER === "ollama") {
      responseText = await generateWithOllama(prompt, systemInstructions);
    } else if (openAiConversationReady && options.openAiConversationSession) {
      try {
        const result = await options.openAiConversationSession.generate({
          model: MODEL_NAME,
          seedInstructions: conversationStateInstructions,
          latestTranscript,
          outputLanguage: outputLanguageText,
          promptMode,
          answerIntent: finalAnswerStrategy.conversationIntent,
          answerStrategy: finalAnswerStrategy.conversationStrategy,
          taskHint: conversationStateTaskHint,
          transcriptContext: formattedTranscriptContext,
          supportContext: conversationStateSupportContext,
          preparedNote: formattedPrenoteContext,
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
          seededInstructionsInConversation: true,
          requestIncludedInstructions: false,
          estimatedSeedInstructionTokens: estimateTokens(conversationStateInstructions),
          estimatedUserInputTokens: estimateTokens(openAiConversationInput),
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
              answerPlanner: answerPlannerMetadataForLog,
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
        const output = finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory, promptMode, outputPostprocessOptions);
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
              answerPlanner: answerPlannerMetadataForLog,
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
      const output = finalizeSayNextOutput(extractedOutput ?? responseText, latestTranscript, outputLanguage, eventMemory, promptMode, outputPostprocessOptions);
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
            answerPlanner: answerPlannerMetadataForLog,
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
          answerPlanner: answerPlannerMetadataForLog,
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
        answerPlanner: answerPlannerMetadataForLog,
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
