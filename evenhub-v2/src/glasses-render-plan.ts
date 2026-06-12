import { GLASS_TRANSCRIPT_NAME, type GlassPageSpec } from "./glasses-layout";

const TEXT_CONTENT_IGNORED_FOR_STRUCTURE = new Set(["h-right", GLASS_TRANSCRIPT_NAME]);

export function glassPageStructureKey(page: GlassPageSpec): string {
  return JSON.stringify({
    view: page.view,
    containers: page.containers.map((container) => {
      if (container.kind !== "text") return container;
      if (!TEXT_CONTENT_IGNORED_FOR_STRUCTURE.has(container.name)) return container;
      return {
        ...container,
        content: "",
      };
    }),
  });
}

export function hasGlassTranscriptContainer(page: GlassPageSpec): boolean {
  return page.containers.some((container) => container.kind === "text" && container.name === GLASS_TRANSCRIPT_NAME);
}

export function shouldUseGlassTranscriptUpgrade(page: GlassPageSpec): boolean {
  return hasGlassTranscriptContainer(page);
}
