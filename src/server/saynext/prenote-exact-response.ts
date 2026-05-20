import type { AgentResponse } from "../mastra/types";
import { createInsight } from "./response-factory";
export function getPrenoteExactAnswerImmediateResponse(
  transcript: string,
  prenoteContext: string,
  timestamp: number,
): AgentResponse | null {
  const context = prenoteContext.trim();
  if (!context || /^No active prenote\.$/i.test(context)) return null;

  const lines = context
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !/^(active prenote excerpt|section:|chunk:|exact excerpt:|only these exact prenote|---|#)/i.test(line);
    });

  const cleanLine = (line: string): string => line
    .replace(/^[A-Z0-9_ -]{3,80}:\s*/i, "")
    .replace(/^[-*]\s*/, "")
    .trim();

  const isBadFactLine = (line: string): boolean => {
    return /^(noise|filler|unrelated)\b/i.test(line) || /\bunrelated chat\b/i.test(line);
  };

  const findLine = (...patterns: RegExp[]): string | null => {
    const line = lines.find((candidate) => !isBadFactLine(candidate) && patterns.every((pattern) => pattern.test(candidate)));
    return line ? cleanLine(line) : null;
  };

  if (/\b(deadline|due|due date|final report)\b/i.test(transcript) || /哪天|什么时候|截止|交/.test(transcript)) {
    const line = findLine(/\b(deadline|due)\b/i);
    if (line) return createInsight(line, "Immediate exact prenote deadline answer", timestamp, 0.92);
  }

  if (/\b(where|room|location|rehearsal)\b/i.test(transcript) || /哪里|在哪|房间|教室/.test(transcript)) {
    const line = findLine(/(?:rehearsal|building|location|(?:^|[^a-z])room(?:[^a-z]|$))/i);
    if (line) return createInsight(line, "Immediate exact prenote room answer", timestamp, 0.92);
  }

  if (/\b(demo|rubric|mention|include|show)\b/i.test(transcript)) {
    const line = /\b(demo|rubric)\b/i.test(transcript)
      ? (findLine(/\b(demo|rubric)\b/i) || findLine(/\bmention\b/i))
      : findLine(/\bmention\b/i);
    if (line) return createInsight(line, "Immediate exact prenote rubric answer", timestamp, 0.9);
  }

  if (/\b(api|contract|field|fields|schema)\b/i.test(transcript)) {
    const line = findLine(/\b(field|fields|api|contract)\b/i);
    if (line) return createInsight(line, "Immediate exact prenote API-field answer", timestamp, 0.9);
  }

  return null;
}
