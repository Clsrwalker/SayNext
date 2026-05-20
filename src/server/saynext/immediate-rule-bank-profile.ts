import type { ImmediateRule } from "./immediate-rule-registry";

// Bank responsibility: stable self-introduction, education, interview-profile, and supported personal background facts.
export const PROFILE_IMMEDIATE_RULES: ImmediateRule[] = [
  {
    id: "immediate:formal-self-introduction",
    priority: 460,
    category: "career_pitch",
    include: [/\b(introduce yourself|self[-\s]?introduction|graduation photo|quickly before the photo|before the photo)\b/i],
    output: "Hi, I'm Xiang Li. I'm a MACS student at Dalhousie, so Master of Applied Computer Science.",
    reasoning: "Immediate formal self-introduction response",
  },
  {
    id: "immediate:no-fake-conflict-interview",
    priority: 455,
    category: "career_pitch",
    include: [/\b(tell me about a time|describe a time|give me an example|real example)\b/i, /\b(conflict|teammate|disagreement|different ideas)\b/i],
    output: "I don't have a dramatic conflict story. The closest is a low-drama technical disagreement in group projects, where I would make the deadline, risk, and trade-off clear, then push for a smaller working version first.",
    reasoning: "Immediate no-fake-conflict interview response",
  },
  {
    id: "immediate:grounded-teamwork-lesson",
    priority: 450,
    category: "career_pitch",
    include: [/\blearn(?:ed)?\b/i, /\bworking\s+in\s+a\s+team|work\s+in\s+a\s+team|teamwork\b/i],
    output: "For me, the biggest lesson is that integration and clear ownership matter more than just finishing your own feature. In group projects, if the API contract, owner, and test path are unclear, everything becomes stressful near the deadline.",
    reasoning: "Immediate grounded teamwork lesson answer",
    confidence: 0.88,
  },
  {
    id: "immediate:grounded-weakness-teamwork",
    priority: 445,
    category: "career_pitch",
    include: [/\b(weakness|weak point|improve about yourself|worked on)\b/i, /\b(teamwork|team|work|project|affect|affected|example|real)\b/i],
    output: "One real weakness is that I can delay starting when a task feels stressful. In teamwork that can make other people wait, so I try to break the work earlier, clarify the first step, and give updates before the deadline.",
    reasoning: "Immediate grounded weakness teamwork answer",
  },
  {
    id: "immediate:supported-cpp-java-depth",
    priority: 440,
    category: "career_pitch",
    include: [/\b(c\+\+|java)\b/i, /\b(deep|algorithms?|multithreading|thread|coursework|how much|experience)\b/i],
    output: "For C++ and Java, my experience is mostly coursework and basic exercises, including some algorithm and multithreading concepts. I would not oversell them as my strongest stack now; JavaScript and TypeScript are much more current for me.",
    reasoning: "Immediate supported C++ Java depth answer",
  },
  {
    id: "immediate:career-fair-feedback-next-step",
    priority: 435,
    category: "career_pitch",
    include: [/\bconstructive\s+feedback\b|\bfeedback\b/i, /\b(receive|received|got|given|improve|improved|learned|career fair|next step|specific feedback)\b/i, /\b(career fair|next step|next step checklist|specific feedback)\b/i],
    output: "The feedback was that my message was too generic, so the next step is to make one concrete project example clearer, update the wording, and practice a short version.",
    reasoning: "Immediate career-fair feedback next-step answer",
  },
  {
    id: "immediate:constructive-feedback-interview",
    priority: 430,
    category: "career_pitch",
    when: ({ normalized }) => /\bconstructive\s+feedback\b/i.test(normalized)
      || (/\bfeedback\b/i.test(normalized) && /\b(receive|received|got|given|improve|improved|learned)\b/i.test(normalized)),
    output: "One useful piece of feedback was that my answers sometimes sounded too polished and AI-like. I took that seriously because for my assistant project, the answer has to sound like something I could actually say. So I changed the prompts and tests to check for shorter, more natural responses, not just technically correct ones.",
    reasoning: "Immediate supported constructive-feedback interview answer",
  },
  {
    id: "immediate:china-school-history",
    priority: 425,
    category: "casual",
    include: [/\b(before\s+canada|before\s+coming\s+to\s+canada|before\s+i\s+came\s+to\s+canada|high\s+school\s+in\s+china|school\s+in\s+china|high\s+school\b.*\bchina|china\b.*\bhigh\s+school|school\b.*\bchina)\b/i, /\b(school|study|studied|high\s+school|where|what)\b/i],
    output: "Before Canada, I studied at Shishi High School in Chengdu, then Peking University Affiliated Experimental School.",
    reasoning: "Immediate China school history answer",
    confidence: 0.95,
  },
  {
    id: "immediate:current-student-program",
    priority: 420,
    category: "casual",
    when: ({ normalized }) => /\b(work\s+or\s+(?:are\s+you\s+)?(?:a\s+)?student|student\s+or\s+work|are\s+you\s+(?:a\s+)?student|do\s+you\s+work\s+or\s+study)\b/i.test(normalized)
      || /\bwork\b.{0,40}\bor\b.{0,40}\bare\s+you(?:\s+a)?(?:\s+student)?\b/i.test(normalized)
      || /\b(?:student\s+or\s+working|working\s+or\s+student|study\s+or\s+work|work\s+or\s+study|you\s+student|you\s+working)\b/i.test(normalized)
      || /\b(?:what|which)\s+(?:is\s+)?(?:your\s+)?(?:major|program|degree)\b/i.test(normalized)
      || /\b(?:what|which)\s+(?:program|major|degree)\s+(?:are\s+you\s+)?(?:in|studying|taking)\b/i.test(normalized)
      || /\bwhat\s+(?:are\s+you\s+)?studying\b/i.test(normalized)
      || /\bwhat\s+do\s+you\s+study\b/i.test(normalized),
    output: "I'm a MACS student at Dalhousie, so Master of Applied Computer Science.",
    reasoning: "Immediate current student/program answer",
    confidence: 0.94,
  },
  {
    id: "immediate:supported-class-room",
    priority: 405,
    category: "casual",
    when: ({ normalized }) => ((/\b(rehearsal room|classroom room number|room number|which room)\b/i.test(normalized))
      || (/\bwhere\b/i.test(normalized) && /\b(rehearsal|classroom)\b/i.test(normalized) && /\broom\b/i.test(normalized)))
      && /\b(class|classroom|rehearsal|room)\b/i.test(normalized)
      && !/\b(point mint|appointment|order|receipt|to be sure|just to be sure)\b/i.test(normalized),
    output: "It should be in the Goldberg Computer Science Building, room 134.",
    reasoning: "Immediate supported class room answer",
    confidence: 0.88,
  },
];
