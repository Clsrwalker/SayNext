import type { ImmediateRule } from "./immediate-rule-registry";
import { isLikelySpeakerLabelTranscript } from "./output-postprocess";

export const CORE_IMMEDIATE_RULES: ImmediateRule[] = [
  {
    id: "immediate:no-intervention-speaker-labelled-third-party",
    priority: 1000,
    category: "no_intervention",
    when: ({ normalized }) => isLikelySpeakerLabelTranscript(normalized) && !/\bxiang\b/i.test(normalized),
    output: "No action needed yet.",
    reasoning: "Immediate neutral response for speaker-labelled third-party dialogue",
    confidence: 0.86,
  },
  {
    id: "immediate:joblens-correction-conflicting-green-retrofit",
    priority: 990,
    category: "asr_correction",
    include: [/\bno,?\s+i\s+mean\b/i, /\bjoblens|job lens\b/i, /\b(environmental|green retrofit|vendor|vendors)\b/i],
    output: "I should clarify the scope first: my JobLens AI project is for job and resume matching, not green retrofit vendors. If you mean a different JobLens, I should not mix the two.",
    reasoning: "Immediate JobLens correction with conflicting project scope",
  },
  {
    id: "immediate:joblens-asr-correction",
    priority: 970,
    category: "asr_correction",
    include: [/\bno,?\s+i\s+mean\b/i, /\bjoblens|job lens\b/i],
    output: "Right - JobLens AI. I'll treat it as the cloud job-matching project and keep the answer focused on that workflow.",
    reasoning: "Immediate JobLens ASR correction without repeating wrong alias",
  },
  {
    id: "immediate:dalparkaid-reverse-correction-boundary",
    priority: 960,
    category: "asr_correction",
    include: [/\bno,?\s+i\s+mean\s+(?:dell|dell parking)\b/i, /\bdalparkaid|dal park aid\b/i],
    output: "Got it - if you mean Dell parking aid, I should not force it into my DalParkAid project. I would clarify whether you mean the Dell term or my parking app.",
    reasoning: "Immediate DalParkAid reverse-correction boundary",
  },
  {
    id: "immediate:dalparkaid-asr-correction",
    priority: 940,
    category: "asr_correction",
    when: ({ normalized }) => (/\bno,?\s+i\s+mean\b/i.test(normalized) && /\bdalparkaid|dal park aid\b/i.test(normalized))
      || (/\bdalparkaid|dal park aid\b/i.test(normalized) && /\bnot\s+dell|not\s+dell parking|instead of\s+dell\b/i.test(normalized)),
    output: "Right - DalParkAid, not Dell parking aid. I will keep the project name corrected first.",
    reasoning: "Immediate DalParkAid ASR correction without repeating wrong alias",
  },
];
