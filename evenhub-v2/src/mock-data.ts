import type { AiCue, ConversationRecord, ConversationSettings, Prenote, TranscriptLine } from "./types";

export const DEFAULT_SETTINGS: ConversationSettings = {
  voiceInput: "phone",
  language: "english",
  glassContent: {
    aiCue: true,
    transcript: true,
  },
  autoPopup: true,
  cueDuration: 10000,
};

export const MOCK_PRENOTES: Prenote[] = [
  {
    id: "pn-transfer-learning",
    title: "Transfer Learning Tutorial",
    text: "# Tutorial 4 - CSCI 5501 - TRANSFER LEARNING\n\nKey ideas: frozen base model, fine-tuning, feature extractor, smaller learning rate, avoid overfitting on small datasets.",
    selected: true,
    files: [],
  },
  {
    id: "pn-cloud-interview",
    title: "Cloud Interview",
    text: "JobLens AI: React SPA on S3, API Gateway, FastAPI Lambda, DynamoDB, S3 raw payloads, CloudWatch, Terraform. Best cloud project to mention first.",
    selected: false,
    files: [],
  },
];

export const MOCK_TRANSCRIPT: TranscriptLine[] = [
  {
    id: "tr-1",
    time: "00:00:05",
    text: "Questions generally are going to cost normalizing the inputs itself.",
  },
  {
    id: "tr-2",
    time: "00:00:08",
    text: "You think about how the activations themselves are normalized.",
  },
  {
    id: "tr-3",
    time: "00:00:14",
    text: "So when I say activation, what I mean are the outputs of a certain layer within your network.",
  },
  {
    id: "tr-4",
    time: "00:00:20",
    text: "So we are going to get the mean and variance of this batch.",
    partial: true,
  },
];

export const MOCK_CUES: AiCue[] = [
  {
    id: "cue-response-1",
    category: "response",
    title: "Answer batch norm",
    output: "So basically, batch normalization normalizes the activations in a mini-batch, then learns scale and shift parameters so the model can still represent useful distributions.",
    createdAt: "2026-06-05T13:35:22-03:00",
    source: "manual",
  },
  {
    id: "cue-concept-1",
    category: "concept",
    title: "Activation stats",
    output: "Batch norm uses the mini-batch mean and variance to normalize layer activations before applying learnable gamma and beta parameters.",
    createdAt: "2026-06-05T13:35:18-03:00",
    source: "auto",
  },
  {
    id: "cue-suggestion-1",
    category: "suggestion",
    title: "Mention tradeoff",
    output: "You can add that batch norm often improves stability, but behavior differs between training and inference because inference uses running statistics.",
    createdAt: "2026-06-05T13:35:14-03:00",
    source: "auto",
  },
  {
    id: "cue-person-1",
    category: "person",
    title: "Professor note",
    output: "The speaker is explaining normalization from the activation perspective, so keep the answer tied to layer outputs rather than raw input features.",
    createdAt: "2026-06-05T13:35:07-03:00",
    source: "auto",
  },
];

export const MOCK_RECORDS: ConversationRecord[] = [
  {
    id: "rec-1",
    title: "Deep Learning Model Training and Batch Normalization Technical",
    startedAt: "10:29 AM 2026/06/05",
    location: "哈利法克斯, CA",
    duration: "00:18:48",
    summary: "The conversation covered batch normalization, activation statistics, and training/inference behavior.",
    keyPoints: ["Batch norm normalizes activations", "Mini-batch mean and variance are used during training", "Inference uses running statistics"],
    actionItems: ["Review gamma and beta parameters", "Compare batch norm with layer norm"],
    transcript: MOCK_TRANSCRIPT,
    cueHistory: MOCK_CUES,
    usedPrenote: MOCK_PRENOTES[0],
  },
  {
    id: "rec-2",
    title: "Immediate Wolfville Travel Coordination",
    startedAt: "11:30 AM 2026/06/02",
    location: "哈利法克斯, CA",
    duration: "00:01:18",
    summary: "Participants coordinated travel to Wolfville and clarified attendance.",
    keyPoints: ["Wolfville travel plans", "Group attendance needs confirmation"],
    actionItems: [],
    transcript: [
      { id: "r2-tr-1", time: "00:00:06", text: "Are we leaving now or waiting for one more person?" },
      { id: "r2-tr-2", time: "00:00:14", text: "I think we can leave first and share the location." },
    ],
    cueHistory: [
      {
        id: "r2-cue-1",
        category: "response",
        title: "Travel reply",
        output: "I think we can leave first, and if they still want to join, we can share the location and meet there.",
        createdAt: "2026-06-02T11:30:30-03:00",
        source: "auto",
      },
    ],
  },
  {
    id: "rec-3",
    title: "Empty Conversation",
    startedAt: "12:13 PM 2026/06/05",
    location: "哈利法克斯, CA",
    duration: "00:00:00",
    summary: "-",
    keyPoints: [],
    actionItems: [],
    transcript: [],
    cueHistory: [],
  },
];

export function makeManualCue(transcriptText: string): AiCue {
  const createdAt = new Date();
  return {
    id: `manual-${createdAt.getTime()}`,
    category: "response",
    title: `SayNext ${createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`,
    output: transcriptText
      ? "I think the key point is that batch norm normalizes activations using batch statistics, but still learns scale and shift so the model does not lose flexibility."
      : "I would probably wait for more context before answering, because I do not want to guess the wrong direction.",
    createdAt: createdAt.toISOString(),
    source: "manual",
  };
}
