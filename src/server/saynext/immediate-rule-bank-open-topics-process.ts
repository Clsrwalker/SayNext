import type { ImmediateRule } from "./immediate-rule-registry";

export const OPEN_TOPIC_PROCESS_IMMEDIATE_RULES: ImmediateRule[] = [
  {
      id: "immediate:cloud-access-pattern-next-step",
      priority: 200,
      category: "tech_process",
      include: [/\baccess pattern\b/i, /\b(deployment|monitoring|cloud|joblens|job lens|api|database|next)\b/i],
      output: "Yes. Start with the access pattern first, then choose the storage shape, deploy the smallest working API, and add logs or metrics so we can verify latency, errors, and cost before expanding.",
      reasoning: "Immediate cloud access-pattern next-step answer",
    },
  {
      id: "immediate:speaking-metric-ownership",
      priority: 125,
      category: "meeting_process",
      include: [/\bwho owns\b/i, /\b(metric|verify|time limits?|speaking)\b/i],
      output: "I would split ownership clearly: one person owns the rubric, one records timed samples, and one checks consistency. Verification is a short sample, the same scoring sheet, and a quick comparison so we are not arguing from memory.",
      reasoning: "Immediate speaking-metric ownership answer",
      confidence: 0.88,
    },
  {
      id: "immediate:data-code-ownership",
      priority: 120,
      category: "meeting_process",
      include: [/\bwho owns\b/i, /\b(data and code|code and data|data|code)\b/i],
      output: "I would separate ownership: the data owner controls collection, privacy, and reuse rules; the code owner controls the repository, review, and deployment path. For EV news, I would also define which sustainability metric we are using before making a claim.",
      reasoning: "Immediate data-code ownership answer",
    },
  {
      id: "immediate:stale-response-verification-metric",
      priority: 115,
      category: "tech_process",
      include: [/\bstale\b/i, /\b(metric|proved|worked|verify|guard|checks?)\b/i],
      output: "I would not claim a perfect number unless I measured it. The metric should be replaying the same noisy transcript cases and counting whether old-turn replies still appear after the stale-response guard.",
      reasoning: "Immediate stale-response verification metric",
    },
];
