import type { ProcessBadTaxonomy, ReviewClass, TurnResult } from "./eval-llm-simulated-conversations-types";

export function isHighRiskInput(input: string): boolean {
  const technicalContractOnly = /\b(api contract|interface contract|endpoint contract|schema contract|version endpoints?|versioning)\b/i.test(input)
    && !/\b(legal|law|lawyer|lease|rent|tenant|landlord|sign|signature|payment|deposit|refund|financial|insurance|patient|medical|privacy|security|consent)\b/i.test(input);
  if (technicalContractOnly) return false;

  const buySellRisk = /\b(?:buy|sell)\b.{0,35}\b(stock|crypto|shares?|investment|fund|house|property|car|medicine|prescription|non[-\s]?refundable|deposit|lease|contract)\b/i.test(input)
    || /\b(stock|crypto|shares?|investment|fund|house|property|car|medicine|prescription|non[-\s]?refundable|deposit|lease|contract)\b.{0,35}\b(?:buy|sell)\b/i.test(input);
  return /\b(legal|law|lawyer|contract|lease|landlord|deposit|refund|payment|pay|sign|fraud|tax|deduct|amortize|mortgage|rent|loan|insurance|invest|stock|finance|financial|doctor|medical|health|clinical|patient privacy|patient safety|patient data|patient care|patient-critical|diagnos|prescription|medicine|privacy|security|safety|political|politics|news|misinformation|censorship|crime|police|immigration|career decision|job offer|nutrition|gut microbiome|microbiome|potassium|study|research)\b/i.test(input)
    || buySellRisk
    || /\b(bank account|bank transfer|bank payment|bank fraud|bank password|bank pin|bank verification|bank code|bank statement|bank app|bank login|banking)\b/i.test(input);
}

export function isHighRiskDecisionInput(input: string): boolean {
  const buySellDecisionRisk = /\b(?:buy|sell)\b.{0,35}\b(stock|crypto|shares?|investment|fund|house|property|car|medicine|prescription|non[-\s]?refundable|deposit|lease|contract)\b/i.test(input)
    || /\b(stock|crypto|shares?|investment|fund|house|property|car|medicine|prescription|non[-\s]?refundable|deposit|lease|contract)\b.{0,35}\b(?:buy|sell)\b/i.test(input);
  return isHighRiskInput(input)
    && (/\b(should|can i|could i|do i|is it legal|is it safe|what should|how should|deduct|amortize|pay|deposit|sign|send|share|verify|approve|refund|invest|diagnos|prescri|fraud|doctor|patient privacy|patient safety|patient data|patient care|patient-critical|medical|lease|contract|political|news|misinformation|censorship|study|research|nutrition|microbiome|potassium|bank account|bank transfer|bank payment|bank fraud|bank password|bank pin|bank verification|bank code|bank login)\b/i.test(input)
      || buySellDecisionRisk);
}

export function verdictFor(result: TurnResult): "good" | "watch" | "bad" {
  if (result.flags.some((flag) =>
    flag.includes("contains_rejected")
    || flag.includes("invented")
    || flag.includes("unsafe")
    || flag.includes("asr_alias")
    || flag.includes("unexpected_personal")
  )) return "bad";
  if (result.judge?.verdict === "bad") return "bad";
  if (result.flags.length || result.judge?.verdict === "watch" || (result.judge && result.judge.score < 4)) return "watch";
  return "good";
}

export function classifyReview(result: TurnResult): { reviewClass: ReviewClass; reason: string } {
  const flagText = result.flags.join(" ").toLowerCase();
  const issueText = result.judge?.issues.join(" ").toLowerCase() || "";
  const combined = `${flagText} ${issueText}`;
  const output = result.output.toLowerCase();
  const input = result.input.toLowerCase();
  const casualPreferenceLike = /\b(would you rather|very hot|very cold|hot or cold|favorite|favourite|prefer|what kind|do you like|pick|choose|city attractive|restaurant|food feels like home)\b/i.test(input);

  const hardProcessFlag = result.flags.find((flag) =>
    flag.includes("contains_rejected")
    || flag.includes("invented")
    || flag.includes("unsafe")
    || flag.includes("asr_alias")
    || flag.includes("unexpected_personal")
    || flag.includes("empty_output")
    || flag.includes("meta_")
    || flag.includes("unwanted_intervention")
    || flag.includes("incomplete_setup_only")
    || flag.includes("generic_meeting_reply")
    || flag.includes("missed_lambda")
    || flag.includes("missing_ai_meeting_monitor")
    || flag.includes("technical_depth_missing_core")
    || flag.includes("technical_debug_path_missing")
    || (flag.includes("technical_depth_missing_mechanism") && !casualPreferenceLike)
    || flag.includes("risk_overclaim")
    || flag.includes("risk_control_missing_boundary")
  );
  if (hardProcessFlag) {
    return { reviewClass: "process_bad", reason: `hard flag: ${hardProcessFlag}` };
  }

  const groundedMemoryLikely = result.memoryRefs.length > 0
    && (
      /\b(kfc|mary brown|curry|malatang|genshin|halifax|dalhousie|acadia|joblens|elderalbum|dalparkaid|ai meeting monitor|hybrid search)\b/i.test(output)
      || result.memoryRefs.some((ref) => output.includes(ref.toLowerCase().split(":").pop() || ref.toLowerCase()))
    );
  const judgeGroundingSkepticism = /\b(ungrounded|not grounded|made up|fake[- ]sounding|fake[- ]detail|sounds made up|without grounding|without evidence|specific.*without|unsupported|unfounded)\b/i.test(combined);
  if (result.judge?.verdict === "bad" && judgeGroundingSkepticism && groundedMemoryLikely) {
    return { reviewClass: "judge_false_positive", reason: "judge questioned grounding but retrieved memory supports the personal/project detail" };
  }

  const casualPreferencePrompt = result.domain === "casual"
    && /\b(would you rather|hot or cold|very hot|very cold|prefer|favorite|favourite|what kind|do you like|pick|choose)\b/i.test(input)
    && !isHighRiskDecisionInput(input);
  const judgePenalizedOrdinaryPreference = judgeGroundingSkepticism
    && /\b(preference|personal|invent|assum|not grounded|ungrounded|reasons?)\b/i.test(combined);
  if (result.judge?.verdict === "bad" && casualPreferencePrompt && judgePenalizedOrdinaryPreference) {
    return { reviewClass: "judge_false_positive", reason: "judge penalized an ordinary low-risk casual preference as invented personal history" };
  }

  const explicitlyAcceptable = /\b(still acceptable|acceptable|minor|slightly|could be stronger|not perfect)\b/i.test(combined);
  const judgeSaysProcessFailure = /\b(doesn['’]?t\s+(?:answer|address|respond|fit|match)|does not\s+(?:answer|address|respond|fit|match)|didn['’]?t\s+(?:answer|address|respond|fit|match)|did not\s+(?:answer|address|respond|fit|match)|fails? to\s+(?:answer|address|respond|fit|match)|failed to\s+(?:answer|address|respond|fit|match)|not answer(?:ing)?|not address(?:ing)?|answer[- ]mismatch|mismatch(?:ed)?|irrelevant|off[- ]topic|wrong question|unsafe|overclaim|invent(?:ed)?|fake|unrelated|repeats? the same|too vague.*doesn['’]?t answer|no concrete mechanism)\b/i.test(combined)
    && !/\bdoesn['’]?t clearly connect\b/i.test(combined)
    && !(explicitlyAcceptable && result.judge?.verdict !== "bad");
  if (
    result.judge?.verdict === "bad"
    && result.domain === "casual"
    && !isHighRiskDecisionInput(input)
    && /\b(awkward phrasing|awkward wording|wording|stuttering|doesn['’]?t directly answer|not very grounded|sounds natural|casual chat)\b/i.test(combined)
    && !/\b(unsafe|overclaim|invented|fake|wrong question|irrelevant)\b/i.test(combined)
  ) {
    return { reviewClass: "quality_watch", reason: "low-risk casual wording issue, not a process failure" };
  }
  if (result.judge?.verdict === "bad" && judgeSaysProcessFailure) {
    return { reviewClass: "process_bad", reason: "judge identified answer-mismatch or unsafe/fake process failure" };
  }

  const subjectiveStyleOnly = /\b(too casual|playful|forced|style|tone|not very grounded|generic justification|vague|too long|too short|overtechnical|sounds like|awkward)\b/i.test(combined)
    && !judgeSaysProcessFailure;
  if (result.judge?.verdict === "bad" && subjectiveStyleOnly) {
    return { reviewClass: "quality_watch", reason: "judge raised quality/style concern, not a clear process failure" };
  }

  const qualityFlagsOnly = result.flags.length > 0 && result.flags.every((flag) =>
    flag.startsWith("too_long")
    || flag === "too_shallow_for_serious_topic"
    || flag === "missing_reasoning_for_serious_topic"
    || flag === "daily_overtechnical"
    || flag === "forced_return_question"
    || flag === "missing_expected_memory"
    || flag === "technical_depth_weak"
    || flag.startsWith("missing_expected")
  );
  if (qualityFlagsOnly || result.judge?.verdict === "watch" || (result.judge && result.judge.score < 4)) {
    if (
      result.judge?.verdict === "watch"
      && result.domain === "casual"
      && !isHighRiskDecisionInput(input)
      && /\badvance(?:s|d)? (?:the )?conversation|flowery|cute and natural|slightly\b/i.test(combined)
    ) {
      return { reviewClass: "quality_watch", reason: "casual style or conversation-flow watch item, not a process failure" };
    }

    const seriousMismatch = /\b(not answer(?:ing)?|not address(?:ing)?|doesn['’]?t\s+(?:answer|address|respond|fit|match)|does not\s+(?:answer|address|respond|fit|match)|irrelevant|wrong question)\b/i.test(combined)
      || (/\boff[- ]topic\b/i.test(combined) && !explicitlyAcceptable);
    if (seriousMismatch) {
      return { reviewClass: "process_bad", reason: "watch item still indicates an answer mismatch" };
    }
    return { reviewClass: "quality_watch", reason: result.flags.length ? `quality flags: ${result.flags.join(", ")}` : "judge watch/low-score quality concern" };
  }

  if (result.judge?.verdict === "bad") {
    return { reviewClass: "quality_watch", reason: "judge bad without a deterministic process-failure signal" };
  }

  return { reviewClass: "good", reason: "no process or quality concern" };
}

export function reviewClassFor(result: TurnResult): ReviewClass {
  return result.reviewClass || classifyReview(result).reviewClass;
}

export function classifyProcessTaxonomy(result: TurnResult): ProcessBadTaxonomy | undefined {
  if (reviewClassFor(result) === "judge_false_positive") return "evaluator_false_positive";
  if (reviewClassFor(result) !== "process_bad") return undefined;

  const flagText = result.flags.join(" ").toLowerCase();
  const issueText = result.judge?.issues.join(" ").toLowerCase() || "";
  const reasonText = result.reviewReason?.toLowerCase() || "";
  const input = result.input.toLowerCase();
  const output = result.output.toLowerCase();
  const traceRoute = result.processTrace?.route?.toLowerCase() || "";
  const combined = `${flagText} ${issueText} ${reasonText} ${traceRoute} ${input} ${output}`;

  if (/\btechnical_depth|technical_debug|no concrete mechanism|too shallow|mechanism|debug path\b/i.test(combined)) {
    return "technical_depth_low";
  }
  if (/\b(multi[- ]?intent|only answer|only addressed|one side|doesn.?t address.*and|api.*deposit|deposit.*api)\b/i.test(combined)) {
    return "multi_intent_drop";
  }
  if (/\b(old|previous|stale|older context|context pollution|student id|car checklist|wrong context|residual)\b/i.test(combined)) {
    return "context_stale";
  }
  if (/\b(over[- ]?trigger|misfire|right now|rights?|keyword|regex|checklist)\b/i.test(combined)) {
    return "over_trigger";
  }
  if (/\b(risk template|swallow|payment.*api|deposit.*cors|risk.*ordinary|safety.*unrelated)\b/i.test(combined)) {
    return "risk_template_swallow";
  }
  if (/\b(invent|fake|hallucinat|unsupported|overclaim|guarantee|specific.*without|not verified|unsafe)\b/i.test(combined)) {
    return "grounding_boundary";
  }
  if (/\b(answer[- ]?mismatch|wrong question|not a response|doesn.?t fit|does not fit|irrelevant|unrelated|off[- ]topic|shifts? to|hijack)\b/i.test(combined)) {
    return "route_misfire";
  }
  return "new_taxonomy_candidate";
}

export function attachReviewClasses(results: TurnResult[]): void {
  for (const result of results) {
    const review = classifyReview(result);
    result.reviewClass = review.reviewClass;
    result.reviewReason = review.reason;
    result.processTaxonomy = classifyProcessTaxonomy(result);
  }
}

export function summarizeReviewBy<T extends string>(
  results: TurnResult[],
  labelFor: (result: TurnResult) => T | undefined,
): Record<string, Record<ReviewClass, number>> {
  const summary: Record<string, Record<ReviewClass, number>> = {};
  for (const result of results) {
    const label = labelFor(result) || "unknown";
    summary[label] ||= { good: 0, quality_watch: 0, judge_false_positive: 0, process_bad: 0 };
    summary[label][reviewClassFor(result)] += 1;
  }
  return summary;
}

export function formatReviewBreakdown(summary: Record<string, Record<ReviewClass, number>>): string[] {
  return Object.entries(summary)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, counts]) =>
      `- ${label}: good=${counts.good}, quality_watch=${counts.quality_watch}, judge_false_positive=${counts.judge_false_positive}, process_bad=${counts.process_bad}`,
    );
}

export function summarizeProcessTaxonomy(results: TurnResult[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const result of results) {
    if (!result.processTaxonomy) continue;
    summary[result.processTaxonomy] = (summary[result.processTaxonomy] || 0) + 1;
  }
  return summary;
}

export function formatCountBreakdown(summary: Record<string, number>): string[] {
  const entries = Object.entries(summary).sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? entries.map(([label, count]) => `- ${label}: ${count}`) : ["- none"];
}

export function countReviewClasses(results: TurnResult[]): Record<ReviewClass, number> {
  return results.reduce((acc, result) => {
    acc[reviewClassFor(result)] += 1;
    return acc;
  }, { good: 0, quality_watch: 0, judge_false_positive: 0, process_bad: 0 });
}

export function countVerdicts(results: TurnResult[]): Record<"good" | "watch" | "bad", number> {
  return results.reduce((acc, result) => {
    acc[verdictFor(result)] += 1;
    return acc;
  }, { good: 0, watch: 0, bad: 0 });
}
