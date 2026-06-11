import {
  CreateStartUpPageContainer,
  ListItemContainerProperty,
  ListContainerProperty,
  TextContainerProperty,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import type { GlassListContainerSpec, GlassPageSpec, GlassTextContainerSpec } from "./glasses-layout";

export type GlassBridgeHandle = {
  bridge: EvenAppBridge;
  render(page: GlassPageSpec): Promise<void>;
};

function textContainer(spec: GlassTextContainerSpec): TextContainerProperty {
  return new TextContainerProperty({
    containerID: spec.id,
    containerName: spec.name,
    content: spec.content,
    xPosition: spec.x,
    yPosition: spec.y,
    width: spec.width,
    height: spec.height,
    borderWidth: spec.borderWidth || 0,
    borderColor: spec.borderColor || 0,
    borderRadius: spec.borderRadius || 0,
    paddingLength: spec.padding || 0,
    isEventCapture: spec.eventCapture ? 1 : 0,
  });
}

function listContainer(spec: GlassListContainerSpec): ListContainerProperty {
  return new ListContainerProperty({
    containerID: spec.id,
    containerName: spec.name,
    xPosition: spec.x,
    yPosition: spec.y,
    width: spec.width,
    height: spec.height,
    borderWidth: spec.borderWidth || 0,
    borderColor: spec.borderColor || 0,
    borderRadius: spec.borderRadius || 0,
    paddingLength: spec.padding || 0,
    isEventCapture: spec.eventCapture ? 1 : 0,
    itemContainer: new ListItemContainerProperty({
      itemCount: spec.items.length,
      itemName: spec.items,
      isItemSelectBorderEn: 1,
    }),
  });
}

function toStartupContainer(page: GlassPageSpec): CreateStartUpPageContainer {
  const textObject = page.containers
    .filter((container): container is GlassTextContainerSpec => container.kind === "text")
    .map(textContainer);
  const listObject = page.containers
    .filter((container): container is GlassListContainerSpec => container.kind === "list")
    .map(listContainer);
  return new CreateStartUpPageContainer({
    containerTotalNum: textObject.length + listObject.length,
    textObject,
    listObject,
  });
}

function readAudioPcm(event: EvenHubEvent): Uint8Array | null {
  const raw = event as unknown as {
    audioEvent?: { audioPcm?: unknown };
  };
  const pcm = raw.audioEvent?.audioPcm;
  if (pcm instanceof Uint8Array) return pcm;
  if (pcm instanceof ArrayBuffer) return new Uint8Array(pcm);
  if (Array.isArray(pcm)) return new Uint8Array(pcm);
  return null;
}

export async function connectGlassBridge(params: {
  initialPage: GlassPageSpec;
  onEvent: (event: EvenHubEvent) => void;
  onAudio?: (pcm: Uint8Array) => void;
  onStatus?: (status: string) => void;
}): Promise<GlassBridgeHandle> {
  const bridge = await waitForEvenAppBridge();
  let started = false;

  bridge.onEvenHubEvent((event) => {
    const pcm = readAudioPcm(event);
    if (pcm) {
      params.onAudio?.(pcm);
      return;
    }
    params.onEvent(event);
  });

  async function render(page: GlassPageSpec): Promise<void> {
    const container = toStartupContainer(page);
    if (!started) {
      await bridge.createStartUpPageContainer(container);
      started = true;
      params.onStatus?.("G2 page ready");
      return;
    }
    const rebuild = (bridge as unknown as {
      rebuildPageContainer?: (container: CreateStartUpPageContainer) => Promise<unknown>;
    }).rebuildPageContainer;
    if (rebuild) {
      await rebuild.call(bridge, container);
      return;
    }
    await bridge.createStartUpPageContainer(container);
  }

  await render(params.initialPage);
  return { bridge, render };
}
