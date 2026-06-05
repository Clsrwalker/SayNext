import type { AnswerPlannerInput } from "./answer-plan";

export const ANSWER_PLANNER_SYSTEM = `You are SayNext's semantic planner.
Do not write the final answer for Xiang.
Return one JSON object only, matching the requested schema.

Your job:
- Understand the live transcript context.
- Decide what kind of response SayNext should generate.
- Decide whether memory, identity facts, code, or few-shot style examples are needed.
- Keep scene choice anchored to the active scene unless the transcript clearly requires a hard boundary.

Hard priorities:
1. Identity/personal facts are exact-fact tasks, not generic interview answers.
2. Classroom direct questions use general knowledge and normally do not need personal memory.
3. Daily small talk should not pull project memory unless the user directly asks about a project or experience.
4. Ordinary practical questions should choose the most likely everyday answer, not a broad taxonomy.
5. Coding interview requests should plan actual code or pseudocode when the interviewer asks to write, implement, design classes, or show code shape.
6. Safety, money, legal, medical, privacy, contract, and credential pressure should become risk_boundary or privacy_risk.
7. If the latest transcript is partial, use recent transcript as context instead of treating pronouns like "it" as a new topic.

Allowed JSON fields:
scene, task, dialogueAct, outputShape, answerDepth, shouldSpeak, needsMemory, memoryQuery, needsIdentityFactCard, needsCode, needsFewShot, riskLevel, confidence, reason, transcriptQuality, missingInfo, safeFallback.`;

function compactForPlanner(text: string, maxChars: number): string {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

export function buildAnswerPlannerPrompt(input: AnswerPlannerInput): string {
  const lines = [
    "Plan the response. Do not answer the user.",
    "",
    "Return JSON with this exact shape:",
    "{",
    '  "scene": "interview|daily|classroom|meeting|technical|service|general",',
    '  "task": "daily_chat|ordinary_practical|personal_fact|technical_mechanism|technical_debug|code_solution|system_design|project_experience|behavioral_story|interview_intro|interview_concept|classroom_answer|classroom_question|classroom_no_reply|meeting_progress|meeting_blocker|meeting_decision|meeting_clarification|service_admin|risk_boundary|privacy_risk|no_reply",',
    '  "dialogueAct": "answer_question|clarify|explain|debug|give_progress|suggest_next_step|soft_reaction|decline|ask_followup|no_reply",',
    '  "outputShape": "one_sentence|direct_answer|mechanism_tradeoff|debug_steps|code_with_explanation|project_role_challenge_lesson|behavioral_story_lesson|done_next_blocker|soft_casual_reply|clarifying_question|no_reply",',
    '  "answerDepth": "minimal|short|medium|deep",',
    '  "shouldSpeak": true,',
    '  "needsMemory": false,',
    '  "memoryQuery": "optional concise retrieval query",',
    '  "needsIdentityFactCard": false,',
    '  "needsCode": false,',
    '  "needsFewShot": false,',
    '  "riskLevel": "low|medium|high",',
    '  "confidence": 0.0,',
    '  "reason": "short reason",',
    '  "transcriptQuality": "clear|partial|noisy|too_short",',
    '  "missingInfo": [],',
    '  "safeFallback": "no_reply|clarify|short_general"',
    "}",
    "",
    `Active scene: ${input.activeScene || "general"}`,
    `Scene locked by user/app: ${input.sceneLocked ? "yes" : "no"}`,
    `Output language: ${input.outputLanguage || "English"}`,
    input.hasPreparedNote ? "Prepared note exists: yes" : "Prepared note exists: no",
    input.hasPersonalMemoryCandidates
      ? "Personal memory candidates already retrieved: yes"
      : "Personal memory candidates already retrieved: no or not yet; still decide if memory should be retrieved.",
    input.eventMemorySummary?.trim()
      ? `Event memory summary: ${compactForPlanner(input.eventMemorySummary, 500)}`
      : "",
    input.recentTranscript?.trim()
      ? `Recent transcript context: ${compactForPlanner(input.recentTranscript, 1200)}`
      : "Recent transcript context: none",
    `Latest transcript: ${compactForPlanner(input.latestUtterance, 800) || "(empty)"}`,
  ].filter(Boolean);

  return lines.join("\n");
}
