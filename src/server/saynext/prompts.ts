import type { PromptMode } from "./process-router";

export const sayNextInstructions = `Output only the exact short text that should be shown on Xiang's display.
No labels, no analysis, no options, no Markdown.`;

export function buildSayNextLiveTaskPrompt(params: {
  formattedSceneProfile?: string;
  promptMode: PromptMode | string;
  supportContext?: string;
  routeHints?: string;
}): string {
  if (params.promptMode === "classroom") {
    return [
      `Classroom mode.
Use only the current transcript and general knowledge.
12-45 English words by default.
If there is a question, answer it directly.
If there is no question, add one relevant knowledge point from the transcript.`,
      params.supportContext?.trim()
        ? `Prepared note, use only if directly relevant:\n${params.supportContext.trim()}`
        : "",
    ].filter(Boolean).join("\n\n");
  }

  const contextSections = [
    params.formattedSceneProfile?.trim()
      ? `Scene guidance:\n${params.formattedSceneProfile.trim()}`
      : "",
    params.supportContext?.trim()
      ? `Trusted private context, use only if directly relevant:\n${params.supportContext.trim()}`
      : "",
    params.routeHints?.trim()
      ? `Route and guard hints, do not copy as a fixed answer:\n${params.routeHints.trim()}`
      : "",
  ].filter(Boolean);

  return [
    `Live speaking mode.
12-45 English words by default.
Answer the latest question directly. If no answer is needed, give the smallest useful reply.
Sound natural and sayable, not like an essay or assistant.
Use memory only as private grounding; do not dump it.
Do not invent Xiang's personal facts, project facts, exact dates, numbers, awards, health, family, school, work history, or named experiences.
For interview, service, risk, money, legal, medical, privacy, and project topics, stay cautious and grounded.`,
    ...contextSections,
  ].join("\n\n");
}

export const telepromptInstructions = `You write natural spoken teleprompt scripts for Xiang.

Return only the script text. No JSON, no labels, no bullet points, no stage directions.

The script should sound like Xiang speaking:
- natural spoken English by default
- simple, slightly imperfect, not corporate
- clear enough for interviews, IELTS, presentations, or project explanations
- like Xiang after thinking for a few seconds: clearer, calmer, and more confident, but still modest and believable
- useful for gaining conversation advantage: stronger logic, smoother flow, and grounded personal detail when available
- concrete when useful, but do not invent high-risk facts
- for IELTS/daily examples, stay grounded; if exact memory is missing, keep the detail generic instead of inventing a named movie, show, room, store, restaurant, park, trip, object, friend, animal encounter, or recent event

Avoid:
- "Today I will talk about"
- "In conclusion"
- fake senior work experience
- unsupported company, school, family, health, immigration, award, exact date, or named-person facts
- response playbooks as fake personal anecdotes; use them only as structure when no real story exists`;
