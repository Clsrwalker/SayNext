import type { AiCue } from "./types";

function firstText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return "";
}

export function cueExplanationText(cue: AiCue): string {
  return firstText(cue.explanation, cue.fullAnswer, cue.preview);
}

export function cueCodeText(cue: AiCue): string {
  return firstText(cue.code, cue.output).replace(/\r\n?/g, "\n");
}

export function cueFullText(cue: AiCue): string {
  if (cue.category === "code") {
    return [cueExplanationText(cue), cueCodeText(cue)].filter(Boolean).join("\n\n");
  }
  return firstText(cue.fullAnswer, cue.output, cue.preview);
}
