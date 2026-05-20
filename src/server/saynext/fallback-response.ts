import type { AgentResponse } from "../mastra/types";
import { createInsight } from "./response-factory";
export function getFallbackResponse(transcript: string, timestamp: number): AgentResponse {
  const normalized = transcript.trim().toLowerCase();

  if (/^(definitely|yeah|yes|right|exactly|true|sounds good)[.!]*$/i.test(normalized)) {
    return createInsight(
      "Yeah, that makes sense.",
      "Fallback acknowledgement after model failure",
      timestamp,
      0.4,
    );
  }

  if (normalized.includes("do you like") || normalized.includes("what do you think")) {
    return createInsight(
      "Yeah, I think so, but I need a second to explain it clearly.",
      "Fallback buy-time response after model failure",
      timestamp,
      0.4,
    );
  }

  return createInsight(
    "Sorry, could you say that again?",
    "Fallback clarification after model failure",
    timestamp,
    0.3,
  );
}
