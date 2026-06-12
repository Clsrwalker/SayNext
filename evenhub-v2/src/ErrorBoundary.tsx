import { Component, type ErrorInfo, type ReactNode } from "react";

export const UI_ERROR_STORAGE_KEY = "saynext:v2:last-ui-error";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export function serializeUiError(
  error: unknown,
  componentStack = "",
  at = new Date().toISOString(),
  href = typeof window === "undefined" ? "" : window.location.href,
): string {
  const normalized = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack || "",
      }
    : {
        name: "NonError",
        message: String(error),
        stack: "",
      };

  return JSON.stringify({
    ...normalized,
    componentStack,
    at,
    href,
  });
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      localStorage.setItem(UI_ERROR_STORAGE_KEY, serializeUiError(error, info.componentStack ?? ""));
    } catch {
      // If localStorage is unavailable, still show the fallback UI.
    }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="phone-shell">
          <section className="summary-card">
            <h1>SayNext UI crashed</h1>
            <p>{this.state.error.message}</p>
            <p>Restart the app. The crash detail was saved to localStorage.</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
