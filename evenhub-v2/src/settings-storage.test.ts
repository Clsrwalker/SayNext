import { afterEach, describe, expect, test, vi } from "vitest";
import {
  loadStoredConversationSettings,
  normalizeConversationSettings,
  resolveBootstrapConversationSettings,
  saveConversationSettings,
} from "./settings-storage";
import type { ConversationSettings } from "./types";

const fallback: ConversationSettings = {
  voiceInput: "glasses",
  language: "english",
  glassContent: {
    aiCue: true,
    transcript: true,
  },
  autoPopup: true,
  cueDuration: 10000,
};

function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
  const host = globalThis as typeof globalThis & { window?: Window };
  if (!host.window) {
    Object.defineProperty(host, "window", {
      configurable: true,
      value: {},
    });
  }
  Object.defineProperty(host.window, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  return { localStorage, store };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings storage", () => {
  test("normalizes stored phone mic and display settings", () => {
    expect(normalizeConversationSettings({
      voiceInput: "phone",
      language: "chinese",
      glassContent: {
        aiCue: false,
        transcript: false,
      },
      autoPopup: false,
      cueDuration: "forever",
    }, fallback)).toEqual({
      voiceInput: "phone",
      language: "chinese",
      glassContent: {
        aiCue: false,
        transcript: false,
      },
      autoPopup: false,
      cueDuration: "forever",
    });
  });

  test("loads and saves conversation settings through localStorage", () => {
    const { store } = installLocalStorage();
    const settings: ConversationSettings = {
      ...fallback,
      voiceInput: "phone",
      glassContent: {
        aiCue: false,
        transcript: true,
      },
    };

    expect(saveConversationSettings(settings)).toBe(true);
    expect(store.size).toBe(1);
    expect(loadStoredConversationSettings(fallback)).toMatchObject({
      voiceInput: "phone",
      glassContent: {
        aiCue: false,
        transcript: true,
      },
    });
  });

  test("ignores invalid stored JSON", () => {
    installLocalStorage({ "saynext.evenhub.v2.settings": "{" });
    expect(loadStoredConversationSettings(fallback)).toBeNull();
  });

  test("keeps local settings when bootstrap only returns defaults", () => {
    const local: ConversationSettings = {
      ...fallback,
      voiceInput: "phone",
      glassContent: {
        aiCue: false,
        transcript: false,
      },
    };

    expect(resolveBootstrapConversationSettings({
      current: local,
      bootstrap: fallback,
      bootstrapSource: "default",
      hasLocalSettings: true,
    })).toEqual(local);
  });

  test("uses saved server settings when bootstrap has a saved source", () => {
    const local: ConversationSettings = {
      ...fallback,
      voiceInput: "phone",
      glassContent: {
        aiCue: false,
        transcript: false,
      },
    };

    expect(resolveBootstrapConversationSettings({
      current: local,
      bootstrap: {
        ...fallback,
        voiceInput: "glasses",
        glassContent: {
          aiCue: true,
          transcript: true,
        },
      },
      bootstrapSource: "saved",
      hasLocalSettings: true,
    })).toMatchObject({
      voiceInput: "glasses",
      glassContent: {
        aiCue: true,
        transcript: true,
      },
    });
  });
});
