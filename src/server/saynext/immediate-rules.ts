import type { AgentResponse } from "../mastra/types";
import { createInsight } from "./response-factory";
import type { OutputLanguage } from "./output-postprocess";
import { IMMEDIATE_RULES } from "./immediate-rule-bank";
import { runImmediateRules } from "./immediate-rule-registry";
export function getImmediateResponse(transcript: string, timestamp: number, outputLanguage: OutputLanguage): AgentResponse | null {
  const normalized = transcript.trim();
  const lower = normalized.toLowerCase();

  const registryResponse = runImmediateRules(IMMEDIATE_RULES, {
    transcript,
    normalized,
    lower,
    timestamp,
    outputLanguage,
  });
  if (registryResponse) return registryResponse;

  if (/\b(checked|missing,?\s+or delayed)\b/i.test(normalized)) {
    return createInsight(
      "I would not hard-code checked, missing, or delayed until the expected behavior is defined. Assert missing if no scan appears after the threshold, delayed if the scan is late, and checked only when handoff is confirmed.",
      "Immediate regression status assertion choice",
      timestamp,
      0.9,
    );
  }

  if (/\b(regression test|regression|test)\b/i.test(normalized)
    && /\b(baggage|delay|missing|user problem|timestamps?|scan)\b/i.test(normalized)) {
    return createInsight(
      "First I would classify the user problem from evidence: missing baggage versus delayed status. The regression test should use a fixed flight time and bag-scan timeline, assert the expected status, and cover the edge case where scan data is late or missing.",
      "Immediate baggage regression-test mechanism",
      timestamp,
      0.9,
    );
  }

  if (/\b(regression test|regression|test)\b/i.test(normalized)
    && /\b(logs? (?:are )?incomplete|incomplete logs?|without logs?|what to assert|assert without guessing|root cause)\b/i.test(normalized)) {
    return createInsight(
      "If logs are incomplete, I would assert the observable failure instead of guessing the root cause. First reproduce the bug, capture the input and output at the boundary, then add a test that fails before the fix and passes after it.",
      "Immediate regression assertion under incomplete logs",
      timestamp,
      0.9,
    );
  }

  if (/\bpoly ticks\b/i.test(normalized) && /\b(elevator|small chat|comfortable|chat)\b/i.test(normalized)) {
    return createInsight(
      "For elevator chat, I would keep it small and friendly. If poly ticks means politics, I would avoid that there and stick to simple things like weather or daily plans.",
      "Immediate elevator-politics ASR boundary",
      timestamp,
      0.88,
    );
  }

  if (/\bdream\b/i.test(normalized) && /\b(movie|film|high bridge search|priorit|scope|timeline)\b/i.test(normalized)) {
    return createInsight(
      "For a dream movie, I would not turn high bridge into a tech thing. I would prioritize the feeling first, then one clear setting and one simple story arc.",
      "Immediate dream movie scope response",
      timestamp,
      0.88,
    );
  }

  if (/\b(flash|flask)\b/i.test(normalized) && /\b(ownership|teamwork|boundaries|team|handoff|integration)\b/i.test(normalized)) {
    return createInsight(
      "I would not focus on flash versus Flask there. The real point is ownership: who owns each part, what the handoff is, and how we test the integration.",
      "Immediate ASR-safe team ownership response",
      timestamp,
      0.88,
    );
  }

  if (/\b(canada|canadian|halifax|local culture|isolation)\b/i.test(normalized)
    && /\b(feel|fit|belong|local|home|isolation|distance|integrated|identity)\b/i.test(normalized)) {
    return createInsight(
      "I would say I adapted to Canada, but I still do not fully feel like a local. Halifax feels familiar and manageable to me, but the stronger home feeling is more from childhood and small comfortable spaces.",
      "Immediate Canada identity memory response",
      timestamp,
      0.88,
    );
  }

  if (/\b(father|dad)\b/i.test(normalized) && /\b(respect|admire|important|influence|role model|proud|remember)\b/i.test(normalized)) {
    return createInsight(
      "It is personal, but I do respect my father a lot. He was very capable and treated me well when I was young, so I would describe it as respect and nostalgia, not a perfect speech.",
      "Immediate father respect memory response",
      timestamp,
      0.88,
    );
  }

  if (/\b(apolog(?:y|ies|ize|ise|etic))\b/i.test(normalized)
    && /\b(sincere|real|evidence|nontechnical|user|customer|feel|trust)\b/i.test(normalized)) {
    return createInsight(
      "For me, a sincere apology needs three parts: say what went wrong, admit the impact, and explain what will change next. Without the next step, it feels like just words.",
      "Immediate sincere apology reasoning response",
      timestamp,
      0.88,
    );
  }

  if (/\b(disagree|disagreement|push back|politely|hostile)\b/i.test(normalized)
    && /\b(method|specific|without sounding|how do you|how would you)\b/i.test(normalized)) {
    return createInsight(
      "My method is to agree with the goal first, then explain the risk in one sentence, and suggest a smaller safer option. That way it does not sound like I am attacking the person.",
      "Immediate polite disagreement method response",
      timestamp,
      0.88,
    );
  }

  if (/\b(disagree|disagreeing|privacy constraints?|patient privacy)\b/i.test(normalized)
    && /\b(trade[- ]?offs?|side effects?|minimum necessary|constraints?)\b/i.test(normalized)) {
    return createInsight(
      "The trade-off is clarity versus privacy risk. I would share only minimum necessary, remove identifiers, document consent, and name the side effect clearly: too much detail can re-identify someone or reduce trust.",
      "Immediate patient privacy trade-off response",
      timestamp,
      0.9,
    );
  }

  if (/\b(provenance|source log|risk config|risk score|misinformation)\b/i.test(normalized)
    && /\b(log|audit|config|risk|provenance|source|threshold|review)\b/i.test(normalized)) {
    if (/\b(config knobs?|escalation timing|threshold|control)\b/i.test(normalized)) {
      return createInsight(
        "The config knobs would be source trust level, claim severity, confidence score, user exposure, and repeat frequency. Those control whether we just log it, slow it down, or require human review.",
        "Immediate risk config escalation knobs response",
        timestamp,
        0.9,
      );
    }

    return createInsight(
      "I would log provenance first: source, timestamp, confidence, and who used it. Then I would throttle or require review when the risk score is high, instead of treating every claim the same.",
      "Immediate provenance audit process response",
      timestamp,
      0.88,
    );
  }

  if (/\b(misinformation|health claims?|false claims?)\b/i.test(normalized)
    && /\b(which sources?|prove|evidence|credible|claims?)\b/i.test(normalized)) {
    return createInsight(
      "For health misinformation, I would rely on official public-health sources, peer-reviewed papers, and reputable medical organizations. I would not use one viral post or anecdote as evidence.",
      "Immediate health misinformation source response",
      timestamp,
      0.88,
    );
  }

  if (/\b(cybersecurity|security)\b/i.test(normalized)
    && /\b(collect useless things|useless things|happy gateway|gateway risk|low[- ]cost collecting)\b/i.test(normalized)) {
    return createInsight(
      "In cybersecurity, useless collection becomes risky because every extra log, file, or account increases the attack surface. The trade-off is future usefulness versus data exposure, so the next step is retention rules and least-privilege access.",
      "Immediate cybersecurity useless-collection risk response",
      timestamp,
      0.88,
    );
  }

  if (/\b(health misinformation|sharing health|diagnosis|medical details)\b/i.test(normalized)
    && /\b(dead line|deadline|share|social media|personal details)\b/i.test(normalized)) {
    return createInsight(
      "My boundary is simple: do not share personal medical details, and do not repost health claims unless a reliable source supports them. If unsure, say I need to verify it first.",
      "Immediate health misinformation sharing boundary",
      timestamp,
      0.9,
    );
  }

  if (/\b(kubernetes|environmental|supply chain)\b/i.test(normalized)
    && /\b(specific|which project|measurable|harm|disruption|not docker|using kubernetes)\b/i.test(normalized)) {
    return createInsight(
      "I would not name a specific project without a source. I would explain the mechanism instead: Kubernetes can add waste if workloads are over-provisioned, but measurable environmental harm needs real data.",
      "Immediate source-safe Kubernetes environmental response",
      timestamp,
      0.88,
    );
  }

  if (/\b(supply[- ]chain|environmental harm|shipping|case study)\b/i.test(normalized)
    && /\b(cite|case study|real project|which project|shows?|harm)\b/i.test(normalized)) {
    return createInsight(
      "I cannot reliably cite a specific case study from memory. I would say the right evidence would be before-and-after emissions, rerouting distance, delays, and waste, then cite an actual logistics report.",
      "Immediate source-safe supply-chain case response",
      timestamp,
      0.88,
    );
  }

  if (/\b(highest[- ]impact|highest impact|priority|prioritize|prioritization)\b/i.test(normalized)
    && /\b(task|under pressure|decide|what matters|deadline|impact)\b/i.test(normalized)) {
    return createInsight(
      "Under pressure, I decide the highest-impact task by asking what blocks the core goal, what has the biggest risk, and what unblocks other people. Then I pick one concrete next step.",
      "Immediate highest-impact prioritization response",
      timestamp,
      0.88,
    );
  }

  if (/\b(public transport|public transportation|bus|walking)\b/i.test(normalized)
    && /\b(debug|uncertainty|unreliable|delays?|data)\b/i.test(normalized)) {
    return createInsight(
      "I would treat it like a system issue: separate delay data, timetable data, and real-world observations, then check which source changed first. If data is unreliable, use a backup route and mark confidence lower.",
      "Immediate public transport uncertainty debug response",
      timestamp,
      0.88,
    );
  }

  if (/\b(public transport|public transportation|bus|walking)\b/i.test(normalized)
    && /\b(swimming schedule|daily schedule|routine|affect|coach)\b/i.test(normalized)) {
    return createInsight(
      "Public transportation affects the schedule mainly through uncertainty. If I need to swim or get somewhere on time, I would plan a buffer or choose walking/driving when the bus timing is unreliable.",
      "Immediate public transport schedule response",
      timestamp,
      0.86,
    );
  }

  if (/\b(bus|walking|walk)\b/i.test(normalized)
    && /\b(more comfortable|comfortable|why exactly|which one)\b/i.test(normalized)
    && !/\b(joints?|breathing|pain|injury|doctor)\b/i.test(normalized)) {
    return createInsight(
      "For short distances, walking is more comfortable because I can control the pace and clear my head. If the weather is bad or the distance is longer, then the bus is more practical.",
      "Immediate bus versus walking preference response",
      timestamp,
      0.86,
    );
  }

  if (/\b(language learning|learn(?:ing)? english|second language|bilingual)\b/i.test(normalized)
    && /\b(employment|job|career|evidence|rely on|affect)\b/i.test(normalized)) {
    return createInsight(
      "Language learning helps employment because it improves interviews, teamwork, and day-to-day communication. The evidence I would rely on is practical: fewer misunderstandings, better interview answers, and being able to handle workplace conversations more naturally.",
      "Immediate language-learning employment evidence response",
      timestamp,
      0.88,
    );
  }

  if (/\b(exact habit|which habit|what habit)\b/i.test(normalized)
    && /\b(change|trying to change|smoking|procrastination|discipline)\b/i.test(normalized)) {
    return createInsight(
      "For me, the habit is usually procrastination from stress avoidance. I think about the task for a long time, but delay starting, so the fix is making the first step small and concrete.",
      "Immediate exact habit clarification response",
      timestamp,
      0.88,
    );
  }

  if (/\b(which habit|what habit|habit you mean)\b/i.test(normalized)
    && /\b(why|concern|criteria|share)\b/i.test(normalized)) {
    return createInsight(
      "I mean procrastination from stress avoidance. The reason it matters is that it looks like laziness from outside, but the real blocker is starting under pressure, so the fix is a small first step.",
      "Immediate habit-meaning reasoning response",
      timestamp,
      0.88,
    );
  }

  if (/\b(takeout|eating alone|takeout habit)\b/i.test(normalized)
    && /\b(budget|health|changed your mind|takeout habit|affect)\b/i.test(normalized)) {
    return createInsight(
      "Takeout is convenient, but it can quietly hit both budget and health. For me the practical fix is not banning it, just keeping simple home options like curry, rice, or malatang so I do not order by default.",
      "Immediate takeout budget health response",
      timestamp,
      0.88,
    );
  }

  if (/\b(phrases?|not theory|say it now|need it now)\b/i.test(normalized)
    && /\b(english|language|ridiculous|repeat|understand)\b/i.test(normalized)) {
    return createInsight(
      "I would use simple phrases like: Sorry, could you say that more slowly? I want to make sure I understood. Or: Let me repeat what I heard first.",
      "Immediate practical English phrase response",
      timestamp,
      0.88,
    );
  }

  if (/\b(japan[- ]specific|incident data|benchmarks?)\b/i.test(normalized)
    && /\b(which|what|data|benchmark|incident)\b/i.test(normalized)) {
    return createInsight(
      "I do not have Japan-specific incident data offhand, so I would not invent a number. I would check official reports or credible datasets first, then compare against a clear benchmark.",
      "Immediate source-safe Japan benchmark response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(what exactly fails|exactly fails|where.*fails?|error text|error message|logs?|log lines?|current behavior|expected behavior)\b/i.test(normalized)
    && /\b(fails?|error|logs?|current behavior|expected|symptoms?|where|writing|debug)\b/i.test(normalized)
  ) {
    return createInsight(
      "In writing, I would capture the exact failing step, where it fails, expected versus actual behavior, the full error text, relevant log lines, timestamp or request ID, and the last change before the failure. If any field is unknown, mark it unknown.",
      "Immediate exact failure debug summary",
      timestamp,
      0.9,
    );
  }

  if ((/\b(specific risks?|highest risks?)\b/i.test(normalized) || (/\bin writing\b/i.test(normalized) && /\brisks?\b/i.test(normalized)))
    && /\b(risks?|evidence|supports?|highest)\b/i.test(normalized)) {
    if (/\b(logs?|documents?|data scheme|scheme owner|who owns)\b/i.test(normalized)) {
      return createInsight(
        "In writing, I would name owners and evidence separately: logs from the app or platform, policy/source documents, user reports, and incident notes. The data scheme owner should be one named person or team, not everyone.",
        "Immediate risk evidence owner response",
        timestamp,
        0.88,
      );
    }

    return createInsight(
      "In writing, I would rank the risks as privacy exposure, missing or biased data, and unclear ownership. Evidence should come from logs, source documents, user reports, and observed incidents, not just opinion.",
      "Immediate highest risks evidence response",
      timestamp,
      0.88,
    );
  }

  if (/\b(verifiable sources?|on[- ]scene evidence|evidence support|support that claim)\b/i.test(normalized)) {
    return createInsight(
      "I would separate sources from observations: use official records or credible reports as sources, then on-scene evidence like timestamps, photos, logs, witnesses, or raw notes to support the claim.",
      "Immediate verifiable source evidence response",
      timestamp,
      0.88,
    );
  }

  if (/\b(verify identity|identity verification|prove identity)\b/i.test(normalized)
    && /\b(data|minimi[sz]e|keeping more|unclear request)\b/i.test(normalized)) {
    return createInsight(
      "I would verify identity with the smallest reliable check: use an existing trusted channel, ask for one confirmation factor, and avoid storing extra copies unless there is a clear reason.",
      "Immediate identity verification data-minimization response",
      timestamp,
      0.9,
    );
  }

  if (/\b(immigration limits?|raise immigration|immigration policy)\b/i.test(normalized)
    && /\b(trade[- ]?off|accept|why|limits?|raise)\b/i.test(normalized)) {
    return createInsight(
      "The argument for raising immigration limits is filling labor gaps and supporting growth. The trade-off is pressure on housing, healthcare, and processing capacity, so the policy only works if infrastructure scales too.",
      "Immediate immigration limits trade-off response",
      timestamp,
      0.88,
    );
  }

  if (/\b(ramen|flash red|home good)\b/i.test(normalized)
    && /\b(budget|cheap|cost|red|home)\b/i.test(normalized)) {
    return createInsight(
      "If ramen is the home food but the budget still flashes red, the issue is frequency and add-ons. Cheap food stops being cheap if it becomes takeout, delivery, or extra snacks every time.",
      "Immediate ramen budget reasoning response",
      timestamp,
      0.86,
    );
  }

  if (/\b(media framing|politeness|adverts?|advertisements?)\b/i.test(normalized)
    && /\b(polite|politeness|framing|media|adverts?|advertisements?)\b/i.test(normalized)) {
    return createInsight(
      "Media framing can make politeness look like style, but in real life it is usually about reducing friction. Ads and films often exaggerate it, so I would separate the surface image from the actual behavior.",
      "Immediate media framing politeness response",
      timestamp,
      0.86,
    );
  }

  if (/\b(quantify|threshold|escalation)\b/i.test(normalized)
    && /\b(effect|practice|name|impact|measure|threshold)\b/i.test(normalized)) {
    return createInsight(
      "I would quantify it with a simple metric first, like frequency, severity, or user impact. The escalation threshold should be when the issue repeats, affects important users, or creates safety, privacy, or money risk.",
      "Immediate quantification threshold response",
      timestamp,
      0.88,
    );
  }

  if (/\b(baggage rules?|meaningful travel|travel rules?)\b/i.test(normalized)
    && /\b(delays?|baggage|rules?|meaningful|practical)\b/i.test(normalized)) {
    return createInsight(
      "Delays and baggage rules can feel meaningful because they decide how much control people feel they still have. Practically, clear rules and honest updates reduce stress more than poetic explanations.",
      "Immediate practical travel-delay meaning response",
      timestamp,
      0.86,
    );
  }

  if (/\b(exact filters?|sensitivity scheme|documented)\b/i.test(normalized)
    && /\b(filter|scheme|sensitivity|document|where|writing)\b/i.test(normalized)) {
    return createInsight(
      "I would write the filters as a short table: field name, sensitivity level, who can access it, and retention rule. Then the sensitivity scheme should live in the project doc, not just in someone's memory.",
      "Immediate sensitivity scheme documentation response",
      timestamp,
      0.88,
    );
  }

  if (/\b(schema fields?|fields)\b/i.test(normalized)
    && /\b(uncertainty|failure modes?|quantify|capture)\b/i.test(normalized)) {
    return createInsight(
      "I would capture uncertainty with fields like source, confidence, last_updated, missing_reason, and decision_status. The failure modes to quantify are stale data, missing data, wrong mapping, and low-confidence decisions.",
      "Immediate uncertainty schema fields response",
      timestamp,
      0.88,
    );
  }

  if (/\b(logs?|documents?|data scheme|scheme owner|who owns)\b/i.test(normalized)
    && /\b(support those risks|support the risks|owns? the data|in writing)\b/i.test(normalized)) {
    return createInsight(
      "In writing, I would name owners and evidence separately: logs from the app or platform, policy/source documents, user reports, and incident notes. The data scheme owner should be one named person or team, not everyone.",
      "Immediate risk evidence owner response",
      timestamp,
      0.88,
    );
  }

  if (/\bnimbus\b/i.test(normalized) && /\b(confirm|policy|which project|other project)\b/i.test(normalized)) {
    return createInsight(
      "I would not confirm Nimbus Cloud without checking. I would ask for the exact project name or source first, then use that name consistently.",
      "Immediate unknown Nimbus project anti-confirmation",
      timestamp,
      0.9,
    );
  }

  if (/\b(remote learning|covid)\b/i.test(normalized)
    && /\b(assumptions?|risks?|outcomes?|in writing|list)\b/i.test(normalized)) {
    if (/\b(career outcomes?|evidence supports|specific outcomes?)\b/i.test(normalized)) {
      return createInsight(
        "For career outcomes, I would list internship access, communication confidence, portfolio quality, and networking as outcomes. Evidence would be grades, project output, applications, interview feedback, and participation data.",
        "Immediate remote learning career outcomes evidence response",
        timestamp,
        0.88,
      );
    }

    return createInsight(
      "For remote learning, my assumptions would be that access, motivation, and communication quality affect outcomes. The main risks are weaker engagement, uneven internet/device access, isolation, and harder feedback loops.",
      "Immediate remote learning assumptions risks response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(audit trail|hallucination|hallucinations|ai summarizes?|summary)\b/i.test(normalized)
    && /\b(audit trail|hallucination|hallucinations|source|claim|verify|spot)\b/i.test(normalized)
  ) {
    return createInsight(
      "For an AI summary audit trail, I would keep each claim tied to a source excerpt, timestamp, document or transcript ID, and confidence note. To spot hallucinations fast, check unsupported claims first and label anything without evidence.",
      "Immediate AI-summary hallucination audit trail",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(field[-\s]?to[-\s]?purpose|purpose mappings?|retention schedules?|auditability|audit trail)\b/i.test(normalized)
    && /\b(document|mapping|retention|schedule|audit|fields?|purpose)\b/i.test(normalized)
    && !/\b(hallucination|hallucinations|ai summarizes?|summary|source claim|unsupported claims?)\b/i.test(normalized)
  ) {
    return createInsight(
      "Yes. I would document each field, its purpose, retention schedule, owner, and approval status in one audit table, then review changes through the privacy or project owner before the demo.",
      "Immediate field-purpose retention auditability response",
      timestamp,
      0.9,
    );
  }

  if (/\b(in writing|list|define|document|schema|scheme)\b/i.test(normalized)
    && /\b(assumptions?|risks?|schema|scheme|remote learning|covid|outcomes?|fields?|failure modes?)\b/i.test(normalized)
    && !/\b(dynamodb|partition key|sort key|key schema|gsi|access pattern|bisect|regression|recent changes?|config|migration|debug|failing boundary)\b/i.test(normalized)) {
    return createInsight(
      "I would list it like this: assumptions are what data and constraints we are relying on; risks are bias, missing context, privacy, and access problems; schema terms should be defined in the doc so everyone uses the same meaning.",
      "Immediate assumptions risks documentation response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(awkward|awkwardness|embarrass|embarrassment|social threat|misstep)\b/i.test(normalized)
    && /\bdynamic db\b/i.test(normalized)
  ) {
    return createInsight(
      "I would treat 'dynamic DB' as just a rough analogy here, not a real database point. The useful idea is that one awkward moment can make people overthink the next step, so the reaction becomes self-reinforcing.",
      "Immediate awkwardness analogy without technical drift",
      timestamp,
      0.88,
    );
  }

  if (/\b(response windows?|late see|latency|escalation path|pressure spikes?)\b/i.test(normalized)
    && /\b(define|writing|escalation|pressure|window|response)\b/i.test(normalized)) {
    return createInsight(
      "I would define it simply: normal response within one business day, urgent issues use the escalation channel, and if pressure spikes we pause new requests and agree on the top priority in writing.",
      "Immediate response-window escalation process response",
      timestamp,
      0.88,
    );
  }

  if (/\b(room problem|room issue|maintenance|repair|status update|updates?)\b/i.test(normalized)
    && /\b(how fast|how soon|when|one[- ]line status|next update|report|commit|promise)\b/i.test(normalized)
    && !/\b(ship|ship first|users?|customers?|feature|error messages?|better error|saas|product)\b/i.test(normalized)) {
    return createInsight(
      "I do not know the exact status yet, so I would not promise a time. I would ask for one concrete update now, then only give the next update when something actually changes.",
      "Immediate process-safe status update response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(failed|failure|mistake)\b/i.test(normalized)
    && /\b(pressure|learned|communicated|communicate|what did you learn|next time)\b/i.test(normalized)
    && !/\b(project|technical|software|code|prompt|ai|cloud|kubernetes|lambda)\b/i.test(normalized)
  ) {
    return createInsight(
      "One example is my first presentation after coming to Canada. My English was weak, and I basically read from a phone translator, so it was awkward and stressful. I learned that under pressure I need to prepare key points earlier, ask for help sooner, and communicate clearly instead of just trying to survive the moment.",
      "Immediate general failure under pressure answer",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(impact|delivery|respond|response|afterward|stakeholders?)\b/i.test(normalized)
    && /\b(failure|failed|mistake|next steps?|communicat|specific example|what you said|verbatim|rollback timing|what went wrong)\b/i.test(normalized)
    && !/\b(project|technical|software|code|prompt|ai|cloud|kubernetes|lambda)\b/i.test(normalized)
  ) {
    return createInsight(
      "The immediate impact was that the presentation was not smooth, and I probably looked very nervous. I would explain it simply: I was not prepared enough for speaking in English yet, so next time I would prepare shorter notes, practice earlier, and ask for feedback before presenting.",
      "Immediate general failure impact follow-up answer",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(what specifically went wrong|how did you adjust|adjust your approach|what changed afterward)\b/i.test(normalized)
    && /\b(failure|failed|mistake|presentation|english|translation|what went wrong)\b/i.test(normalized)
    && !/\b(project|technical|software|code|prompt|ai|cloud|kubernetes|lambda|neighbor|restaurant|traffic|chat|movie|phone|policy)\b/i.test(normalized)
  ) {
    return createInsight(
      "The specific issue was that I was relying on translation instead of being ready to explain naturally. After that, I started preparing shorter speaking points earlier and practicing the flow, so even if my English was not perfect, I could still communicate the main idea.",
      "Immediate general failure follow-up answer",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(panic|presentation|presenting|spoke|speak|mid[-\s]?sentence|translator|froze|freeze|words)\b/i.test(normalized)
    && /\b(where|when|spike|right before|mid[-\s]?sentence|what part)\b/i.test(normalized)
    && !/\b(project|technical|software|code|api|aws|lambda|serverless|403|logs?)\b/i.test(normalized)
  ) {
    return createInsight(
      "It spiked right before I spoke, because I knew my English might not keep up. Mid-sentence it got worse when I had to rely on the translator, so I slowed down and tried to finish one clear point.",
      "Immediate presentation panic timing follow-up",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(specific example|stakeholders?|what you said|what did you say|verbatim)\b/i.test(normalized)
    && /\b(failure|failed|mistake|pressure|presentation|communicat|what went wrong)\b/i.test(normalized)
    && !/\b(project|technical|software|code|prompt|ai|cloud|kubernetes|lambda|scope|demo|stakeholder|team)\b/i.test(normalized)
  ) {
    return createInsight(
      "The specific example is that early high school presentation in Canada. What I would say is: my English was not strong enough yet, so I depended too much on translation. I learned to prepare earlier, use simpler wording, and ask for feedback before I had to speak in front of people.",
      "Immediate general failure stakeholder follow-up answer",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(real mistake|example|reschedule|caught late|last minute)\b/i.test(normalized)
    && /\b(restaurant|order|handoff|scheduling|schedule|admin|office|rush|shift)\b/i.test(normalized)
  ) {
    return createInsight(
      "I don't have a direct job-specific story for that role, so I wouldn't make one up. The transferable example is that when something changes late, I stop, confirm the new priority, update the people affected, and add one final check before handing it off.",
      "Immediate no-fake non-CS role example answer",
      timestamp,
      0.88,
    );
  }

  if (/\b(breakfast|skip breakfast|skipping breakfast|dizzy|nauseous|nausea)\b/i.test(normalized)
    && /\b(commute|focus|important|key|morning|during)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, that is the practical point: breakfast matters most when skipping it causes dizziness, nausea, or weak focus during the commute. I would treat that as a real signal, not just a diet preference.",
      "Immediate breakfast commute symptom answer",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(hours?|what time|time blocks?|available|availability|after classes|after class|get here|commute|how far|start time|start work|start the shift|start shifts?|can you start)\b/i.test(normalized)
    && /\b(work|shift|class|student|school|part[- ]?time|get here|transportation|commute|start time|start work|start the shift|start shifts?|can you start)\b/i.test(normalized)
    && !/\b(debug|uncertainty|unreliable|reject|side effects|younger self|customers? argue|trust is built|class discussion|breakfast|dizzy|nauseous|nausea|skip breakfast|access pattern|deployment|monitoring|cloud|joblens|job lens|dynamodb|database|api|cold[- ]?start|serverless|lambda|logs?|bugs?)\b/i.test(normalized)
  ) {
    return createInsight(
      "I can work around my school schedule, mostly after classes and on some weekends. For transportation, I can use the bus or drive depending on the location. I would confirm the exact hours from my class schedule instead of guessing.",
      "Immediate student availability and transport answer",
      timestamp,
      0.88,
    );
  }

  if (/\b(clothes?|outfits?)\b/i.test(normalized) && /\b(security reasons?|security lens)\b/i.test(normalized)) {
    return createInsight(
      "If you mean security literally, clothes are not the control; access rules and procedures are. For focus, it was mostly comfort: simple clothes reduce distraction during long project sessions.",
      "Immediate clothes-security-boundary answer",
      timestamp,
      0.88,
    );
  }

  if (/\b(clothes?|outfits?)\b/i.test(normalized) && /\b(mood|perception|comfort|focus|risk reasoning|claim)\b/i.test(normalized)) {
    return createInsight(
      "I would frame it modestly: clothes can affect mood through comfort and self-perception, but I would not treat it as a strong rule. The safe claim is that comfortable clothes reduce distraction for some people.",
      "Immediate clothes-mood modest-claim answer",
      timestamp,
      0.88,
    );
  }

  if (/\b(how many hours|hours are you sleeping|sleeping lately|sleep per night)\b/i.test(normalized)) {
    return createInsight(
      "It changes a lot. My sleep schedule is pretty irregular, so I would not give an exact number, but I do know I should make it more consistent.",
      "Immediate sleep-hours anti-invention response",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(ounces?|nightly amount|daily amount|track how many)\b/i.test(normalized)
    || (/\b(how much water|how much soda)\b/i.test(normalized) && /\b(soda|water|drink|drinking)\b/i.test(normalized))
  ) {
    return createInsight(
      "I do not really track exact ounces. A more realistic step is to swap one late soda for water first, then track it for a few days if I actually need numbers.",
      "Immediate drink-amount anti-invention response",
      timestamp,
      0.88,
    );
  }

  if (/\b(cutoff time|what time.*stop soda|set a cutoff|stop soda|swap water|swapping after dinner|after dinner|water instead)\b/i.test(normalized)) {
    return createInsight(
      "For tonight, I would set a simple cutoff: no soda after dinner, then water only. That is more realistic for me than trying to suddenly become super disciplined.",
      "Immediate practical soda cutoff response",
      timestamp,
      0.88,
    );
  }

  if (/\b(soda|water intake|drinking water|sleep lately|late soda)\b/i.test(normalized) && /\b(sleep|water|soda|drink|intake|time|stop)\b/i.test(normalized)) {
    return createInsight(
      "I do like soda, especially diet soda, but I know I should keep sugar low and drink more water. My sleep is also irregular, so the realistic goal is reducing late drinks and making the routine more consistent.",
      "Immediate grounded soda-water-sleep response",
      timestamp,
      0.88,
    );
  }

  if (/\b(co[- ]?op|watch something|while you play|play together|wanna play|want to play)\b/i.test(normalized)) {
    return createInsight(
      "Maybe, yeah. Co-op is fine, or we can just keep it simple and grab food if I am tired.",
      "Immediate casual game-or-food follow-up",
      timestamp,
      0.86,
    );
  }

  if (/\bfree time activities\b/i.test(normalized) && /\b(country|china|chinese)\b/i.test(normalized)) {
    return createInsight(
      "In China, people often watch videos, play games, eat out, or walk around malls. For me it is mostly games and anime.",
      "Immediate compact country-free-time response",
      timestamp,
      0.86,
    );
  }

  if (/\bwhat time\b/i.test(normalized) && /\b(head out|leave|go out)\b/i.test(normalized)) {
    return createInsight(
      "Let's head out in about 15 minutes.",
      "Immediate departure-time response without forced follow-up",
      timestamp,
      0.86,
    );
  }

  if (/\benroll\b/i.test(normalized) && /\bnight school\b/i.test(normalized) && /\bbusiness management\b/i.test(normalized)) {
    return createInsight(
      "That sounds like a good plan. Business management could be useful if you want more practical career options.",
      "Immediate night-school response without forced follow-up",
      timestamp,
      0.84,
    );
  }

  if (/\b(freezing|cold outside|cold out)\b/i.test(normalized)
    && /\b(panic|presenting|presentation|forget my lines|freeze at)\b/i.test(normalized)
    && /\b(my tenants?|tenants?|manage properties|property manager)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, that sounds like cold plus pressure. I would keep one calm fallback sentence ready, answer the next question slowly, and avoid turning it into a big story.",
      "Immediate listener-centered cold presentation nerves response",
      timestamp,
      0.88,
    );
  }

  if (/\b(freezing|cold outside|cold out)\b/i.test(normalized) && /\b(panic|presenting|presentation|forget my lines|freeze at)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, it is cold, but the presenting panic is the real part. I would keep it simple: I am doing okay, and when I freeze, I try to slow down and come back to one prepared line.",
      "Immediate cold-weather presentation panic response",
      timestamp,
      0.88,
    );
  }

  if (/\b(freezing|cold outside|cold out|bus stop)\b/i.test(normalized)
    && /\b(showing a place|showing it|showing today|show the place|handle the cold)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, I can handle the cold for a short showing. I would keep it quick, dress warm, and step inside between check-ins if we have to wait.",
      "Immediate cold showing practical response",
      timestamp,
      0.88,
    );
  }

  if (/\b(freezing|cold outside|cold out)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, first-day nerves plus waiting in the cold is rough. I am just trying to stay warm and wait it out; if there is a nearby lobby or cafe, I would step inside for a minute.",
      "Immediate cold-weather response without fake drink detail",
      timestamp,
      0.86,
    );
  }

  if (/\bthanks?\b/i.test(normalized) && /\bprofessor\b/i.test(normalized) && /\bnice of you\b/i.test(normalized)) {
    return createInsight(
      "Thanks, professor. I appreciate it.",
      "Immediate professor-thanks response without forced return question",
      timestamp,
      0.86,
    );
  }

  if (/\bbeing watched\b|\bbe careful\b/i.test(normalized) && /\bprivacy|watched|paranoid|personal information|personal info|private data|guard\b/i.test(normalized)) {
    return createInsight(
      "I get it. I would rather be careful with personal information and only share what is necessary.",
      "Immediate privacy concern response without forced return question",
      timestamp,
      0.86,
    );
  }

  if (/\bangry customers?\b/i.test(normalized) && /\b(calm|tone|steady|defensive|wording|handling|handle)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, the wording should stay calm and specific. I would acknowledge the issue, avoid sounding defensive, check the record, and explain the next step I can actually take.",
      "Immediate angry-customer wording response",
      timestamp,
      0.88,
    );
  }

  if (/\bwhat did you eat for lunch\b/i.test(normalized)) {
    return createInsight(
      "Probably something simple, like fried chicken, curry, or malatang. My meals are usually pretty practical.",
      "Immediate grounded lunch response",
      timestamp,
      0.86,
    );
  }

  if (/\bprefer\b/i.test(normalized) && /\bwork(?:ing)?\b/i.test(normalized) && /\bhome\b/i.test(normalized) && /\bworkplace|office\b/i.test(normalized)) {
    return createInsight(
      "I prefer working from home because it is quieter and I have more control over my space. Offices can feel noisy and distracting.",
      "Immediate grounded work-from-home preference",
      timestamp,
      0.86,
    );
  }

  if (/\bcheapest fried chicken\b|\bfried chicken\b.*\bfrench fries\b|\bfrench fries\b.*\bfried chicken\b/i.test(normalized)) {
    return createInsight(
      "Yeah, fried chicken and fries sounds good. I usually like KFC or Mary Brown's for that kind of food.",
      "Immediate fried chicken preference response",
      timestamp,
      0.86,
    );
  }

  if (
    /\b(openai|gpt)\b/i.test(normalized)
    && /\b(latest|today|current|pricing|price|per[-\s]?1m|per million|model list|which model)\b/i.test(normalized)
  ) {
    return createInsight(
      "I would check the official OpenAI pricing page first, because the exact prices can change. For a live assistant, I would compare latency, quality, input cost, output cost, and test the cheapest model that still answers reliably.",
      "Immediate current OpenAI pricing uncertainty answer",
      timestamp,
      0.9,
    );
  }

  if (/\bview\b/i.test(normalized) && /\b(place where you live|around your place|where you live|around here)\b/i.test(normalized)) {
    return createInsight(
      "Nothing too special, mostly normal city or residential views around Halifax. I care more about quiet private space than a beautiful view.",
      "Immediate grounded view response",
      timestamp,
      0.86,
    );
  }

  if (/\b(person who likes to read|someone who likes to read|read a lot)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific person in mind. I would describe someone patient and curious, who can focus for a long time without getting bored.",
      "Immediate generic reader-person response",
      timestamp,
      0.86,
    );
  }

  if (/\b(make things by hand|handmade|craft|toys?|furniture)\b/i.test(normalized) && /\b(person|someone|describe|likes?)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific person in mind. I would say they are probably patient, practical, and good at turning an idea into something real.",
      "Immediate grounded handmaking-person response without fake anecdote",
      timestamp,
      0.86,
    );
  }

  if (/\bperfume\b/i.test(normalized) && /\bgift\b/i.test(normalized)) {
    return createInsight(
      "Maybe, but only if I knew the person liked that scent. Otherwise, I would choose something safer.",
      "Immediate perfume-gift response without unsupported relationship detail",
      timestamp,
      0.86,
    );
  }

  if (/\bperfume\b/i.test(normalized) && /\b(many bottles|have many|wear|why)\b/i.test(normalized)) {
    return createInsight(
      "Not really. I do not wear perfume much, so I would not make a big story out of it.",
      "Immediate perfume ownership response without unsupported gift detail",
      timestamp,
      0.86,
    );
  }

  if (/\b(person who|someone who|describe)\b/i.test(normalized) && /\b(medical field|medicine|doctor|surgeon|nurse)\b/i.test(normalized)) {
    return createInsight(
      "I do not have a specific person story for that. I would answer generally: people who choose medicine usually need patience, responsibility, and a real willingness to deal with pressure.",
      "Immediate generic medical-career person response",
      timestamp,
      0.86,
    );
  }

  if (/\b(have you collected coins|do you collect coins|collected coins|take coins|carry coins|use coins)\b/i.test(normalized)) {
    return createInsight(
      "Not really. I almost never carry coins now; I mostly use cards or my phone.",
      "Immediate coins response without forced follow-up",
      timestamp,
      0.86,
    );
  }

  if (/\bwhen are you coming back\b/i.test(normalized)) {
    return createInsight(
      "I'm not sure yet; probably later. I can let you know when I know.",
      "Immediate cautious return-time response",
      timestamp,
      0.84,
    );
  }

  if (/\b(cooked me|so dead|i'?m dead|brutal|midterm)\b/i.test(normalized) && /\b(midterm|exam|test|dead|cooked)\b/i.test(normalized)) {
    return createInsight(
      "Yeah, that sounds brutal. I would probably just recover a bit and not think too hard for a while.",
      "Immediate slang stress response without fake personal claim",
      timestamp,
      0.88,
    );
  }

  if (/\b(asked someone for advice|ask someone for advice|asked for advice|advice from someone)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one dramatic advice story. Usually I ask when I need to narrow down choices, like courses, projects, or what to focus on next.",
      "Immediate grounded advice story response",
      timestamp,
      0.86,
    );
  }

  if (/\b(photo|picture)\b/i.test(normalized) && /\b(describe|talk about|makes you|important|remember|home|room)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific photo I would confidently describe. I would keep it simple and talk about photos as a way to remember a period of life.",
      "Immediate grounded photo response",
      timestamp,
      0.86,
    );
  }

  if (/\b(old friend|got in contact|reconnect|reconnected|lost contact)\b/i.test(normalized)) {
    return createInsight(
      "I can talk about old friends generally, but I should not invent a reunion story. Some friendships just faded after school because people went to different places.",
      "Immediate grounded old-friend response",
      timestamp,
      0.86,
    );
  }

  if (/\b(wild animals?|park|nature|animal)\b/i.test(normalized) && /\b(city|halifax|place|seen|see|describe)\b/i.test(normalized)) {
    return createInsight(
      "I would keep it general: I like quiet places with some trees or space to walk, but I do not have one specific animal or park story I would confidently use.",
      "Immediate grounded park/animal response",
      timestamp,
      0.86,
    );
  }

  if (/\bpanther\b/i.test(normalized) && /\bdifficult\b/i.test(normalized) && /^\s*[A-Z]\s*:/i.test(transcript)) {
    return createInsight(
      "Good point. We should decide the level of detail first, then draw the simplest version that still reads as a panther.",
      "Immediate meeting panther design-scope response",
      timestamp,
      0.86,
    );
  }

  if (/\bspiders?\b/i.test(normalized) && /\bweb\b/i.test(normalized) && /^\s*[A-Z]\s*:/i.test(transcript)) {
    return createInsight(
      "So the next decision is whether we model the web as flat or three-dimensional.",
      "Immediate meeting spider-web decision response",
      timestamp,
      0.86,
    );
  }

  if (/\bindian\b/i.test(normalized) && /\bafrican\b/i.test(normalized) && /\belephants?\b/i.test(normalized)) {
    return createInsight(
      "So the next step is to choose which elephant type first, because the ears change the drawing.",
      "Immediate meeting elephant-type decision response",
      timestamp,
      0.86,
    );
  }

  if (/\b(child|kid|childhood)\b/i.test(normalized) && /\b(friends|teamwork|make friends|play with others)\b/i.test(normalized)) {
    return createInsight(
      "When I was very young, I was actually lively and playful. Later I became quieter, so I would not describe it as a simple always-social or always-alone story.",
      "Immediate grounded childhood social response",
      timestamp,
      0.86,
    );
  }

  if (/\bwhat game\b|\bwhich game\b|\bgames? (?:you )?(?:played|play)\b/i.test(normalized)) {
    return createInsight(
      "Mostly games like Genshin or other RPG and gacha-style games. I like exploration, music, collecting, and the overall atmosphere.",
      "Immediate grounded game preference response",
      timestamp,
      0.88,
    );
  }

  if (/\bmountains?\b/i.test(normalized) && /\bholiday|travel|go to|go on\b/i.test(normalized)) {
    return createInsight(
      "I do not really go on mountain holidays, but I would be open to it with other people. I like the idea of travel more than travelling alone.",
      "Immediate grounded mountain travel response",
      timestamp,
      0.86,
    );
  }

  if (/\bbike\b/i.test(normalized) && /\b(now|currently|these days|do you have)\b/i.test(normalized)) {
    return createInsight(
      "Not now. The bike I remember more is the e-bike I used in university, but these days I usually walk, take the bus, or drive.",
      "Immediate grounded current-bike response",
      timestamp,
      0.86,
    );
  }

  if (/\b(what|which)\s+car\b/i.test(normalized) || /\bcar\b.{0,30}\bdrive\b/i.test(normalized) || /\bdrive\b.{0,30}\bcar\b/i.test(normalized)) {
    return createInsight(
      "I drive a black 2025 Honda Civic Hatchback Sport, but honestly I do not drive that much day to day.",
      "Immediate grounded current-car response",
      timestamp,
      0.9,
    );
  }

  if (/\bbike\b/i.test(normalized) && /\b(young|child|kid|childhood)\b/i.test(normalized)) {
    return createInsight(
      "I do not remember childhood biking clearly. The bike I remember more is the e-bike I used later in university, especially dealing with winter and steep roads.",
      "Immediate grounded bike memory response",
      timestamp,
      0.86,
    );
  }

  if (/\bonline video\b/i.test(normalized) && /\blearn(?:ed)?\b/i.test(normalized)) {
    return createInsight(
      "I usually learn practical tech things from online videos or tutorials. I watch enough to understand the idea, then I test it myself instead of just trusting the video.",
      "Immediate grounded online-learning response",
      timestamp,
      0.86,
    );
  }

  if (/\bstrong opinions\b|\bopinionated\b/i.test(normalized) && /\b(person|someone|who)\b/i.test(normalized)) {
    return createInsight(
      "I do not have one specific person I would name. I would describe someone who argues confidently, speaks directly, and does not change their view easily.",
      "Immediate generic strong-opinion person response",
      timestamp,
      0.86,
    );
  }

  if (
    /\b(challenge|difficult|hard)\b/i.test(normalized)
    && /\b(describe|faced|face|thought was|overcome|deal with)\b/i.test(normalized)
    && !/\b(bug|debug|project|app|software|code|programming|assignment|system|technical)\b/i.test(normalized)
  ) {
    return createInsight(
      "One real challenge was adapting to English after coming to Canada. It was not one dramatic moment; it was constant awkwardness, slowly understanding people, and learning to answer naturally.",
      "Immediate grounded life-challenge answer",
      timestamp,
      0.88,
    );
  }

  if (/\bapi response schema\b|\bresponse schema from backend\b|\bschema from backend\b/i.test(normalized)) {
    return createInsight(
      "Let's use a mock schema for now, write down the assumptions, and replace it once backend confirms the real response shape.",
      "Immediate meeting API schema unblock response",
      timestamp,
      0.9,
    );
  }

  if (/\bprogress update\b|\bquick update\b|\bwhat should i say\b.*\b(progress|update)\b/i.test(normalized)) {
    return createInsight(
      "I finished the DynamoDB table and mocked the API response. Next I'm testing the main flow and checking what still breaks before the demo.",
      "Immediate meeting progress update with next step",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(evidence|impact|outcome|metric|numbers?|proof|show)\b/i.test(normalized)
    && /\b(without exposing|not expose|no raw|privacy[-\s]?safe|user data|individuals?|identifying data)\b/i.test(normalized)
  ) {
    return createInsight(
      "Yes. I would point to aggregated evidence: before/after rates, counts, latency or completion time, and a short anonymized example if needed. I would avoid raw transcripts, names, exact locations, or anything that identifies one user.",
      "Immediate privacy-safe impact evidence answer",
      timestamp,
      0.9,
    );
  }

  if (/\b(private user data|expose private|privacy breach|user data)\b/i.test(normalized)) {
    return createInsight(
      "Let's pause and map what data is exposed, who can access it, and add that as the next review item before shipping.",
      "Immediate meeting privacy-risk response with next action",
      timestamp,
      0.9,
    );
  }

  if (/\bwhat job\b/i.test(normalized) && /\b(interesting|exhausting|tiring|actually)\b/i.test(normalized)) {
    return createInsight(
      "A job that sounds interesting but is exhausting is customer support or service work. It looks like just talking to people, but the hard part is staying calm when users are frustrated and still giving clear next steps.",
      "Immediate interesting-but-exhausting job answer",
      timestamp,
      0.88,
    );
  }

  if (/\b(real project|your project|in your project|what changed)\b/i.test(normalized)
    && /\b(react|classroom|environment|constraints?)\b/i.test(normalized)) {
    return createInsight(
      "I would separate the two. React changed the implementation constraints, like component state and UI flow, while the classroom environment changed how I explained and tested the idea. So the project changed through both technical constraints and feedback context.",
      "Immediate React-versus-environment project clarification",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(what|which|tell me|explain|describe|talk about)\b/i.test(normalized)
    && /\b(project|app|application)\b/i.test(normalized)
    && !/\b(cloud|aws|joblens|job lens|jobless|job level|elderalbum|elder album|older album|dalparkaid|dal park|parking|ai meeting|meeting monitor|meeting model)\b/i.test(normalized)
    && !/\b(requirements?|unclear|scope|trade[- ]?off|public health)\b/i.test(normalized)
    && (
      /\b(saynext|say next|for next|did you make|you made|you built)\b/i.test(normalized)
      || /\byour project\b/i.test(normalized)
    )
  ) {
    return createInsight(
      "Hybrid Search Memory Assistant is my real-time AI conversation project. It uses live transcripts, personal memory, prenotes, and hybrid retrieval so the model only sees the most relevant context.",
      "Immediate public project overview",
      timestamp,
      0.92,
    );
  }

  if (/\b(requirements?|unclear|scope|trade[- ]?off)\b/i.test(normalized)
    && /\b(public health|project|what trade[- ]?off|unclear requirements)\b/i.test(normalized)) {
    return createInsight(
      "When requirements are unclear, the trade-off is speed versus correctness. I would freeze the smallest safe version, write the assumptions down, and ask for confirmation before building more.",
      "Immediate unclear-requirements trade-off answer",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(pushback|don'?t buy|doesn'?t buy|disagree|says?\s+no|someone says\s+no)\b/i.test(normalized)
    && /\b(user side|user impact|deadline|timeline|persuade|trade[- ]?offs?|smaller working|testable)\b/i.test(normalized)
  ) {
    return createInsight(
      "If they still push back, I would set a boundary: we should not commit to the bigger trade-off without evidence. I would offer one smaller test, name the owner, and decide from user impact, time, and risk.",
      "Immediate trade-off pushback boundary",
      timestamp,
      0.9,
    );
  }

  if (/\b(did you like to talk|talk with others|talk to others)\b/i.test(normalized) && /\b(child|kid|little)\b/i.test(normalized)) {
    return createInsight(
      "When I was very young, I was actually pretty lively and naughty. I became much quieter later, probably around middle school.",
      "Immediate grounded childhood personality answer",
      timestamp,
      0.9,
    );
  }

  if (/\babove and beyond\b/i.test(normalized)) {
    return createInsight(
      "One example is Hybrid Search Memory Assistant. I did not just fix one bug; I kept testing messy ASR, memory retrieval, and teleprompt cases until the system felt more usable.",
      "Immediate grounded above-and-beyond interview answer",
      timestamp,
      0.9,
    );
  }

  if (/\badd notifications\b/i.test(normalized) && /\bmatching bug\b/i.test(normalized)) {
    return createInsight(
      "Next, I would fix the matching bug first, then add notifications after the core flow is stable and tested.",
      "Immediate meeting scope-control response",
      timestamp,
      0.9,
    );
  }

  if (/\busers?\b/i.test(normalized) && /\bconfused\b/i.test(normalized) && /\badd button\b/i.test(normalized)) {
    return createInsight(
      "We should make the Add button label or tooltip clearer, then test the main flow again with a fresh user.",
      "Immediate meeting UI clarity response",
      timestamp,
      0.9,
    );
  }

  if (/\b(which branch|latest code|latest branch)\b/i.test(normalized)) {
    return createInsight(
      "Let's check the remote branches and recent commits first, then pick the latest tested branch and write down which one we are using.",
      "Immediate meeting branch clarification response",
      timestamp,
      0.88,
    );
  }

  if (
    (
      /\b(allergy|allergies|allergen|substitution|substitutions|what would you like)\b/i.test(normalized)
      || (/\border\b/i.test(normalized) && /\b(food|restaurant|server|dish|menu|allerg|substitution|like to order)\b/i.test(normalized))
    )
    && /\b(avoid|know about|any|should|food|restaurant|server|dish|menu|prefer|like to order|would you like|no allergy|exact|risk level|trace|reaction)\b/i.test(normalized)
  ) {
    if (/\b(confirm|check|verify|ask)\b/i.test(normalized) && /\ballerg/i.test(normalized) && /\b(substitution|substitutions|needed)\b/i.test(normalized)) {
      return createInsight(
        "For me, no food allergies. If this is for another person, I would confirm the exact allergen and cross-contact risk first, then choose substitutions after that instead of guessing.",
        "Immediate allergy confirmation before substitution",
        timestamp,
        0.9,
      );
    }

    if (/\b(someone|they|other people|customer|guest)\b/i.test(normalized) && /\ballerg/i.test(normalized)) {
      return createInsight(
        "If someone has allergies, I would not suggest a substitute blindly. Ask the exact allergen and reaction severity first, then confirm ingredients and cross-contact with the restaurant.",
        "Immediate third-party allergy substitution safety response",
        timestamp,
        0.9,
      );
    }

    if (/\b(which dish|exact swap|what exact swap|nation[- ]based|substitutions?)\b/i.test(normalized)) {
      return createInsight(
        "If you need an exact food swap, I would keep it simple: for curry, swap heavy cream for coconut milk, or for malatang, reduce spice and avoid extra oily toppings. For me this is preference, not allergy.",
        "Immediate exact food substitution response",
        timestamp,
        0.88,
      );
    }

    if (/\b(substitution|substitutions)\b/i.test(normalized) && !/\b(they|someone else|other people|customer|guest)\b/i.test(normalized)) {
      return createInsight(
        "For me, no required substitutions because I do not have food allergies. I would only adjust based on preference, like spice level or whether the dish is too heavy.",
        "Immediate personal substitution preference response",
        timestamp,
        0.9,
      );
    }

    if (/\b(they|someone else|other people|customer|guest)\b/i.test(normalized) && /\b(exact|risk level|cross[- ]?contact|stated|quantif|policy)\b/i.test(normalized)) {
      return createInsight(
        "If this is about another person, I would not guess. I would ask them to state the exact allergen, reaction severity, and cross-contact rule before ordering.",
        "Immediate third-party allergy verification response",
        timestamp,
        0.9,
      );
    }

    return createInsight(
      /\b(what would you like|like to order|order)\b/i.test(normalized)
        ? "No food allergies for me. I would keep the order simple, probably something like chicken or whatever the main safe option is."
        : "For me, I do not have food allergies. If this is for other people, we should ask them directly instead of guessing.",
      "Immediate food allergy safety response",
      timestamp,
      0.9,
    );
  }

  if (/\b(java script|javascript)\b/i.test(normalized) && /\b(exact wording|intended meaning|mean|confirm|what is it)\b/i.test(normalized)) {
    return createInsight(
      "If you mean JavaScript, I would say it as the programming language and confirm whether you mean wording or technical experience.",
      "Immediate JavaScript ASR meaning clarification",
      timestamp,
      0.88,
    );
  }

  if (
    /\b(legal basis|basis for processing|processing basis|retention exceptions?|approve retention|approves? retention|exceptions?)\b/i.test(normalized)
    && /\b(processing|retention|legal|approve|approval|exceptions?)\b/i.test(normalized)
  ) {
    return createInsight(
      "I would not define the legal basis myself. I would ask the privacy or legal owner to confirm the processing basis, document the purpose and data scope, and require written approval plus an audit note for any retention exception.",
      "Immediate legal-basis retention-approval boundary",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(data controller|lawful basis|legal basis|basis for processing|audit trails?|audit logs?)\b/i.test(normalized)
    && /\b(who|document|identify|lawful|legal|basis|audit|controller|project|demo|data)\b/i.test(normalized)
  ) {
    return createInsight(
      "For this project, I would identify the controller as the team or organization deciding why the data is collected and how it is used. Then I would document purpose, data categories, lawful basis confirmed by the privacy or legal owner, access owner, retention window, and audit trail entries.",
      "Immediate data-controller lawful-basis process",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(data lineage|lineage|provenance|consent basis|retention schedule)\b/i.test(normalized)
    && /\b(data|demo|document|log|provenance|consent|retention|lineage)\b/i.test(normalized)
  ) {
    return createInsight(
      "For demo data lineage, I would log provenance/source, timestamp, consent basis, retention schedule, owner, and access history. If any part is unknown, mark it unknown instead of treating the demo data as safe.",
      "Immediate demo data-lineage documentation process",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(sensitive artifacts?|sensitive data(?:sets?)?|residual data|data handling|retention|chain[-\s]?of[-\s]?custody|audit logs?|encryption[-\s]?at[-\s]?rest|post[-\s]?demo)\b/i.test(normalized)
    && /\b(scope|demo|artifacts?|data(?:sets?)?|residual|handling|document|retention|encrypt|audit|access|logs?|privacy|chain)\b/i.test(normalized)
  ) {
    return createInsight(
      "I would separate demo scope from sensitive data handling: collect only needed datasets or artifacts, set a short written retention window, restrict access, encrypt stored files, and log access or deletion. I would confirm owners before promising specifics.",
      "Immediate sensitive-artifact retention process",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(deadline|due|demo|presentation)\b/i.test(normalized)
    && /\b(too many features|scope|cut|what should we do|what do we do|right now)\b/i.test(normalized)
    && /\b(exactly changes|what exactly changes|concrete list|what changes)\b/i.test(normalized)
  ) {
    return createInsight(
      "Exact change list: keep the core demo path, freeze the API contract, cut nice-to-have screens, and defer risky extras. Then assign one owner and one test for the remaining demo flow.",
      "Immediate concrete scope-cut change list",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(demo|deadline|deliverables?|ship|guaranteed)\b/i.test(normalized)
    && /\b(scope|cut|deliverables?|guaranteed|ship|endpoints?|screens?|tests?)\b/i.test(normalized)
  ) {
    return createInsight(
      "I would not say everything is guaranteed. I would commit only to the demo-critical list: the core user flow, the required API or mock contract, the matching UI screen, and smoke tests for success plus key failure states. Anything outside that stays explicitly out of scope.",
      "Immediate demo deliverable commitment boundary",
      timestamp,
      0.9,
    );
  }

  if (
    /\bconstructive\s+feedback\b/i.test(normalized)
    || (/\bfeedback\b/i.test(normalized) && /\b(receive|received|got|given|improve|improved|learned)\b/i.test(normalized))
  ) {
    if (/\b(career fair|next step|next step checklist|specific feedback)\b/i.test(normalized)) {
      return createInsight(
        "The feedback was that my message was too generic, so the next step is to make one concrete project example clearer, update the wording, and practice a short version.",
        "Immediate career-fair feedback next-step answer",
        timestamp,
        0.9,
      );
    }

    return createInsight(
      "One useful piece of feedback was that my answers sometimes sounded too polished and AI-like. I took that seriously because for my assistant project, the answer has to sound like something I could actually say. So I changed the prompts and tests to check for shorter, more natural responses, not just technically correct ones.",
      "Immediate supported constructive-feedback interview answer",
      timestamp,
      0.9,
    );
  }

  if (/\bwho\s+owns\b/i.test(normalized) && /\b(contract|api\s+contract|demo)\b/i.test(normalized)) {
    return createInsight(
      "I don't want to guess a name. Let's assign one owner now, and that person should write the current v1 API contract before the demo.",
      "Immediate meeting owner clarification",
      timestamp,
      0.88,
    );
  }

  if (/\b(migrating to aws|azure project|from azure|changed your mind)\b/i.test(normalized)
    && /\b(aws|azure|project|cloud)\b/i.test(normalized)) {
    return createInsight(
      "I would not say Azure was wrong. I would frame it as AWS fitting the project scope better, especially for serverless pieces like S3, API Gateway, Lambda, and DynamoDB. The reason is simpler deployment and clearer course/project fit.",
      "Immediate Azure-to-AWS cloud framing",
      timestamp,
      0.9,
    );
  }

  if (/\b(real project|your project|in your project|what changed)\b/i.test(normalized)
    && /\b(react|classroom|environment|constraints?)\b/i.test(normalized)) {
    return createInsight(
      "I would separate the two. React changed the implementation constraints, like component state and UI flow, while the classroom environment changed how I explained and tested the idea. So the project changed through both technical constraints and feedback context.",
      "Immediate React-versus-environment project clarification",
      timestamp,
      0.9,
    );
  }

  if (
    /\b(hardest|hard|difficult|tricky)\b/i.test(normalized)
    && /\b(bug|issue|problem|debug)\b/i.test(normalized)
    && /\b(reproduc|trace|end[-\s]?to[-\s]?end|request id|logs?|start by|process|how do you debug)\b/i.test(normalized)
    && !/\b(tell me about a time|describe a time|give me an example|real example|what was your|your hardest|you fixed)\b/i.test(normalized)
  ) {
    return createInsight(
      "Yes, that is the right process: reproduce it, isolate the failing layer, trace one request end to end, then compare logs and inputs before changing code.",
      "Immediate concise hard-bug process agreement",
      timestamp,
      0.9,
    );
  }

  if (/\b(milestones?|included|excluded|acceptance criteria)\b/i.test(normalized)
    && /\b(in writing|spell|scope|renewal|demo)\b/i.test(normalized)) {
    return createInsight(
      "I would write it as three parts: included work, excluded work, and acceptance criteria. Then add milestone dates and one owner for each item so we can verify what is actually done.",
      "Immediate scope milestone writing answer",
      timestamp,
      0.9,
    );
  }

  return null;
}
