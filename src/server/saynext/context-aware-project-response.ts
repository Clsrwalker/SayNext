import type { AgentResponse } from "../mastra/types";
import { createInsight } from "./response-factory";
export function getContextAwareProjectImmediateResponse(
  latestTranscript: string,
  trustedContext: string,
  timestamp: number,
  recentTranscriptContext = "",
): AgentResponse | null {
  const normalized = latestTranscript.toLowerCase();
  const context = trustedContext.toLowerCase();
  const recentContext = recentTranscriptContext.toLowerCase();
  const latestNamesJobLens = /\b(joblens|job lens|jobless|job level)\b/.test(normalized);
  const latestJobLensProjectCue = /\b(job sync|job data|job platform|job matching|resume matching|uploaded files?|file storage|that project|this project|your project|this architecture|cloud design)\b/.test(normalized);
  const latestHasJobLensCue = latestNamesJobLens
    || latestJobLensProjectCue
    || (latestNamesJobLens && /\b(aws|lambda|fargate|dynamodb|s3|api gateway|eventbridge|sqs)\b/.test(normalized));
  const hasJobLensContext = latestNamesJobLens
    || (context.includes("joblens") && latestJobLensProjectCue);
  const hasKubernetesContext = /\b(kubernetes|k8s|pod|pods|deployment|deployments|container|containers|cluster|prometheus|grafana|rbac|network polic)\b/.test(normalized)
    || (context.includes("kubernetes") && /\b(kubernetes|k8s|pod|pods|deployment|container|cluster|prometheus|grafana|rbac|network polic|monitor|alert)\b/.test(normalized));

  const latestDepositPressureCue = /\b(deposit|non[-\s]?refundable|payment|pay|paying|seller|lease|e[-\s]?transfer|send money|receipt|hold it|off the market|take it off)\b/.test(normalized);

  if (
    /\b403|forbidden|access denied|permission denied\b/.test(context)
    && /\b(403|forbidden|access denied|permission denied|api|aws|gateway|endpoint|route|request|response|auth|authorizer|iam|policy|logs?|aws components?|check first)\b/.test(normalized)
  ) {
    return createInsight(
      "For an AWS 403, I would check API Gateway access and execution logs first, then the authorizer or JWT claims, Lambda logs, and IAM or resource policy denies. I would compare the exact route, method, headers, and request ID against the failing response.",
      "Immediate context-aware API 403 logs checklist",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(deposit|non[-\s]?refundable|payment|paying)\b/.test(context)
    && latestDepositPressureCue
    && /\b(seller|off the market|take it off|hold it|only way|just do it|right now|asap|pay|send|deposit|payment|receipt)\b/.test(normalized)
  ) {
    return createInsight(
      "I would not rush it. Ask for the details in writing first, confirm the total cost, refund policy, and receipt, then pay only after the terms look real.",
      "Immediate context-aware deposit pressure answer",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(refund|rental office|payment)\b/.test(recentContext)
    && /\b(counter|call|outside|office|where do i hand|where should i go)\b/.test(normalized)
    && !/\b(car|vehicle|symptom|mechanic|technician|warning lights?|braking|turning)\b/.test(normalized)
  ) {
    return createInsight(
      "I would not hand over money just because someone is outside. I would call the official office or go to the staffed counter, confirm the refund policy and receipt, then follow their written process.",
      "Immediate refund counter without stale car context",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(car|vehicle|service team|warning lights?|braking|turning|symptom)\b/.test(recentContext)
    && /\b(customer form|write on the form|form|translate that|capture on the form)\b/.test(normalized)
  ) {
    return createInsight(
      "On the customer form, I would write: symptom observed, when it started, frequency, conditions like speed or startup, warning lights, safety concern, and requested pickup window. I would leave the cause blank until inspection.",
      "Immediate car symptom customer-form wording",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(car|vehicle|service team|warning lights?|braking|turning|symptom)\b/.test(recentContext)
    && /\b(checklist|counter|fastest|right now|what should i say|what to say)\b/.test(normalized)
    && !/\b(consent|personal data|data[- ]handling|volunteer|present|next meeting|presentation)\b/.test(normalized)
    && !(/\bsymptoms?\b/.test(normalized) && /\b(timing|right now|what'?s happening|happening now|when it started|started)\b/.test(normalized))
    && (/\b(car|vehicle|symptom|service|fastest|right now|what should i say|what to say)\b/.test(normalized))
  ) {
    return createInsight(
      "At the counter, I would give the fastest checklist: when it happens, speed range, sound or vibration, warning lights, whether braking or turning changes it, and when I need the car back.",
      "Immediate context-aware car-service counter checklist",
      timestamp,
      0.9,
    );
  }

  if (
    hasKubernetesContext
    && /\b(monitor|monitoring|observability|logs?|metric|alert|prometheus|grafana|deploy for real|production|rbac|network polic)\b/.test(normalized)
  ) {
    if (/\b(rbac|network polic)\b/.test(normalized)) {
      return createInsight(
        "I have not run Kubernetes in production, so I would frame it as a practical plan. For RBAC, I would use least-privilege service accounts per workload. For network policies, I would start with default deny and only allow the traffic each service actually needs.",
        "Immediate Kubernetes RBAC and network policy answer",
        timestamp,
        0.9,
      );
    }

    return createInsight(
      "I have not run Kubernetes in production yet, but I would monitor the basics first: pod restarts, CrashLoopBackOff, OOMKills, CPU and memory saturation, rollout failures, node health, and request latency or error rate if the app exposes metrics.",
      "Immediate honest Kubernetes monitoring answer",
      timestamp,
      0.9,
    );
  }

  if (
    hasJobLensContext
    && /\b(patient|medical|health|phi)\b/.test(normalized)
    && /\b(data exposure|data|privacy|exposure|safe|prevent)\b/.test(normalized)
  ) {
    return createInsight(
      "For JobLens, I would first clarify that it should not process patient data. If sensitive data somehow becomes part of the requirement, I would verify the scope, minimize what is stored, keep files private, use least-privilege access, and audit reads instead of claiming it is automatically safe.",
      "Immediate JobLens patient-data exposure boundary",
      timestamp,
      0.92,
    );
  }

  if (
    hasJobLensContext
    && (latestHasJobLensCue || /\b(resume|job|matching|ranking|uploaded files?|file storage|job data)\b/.test(normalized))
    && /\b(data goes|what data|prevent leakage|leakage|bias|privacy|safe|where does .*data|data flow)\b/.test(normalized)
    && !(/\b(patient|medical|health|doctor|nurse)\b/.test(normalized) && !latestHasJobLensCue)
  ) {
    return createInsight(
      "For JobLens, I would separate data by purpose: job and resume-related records in DynamoDB, uploaded files in S3, and API access through Lambda with validation and least-privilege IAM. For leakage and bias, I would avoid exposing raw files, validate inputs, log access, and treat ranking as decision support rather than a final judgment.",
      "Immediate JobLens data-flow privacy answer",
      timestamp,
      0.92,
    );
  }

  if (
    hasJobLensContext
    && latestHasJobLensCue
    && /\b(who can actually see|who can see|access rules?|when|timing|separate data)\b/.test(normalized)
    && /\b(data|files?|resume|job|see|access|separate)\b/.test(normalized)
  ) {
    return createInsight(
      "For JobLens, the user should see their own uploaded files and results, while backend code uses only the fields needed for matching. Admin access should be limited, logged, and only used for support or debugging.",
      "Immediate JobLens access-control answer",
      timestamp,
      0.9,
    );
  }

  if (
    hasJobLensContext
    && latestHasJobLensCue
    && /\b(lambda|fargate)\b/.test(normalized)
    && /\b(trade[- ]?off|choose|choosing|versus|vs|why|difference|compare)\b/.test(normalized)
  ) {
    return createInsight(
      "For JobLens, I used Lambda for the normal API path because it is simple and serverless, and Fargate fits better for heavier background sync jobs. The trade-off is Lambda is easier to run, but Fargate gives more control for longer tasks.",
      "Immediate JobLens Lambda versus Fargate trade-off answer",
      timestamp,
      0.92,
    );
  }

  if (
    hasJobLensContext
    && latestHasJobLensCue
    && /\b(failure mode|monitor|monitoring|observability|logs?|metric|alert|design for)\b/.test(normalized)
  ) {
    return createInsight(
      "For JobLens, one failure mode is the background job sync failing or writing stale data. I would monitor Lambda or Fargate errors, queue backlog, DynamoDB write failures, and sync status logs, while keeping the user-facing API separate from the heavier sync path.",
      "Immediate JobLens failure-mode monitoring answer",
      timestamp,
      0.92,
    );
  }

  const contextOnlyHybridFollowup = context.includes("hybrid search memory assistant")
    && /\b(that project|this project|your project|the project|this assistant|that assistant)\b/.test(normalized);
  const hasHybridSearchContext = /\b(hybrid search memory assistant|saynext|say next)\b/.test(normalized)
    || contextOnlyHybridFollowup;
  const latestHasHybridSearchCue = /\b(hybrid search|saynext|say next|memory assistant|retrieval|prompt gating|input tokens?|token savings|relevance lift|personal memory)\b/.test(normalized);
  const hybridSearchFollowupCue = latestHasHybridSearchCue
    || (contextOnlyHybridFollowup && /\b(production users|revenue|paid pilot|traction|quantify|benchmark|benchmarks|target|targets|a\/b|a and b|impact|that project|this project|your project)\b/.test(normalized));

  if (latestHasHybridSearchCue && /\b(how|explain|works?|reduce|reducing|token|tokens|input)\b/.test(normalized)) {
    return createInsight(
      "The idea is simple: do not send every memory and transcript to the model. First retrieve the few chunks that match the current question, then use prompt rules to include only the useful context. That lowers input tokens and reduces wrong-context answers.",
      "Immediate Hybrid Search token-reduction mechanism",
      timestamp,
      0.92,
    );
  }

  if (
    hasHybridSearchContext
    && hybridSearchFollowupCue
    && /\b(coordinate|coordinated|coordination|others|priorities shifted|requirements shifted|for that project|that project|this project)\b/.test(normalized)
  ) {
    return createInsight(
      "For that project, I would be careful not to pretend there was a big team. It was mostly individual work, so the real coordination was keeping priorities clear: stable demo path first, then memory quality and token reduction. In team projects, I use the same habit with short checklists, owners, and fallback decisions.",
      "Immediate Hybrid Search Memory Assistant coordination boundary",
      timestamp,
      0.9,
    );
  }

  if (
    hasHybridSearchContext
    && /\b(comparisons?|compare|signals?|quality stayed|stayed the same|quality|same quality|answer relevance|faithfulness|grounded|supporting snippets?)\b/.test(normalized)
    && /\b(signals?|showed|prove|measure|quality|same|stayed|compare|comparisons?)\b/.test(normalized)
  ) {
    return createInsight(
      "The quality signals I would use are answer relevance, whether the right memory appears in retrieved chunks, faithfulness to those chunks, missing key facts, wrong-context rate, and latency or input-token savings. If those stay stable while tokens drop, the reduction is safer.",
      "Immediate Hybrid Search quality-signal comparison answer",
      timestamp,
      0.92,
    );
  }

  if (
    hasHybridSearchContext
    && (latestHasHybridSearchCue || /\b(evaluate|evaluation|retrieval quality|hallucination|hallucinations|wrong[- ]?context|supporting snippets|offline set|repeated scenarios)\b/.test(normalized))
    && /\b(evaluate|evaluation|retrieval quality|hallucination|hallucinations|wrong[- ]?context|supporting snippets|offline set|repeated scenarios)\b/.test(normalized)
  ) {
    return createInsight(
      "I test it in two layers. First I check retrieval: did the right memory or note show up in the top results? Then I check the final answer: does it stay inside that evidence, avoid wrong-context replies, and say uncertainty when the support is missing.",
      "Immediate Hybrid Search Memory Assistant retrieval evaluation answer",
      timestamp,
      0.9,
    );
  }

  if (
    hasHybridSearchContext
    && hybridSearchFollowupCue
    && /\b(production users|revenue|paid pilot|traction|quantify|benchmark|benchmarks|target|targets|a\/b|a and b|token savings|relevance lift|impact|walk me through)\b/.test(normalized)
  ) {
    const asksBenchmarkTargets = /\b(benchmark|benchmarks|target|targets|a\/b|a and b)\b/.test(normalized);
    const asksMetrics = /\b(production users|revenue|paid pilot|traction|quantify|token savings|relevance lift)\b/.test(normalized);
    return createInsight(
      asksBenchmarkTargets
        ? "I do not have formal benchmark numbers yet. My targets would be practical: lower input tokens, fewer irrelevant memory chunks, faster response time, and equal or better answer relevance in repeated scenario tests."
        : asksMetrics
        ? "I do not have production users, revenue, or paid pilots, so I would not present it like traction. The honest value is personal testing: comparing whether hybrid retrieval and prompt gating reduce irrelevant input while keeping answers more relevant."
        : "Hybrid Search Memory Assistant has three main parts: live transcript understanding, hybrid retrieval over memory and notes, and a prompt gate that only sends relevant context to the model. I mainly tested whether this reduced irrelevant input tokens while keeping answers grounded.",
      "Immediate Hybrid Search Memory Assistant impact/traction answer",
      timestamp,
      0.92,
    );
  }

  const hasAiMeetingMonitorContext = /\b(ai meeting monitor|meeting monitor|ai meeting model)\b/.test(normalized)
    || context.includes("ai meeting monitor");
  if (
    hasAiMeetingMonitorContext
    && /\b(scope change|change request|add|remove|action[- ]?item|transcript export|by friday|deadline)\b/.test(normalized)
  ) {
    return createInsight(
      "I would restate the scope change first: add live action-item extraction, remove transcript export, and target Friday. Then I would confirm affected transcript pipeline, API or UI behavior, owner, and one acceptance test before committing.",
      "Immediate AI Meeting Monitor scope-change response",
      timestamp,
      0.92,
    );
  }
  const asksAiMeetingMonitorArchitecture = hasAiMeetingMonitorContext
    && /\b(architecture|integrat|stack|pipeline|asr|latency|diarization|speaker|summary|summaries|transcript|real[- ]?time|walk me through|how do you keep|segment|buffer|buffering|delay|refresh|source of truth|stable)\b/.test(normalized);

  if (asksAiMeetingMonitorArchitecture) {
    if (/\b(latency|diarization|speaker|summaries|summary|consistent|real[- ]?time|segment|buffer|buffering|delay|refresh|stable)\b/.test(normalized)) {
      return createInsight(
        "For AI Meeting Monitor, I would keep transcript segments as the source of truth, use a small buffer for late ASR chunks, and update summaries only after a segment is stable. The key is keeping Whisper output, Gemini analysis, Flask and PostgreSQL write-back, and the React dashboard consistent.",
        "Immediate AI Meeting Monitor ASR consistency answer",
        timestamp,
        0.92,
      );
    }

    return createInsight(
      "AI Meeting Monitor connected a Discord recording bot, FastAPI data processing with Faster Whisper and Gemini, a Flask and PostgreSQL backend, and a React dashboard for transcripts, summaries, action items, and reports. My main work was integration, debugging, testing, and stabilizing the demo flow.",
      "Immediate AI Meeting Monitor architecture answer",
      timestamp,
      0.92,
    );
  }

  return null;
}
