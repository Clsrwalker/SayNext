import type { ConversationSettings, GlassContentFlag } from "./types";

export function updateGlassContentSetting(
  settings: ConversationSettings,
  flag: GlassContentFlag,
  value: boolean,
): ConversationSettings {
  return {
    ...settings,
    glassContent: {
      ...settings.glassContent,
      [flag]: value,
    },
  };
}
