const getApiUrl = () => window.location.origin;

export type SessionMemoryCandidateStatus = "pending" | "approved" | "rejected" | "promoted";
export type SessionMemoryCandidateSensitivity = "low" | "medium" | "high";
export type SessionMemoryReviewMode = "manual_only" | "auto_safe_knowledge" | "review_all";

export interface SessionMemoryDateMetadata {
  eventTime: string;
  mentionedDate: string | null;
  dateSource: "transcript" | "inferred_from_session_time" | "session_time_only";
  dateConfidence: number;
  dateEvidence: string[];
}

export interface SessionMemoryCandidate {
  id: number;
  userId: string;
  sessionId: string;
  candidateType: string;
  title: string;
  category: string;
  sensitivity: SessionMemoryCandidateSensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  evidence: string[];
  confidence: number;
  valueScore: number;
  riskScore: number;
  validation: {
    valid?: boolean;
    safeToPromote?: boolean;
    flags?: string[];
    duplicateMemoryRefs?: string[];
    dateMetadata?: SessionMemoryDateMetadata;
    reason?: string;
    extractorReason?: string;
  };
  dateMetadata: SessionMemoryDateMetadata | null;
  status: SessionMemoryCandidateStatus;
  model: string | null;
  contentHash: string;
  promotedMemoryId: number | null;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return data.error || fallback;
}

export async function fetchSessionMemoryCandidates(input: {
  userId: string;
  status?: string;
  sessionId?: string;
  limit?: number;
}): Promise<SessionMemoryCandidate[]> {
  const params = new URLSearchParams({
    userId: input.userId,
    status: input.status || "pending",
    limit: String(input.limit || 100),
  });
  if (input.sessionId) params.set("sessionId", input.sessionId);

  const response = await fetch(`${getApiUrl()}/api/session-memory-candidates?${params.toString()}`);
  if (!response.ok) throw new Error(await readError(response, "Failed to load memory candidates"));
  const data = await response.json();
  return data.candidates || [];
}

export async function extractSessionMemoryCandidates(input: {
  userId: string;
  sessionId: string;
  limitCandidates?: number;
  reviewMode?: SessionMemoryReviewMode;
}): Promise<{
  candidates: SessionMemoryCandidate[];
  sessionSummary: string;
  model: string;
  provider?: "ollama" | "openai";
  runtimeMode?: "local" | "travel";
  batchEnabled?: boolean;
  promoted?: Array<{ candidateId: number; memoryId: number; title: string }>;
  reviewMode?: SessionMemoryReviewMode;
}> {
  const response = await fetch(`${getApiUrl()}/api/session-memory/${encodeURIComponent(input.sessionId)}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId,
      limitCandidates: input.limitCandidates || 8,
      reviewMode: input.reviewMode || "manual_only",
    }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to extract memory candidates"));
  return response.json();
}

export async function updateSessionMemoryCandidate(input: {
  userId: string;
  id: number;
  title?: string;
  category?: string;
  sensitivity?: SessionMemoryCandidateSensitivity;
  content?: string;
  usageRule?: string;
  keywords?: string[];
  evidence?: string[];
  status?: SessionMemoryCandidateStatus;
}): Promise<SessionMemoryCandidate> {
  const { id, ...body } = input;
  const response = await fetch(`${getApiUrl()}/api/session-memory-candidates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to update candidate"));
  const data = await response.json();
  return data.candidate;
}

export async function promoteSessionMemoryCandidate(input: {
  userId: string;
  id: number;
  edit?: {
    title: string;
    category: string;
    sensitivity: SessionMemoryCandidateSensitivity;
    content: string;
    usageRule: string;
    keywords: string[];
    evidence: string[];
  };
}): Promise<void> {
  const response = await fetch(`${getApiUrl()}/api/session-memory-candidates/${input.id}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: input.userId, edit: input.edit }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to promote candidate"));
}

export async function rejectSessionMemoryCandidate(input: {
  userId: string;
  id: number;
  reason?: string;
}): Promise<SessionMemoryCandidate> {
  const response = await fetch(`${getApiUrl()}/api/session-memory-candidates/${input.id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: input.userId, reason: input.reason || "Rejected in Memory Review" }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to reject candidate"));
  const data = await response.json();
  return data.candidate;
}

export async function deleteSessionMemoryCandidate(userId: string, id: number): Promise<void> {
  const response = await fetch(`${getApiUrl()}/api/session-memory-candidates/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to delete candidate"));
}
