import { generateOpenAiJson } from "../local-llm/openai-json-client";

export type ConversationSummaryKeyPoint = {
  title: string;
  details: string[];
};

export type ConversationSummaryActionItem = {
  text: string;
};

export type ConversationSummaryOutput = {
  title: string;
  overview: string;
  keyPoints: ConversationSummaryKeyPoint[];
  actionItems: ConversationSummaryActionItem[];
};

export type ConversationSummaryGeneratorInput = {
  transcriptText: string;
  cueHistoryText: string;
  prenoteText: string;
  language: "english" | "chinese" | "auto";
};

export type ConversationSummaryGenerationResult = {
  data: ConversationSummaryOutput;
  rawText: string;
  model: string;
};

export interface ConversationSummaryGenerator {
  generate(input: ConversationSummaryGeneratorInput): Promise<ConversationSummaryGenerationResult>;
}

function cleanOneLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanParagraph(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function cleanStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanParagraph(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function normalizeConversationSummaryOutput(value: unknown): ConversationSummaryOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = cleanOneLine(record.title, 120);
  const overview = cleanParagraph(record.overview, 2200);
  if (!title) throw new Error("summary_title_required");
  if (!overview) throw new Error("summary_overview_required");

  const keyPoints = Array.isArray(record.keyPoints) ? record.keyPoints : [];
  const actionItems = Array.isArray(record.actionItems) ? record.actionItems : [];

  return {
    title,
    overview,
    keyPoints: keyPoints
      .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {})
      .map((item) => ({
        title: cleanOneLine(item.title, 140),
        details: cleanStringArray(item.details, 8, 600),
      }))
      .filter((item) => item.title)
      .slice(0, 12),
    actionItems: actionItems
      .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {})
      .map((item) => ({ text: cleanOneLine(item.text, 240) }))
      .filter((item) => item.text)
      .slice(0, 20),
  };
}

export function buildEvenHubV2SummaryPrompt(input: ConversationSummaryGeneratorInput): string {
  return [
    "You generate post-conversation summaries for SayNext / EvenHub v2.",
    "",
    "Fact boundaries:",
    "- Transcript final lines are the primary facts. Summary claims must be grounded in transcript lines.",
    "- AI cue history is not conversation fact. It only shows what the assistant suggested during the conversation.",
    "- Prenote is background material. It may be useful context, but it was not necessarily discussed.",
    "- Do not claim that cue history or prenote content happened in the conversation unless the transcript supports it.",
    "",
    "Return exactly one JSON object:",
    JSON.stringify({
      title: "short conversation title",
      overview: "one paragraph summary",
      keyPoints: [
        {
          title: "short key point title",
          details: ["supporting detail from transcript"],
        },
      ],
      actionItems: [
        { text: "concrete follow-up action if any" },
      ],
    }),
    "",
    "Rules:",
    "- title: concise and specific.",
    "- overview: one useful paragraph.",
    "- keyPoints: group the main topics. Each detail should be grounded in transcript evidence.",
    "- actionItems: only include explicit or strongly implied follow-ups. Use [] if none.",
    `- Preferred language: ${input.language}.`,
    "",
    "Transcript final lines:",
    input.transcriptText,
    "",
    input.cueHistoryText.trim() ? `AI cue history, non-factual assistant suggestions:\n${input.cueHistoryText}` : "AI cue history: none",
    "",
    input.prenoteText.trim() ? `Prenote background, not conversation fact:\n${input.prenoteText}` : "Prenote background: none",
  ].join("\n");
}

export class OpenAiConversationSummaryGenerator implements ConversationSummaryGenerator {
  constructor(private readonly model = process.env.EVENHUB_V2_SUMMARY_MODEL || "gpt-5.5") {}

  async generate(input: ConversationSummaryGeneratorInput): Promise<ConversationSummaryGenerationResult> {
    const result = await generateOpenAiJson<ConversationSummaryOutput>({
      model: this.model,
      prompt: buildEvenHubV2SummaryPrompt(input),
      temperature: null,
      timeoutMs: Number(process.env.EVENHUB_V2_SUMMARY_TIMEOUT_MS || 180000),
    });

    return {
      data: normalizeConversationSummaryOutput(result.data),
      rawText: result.rawText,
      model: result.model,
    };
  }
}
