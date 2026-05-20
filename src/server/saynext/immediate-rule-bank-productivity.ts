import type { ImmediateRule } from "./immediate-rule-registry";

export const PRODUCTIVITY_IMMEDIATE_RULES: ImmediateRule[] = [
  {
    id: "immediate:deep-work-security-boundary",
    priority: 390,
    category: "risk_boundary",
    include: [/\b(attention[- ]?hijacking|phishing|attack surface)\b/i, /\b(productivity|myth|security|focus|attention|help)\b/i],
    output: "Deep work mainly helps attention, not phishing by itself. The security benefit is indirect: if I reduce distraction, I am less likely to click quickly without checking the sender, link, and context.",
    reasoning: "Immediate deep-work security boundary",
    confidence: 0.88,
  },
  {
    id: "immediate:deep-work-payoff",
    priority: 385,
    category: "casual",
    include: [/\bdeep work\b/i, /\b(real payoff|payoff|attention|threat modeling|focus)\b/i],
    output: "The real payoff is not sounding productive; it is getting one difficult task done without context switching. The practical test is whether the work quality improves and whether I finish the important part faster.",
    reasoning: "Immediate Deep Work payoff answer",
    confidence: 0.88,
  },
  {
    id: "immediate:cognitive-switching-measurement",
    priority: 380,
    category: "casual",
    include: [/\bcognitive switching cost\b/i, /\b(measure|metric|how)\b/i],
    output: "I would measure it with a before-and-after task test: time to resume after interruption, error count, and how much context the person has to reread before continuing.",
    reasoning: "Immediate cognitive-switching measurement answer",
    confidence: 0.88,
  },
  {
    id: "immediate:productivity-definition-opt-out",
    priority: 375,
    category: "risk_boundary",
    include: [/\b(productivity|product activity)\b/i, /\b(definition|define|opt out|users?|consent|privacy)\b/i],
    output: "I would define productivity narrowly as the specific action we are measuring, not general activity. Users should be able to opt out, and we should avoid collecting more behavior data than the feature really needs.",
    reasoning: "Immediate productivity definition and opt-out answer",
    confidence: 0.88,
  },
  {
    id: "immediate:grounded-productivity-habit",
    priority: 370,
    category: "casual",
    when: ({ normalized }) => (
      /\b(productivity|deep work|dopamine|focus block|phone off|one task|quick plan|to-do|todo)\b/i.test(normalized)
      || (/\bhabit\b/i.test(normalized) && /\b(procrastination|focus|discipline|avoid|change)\b/i.test(normalized))
    ) && !/\b(phishing|attack surface|white noise|soft rain|definition|define|opt out|users?|privacy|consent)\b/i.test(normalized),
    output: "For me, the realistic version is not extreme discipline. I usually need a small plan first: pick one task, define what done means, then do a short focused block before I start drifting.",
    reasoning: "Immediate grounded productivity-habit response",
    confidence: 0.88,
  },
  {
    id: "immediate:dopamine-detox-realistic",
    priority: 245,
    category: "casual",
    include: [/\bdopamine\b/i, /\b(detox|hype|worth|tried|anxious|anxiety|week|cut)\b/i],
    output: "I think the light version can help, but the extreme version feels like marketing. If it makes you anxious, I would scale it down to one simple rule, like fewer short videos before work.",
    reasoning: "Immediate realistic dopamine-detox response",
    confidence: 0.88,
  },
  {
    id: "immediate:first-base-asr-habit-correction",
    priority: 110,
    category: "asr_correction",
    include: [/\bfire base\b/i, /\b(habit|drift|first step|notice)\b/i],
    output: "If that was first base, my first step is to notice the drift early and make the next action tiny. I would reset with one clear task, not turn it into a whole productivity system.",
    reasoning: "Immediate first-base ASR habit correction",
    confidence: 0.88,
  },
];
