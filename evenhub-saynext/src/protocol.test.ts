import { describe, expect, test } from "vitest";
import { defaultWsUrlForLocation, normalizeSavedWsUrl, normalizeSettings, REMOTE_SAYNEXT_WS_URL } from "./protocol";

describe("defaultWsUrlForLocation", () => {
  test("uses the current host for the SayNext VPS", () => {
    expect(defaultWsUrlForLocation({
      protocol: "https:",
      hostname: "saynext.167.172.153.109.sslip.io",
      host: "saynext.167.172.153.109.sslip.io",
      port: "",
    })).toBe("wss://saynext.167.172.153.109.sslip.io/api/evenhub/ws");
  });

  test("uses a local backend when the app is hosted directly by SayNext", () => {
    expect(defaultWsUrlForLocation({
      protocol: "http:",
      hostname: "192.168.1.20",
      host: "192.168.1.20:3000",
      port: "3000",
    })).toBe("ws://192.168.1.20:3000/api/evenhub/ws");
  });

  test("uses the VPS from Vite sideload instead of depending on a local backend", () => {
    expect(defaultWsUrlForLocation({
      protocol: "http:",
      hostname: "192.168.1.20",
      host: "192.168.1.20:5173",
      port: "5173",
    })).toBe(REMOTE_SAYNEXT_WS_URL);
  });

  test("falls back to the VPS when packaged under an unknown HTTPS app host", () => {
    expect(defaultWsUrlForLocation({
      protocol: "https:",
      hostname: "evenhub-app-host.example",
      host: "evenhub-app-host.example",
      port: "",
    })).toBe(REMOTE_SAYNEXT_WS_URL);
  });
});

describe("normalizeSavedWsUrl", () => {
  test("migrates old Vite websocket proxy URLs to the VPS", () => {
    expect(normalizeSavedWsUrl("ws://100.69.151.10:5173/api/evenhub/ws")).toBe(REMOTE_SAYNEXT_WS_URL);
  });

  test("keeps explicit non-Vite websocket URLs", () => {
    expect(normalizeSavedWsUrl("ws://127.0.0.1:3000/api/evenhub/ws")).toBe("ws://127.0.0.1:3000/api/evenhub/ws");
  });
});

describe("normalizeSettings", () => {
  test("defaults to phone microphone because G2 audio can be unavailable", () => {
    expect(normalizeSettings(undefined).micSource).toBe("phone");
  });

  test("drops removed teleprompt values from saved settings", () => {
    const settings = normalizeSettings({
      sceneMode: "teleprompt" as never,
      displayMode: "teleprompt" as never,
      outputLanguage: "chinese",
    });

    expect(settings.sceneMode).toBe("auto");
    expect(settings.displayMode).toBe("answer");
    expect(settings.outputLanguage).toBe("chinese");
  });
});
