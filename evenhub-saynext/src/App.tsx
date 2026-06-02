import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectBridge, type BridgeHandle, type BridgeLifecycleEvent } from "./bridge";
import { commandForGesture, normalizeGlassEvent, summarizeRawEvent } from "./events";
import { formatGlassesText, INITIAL_DISPLAY_STATE, reduceServerMessage, type DisplayState } from "./display";
import { DEFAULT_SETTINGS, defaultWsUrl, type SayNextSettings, type ServerMessage } from "./protocol";
import { SayNextWsClient } from "./ws-client";

const STORAGE_KEY = "saynext-evenhub-settings";

type SavedConfig = {
  wsUrl: string;
  token: string;
  userId: string;
  settings: SayNextSettings;
};

function readSavedConfig(): SavedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedConfig>;
      return {
        wsUrl: parsed.wsUrl || defaultWsUrl(),
        token: parsed.token || "",
        userId: parsed.userId || "xiang",
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings || {}),
        },
      };
    }
  } catch {
    // Ignore invalid saved config.
  }
  return {
    wsUrl: defaultWsUrl(),
    token: "",
    userId: "xiang",
    settings: DEFAULT_SETTINGS,
  };
}

export default function App() {
  const [config, setConfig] = useState<SavedConfig>(() => readSavedConfig());
  const [display, setDisplay] = useState<DisplayState>(INITIAL_DISPLAY_STATE);
  const [bridgeStatus, setBridgeStatus] = useState("Bridge not connected");
  const [wsStatus, setWsStatus] = useState("Disconnected");
  const [debugText, setDebugText] = useState("");
  const [eventLog, setEventLog] = useState<string[]>([]);
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const wsRef = useRef<SayNextWsClient | null>(null);
  const displayRef = useRef(display);

  const glassesText = useMemo(() => formatGlassesText(display, config.settings), [display, config.settings]);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    void bridgeRef.current?.render(glassesText).catch((error) => {
      setBridgeStatus(error instanceof Error ? error.message : String(error));
    });
  }, [glassesText]);

  const handleServerMessage = useCallback((message: ServerMessage) => {
    setDisplay((current) => reduceServerMessage(current, message));
  }, []);

  const pushEventLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString();
    setEventLog((current) => [`${time} ${message}`, ...current].slice(0, 24));
  }, []);

  const connectWs = useCallback(() => {
    wsRef.current?.close();
    const client = new SayNextWsClient({
      url: config.wsUrl,
      token: config.token,
      userId: config.userId,
      settings: config.settings,
      onMessage: handleServerMessage,
      onStatus: setWsStatus,
    });
    wsRef.current = client;
    client.connect();
  }, [config, handleServerMessage]);

  const connectGlasses = useCallback(async () => {
    setBridgeStatus("Connecting bridge...");
    try {
      const handleLifecycle = (event: BridgeLifecycleEvent) => {
        pushEventLog(`lifecycle=${event}`);
        setBridgeStatus(`G2 ${event.replace(/_/g, " ")}`);
        if (event === "foreground_exit" || event === "abnormal_exit" || event === "system_exit") {
          void bridgeRef.current?.setRecording(false).catch(() => undefined);
          wsRef.current?.sendControl("stop_listening");
          setDisplay((current) => ({
            ...current,
            recording: false,
            status: event.replace(/_/g, " "),
          }));
        }
      };

      bridgeRef.current = await connectBridge({
        onStatus: setBridgeStatus,
        onAudio: (pcm) => wsRef.current?.sendAudio(pcm),
        onLifecycle: handleLifecycle,
        onEvent: (event) => {
          pushEventLog(summarizeRawEvent(event));
          const gesture = normalizeGlassEvent(event);
          const currentDisplay = displayRef.current;
          const action = commandForGesture(gesture, Boolean(currentDisplay.transcript), currentDisplay.recording);
          if (!action) return;
          if (action === "start_listening") {
            void bridgeRef.current?.setRecording(true);
            wsRef.current?.sendControl("start_listening");
            setDisplay((current) => ({ ...current, recording: true, status: "Listening" }));
          } else if (action === "stop_listening") {
            void bridgeRef.current?.setRecording(false);
            wsRef.current?.sendControl("stop_listening");
            setDisplay((current) => ({ ...current, recording: false, status: "Ready" }));
            wsRef.current?.sendControl("generate");
          } else {
            wsRef.current?.sendControl(action);
          }
        },
      });
      await bridgeRef.current.render(glassesText);
      setBridgeStatus("Bridge connected");
    } catch (error) {
      setBridgeStatus(error instanceof Error ? error.message : String(error));
    }
  }, [glassesText, pushEventLog]);

  const updateSettings = (settings: Partial<SayNextSettings>) => {
    setConfig((current) => {
      const next = { ...current, settings: { ...current.settings, ...settings } };
      wsRef.current?.sendSettings(next.settings);
      return next;
    });
  };

  const startListening = async () => {
    await bridgeRef.current?.setRecording(true);
    wsRef.current?.sendControl("start_listening");
    setDisplay((current) => ({ ...current, recording: true, status: "Listening" }));
  };

  const stopListening = async () => {
    await bridgeRef.current?.setRecording(false);
    wsRef.current?.sendControl("stop_listening");
    setDisplay((current) => ({ ...current, recording: false, status: "Ready" }));
  };

  return (
    <main className="app-shell">
      <section className="panel hero">
        <div>
          <p className="eyebrow">EvenHub SayNext</p>
          <h1>Manual-first G2 control</h1>
        </div>
        <div className="status-grid">
          <span>{wsStatus}</span>
          <span>{bridgeStatus}</span>
        </div>
      </section>

      <section className="panel">
        <h2>Connection</h2>
        <label>
          VPS WebSocket
          <input value={config.wsUrl} onChange={(event) => setConfig({ ...config, wsUrl: event.target.value })} />
        </label>
        <div className="two-col">
          <label>
            User
            <input value={config.userId} onChange={(event) => setConfig({ ...config, userId: event.target.value })} />
          </label>
          <label>
            Token
            <input value={config.token} onChange={(event) => setConfig({ ...config, token: event.target.value })} />
          </label>
        </div>
        <div className="button-row">
          <button onClick={connectWs}>Connect VPS</button>
          <button onClick={connectGlasses}>Connect G2</button>
        </div>
      </section>

      <section className="panel">
        <h2>Mode</h2>
        <div className="segmented">
          {(["auto", "classroom", "interview", "discussion", "daily", "teleprompt"] as const).map((mode) => (
            <button
              key={mode}
              className={config.settings.sceneMode === mode ? "active" : ""}
              onClick={() => updateSettings({ sceneMode: mode })}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="two-col">
          <label>
            Depth
            <select value={config.settings.depth} onChange={(event) => updateSettings({ depth: event.target.value as SayNextSettings["depth"] })}>
              <option value="short">Short</option>
              <option value="normal">Normal</option>
              <option value="deep">Deep</option>
            </select>
          </label>
          <label>
            Display
            <select value={config.settings.displayMode} onChange={(event) => updateSettings({ displayMode: event.target.value as SayNextSettings["displayMode"] })}>
              <option value="answer">Answer</option>
              <option value="transcript">Transcript</option>
              <option value="split">Split</option>
              <option value="teleprompt">Teleprompt</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Controls</h2>
        <div className="button-row">
          <button onClick={startListening}>Start listening</button>
          <button onClick={stopListening}>Stop</button>
          <button onClick={() => wsRef.current?.sendControl("generate")}>Generate</button>
          <button onClick={() => wsRef.current?.sendControl("regenerate")}>Retry</button>
          <button onClick={() => wsRef.current?.sendControl("clear")}>Clear</button>
        </div>
        <div className="button-row">
          <button onClick={() => wsRef.current?.sendControl("page_previous")}>Prev page</button>
          <button onClick={() => wsRef.current?.sendControl("page_next")}>Next page</button>
        </div>
      </section>

      <section className="panel event-log">
        <h2>Event Log</h2>
        <div className="button-row">
          <button onClick={() => setEventLog([])}>Clear log</button>
        </div>
        <pre>{eventLog.length ? eventLog.join("\n") : "No G2/R1 events yet."}</pre>
      </section>

      <section className="panel">
        <h2>Debug Transcript</h2>
        <textarea value={debugText} onChange={(event) => setDebugText(event.target.value)} placeholder="Type transcript text for no-glasses testing." />
        <div className="button-row">
          <button onClick={() => wsRef.current?.sendDebugTranscript(debugText, false)}>Send transcript</button>
          <button onClick={() => wsRef.current?.sendDebugTranscript(debugText, true)}>Send + generate</button>
        </div>
      </section>

      <section className="panel preview">
        <h2>G2 Preview</h2>
        <pre>{glassesText}</pre>
        <p>Audio bytes: {display.audioBytesReceived}</p>
      </section>
    </main>
  );
}
