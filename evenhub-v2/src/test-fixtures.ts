import type { AiCue, Prenote, TranscriptLine } from "./types";

export const TEST_PRENOTES: Prenote[] = [
  {
    id: "pn-transfer-learning",
    title: "Transfer Learning Tutorial",
    text: "# Tutorial 4 - CSCI 5501 - TRANSFER LEARNING\n\nKey ideas: frozen base model, fine-tuning, feature extractor, smaller learning rate, avoid overfitting on small datasets.",
    selected: true,
    files: [],
  },
];

export const TEST_TRANSCRIPT: TranscriptLine[] = [
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
];

export const TEST_CUES: AiCue[] = [
  {
    id: "cue-response-1",
    category: "response",
    title: "Answer batch norm",
    g2Title: "Batch norm",
    output: "Batch normalization normalizes activations in a mini-batch, then learns scale and shift parameters.",
    createdAt: "2026-06-05T13:35:22-03:00",
    source: "auto",
  },
  {
    id: "cue-concept-1",
    category: "concept",
    title: "Activation stats",
    g2Title: "Stats",
    output: "Batch norm uses the mini-batch mean and variance to normalize layer activations.",
    createdAt: "2026-06-05T13:35:18-03:00",
    source: "auto",
  },
  {
    id: "cue-suggestion-1",
    category: "suggestion",
    title: "Mention tradeoff",
    g2Title: "Tradeoff",
    output: "Mention that training and inference differ because inference uses running statistics.",
    createdAt: "2026-06-05T13:35:14-03:00",
    source: "auto",
  },
];
