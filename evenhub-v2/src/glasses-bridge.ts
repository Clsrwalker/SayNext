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
import { describeGlassPage, utf8ByteLength, type GlassPageDiagnostic } from "./glass-diagnostics";
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

export type GlassBridgeDiagnostic = Partial<GlassPageDiagnostic> & {
  operation:
    | "startup_create"
    | "startup_adopt_rebuild"
    | "page_rebuild"
    | "startup_recreate"
    | "text_upgrade";
  result: "success" | "false" | "invalid" | "oversize" | "error";
  renderSeq?: number;
  durationMs: number;
  containerName?: string;
  contentBytes?: number;
  error?: string;
};

export type GlassBridgeHandle = {
  bridge: EvenAppBridge;
  render(page: GlassPageSpec): Promise<void>;
  updateTextContainer(spec: GlassTextContainerUpdateSpec): Promise<boolean>;
  setAudioEnabled(enabled: boolean, source?: VoiceInput): Promise<boolean>;
  dispose(): void;
};

export const REBUILD_UNAVAILABLE_CODE = "rebuild_unavailable";
export const REBUILD_PAGE_FAILED_CODE = "rebuild_page_failed";
export const STARTUP_PAGE_CREATE_FAILED_CODE = "startup_page_create_failed";

type ConnectGlassBridgeParams = {
  initialPage: GlassPageSpec;
  onEvent: (event: EvenHubEvent) => void;
  onAudio?: (chunk: BridgeAudioChunk) => void;
  onStatus?: (status: string) => void;
  onDiagnostic?: (diagnostic: GlassBridgeDiagnostic) => void;
};

type ActiveBridgeSubscription = {
  dispose(): void;
};

const activeBridgeSubscriptions = new WeakMap<EvenAppBridge, ActiveBridgeSubscription>();

type NativePageOperation = Exclude<GlassBridgeDiagnostic["operation"], "text_upgrade">;
type NativePageAttemptObserver = (attempt: {
  operation: NativePageOperation;
  result: GlassBridgeDiagnostic["result"];
  durationMs: number;
  error?: string;
}) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  operation: NativePageOperation = "startup_create",
  onAttempt?: NativePageAttemptObserver,
): Promise<void> {
  const result = await createStartupPageResult(bridge, container, operation, onAttempt);
  if (result !== StartUpPageCreateResult.success) {
    throw startupPageCreateError(result);
  }
}

async function createStartupPageResult(
  bridge: Pick<EvenAppBridge, "createStartUpPageContainer">,
  container: CreateStartUpPageContainer,
  operation: NativePageOperation = "startup_create",
  onAttempt?: NativePageAttemptObserver,
): Promise<StartUpPageCreateResult> {
  const startedAt = performance.now();
  try {
    const rawResult = await bridge.createStartUpPageContainer(container);
    const result = StartUpPageCreateResult.normalize(rawResult);
    onAttempt?.({
      operation,
      result: result === StartUpPageCreateResult.success
        ? "success"
        : result === StartUpPageCreateResult.oversize
          ? "oversize"
          : "invalid",
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    onAttempt?.({
      operation,
      result: "error",
      durationMs: Math.round(performance.now() - startedAt),
      error: errorMessage(error),
    });
    throw error;
  }
}

function startupPageCreateError(result: StartUpPageCreateResult): Error {
  return new Error(`${STARTUP_PAGE_CREATE_FAILED_CODE}:${StartUpPageCreateResult[result]}`);
}

export async function rebuildGlassPage(
  bridge: Pick<EvenAppBridge, "rebuildPageContainer">,
  container: CreateStartUpPageContainer,
  operation: NativePageOperation = "page_rebuild",
  onAttempt?: NativePageAttemptObserver,
): Promise<void> {
  const rebuild = getRebuildPageContainer(bridge);
  const startedAt = performance.now();
  let rebuilt: boolean;
  try {
    rebuilt = await rebuild.call(bridge, container);
  } catch (error) {
    onAttempt?.({
      operation,
      result: "error",
      durationMs: Math.round(performance.now() - startedAt),
      error: errorMessage(error),
    });
    throw error;
  }
  onAttempt?.({
    operation,
    result: rebuilt ? "success" : "false",
    durationMs: Math.round(performance.now() - startedAt),
  });
  if (!rebuilt) throw new Error(REBUILD_PAGE_FAILED_CODE);
}

async function createOrAdoptStartupPage(
  bridge: Pick<EvenAppBridge, "createStartUpPageContainer" | "rebuildPageContainer">,
  container: CreateStartUpPageContainer,
  onAttempt?: NativePageAttemptObserver,
): Promise<void> {
  const result = await createStartupPageResult(bridge, container, "startup_create", onAttempt);
  if (result === StartUpPageCreateResult.success) return;

  if (result === StartUpPageCreateResult.invalid) {
    try {
      await rebuildGlassPage(bridge, container, "startup_adopt_rebuild", onAttempt);
      return;
    } catch {
      // A successful rebuild is the only evidence that "invalid" meant an
      // existing native page. Preserve the startup error for all other cases.
    }
  }

  throw startupPageCreateError(result);
}

async function rebuildOrRecreateStartupPage(
  bridge: Pick<EvenAppBridge, "createStartUpPageContainer" | "rebuildPageContainer">,
  container: CreateStartUpPageContainer,
  onAttempt?: NativePageAttemptObserver,
): Promise<void> {
  try {
    await rebuildGlassPage(bridge, container, "page_rebuild", onAttempt);
    return;
  } catch (rebuildError) {
    const message = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
    if (message !== REBUILD_PAGE_FAILED_CODE) throw rebuildError;

    try {
      await createStartupPage(bridge, container, "startup_recreate", onAttempt);
      return;
    } catch {
      // If create also fails, the native page still exists or the page spec is
      // invalid. Keep the original rebuild failure instead of masking it.
      throw rebuildError;
    }
  }
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

function subscribeBridgeEvents(
  bridge: EvenAppBridge,
  params: Pick<ConnectGlassBridgeParams, "onEvent" | "onAudio">,
): () => void {
  activeBridgeSubscriptions.get(bridge)?.dispose();

  let disposed = false;
  const unsubscribe = bridge.onEvenHubEvent((event) => {
    if (disposed) return;
    const audio = readAudioChunk(event);
    if (audio) {
      params.onAudio?.(audio);
      return;
    }
    params.onEvent(event);
  });
  const subscription: ActiveBridgeSubscription = {
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        unsubscribe();
      } finally {
        if (activeBridgeSubscriptions.get(bridge) === subscription) {
          activeBridgeSubscriptions.delete(bridge);
        }
      }
    },
  };
  activeBridgeSubscriptions.set(bridge, subscription);
  return () => subscription.dispose();
}

export async function connectResolvedGlassBridge(
  bridge: EvenAppBridge,
  params: ConnectGlassBridgeParams,
): Promise<GlassBridgeHandle> {
  let started = false;
  let renderSeq = 0;

  async function render(page: GlassPageSpec): Promise<void> {
    const currentRenderSeq = ++renderSeq;
    const pageDiagnostic = describeGlassPage(page);
    const observeAttempt: NativePageAttemptObserver = (attempt) => {
      params.onDiagnostic?.({
        ...pageDiagnostic,
        ...attempt,
        renderSeq: currentRenderSeq,
      });
    };
    const container = toStartupContainer(page);
    if (!started) {
      await createOrAdoptStartupPage(bridge, container, observeAttempt);
      started = true;
      params.onStatus?.("G2 page ready");
      return;
    }
    await rebuildOrRecreateStartupPage(bridge, container, observeAttempt);
  }

  async function updateTextContainer(spec: GlassTextContainerUpdateSpec): Promise<boolean> {
    if (!started) return false;
    const content = spec.content.slice(0, 2000);
    const startedAt = performance.now();
    try {
      const result = await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: spec.id,
        containerName: spec.name,
        contentOffset: 0,
        contentLength: content.length,
        content,
      }));
      if (spec.name !== "transcript" || result !== true) {
        params.onDiagnostic?.({
          operation: "text_upgrade",
          result: result ? "success" : "false",
          durationMs: Math.round(performance.now() - startedAt),
          containerName: spec.name,
          contentBytes: utf8ByteLength(content),
        });
      }
      return result;
    } catch (error) {
      params.onDiagnostic?.({
        operation: "text_upgrade",
        result: "error",
        durationMs: Math.round(performance.now() - startedAt),
        containerName: spec.name,
        contentBytes: utf8ByteLength(content),
        error: errorMessage(error),
      });
      throw error;
    }
  }

  await render(params.initialPage);
  const unsubscribe = subscribeBridgeEvents(bridge, params);
  return {
    bridge,
    render,
    updateTextContainer,
    setAudioEnabled: (enabled: boolean, source?: VoiceInput) => bridge.audioControl(enabled, source ? toSdkAudioInputSource(source) : undefined),
    dispose: unsubscribe,
  };
}

export async function connectGlassBridge(
  params: ConnectGlassBridgeParams,
): Promise<GlassBridgeHandle> {
  const bridge = await waitForEvenAppBridge();
  return connectResolvedGlassBridge(bridge, params);
}
