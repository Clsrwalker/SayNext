import { describe, expect, test } from "vitest";
import { serializeUiError, UI_ERROR_STORAGE_KEY } from "./ErrorBoundary";

describe("ErrorBoundary helpers", () => {
  test("serializes UI crashes for localStorage debugging", () => {
    const serialized = serializeUiError(
      new Error("render failed"),
      "Component stack",
      "2026-06-12T00:00:00.000Z",
      "https://example.test/saynext",
    );
    const parsed = JSON.parse(serialized) as Record<string, string>;

    expect(UI_ERROR_STORAGE_KEY).toBe("saynext:v2:last-ui-error");
    expect(parsed.name).toBe("Error");
    expect(parsed.message).toBe("render failed");
    expect(parsed.componentStack).toBe("Component stack");
    expect(parsed.at).toBe("2026-06-12T00:00:00.000Z");
    expect(parsed.href).toBe("https://example.test/saynext");
  });
});
