import type { ImmediateRule } from "./immediate-rule-registry";

function chineseOrEnglish(isChinese: boolean, chinese: string, english: string): string {
  return isChinese ? chinese : english;
}

export const LOCALIZED_IMMEDIATE_RULES: ImmediateRule[] = [
  {
    id: "immediate:localized-safe-acknowledgement",
    priority: 500,
    category: "casual",
    include: [/^(?:good for you|nice|cool|awesome|that'?s good|that sounds good|sounds good|glad to hear that)[.!?\s]*$/i],
    output: ({ outputLanguage }) => chineseOrEnglish(
      outputLanguage === "chinese",
      "嗯，挺好的。",
      "Yeah, thanks. I think it'll be useful.",
    ),
    reasoning: "Immediate safe acknowledgement without personal expansion",
    confidence: 0.82,
  },
  {
    id: "immediate:localized-daily-morning",
    priority: 495,
    category: "casual",
    include: [/\b(good\s+morning|morning)\b/i, /\b(day going|how'?s your day|how is your day|so far)\b/i],
    output: ({ outputLanguage }) => chineseOrEnglish(
      outputLanguage === "chinese",
      "还行，今天就比较 chill，刚开始进入状态。你呢？",
      "Not bad so far, still waking up a bit.",
    ),
    reasoning: "Immediate natural daily morning response",
  },
  {
    id: "immediate:localized-taking-it-easy",
    priority: 490,
    category: "casual",
    include: [/\b(taking it easy|take it easy|just chilling|chill today)\b/i],
    output: ({ outputLanguage }) => chineseOrEnglish(
      outputLanguage === "chinese",
      "嗯，今天就比较 chill，休息一下，可能顺便补点东西。",
      "Yeah, mostly just taking it easy and maybe catching up on a few things.",
    ),
    reasoning: "Immediate casual taking-it-easy response",
    confidence: 0.88,
  },
  {
    id: "immediate:localized-weekend",
    priority: 485,
    category: "casual",
    include: [/周末|\bzhoumo\b/i],
    output: ({ outputLanguage }) => chineseOrEnglish(
      outputLanguage === "chinese",
      "一般就在家休息，打游戏、看动漫或者刷点视频。如果有项目或者作业，就补一点进度；不然我更喜欢安静待着，不太想把周末排得很满。",
      "Usually I stay home, play games, watch anime, or catch up on videos. If I have a project or homework, I make a bit of progress; otherwise I prefer a quiet weekend.",
    ),
    reasoning: "Immediate localized weekend response",
    confidence: 0.88,
  },
  {
    id: "immediate:localized-fragment-clarification",
    priority: 480,
    category: "casual",
    include: [/^(uh|um|yes|right)[.!?\s]*$/i],
    output: ({ outputLanguage }) => chineseOrEnglish(
      outputLanguage === "chinese",
      "不好意思，刚才那部分能再说一下吗？",
      "Sorry, what was the last part?",
    ),
    reasoning: "Immediate fragment clarification",
    confidence: 0.8,
  },
  {
    id: "immediate:localized-speaker-introduction",
    priority: 475,
    category: "casual",
    when: ({ normalized }) => /^\s*[A-Z]\s*:\s*(?:hi|hello|hey)[, ]+(?:i'?m|i am)\s+([A-Za-z][A-Za-z .'-]{1,40})[.!?\s]*$/i.test(normalized),
    output: ({ normalized, outputLanguage }) => {
      const match = normalized.match(/^\s*[A-Z]\s*:\s*(?:hi|hello|hey)[, ]+(?:i'?m|i am)\s+([A-Za-z][A-Za-z .'-]{1,40})[.!?\s]*$/i);
      const name = match?.[1]?.trim().replace(/[.!?]+$/, "") || "there";
      return chineseOrEnglish(outputLanguage === "chinese", `你好，${name}。`, `Nice to meet you, ${name}.`);
    },
    reasoning: "Immediate speaker introduction response",
    confidence: 0.85,
  },
  {
    id: "immediate:localized-unlabelled-speaker-introduction",
    priority: 470,
    category: "casual",
    when: ({ normalized }) => {
      const match = normalized.match(/^\s*(?:hi|hello|hey)[, ]+(?:i'?m|i am)\s+([A-Za-z][A-Za-z .'-]{1,40})(?:[, ]+.*)?[.!?\s]*$/i);
      return Boolean(match?.[1] && !/^xiang(?:\s+li)?$/i.test(match[1].trim()));
    },
    output: ({ normalized, outputLanguage }) => {
      const match = normalized.match(/^\s*(?:hi|hello|hey)[, ]+(?:i'?m|i am)\s+([A-Za-z][A-Za-z .'-]{1,40})(?:[, ]+.*)?[.!?\s]*$/i);
      const name = match?.[1]?.trim().replace(/[.!?]+$/, "") || "there";
      return chineseOrEnglish(outputLanguage === "chinese", `你好，${name}。`, `Nice to meet you, ${name}.`);
    },
    reasoning: "Immediate unlabelled speaker introduction response",
    confidence: 0.85,
  },
  {
    id: "immediate:localized-water-word",
    priority: 465,
    category: "casual",
    include: [/^water\.$/i],
    output: ({ outputLanguage }) => chineseOrEnglish(
      outputLanguage === "chinese",
      "我想喝点水。",
      "I could use some water.",
    ),
    reasoning: "Immediate short word response",
    confidence: 0.75,
  },
  {
    id: "immediate:chinese-made-myself-to-english",
    priority: 460,
    category: "casual",
    include: [/自己做|自己写|我做的/i],
    when: ({ outputLanguage }) => outputLanguage === "english",
    output: "Yeah, I made it myself.",
    reasoning: "Immediate bilingual English response",
    confidence: 0.8,
  },
  {
    id: "immediate:chinese-not-sure-to-english",
    priority: 455,
    category: "casual",
    include: [/不太了解|不知道|不清楚/i],
    when: ({ outputLanguage }) => outputLanguage === "english",
    output: "I'm not really sure about that yet.",
    reasoning: "Immediate bilingual English response",
    confidence: 0.8,
  },
  {
    id: "immediate:chinese-dont-want-to-english",
    priority: 450,
    category: "casual",
    include: [/我拒绝|我不想|不想做|不要/i],
    when: ({ outputLanguage }) => outputLanguage === "english",
    output: "Yeah, I don't really want to do that.",
    reasoning: "Immediate bilingual English response",
    confidence: 0.8,
  },
];
