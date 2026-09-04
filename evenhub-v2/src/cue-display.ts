import type { AiCue } from "./types";

function firstText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return "";
}

export function cueCodeText(cue: AiCue): string {
  return firstText(cue.code, cue.output).replace(/\r\n?/g, "\n");
}

export function cueFullText(cue: AiCue): string {
  if (cue.category === "code") {
    return cueCodeText(cue);
  }
  return firstText(cue.fullAnswer, cue.output, cue.preview);
}
