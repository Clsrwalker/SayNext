import type { EventMemorySnapshot } from "../memory/event-memory";
import {
  enforceOutputLanguage,
  replaceChineseEnglishClarification,
  type OutputLanguage,
} from "./output-language-guards";
import {
  removePublicTranscriptPersonalLeak,
  replacePublicTranscriptRoleplay,
} from "./output-public-guards";
import type { PromptMode } from "./process-router";
import {
  countTelepromptWords,
  isGenericSpeakingPrompt,
  isTechnicalOrProjectFollowup,
  looksLikeQuestion,
  normalizeMojibakeArtifacts,
  normalizeSpokenDisplayPunctuation,
} from "./output-text-utils";

export {
  countTelepromptWords,
  isGenericSpeakingPrompt,
  isLikelySpeakerLabelTranscript,
  isTechnicalOrProjectFollowup,
  looksLikeQuestion,
  normalizeMojibakeArtifacts,
  normalizeSpokenDisplayPunctuation,
} from "./output-text-utils";

export type { OutputLanguage } from "./output-language-guards";

export function sanitizeSayNextOutput(text: string): string {
  let cleaned = String(text ?? "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (/^\s*\{/.test(cleaned)) {
    const outputField = extractOutputField(cleaned);
    if (outputField) {
      cleaned = outputField;
    } else {
      return "Sorry, could you say that again?";
    }
  }

  cleaned = normalizeMojibakeArtifacts(cleaned.replace(/\r\n/g, "\n"))
    .replace(/\u2019s/g, "'s")
    .replace(/\u2019t/g, "'t")
    .replace(/\u2019re/g, "'re")
    .replace(/\u2019ve/g, "'ve")
    .replace(/\u2019d/g, "'d")
    .replace(/\u2019ll/g, "'ll")
    .replace(/\u2018|\u2019|\uFFFD/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, " - ")
    .replace(/\u2080/g, "0")
    .replace(/\u2081/g, "1")
    .replace(/\u2082/g, "2")
    .replace(/\u2083/g, "3")
    .replace(/\u2084/g, "4")
    .replace(/\u2085/g, "5")
    .replace(/\u2086/g, "6")
    .replace(/\u2087/g, "7")
    .replace(/\u2088/g, "8")
    .replace(/\u2089/g, "9")
    .replace(/\b(?:option|version|response)\s*\d+\s*[:.)-]/gi, "\n")
    .replace(/\b(?:option|version|response)\s*[A-Z]\s*[:.)-]/gi, "\n");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstUsefulLine = lines.find((line) => {
    if (/^(scene|analysis|reasoning|explanation|note|context)\s*[:-]/i.test(line)) return false;
    if (lines.length > 1 && /^(sure|yeah|okay|ok|absolutely|of course)[.!]*$/i.test(line)) return false;
    return true;
  }) ?? lines[0] ?? "";

  cleaned = firstUsefulLine
    .replace(/^\s*[A-Z][A-Z_ .'-]{0,30}\s*:\s*/i, "")
    .replace(/^\s*(?:[-*]+|\d+[.)]|[A-Za-z][.)])\s*/g, "")
    .replace(/^\s*(?:(?:you\s+can\s+say|you\s+could\s+say|say|direct\s+answer|answer|reply|response|suggested\s+reply)\s*[:-]\s*)+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  cleaned = normalizeSpokenDisplayPunctuation(cleaned);

  if (/\bopen\s*courseware\b/i.test(cleaned) && /\bsaynext\b|\bmy project\b|\bproject or experience\b|\bproject i can explain\b/i.test(cleaned)) {
    return "A useful note is that this is course context, so I would focus on the concept or example being explained, not treat OpenCourseWare as the topic.";
  }

  if (/^that'?s interesting\.\s*can you clarify (?:what specific|which) animals\b/i.test(cleaned)) {
    return "That's interesting. Which animal is that?";
  }

  const metaQuoted = cleaned.match(/\b(?:just say|say|like|such as)\s+["“]([^"”]{1,80})["”]/i);
  if (
    metaQuoted?.[1]
    && /\b(?:would work|if that|since there|referring to|acknowledg|casual|what the professor|attendance|best answer)\b/i.test(cleaned)
  ) {
    cleaned = metaQuoted[1].trim();
  }

  if (/^you can mention what (?:you'?ve|you have) accomplished/i.test(cleaned)) {
    cleaned = "I can give a quick update on what I finished, what I'm working on, and any blocker.";
  } else if (/^you can mention\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/^you can mention\b/i, "I can mention").trim();
  }

  cleaned = cleaned
    .replace(/\s*(?:Can you|Could you)\s+give me more context\??/gi, "")
    .replace(/\bI don'?t really have a super dramatic dream job,\s*but\s*/i, "")
    .replace(/\bI don'?t have a dream job,\s*but\s*/i, "")
    .replace(/\bdream job\b/gi, "ideal role")
    .trim();
  cleaned = normalizeSpokenDisplayPunctuation(cleaned);
  if (/[\u0400-\u04FF]|\?{2,}/.test(cleaned)) {
    const englishSentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence && !/[\u0400-\u04FF]|\?{2,}/.test(sentence));
    cleaned = englishSentences.length ? englishSentences.join(" ") : cleaned.replace(/\s*\S*(?:[\u0400-\u04FF]|\?{2,})\S*/g, "");
  }
  cleaned = cleaned.replace(/([.!?]),/g, "$1").replace(/,\s*([.!?])/g, "$1").trim();

  if (!cleaned) {
    return "Sorry, could you say that again?";
  }

  if (/^(sure|okay|ok|yes|yeah|thank you|thanks)[.!]*$/i.test(cleaned)) {
    return "Sure, could you repeat the full question?";
  }

  if (cleaned.length > 360) {
    const firstSentence = cleaned.match(/^.{1,360}?[.!?](?:\s|$)/)?.[0]?.trim();
    cleaned = firstSentence || `${cleaned.slice(0, 357).trim()}...`;
  }

  const openParens = (cleaned.match(/\(/g) ?? []).length;
  const closeParens = (cleaned.match(/\)/g) ?? []).length;
  if (openParens > closeParens) {
    cleaned = cleaned.replace(/\s*\([^()]*$/g, "").trim();
  }
  if (/\b(?:and|or|but|because|with|without|including|such as|how many|how much|what kind of)\s*$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\s+\S+$/g, "").trim();
  }
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned = `${cleaned}.`;
  }

  return cleaned;
}

function removeUnsupportedIdentityClaim(output: string, transcript: string): string {
  const transcriptLooksSpeakerLabeled = /^\s*[A-Z]\s*:/i.test(transcript);
  const transcriptAsksXiangIdentity = /\b(your name|who are you|introduce yourself|tell me about yourself)\b/i.test(transcript);

  if (!transcriptLooksSpeakerLabeled && transcriptAsksXiangIdentity) {
    return output;
  }

  if (!/\bI'?m Xiang\b|\bI am Xiang\b/i.test(output)) {
    return output;
  }

  const kept = output
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bI'?m Xiang\b|\bI am Xiang\b|\bbackend development\b/i.test(sentence))
    .join(" ")
    .trim();

  return kept || "Nice to meet you.";
}

function replaceUnsupportedFavoriteTeacherClaim(output: string, transcript: string): string {
  if (!/\b(favou?rite|favorite)\s+(teacher|professor|instructor)\b|\bteacher\s+(you|i)\s+(like|liked|remember|remembered)\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(?:mr|mrs|ms|miss|dr|professor)\.?\s+[A-Z][a-z]+|\bmy\s+(?:favou?rite|favorite)\s+(?:teacher|professor|instructor)\b/i.test(output)) {
    return output;
  }

  return "I do not really have one specific favourite teacher. I usually remember teachers who explain things clearly, stay patient, and do not make the class feel too stressful.";
}

function replaceUnsupportedNamedHypotheticalClaim(output: string, transcript: string): string {
  if (!/\bdescribe a person\b|\bperson who has chosen\b|\bsomeone who has chosen\b|\bcareer in the medical field\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(?:mr|mrs|ms|miss|dr|professor)\.?\s+[A-Z][a-z]+|\bsomeone like\s+[A-Z][a-z]+\b/i.test(output)) {
    return output;
  }

  return "I would describe someone who chose medicine because they wanted practical work that helps people directly. It seems demanding, but also meaningful because their effort can make a real difference for patients.";
}

function replaceOpenCoursewareProjectMisread(output: string, transcript: string): string {
  if (!/\b(open\s*courseware|opencourseware|ocw\.mit\.edu|creative commons|professor strang)\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(saynext|my project|real project|project or experience|project i can explain|architecture)\b/i.test(output)) {
    return output;
  }

  return "A useful note is that this is course context, so I would focus on the concept or example being explained, not treat OpenCourseWare as the topic.";
}

function shortenSmallProjectAnswer(output: string, transcript: string): string {
  if (!/\bsmall project\b|\bproject you made\b|\bsmall project you made\b/i.test(transcript)) {
    return output;
  }

  if (countTelepromptWords(output) <= 45) {
    return output;
  }

  if (/\belder album\b/i.test(output)) {
    return "Sure, I made Elder Album, a small AWS serverless photo-sharing app. It used Lambda, DynamoDB, and S3, and the main challenge was connecting the pieces without small integration mistakes breaking the flow.";
  }

  const firstSentence = output.match(/^.{1,260}?[.!?](?:\s|$)/)?.[0]?.trim();
  return firstSentence && countTelepromptWords(firstSentence) <= 45 ? firstSentence : output;
}

function polishPersonaSayability(output: string, transcript: string, promptMode?: PromptMode): string {
  let polished = output.trim();

  if (/^that sounds like a small transition in the conversation,\s*so i would just acknowledge it briefly\.?$/i.test(polished)) {
    return "No action needed yet.";
  }

  polished = polished
    .replace(/^Honestly,\s*/i, "")
    .replace(/\s+Honestly,\s*/g, " ")
    .replace(/\s+honestly([.!?])$/i, "$1")
    .replace(/^I finished(?: setting up)? the DynamoDB tables? and mocked some API\.?$/i, "I finished the DynamoDB table and mocked the API response. Next I'm testing the main flow and checking what still breaks before the demo.")
    .replace(/\bmostly chill at home\b/i, "mostly stay home")
    .replace(/\bchill one-on-one chats?\b/gi, "quiet one-on-one conversations")
    .replace(/\bprefer chill conversations\b/gi, "prefer quieter conversations")
    .replace(/\bit'?s pretty chill how\b/gi, "it's interesting how")
    .replace(/\bit'?s pretty chill\b/gi, "it's usually simple")
    .replace(/\bpretty chill stuff[.!]?/gi, "simple stuff.")
    .replace(/\bpretty chilly\b/gi, "cold")
    .replace(/\bpretty chill about it[.!]?/gi, "I do not worry about it too much.")
    .replace(/\bpretty chill to think about back then though[.!]?/gi, "I do not think about it much now.")
    .replace(/\bpretty chill over here[.!]?/gi, "I do not worry about it too much.")
    .replace(/\beveryone'?s pretty chill here[.!]?/gi, "everyone seems fine here.")
    .replace(/\s*Pretty chill overall though!?$/i, "")
    .replace(/\s*Pretty chill here[.!]?$/i, "")
    .replace(/,\s*pretty chill[.!]?$/i, ".")
    .replace(/\bpretty chill[.!]?$/i, "nothing too deep.")
    .replace(/\bpretty chill when\b/gi, "easier when")
    .replace(/\bis pretty chill\b/gi, "is convenient")
    .replace(/\bpretty chill topics\b/gi, "simple topics")
    .replace(/\bpretty chill though,\s*/i, "")
    .replace(/\bPretty straightforward!?$/i, "")
    .replace(/\bcan be mitigated by\b/gi, "can be reduced by")
    .replace(/\bto mitigate this,\s*/gi, "to reduce that, ")
    .replace(/\bcrucial for\b/gi, "important for")
    .replace(/\bindispensable\b/gi, "important")
    .replace(/\s+Kinda like how [^.?!]+[.?!]?$/i, "")
    .replace(/\s+Kind of been in a routine,?\.?$/i, "")
    .replace(/,\.$/g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();

  if (promptMode === "classroom" && countTelepromptWords(polished) > 42 && !looksLikeQuestion(transcript)) {
    const firstSentence = polished.match(/^.{1,260}?[.!?](?:\s|$)/)?.[0]?.trim();
    if (firstSentence && countTelepromptWords(firstSentence) >= 8) {
      polished = firstSentence;
    }
  }

  return polished || output;
}

function removeWrongNameEcho(output: string, transcript: string): string {
  if (!/\b(name|pronounce|pronunciation|called|correct me)\b/i.test(transcript) || !/\bdaewon\b/i.test(output)) {
    return output;
  }

  const filtered = output
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bdaewon\b/i.test(sentence))
    .join(" ")
    .trim();

  return filtered || "I'm good, thanks. My name is Xiang Li, but Xiang is fine.";
}

function replaceUnsupportedSayNextClaim(output: string, transcript: string): string {
  if (!/\b(saynext|say next|mobile app experience)\b/i.test(transcript)) {
    return output;
  }

  if (!/\b(reminder|reminders|daily task|daily tasks|task manager|manage their daily tasks|offline|offline sync|local storage|sync strategy|syncing it later|sync it later|multi-device|firebase sync|cross-platform code sharing|network instability)\b/i.test(output)) {
    return output;
  }

  if (/\bmobile app experience\b/i.test(transcript)) {
    return "My strongest mobile-related experience is from Hybrid Search Memory Assistant and DalParkAid. Hybrid Search Memory Assistant focuses on live transcripts, memory retrieval, scene profiles, prenotes, and local/travel modes. DalParkAid was a React Native parking app project, so I can talk about both AI-assisted mobile UX and normal app workflow.";
  }

  return "SayNext is a mobile real-time conversation assistant. The supported parts are live transcripts, response suggestions, scene profiles, prenotes, personal and knowledge memory retrieval, local Ollama mode, VPS/OpenAI travel mode, teleprompt controls, and response-quality testing.";
}

function replaceUnsupportedWorkExperienceClaim(output: string, transcript: string): string {
  if (/\b(i have not|i haven't|not used|not done|did not|didn't)\b/i.test(output)) {
    return output;
  }

  if (/\b(work|working|student|study)\b/i.test(transcript) && /\bi\s+work\s+as\s+(?:a\s+)?software\s+developer\b/i.test(output)) {
    return "I'm a MACS student at Dalhousie right now, basically Applied Computer Science.";
  }

  if (!/\b(internship at|internship with|during my internship|at a startup|at my company|at work|production team|my manager|senior engineer at work|worked on a team at)\b/i.test(output)) {
    return output;
  }

  if (/\blearn(?:ed)? something quickly\b/i.test(transcript)) {
    return "One example is from building SayNext. I had to learn how to handle real-time transcripts, memory retrieval, and local/VPS deployment while testing the app at the same time. I broke the problem into small parts, checked logs and behavior after each change, and used quick experiments to understand what was actually failing.";
  }

  if (/\bpressure|deadline\b/i.test(transcript)) {
    return "When I am under deadline pressure, I try to reduce the scope first and focus on the part that actually needs to work. In student projects, that usually means getting the core flow stable, testing the risky parts, and leaving nice-to-have features for later.";
  }

  if (/\bconflict|feedback|failure|trade-off|mistake|above and beyond|worked independently\b/i.test(transcript)) {
    return "A real example I can use is from SayNext. I had to make practical trade-offs around response quality, latency, local versus travel mode, and messy transcript handling. I learned to test the process instead of trusting one good-looking output, because real-time AI behavior can fail in small hidden ways.";
  }

  if (/\b(misunderstood|misread|message gets twisted|interpreted wrong|money decisions?|budget plan)\b/i.test(transcript)) {
    return "I would say people fear being misunderstood because one unclear sentence can make their judgment look worse than it is, especially around money or work decisions. The safer move is to state the context, the reason, and the next step clearly.";
  }

  return "I do not want to frame this as workplace experience. A real example I can talk about is from student and personal projects like SayNext, where I handled practical engineering problems, tested edge cases, and improved the design based on what actually broke.";
}

function replaceMeetingCompletedWorkClaim(output: string, transcript: string, eventMemory?: EventMemorySnapshot): string {
  const eventText = `${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();
  if (!/\b(group_discussion|meeting)\b/.test(eventText)) {
    return output;
  }

  if (/\bapi cost\b/i.test(transcript) && /\b(process every transcript|every transcript|too high)\b/i.test(transcript)) {
    return "We should not process every transcript the same way. I would filter for final or meaningful turns first, cache repeated context, and only run the stronger model when the transcript actually needs a response or memory extraction.";
  }

  if (/\bquick update\b/i.test(transcript) && !/\b(dynamodb|lambda|api gateway|s3|schema|upload|parking|joblens|elder)\b/i.test(eventText)) {
    return "I can give a quick update: I finished the current testing pass, I'm checking edge cases now, and the main blocker is making sure the response flow stays reliable with noisy transcripts.";
  }

  if (!/\b(i just resolved|i finished|i already fixed|i already tested|i implemented)\b/i.test(output)) {
    return output;
  }

  if (/\b(update|progress|finished|what did you finish|what have you done)\b/i.test(transcript)) {
    return output;
  }

  if (/\b(branch|merge conflict|conflict with.*main|latest main)\b/i.test(transcript)) {
    return "I should pull the latest main branch first, resolve the conflict in the smallest files possible, then run the app or tests before pushing. If it is messy, I would pause and ask which version should win instead of guessing.";
  }

  if (/\b(upload|deployment|staging|token|auth|api|schema|bug|blocker|not working|fails|failed)\b/i.test(transcript)) {
    return "I should verify the failing path first, check the logs and config, then make the smallest fix we can test before the next demo. I would not claim it is done until we confirm it works in the target environment.";
  }

  return "I should describe the next concrete step instead of saying it is already done. The safe move is to clarify the blocker, assign the owner, and test the smallest fix before the next meeting.";
}

function replaceGenericSpeakingProjectLeak(output: string, transcript: string, promptMode?: PromptMode): string {
  if (promptMode !== "casual" && promptMode !== "general") {
    return output;
  }
  if (isTechnicalOrProjectFollowup(transcript)) {
    return output;
  }
  if (/\b(hybrid search memory assistant|saynext|say next|joblens|elderalbum|elder album|dalparkaid|blood donation|ai meeting monitor)\b/i.test(transcript)) {
    return output;
  }
  if (!isGenericSpeakingPrompt(transcript)) {
    return output;
  }
  if (!/\b(saynext|say next|aws|lambda|dynamodb|cloud|project|workplace|production|at work|engineering problems|technical)\b/i.test(output)) {
    return output;
  }

  if (/\b(team(?:ed)? up|work(?:ed|ing)? with someone|working in a team)\b/i.test(transcript)) {
    return "Yeah, mostly in school or small group tasks. I’m not always the loudest person, but I can listen, split the work clearly, and follow through on my part.";
  }

  if (/\bconfident|confidence\b/i.test(transcript)) {
    return "Probably when I slowly figure out something that looked hard at first. It’s not a dramatic moment, but that feeling of, okay, I can actually do this, is pretty nice.";
  }

  if (/\badvice\b/i.test(transcript)) {
    return "One time I asked a friend for advice when I was not sure what to focus on. They helped me narrow it down, and honestly it made the decision feel way less messy.";
  }

  if (/\blearn(?:ed)? (?:a )?(?:new )?(?:skill|hobby)\b/i.test(transcript)) {
    return "One skill I tried to learn was music when I was younger. I was not super consistent with it, but it still gave me a nice feeling when I could actually play something properly.";
  }

  return "Yeah, I can use a normal life example for that, not a work story. Something small but real usually sounds more natural.";
}

export function replacePublicProjectName(output: string, transcript: string, promptMode?: PromptMode): string {
  if (!/\bSayNext\b/i.test(output)) {
    return output;
  }

  const publicFacing = promptMode === "interview"
    || /\b(project|bug|failure|trade[-\s]?off|above and beyond|worked independently|presentation|candidate|resume|explain|walk me through)\b/i.test(transcript);
  if (!publicFacing) {
    return output;
  }

  return output
    .replace(/\bSayNext's\b/g, "the Hybrid Search Memory Assistant's")
    .replace(/\bSayNext\b/g, "Hybrid Search Memory Assistant");
}

function trimForcedReturnQuestion(output: string, transcript: string): string {
  if (!/[?？]\s*$/.test(output)) {
    return output;
  }
  if (/\b(what should i ask|question should i ask|return it|receipt|final sale|could i|can i|should i say)\b/i.test(transcript)) {
    return output;
  }
  if (!/[.!]\s+\S/.test(output)) {
    return output;
  }

  let trimmed = output.trim();
  const trailingFillerQuestion = /\s+(?:How about you(?:, [A-Za-z]+)?|What about you|Have you [^?？.]{0,80}|Any games [^?？.]{0,80}|Can I help you with anything else|Is there someone else I can reach|What'?s next on the agenda|Or something else|What did you want to talk about|Anything refreshing to drink|Why do you ask|Everything okay|Anything urgent|What'?s going well today|How'?s it going|What do you think|right|huh)[?？.]$/i;
  for (let i = 0; i < 3; i += 1) {
    const next = trimmed.replace(trailingFillerQuestion, ".").replace(/\.\.+$/g, ".").trim();
    if (next === trimmed) break;
    trimmed = next;
  }
  return trimmed;
}

function trimForcedReturnQuestionV2(output: string, transcript: string): string {
  const embeddedFillerQuestion = /\s+(?:How about you[^?\uFF1F.]{0,80}|What about you[^?\uFF1F.]{0,80}|Anything fun you'?ve been into|Got any plans|Got any fun plans|Got anything fun planned|Got anything fun lined up|What kind of dish are you making|Want to talk about it|Maybe there'?s some confusion|What'?s up)[?\uFF1F]\s*/i;
  const trailingFillerPeriod = /\s+(?:What'?s next on (?:our )?(?:chat|conversation)|What'?s your go-to spot[^.]{0,80}|Anything to drink around here|Is there someone else I can help you find|Maybe having water nearby helps|Maybe try another pair|Maybe you collect coins|How was your day|Why are you asking)[.]$/i;
  if (!/[?\uFF1F][.!。！]?\s*$/.test(output) && !trailingFillerPeriod.test(output.trim()) && !embeddedFillerQuestion.test(output)) {
    return output;
  }
  if (/\b(what should i ask|question should i ask|return it|receipt|final sale|could i|can i|should i say)\b/i.test(transcript)) {
    return output;
  }
  if (!/[.!]\s+\S/.test(output)) {
    return output;
  }

  let trimmed = output.trim();
  trimmed = trimmed.replace(embeddedFillerQuestion, " ").replace(/\s{2,}/g, " ").trim();
  const trailingFillerQuestion = /\s+(?:How about you[^?\uFF1F.]{0,80}|What about you[^?\uFF1F.]{0,80}|Have you(?: [^?\uFF1F.]{0,80})?|Do you [^?\uFF1F.]{0,80}|Are you into sports or anything like that|Any games [^?\uFF1F.]{0,80}|Any movie recommendations|Anything specific you'?re [^?\uFF1F.]{0,80}|Any specific way you want the chicken cut|Any other tips|Can I help you with anything else|Do you need help with anything else|Need anything else|Or do you need help with anything else|Could you repeat it|Can you say that again|What was the last part|What were you saying[^?\uFF1F.]{0,80}|Is there someone I can help you with|Is there someone else I can reach|Is there someone else I can help you find|What'?s next on (?:the agenda|our chat|our conversation)|What'?s your go-to (?:spot|show)[^?\uFF1F.]{0,80}|Or something else|What did you (?:want to talk about|need help with)|What are you guys up to|Any blockers for me to be aware of|Anything refreshing to drink|Anything to drink around here|What kind of dish are you making|Favorite mountain spot|Maybe we should [^?\uFF1F.]{0,120}|Maybe there'?s some confusion|Maybe having water nearby helps|Maybe try another pair|Maybe you collect coins|Got any fun plans|Got anything fun lined up|Any questions about that|Does that help clarify|Just calling you Doctor[^?\uFF1F.]{0,80}|Want to talk about it|Are you feeling okay|Why do you ask|Why are you asking|Everything okay|Anything urgent|What'?s going well today|How'?s it going|How was your day|What do you think|How about we call it a night|Let'?s (?:just )?forget about it and grab some takeout instead|Tall too|right|huh|you know)[?\uFF1F.]$/i;
  for (let i = 0; i < 3; i += 1) {
    const next = trimmed.replace(trailingFillerQuestion, ".").replace(/[?\uFF1F]\.+$/g, ".").replace(/\.\.+$/g, ".").trim();
    if (next === trimmed) break;
    trimmed = next;
  }
  trimmed = trimmed.replace(/\s+(?:What|Why)\.$/i, ".").replace(/\.\.+$/g, ".").trim();
  return trimmed;
}

function replaceUnsupportedDailySpecificClaim(output: string, transcript: string, promptMode?: PromptMode): string {
  if (promptMode !== "casual" && promptMode !== "general" && promptMode !== "interview") {
    return output;
  }

  const riskyOutput = /\b(cozy apartment|big window|couch|game nights?|gaming night|board games|pizza|sushi|favorite gaming controller|gaming headset|custom settings|black coffee|hot tea|piggy banks?|parking meters?|vending machines?|little corner store|corner store|coffee shops?|barista|usual order|noodle shop|owner knows me|extra veggies|victoria park|small park near my|peggy'?s cove|mountain in alberta|blew my mind|fresh air|spring garden road|pop atlantic|music festival|food vendors?|live music stages?|sunset|see the ocean|ocean in the distance|clear days|homebody like me|squirrels?|chipmunks?|ducks?|pond|picnic|pax|gaming conventions?|poster|genshin impact characters|detective conan|scarlet bullet|game of thrones|breaking bad|the boys|animated series|recently watched|pretty shy when i was little|participation in a coding competition|coding competition once|award for participation|favorite sichuan pepper grinder|friend'?s place|my friend alex|nose-deep|i know someone who|workshop|wooden frame|making everything from scratch|became a doctor|sister with her math homework|couple of hours|silly jokes|left it there by accident|mailed it back|called them to ask|librar(?:y|ies)|unknown number|wrong number|basketball together|different colleges|last year|spring festival|chinatown|lanterns?|dim sum|five main roads|residential streets|share them with friends|escrow|home stretch|playing some guitar|play guitar|guitar)\b/i.test(output);
  const additionalRiskyOutput = /\b(bookmarks and notes|last chapter|book recommendations|whipping through novels|non-fiction|cozy living room|balcony|near good food spots|parks too|games and books|halifax city center|harbor|crane my neck|green space if i crane|point pleasant park|friend from high school named alex|named alex|reconnected on social media|old friend from high school|indoor kid|for lunch today|fried chicken and soda|complex programming assignment last semester|gone fishing|went fishing|go fishing|by the lake|catch something|couple of times with my family back in chengdu)\b/i.test(output);
  const unsupportedStoryShape = /\b(describe|tell me about|time when|occasion|person who|family member|helped your family|place where|place in your city|photo|picture|view|crowded|good service|lost|valuable item|answered a phone|career in the medical|read a lot|make things by hand)\b/i.test(transcript)
    && /\b(I once|one time|there was this one|this local|my friend|I know someone|I have this|last time|last year|near my|at a coffee shop|at the library|in Chinatown|at Peggy'?s Cove)\b/i.test(output);
  if (!riskyOutput && !additionalRiskyOutput && !unsupportedStoryShape) {
    return output;
  }

  if (/\b(ideal|perfect)\b/i.test(transcript) && /\b(place|house|apartment|stay|live)\b/i.test(transcript)) {
    return "Probably somewhere quiet, private, and comfortable, with enough space for my computer setup. I care more about freedom and low pressure than a fancy place.";
  }

  if (/\b(lost|lose)\b/i.test(transcript) && /\b(valuable|item|thing)\b/i.test(transcript)) {
    return "I do not remember one dramatic valuable item I lost. Usually it is smaller stuff, and I just get annoyed for a while and try to find a practical replacement.";
  }

  if (/\b(did you like to talk|talk with others|talk to others)\b/i.test(transcript) && /\b(child|kid|little)\b/i.test(transcript)) {
    return "When I was very young, I was actually pretty lively and naughty. I became much quieter later, probably around middle school.";
  }

  if (/\b(prize|award|won|received)\b/i.test(transcript)) {
    return "I have not won any big prize that I would confidently talk about. I would keep it honest and say I am more proud of finishing real projects than receiving awards.";
  }

  if (/\b(small shop|store|shop)\b/i.test(transcript) && /\b(often|usually|go to)\b/i.test(transcript)) {
    return "I usually go to Superstore for normal groceries, or KFC and Mary Brown's when I just want fried chicken. Nothing fancy, just convenient.";
  }

  if (/\b(coffee)\b/i.test(transcript)) {
    return "No coffee for me, thanks. Water is fine.";
  }

  if (/\bperfume\b/i.test(transcript)) {
    return "Not really. I do not wear perfume much, so I would not make a big story out of it.";
  }

  if (/\b(chops)\b/i.test(transcript) && /\b(guitar|playing)\b/i.test(output)) {
    return "I'm good, thanks. Nothing special, just getting through the day.";
  }

  if (/\b(good service|service from a company|service from a shop)\b/i.test(transcript)) {
    return "I do not have one special service story I would confidently use. A safer answer is that I appreciate simple, efficient service, like when staff explain things clearly and do not make the process stressful.";
  }

  if (/\b(make things by hand|craft|toy|furniture)\b/i.test(transcript)) {
    return "I do not have a specific person story for that. I would describe it generally: people who make things by hand are usually patient and good at turning ideas into something real.";
  }

  if (/\b(person who likes to read|read a lot)\b/i.test(transcript)) {
    return "I do not have a specific person in mind, so I would describe this generally: someone who reads a lot is usually patient, curious, and able to focus for a long time.";
  }

  if (/\b(medical field|doctor|medicine|career in the medical)\b/i.test(transcript)) {
    return "I do not have a specific person story for that. I would answer generally: people who choose medicine usually need patience, responsibility, and a real willingness to deal with pressure.";
  }

  if (/\b(phone call|unknown number|public place)\b/i.test(transcript)) {
    return "I do not remember one clear story about this. In general, if I got an unknown call in public, I would probably answer quietly and keep it short.";
  }

  if (/\b(crowded place|crowded)\b/i.test(transcript)) {
    return "I do not have one dramatic crowded-place story. I would probably talk about a mall or supermarket when it gets busy, because I do not really enjoy crowded places.";
  }

  if (/\bfishing|go fishing|gone fishing|went fishing\b/i.test(transcript)) {
    return "I have not really gone fishing much. I like the idea of quiet outdoor stuff, but most of my free time is still games, anime, or staying inside.";
  }

  if (/\b(helped your family|family member|sister|brother|mother|mom)\b/i.test(transcript)) {
    return "I do not have one specific family-help story I would confidently use. A safer answer is that I usually help in small practical ways when family needs something, but I am not very expressive about it.";
  }

  if (/\b(photo|picture)\b/i.test(transcript) && /\b(home|room)\b/i.test(transcript)) {
    return "I do not have one specific photo or poster at home that I would confidently describe. I would keep it simple and say I care more about my computer setup and private space.";
  }

  if (/\b(cultural place|culture)\b/i.test(transcript)) {
    return "I would probably choose Japan because I am interested in the language, food, games, and anime culture. I have not been there yet, so I would keep it as something I want to learn about.";
  }

  if (/\b(study|favorite place to study|where do you study)\b/i.test(transcript)) {
    return "I do not really have a favorite study place. I usually just need somewhere quiet, with internet, and not too many distractions.";
  }

  if (/\b(coins?|coin)\b/i.test(transcript)) {
    return "Not really. I do not use coins much now, and I would not make a big story out of it.";
  }

  if (/\b(view|unforgettable view|seen anything)\b/i.test(transcript)) {
    return "I do not have one unforgettable view that clearly stands out. I usually like quieter views, like water, trees, or a calm street, more than crowded tourist spots.";
  }

  if (/\b(road|roads|neighborhood|neighbourhood)\b/i.test(transcript)) {
    return "I do not know the exact number of roads around my place. The area is fairly quiet and residential.";
  }

  if (/\b(park|garden|wild animals?|animal|nature|place in your city)\b/i.test(transcript)) {
    return "I would keep it general: I like quiet places that are not too crowded, with some trees or space to walk. I do not have one specific animal or park story I would confidently use.";
  }

  if (/\b(films?|movies?)\b/i.test(transcript) && /\b(watched|recently|describe)\b/i.test(transcript)) {
    return "I do not have one recent film that stands out. I usually watch anime or videos more casually, so I would rather not make up a specific title.";
  }

  if (/\b(films?|movies?|tv shows?|watch|watched|streaming|anime|videos?)\b/i.test(transcript)) {
    return "I mostly watch anime or online videos casually. I would not name a specific film or show unless I clearly remember it.";
  }

  if (/\b(food|eat|favorite type of food)\b/i.test(transcript)) {
    return "Yeah, it is hard to pick one. I usually like Chinese food, fried chicken, curry, and malatang, depending on what is convenient.";
  }

  if (/\btraditional food|traditional festival|special event\b/i.test(transcript) && /\b(country|china|chinese)\b/i.test(transcript)) {
    return "For China, I would probably say zongzi during Dragon Boat Festival. It is sticky rice wrapped in bamboo leaves, sometimes with meat or red bean.";
  }

  if (/\b(party|parties)\b/i.test(transcript)) {
    return "I do not really go to many parties. If I hang out, it is usually something quieter, like food, games, or just talking with a small group.";
  }

  if (/\b(old friend|contact|got in contact|reconnect)\b/i.test(transcript)) {
    return "I can talk about old friends generally, but I should not invent a reunion story. A safer answer is that some friendships faded after school because people went to different places.";
  }

  if (/\b(free time|spare time|relax)\b/i.test(transcript)) {
    return "In my free time, I usually stay home, play games, watch anime or videos, and just enjoy having quiet time without pressure.";
  }

  if (/\b(escrow|home stretch)\b/i.test(output)) {
    return "It sounds like they are close to finishing the transaction, but they should double-check the details before assuming it is done.";
  }

  return output;
}

function replaceUnsafePlaceholderOutput(output: string, transcript: string): string {
  if (!/\bX\s+(?:is|completed|done)|\bY\s+(?:is|completed|done)|\b(?:X|Y|Z)\s+(?:sources?|items?|events?|parts?)\b|\b(?:happened is|coming from)\s+(?:X|Y)\b|\bZ\b|\[(?:insert|date|details?|time|number|confirmed|unconfirmed|items?|sources?|timestamps?)[^\]]*\]/i.test(output)) {
    return output;
  }

  if (/\b(status|progress|owner|done|completed|expect|when|deadline|timeline|time)\b/i.test(transcript)) {
    return "I do not have the exact status yet. I would ask the owner for one concrete update and a realistic time before we report it.";
  }

  return "I do not have the exact detail yet, so I would confirm it first instead of guessing.";
}

function replaceUnhelpfulNoAction(output: string, transcript: string): string {
  if (!/^no action needed yet[.!]?$/i.test(output.trim())) {
    return output;
  }

  if (!looksLikeQuestion(transcript) && !/\b(next step|check|confirm|verify|source|risk|what should|how should|can you|could you|define|in writing|write|plan|affect|how does|what is|what are|response window|escalation|schedule)\b/i.test(transcript)) {
    return output;
  }

  if (/\b(source|verify|misinformation|news|reputable|original)\b/i.test(transcript)) {
    return "I would check the original source first, then compare it with a couple of reputable outlets before treating it as true.";
  }

  if (/\b(status|progress|owner|done|completed)\b/i.test(transcript)) {
    return "I would ask for one concrete status line: what is done, what is blocked, and who owns the next step.";
  }

  if (/\b(response window|escalation|pressure|in writing|define)\b/i.test(transcript)) {
    return "I would define the response window, escalation path, and decision owner in writing first, so pressure does not create random expectations.";
  }

  return "I would clarify the key detail first, then answer based on what is actually confirmed.";
}

function outputLooksLikeTechnicalAvoidance(output: string): boolean {
  return /\b(normal life example|life example|everyday example|not a work story|not a workplace story|small but real|generic example|use a simple story)\b/i.test(output);
}

function outputLooksLikeMacroNewsTemplate(output: string): boolean {
  return /\b(inflation, jobs, and future rates|higher rates for longer|hawkish|dovish|fed wording|market reaction)\b/i.test(output);
}

function outputLooksLikeMediaPreferenceTemplate(output: string): boolean {
  return /\b(anime|videos?|films?|movies?|shows?|soundtrack|track titles?|streaming)\b/i.test(output)
    && /\b(casually|usually watch|do not name|don't name|would not name|not force a specific|clearly remember|offhand)\b/i.test(output);
}

function outputLooksLikePersonalPresentationStory(output: string): boolean {
  return /\b(presentation|phone translator|translation|looked very nervous|language barrier|early high school|stood there|froze)\b/i.test(output)
    && /\b(canada|translator|nervous|embarrassed|not smooth|wasn'?t ready|was not ready)\b/i.test(output);
}

function outputLooksLikeUnverifiedHealthStudyClaim(output: string): boolean {
  return /\b(study|research|gut microbiome|microbiome|fiber|pectin|potassium|nutrition|athletes?)\b/i.test(output)
    && /\b(support|shows?|suggests?|basically|plausible|good for)\b/i.test(output);
}

function outputLooksLikeAllergenList(output: string): boolean {
  return /\b(nuts|peanuts?|shellfish|dairy|eggs|wheat|gluten|soy|sesame)\b/i.test(output)
    && /\b(allergy|allergies|allergen|avoid|substitution|order|safe)\b/i.test(output);
}

function outputLooksLikeApiDebugTemplate(output: string): boolean {
  return /\b(aws 403|api gateway|authorizer|jwt claims?|lambda logs?|iam|resource policy|request id|route policy)\b/i.test(output);
}

function transcriptAsksForSourceSafeMechanism(transcript: string): boolean {
  return /\b(kubernetes|open[- ]source|environmental|supply chain|study|research|news|latest|source|evidence|benchmark|metric)\b/i.test(transcript);
}

function transcriptHasHighRiskLegalFrame(transcript: string): boolean {
  if (/\b(interface contract|api contract|core contract|downstream contract|contract do we expose|contract should we expose)\b/i.test(transcript)) {
    return false;
  }
  return /\b(legal|liability|liable|contract|consent|lawsuit|lawyer|official record|policy)\b/i.test(transcript)
    || /\b(civil rights|tenant rights|privacy rights|legal rights|human rights)\b/i.test(transcript);
}

function outputLooksTooCasualForRisk(output: string): boolean {
  return /\b(vibes?|kinda|pretty chill|not your legal standing|automatically have a lawsuit|just judge|usually isn'?t|usually is not|definitely|for sure)\b/i.test(output);
}

function replaceRiskyOverconfidentOutput(output: string, transcript: string): string {
  if (!transcriptHasHighRiskLegalFrame(transcript)) {
    return output;
  }

  if (!outputLooksTooCasualForRisk(output)) {
    return output;
  }

  if (/\b(consent|data handling|personal data|privacy)\b/i.test(transcript)
    && !/\b(legal liability|liable|lawsuit)\b/i.test(transcript)) {
    return "I would keep it cautious: get clear consent, use only the minimum personal data, document who can access it, and avoid promising certainty until the details are verified.";
  }

  return "I would be careful not to make a legal conclusion there. I would frame it as: awkwardness can affect trust, consent, or documentation, but I would verify the actual legal point before making a strong claim.";
}

function replaceMisdirectedTemplateOutput(output: string, transcript: string): string {
  if (/\bsecure tea\b/i.test(output) && /\bsecure tea\b/i.test(transcript)) {
    return "I would clarify that term first. If 'secure tea' means quiet hours or security, we should define it, then compare the exact start and stop times before assigning the cause.";
  }

  if (outputLooksLikeApiDebugTemplate(output)
    && !/\b(api|aws|403|forbidden|serverless|lambda|logs?|request id|endpoint|debug|bug|auth|iam)\b/i.test(transcript)
    && /\b(panic|presentation|presenting|spoke|speak|mid[-\s]?sentence|froze|freeze|translator|words)\b/i.test(transcript)) {
    return "It spiked right before I spoke, because I knew my English might not keep up. Mid-sentence it got worse when I had to rely on the translator, so I slowed down and tried to finish one clear point.";
  }

  if (outputLooksLikeTechnicalAvoidance(output) && isTechnicalOrProjectFollowup(transcript)) {
    if (/\b(serverless|lambda|function|api|service)\b/i.test(transcript)
      && /\b(trace|tracing|logs?|request id|invocation|where do you start)\b/i.test(transcript)) {
      return "I would start with one invocation or request ID, check the trigger payload, error status, Lambda logs in CloudWatch, downstream retries and timeouts, then reproduce with a known-good request.";
    }

    if (/\bdynamodb\b/i.test(transcript) && /\b(partition key|throttle|reads?|hot partition|access pattern)\b/i.test(transcript)) {
      return "If the partition key is poor, reads can hot-spot and throttle. I would check consumed capacity by key, CloudWatch throttles, and whether the access pattern needs a better key or GSI.";
    }

    if (/\b(open[-\s]?source|contribution|contributed|github|pull request|pr\b|repository)\b/i.test(transcript)) {
      return "I would not claim a major open-source contribution if I do not have one. I would frame JavaScript as project experience: building apps, fixing bugs, connecting APIs, and writing small tests.";
    }

    if (/\b(interface contract|contract do we expose|contract should we expose|downstream contract)\b/i.test(transcript)) {
      return "I decided by locking the smallest status contract: id, state, owner, error states or errorCode, retryable, and fallback behavior. The edge cases I logged were missing required fields, invalid state changes, failed retries, and silent-fallback attempts.";
    }

    if (/\b(regression|edge users?|edge cases?|test cases?|rerun|re-run|release|before each release)\b/i.test(transcript)) {
      return "For regression cases, I would cover edge users like missing data, unusual inputs, slow network, and first-time users, then rerun those cases before each release or major prompt change.";
    }

    return "I would answer the technical question directly: explain the concrete mechanism, mention what I actually did, and avoid turning it into a generic life example.";
  }

  if (outputLooksLikeTechnicalAvoidance(output)
    && /\b(career fair|feedback|next step|next step checklist|specific feedback|what feedback)\b/i.test(transcript)) {
    return "I would answer the feedback directly: the message was too generic, so the next step is to make one concrete project example clearer, update the wording, and practice a short version.";
  }

  if (outputLooksLikeMacroNewsTemplate(output) && !/\b(fed|market|stock|inflation|rate|hawkish|dovish)\b/i.test(transcript)) {
    if (/\bjava script|javascript\b/i.test(transcript)) {
      return "If you mean JavaScript, I would say it as JavaScript and confirm whether you mean the programming language or the exact wording.";
    }
    return "I would confirm the exact wording in this context first, instead of borrowing language from a different topic.";
  }

  if (outputLooksLikeMediaPreferenceTemplate(output) && /\b(dream|movie|scope|timeline|film|scene)\b/i.test(transcript)) {
    return "For the movie idea, I would keep it simple: one main feeling, one setting, and one short scene, then decide the timeline after the concept is clear.";
  }

  if (outputLooksLikeMediaPreferenceTemplate(output) && /\b(elderalbum|elder album|lambda|tags?|trigger|kubernetes|open[- ]source|environmental|supply chain)\b/i.test(transcript)) {
    if (/\b(elderalbum|elder album|lambda|tags?|trigger)\b/i.test(transcript)) {
      return "For ElderAlbum, I would describe the upload pipeline: an S3 upload triggers Lambda, Lambda extracts or stores metadata, and the UI reads the tags from the database.";
    }

    if (/\b(kubernetes|open[- ]source|environmental|supply chain)\b/i.test(transcript)) {
      return "I would not name a specific open-source project without a source. I would explain the mechanism instead: disruption can increase waste or over-provisioning, but measurable harm needs real data.";
    }

    return "I would answer the technical question directly instead of switching to media examples.";
  }

  if (outputLooksLikePersonalPresentationStory(output)
    && /\b(highest[- ]impact|priority|prioritize|under pressure|task)\b/i.test(transcript)) {
    return "Under pressure, I decide the highest-impact task by asking what blocks the core goal first, what has the biggest risk, and what unblocks other people. Then I pick one concrete next step.";
  }

  if (outputLooksLikePersonalPresentationStory(output) && /\b(genshin|track|tracks|music|soundtrack|timestamp|title)\b/i.test(transcript)) {
    return "I do not know the exact track titles and timestamps offhand. I would say I like Genshin's instrumental and orchestral music, but I would check the official list before naming anything.";
  }

  if (outputLooksLikeUnverifiedHealthStudyClaim(output)
    && /\b(study|research|gut microbiome|microbiome|potassium|nutrition|athletes?)\b/i.test(transcript)) {
    return "I have not checked that study myself, so I would frame it carefully. A safe version is: apples have fiber and bananas have potassium, but I would verify the actual study before making a strong health claim.";
  }

  if (outputLooksLikeAllergenList(output) && /\b(allergy|allergies|allergen|substitution|order)\b/i.test(transcript)) {
    return "For me, I do not have food allergies. If this is for other people, we should ask them directly instead of guessing.";
  }

  if (outputLooksLikeMediaPreferenceTemplate(output) && transcriptAsksForSourceSafeMechanism(transcript)) {
    return "I would not switch to personal media examples here. I would explain the mechanism, name what evidence is missing, and avoid claiming a specific source unless I can verify it.";
  }

  return output;
}

export function finalizeSayNextOutput(text: string, transcript: string, outputLanguage: OutputLanguage, eventMemory?: EventMemorySnapshot, promptMode?: PromptMode): string {
  const cleaned = sanitizeSayNextOutput(text);
  const withoutIdentityClaim = removeUnsupportedIdentityClaim(cleaned, transcript);
  const withoutWrongNameEcho = removeWrongNameEcho(withoutIdentityClaim, transcript);
  const withoutUnsupportedSayNext = replaceUnsupportedSayNextClaim(withoutWrongNameEcho, transcript);
  const withoutUnsupportedWork = replaceUnsupportedWorkExperienceClaim(withoutUnsupportedSayNext, transcript);
  const withoutUnsupportedTeacher = replaceUnsupportedFavoriteTeacherClaim(withoutUnsupportedWork, transcript);
  const withoutUnsupportedNamedHypothetical = replaceUnsupportedNamedHypotheticalClaim(withoutUnsupportedTeacher, transcript);
  const withoutOpenCoursewareMisread = replaceOpenCoursewareProjectMisread(withoutUnsupportedNamedHypothetical, transcript);
  const withoutLongSmallProject = shortenSmallProjectAnswer(withoutOpenCoursewareMisread, transcript);
  const withoutCompletedWorkClaim = replaceMeetingCompletedWorkClaim(withoutLongSmallProject, transcript, eventMemory);
  const withoutGenericProjectLeak = replaceGenericSpeakingProjectLeak(withoutCompletedWorkClaim, transcript, promptMode);
  const withoutPublicRoleplay = replacePublicTranscriptRoleplay(withoutGenericProjectLeak, transcript, eventMemory);
  const withoutPublicLeak = removePublicTranscriptPersonalLeak(withoutPublicRoleplay, eventMemory);
  const withoutUnsupportedDailySpecifics = replaceUnsupportedDailySpecificClaim(withoutPublicLeak, transcript, promptMode);
  const withoutChineseEnglishClarification = replaceChineseEnglishClarification(withoutUnsupportedDailySpecifics, transcript);
  const withoutPublicProjectName = replacePublicProjectName(withoutChineseEnglishClarification, transcript, promptMode);
  const withoutMisdirectedTemplate = replaceMisdirectedTemplateOutput(withoutPublicProjectName, transcript);
  const withoutRiskOverclaim = replaceRiskyOverconfidentOutput(withoutMisdirectedTemplate, transcript);
  const withoutPlaceholder = replaceUnsafePlaceholderOutput(withoutRiskOverclaim, transcript);
  const withoutNoAction = replaceUnhelpfulNoAction(withoutPlaceholder, transcript);
  const withoutForcedQuestion = trimForcedReturnQuestionV2(withoutNoAction, transcript);
  const polished = polishPersonaSayability(withoutForcedQuestion, transcript, promptMode);
  return enforceOutputLanguage(polished, transcript, outputLanguage);
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

export function extractOutputField(text: string): string | null {
  const match = text.match(/"output"\s*:\s*"((?:\\.|[^"\\])*)/i);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(`"${match[1].replace(/\\?$/, "")}"`);
  } catch {
    return match[1].replace(/\\"/g, '"').trim();
  }
}
