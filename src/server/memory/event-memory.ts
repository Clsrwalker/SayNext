import { conversationLogger } from "../data/conversation-logger";
import { Action, type AgentResponse } from "../mastra/types";

const EVENT_IDLE_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_EVENT_TRANSCRIPTS = 24;
const MAX_RAW_TRANSCRIPT_CHARS = 6000;

export interface EventMemorySnapshot {
  eventId: string;
  scene: string;
  title: string;
  summary: string;
  transcriptCount: number;
  aiReplyCount: number;
  recentTranscripts: string[];
}

interface ActiveEvent {
  id: string;
  userId: string;
  sessionId: string;
  scene: string;
  title: string;
  startTimestamp: number;
  lastTimestamp: number;
  transcripts: string[];
  aiReplies: string[];
}

export function classifyScene(text: string): string {
  const normalized = text.toLowerCase();
  const hasCourseContext = /\b(course|courses)\b/.test(normalized) && !/\bof course\b/.test(normalized);
  const speakerLabelCount = (text.match(/\b[A-Z]:\s/g) ?? []).length;

  if (speakerLabelCount >= 2 && /\b(team|meeting|project|whiteboard|tool training|design|prototype|remote control|manager|everybody)\b/.test(normalized)) {
    return "group_discussion";
  }

  if (/\b(weekend|free time|anime|food|holiday|mountain|good morning|day going|what game|played any games|after class|staying home|hang out|chilling|takeout)\b/.test(normalized)) {
    return "daily_chat";
  }

  if (/\b(interview|candidate|position|role|hire|tell me about yourself|introduce yourself|why should we hire)\b/.test(normalized)) {
    return "interview";
  }

  if (hasCourseContext || /\b(professor|class|lecture|homework|assignment|lambda|ec2|dynamodb|serverless|scalability|availability|architecture)\b/.test(normalized)) {
    return "classroom";
  }

  if (/\b(team|teammate|meeting|sprint|task|deadline|group project|standup)\b/.test(normalized)) {
    return "group_discussion";
  }

  if (/\b(manager|client|production|requirement|requirements|deployment|bug|incident|jira ticket|support ticket|work ticket)\b/.test(normalized)) {
    return "work_discussion";
  }

  if (/\b(advisor|office|front desk|residence|maintenance|insurance|bank|appointment|deadline)\b/.test(normalized)) {
    return "service_or_advisor";
  }

  return "daily_chat";
}

function isClearDailySwitchText(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(weekend|free time|anime|food|holiday|mountain|good morning|day going|what game|played any games|after class|staying home|hang out|chilling|takeout)\b/.test(normalized);
}

export function shouldStartNewEvent(current: Pick<ActiveEvent, "scene" | "lastTimestamp"> | null, scene: string, timestamp: number, text = ""): boolean {
  if (!current) return true;
  if (timestamp - current.lastTimestamp > EVENT_IDLE_TIMEOUT_MS) return true;

  if (current.scene === scene) return false;
  if (current.scene === "group_discussion" && scene === "interview" && /\b[A-Z]:\s/.test(text)) return false;
  if (current.scene === "classroom" && scene === "group_discussion" && /\b(lecture|algorithm|matrix|accuracy|method|code|pivot|elimination)\b/i.test(text)) return false;
  if (scene === "daily_chat") return isClearDailySwitchText(text);
  return true;
}

function makeEventId(userId: string, timestamp: number): string {
  const safeUser = userId.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
  return `${safeUser}-${timestamp}`;
}

function makeTitle(scene: string, transcripts: string[]): string {
  const firstUseful = transcripts.find((text) => text.trim().length > 8) || transcripts[0] || scene;
  return firstUseful.replace(/\s+/g, " ").trim().slice(0, 90);
}

function makeSummary(scene: string, transcripts: string[], aiReplies: string[]): string {
  const recent = transcripts.slice(-4).map((text) => text.replace(/\s+/g, " ").trim());

  return [
    `Scene: ${scene}.`,
    recent.length ? `Recent context: ${recent.join(" / ")}` : "",
    aiReplies.length ? `SayNext outputs shown: ${aiReplies.length}` : "",
  ].filter(Boolean).join(" ");
}

function trimRawTranscript(transcripts: string[]): string {
  const raw = transcripts.join("\n");
  return raw.length > MAX_RAW_TRANSCRIPT_CHARS ? raw.slice(-MAX_RAW_TRANSCRIPT_CHARS) : raw;
}

export class EventMemoryManager {
  private activeEvent: ActiveEvent | null = null;

  constructor(
    private readonly userId: string,
    private readonly sessionId: string = `${userId}-${Date.now()}`,
    private readonly persistEvents = true,
  ) {}

  addTranscript(text: string, timestamp: number): EventMemorySnapshot {
    const scene = classifyScene(text);

    if (shouldStartNewEvent(this.activeEvent, scene, timestamp, text)) {
      this.closeActiveEvent();
      this.activeEvent = {
        id: makeEventId(this.userId, timestamp),
        userId: this.userId,
        sessionId: this.sessionId,
        scene,
        title: text.replace(/\s+/g, " ").trim().slice(0, 90) || scene,
        startTimestamp: timestamp,
        lastTimestamp: timestamp,
        transcripts: [],
        aiReplies: [],
      };
    }

    this.activeEvent!.lastTimestamp = timestamp;
    this.activeEvent!.scene = this.activeEvent!.scene === "daily_chat" ? scene : this.activeEvent!.scene;
    this.activeEvent!.transcripts.push(text);
    if (this.activeEvent!.transcripts.length > MAX_EVENT_TRANSCRIPTS) {
      this.activeEvent!.transcripts = this.activeEvent!.transcripts.slice(-MAX_EVENT_TRANSCRIPTS);
    }
    this.persistActiveEvent("active");

    return this.getSnapshot();
  }

  addResponse(response: AgentResponse): void {
    if (!this.activeEvent || response.type !== Action.INSIGHT) return;

    this.activeEvent.aiReplies.push(response.output);
    if (this.activeEvent.aiReplies.length > 10) {
      this.activeEvent.aiReplies = this.activeEvent.aiReplies.slice(-10);
    }
    this.activeEvent.lastTimestamp = Math.max(this.activeEvent.lastTimestamp, response.timestamp);
    this.persistActiveEvent("active");
  }

  getSnapshot(): EventMemorySnapshot {
    if (!this.activeEvent) {
      return {
        eventId: "",
        scene: "unknown",
        title: "",
        summary: "No active event yet.",
        transcriptCount: 0,
        aiReplyCount: 0,
        recentTranscripts: [],
      };
    }

    const event = this.activeEvent;
    return {
      eventId: event.id,
      scene: event.scene,
      title: makeTitle(event.scene, event.transcripts),
      summary: makeSummary(event.scene, event.transcripts, event.aiReplies),
      transcriptCount: event.transcripts.length,
      aiReplyCount: event.aiReplies.length,
      recentTranscripts: event.transcripts.slice(-6),
    };
  }

  closeActiveEvent(): void {
    if (!this.activeEvent) return;
    if (!this.persistEvents) {
      this.activeEvent = null;
      return;
    }
    this.persistActiveEvent("closed");
    this.activeEvent = null;
  }

  private persistActiveEvent(status: "active" | "closed"): void {
    if (!this.activeEvent) return;
    if (!this.persistEvents) return;

    const event = this.activeEvent;
    const title = makeTitle(event.scene, event.transcripts);
    const summary = makeSummary(event.scene, event.transcripts, event.aiReplies);

    try {
      conversationLogger.upsertEvent({
        id: event.id,
        userId: event.userId,
        sessionId: event.sessionId,
        scene: event.scene,
        title,
        summary,
        status,
        startTimestamp: event.startTimestamp,
        lastTimestamp: event.lastTimestamp,
        transcriptCount: event.transcripts.length,
        aiReplyCount: event.aiReplies.length,
        rawTranscript: trimRawTranscript(event.transcripts),
      });
    } catch (error) {
      console.error(`[EventMemory] Failed to persist event:`, error);
    }
  }
}
