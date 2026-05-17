import { conversationLogger } from "../data/conversation-logger";
import { Action, type AgentResponse } from "../mastra/types";

const EVENT_IDLE_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_EVENT_TRANSCRIPTS = 24;
const MAX_RAW_TRANSCRIPT_CHARS = 6000;
const MAX_MEETING_STATE_ITEMS = 4;
const CLEAR_DAILY_CHAT_PATTERN = /\b(weekend|free time|anime|food|holiday|mountain|good morning|day going|what game|played any games|after class|staying home|hang out|chilling|takeout|ielts part 2|part 2|one or two minutes|one minute|two minutes|describe a room|describe your room|describe a place|describe a skill|describe your favorite|describe your favourite|room|bedroom|where you live|favorite website|favourite website|watch tv|music|shopping|clothes|sleep schedule)\b/;

export interface LiveMeetingState {
  projectTopic: string;
  currentGoal: string;
  currentDecision: string;
  openBlockers: string[];
  knownAssumptions: string[];
  actionItems: string[];
  xiangResponsibility: string;
  nextUsefulMove: string;
  lastUpdatedAt: number;
}

export interface EventMemorySnapshot {
  eventId: string;
  scene: string;
  title: string;
  summary: string;
  transcriptCount: number;
  aiReplyCount: number;
  recentTranscripts: string[];
  meetingState?: LiveMeetingState;
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
  meetingState: LiveMeetingState;
}

export function classifyScene(text: string): string {
  const normalized = text.toLowerCase();
  const hasCourseContext = /\b(course|courses)\b/.test(normalized) && !/\bof course\b/.test(normalized);
  const speakerLabelCount = (text.match(/\b[A-Z]:\s/g) ?? []).length;
  const hasLectureContext = /\b(professor|lecture|class|homework|exam|tutorial|students|any questions)\b/.test(normalized);
  const hasCollaborativeProjectContext = (
    /\b(?:we|our|team|xiang|i)\b.*\b(project|feature|demo|task|deadline|blocker|blocked|stuck|schema|api contract|settings endpoint|frontend|backend|integration|milestone|sprint|merge|pull request|pr|teleprompt|design|testing|deliverable)\b/.test(normalized)
    || /\b(blocker|blocked|stuck|action item|owner|deadline|standup|sprint|milestone|api contract|mock schema|frontend integration|backend integration)\b/.test(normalized)
  );

  if (speakerLabelCount >= 2 && /\b(team|meeting|project|whiteboard|tool training|design|prototype|remote control|manager|everybody)\b/.test(normalized)) {
    return "group_discussion";
  }

  if (hasCollaborativeProjectContext && !hasLectureContext) {
    return "group_discussion";
  }

  if (CLEAR_DAILY_CHAT_PATTERN.test(normalized)) {
    return "daily_chat";
  }

  if (/\b(interview|candidate|position|job role|this role|software role|hire|tell me about yourself|introduce yourself|why should we hire)\b/.test(normalized)) {
    return "interview";
  }

  if (hasCourseContext || /\b(professor|class|lecture|homework|assignment|lambda|ec2|dynamodb|serverless|scalability|scale up|autoscaling|availability|architecture|cloud|cloud computing|devops|system design|terraform|cloudformation|infrastructure as code|iac|aws cli|access key|secret access key|session token|learner lab|learnlab|vpc|subnet|route table|internet gateway|rds|security group|cidr|ami|react|react native|component|components|props|state visible|text input|radio button|navigation|navigator|route|routes|login route|login component|firebase auth|useeffect|use effect|usestate|use state|dependency array|screen|screens|wireframe|prototype|prototyping|low fidelity|medium fidelity|high fidelity|user experience|usability|ui design|gesture|gestures|gesture detector|animation|lottie|key framing|z-axis|justify-content|align-items|cross axis|main axis|sensor|sensors|rotation|rotations|ui thread|async|promise|database schema|schema|table|tables|columns|fields|attributes|primary key|auto-increment|cache|caching|data persistence|restful|rest api|api|apis|pos system|payment systems|shopping cart|checkout|html|url|port number|fragment|query|string|path representing|https|http|web client|web server|data center|virtualization|virtual machine|vmware|cpu|gpu|cuda|opencl|distributed computing|big data|container|containers|container image|docker image|docker|ai tools|intellectual property|copyright|contract|ip rights|sender|receiver|channel|decode|decoding|online communication|camera|background|blur|filter|virtual background|mute|echo|bandwidth)\b/.test(normalized)) {
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
  return CLEAR_DAILY_CHAT_PATTERN.test(normalized);
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

function hasMeetingStateContent(state?: LiveMeetingState): boolean {
  if (!state) return false;
  return Boolean(
    state.projectTopic
    || state.currentGoal
    || state.currentDecision
    || state.openBlockers.length
    || state.knownAssumptions.length
    || state.actionItems.length
    || state.xiangResponsibility
    || state.nextUsefulMove,
  );
}

function makeSummary(scene: string, transcripts: string[], aiReplies: string[], meetingState?: LiveMeetingState): string {
  const recent = transcripts.slice(-4).map((text) => text.replace(/\s+/g, " ").trim());
  const stateSummary = hasMeetingStateContent(meetingState)
    ? [
      meetingState?.projectTopic ? `Topic: ${meetingState.projectTopic}` : "",
      meetingState?.currentGoal ? `Goal: ${meetingState.currentGoal}` : "",
      meetingState?.currentDecision ? `Decision: ${meetingState.currentDecision}` : "",
      meetingState?.openBlockers.length ? `Blockers: ${meetingState.openBlockers.join(" | ")}` : "",
      meetingState?.actionItems.length ? `Actions: ${meetingState.actionItems.join(" | ")}` : "",
    ].filter(Boolean).join(" ")
    : "";

  return [
    `Scene: ${scene}.`,
    stateSummary ? `Live meeting state: ${stateSummary}` : "",
    recent.length ? `Recent context: ${recent.join(" / ")}` : "",
    aiReplies.length ? `SayNext outputs shown: ${aiReplies.length}` : "",
  ].filter(Boolean).join(" ");
}

function trimRawTranscript(transcripts: string[]): string {
  const raw = transcripts.join("\n");
  return raw.length > MAX_RAW_TRANSCRIPT_CHARS ? raw.slice(-MAX_RAW_TRANSCRIPT_CHARS) : raw;
}

function createEmptyMeetingState(timestamp = 0): LiveMeetingState {
  return {
    projectTopic: "",
    currentGoal: "",
    currentDecision: "",
    openBlockers: [],
    knownAssumptions: [],
    actionItems: [],
    xiangResponsibility: "",
    nextUsefulMove: "",
    lastUpdatedAt: timestamp,
  };
}

function cleanMeetingText(text: string): string {
  return String(text || "")
    .replace(/^\s*[A-Z]\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "");
}

function compactStateItem(text: string, maxLength = 150): string {
  const cleaned = cleanMeetingText(text);
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
}

function rememberStateItem(items: string[], item: string): string[] {
  const cleaned = compactStateItem(item);
  if (cleaned.length < 6) return items;

  const normalized = cleaned.toLowerCase();
  const deduped = items.filter((existing) => existing.toLowerCase() !== normalized);
  return [...deduped, cleaned].slice(-MAX_MEETING_STATE_ITEMS);
}

function isMeetingLikeUpdate(scene: string, text: string): boolean {
  if (scene === "group_discussion" || scene === "work_discussion") return true;

  const normalized = text.toLowerCase();
  const teamworkSignal = /\b(we|our|team|teammate|meeting|standup|sprint|milestone|deadline|task|owner|action item|blocker|blocked|stuck|schema|api contract|merge|pull request|pr|frontend|backend|demo|progress|deliverable)\b/.test(normalized);
  const lectureSignal = /\b(professor|lecture|class|homework|exam|tutorial|any questions|students)\b/.test(normalized);
  return teamworkSignal && !lectureSignal;
}

function inferProjectTopic(text: string, currentTopic: string): string {
  const normalized = text.toLowerCase();
  const topics: Array<[RegExp, string]> = [
    [/\bsay\s*next\b|\bsaynext\b|\bteleprompt\b|\bprenote\b|\bscene profile\b|\bpersonal memory\b|\btranscript export\b/i, "SayNext"],
    [/\bjob\s*lens\b|\bjoblens\b|\bresume parsing\b|\bjob matching\b/i, "JobLens AI"],
    [/\belder\s*album\b|\belderalbum\b|\balbum sharing\b/i, "ElderAlbum"],
    [/\bdal\s*park\s*aid\b|\bdalparkaid\b|\bparking app\b|\bcampus parking\b/i, "DalParkAid"],
    [/\bstudy session tracker\b|\bstudy tracker\b/i, "Study Session Tracker"],
  ];

  for (const [pattern, label] of topics) {
    if (pattern.test(text)) return label;
  }

  if (currentTopic && currentTopic !== "Current project") {
    return currentTopic;
  }

  const featureTerms = [
    "api", "schema", "frontend", "backend", "database", "ui", "ux", "authentication", "auth",
    "deployment", "demo", "testing", "integration", "mobile", "react native", "firebase",
    "aws", "lambda", "dynamodb", "s3", "teleprompt", "memory", "retrieval",
  ].filter((term) => normalized.includes(term));

  if (featureTerms.length) {
    const base = currentTopic || "Current project";
    return `${base}: ${featureTerms.slice(0, 3).join(", ")}`;
  }

  return currentTopic;
}

function extractGoal(text: string): string {
  const cleaned = cleanMeetingText(text);
  const patterns = [
    /\b(?:we need to|we have to|we should|let's|let us|the goal is to|our goal is to|we're trying to|we are trying to)\s+(.{6,150})/i,
    /\b(?:need to|have to|should)\s+(.{6,150})/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return compactStateItem(match[1]);
  }

  return "";
}

function extractDecision(text: string): string {
  const cleaned = cleanMeetingText(text);
  const patterns = [
    /\b(?:we decided to|we agreed to|we'll|we will|let's go with|we are going with|we're going with|the decision is to|final decision is to)\s+(.{6,150})/i,
    /\b(?:choose|pick|use)\s+(?:option\s+)?([A-Z0-9][^.!?]{3,120})/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return compactStateItem(match[1]);
  }

  return "";
}

function isBlockerText(text: string): boolean {
  return /\b(blocker|blocked|stuck|waiting for|missing|not working|doesn't work|can't|cannot|failed|failing|bug|error|issue|problem|unclear|no schema|no api|api contract|permission|token|deadline risk)\b/i.test(text);
}

function isAssumptionText(text: string): boolean {
  return /\b(assume|assuming|for now|temporarily|temporary|mock|placeholder|fake data|hardcode|documented assumption|until we get|if we don't have)\b/i.test(text);
}

function extractActionItem(text: string): string {
  const cleaned = cleanMeetingText(text);
  const patterns = [
    /\b(?:i can|i'll|i will|i'm going to|i am going to)\s+(.{6,150})/i,
    /\b(?:you can|you should|can you|could you|please)\s+(.{6,150})/i,
    /\b(?:action item|todo|to do|next step)\s*(?:is|:)?\s*(.{6,150})/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return compactStateItem(match[1]);
  }

  return "";
}

function extractXiangResponsibility(text: string): string {
  const cleaned = cleanMeetingText(text);
  const patterns = [
    /\b(?:xiang|you)\s+(?:can|will|should|take|handle|own|work on)\s+(.{6,140})/i,
    /\b(?:i can take|i'll take|i will take|i can handle|i'll handle|i will handle|i can own|i'll own)\s+(.{6,140})/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      const ownClause = match[1].split(/\band\s+(?:i|you|we|xiang)\b/i)[0] || match[1];
      return compactStateItem(ownClause);
    }
  }

  return "";
}

function deriveNextUsefulMove(state: LiveMeetingState): string {
  if (state.openBlockers.length) {
    return `Unblock the latest blocker: ${state.openBlockers[state.openBlockers.length - 1]}`;
  }
  if (state.currentDecision && !state.actionItems.length) {
    return "Confirm owner and deadline for the decision.";
  }
  if (state.actionItems.length) {
    return `Follow up on: ${state.actionItems[state.actionItems.length - 1]}`;
  }
  if (state.currentGoal) {
    return "Suggest the smallest concrete next step for the goal.";
  }
  return "Clarify the meeting goal, owner, or next step.";
}

function updateMeetingState(state: LiveMeetingState, scene: string, text: string, timestamp: number): LiveMeetingState {
  if (!isMeetingLikeUpdate(scene, text)) return state;

  const next: LiveMeetingState = {
    ...state,
    openBlockers: [...state.openBlockers],
    knownAssumptions: [...state.knownAssumptions],
    actionItems: [...state.actionItems],
    lastUpdatedAt: timestamp,
  };

  next.projectTopic = inferProjectTopic(text, next.projectTopic);

  const goal = extractGoal(text);
  if (goal) next.currentGoal = goal;

  const decision = extractDecision(text);
  if (decision) next.currentDecision = decision;

  if (isBlockerText(text)) {
    next.openBlockers = rememberStateItem(next.openBlockers, text);
  }

  if (isAssumptionText(text)) {
    next.knownAssumptions = rememberStateItem(next.knownAssumptions, text);
  }

  const actionItem = extractActionItem(text);
  if (actionItem) {
    next.actionItems = rememberStateItem(next.actionItems, actionItem);
  }

  const responsibility = extractXiangResponsibility(text);
  if (responsibility) {
    next.xiangResponsibility = responsibility;
  }

  next.nextUsefulMove = deriveNextUsefulMove(next);
  return next;
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
        meetingState: createEmptyMeetingState(timestamp),
      };
    }

    this.activeEvent!.lastTimestamp = timestamp;
    this.activeEvent!.scene = this.activeEvent!.scene === "daily_chat" ? scene : this.activeEvent!.scene;
    this.activeEvent!.transcripts.push(text);
    this.activeEvent!.meetingState = updateMeetingState(
      this.activeEvent!.meetingState,
      this.activeEvent!.scene,
      text,
      timestamp,
    );
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
      summary: makeSummary(event.scene, event.transcripts, event.aiReplies, event.meetingState),
      transcriptCount: event.transcripts.length,
      aiReplyCount: event.aiReplies.length,
      recentTranscripts: event.transcripts.slice(-6),
      meetingState: hasMeetingStateContent(event.meetingState) ? event.meetingState : undefined,
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
    const summary = makeSummary(event.scene, event.transcripts, event.aiReplies, event.meetingState);

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
