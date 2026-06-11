import type { CueCategory } from "./types";

export const PHONE_CUE_LABEL: Record<CueCategory, string> = {
  response: "回应",
  concept: "概念",
  suggestion: "建议",
  person: "人物介绍",
};

export const G2_CUE_PREFIX: Record<CueCategory, string> = {
  concept: "▤",
  response: "?",
  suggestion: "◇",
  person: "○",
};

export function formatG2CueTitle(category: CueCategory, title: string): string {
  return `${G2_CUE_PREFIX[category]} ${title}`;
}
