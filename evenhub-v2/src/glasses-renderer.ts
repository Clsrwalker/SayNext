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

export type GlassRendererHandle = {
  render(page: GlassPageSpec): Promise<void>;
  dispose(): void;
};

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

export function createGlassRenderer(bridge: GlassBridgeHandle, initialPage: GlassPageSpec): GlassRendererHandle {
  let current = pageSnapshot(initialPage);
  let disposed = false;
  let queue = Promise.resolve();

  function enqueue(task: () => Promise<void>): Promise<void> {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (disposed) return;
        await task();
      });
    return queue;
  }

  return {
    render(page: GlassPageSpec): Promise<void> {
      const next = pageSnapshot(page);
      if (next.structureKey !== current.structureKey) {
        return enqueue(async () => {
          await bridge.render(page);
          current = next;
        });
      }

      const nextTranscript = next.transcript;
      if (!nextTranscript || !current.transcript || nextTranscript.content === current.transcript.content) {
        return Promise.resolve();
      }

      return enqueue(async () => {
        if (current.structureKey !== next.structureKey) return;
        const ok = await bridge.updateTextContainer(nextTranscript);
        if (ok) {
          current = {
            ...current,
            transcript: nextTranscript,
          };
        } else {
          current = {
            ...current,
            structureKey: "",
          };
        }
      });
    },
    dispose(): void {
      disposed = true;
    },
  };
}
