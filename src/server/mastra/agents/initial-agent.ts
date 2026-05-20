import type { Agent } from "@mastra/core/agent";
import { Action, AgentType, type Conversation, type AgentResponse } from "../types";
import type { EventMemorySnapshot } from "../../memory/event-memory";
import {
  type OpenAiConversationSession,
  type TranscriptCommitReason,
  isOpenAiConversationStateEnabled,
  shouldCommitTranscriptToOpenAiConversation,
} from "./openai-conversation-state";
import { buildKnownTermAsrPromptHint, normalizeKnownProjectAsrAliases } from "../../text/asr-corrections";
import {
  buildProcessTrace,
} from "../../saynext/process-router";
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
import { sayNextInstructions } from "../../saynext/prompts";
import {
  buildCompactXiangProfile,
  buildGeneralAsrPromptHint,
  buildProcessHint,
  detectPromptMode,
  estimateTokens,
  filterRuntimePersonalMemoryContext,
  findLatestTranscriptIndex,
  formatCompactEventMemory,
} from "../../saynext/context-builder";
import {
  extractOutputField,
  finalizeSayNextOutput,
  looksLikeQuestion,
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
  initialAgentHigh,
  initialAgentLow,
  initialAgentMedium,
  generateOptionalContinuation,
  generateTelepromptScript,
  resolveOpenAiModelConfig,
  sanitizeSayNextOutput,
};
export type { OutputLanguage };

function getLatestTranscript(conversation: Conversation): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const item = conversation[i];
    if (item.type === 'transcript') {
      return item.text;
    }
  }

  return "";
}

export interface ProcessConversationOptions {
  openAiConversationSession?: OpenAiConversationSession;
  transcriptCommitReason?: TranscriptCommitReason;
}

export async function processConversation(
  conversation: Conversation,
  frequency: 'low' | 'medium' | 'high' = 'high',
  eventMemory?: EventMemorySnapshot,
  outputLanguage: OutputLanguage = "english",
  activePrenoteContext = "",
  activeSceneProfilePrompt = "",
  relevantPersonalMemoryContext = "",
  options: ProcessConversationOptions = {},
): Promise<AgentResponse> {
  const currentTimestamp = Date.now();
  const currentDate = new Date(currentTimestamp).toISOString();
  const rawLatestTranscript = getLatestTranscript(conversation);
  const latestTranscript = normalizeKnownProjectAsrAliases(rawLatestTranscript);
  const asrCorrectionHint = [
    buildKnownTermAsrPromptHint(rawLatestTranscript),
    buildGeneralAsrPromptHint(rawLatestTranscript),
  ].filter(Boolean).join("\n");
  const promptMode = detectPromptMode(latestTranscript, eventMemory);
  const latestTranscriptIndex = findLatestTranscriptIndex(conversation);
  const compactConversation = conversation
    .filter((_, index) => index !== latestTranscriptIndex)
    .slice(-4);
  const previousTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const hasRecentAgentOutput = compactConversation.some((item) => item.type === "insight" || item.type === "silent" || item.type === "route");

  const immediateDecision = getImmediateDecision(latestTranscript, currentTimestamp, outputLanguage, {
    previousTranscriptTexts,
    hasPriorTranscript: previousTranscriptTexts.length > 0,
    hasRecentAgentOutput,
  });
  const immediateResponse = immediateDecision.response;
  if (immediateResponse) {
    return withProcessTrace(immediateResponse, latestTranscript, "immediate_rule", promptMode);
  }
  const immediateRouteHints = immediateDecision.routeHints;
  const formattedImmediateRouteHints = formatImmediateRouteHints(immediateRouteHints);
  const immediateHintRuleIds = immediateRouteHints.map((hint) => `hint:${hint.id}`);

  const processHint = buildProcessHint(latestTranscript, promptMode);
  const latestLooksLikeQuestion = looksLikeQuestion(latestTranscript);
  const formattedHistoryLines: string[] = [];
  for (const item of compactConversation) {
    switch (item.type) {
      case 'transcript':
        formattedHistoryLines.push(`Transcript: "${item.text}"`);
        break;
      case 'insight':
        // Previous suggestions are model outputs, not conversation audio.
        // Keeping them out of the prompt prevents the model from replying to itself.
        break;
      case 'silent':
        formattedHistoryLines.push(`Previous non-response: "${item.reasoning}"`);
        break;
      case 'route':
        formattedHistoryLines.push(`Previous route decision: "${item.reasoning}"`);
        break;
    }
  }

  const formattedHistory = `--- RECENT CONVERSATION ---\n${formattedHistoryLines.join('\n')}\n--- END CONVERSATION ---`;
  const retrievedSamples: { id: string }[] = [];
  const formattedProfile = buildCompactXiangProfile(promptMode);
  const historyTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const formattedEventMemory = formatCompactEventMemory(eventMemory, [latestTranscript, ...historyTranscriptTexts]);
  const formattedPrenoteContext = activePrenoteContext.trim() || "No active prenote.";
  const formattedSceneProfile = activeSceneProfilePrompt.trim() || "No active scene profile.";
  const filteredPersonalMemoryContext = filterRuntimePersonalMemoryContext(
    relevantPersonalMemoryContext,
    latestTranscript,
    promptMode,
    eventMemory,
  );
  const formattedPersonalMemory = filteredPersonalMemoryContext.trim() || "No relevant personal memory.";
  const trustedSupportContext = [
    formattedProfile,
    formattedSceneProfile,
    formattedEventMemory,
    formattedPersonalMemory,
    formattedPrenoteContext,
  ].join("\n");
  const prenoteExactResponse = getPrenoteExactAnswerImmediateResponse(latestTranscript, formattedPrenoteContext, currentTimestamp);
  if (prenoteExactResponse) {
    return withProcessTrace(prenoteExactResponse, latestTranscript, "context_rule", promptMode);
  }

  const unsupportedPremiseResponse = getUnsupportedPremiseImmediateResponse(latestTranscript, currentTimestamp, trustedSupportContext);
  if (unsupportedPremiseResponse) {
    return withProcessTrace(unsupportedPremiseResponse, latestTranscript, "context_rule", promptMode);
  }

  const contextAwareProjectResponse = getContextAwareProjectImmediateResponse(latestTranscript, trustedSupportContext, currentTimestamp, formattedHistory);
  if (contextAwareProjectResponse) {
    return withProcessTrace(contextAwareProjectResponse, latestTranscript, "context_rule", promptMode);
  }

  console.log("\n--- SayNext Agent Context ---\n", formattedHistory, "\n-----------------------------\n");
  const stablePromptPrefix = `Task:
- Use the latest transcript as the trigger and follow the active scene profile first.
- Direct question: answer directly. Lecture/explanation: add a useful supplement or question. Casual: keep it natural. Meeting: move the task forward.
- Use the process hint as the decision procedure. Do not just pattern-match one keyword from the transcript.
- If the transcript contains multiple possible topics, choose the latest or most actionable direct question. Do not let a side phrase hijack the answer.
- Output must read like something Xiang can say out loud immediately. Avoid quoted terms, parentheses, Markdown backticks, e.g., and spec-doc phrasing.
- If an ASR correction hint is present, treat it as a candidate interpretation of noisy speech. Use it when it fits the context and retrieved memory; otherwise ask one short clarification. Do not repeat weird ASR artifacts as if they are meaningful.
- Never output placeholders like X, Y, Z, [date], [insert details], or fake exact values. If exact status is missing, say what needs to be confirmed.
- For live meeting replies, keep it to one or two short spoken sentences. Do not pack multiple document actions into one long sentence.
- If the transcript asks Xiang's name, identity, or name pronunciation, answer with Xiang Li / Xiang; never echo a wrong name.
- If someone suggests adding a new feature before fixing a known bug/blocker, push back gently and prioritize the core bug first.
- For public-facing project or interview answers, use "Hybrid Search Memory Assistant" as the name for SayNext unless the conversation is clearly internal.
- Use active prenote memory as prepared context when relevant. It is stronger than generic knowledge, but do not force it if unrelated.
- If the active prenote contains an exact date, room, deadline, rubric item, API field, requirement, or policy that answers the latest transcript, use that exact detail instead of guessing.
- Use relevant personal memory only when it directly helps; do not volunteer sensitive details.
- Do not mention memory source refs, categories, or usage rules. If a relevant memory has source ref starting with knowledge:xiang-playbook:, treat it as a response playbook only: use its logic, but do not claim Xiang lived that exact event.
- For conflict, feedback, deadline, debugging, demo-pressure, unclear-requirement, or unknown-answer situations, a response playbook can supply the reasoning path when no exact personal story exists.
- For daily/IELTS life questions, do not invent specific named movies, shows, stores, restaurants, parks, rooms, parties, trips, valuable items, friends, animal encounters, or recent events. If memory is missing, answer generally and modestly.
- Avoid forced return questions like "How about you?", "What happened after that?", "ready?", "right?", or "huh?" unless the user explicitly asks for a question to say or the question is operationally necessary.
- If the transcript asks why/origin/motivation for Xiang's own project or interest, and relevant personal memory contains an explicit origin, lead with that origin before technical details.
- Personality, self-image, identity-belonging, mentor, relationship, political-values, and social-confidence memory is private shaping context. Use it only when the latest transcript directly asks about motivation, work style, confidence, self-image, social style, identity/belonging, important mentors, dating/relationship boundaries, political values, or future/workplace preference. Phrase it modestly and safely; do not quote raw insecurity like "too dumb", name private mentors, or volunteer political opinions unless Xiang explicitly asks for that topic.
- High-stakes money, contract, lease, medical, legal, or non-refundable transaction pressure: do not agree or commit for Xiang. Use a cautious, sayable line asking to review, confirm in writing, or check with the right person.
- Formal ceremony/toast/speech moments: be warm, simple, respectful, and not slangy.
- If the latest transcript asks what question Xiang should ask in class or after a lecture, output one short student-like question only. Make it low-profile and natural, often with "would it be" or "so basically"; do not add an explanation.
- For direct classroom concept questions, prefer 1-2 compact spoken sentences. For lecture supplements, prefer 12-28 words. Do not write a mini textbook explanation unless the transcript asks for detail.
- Ambiguous meeting statements using "it/this/that" without enough background: avoid blindly agreeing; clarify the specific part, risk, or next check.
- For meetings, include a concrete next move such as owner, blocker, decision, assumption, contract, test, log check, or scope cut. Avoid general "we should review it" language.
- Do not use the personal sample library.
- The requested Output language below is mandatory.
- If active event memory says source=open_* or source=short_form, or the transcript is labelled third-party dialogue, reply neutrally to the transcript only; do not use Xiang personal/profile context or take over a speaker role.
- For labelled third-party dialogue, output a short neutral content response or summary. Do not output meta text like "respond neutrally" or "do not take over the speaker role".

--- ACTIVE SCENE PROFILE ---
${formattedSceneProfile}
--- END ACTIVE SCENE PROFILE ---

--- XIANG PROFILE ---
Prompt mode: ${promptMode}
${formattedProfile}
--- END XIANG PROFILE ---

--- ACTIVE PRENOTE MEMORY ---
${formattedPrenoteContext}
--- END ACTIVE PRENOTE MEMORY ---`;

  const dynamicPromptCore = `Time: ${currentDate}
Output language: ${outputLanguage === "chinese" ? "Chinese" : "English"}
Latest transcript looks like a direct question: ${latestLooksLikeQuestion ? "yes" : "no"}

--- PROCESS HINT ---
${processHint}
--- END PROCESS HINT ---
${formattedImmediateRouteHints ? `
--- ROUTE/GUARD HINTS ---
${formattedImmediateRouteHints}
--- END ROUTE/GUARD HINTS ---
` : ""}

--- LATEST TRANSCRIPT ---
Transcript: "${latestTranscript}"
--- END LATEST TRANSCRIPT ---
${asrCorrectionHint ? `
--- ASR CORRECTION HINT ---
${asrCorrectionHint}
--- END ASR CORRECTION HINT ---
` : ""}

--- ACTIVE EVENT MEMORY ---
${formattedEventMemory}
--- END ACTIVE EVENT MEMORY ---

--- RELEVANT PERSONAL MEMORY ---
${formattedPersonalMemory}
--- END RELEVANT PERSONAL MEMORY ---`;

  const dynamicPromptSuffix = `${dynamicPromptCore}

${formattedHistory}`;

  const openAiConversationInstructions = `${sayNextInstructions}

${stablePromptPrefix}

${dynamicPromptCore}

OpenAI conversation state may contain previous clean transcript turns from this app session.
- Treat previous user messages as prior transcript context only.
- Assistant outputs are display suggestions, not external speech. If any previous assistant output is still visible in state, do not treat it as something the other person said.
- The current transcript is provided in the user input for this request.`;

  // Keep repeated content before volatile transcript/event context so OpenAI prompt caching can reuse the prefix.
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
      case 'low':
        agent = initialAgentLow;
        break;
      case 'medium':
        agent = initialAgentMedium;
        break;
      case 'high':
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
          }
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
        }
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
      }
    };
  } catch (error) {
    console.error("Error in processConversation:", error);
    const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
    if (fallback.type === Action.INSIGHT) {
      fallback.reasoning = `Fallback after model error: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
