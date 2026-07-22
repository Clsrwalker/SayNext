import {
  CreateStartUpPageContainer,
  ListItemContainerProperty,
  ListContainerProperty,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { normalizeAudioEventSource, toSdkAudioInputSource, type AudioEventSource } from "./audio-source";
import type { GlassListContainerSpec, GlassPageSpec, GlassTextContainerSpec } from "./glasses-layout";
import type { VoiceInput } from "./types";

export type GlassTextContainerUpdateSpec = {
  id: number;
  name: string;
  content: string;
};

export type BridgeAudioChunk = {
  pcm: Uint8Array;
  source: AudioEventSource;
};

export type GlassBridgeHandle = {
  bridge: EvenAppBridge;
  render(page: GlassPageSpec): Promise<void>;
  updateTextContainer(spec: GlassTextContainerUpdateSpec): Promise<boolean>;
  setAudioEnabled(enabled: boolean, source?: VoiceInput): Promise<boolean>;
};

export const REBUILD_UNAVAILABLE_CODE = "rebuild_unavailable";
export const REBUILD_PAGE_FAILED_CODE = "rebuild_page_failed";
export const STARTUP_PAGE_CREATE_FAILED_CODE = "startup_page_create_failed";

export function getRebuildPageContainer(bridge: unknown): (container: CreateStartUpPageContainer) => Promise<boolean> {
  const rebuild = (bridge as {
    rebuildPageContainer?: (container: CreateStartUpPageContainer) => Promise<boolean>;
  }).rebuildPageContainer;
  if (!rebuild) {
    throw new Error(REBUILD_UNAVAILABLE_CODE);
  }
  return rebuild;
}

export async function createStartupPage(
  bridge: Pick<EvenAppBridge, "createStartUpPageContainer">,
  container: CreateStartUpPageContainer,
): Promise<void> {
  const rawResult = await bridge.createStartUpPageContainer(container);
  const result = StartUpPageCreateResult.normalize(rawResult);
  if (result !== StartUpPageCreateResult.success) {
    throw new Error(`${STARTUP_PAGE_CREATE_FAILED_CODE}:${StartUpPageCreateResult[result]}`);
  }
}

export async function rebuildGlassPage(
  bridge: Pick<EvenAppBridge, "rebuildPageContainer">,
  container: CreateStartUpPageContainer,
): Promise<void> {
  const rebuild = getRebuildPageContainer(bridge);
  const rebuilt = await rebuild.call(bridge, container);
  if (!rebuilt) throw new Error(REBUILD_PAGE_FAILED_CODE);
}

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

function decodeBase64Pcm(value: string): Uint8Array | null {
  const decoder = globalThis.atob;
  if (typeof decoder !== "function") return null;
  try {
    const binary = decoder(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function readAudioChunk(event: EvenHubEvent): BridgeAudioChunk | null {
  const raw = event as unknown as {
    audioEvent?: { audioPcm?: unknown; source?: unknown };
  };
  const pcm = raw.audioEvent?.audioPcm;
  const source = normalizeAudioEventSource(raw.audioEvent?.source);
  if (pcm instanceof Uint8Array) return { pcm, source };
  if (pcm instanceof ArrayBuffer) return { pcm: new Uint8Array(pcm), source };
  if (Array.isArray(pcm)) return { pcm: new Uint8Array(pcm), source };
  if (typeof pcm === "string") {
    const bytes = decodeBase64Pcm(pcm);
    return bytes ? { pcm: bytes, source } : null;
  }
  return null;
}

export async function connectGlassBridge(params: {
  initialPage: GlassPageSpec;
  onEvent: (event: EvenHubEvent) => void;
  onAudio?: (chunk: BridgeAudioChunk) => void;
  onStatus?: (status: string) => void;
}): Promise<GlassBridgeHandle> {
  const bridge = await waitForEvenAppBridge();
  let started = false;

  bridge.onEvenHubEvent((event) => {
    const audio = readAudioChunk(event);
    if (audio) {
      params.onAudio?.(audio);
      return;
    }
    params.onEvent(event);
  });

  async function render(page: GlassPageSpec): Promise<void> {
    const container = toStartupContainer(page);
    if (!started) {
      await createStartupPage(bridge, container);
      started = true;
      params.onStatus?.("G2 page ready");
      return;
    }
    await rebuildGlassPage(bridge, container);
  }

  async function updateTextContainer(spec: GlassTextContainerUpdateSpec): Promise<boolean> {
    if (!started) return false;
    const content = spec.content.slice(0, 2000);
    return bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: spec.id,
      containerName: spec.name,
      contentOffset: 0,
      contentLength: content.length,
      content,
    }));
  }

  await render(params.initialPage);
  return {
    bridge,
    render,
    updateTextContainer,
    setAudioEnabled: (enabled: boolean, source?: VoiceInput) => bridge.audioControl(enabled, source ? toSdkAudioInputSource(source) : undefined),
  };
}
