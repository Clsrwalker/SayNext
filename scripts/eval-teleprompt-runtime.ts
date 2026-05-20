import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeTelepromptOpeningLine,
  shouldStartTeleprompt,
  TelepromptRuntime,
  type TelepromptDisplay,
  type TelepromptTranscriptResult,
} from "../src/server/teleprompt/teleprompt-runtime";

type ExpectedStart = "none" | "expandable" | "long";
type ExpectedAction = "advance" | "rewind" | "finish" | "cancel" | "hold_consumed" | "hold_open" | "script_ready" | "display_ok";

type Step = {
  transcript: string;
  expect: ExpectedAction;
  note: string;
  source?: "final" | "timeout";
  maxTotal?: number;
  rejectDisplay?: string;
};

type TelepromptCase = {
  id: string;
  group: string;
  trigger: string;
  sceneHint?: string;
  expectedStart: ExpectedStart;
  script?: string;
  pendingOnly?: boolean;
  steps?: Step[];
};

type StepResult = Step & {
  actual: ExpectedAction;
  pass: boolean;
  resolvedTranscript: string;
  reason?: string;
};

type CaseResult = {
  test: TelepromptCase;
  startActual: ExpectedStart;
  startPass: boolean;
  stepResults: StepResult[];
  pass: boolean;
};

const now = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join("data", "eval");

const saynextScript = [
  "SayNext is a mobile app I have been building to help with real-time conversation support.",
  "The app listens to live transcripts, keeps a short context window, and then suggests a natural next response.",
  "I added scene profiles because daily chat, interviews, classrooms, and meetings need totally different behavior.",
  "The hardest part was not the basic API call, it was handling messy transcripts, interruptions, and context drift.",
  "I also built local mode with Ollama and a travel mode that can run on a VPS with an API model.",
].join(" ");

const cloudScript = [
  "For cloud architecture, I usually start with the traffic pattern and the failure points.",
  "If the workload is unpredictable, serverless can be useful because it scales without managing servers.",
  "But I would still watch cold starts, observability, retries, and cost, because those problems show up in real systems.",
  "So the trade-off is not just easy versus hard, it is speed of development versus control and predictable behavior.",
].join(" ");

const ieltsDormScript = [
  "One place I like to study is my small room in Halifax.",
  "It is not fancy, but it feels cozy because my desk and bed are close together and everything is easy to reach.",
  "I usually study there when I need to focus, especially for cloud or deep learning courses.",
  "Sometimes I get distracted and watch videos, but overall the room makes me feel calm and safe.",
  "I think I like it because it gives me privacy and I do not need to spend extra energy going somewhere else.",
].join(" ");

const presentationScript = [
  "Today I am going to explain the main idea of our project and why we designed it this way.",
  "The problem is that users often need quick support, but the context is messy and changes very fast.",
  "Our solution keeps the interface simple while using memory and retrieval in the background.",
  "This helps the system give answers that are more relevant without forcing the user to manually search notes.",
].join(" ");

const interviewBugScript = [
  "One difficult bug I worked on was related to real-time transcripts arriving in small partial pieces.",
  "At first, the app sometimes responded too early because it treated incomplete speech as a final question.",
  "I fixed it by adding a timeout path, final transcript handling, and better context checks before generating a reply.",
  "The lesson for me was that real-time systems are not only about the model, they also need careful state management.",
].join(" ");

const dailyOpinionScript = [
  "Honestly, I think I prefer staying indoors most of the time.",
  "It is just more comfortable for me, especially in Halifax when the weather gets cold or windy.",
  "Usually I can play games, watch anime, work on small projects, or just scroll Reddit without spending extra energy.",
  "I still go outside sometimes, like walking in a park, but I do not really need a busy social plan to feel okay.",
].join(" ");

const ieltsSkillScript = [
  "A skill I tried to learn was playing piano, mostly by watching YouTube videos and copying simple songs.",
  "The hardest part was using both hands at the same time, because my brain kept mixing up the rhythm.",
  "I did not become amazing at it, but it felt satisfying when I could finally play a short song from beginning to end.",
  "I liked it because it was relaxing and also connected to my interest in music from games.",
].join(" ");

const meetingProgressScript = [
  "For the current progress, the main backend flow is working and the app can store transcripts and AI outputs.",
  "I also added personal memory, scene profiles, and prenotes so the responses can use better context.",
  "The remaining risk is reliability during long sessions, especially when transcripts are noisy or the user gets interrupted.",
  "So my next focus is testing edge cases and making sure the assistant can recover instead of getting stuck.",
].join(" ");

function normalizeAction(result: TelepromptTranscriptResult): ExpectedAction {
  if (result.action === "advance") return "advance";
  if (result.action === "rewind") return "rewind";
  if (result.action === "finish") return "finish";
  if (result.action === "cancel") return "cancel";
  return result.consumed ? "hold_consumed" : "hold_open";
}

function extractCurrent(display: TelepromptDisplay | null): string {
  if (!display) return "";
  const lines = display.text.split(/\r?\n/).map((line) => line.trim());
  const useful = lines.filter((line) => {
    if (!line) return false;
    if (/^\d+\s*\/\s*\d+$/.test(line)) return false;
    if (/^next:?$/i.test(line)) return false;
    if (/^done\./i.test(line)) return false;
    return true;
  });
  return useful[0] || "";
}

function makeMessyReading(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .filter((word, index) => index % 5 !== 1)
    .map((word, index) => (index % 7 === 0 ? `uh ${word}` : word))
    .join(" ");
}

function makeFillerReading(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      if (index > 0 && index % 4 === 0) return `like ${word}`;
      if (index > 0 && index % 7 === 0) return `you know ${word}`;
      return word;
    })
    .join(" ");
}

function makeStutterReading(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      if (index % 8 === 0) return `uh ${word}`;
      if (index % 5 === 0 && /^[A-Za-z]/.test(word)) return `${word.slice(0, 1)} ${word.slice(0, 1)} ${word}`;
      return word;
    })
    .join(" ");
}

function makeLearnerReading(text: string): string {
  return `I mean, maybe ${text}`
    .replace(/\bI have been\b/gi, "I been")
    .replace(/\bthe app\b/gi, "this app")
    .replace(/\bit is\b/gi, "it")
    .replace(/\bdoes not\b/gi, "not")
    .replace(/\bwithout\b/gi, "with no")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMispronouncedReading(text: string): string {
  return text
    .replace(/\barchitecture\b/gi, "architexture")
    .replace(/\btranscripts\b/gi, "transcrips")
    .replace(/\btranscript\b/gi, "transcrip")
    .replace(/\bserverless\b/gi, "server less")
    .replace(/\blambda\b/gi, "lamba")
    .replace(/\bdatabase\b/gi, "data base")
    .replace(/\bmemory\b/gi, "memry")
    .replace(/\bmobile\b/gi, "moble")
    .replace(/\bcontext\b/gi, "con text")
    .replace(/\s+/g, " ")
    .trim();
}

function makePartialWithFiller(text: string, ratio = 0.48): string {
  const words = text.split(/\s+/).filter(Boolean);
  const partial = words.slice(0, Math.max(4, Math.floor(words.length * ratio))).join(" ");
  return `So yeah, I mean, just to connect this with the previous point, basically ${partial}`;
}

function resolveTranscript(raw: string, runtime: TelepromptRuntime): string {
  const current = extractCurrent(runtime.getDisplay());
  if (raw === "__CURRENT__") return current;
  if (raw === "__CURRENT_MESSY__") return makeMessyReading(current);
  if (raw === "__CURRENT_FILLER_HEAVY__") return `So yeah, basically ${makeFillerReading(current)}, I guess that is the main idea.`;
  if (raw === "__CURRENT_TRANSITION_FULL__") return `And then the next thing is, honestly, ${current}`;
  if (raw === "__CURRENT_NOW_FULL__") return `Now, just to continue the point, ${current}`;
  if (raw === "__CURRENT_ACTUALLY_FULL__") return `Actually, what I mean is, ${current}`;
  if (raw === "__CURRENT_PARTIAL_FILLER__") return makePartialWithFiller(current);
  if (raw === "__CURRENT_PARTIAL_LONG_FILLER__") return makePartialWithFiller(current, 0.38);
  if (raw === "__CURRENT_PLUS_FILLER__") return `Um yeah, ${current}, like, basically.`;
  if (raw === "__CURRENT_STUTTER__") return makeStutterReading(current);
  if (raw === "__CURRENT_LEARNER_MESSY__") return makeLearnerReading(current);
  if (raw === "__CURRENT_MISPRONOUNCED__") return makeMispronouncedReading(current);
  if (raw === "__CURRENT_FIRST_HALF__") {
    const words = current.split(/\s+/).filter(Boolean);
    return words.slice(0, Math.max(4, Math.floor(words.length / 2))).join(" ");
  }
  if (raw === "__CURRENT_SELF_CORRECT__") return `Sorry, I mean, ${current}`;
  return raw;
}

function runRuntimeStep(runtime: TelepromptRuntime, transcript: string, source: "final" | "timeout" = "final"): TelepromptTranscriptResult {
  if (transcript === "__MANUAL_NEXT__") {
    return runtime.advanceManual(Date.now());
  }
  if (transcript === "__MANUAL_BACK__") {
    return runtime.rewindManual(Date.now());
  }
  if (transcript === "__MANUAL_CANCEL__") {
    return runtime.cancelManual();
  }
  return runtime.handleTranscript(transcript, Date.now(), source);
}

const quickQuestionCases: TelepromptCase[] = [
  "What's your name?",
  "Where are you from originally?",
  "How's your day going so far?",
  "Do you like studying at home?",
  "What school did you study in China?",
  "What game do you play these days?",
  "What is the project name?",
  "Where do you live in Halifax?",
  "What time do you usually sleep?",
  "Can you repeat that again?",
  "Are you a computer science student?",
  "Is it cold in Halifax today?",
  "What did you eat this morning?",
  "Which game is your favorite?",
  "What school are you studying at now?",
  "What anime are you watching recently?",
  "What did you do after class?",
  "Did you drive to school today?",
  "Do you usually order food?",
  "What website do you use a lot?",
  "Do you prefer Coke or Pepsi?",
  "What course do you have today?",
  "Are you living on campus now?",
  "Do you swim often?",
  "What is your favorite fruit?",
  "What time is your class?",
  "Can you hear me?",
  "Is your mic working?",
  "Do you want to go first?",
  "Are you done?",
].map((trigger, index) => ({
  id: `quick-${index + 1}`,
  group: "quick questions should stay short",
  trigger,
  expectedStart: "none",
}));

const longTriggerCases: TelepromptCase[] = [
  "IELTS Part 2: Describe a place where you like to study. You should say where it is and why you like it.",
  "Can you walk me through your SayNext project and explain the design decisions?",
  "Tell me about a time you had a conflict with a teammate.",
  "Describe a time when you solved a difficult bug in a project.",
  "I need you to give a two minute presentation about your cloud architecture project.",
  "Please explain your project in detail from the problem to the solution.",
  "Could you give a long answer about why you chose computer science?",
  "Describe an occasion when technology helped you learn something.",
  "Tell me about a time you received constructive feedback.",
  "Walk me through how your memory retrieval system works.",
  "Can you give me a proper one minute answer about your favorite course?",
  "Please give a two minute answer about a website you often use.",
  "For this presentation, explain the current progress and the remaining risks.",
  "Could you explain in detail how you handled a recent hard bug?",
  "Tell me about a time you learned something difficult and how you felt.",
  "Describe a childhood place that is meaningful to you and explain why.",
  "Could you talk for one or two minutes about your dream job?",
  "Give me a detailed explanation of why work-life balance matters to you.",
  "Can you walk us through your team project from your role to the result?",
  "Please explain your cloud deployment experience in detail.",
].map((trigger, index) => ({
  id: `long-trigger-${index + 1}`,
  group: "long prompt detection",
  trigger,
  expectedStart: "long",
  script: [ieltsDormScript, saynextScript, meetingProgressScript, interviewBugScript, ieltsSkillScript][index % 5],
}));

const expandableCases: TelepromptCase[] = [
  "Can you explain how Lambda cold start affects a serverless app?",
  "What do you think about using AI in education?",
  "Explain why indexing matters in a database.",
  "Tell me about your mobile computing project.",
  "Describe your experience working with AWS.",
  "Explain how supervised learning is different from unsupervised learning.",
  "What was a challenge you faced when building the app?",
  "How did you handle debugging real-time transcript issues?",
  "Can you talk about the architecture of your app?",
  "What kind of leadership experience do you have in group projects?",
  "Why did you choose deep learning as one of your favorite courses?",
  "How would you explain a hash map to a beginner?",
  "What is your opinion about remote work?",
  "Can you talk about how your app uses memory?",
  "Explain the trade-off between SQL and NoSQL.",
  "How did you test your app after adding scene profiles?",
  "What was your role in the DalParkAid project?",
  "What feedback did you get on a project?",
  "Describe your approach to learning English after moving to Canada.",
  "Can you explain why you prefer small cozy rooms?",
].map((trigger, index) => ({
  id: `expandable-${index + 1}`,
  group: "expandable prompt detection",
  trigger,
  expectedStart: "expandable",
  script: [cloudScript, saynextScript, dailyOpinionScript, interviewBugScript][index % 4],
}));

const readFlowCases: TelepromptCase[] = [
  {
    id: "read-flow-ielts-clean",
    group: "reading flow",
    trigger: "IELTS Part 2: Describe your favorite room and explain why you like it.",
    expectedStart: "long",
    script: ieltsDormScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "clean first chunk should advance" },
      { transcript: "__CURRENT_MESSY__", expect: "advance", note: "messy ASR should still advance" },
      { transcript: "__CURRENT__", expect: "advance", note: "third chunk should advance" },
      { transcript: "Why do you think small rooms feel comfortable?", expect: "hold_open", note: "after finish, new transcript should be open for normal AI" },
    ],
  },
  {
    id: "read-flow-project-filler",
    group: "reading flow",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    script: saynextScript,
    steps: [
      { transcript: "__CURRENT_PLUS_FILLER__", expect: "advance", note: "spoken filler plus current text should advance" },
      { transcript: "__CURRENT__", expect: "advance", note: "second chunk should advance" },
      { transcript: "yeah", expect: "hold_consumed", note: "backchannel while reading should not cancel" },
      { transcript: "__CURRENT__", expect: "advance", note: "continue after backchannel" },
    ],
  },
  {
    id: "read-flow-cloud-messy",
    group: "reading flow",
    trigger: "Please explain your cloud architecture answer in detail.",
    expectedStart: "long",
    script: cloudScript,
    steps: [
      { transcript: "__CURRENT_MESSY__", expect: "advance", note: "first cloud chunk with ASR noise" },
      { transcript: "__CURRENT_MESSY__", expect: "advance", note: "second cloud chunk with ASR noise" },
    ],
  },
  {
    id: "read-flow-partial-then-complete",
    group: "reading flow",
    trigger: "Tell me about a time you solved a difficult bug.",
    expectedStart: "long",
    script: interviewBugScript,
    steps: [
      { transcript: "__CURRENT_FIRST_HALF__", expect: "hold_consumed", note: "partial sentence should not advance too early" },
      { transcript: "__CURRENT__", expect: "advance", note: "complete sentence should advance" },
      { transcript: "__CURRENT_SELF_CORRECT__", expect: "advance", note: "self-correction plus current text should advance" },
    ],
  },
  {
    id: "read-flow-daily-long",
    group: "reading flow",
    trigger: "Can you explain in detail why you like staying indoors?",
    expectedStart: "long",
    script: dailyOpinionScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "daily long answer starts" },
      { transcript: "haha fair enough", expect: "hold_consumed", note: "casual listener reaction should not cancel" },
      { transcript: "__CURRENT_MESSY__", expect: "advance", note: "daily long answer continues with noise" },
    ],
  },
  {
    id: "read-flow-meeting-progress",
    group: "reading flow",
    trigger: "For this presentation, explain the current progress and remaining risks.",
    expectedStart: "long",
    script: meetingProgressScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "progress report first chunk" },
      { transcript: "__CURRENT_FIRST_HALF__", expect: "hold_consumed", note: "short partial progress line should hold" },
      { transcript: "__CURRENT__", expect: "advance", note: "complete progress line advances" },
    ],
  },
];

const interruptionTexts = [
  "That's interesting, but can you explain how the database memory works",
  "Okay stop there",
  "Thank you, now let's move on to technology",
  "Let's switch to teamwork",
  "Now talk about the cost part",
  "Can you also explain the failure case",
  "What about security",
  "Could you give a shorter example",
  "Let's move to another question",
  "Actually I want to ask something different",
  "Before you continue, why did you choose that design",
  "Hold on, describe the conflict part instead",
  "Next question, tell me about a hard bug",
  "I want to change topic to your course schedule",
  "Stop, let's talk about your internship plan",
  "Okay, but how does it work without internet",
  "Now let's discuss your mobile app",
  "That makes sense, what was your role exactly",
  "Could you tell me the database schema",
  "Let's go back to the original question",
  "Sorry to interrupt, can you explain the local mode again",
  "Sorry, I lost the point, what is the main problem",
  "That's enough, let's continue",
  "No need for details, just answer briefly",
  "Can we pause for a second",
  "Wait, what do you mean by memory",
  "One second, I have a question about the model",
  "Actually, let's skip this part",
  "Could you start again from the beginning",
  "Let's keep it shorter",
  "I want the database part instead",
  "Okay pause, how much does it cost",
  "Hold that thought, tell me about your cloud course",
  "Before that, what did you use for storage",
  "Let's not go too deep here",
  "Move on to the next slide",
  "Sorry, can you clarify your role",
  "The interviewer asks another question about teamwork",
  "Your teammate interrupts and asks about API Gateway",
];

const interruptionCases: TelepromptCase[] = interruptionTexts.flatMap((text, index) => [
  {
    id: `interrupt-ready-${index + 1}`,
    group: "interruptions during ready teleprompt",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long" as const,
    script: saynextScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance" as const, note: "start reading" },
      { transcript: text, expect: "cancel" as const, note: "new question or transition should cancel teleprompt" },
    ],
  },
  {
    id: `interrupt-pending-${index + 1}`,
    group: "interruptions while script is generating",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long" as const,
    pendingOnly: true,
    steps: [
      { transcript: text, expect: "cancel" as const, note: "pending generation should cancel on interruption" },
    ],
  },
]);

const partialThenOtherInputs: Array<{ label: string; trigger: string; script: string }> = [
  { label: "saynext", trigger: "Can you walk me through your SayNext project?", script: saynextScript },
  { label: "cloud", trigger: "Please explain your cloud architecture answer in detail.", script: cloudScript },
  { label: "ielts-room", trigger: "IELTS Part 2: Describe a room where you like to spend time.", script: ieltsDormScript },
  { label: "interview-bug", trigger: "Tell me about a time you solved a difficult bug.", script: interviewBugScript },
  { label: "daily-opinion", trigger: "Can you explain in detail why you like staying indoors?", script: dailyOpinionScript },
  { label: "meeting-progress", trigger: "For this presentation, explain the current progress and remaining risks.", script: meetingProgressScript },
];

const partialThenOtherInterruptions = [
  "Actually the backend schema changed after standup",
  "Actually I already sent the API contract",
  "Actually we are using a different endpoint now",
  "No the database query is the real bottleneck",
  "No the professor said the opposite in class",
  "But the requirement changed yesterday",
  "But the mobile screen cannot show that much text",
  "But we already finished that part",
  "But I think the user flow is different now",
  "Hold on the API response is different now",
  "Wait the dataset is not labeled",
  "Sorry the meeting topic moved to deployment",
  "One more thing the cost limit is lower now",
  "Also the user asked for offline mode",
  "The main issue is actually authentication",
  "The blocker is not the frontend anymore",
  "We changed the schema in the last pull request",
  "I already tested this on the VPS",
  "This is not for glasses it is mainly the phone app",
  "Could you stop and answer my question about cost",
];

const partialThenOtherCases: TelepromptCase[] = partialThenOtherInputs.flatMap((input) =>
  partialThenOtherInterruptions.map((interruption, index) => ({
    id: `partial-read-then-other-${input.label}-${index + 1}`,
    group: "partial read then other speaker",
    trigger: input.trigger,
    expectedStart: "long" as const,
    script: input.script,
    steps: [
      {
        transcript: index % 2 === 0 ? "__CURRENT_FIRST_HALF__" : "__CURRENT_PARTIAL_FILLER__",
        expect: "hold_consumed" as const,
        note: "ASR only captured part of Xiang reading; teleprompt should hold, not advance or cancel",
      },
      {
        transcript: interruption,
        expect: "cancel" as const,
        note: "other speaker starts before ASR finished Xiang's reading; teleprompt should cancel",
      },
      {
        transcript: "What should we check first?",
        expect: "hold_open" as const,
        note: "after cancel, later speech should be open for normal recognition instead of being swallowed",
      },
    ],
  })),
);

const noCancelTexts = [
  "yeah",
  "okay",
  "right",
  "that makes sense",
  "sounds good",
  "got it",
  "mm",
  "hmm",
  "sure",
  "yes",
];

const backchannelCases: TelepromptCase[] = noCancelTexts.map((text, index) => ({
  id: `backchannel-${index + 1}`,
  group: "short backchannels should not cancel",
  trigger: "Can you walk me through your SayNext project?",
  expectedStart: "long",
  script: saynextScript,
  steps: [
    { transcript: text, expect: "hold_consumed", note: "short listener cue should keep teleprompt active" },
  ],
}));

const asrBorderCases: TelepromptCase[] = [
  {
    id: "asr-border-1",
    group: "ASR border",
    trigger: "what project you did for next",
    expectedStart: "expandable",
    script: saynextScript,
  },
  {
    id: "asr-border-2",
    group: "ASR border",
    trigger: "lambda cold start not my architecture why",
    expectedStart: "expandable",
    script: cloudScript,
  },
  {
    id: "asr-border-3",
    group: "ASR border",
    trigger: "那个 cloud architecture why did you choose serverless",
    expectedStart: "expandable",
    script: cloudScript,
  },
  {
    id: "asr-border-4",
    group: "ASR border",
    trigger: "could tell me about small project made",
    expectedStart: "expandable",
    script: saynextScript,
  },
  {
    id: "asr-border-5",
    group: "ASR border",
    trigger: "describe time learned skill piano both hands hard",
    expectedStart: "expandable",
    script: ieltsDormScript,
  },
  {
    id: "asr-border-6",
    group: "ASR border",
    trigger: "today morning good how day going",
    expectedStart: "none",
  },
  {
    id: "asr-border-7",
    group: "ASR border",
    trigger: "mountains holiday do you like go mountains",
    expectedStart: "none",
  },
  {
    id: "asr-border-8",
    group: "ASR border",
    trigger: "tell about your project database memory",
    expectedStart: "expandable",
    script: saynextScript,
  },
];

const learnerStartCases: TelepromptCase[] = [
  {
    id: "learner-start-stutter-project-long",
    group: "stutter and learner start",
    trigger: "c c can you explan long about my say next projct like what i make and why",
    expectedStart: "long",
    script: saynextScript,
  },
  {
    id: "learner-start-mispronounced-cloud",
    group: "stutter and learner start",
    trigger: "could you explan lamba cold stared and server less why hard debug",
    expectedStart: "expandable",
    script: cloudScript,
  },
  {
    id: "learner-start-ielts-room",
    group: "stutter and learner start",
    trigger: "ielts part two descrip a room i i like spend time and why",
    expectedStart: "long",
    script: ieltsDormScript,
  },
  {
    id: "learner-start-two-minit-course",
    group: "stutter and learner start",
    trigger: "can you talk two minit about my favorite course deep learning and cloud",
    expectedStart: "long",
    script: dailyOpinionScript,
  },
  {
    id: "learner-start-superwise",
    group: "stutter and learner start",
    trigger: "how explain superwise learning with example i not clear",
    expectedStart: "expandable",
    script: cloudScript,
  },
  {
    id: "learner-start-database-index",
    group: "stutter and learner start",
    trigger: "why data base in dex make read fast but write slow",
    expectedStart: "expandable",
    script: cloudScript,
  },
  {
    id: "learner-start-walk-thru",
    group: "stutter and learner start",
    trigger: "could you walk me thru the app architexture from transcript to memry",
    expectedStart: "long",
    script: saynextScript,
  },
  {
    id: "learner-start-hard-bug-grammar",
    group: "stutter and learner start",
    trigger: "tell me hard bug you fix recently and what you learn",
    expectedStart: "long",
    script: interviewBugScript,
  },
  {
    id: "learner-start-noise-name",
    group: "stutter and learner start",
    trigger: "uh uh what your name again like",
    expectedStart: "none",
  },
  {
    id: "learner-start-noise-mic",
    group: "stutter and learner start",
    trigger: "c c can you hear me is mic work",
    expectedStart: "none",
  },
  {
    id: "learner-start-smalltalk-holiday",
    group: "stutter and learner start",
    trigger: "do you like go holiday mountain maybe",
    expectedStart: "none",
  },
  {
    id: "learner-start-garbage",
    group: "stutter and learner start",
    trigger: "uh the answer noodle cloud banana maybe people",
    expectedStart: "none",
  },
];

const fullIeltsSequence: TelepromptCase[] = [
  {
    id: "ielts-full-part1-study",
    group: "full IELTS sequence",
    trigger: "Do you work or study?",
    expectedStart: "none",
  },
  {
    id: "ielts-full-part1-course",
    group: "full IELTS sequence",
    trigger: "What subject are you studying?",
    expectedStart: "none",
  },
  {
    id: "ielts-full-part2-room",
    group: "full IELTS sequence",
    trigger: "IELTS Part 2. Describe a room where you like to spend time. You should say where it is, what it looks like, what you do there, and explain why you like it.",
    expectedStart: "long",
    script: ieltsDormScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "start long cue card answer" },
      { transcript: "__CURRENT__", expect: "advance", note: "continue cue card answer" },
      { transcript: "Thank you, now let's move to part three", expect: "cancel", note: "examiner moves on before finish" },
    ],
  },
  {
    id: "ielts-full-part3-followup",
    group: "full IELTS sequence",
    trigger: "Why do some people prefer small rooms?",
    expectedStart: "none",
  },
];

const meetingSequenceCases: TelepromptCase[] = [
  {
    id: "meeting-short-confirmation",
    group: "meeting and presentation",
    trigger: "Can you quickly confirm if the API is ready?",
    expectedStart: "none",
  },
  {
    id: "meeting-long-demo-explanation",
    group: "meeting and presentation",
    trigger: "Can you present the current design and explain how the system handles transcripts?",
    expectedStart: "long",
    sceneHint: "Meeting / Group Discussion presentation",
    script: presentationScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "presentation starts" },
      { transcript: "Hold on, what happens if the user is interrupted?", expect: "cancel", note: "question should replace teleprompt" },
    ],
  },
  {
    id: "classroom-teacher-lecture",
    group: "classroom",
    trigger: "So serverless gives elasticity but also adds cold starts and debugging difficulty.",
    expectedStart: "none",
    sceneHint: "Classroom teacher is explaining a concept",
  },
  {
    id: "classroom-direct-question",
    group: "classroom",
    trigger: "Can you explain why DynamoDB uses partition keys?",
    expectedStart: "expandable",
    sceneHint: "Classroom direct question to Xiang",
    script: cloudScript,
  },
];

const fillerReadingCases: TelepromptCase[] = [
  {
    id: "filler-full-current-1",
    group: "filler and unfinished reading",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    script: saynextScript,
    steps: [
      { transcript: "__CURRENT_FILLER_HEAVY__", expect: "advance", note: "heavy filler around full current chunk should still advance" },
      { transcript: "__CURRENT_TRANSITION_FULL__", expect: "advance", note: "transition phrase plus full current chunk should advance" },
    ],
  },
  {
    id: "filler-full-current-2",
    group: "filler and unfinished reading",
    trigger: "Please explain your cloud architecture answer in detail.",
    expectedStart: "long",
    script: cloudScript,
    steps: [
      { transcript: "__CURRENT_NOW_FULL__", expect: "advance", note: "now/continue phrase should not be treated as interruption when reading current chunk" },
      { transcript: "__CURRENT_ACTUALLY_FULL__", expect: "advance", note: "actually phrase should not cancel when current chunk is present" },
    ],
  },
  {
    id: "filler-partial-current-1",
    group: "filler and unfinished reading",
    trigger: "IELTS Part 2: Describe a room where you like to spend time.",
    expectedStart: "long",
    script: ieltsDormScript,
    steps: [
      { transcript: "__CURRENT_PARTIAL_FILLER__", expect: "hold_consumed", note: "partial chunk with many filler words should hold, not cancel or advance" },
      { transcript: "__CURRENT__", expect: "advance", note: "complete chunk after partial filler should advance" },
    ],
  },
  {
    id: "filler-partial-current-2",
    group: "filler and unfinished reading",
    trigger: "Tell me about a time you solved a difficult bug.",
    expectedStart: "long",
    script: interviewBugScript,
    steps: [
      { transcript: "__CURRENT_PARTIAL_LONG_FILLER__", expect: "hold_consumed", note: "short partial content padded with filler should not exit teleprompt" },
      { transcript: "__MANUAL_NEXT__", expect: "advance", note: "manual next can still rescue if ASR never completes the chunk" },
    ],
  },
  {
    id: "filler-transition-sequence",
    group: "filler and unfinished reading",
    trigger: "For this presentation, explain the current progress and remaining risks.",
    expectedStart: "long",
    script: meetingProgressScript,
    steps: [
      { transcript: "__CURRENT_TRANSITION_FULL__", expect: "advance", note: "and then transition can advance first presentation chunk" },
      { transcript: "__CURRENT_PARTIAL_FILLER__", expect: "hold_consumed", note: "partial second chunk with filler should keep teleprompt active" },
      { transcript: "__CURRENT_FILLER_HEAVY__", expect: "advance", note: "full second chunk with filler should advance" },
    ],
  },
  {
    id: "filler-not-interruption-keywords",
    group: "filler and unfinished reading",
    trigger: "Can you explain in detail why you like staying indoors?",
    expectedStart: "long",
    script: dailyOpinionScript,
    steps: [
      { transcript: "__CURRENT_NOW_FULL__", expect: "advance", note: "now does not mean topic switch when current line is present" },
      { transcript: "__CURRENT_PARTIAL_FILLER__", expect: "hold_consumed", note: "actually/so filler partial should hold" },
      { transcript: "Now let's move to another question", expect: "cancel", note: "real transition without current line should still cancel" },
    ],
  },
];

const fillerStressInputs: Array<{ label: string; trigger: string; script: string }> = [
  { label: "saynext", trigger: "Can you walk me through your SayNext project?", script: saynextScript },
  { label: "cloud", trigger: "Please explain your cloud architecture answer in detail.", script: cloudScript },
  { label: "ielts-room", trigger: "IELTS Part 2: Describe a room where you like to spend time.", script: ieltsDormScript },
  { label: "interview-bug", trigger: "Tell me about a time you solved a difficult bug.", script: interviewBugScript },
  { label: "daily-opinion", trigger: "Can you explain in detail why you like staying indoors?", script: dailyOpinionScript },
  { label: "meeting-progress", trigger: "For this presentation, explain the current progress and remaining risks.", script: meetingProgressScript },
];

const fillerFullVariants = [
  "__CURRENT_FILLER_HEAVY__",
  "__CURRENT_TRANSITION_FULL__",
  "__CURRENT_NOW_FULL__",
  "__CURRENT_ACTUALLY_FULL__",
  "__CURRENT_PLUS_FILLER__",
  "__CURRENT_SELF_CORRECT__",
];

const fillerPartialVariants = [
  "__CURRENT_FIRST_HALF__",
  "__CURRENT_PARTIAL_FILLER__",
  "__CURRENT_PARTIAL_LONG_FILLER__",
];

const learnerReadingVariants = [
  "__CURRENT_STUTTER__",
  "__CURRENT_LEARNER_MESSY__",
  "__CURRENT_MISPRONOUNCED__",
];

const fillerMatrixCases: TelepromptCase[] = fillerStressInputs.flatMap((input) => [
  ...fillerFullVariants.map((variant, index) => ({
    id: `filler-matrix-full-${input.label}-${index + 1}`,
    group: "filler matrix",
    trigger: input.trigger,
    expectedStart: "long" as const,
    script: input.script,
    steps: [
      { transcript: variant, expect: "advance" as const, note: `${variant} should advance for ${input.label}` },
    ],
  })),
  ...fillerPartialVariants.map((variant, index) => ({
    id: `filler-matrix-partial-${input.label}-${index + 1}`,
    group: "filler matrix",
    trigger: input.trigger,
    expectedStart: "long" as const,
    script: input.script,
    steps: [
      { transcript: variant, expect: "hold_consumed" as const, note: `${variant} should hold for ${input.label}` },
      { transcript: "__CURRENT__", expect: "advance" as const, note: `complete current chunk should advance after ${variant}` },
    ],
  })),
  ...learnerReadingVariants.map((variant, index) => ({
    id: `learner-reading-${input.label}-${index + 1}`,
    group: "stutter and learner reading",
    trigger: input.trigger,
    expectedStart: "long" as const,
    script: input.script,
    steps: [
      { transcript: variant, expect: "advance" as const, note: `${variant} should still track the current chunk for ${input.label}` },
    ],
  })),
]);

const manualAdvanceCases: TelepromptCase[] = [
  {
    id: "manual-next-rescue-after-partial",
    group: "manual next rescue",
    trigger: "IELTS Part 2: Describe a skill you learned and explain how you felt.",
    expectedStart: "long",
    script: ieltsSkillScript,
    steps: [
      { transcript: "__CURRENT_FIRST_HALF__", expect: "hold_consumed", note: "partial reading should hold" },
      { transcript: "__MANUAL_NEXT__", expect: "advance", note: "manual next should rescue a missed auto-advance" },
      { transcript: "__CURRENT__", expect: "advance", note: "auto tracking should continue after manual rescue" },
    ],
  },
  {
    id: "manual-next-finish-single-chunk",
    group: "manual next rescue",
    trigger: "Tell me about a time you solved a difficult bug.",
    expectedStart: "long",
    script: "One difficult bug was the app replying too early when transcripts arrived as partial text, so I added better buffering and final-transcript checks.",
    steps: [
      { transcript: "__MANUAL_NEXT__", expect: "finish", note: "manual next on the final chunk should finish teleprompt" },
      { transcript: "What caused the bug?", expect: "hold_open", note: "after manual finish, normal transcript flow should be open" },
    ],
  },
  {
    id: "manual-next-pending-script",
    group: "manual next rescue",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    pendingOnly: true,
    steps: [
      { transcript: "__MANUAL_NEXT__", expect: "hold_consumed", note: "manual next while generating should wait instead of cancelling" },
    ],
  },
  {
    id: "manual-back-after-early-auto-advance",
    group: "manual next rescue",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    script: saynextScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "first chunk advances" },
      { transcript: "__MANUAL_BACK__", expect: "rewind", note: "manual back should recover from an unwanted advance" },
      { transcript: "__CURRENT__", expect: "advance", note: "after back, the same chunk can be read again" },
    ],
  },
  {
    id: "manual-back-at-first-chunk",
    group: "manual next rescue",
    trigger: "Please explain your cloud architecture answer in detail.",
    expectedStart: "long",
    script: cloudScript,
    steps: [
      { transcript: "__MANUAL_BACK__", expect: "rewind", note: "manual back at first chunk should stay on first chunk" },
      { transcript: "__CURRENT__", expect: "advance", note: "reading still works after first-chunk back" },
    ],
  },
  {
    id: "manual-cancel-active-teleprompt",
    group: "manual next rescue",
    trigger: "IELTS Part 2: Describe a place where you like to study.",
    expectedStart: "long",
    script: ieltsDormScript,
    steps: [
      { transcript: "__CURRENT__", expect: "advance", note: "start reading before cancel" },
      { transcript: "__MANUAL_CANCEL__", expect: "cancel", note: "manual cancel should end active teleprompt" },
      { transcript: "What do you usually study there?", expect: "hold_open", note: "after manual cancel, new transcript should be open for normal AI" },
    ],
  },
  {
    id: "manual-cancel-pending-teleprompt",
    group: "manual next rescue",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    pendingOnly: true,
    steps: [
      { transcript: "__MANUAL_CANCEL__", expect: "cancel", note: "manual cancel while generating should cancel immediately" },
      { transcript: "Can you answer shorter?", expect: "hold_open", note: "after pending cancel, normal flow should be open" },
    ],
  },
];

const pendingReadbackRaceCases: TelepromptCase[] = [
  {
    id: "pending-readback-kubernetes-page-advance",
    group: "pending readback race",
    trigger: "海翔， could you explain to me the Kubernetes?",
    expectedStart: "expandable",
    pendingOnly: true,
    script: [
      "So sure, Kubernetes is to help manage containerized applications.",
      "It's like a big manager for your app, making sure they're running smoothly and easy to scale up or down depending on the load.",
      "The main idea is automating deployment, scaling, and management of containerized applications.",
    ].join(" "),
    steps: [
      {
        transcript: "So sure, Kubernetes is to the help manage containerized application",
        expect: "hold_consumed",
        note: "while the long script is still pending, Xiang reading the first page should be buffered instead of cancelling",
      },
      {
        transcript: "__SET_SCRIPT__",
        expect: "script_ready",
        note: "when the long script arrives, pending readback should replay into the page state",
      },
      {
        transcript: "It's like a big manager for your app, making sure they're running smoothly and easy to scale up or down depending on the load.",
        expect: "advance",
        note: "after replaying the first pending readback, reading page two should advance",
      },
    ],
  },
  {
    id: "pending-readback-saynext-first-page",
    group: "pending readback race",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    pendingOnly: true,
    script: saynextScript,
    steps: [
      {
        transcript: "SayNext is a mobile app I have been building to help with real-time conversation support.",
        expect: "hold_consumed",
        note: "pending project readback should be consumed because it shares the source topic",
      },
      {
        transcript: "__SET_SCRIPT__",
        expect: "script_ready",
        note: "script should become ready after buffering the already-read first page",
      },
      {
        transcript: "The app listens to live transcripts, keeps a short context window, and then suggests a natural next response.",
        expect: "advance",
        note: "page two should be active after the buffered first page was replayed",
      },
    ],
  },
  {
    id: "pending-readback-real-interruption-question",
    group: "pending readback race",
    trigger: "海翔， could you explain to me the Kubernetes?",
    expectedStart: "expandable",
    pendingOnly: true,
    steps: [
      {
        transcript: "Hold on, what happens if the Docker image fails?",
        expect: "cancel",
        note: "a real question while pending should still cancel teleprompt and return to normal answering",
      },
    ],
  },
  {
    id: "pending-readback-real-context-change",
    group: "pending readback race",
    trigger: "Can you walk me through your SayNext project?",
    expectedStart: "long",
    pendingOnly: true,
    steps: [
      {
        transcript: "Actually the deadline changed and we need to talk about the database schema.",
        expect: "cancel",
        note: "a real meeting context change while pending should still cancel",
      },
    ],
  },
];

const longPaginationAndTimeoutCases: TelepromptCase[] = [
  {
    id: "long-pagination-kubernetes-dense-sentences",
    group: "long pagination and timeout",
    trigger: "Could you explain me explain to me the Kubernetes?",
    expectedStart: "expandable",
    script: [
      "Sure, no problem.",
      "So Kubernetes is a system for managing containerized applications across hosts, and the main idea is automated deployment, scaling, and management of application containers.",
      "So basically, if you have a lot of apps running in Docker or another container, Kubernetes helps manage all those containers by making sure those apps keep running and new ones start when needed.",
    ].join(" "),
    steps: [
      {
        transcript: "__ASSERT_DISPLAY__",
        expect: "display_ok",
        maxTotal: 2,
        rejectDisplay: "Next:",
        note: "long teleprompt pages should be dense, fewer pages, and should not show a readable Next preview",
      },
      {
        transcript: "Sure, no problem. So Kubernetes is a system for managing containerized applications across",
        source: "timeout",
        expect: "hold_consumed",
        note: "timeout partial should hold and accumulate instead of advancing early",
      },
      {
        transcript: "Hosts. And the main idea is automated deployment, scaling, and management of application containers.",
        expect: "advance",
        note: "final tail should combine with the earlier timeout partial and advance only after the full page is effectively read",
      },
      {
        transcript: "So basically, if you have a lot of apps running in Docker or another container, Kubernetes helps manage all those containers by making sure those apps keep running",
        source: "timeout",
        expect: "hold_consumed",
        note: "second-page timeout partial should also hold",
      },
      {
        transcript: "and new ones start when needed.",
        expect: "finish",
        note: "final tail of the second page should finish after combining with the timeout partial",
      },
    ],
  },
  {
    id: "long-pagination-short-opener-merged",
    group: "long pagination and timeout",
    trigger: "Tell me about a time you solved a difficult bug.",
    expectedStart: "long",
    script: [
      "Yeah, one example is from SayNext.",
      "The difficult part was that transcripts arrived as partial text, so the app sometimes reacted before the user had actually finished speaking.",
      "I fixed it by separating timeout and final transcript behavior, then testing slow reading, repeated readback, and interruption cases.",
    ].join(" "),
    steps: [
      {
        transcript: "__ASSERT_DISPLAY__",
        expect: "display_ok",
        maxTotal: 2,
        rejectDisplay: "Next:",
        note: "a short opener should be merged with the next sentence instead of becoming a tiny first page",
      },
    ],
  },
];

const cases: TelepromptCase[] = [
  ...quickQuestionCases,
  ...longTriggerCases,
  ...expandableCases,
  ...readFlowCases,
  ...interruptionCases,
  ...partialThenOtherCases,
  ...backchannelCases,
  ...asrBorderCases,
  ...learnerStartCases,
  ...fullIeltsSequence,
  ...meetingSequenceCases,
  ...fillerReadingCases,
  ...fillerMatrixCases,
  ...manualAdvanceCases,
  ...pendingReadbackRaceCases,
  ...longPaginationAndTimeoutCases,
];

function runCase(test: TelepromptCase): CaseResult {
  const startActual = shouldStartTeleprompt(test.trigger, test.sceneHint || "");
  const startPass = startActual === test.expectedStart;
  const stepResults: StepResult[] = [];

  if (test.expectedStart !== "none" && test.steps?.length) {
    const runtime = new TelepromptRuntime();
    const opening = makeTelepromptOpeningLine(test.trigger);
    runtime.startPending(test.trigger, opening, Date.now());

    if (!test.pendingOnly) {
      const display = runtime.setScript(test.script || saynextScript);
      if (!display) {
        stepResults.push({
          transcript: "__setScript__",
          resolvedTranscript: "__setScript__",
          expect: "advance",
          actual: "cancel",
          pass: false,
          note: "setScript failed",
        });
      }
    }

    for (const step of test.steps) {
      if (step.transcript === "__ASSERT_DISPLAY__") {
        const display = runtime.getDisplay();
        const withinTotal = step.maxTotal === undefined || Boolean(display && display.total <= step.maxTotal);
        const rejectsText = !step.rejectDisplay || Boolean(display && !display.text.includes(step.rejectDisplay));
        const pass = Boolean(display) && withinTotal && rejectsText;
        stepResults.push({
          ...step,
          resolvedTranscript: display?.text || "",
          actual: pass ? "display_ok" : "cancel",
          pass,
          reason: pass ? undefined : `display assertion failed total=${display?.total ?? "none"}`,
        });
        continue;
      }

      if (step.transcript === "__SET_SCRIPT__") {
        const display = runtime.setScript(test.script || saynextScript);
        stepResults.push({
          ...step,
          resolvedTranscript: "__SET_SCRIPT__",
          actual: display ? "script_ready" : "cancel",
          pass: Boolean(display) === (step.expect === "script_ready"),
          reason: display ? undefined : "setScript failed",
        });
        continue;
      }

      const resolvedTranscript = resolveTranscript(step.transcript, runtime);
      const result = runRuntimeStep(runtime, step.transcript === "__MANUAL_NEXT__" ? step.transcript : resolvedTranscript, step.source || "final");
      const actual = normalizeAction(result);
      stepResults.push({
        ...step,
        resolvedTranscript,
        actual,
        pass: actual === step.expect || (step.expect === "advance" && actual === "finish"),
        reason: result.action === "cancel" ? result.reason : undefined,
      });
    }
  }

  return {
    test,
    startActual,
    startPass,
    stepResults,
    pass: startPass && stepResults.every((step) => step.pass),
  };
}

function renderReport(results: CaseResult[]): string {
  const failed = results.filter((result) => !result.pass);
  const stepCount = results.reduce((sum, result) => sum + result.stepResults.length, 0);
  const failedSteps = results.flatMap((result) => result.stepResults.filter((step) => !step.pass));
  const groups = [...new Set(results.map((result) => result.test.group))];
  const lines: string[] = [];

  lines.push("# Teleprompt Runtime Eval");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Cases: ${results.length}`);
  lines.push(`Step assertions: ${stepCount}`);
  lines.push(`Passed cases: ${results.length - failed.length}`);
  lines.push(`Failed cases: ${failed.length}`);
  lines.push(`Failed steps: ${failedSteps.length}`);
  lines.push("");
  lines.push("## Groups");
  for (const group of groups) {
    const groupResults = results.filter((result) => result.test.group === group);
    const groupFailed = groupResults.filter((result) => !result.pass);
    lines.push(`- ${group}: ${groupResults.length - groupFailed.length}/${groupResults.length} cases passed`);
  }
  lines.push("");

  if (failed.length) {
    lines.push("## Failures");
    for (const result of failed) {
      lines.push("");
      lines.push(`### ${result.test.id}`);
      lines.push(`Group: ${result.test.group}`);
      lines.push(`Trigger: ${result.test.trigger}`);
      lines.push(`Start expected/actual: ${result.test.expectedStart} / ${result.startActual}`);
      if (!result.startPass) {
        lines.push("- Start classification failed.");
      }
      for (const step of result.stepResults.filter((item) => !item.pass)) {
        lines.push(`- Step failed: ${step.note}`);
        lines.push(`  - Transcript: ${step.resolvedTranscript}`);
        lines.push(`  - Expected/actual: ${step.expect} / ${step.actual}`);
        if (step.reason) lines.push(`  - Reason: ${step.reason}`);
      }
    }
    lines.push("");
  }

  lines.push("## All Cases");
  for (const result of results) {
    lines.push("");
    lines.push(`### ${result.pass ? "PASS" : "FAIL"} ${result.test.id}`);
    lines.push(`Group: ${result.test.group}`);
    lines.push(`Trigger: ${result.test.trigger}`);
    lines.push(`Start: expected ${result.test.expectedStart}, actual ${result.startActual}`);
    for (const step of result.stepResults) {
      lines.push(`- ${step.pass ? "PASS" : "FAIL"} ${step.note}`);
      lines.push(`  - Expected/actual: ${step.expect} / ${step.actual}`);
      lines.push(`  - Transcript: ${step.resolvedTranscript}`);
    }
  }

  return lines.join("\n");
}

mkdirSync(outputDir, { recursive: true });

const results = cases.map(runCase);
const report = renderReport(results);
const mdPath = join(outputDir, `teleprompt-runtime-${now}.md`);
const jsonPath = join(outputDir, `teleprompt-runtime-${now}.json`);

writeFileSync(mdPath, report, "utf8");
writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

const failed = results.filter((result) => !result.pass);
const failedSteps = results.flatMap((result) => result.stepResults.filter((step) => !step.pass));

console.log(`Teleprompt runtime eval complete.`);
console.log(`Cases: ${results.length}`);
console.log(`Failed cases: ${failed.length}`);
console.log(`Failed steps: ${failedSteps.length}`);
console.log(`Report: ${mdPath}`);

if (failed.length > 0) {
  console.log("");
  console.log("First failures:");
  for (const result of failed.slice(0, 12)) {
    console.log(`- ${result.test.id}: expected start ${result.test.expectedStart}, actual ${result.startActual}`);
    for (const step of result.stepResults.filter((item) => !item.pass)) {
      console.log(`  step: ${step.note} expected ${step.expect}, actual ${step.actual}`);
      console.log(`  transcript: ${step.resolvedTranscript}`);
    }
  }
  process.exitCode = 1;
}
