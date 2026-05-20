import type { AgentResponse } from "../mastra/types";
import { createInsight } from "./response-factory";
import { extractPossibleNamedEntities } from "./teleprompt-runtime";
export function getUnsupportedPremiseImmediateResponse(transcript: string, timestamp: number, trustedContext: string): AgentResponse | null {
  const normalized = transcript.toLowerCase();
  const context = trustedContext.toLowerCase();
  const lacks = (term: string) => !context.includes(term.toLowerCase());

  if (/\bgoogle\b/.test(normalized) && /\b(internship|worked|work|role|team|experience|impact|start)\b/.test(normalized)) {
    return createInsight(
      "No, that is a misunderstanding. I have not worked at Google. The real project on my resume is Hybrid Search Memory Assistant, where I worked on real-time transcripts, memory retrieval, and response quality.",
      "Immediate boundary for unsupported Google work premise",
      timestamp,
      0.9,
    );
  }

  if (/\bgoogle\b/.test(normalized) && /\b(company|system|project|under|google-like|google like|different|resume|sure)\b/.test(normalized)) {
    return createInsight(
      "There was no Google project or company behind it. I was correcting the premise. The real project I can talk about is Hybrid Search Memory Assistant, where I worked on retrieval, transcript context, and response quality.",
      "Immediate boundary for unsupported Google follow-up",
      timestamp,
      0.9,
    );
  }

  if (/\bshopify\b/.test(normalized) && /\b(internship|worked|work|outage|experience)\b/.test(normalized) && lacks("shopify")) {
    return createInsight(
      "I haven't worked at Shopify, so I wouldn't frame it as my own experience. A real adjacent example is Hybrid Search Memory Assistant, where I had to debug messy real-time behavior and improve the response flow.",
      "Immediate boundary for unsupported Shopify work premise",
      timestamp,
      0.9,
    );
  }

  if (/\b(award|hackathon winner|won for)\b/.test(normalized) && (!context.includes("award") || !context.includes("won"))) {
    return createInsight(
      "I haven't won that exact award, so I wouldn't present it as something that happened. I can talk about Hybrid Search Memory Assistant as a real project and explain what I built, tested, and improved.",
      "Immediate boundary for unsupported award premise",
      timestamp,
      0.9,
    );
  }

  if (/\bproduction outage\b/.test(normalized) && lacks("production outage")) {
    return createInsight(
      "I haven't caused a real production outage at work, so I wouldn't claim that. A real example is debugging Hybrid Search Memory Assistant's real-time transcript flow, where stale context and partial speech could lead to bad responses.",
      "Immediate boundary for unsupported production outage premise",
      timestamp,
      0.9,
    );
  }

  const unsupportedEntities = extractPossibleNamedEntities(transcript).filter((entity) => !context.includes(entity.toLowerCase()));
  if (
    unsupportedEntities.length &&
    /\b(your|you)\b/.test(normalized) &&
    /\b(project|architecture|internship|offer|paper|course|certification|benchmark|startup)\b/.test(normalized)
  ) {
    const entity = unsupportedEntities[0];
    return createInsight(
      `I don't have a project or experience called ${entity}, so I wouldn't make up its architecture. A real project I can explain is Hybrid Search Memory Assistant, especially the live transcript flow, memory retrieval, scene profiles, and local/travel mode trade-off.`,
      "Immediate boundary for unsupported named entity premise",
      timestamp,
      0.88,
    );
  }

  return null;
}
