import type { AiCue, CueCategory } from "./types";

export const CUE_CATEGORY_ORDER: CueCategory[] = ["concept", "response", "suggestion", "person", "code"];

export function groupCuesByCategory(cues: AiCue[]): Record<CueCategory, AiCue[]> {
  return {
    concept: cues.filter((cue) => cue.category === "concept"),
    response: cues.filter((cue) => cue.category === "response"),
    suggestion: cues.filter((cue) => cue.category === "suggestion"),
    person: cues.filter((cue) => cue.category === "person"),
    code: cues.filter((cue) => cue.category === "code"),
  };
}
