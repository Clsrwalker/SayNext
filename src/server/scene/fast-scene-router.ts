export type SceneBuiltinKey = "daily_chat" | "classroom" | "interview" | "meeting_group";

export interface FastSceneRouteInput {
  latestTranscript: string;
  recentTranscripts?: string[];
  previousSceneKey?: SceneBuiltinKey;
}

export interface FastSceneRouteResult {
  sceneKey: SceneBuiltinKey;
  confidence: number;
  reason: string;
  scores: Record<SceneBuiltinKey, number>;
}

const SCENE_KEYS: SceneBuiltinKey[] = ["daily_chat", "classroom", "interview", "meeting_group"];

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s?$]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function has(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function speakerLabelCount(text: string): number {
  return (String(text || "").match(/\b[A-Z][A-Z_ .'-]{0,24}\s*:/g) || []).length;
}

function add(score: Record<SceneBuiltinKey, number>, key: SceneBuiltinKey, amount: number): void {
  score[key] += amount;
}

function isGenericSpeakingPrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(project|technical|engineering|software|cloud|aws|lambda|dynamodb|react|firebase|api|debug|bug|code|system|architecture|interview|candidate|resume|work|student|study|workplace|production|role|position|hire|portfolio|internship)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:mobile|web|app|application|react native|development|technical|software)\s+experience\b/.test(normalized)
    || /\bapp development\b/.test(normalized)) {
    return false;
  }
  return /\b(describe|do you|did you|have you|what kind of|what type of|what is the difference|what do you usually|what do you learn from|who is|where do you|when was|how often|why do you|should you)\b/.test(normalized);
}

function confidenceFromMargin(top: number, second: number): number {
  const margin = top - second;
  if (top >= 5 && margin >= 2.2) return 0.94;
  if (top >= 4 && margin >= 1.6) return 0.9;
  if (top >= 3 && margin >= 1.1) return 0.84;
  if (top >= 2.2 && margin >= 0.8) return 0.78;
  if (top >= 1.7 && margin >= 0.5) return 0.68;
  return 0.55;
}

export function routeFastScene(input: FastSceneRouteInput): FastSceneRouteResult {
  const latest = normalize(input.latestTranscript);
  const recent = normalize((input.recentTranscripts || []).slice(-4).join(" "));
  const combined = `${recent} ${latest}`.trim();
  const scores: Record<SceneBuiltinKey, number> = {
    daily_chat: 0.35,
    classroom: 0,
    interview: 0,
    meeting_group: 0,
  };

  if (!latest) {
    return { sceneKey: input.previousSceneKey || "daily_chat", confidence: 0.5, reason: "empty", scores };
  }

  // Daily life / service / casual conversation.
  if (has(latest, /\b(good morning|morning|how s your day|how is your day|how are you|what are you up to|weekend|after class|hang out|grab food|take it easy|chill|cooked|ngl|lol|anime|game|reddit|takeout)\b/i)) {
    add(scores, "daily_chat", 2.2);
  }
  if (has(latest, /\b(store|shop|shopping|cashier|receipt|final sale|restaurant|food|menu|allergy|peanut|sesame|tap|insert|card|cash|deposit|refund|lease addendum|medicine|pharmacist|doctor|mom|family|property rent|wedding|toast|ceremony|front desk)\b/i)) {
    add(scores, "daily_chat", 2.5);
  }
  if (has(latest, /\b(return|exchange)\b/i) && has(latest, /\b(receipt|final sale|fit|hoodie|shirt|clothes|store|item)\b/i)) {
    add(scores, "daily_chat", 2.5);
  }

  // Classroom: teaching, course logistics, academic concepts, and class participation.
  if (has(combined, /\b(class|classroom|lecture|teacher|professor|instructor|course|assignment|rubric|deadline|final report|midterm|exam|tutorial|lab|homework|ta)\b/i)) {
    add(scores, "classroom", 1.8);
  }
  if (has(latest, /\b(indexes?|database|lambda cold start|kinesis|model generalizing|training data|recommender|cloud architecture|dynamodb|warehouse|query|algorithm|complexity)\b/i)) {
    add(scores, "classroom", 1.7);
  }
  if (has(latest, /\b(backpropagation|neural networks?|cnns?|convolutional|gradient|loss function|transformers?|attention|supervised learning|prepared statements?|sql injection|hashed|salted|imbalanced classification|precision|recall|orthonormal|full rank|singular|linearly dependent|matrix|vectors?|replicas?|eventual consistency)\b/i)) {
    add(scores, "classroom", 2.4);
  }
  if (has(latest, /\blambda\b/i) && has(latest, /\bcold\b/i) && has(latest, /\bstart\b/i)) {
    add(scores, "classroom", 2.4);
  }
  if (has(latest, /\baccuracy\b/i) && has(latest, /\b(classification|imbalanced|enough)\b/i)) {
    add(scores, "classroom", 2.0);
  }
  if (has(latest, /\b(images?|molecules?|solid|liquid|gas|least squares|gaussian elimination|public policy|politics|power)\b/i)) {
    add(scores, "classroom", 1.6);
  }
  if (has(combined, /\b(less than|equal to|divide by negative|flip (?:the )?sign|algebra|equation|liquid nitrogen|getting hotter|getting colder|everybody say|what do you think is happening)\b/i)) {
    add(scores, "classroom", 2.0);
  }
  if (has(latest, /\b(can you explain|why does|what is the difference|how does .* work|would it be fair to say|could you clarify)\b/i)) {
    add(scores, "classroom", 1.1);
  }
  if (has(latest, /^(?:why|what|how)\b/i) && has(latest, /\b(need|prevent|mean|point|difference|work|happen|useful|enough)\b/i)) {
    add(scores, "classroom", 0.8);
  }

  // Interview / IELTS / formal evaluation.
  if (has(combined, /\b(interview|interviewer|resume|cv|candidate|hiring|behavioral|technical interview|leetcode|tell me about a time|strength|weakness|conflict with a teammate|failure|leadership|constructive feedback)\b/i)) {
    add(scores, "interview", 3.2);
  }
  if (
    has(latest, /\b(ielts|part one|part 1|part two|part 2|part three|speaking test|do you work or are you a student|work or study|introduce yourself|self introduction)\b/i)
    || has(latest, /\bwork\b.{0,40}\bor\b.{0,40}\bare\s+you(?:\s+a)?(?:\s+student)?\b/i)
  ) {
    add(scores, "interview", 2.8);
  }
  if (has(latest, /\b(tell me about|describe|walk me through|explain your project|hardest bug|why should we hire|what was your role)\b/i)) {
    add(scores, "interview", 2.3);
  }
  if (has(latest, /\b(what kind of role are you looking for|what role are you looking for|what position are you looking for|why this role)\b/i)) {
    add(scores, "interview", 2.8);
  }
  if (has(latest, /\b(mobile app experience|web app experience|react native experience|software experience|technical experience|development experience|app development experience)\b/i)) {
    add(scores, "interview", 2.8);
  }
  if (has(latest, /\b(code review feedback|harsh feedback|dramatic conflict|answer .*feedback|answer .*conflict)\b/i)) {
    add(scores, "interview", 2.4);
  }
  if (isGenericSpeakingPrompt(latest)) {
    add(scores, "daily_chat", 1.7);
    scores.interview = Math.max(0, scores.interview - 1.4);
    scores.classroom = Math.max(0, scores.classroom - 0.9);
    scores.meeting_group = Math.max(0, scores.meeting_group - 0.9);
  }

  // Meeting / group work.
  if (has(combined, /\b(meeting|team|group discussion|sprint|milestone|standup|blocker|blocked|next step|action item|owner|deadline|decision|scope|requirement|api contract|schema|pull request|merge|demo|progress update)\b/i)) {
    add(scores, "meeting_group", 3.0);
  }
  if (has(latest, /\b(users? (?:were|are) confused|query is getting slow|test data is too clean|only have .* days?|before submission|worked out because|loan request|refinanced|secondary market|cleared another|departure roll|notifications before fixing|matching bug)\b/i)) {
    add(scores, "meeting_group", 2.0);
  }
  if (has(combined, /\b(mobile flow|api response|api responses|matching bug|project aim|user interface designer|project manager|working design|user requirements specs|bank products|trust department|hold the account|irs|deduction|scanning|horizon|fauker|switch em|did a good job|need to say it)\b/i)) {
    add(scores, "meeting_group", 2.0);
  }
  if (has(combined, /\bnotifications?\b/i) && has(combined, /\b(app|mobile|users?|bug|fix|before fixing|flow|feature|settings|project|product)\b/i)) {
    add(scores, "meeting_group", 1.8);
  }
  if (has(latest, /\b(test data .* clean|real user speech|compared with real user speech|compared to real user speech)\b/i)) {
    add(scores, "meeting_group", 2.2);
  }
  if (has(latest, /\b(current flow|privacy issue|rollback owner|smoke test|who owns|can you take|should we prioritize|must have|nice to have|what do you think we should do next)\b/i)) {
    add(scores, "meeting_group", 2.1);
  }
  if (has(latest, /\b(can'?t finish|cannot finish|won'?t finish|not finish|too much|by tomorrow|before demo|by the deadline|scope|cut)\b/i)
    && has(latest, /\b(file upload|upload|search|summary|sharing|feature|features|demo|deadline)\b/i)) {
    add(scores, "meeting_group", 3.0);
  }
  if (has(latest, /\b(a says|b says|someone said|the team|we need to decide|let's decide|we should confirm)\b/i)) {
    add(scores, "meeting_group", 1.5);
  }
  const labelledTurns = speakerLabelCount(`${(input.recentTranscripts || []).join(" ")} ${input.latestTranscript}`);
  if (labelledTurns >= 3) {
    const teachingLabelContext = has(combined, /\b(professor|teacher|student|everybody|equation|liquid nitrogen|less than|equal to|divide|sign|what do you think is happening|am i doing that right|got that right|skip this one|molecules?|solid|liquid|gas|public policy|politics|power)\b/i);
    const workLabelContext = has(combined, /\b(team|meeting|project aim|project manager|user interface designer|working design|user requirements|prototype|remote|button|ui|ux|loan request|refinanced|secondary market|bank products|trust department|irs|deduction|handled his line of credit|tc|coordination|arts functions|departure roll|cleared another|scanning|horizon|vet service|doctor|case|task|decision|explain this|identifiable|drawn|whale|elephant|supposed to be)\b/i);
    const casualLabelContext = has(combined, /\b(ex boyfriend|boyfriend|mom|lawn|grass clippings|tap dance|watching tv|radio thief|neighbor|weather|favorite shows)\b/i);
    if (teachingLabelContext) {
      add(scores, "classroom", 1.8);
      scores.meeting_group = Math.max(0, scores.meeting_group - 0.6);
    } else if (workLabelContext) {
      add(scores, "meeting_group", 1.5);
    } else if (casualLabelContext) {
      add(scores, "daily_chat", 1.2);
    }
  }

  // Context dampening for common false positives.
  if (has(latest, /\b(after class|grab food|hang out|weekend)\b/i)) {
    scores.classroom = Math.max(0, scores.classroom - 1.4);
  }
  if (has(latest, /\b(work as a teacher|would you like to work as a teacher|do you want to be a teacher)\b/i)) {
    scores.classroom = Math.max(0, scores.classroom - 2.0);
    scores.daily_chat += 1.2;
  }
  if (input.previousSceneKey === "interview" && has(latest, /\b(how s your morning|how is your morning|how are you|good morning|nice to meet you)\b/i)) {
    scores.interview += 3.0;
    scores.daily_chat = Math.max(0, scores.daily_chat - 1.0);
  }
  if (input.previousSceneKey === "interview" && has(latest, /\b(project|role|experience|bug|team|conflict)\b/i)) {
    scores.interview += 1.8;
  }
  if (has(latest, /\b(project|api|schema|deadline)\b/i) && has(combined, /\b(team|meeting|blocker|owner|decision|next step|current flow)\b/i)) {
    scores.meeting_group += 1.3;
    scores.interview = Math.max(0, scores.interview - 0.6);
  }

  const sorted = SCENE_KEYS
    .map((key) => ({ key, score: scores[key] }))
    .sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];
  const confidence = confidenceFromMargin(top.score, second.score);

  const reasonMap: Record<SceneBuiltinKey, string> = {
    daily_chat: "daily signals",
    classroom: "classroom signals",
    interview: "interview signals",
    meeting_group: "meeting signals",
  };

  return {
    sceneKey: top.key,
    confidence,
    reason: reasonMap[top.key],
    scores,
  };
}
