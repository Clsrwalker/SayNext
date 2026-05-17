import type { Context } from "hono";
import { conversationLogger, type ConversationEventRecord, type ConversationSampleRecord } from "../data/conversation-logger";

const SUMMARY_MODEL = process.env.TRANSCRIPT_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

function readJsonBody(c: Context): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { hour12: false });
}

function buildTranscriptText(samples: ConversationSampleRecord[], fallbackEvents: ConversationEventRecord[]): string {
  if (samples.length > 0) {
    return samples
      .map((sample) => `[${formatTime(sample.timestamp)}] ${sample.transcript}`)
      .join("\n");
  }

  return fallbackEvents
    .map((event) => `# ${event.title}\n${event.rawTranscript}`)
    .join("\n\n");
}

function buildAiOutputText(samples: ConversationSampleRecord[]): string {
  return samples
    .filter((sample) => sample.aiReply && sample.aiReply.trim())
    .map((sample) => `[${formatTime(sample.timestamp)}] ${sample.aiReply}`)
    .join("\n");
}

function buildFullExport(input: {
  title: string;
  sceneLine: string;
  startTimestamp: string;
  lastTimestamp: string;
  transcriptText: string;
  aiOutputText: string;
}): string {
  return [
    `Title: ${input.title}`,
    input.sceneLine ? `Scenes: ${input.sceneLine}` : "",
    `Start: ${formatTime(input.startTimestamp)}`,
    `End: ${formatTime(input.lastTimestamp)}`,
    "",
    "## Transcript",
    input.transcriptText || "(No transcript text)",
    "",
    "## AI Outputs",
    input.aiOutputText || "(No AI outputs)",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function buildExportDetail(userId: string, sessionId: string) {
  const session = conversationLogger.getTranscriptExportSession(userId, sessionId);
  if (!session) return null;

  const events = conversationLogger.listEventsForSession(userId, sessionId);
  const samples = conversationLogger.listSamplesForSessionWindow(
    userId,
    sessionId,
    session.startTimestamp,
    session.lastTimestamp,
  );

  const transcriptText = buildTranscriptText(samples, events);
  const aiOutputText = buildAiOutputText(samples);
  const sceneLine = session.scenes.join(", ");
  const fullText = buildFullExport({
    title: session.title,
    sceneLine,
    startTimestamp: session.startTimestamp,
    lastTimestamp: session.lastTimestamp,
    transcriptText,
    aiOutputText,
  });

  return {
    session,
    events,
    samples,
    transcriptText,
    aiOutputText,
    fullText,
  };
}

async function callOpenAISummary(fullText: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const prompt = [
    "Summarize this SayNext session export.",
    "Keep it practical and useful for Xiang.",
    "Return concise plain text with these sections:",
    "Summary",
    "Key points",
    "Questions / action items",
    "Useful memory candidates",
    "",
    "Session export:",
    fullText.slice(0, 60000),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI summary failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (typeof data.output_text === "string") return data.output_text.trim();

  const texts: string[] = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") texts.push(content.text);
    }
  }
  return texts.join("\n").trim();
}

export const listTranscriptExports = (c: Context) => {
  const userId = c.req.query("userId");
  const limit = Number(c.req.query("limit") || 50);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  return c.json({
    enabled: conversationLogger.isEnabled(),
    sessions: conversationLogger.listTranscriptExportSessions(userId, limit),
  });
};

export const getTranscriptExport = (c: Context) => {
  const userId = c.req.query("userId");
  const sessionId = c.req.param("sessionId");
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  const detail = buildExportDetail(userId, sessionId);
  if (!detail) return c.json({ error: "Session export not found" }, 404);

  return c.json(detail);
};

export const summarizeTranscriptExport = async (c: Context) => {
  const sessionId = c.req.param("sessionId");
  const body = await readJsonBody(c);
  const userId = String(body.userId || c.req.query("userId") || "").trim();
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  const detail = buildExportDetail(userId, sessionId);
  if (!detail) return c.json({ error: "Session export not found" }, 404);

  try {
    const summary = await callOpenAISummary(detail.fullText);
    return c.json({ summary, model: SUMMARY_MODEL });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to summarize transcript" }, 500);
  }
};
