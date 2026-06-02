import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Action, AgentType, type AgentResponse, type Conversation } from "../src/server/mastra/types";
import { conversationLogger } from "../src/server/data/conversation-logger";
import { EventMemoryManager, type EventMemorySnapshot } from "../src/server/memory/event-memory";
import { routeFastScene, type SceneBuiltinKey } from "../src/server/scene/fast-scene-router";
import { normalizeKnownProjectAsrAliases } from "../src/server/text/asr-corrections";
import { TRANSCRIPT_HISTORY_LENGTH, INSIGHTS_HISTORY_LENGTH } from "../src/server/config";
import {
  buildLiveXiangProfile,
  compactRuntimeContextBlock,
  detectPromptMode,
  estimateTokens,
  filterRuntimePersonalMemoryContext,
  findLatestTranscriptIndex,
  formatCompactEventMemory,
} from "../src/server/saynext/context-builder";
import { formatImmediateRouteHints, getImmediateDecision } from "../src/server/saynext/immediate-rules";
import {
  getContextAwareProjectImmediateResponse,
  getPrenoteExactAnswerImmediateResponse,
  getUnsupportedPremiseImmediateResponse,
} from "../src/server/saynext/immediate-response";
import { buildSayNextLiveTaskPrompt, sayNextConversationStateInstructions, sayNextInstructions } from "../src/server/saynext/prompts";
import { type OutputLanguage } from "../src/server/saynext/output-postprocess";
import { buildOpenAiConversationCreatePayload, buildOpenAiConversationInput } from "../src/server/mastra/agents/openai-conversation-state";

type SampleRow = {
  id: number;
  userId: string;
  sessionId: string;
  timestamp: string;
  language: string | null;
  transcript: string;
  aiReply: string | null;
  actionType: string;
  reasoning: string | null;
  model: string | null;
};

type SessionSummary = {
  sessionId: string;
  first: string;
  last: string;
  turns: number;
};

type PromptSnapshot = {
  status: "api_prompt" | "no_api";
  latestTranscript: string;
  promptMode: string;
  previousTranscriptTexts: string[];
  routeHintIds: string[];
  noApiReason?: string;
  api?: {
    model: string;
    normalAgentRequest: {
      instructions: string;
      prompt: string;
      combinedPrompt: string;
    };
    conversationStateRequest: {
      createConversationOnce: {
        endpoint: "POST /v1/conversations";
        payload: ReturnType<typeof buildOpenAiConversationCreatePayload>;
      };
      responseEveryTurn: {
        endpoint: "POST /v1/responses";
        payload: {
          model: string;
          conversation: string;
          input: Array<{
            role: "user";
            content: Array<{ type: "input_text"; text: string }>;
          }>;
          temperature: number;
        };
      };
    };
    tokenEstimate: {
      system: number;
      prompt: number;
      combined: number;
      conversationStateSeedInstructions: number;
      conversationStateInput: number;
    };
  };
};

type TurnReport = {
  row: SampleRow;
  eventMemory: EventMemorySnapshot;
  activeSceneProfilePrompt: string;
  activePrenoteContext: string;
  relevantPersonalMemoryContext: string;
  prompt: PromptSnapshot;
};

function argValue(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function asOutputLanguage(value: string | null): OutputLanguage {
  return value === "chinese" ? "chinese" : "english";
}

function toMillis(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function safeLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function getRecentSessions(db: Database, userId: string, sessionCount: number): SessionSummary[] {
  return db.query(`
    SELECT
      session_id AS sessionId,
      MIN(timestamp) AS first,
      MAX(timestamp) AS last,
      COUNT(*) AS turns
    FROM conversation_samples
    WHERE user_id = ?
    GROUP BY session_id
    ORDER BY MAX(timestamp) DESC
    LIMIT ?
  `).all(userId, sessionCount) as SessionSummary[];
}

function getSessionRows(db: Database, userId: string, sessionIds: string[]): SampleRow[] {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => "?").join(", ");
  return db.query(`
    SELECT
      id,
      user_id AS userId,
      session_id AS sessionId,
      timestamp,
      language,
      transcript,
      ai_reply AS aiReply,
      action_type AS actionType,
      reasoning,
      model
    FROM conversation_samples
    WHERE user_id = ?
      AND session_id IN (${placeholders})
    ORDER BY session_id ASC, timestamp ASC, id ASC
  `).all(userId, ...sessionIds) as SampleRow[];
}

function rowToResponse(row: SampleRow): AgentResponse {
  const timestamp = toMillis(row.timestamp);
  if (row.actionType === Action.SILENT) {
    return {
      type: Action.SILENT,
      reasoning: row.reasoning || "Historical silent response",
      timestamp,
    };
  }

  if (row.actionType === Action.ROUTE) {
    return {
      type: Action.ROUTE,
      reasoning: row.reasoning || "Historical route response",
      timestamp,
      targetAgent: AgentType.WebSearch,
      payload: { queries: [] },
    };
  }

  return {
    type: Action.INSIGHT,
    reasoning: row.reasoning || "Historical insight response",
    timestamp,
    output: row.aiReply || "",
    confidence: 0.7,
    metadata: {
      agentType: AgentType.Initial,
      agentInput: {
        model: row.model,
      },
    },
  };
}

class AutoSceneTracker {
  private autoSceneKey: SceneBuiltinKey = "daily_chat";
  private autoScenePendingKey: SceneBuiltinKey | null = null;
  private autoScenePendingCount = 0;
  private autoSceneLastSwitchAt = 0;

  resolve(userId: string, latestTranscript: string, timestamp: number, recentTranscripts: string[]): string {
    const activeProfile = conversationLogger.getActiveSceneProfile(userId);
    if (activeProfile?.builtinKey !== "auto") {
      return conversationLogger.formatSceneProfilePrompt(activeProfile);
    }

    const route = routeFastScene({
      latestTranscript,
      recentTranscripts,
      previousSceneKey: this.autoSceneKey,
    });

    if (route.sceneKey === this.autoSceneKey) {
      this.autoScenePendingKey = null;
      this.autoScenePendingCount = 0;
    } else {
      if (this.autoScenePendingKey === route.sceneKey) {
        this.autoScenePendingCount += 1;
      } else {
        this.autoScenePendingKey = route.sceneKey;
        this.autoScenePendingCount = 1;
      }

      const inCooldown = timestamp - this.autoSceneLastSwitchAt < Number(process.env.AUTO_SCENE_SWITCH_COOLDOWN_MS || 20_000);
      const forceSwitch = route.confidence >= Number(process.env.AUTO_SCENE_FORCE_CONFIDENCE || 0.9);
      const confidentSwitch = route.confidence >= Number(process.env.AUTO_SCENE_SWITCH_CONFIDENCE || 0.75) && !inCooldown;
      const repeatedSwitch = route.confidence >= Number(process.env.AUTO_SCENE_REPEAT_CONFIDENCE || 0.65)
        && this.autoScenePendingCount >= 2
        && !inCooldown;

      if (forceSwitch || confidentSwitch || repeatedSwitch) {
        this.autoSceneKey = route.sceneKey;
        this.autoSceneLastSwitchAt = timestamp;
        this.autoScenePendingKey = null;
        this.autoScenePendingCount = 0;
      }
    }

    const selectedProfile = conversationLogger.getSceneProfileByBuiltinKey(userId, this.autoSceneKey)
      || conversationLogger.getSceneProfileByBuiltinKey(userId, "daily_chat");
    return selectedProfile
      ? `Active scene profile: Auto -> ${selectedProfile.name}\n${selectedProfile.prompt.trim()}`
      : "";
  }
}

function buildPromptSnapshot(params: {
  conversation: Conversation;
  eventMemory?: EventMemorySnapshot;
  outputLanguage: OutputLanguage;
  activePrenoteContext: string;
  activeSceneProfilePrompt: string;
  relevantPersonalMemoryContext: string;
  currentTimestamp: number;
  model: string;
}): PromptSnapshot {
  const rawLatestTranscript = getLatestTranscript(params.conversation);
  const latestTranscript = normalizeKnownProjectAsrAliases(rawLatestTranscript);
  const promptMode = detectPromptMode(latestTranscript, params.eventMemory);
  const isClassroomMode = promptMode === "classroom";
  const latestTranscriptIndex = findLatestTranscriptIndex(params.conversation);
  const compactConversation = params.conversation
    .filter((_, index) => index !== latestTranscriptIndex)
    .slice(-4);
  const previousTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const hasRecentAgentOutput = compactConversation.some((item) => item.type === "insight" || item.type === "silent" || item.type === "route");

  const immediateDecision = isClassroomMode
    ? { response: null, routeHints: [] }
    : getImmediateDecision(latestTranscript, params.currentTimestamp, params.outputLanguage, {
      previousTranscriptTexts,
      hasPriorTranscript: previousTranscriptTexts.length > 0,
      hasRecentAgentOutput,
    });
  if (immediateDecision.response) {
    return {
      status: "no_api",
      latestTranscript,
      promptMode,
      previousTranscriptTexts,
      routeHintIds: immediateDecision.routeHints.map((hint) => hint.id),
      noApiReason: `Immediate response: ${immediateDecision.response.type}; ${immediateDecision.response.reasoning}`,
    };
  }

  const immediateRouteHints = immediateDecision.routeHints;
  const formattedImmediateRouteHints = isClassroomMode ? "" : formatImmediateRouteHints(immediateRouteHints);

  const recentTranscriptContext = previousTranscriptTexts.join("\n");
  const formattedProfile = isClassroomMode ? "" : buildLiveXiangProfile(promptMode);
  const historyTranscriptTexts = compactConversation
    .filter((item) => item.type === "transcript")
    .map((item) => item.text);
  const formattedEventMemory = isClassroomMode
    ? ""
    : formatCompactEventMemory(params.eventMemory, [latestTranscript, ...historyTranscriptTexts]);
  const formattedPrenoteContext = params.activePrenoteContext.trim()
    ? compactRuntimeContextBlock(params.activePrenoteContext.trim(), 1200)
    : "";
  const filteredPersonalMemoryContext = isClassroomMode
    ? ""
    : filterRuntimePersonalMemoryContext(
      params.relevantPersonalMemoryContext,
      latestTranscript,
      promptMode,
      params.eventMemory,
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

  const prenoteExactResponse = getPrenoteExactAnswerImmediateResponse(latestTranscript, formattedPrenoteContext, params.currentTimestamp);
  if (prenoteExactResponse) {
    return {
      status: "no_api",
      latestTranscript,
      promptMode,
      previousTranscriptTexts,
      routeHintIds: immediateRouteHints.map((hint) => hint.id),
      noApiReason: `Prenote exact response: ${prenoteExactResponse.type}; ${prenoteExactResponse.reasoning}`,
    };
  }

  if (!isClassroomMode) {
    const unsupportedPremiseResponse = getUnsupportedPremiseImmediateResponse(latestTranscript, params.currentTimestamp, trustedSupportContext);
    if (unsupportedPremiseResponse) {
      return {
        status: "no_api",
        latestTranscript,
        promptMode,
        previousTranscriptTexts,
        routeHintIds: immediateRouteHints.map((hint) => hint.id),
        noApiReason: `Unsupported premise response: ${unsupportedPremiseResponse.type}; ${unsupportedPremiseResponse.reasoning}`,
      };
    }

    const contextAwareProjectResponse = getContextAwareProjectImmediateResponse(
      latestTranscript,
      trustedSupportContext,
      params.currentTimestamp,
      recentTranscriptContext,
    );
    if (contextAwareProjectResponse) {
      return {
        status: "no_api",
        latestTranscript,
        promptMode,
        previousTranscriptTexts,
        routeHintIds: immediateRouteHints.map((hint) => hint.id),
        noApiReason: `Context-aware project response: ${contextAwareProjectResponse.type}; ${contextAwareProjectResponse.reasoning}`,
      };
    }
  }

  const stablePromptPrefix = buildSayNextLiveTaskPrompt({
    formattedSceneProfile: isClassroomMode
      ? ""
      : compactRuntimeContextBlock(params.activeSceneProfilePrompt.trim(), 900),
    promptMode,
    supportContext: isClassroomMode ? formattedPrenoteContext : compactRuntimeContextBlock(trustedSupportContext, 2600),
    routeHints: formattedImmediateRouteHints,
  });

  const liveOutputLanguageText = params.outputLanguage === "chinese" ? "Chinese" : "English";
  const liveDynamicPromptCore = `Output language: ${liveOutputLanguageText}`;
  const liveDynamicPromptSuffix = `${liveDynamicPromptCore}\n\nCurrent transcript: ${latestTranscript}`;

  const prompt = `${stablePromptPrefix}\n\n${liveDynamicPromptSuffix}`;
  const combinedPrompt = `${sayNextInstructions}\n\n${prompt}`;
  const conversationStateInput = buildOpenAiConversationInput(latestTranscript, {
    outputLanguage: liveOutputLanguageText,
    promptMode,
    preparedNote: formattedPrenoteContext,
  });

  return {
    status: "api_prompt",
    latestTranscript,
    promptMode,
    previousTranscriptTexts,
    routeHintIds: immediateRouteHints.map((hint) => hint.id),
    api: {
      model: params.model,
      normalAgentRequest: {
        instructions: sayNextInstructions,
        prompt,
        combinedPrompt,
      },
      conversationStateRequest: {
        createConversationOnce: {
          endpoint: "POST /v1/conversations",
          payload: buildOpenAiConversationCreatePayload({
            userId: params.userId,
            sessionId: "<runtime session id>",
            seedInstructions: sayNextConversationStateInstructions,
          }),
        },
        responseEveryTurn: {
          endpoint: "POST /v1/responses",
          payload: {
            model: params.model,
            conversation: "<runtime OpenAI conversation id>",
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: conversationStateInput,
                  },
                ],
              },
            ],
            temperature: 0.35,
          },
        },
      },
      tokenEstimate: {
        system: estimateTokens(sayNextInstructions),
        prompt: estimateTokens(prompt),
        combined: estimateTokens(combinedPrompt),
        conversationStateSeedInstructions: estimateTokens(sayNextConversationStateInstructions),
        conversationStateInput: estimateTokens(conversationStateInput),
      },
    },
  };
}

function getLatestTranscript(conversation: Conversation): string {
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const item = conversation[i];
    if (item.type === "transcript") return item.text;
  }
  return "";
}

async function buildReports(params: {
  db: Database;
  userId: string;
  sessions: SessionSummary[];
  model: string;
  includeMemoryBlocks: boolean;
}): Promise<TurnReport[]> {
  const sessionIds = params.sessions.map((session) => session.sessionId);
  const rows = getSessionRows(params.db, params.userId, sessionIds);
  const rowsBySession = new Map<string, SampleRow[]>();
  for (const row of rows) {
    rowsBySession.set(row.sessionId, [...(rowsBySession.get(row.sessionId) || []), row]);
  }

  const reports: TurnReport[] = [];
  for (const session of params.sessions) {
    const sessionRows = rowsBySession.get(session.sessionId) || [];
    const eventMemory = new EventMemoryManager(params.userId, session.sessionId, false);
    const autoScene = new AutoSceneTracker();
    const conversation: Conversation = [];

    for (const row of sessionRows) {
      const timestamp = toMillis(row.timestamp);
      const text = normalizeKnownProjectAsrAliases(row.transcript);
      const eventSnapshot = eventMemory.addTranscript(text, timestamp);
      conversation.push({ type: "transcript", text, timestamp });

      const recentTranscripts = conversation
        .filter((item) => item.type === "transcript" || item.type === "silent")
        .slice(-TRANSCRIPT_HISTORY_LENGTH);
      const recentInsights = conversation
        .filter((item) => item.type === "insight" || item.type === "route")
        .slice(-INSIGHTS_HISTORY_LENGTH);
      const context = [...recentTranscripts, ...recentInsights].sort((a, b) => a.timestamp - b.timestamp);
      const activeSceneProfilePrompt = autoScene.resolve(
        params.userId,
        text,
        timestamp,
        recentTranscripts.filter((item) => item.type === "transcript").map((item) => item.text),
      );
      const promptMode = detectPromptMode(text, eventSnapshot);
      const isClassroomMode = promptMode === "classroom";
      const memoryQuery = eventSnapshot.recentTranscripts.slice(-4).join("\n") || text;
      const prenoteQuery = [
        text,
        eventSnapshot.recentTranscripts.slice(-2).join("\n"),
      ].filter(Boolean).join("\n");
      const activePrenoteContext = await conversationLogger.getActivePrenoteRuntimeContextForQuery(
        params.userId,
        prenoteQuery,
        "fast",
      );
      const relevantPersonalMemoryContext = isClassroomMode
        ? ""
        : await conversationLogger.getRelevantPersonalMemoryContextAsync(params.userId, memoryQuery, 3);
      const prompt = buildPromptSnapshot({
        conversation: context,
        eventMemory: eventSnapshot,
        outputLanguage: asOutputLanguage(row.language),
        activePrenoteContext,
        activeSceneProfilePrompt,
        relevantPersonalMemoryContext,
        currentTimestamp: timestamp,
        model: params.model,
      });

      reports.push({
        row,
        eventMemory: eventSnapshot,
        activeSceneProfilePrompt: params.includeMemoryBlocks ? activeSceneProfilePrompt : "",
        activePrenoteContext: params.includeMemoryBlocks ? activePrenoteContext : "",
        relevantPersonalMemoryContext: params.includeMemoryBlocks ? relevantPersonalMemoryContext : "",
        prompt,
      });

      const historicalResponse = rowToResponse(row);
      conversation.push(historicalResponse);
      eventMemory.addResponse(historicalResponse);
    }
  }

  return reports;
}

function writeMarkdown(params: {
  path: string;
  dbPath: string;
  userId: string;
  sessions: SessionSummary[];
  reports: TurnReport[];
  includeMemoryBlocks: boolean;
}): void {
  const apiCount = params.reports.filter((report) => report.prompt.status === "api_prompt").length;
  const noApiCount = params.reports.length - apiCount;
  const telepromptCount = params.reports.filter((report) => report.row.model === "teleprompt").length;
  const lines: string[] = [
    "# Recent VPS Session Prompt Export",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Database: ${params.dbPath}`,
    `User: ${params.userId}`,
    `Sessions: ${params.sessions.length}`,
    `Turns: ${params.reports.length}`,
    `API prompt turns: ${apiCount}`,
    `No-API turns: ${noApiCount}`,
    `Historical teleprompt rows: ${telepromptCount}`,
    "",
    "This file reconstructs the prompt payload from the local copy of the VPS database and current local code. For normal SayNext generation, use `normalAgentRequest.combinedPrompt`. For VPS travel mode with OpenAI conversation state, fixed rules are seeded once when creating the OpenAI conversation, then each Responses request sends only the compact per-turn input.",
    "",
    "## Session Index",
    "",
  ];

  for (const session of params.sessions) {
    lines.push(`- ${session.sessionId}: turns=${session.turns}, first=${session.first}, last=${session.last}`);
  }

  const reportsBySession = new Map<string, TurnReport[]>();
  for (const report of params.reports) {
    reportsBySession.set(report.row.sessionId, [...(reportsBySession.get(report.row.sessionId) || []), report]);
  }

  for (const session of params.sessions) {
    const sessionReports = reportsBySession.get(session.sessionId) || [];
    lines.push("");
    lines.push(`## Session ${session.sessionId}`);
    lines.push("");
    lines.push(`Complete turns: ${sessionReports.length}`);
    lines.push("");

    for (const report of sessionReports) {
      lines.push(`### Turn ${report.row.id} / ${report.row.timestamp}`);
      lines.push("");
      lines.push(`- transcript: ${report.row.transcript}`);
      lines.push(`- historical_action: ${report.row.actionType}`);
      lines.push(`- historical_model: ${report.row.model || ""}`);
      lines.push(`- historical_output: ${report.row.aiReply || ""}`);
      lines.push(`- historical_reasoning: ${report.row.reasoning || ""}`);
      lines.push(`- prompt_status: ${report.prompt.status}`);
      lines.push(`- prompt_mode: ${report.prompt.promptMode}`);
      lines.push(`- route_hints: ${report.prompt.routeHintIds.join(", ") || "(none)"}`);
      lines.push(`- event: scene=${report.eventMemory.scene}, title=${report.eventMemory.title}, transcripts=${report.eventMemory.transcriptCount}, replies=${report.eventMemory.aiReplyCount}`);
      if (report.prompt.status === "no_api") {
        lines.push(`- no_api_reason: ${report.prompt.noApiReason || ""}`);
        if (report.row.model === "teleprompt") {
          lines.push("- note: this row is the logged teleprompt opening/display row. The async long teleprompt script request is separate from normal SayNext generation.");
        }
        lines.push("");
        continue;
      }

      const api = report.prompt.api!;
      lines.push(`- token_estimate: system=${api.tokenEstimate.system}, prompt=${api.tokenEstimate.prompt}, combined=${api.tokenEstimate.combined}, conversation_state_seed_instructions=${api.tokenEstimate.conversationStateSeedInstructions}, conversation_state_input=${api.tokenEstimate.conversationStateInput}`);
      lines.push("");
      lines.push("<details><summary>Normal Agent Request: combined prompt sent through Agent.generate</summary>");
      lines.push("");
      lines.push("```text");
      lines.push(api.normalAgentRequest.combinedPrompt);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
      lines.push("<details><summary>VPS Conversation-State Create: seed developer item</summary>");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(api.conversationStateRequest.createConversationOnce.payload.items ?? [], null, 2));
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
      lines.push("<details><summary>VPS Conversation-State Response: per-turn payload.input</summary>");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(api.conversationStateRequest.responseEveryTurn.payload.input, null, 2));
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");

      if (params.includeMemoryBlocks) {
        lines.push("<details><summary>Resolved Context Blocks</summary>");
        lines.push("");
        lines.push("```text");
        lines.push(`--- ACTIVE SCENE PROFILE ---\n${report.activeSceneProfilePrompt || "No active scene profile."}`);
        lines.push(`\n--- ACTIVE PRENOTE CONTEXT ---\n${report.activePrenoteContext || "No active prenote."}`);
        lines.push(`\n--- RELEVANT PERSONAL MEMORY ---\n${report.relevantPersonalMemoryContext || "No relevant personal memory."}`);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }
  }

  writeFileSync(params.path, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const dbPath = argValue("--db") || "data/saynext.sqlite";
  const userId = argValue("--user") || "li2897283405@gmail.com";
  const sessionCount = safeLimit(argValue("--sessions"), 3, 12);
  const outputDir = argValue("--out-dir") || join("data", "review");
  const model = argValue("--model") || process.env.OPENAI_MODEL || process.env.MODEL_NAME || "gpt-5.4-nano";
  const includeMemoryBlocks = asBool(argValue("--include-memory-blocks"), false);

  const db = new Database(dbPath, { readonly: true });
  const sessions = getRecentSessions(db, userId, sessionCount);
  const reports = await buildReports({
    db,
    userId,
    sessions,
    model,
    includeMemoryBlocks,
  });

  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outputDir, `recent-vps-session-prompts-${stamp}.md`);
  const jsonPath = join(outputDir, `recent-vps-session-prompts-${stamp}.json`);

  writeMarkdown({
    path: mdPath,
    dbPath,
    userId,
    sessions,
    reports,
    includeMemoryBlocks,
  });
  const promptReports = reports.map((report) => {
    const {
      eventMemory: _eventMemory,
      activeSceneProfilePrompt: _activeSceneProfilePrompt,
      activePrenoteContext: _activePrenoteContext,
      relevantPersonalMemoryContext: _relevantPersonalMemoryContext,
      ...promptReport
    } = report;
    return promptReport;
  });
  writeFileSync(jsonPath, JSON.stringify({
    generated: new Date().toISOString(),
    dbPath,
    userId,
    sessions,
    reports: promptReports,
  }, null, 2), "utf8");

  const apiCount = reports.filter((report) => report.prompt.status === "api_prompt").length;
  const noApiCount = reports.length - apiCount;
  console.log(`[recent-vps-session-prompts] sessions=${sessions.length} turns=${reports.length} api_prompts=${apiCount} no_api=${noApiCount}`);
  console.log(`[recent-vps-session-prompts] report=${mdPath}`);
  console.log(`[recent-vps-session-prompts] json=${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
