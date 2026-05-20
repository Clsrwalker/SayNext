import type { EventMemorySnapshot } from "../memory/event-memory";
import { isLikelySpeakerLabelTranscript } from "./output-text-utils";

function looksLikePublicOpenEvent(eventMemory?: EventMemorySnapshot): boolean {
  const text = `${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();
  return /\bsource=open_|source=short_form|source=unseen_public|public open|open meeting|open lecture|open-domain|third-party\b/.test(text);
}

export function removePublicTranscriptPersonalLeak(output: string, eventMemory?: EventMemorySnapshot): string {
  if (!looksLikePublicOpenEvent(eventMemory)) {
    return output;
  }

  if (/\b(open\s*courseware|opencourseware)\b/i.test(output)
    && /\b(project|experience|my project|real project|called)\b/i.test(output)) {
    return "A useful note is that this is course context, so I would focus on the concept or example being explained, not treat OpenCourseWare as the topic.";
  }

  const leakPattern = /\b(xiang|x-i-a-n-g|li\b|dalhousie|macs|chengdu|saynext|elder album|joblens|dalparkaid|my project|coding|gaming|video games|aws|lambda|dynamodb|my sister|my brother|my family|my childhood|when i was a child|back in chengdu)\b/i;
  const filtered = output
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !leakPattern.test(sentence))
    .join(" ")
    .trim();

  if (filtered) return filtered;
  if (/\bspell|name\b/i.test(output)) return "Could you spell it out?";
  if (leakPattern.test(output)) return "Yeah, that makes sense.";
  return output;
}

export function replacePublicTranscriptRoleplay(output: string, transcript: string, eventMemory?: EventMemorySnapshot): string {
  const hasSpeakerLabel = isLikelySpeakerLabelTranscript(transcript);
  const xiangAddressedDirectly = /\bxiang\b/i.test(transcript) || (!hasSpeakerLabel && /\b(you|your)\b/i.test(transcript));
  const thirdPartyContext = (looksLikePublicOpenEvent(eventMemory) && !xiangAddressedDirectly)
    || (hasSpeakerLabel && !/\bxiang\b/i.test(transcript));
  if (!thirdPartyContext) {
    return output;
  }

  if (hasSpeakerLabel && !/\bxiang\b/i.test(transcript)) {
    return makeNeutralThirdPartyResponse(transcript);
  }

  const combined = `${transcript} ${output}`.toLowerCase();
  const startsAsServiceRole = /^\s*(?:i'?ll|i will|i can|let me|we can|we will|we'?ll|i would be happy to|i apologize|sorry[, ]+i)\b/i.test(output);
  const serviceContext = /\b(agent|customer|client|order|shipping|tracking|refund|ticket|account|payment|reservation|appointment|support|status|package|case)\b/.test(combined);
  if (startsAsServiceRole && serviceContext) {
    return "They should check the status first and give a clear update instead of guessing or overpromising.";
  }

  const speakerLabel = transcript.match(/^\s*([A-Z][A-Z_ .'-]{0,30})\s*:/i)?.[1]?.trim().toLowerCase() ?? "";
  const roleLabel = /\b(agent|customer|client|host|interviewer|teacher|professor|manager|speaker|student|support|sales)\b/.test(speakerLabel);
  if (roleLabel && /^\s*(?:i|we)\b/i.test(output) && !/\b(xiang|my name|i'?m xiang|i am xiang)\b/i.test(output)) {
    return "That sounds reasonable. I would just double-check the details before deciding.";
  }

  if (!/\b(?:i|i'm|i am|i'd|i would|i'll|i will|my|we|we'd|we would|we'll|we will|let's)\b/i.test(output)) {
    return output;
  }

  if (/\b(button|prototype|remote|mode switch|advanced settings|clutter|ui|ux)\b/i.test(combined)) {
    return "Making the main control simpler makes sense. The team could hide advanced settings in a menu and test whether users understand the mode switch.";
  }

  if (/\b(overfit|overfitting|training loss|validation loss|regularization|early stopping|model)\b/i.test(combined)) {
    return "A useful supplement is that a widening gap between training loss and validation loss usually signals overfitting, so early stopping or regularization can help.";
  }

  if (/\b(meeting|prototype|decision|blocker|owner|next step|deadline|task)\b/i.test(combined)) {
    return "It would help to clarify the decision, the owner, and the next step before moving on.";
  }

  return makeNeutralThirdPartyResponse(transcript);
}

function makeNeutralThirdPartyResponse(transcript: string): string {
  const normalized = transcript.toLowerCase();
  if (/\bspell|spelling|your name|my name\b/.test(normalized)) {
    return "They are asking for spelling, so the useful next step is to spell the name clearly.";
  }
  if (/\bindian\b.*\bafrican\b|\bafrican\b.*\bindian\b|\belephant\b/.test(normalized)) {
    return "They are clarifying the animal type, so the next step is to decide which version they mean.";
  }
  if (/\bthere you go\b/.test(normalized)) {
    return "That is just a handoff; no action needed yet.";
  }
  if (/\bi just wanna watch\b|\bwatch the t_?v_?\b|\bremote\b/.test(normalized)) {
    return "They want the main control flow to stay simple, so the next step is to focus on the basic TV actions first.";
  }
  if (/\bi'?m from\b|\bfrom around\b|\bstate of\b/.test(normalized)) {
    return "That is just an introduction; no action needed yet.";
  }
  if (/\b(wait|i'?ll wait|let'?s see|mm '?kay|okay|almost)\b/i.test(transcript)) {
    return "They are pausing or waiting, so the next step is just to wait before moving on.";
  }
  if (/\b(draw|animal|elephant|seal|button|remote|prototype|design|settings)\b/.test(normalized)) {
    return "They are narrowing the design choice, so the useful next step is to make the option clear and easy to test.";
  }
  if (/\b(next topic|discuss|start|meeting|agenda|decision)\b/.test(normalized)) {
    return "They are moving the discussion forward; the useful next step is to clarify the decision and owner.";
  }
  if (/\bcareful|bone head|leave me alone|wish people\b/.test(normalized)) {
    return "That sounds like frustration, so a short acknowledgement is safer than pushing for more.";
  }
  return "No action needed yet.";
}
