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

function classifyScene(text: string): string {
  const normalized = text.toLowerCase();

  if (/\b(interview|candidate|position|role|hire|tell me about yourself|introduce yourself|why should we hire)\b/.test(normalized)) {
    return "interview";
  }

  if (/\b(professor|class|lecture|homework|assignment|course|lambda|ec2|dynamodb|serverless|scalability|availability|architecture)\b/.test(normalized)) {
    return "classroom";
  }

  if (/\b(team|teammate|meeting|sprint|task|deadline|group project|standup)\b/.test(normalized)) {
    return "group_discussion";
  }

  if (/\b(manager|client|work|ticket|production|requirement|deployment|bug|incident)\b/.test(normalized)) {
    return "work_discussion";
  }

  if (/\b(advisor|office|front desk|residence|maintenance|insurance|bank|appointment|deadline)\b/.test(normalized)) {
    return "service_or_advisor";
  }

  return "daily_chat";
}

function shouldStartNewEvent(current: ActiveEvent | null, scene: string, timestamp: number): boolean {
  if (!current) return true;
  if (timestamp - current.lastTimestamp > EVENT_IDLE_TIMEOUT_MS) return true;

  const currentStructured = current.scene !== "daily_chat";
  const nextStructured = scene !== "daily_chat";
  return currentStructured && nextStructured && current.scene !== scene;
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
  const latestReply = aiReplies.at(-1);

  return [
    `Scene: ${scene}.`,
    recent.length ? `Recent context: ${recent.join(" / ")}` : "",
    latestReply ? `Last SayNext output: ${latestReply}` : "",
  ].filter(Boolean).join(" ");
}

function trimRawTranscript(transcripts: string[]): string {
  const raw = transcripts.join("\n");
  return raw.length > MAX_RAW_TRANSCRIPT_CHARS ? raw.slice(-MAX_RAW_TRANSCRIPT_CHARS) : raw;
}

export class EventMemoryManager {
  private activeEvent: ActiveEvent | null = null;

  constructor(private readonly userId: string) {}

  addTranscript(text: string, timestamp: number): EventMemorySnapshot {
    const scene = classifyScene(text);

    if (shouldStartNewEvent(this.activeEvent, scene, timestamp)) {
      this.closeActiveEvent();
      this.activeEvent = {
        id: makeEventId(this.userId, timestamp),
        userId: this.userId,
        sessionId: `${this.userId}-${Math.floor(timestamp / 1000)}`,
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
    this.persistActiveEvent("closed");
    this.activeEvent = null;
  }

  private persistActiveEvent(status: "active" | "closed"): void {
    if (!this.activeEvent) return;

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
