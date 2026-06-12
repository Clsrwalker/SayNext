import type { EvenHubV2Settings } from "./protocol";

export type EvenHubV2ContextInput = {
  userId: string;
  conversationId: string;
  triggerWindow: string;
  recentTranscript: string;
  selectedPrenoteIds: string[];
  selectedPrenoteText: string;
  settings: EvenHubV2Settings;
};

export type EvenHubV2ContextSnapshot = {
  contextSnapshot: string;
  memoryUsedIds: string[];
  prenoteUsedIds: string[];
};

export interface EvenHubV2ContextAdapter {
  build(input: EvenHubV2ContextInput): Promise<EvenHubV2ContextSnapshot>;
}

export class LightweightEvenHubV2ContextAdapter implements EvenHubV2ContextAdapter {
  async build(input: EvenHubV2ContextInput): Promise<EvenHubV2ContextSnapshot> {
    const sections = [
      `Settings: language=${input.settings.language}; autoPopup=${input.settings.autoPopup ? "on" : "off"}`,
      input.selectedPrenoteText.trim()
        ? `Selected prenote, use only if directly relevant:\n${input.selectedPrenoteText.trim().slice(0, 2500)}`
        : "",
      input.recentTranscript.trim()
        ? `Recent transcript:\n${input.recentTranscript.trim().slice(-2200)}`
        : "",
      `Trigger window:\n${input.triggerWindow.trim()}`,
    ].filter(Boolean);

    return {
      contextSnapshot: sections.join("\n\n"),
      memoryUsedIds: [],
      prenoteUsedIds: input.selectedPrenoteIds,
    };
  }
}
