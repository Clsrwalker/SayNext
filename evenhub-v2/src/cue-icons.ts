import type { CueCategory } from "./types";

export const PHONE_CUE_LABEL: Record<CueCategory, string> = {
  response: "\u56de\u5e94",
  concept: "\u6982\u5ff5",
  suggestion: "\u5efa\u8bae",
  person: "\u4eba\u7269\u4ecb\u7ecd",
  code: "Code",
};

export const G2_CUE_PREFIX: Record<CueCategory, string> = {
  concept: "\u25a4",
  response: "?",
  suggestion: "\u25c7",
  person: "\u25cb",
  code: "[C]",
};

export function formatG2CueTitle(category: CueCategory, title: string): string {
  return `${G2_CUE_PREFIX[category]} ${title}`;
}
