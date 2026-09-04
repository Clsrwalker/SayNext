// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ErrorBoundary, UI_ERROR_STORAGE_KEY } from "./ErrorBoundary";

function CrashingChild(): never {
  throw new Error("real_child_render_failure");
}

describe("ErrorBoundary component behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("catches a child render failure, records it, and shows recovery UI", () => {
    render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "SayNext UI crashed" })).toBeTruthy();
    expect(screen.getByText("real_child_render_failure")).toBeTruthy();

    const stored = localStorage.getItem(UI_ERROR_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored || "{}")).toMatchObject({
      name: "Error",
      message: "real_child_render_failure",
    });
  });
});
