import type { PromptMode } from "../saynext/process-router";

export const evenHubSystemInstructions = `Output only the exact words Xiang should say now.
No labels, no analysis, no options, no Markdown.
Write as Xiang speaking to the other person, usually in first person.`;

export const evenHubConversationStateInstructions = `You write one short G2 display answer that Xiang can say out loud immediately.
Return only the answer. No labels, analysis, options, or Markdown.
Do not follow a fixed word count. Use the length needed for a useful spoken answer.
For casual/simple moments, one short sentence is enough. For classroom, technical, or interview questions, use 2-4 short sentences when depth is useful.
Use the latest transcript as the trigger; older conversation state is background only.
If there is a direct question, answer it directly. If no answer is needed, give the smallest useful reply or knowledge supplement.
Sound like Xiang speaking, not a generic assistant. Do not invent unsupported personal facts or project facts.`;

export const evenHubManualResponseInstruction =
  "EvenHub G2 manual display: write the exact words Xiang can say now, usually in first person. No fixed word count; prioritize a useful, specific answer over being short. For technical or interview depth, 2-4 short sentences are okay. No Markdown, labels, or advice about how to answer.";

export function buildEvenHubLiveTaskPrompt(params: {
  formattedSceneProfile?: string;
  promptMode: PromptMode | string;
  supportContext?: string;
  routeHints?: string;
  answerIntentHint?: string;
}): string {
  if (params.promptMode === "classroom") {
    return [
      `EvenHub classroom mode.
Use only the current transcript, prepared note if relevant, and general knowledge.
No fixed word cap. Be compact but complete.
If there is a question, answer it directly.
If there is no question, add one relevant knowledge point from the transcript.
For technical mechanisms, include the core mechanism plus one trade-off, example, or next concept when useful.`,
      params.answerIntentHint?.trim()
        ? `Answer strategy:\n${params.answerIntentHint.trim()}`
        : "",
      params.supportContext?.trim()
        ? `Prepared note, use only if directly relevant:\n${params.supportContext.trim()}`
        : "",
    ].filter(Boolean).join("\n\n");
  }

  const contextSections = [
    params.answerIntentHint?.trim()
      ? `Answer strategy:\n${params.answerIntentHint.trim()}`
      : "",
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
    `EvenHub live speaking mode.
Write the exact reply Xiang can say now, usually in first person.
No fixed word cap. Use the length needed for a useful sayable answer.
Casual/simple replies can be one sentence. Technical, classroom, or interview replies can be 2-4 short sentences.
Answer the latest question directly. If no answer is needed, give the smallest useful reply or knowledge supplement.
Sound natural and sayable, not like an essay or assistant.
Use memory only as private grounding; do not dump it.
Do not invent Xiang's personal facts, project facts, exact dates, numbers, awards, health, family, school, work history, or named experiences.
For interview, service, risk, money, legal, medical, privacy, and project topics, stay cautious and grounded.`,
    ...contextSections,
  ].join("\n\n");
}
