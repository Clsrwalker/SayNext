import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";

export type BridgeHandle = {
  bridge: EvenAppBridge;
  render(text: string): Promise<void>;
  setRecording(enabled: boolean): Promise<void>;
};

export type BridgeLifecycleEvent = "foreground_enter" | "foreground_exit" | "abnormal_exit" | "system_exit";

const HEADER_ID = 1;
const BODY_ID = 2;

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

function readAudioPcm(event: EvenHubEvent): Uint8Array | null {
  const audioEvent = (event as unknown as { audioEvent?: { audioPcm?: unknown } }).audioEvent;
  if (!audioEvent) return null;
  return toBytes(audioEvent.audioPcm);
}

function readLifecycleEvent(event: EvenHubEvent): BridgeLifecycleEvent | null {
  const eventType = event.sysEvent?.eventType;
  if (eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) return "foreground_enter";
  if (eventType === OsEventTypeList.FOREGROUND_EXIT_EVENT) return "foreground_exit";
  if (eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT) return "abnormal_exit";
  if (eventType === OsEventTypeList.SYSTEM_EXIT_EVENT) return "system_exit";
  return null;
}

function splitDisplay(text: string): { header: string; body: string } {
  const lines = text.split("\n");
  const header = (lines.shift() || "SAYNEXT").slice(0, 80);
  return {
    header,
    body: lines.join("\n").trim() || "Ready.",
  };
}

export async function connectBridge(params: {
  onEvent: (event: EvenHubEvent) => void;
  onAudio: (pcm: Uint8Array) => void;
  onLifecycle?: (event: BridgeLifecycleEvent) => void;
  onStatus: (message: string) => void;
}): Promise<BridgeHandle> {
  const bridge = await waitForEvenAppBridge();
  let startupRendered = false;
  let startupPromise: Promise<void> | null = null;
  let latestRenderId = 0;
  let lastHeader = "";
  let lastBody = "";

  bridge.onEvenHubEvent((event) => {
    const lifecycle = readLifecycleEvent(event);
    if (lifecycle) {
      params.onLifecycle?.(lifecycle);
      return;
    }

    const pcm = readAudioPcm(event);
    if (pcm) {
      params.onAudio(pcm);
      return;
    }
    params.onEvent(event);
  });

  async function render(text: string): Promise<void> {
    const renderId = ++latestRenderId;
    const { header, body } = splitDisplay(text);
    const headerText = new TextContainerProperty({
      containerID: HEADER_ID,
      containerName: "saynext-header",
      content: header,
      xPosition: 8,
      yPosition: 0,
      width: 560,
      height: 34,
      borderWidth: 0,
      paddingLength: 4,
      isEventCapture: 0,
    });

    const bodyText = new TextContainerProperty({
      containerID: BODY_ID,
      containerName: "saynext-body",
      content: body,
      xPosition: 8,
      yPosition: 38,
      width: 560,
      height: 250,
      borderWidth: 0,
      paddingLength: 4,
      isEventCapture: 1,
    });

    const config = {
      containerTotalNum: 2,
      textObject: [headerText, bodyText],
      listObject: [],
    };

    if (!startupPromise) {
      startupPromise = bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
        .then(() => {
          startupRendered = true;
          params.onStatus("G2 page ready.");
        });
    }

    await startupPromise;
    if (renderId !== latestRenderId) {
      return;
    }

    if (!startupRendered) {
      return;
    }

    if (header !== lastHeader) {
      if (renderId !== latestRenderId) return;
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: HEADER_ID,
        containerName: "saynext-header",
        contentOffset: 0,
        contentLength: header.length,
        content: header,
      }));
      if (renderId !== latestRenderId) return;
      lastHeader = header;
    }

    if (body !== lastBody) {
      if (renderId !== latestRenderId) return;
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: BODY_ID,
        containerName: "saynext-body",
        contentOffset: 0,
        contentLength: body.length,
        content: body,
      }));
      if (renderId !== latestRenderId) return;
      lastBody = body;
    }
  }

  async function setRecording(enabled: boolean): Promise<void> {
    const audioControl = (bridge as unknown as { audioControl?: (enabled: boolean) => Promise<void> | void }).audioControl;
    if (!audioControl) {
      params.onStatus("EvenHub bridge has no audioControl method.");
      return;
    }
    await audioControl.call(bridge, enabled);
  }

  return {
    bridge,
    render,
    setRecording,
  };
}

export async function updateBridgeText(bridge: EvenAppBridge, body: string): Promise<void> {
  await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: BODY_ID,
    containerName: "saynext-body",
    contentOffset: 0,
    contentLength: body.length,
    content: body,
  }));
}
