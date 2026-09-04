import type { GlassBridgeHandle } from "./glasses-bridge";
import { GLASS_TRANSCRIPT_NAME, type GlassPageSpec, type GlassTextContainerSpec } from "./glasses-layout";
import { glassPageStructureKey } from "./glasses-render-plan";

type TranscriptSnapshot = {
  id: number;
  name: string;
  content: string;
};

type RenderSnapshot = {
  structureKey: string;
  transcript: TranscriptSnapshot | null;
};

type DeferredContentSnapshot = {
  id: number;
  name: string;
  content: string;
};

export type GlassRendererHandle = {
  render(page: GlassPageSpec): Promise<void>;
  dispose(): void;
};

export type GlassRendererOptions = {
  transcriptUpgradeTimeoutMs?: number;
};

const DEFAULT_TRANSCRIPT_UPGRADE_TIMEOUT_MS = 2000;
const TRANSCRIPT_UPGRADE_TIMEOUT = Symbol("transcript_upgrade_timeout");

function transcriptSnapshot(page: GlassPageSpec): TranscriptSnapshot | null {
  const container = page.containers.find((item): item is GlassTextContainerSpec => (
    item.kind === "text" && item.name === GLASS_TRANSCRIPT_NAME
  ));
  if (!container) return null;
  return {
    id: container.id,
    name: container.name,
    content: container.content,
  };
}

function pageSnapshot(page: GlassPageSpec): RenderSnapshot {
  return {
    structureKey: glassPageStructureKey(page),
    transcript: transcriptSnapshot(page),
  };
}

function deferredContentSnapshot(page: GlassPageSpec): DeferredContentSnapshot | null {
  const container = page.containers.find((item): item is GlassTextContainerSpec => (
    item.kind === "text" && item.deferContentUntilUpgrade === true
  ));
  if (!container?.content) return null;
  return {
    id: container.id,
    name: container.name,
    content: container.content,
  };
}

function withoutDeferredContent(page: GlassPageSpec): GlassPageSpec {
  return {
    ...page,
    containers: page.containers.map((container) => (
      container.kind === "text" && container.deferContentUntilUpgrade
        ? { ...container, content: "" }
        : container
    )),
  };
}

function waitForTranscriptUpgrade(
  operation: Promise<boolean>,
  timeoutMs: number,
): Promise<boolean | typeof TRANSCRIPT_UPGRADE_TIMEOUT> {
  if (timeoutMs <= 0) return operation;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(TRANSCRIPT_UPGRADE_TIMEOUT);
    }, timeoutMs);

    operation.then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createGlassRenderer(
  bridge: GlassBridgeHandle,
  initialPage: GlassPageSpec,
  options: GlassRendererOptions = {},
): GlassRendererHandle {
  let current = pageSnapshot(initialPage);
  let disposed = false;
  let dirty = false;
  let pendingPage: GlassPageSpec | null = null;
  let drainPromise: Promise<void> | null = null;
  const transcriptUpgradeTimeoutMs = options.transcriptUpgradeTimeoutMs
    ?? DEFAULT_TRANSCRIPT_UPGRADE_TIMEOUT_MS;

  function takeLatestPage(fallback: GlassPageSpec): GlassPageSpec {
    const latest = pendingPage || fallback;
    pendingPage = null;
    return latest;
  }

  async function applyPage(page: GlassPageSpec): Promise<void> {
    const next = pageSnapshot(page);
    if (dirty || next.structureKey !== current.structureKey) {
      const deferredContent = deferredContentSnapshot(page);
      if (deferredContent) {
        try {
          await bridge.render(withoutDeferredContent(page));
          const result = await waitForTranscriptUpgrade(
            bridge.updateTextContainer(deferredContent),
            transcriptUpgradeTimeoutMs,
          );
          if (disposed) return;
          if (result !== true) {
            dirty = true;
            throw new Error("deferred_content_upgrade_failed");
          }
          current = next;
          dirty = false;
          return;
        } catch (error) {
          dirty = true;
          throw error;
        }
      }
      await bridge.render(page);
      if (!disposed) {
        current = next;
        dirty = false;
      }
      return;
    }

    const nextTranscript = next.transcript;
    if (!nextTranscript || !current.transcript || nextTranscript.content === current.transcript.content) {
      return;
    }

    const result = await waitForTranscriptUpgrade(
      bridge.updateTextContainer(nextTranscript),
      transcriptUpgradeTimeoutMs,
    );
    if (disposed) return;
    if (result === true) {
      current = {
        ...current,
        transcript: nextTranscript,
      };
      return;
    }

    // A native upgrade can return false or lose its response. Rebuild once with
    // the newest requested page so stale partials are not replayed afterward.
    const recoveryPage = takeLatestPage(page);
    await bridge.render(recoveryPage);
    if (!disposed) current = pageSnapshot(recoveryPage);
  }

  function drain(): Promise<void> {
    return (async () => {
      let failedPage: GlassPageSpec | null = null;
      let failureCount = 0;
      try {
        while (!disposed && pendingPage) {
          const page = pendingPage;
          pendingPage = null;
          if (page !== failedPage) {
            failedPage = page;
            failureCount = 0;
          }
          try {
            await applyPage(page);
            failedPage = null;
            failureCount = 0;
          } catch (error) {
            // A newer requested page represents what the user currently sees or
            // selected. Continue with it instead of leaving the render queue
            // stranded behind a failed native rebuild/upgrade.
            if (pendingPage) {
              failedPage = null;
              failureCount = 0;
              continue;
            }

            failureCount += 1;
            if (failureCount <= 1) {
              pendingPage = page;
              continue;
            }
            throw error;
          }
        }
      } finally {
        drainPromise = null;
      }
    })();
  }

  return {
    render(page: GlassPageSpec): Promise<void> {
      if (disposed) return Promise.resolve();
      pendingPage = page;
      if (!drainPromise) drainPromise = drain();
      return drainPromise;
    },
    dispose(): void {
      disposed = true;
      pendingPage = null;
    },
  };
}
