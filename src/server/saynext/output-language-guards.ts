export type OutputLanguage = "english" | "chinese";

function containsChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

export function enforceOutputLanguage(output: string, transcript: string, outputLanguage: OutputLanguage): string {
  if (outputLanguage === "chinese" || !containsChinese(output)) {
    return output;
  }

  if (containsChinese(transcript)) {
    return output;
  }

  const normalizedTranscript = transcript.trim().toLowerCase();

  if (/\u81ea\u5df1\u505a/.test(transcript)) {
    return "Yeah, I made it myself.";
  }

  if (/\u6211\u62d2\u7edd|\u4e0d\u60f3|\u4e0d\u8981/.test(transcript)) {
    return "Yeah, I don't really want to do that.";
  }

  if (/\u4e0d\u592a\u4e86\u89e3|\u4e0d\u77e5\u9053|\u4e0d\u6e05\u695a/.test(transcript)) {
    return "I'm not really sure about that yet.";
  }

  if (/\u4f60\u597d|\u54c8\u55bd|hello|hi/.test(normalizedTranscript)) {
    return "Hey.";
  }

  return "Sorry, could you say that again in English?";
}

export function replaceChineseEnglishClarification(output: string, transcript: string): string {
  if (!containsChinese(transcript)) {
    return output;
  }

  if (!/\b(say that again in english|repeat that in english|say it again in english|could you say.*in english)\b/i.test(output)) {
    return output;
  }

  return "不好意思，刚才这句我没太听清，可以再说一遍吗？";
}
