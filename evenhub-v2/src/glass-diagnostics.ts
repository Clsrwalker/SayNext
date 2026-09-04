import type { GlassPageSpec } from "./glasses-layout";

export type GlassPageDiagnostic = {
  view: GlassPageSpec["view"];
  textContainerCount: number;
  listItemCount: number;
  totalTextBytes: number;
  maxTextBytes: number;
  maxListItemBytes: number;
};

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function describeGlassPage(page: GlassPageSpec): GlassPageDiagnostic {
  const textContainers = page.containers.filter((container) => container.kind === "text");
  const listItems = page.containers.flatMap((container) => (
    container.kind === "list" ? container.items : []
  ));
  const textBytes = textContainers.map((container) => utf8ByteLength(container.content));
  const listItemBytes = listItems.map(utf8ByteLength);

  return {
    view: page.view,
    textContainerCount: textContainers.length,
    listItemCount: listItems.length,
    totalTextBytes: textBytes.reduce((total, bytes) => total + bytes, 0),
    maxTextBytes: textBytes.length ? Math.max(...textBytes) : 0,
    maxListItemBytes: listItemBytes.length ? Math.max(...listItemBytes) : 0,
  };
}
