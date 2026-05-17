const getApiUrl = () => window.location.origin;

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  const detail = typeof data.error === "string" ? data.error : fallback;
  return `${detail} (${response.status})`;
}

export interface TranscriptExportSession {
  userId: string;
  sessionId: string;
  title: string;
  scenes: string[];
  status: string;
  startTimestamp: string;
  lastTimestamp: string;
  eventCount: number;
  transcriptCount: number;
  aiReplyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptExportSample {
  id: number;
  timestamp: string;
  transcript: string;
  aiReply: string | null;
  actionType: string;
  reasoning: string | null;
}

export interface TranscriptExportDetail {
  session: TranscriptExportSession;
  events: Array<{
    id: string;
    title: string;
    scene: string;
    status: string;
    startTimestamp: string;
    lastTimestamp: string;
    transcriptCount: number;
    aiReplyCount: number;
    rawTranscript: string;
  }>;
  samples: TranscriptExportSample[];
  transcriptText: string;
  aiOutputText: string;
  fullText: string;
}

export async function fetchTranscriptExports(userId: string, limit = 50): Promise<TranscriptExportSession[]> {
  if (!userId.trim()) throw new Error("Missing userId. Reopen the MiniApp from MentraOS.");

  const response = await fetch(`${getApiUrl()}/api/transcript-exports?userId=${encodeURIComponent(userId)}&limit=${limit}`);
  if (!response.ok) throw new Error(await readError(response, "Failed to fetch transcript exports"));

  const data = await response.json();
  return data.sessions || [];
}

export async function fetchTranscriptExport(userId: string, sessionId: string): Promise<TranscriptExportDetail> {
  if (!userId.trim()) throw new Error("Missing userId. Reopen the MiniApp from MentraOS.");

  const response = await fetch(
    `${getApiUrl()}/api/transcript-exports/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}`,
  );
  if (!response.ok) throw new Error(await readError(response, "Failed to fetch transcript export"));

  return response.json();
}

export async function summarizeTranscriptExport(userId: string, sessionId: string): Promise<{ summary: string; model: string }> {
  const response = await fetch(`${getApiUrl()}/api/transcript-exports/${encodeURIComponent(sessionId)}/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to summarize transcript"));

  return response.json();
}
