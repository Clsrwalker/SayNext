import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectBridge, type BridgeHandle, type BridgeLifecycleEvent } from "./bridge";
import { commandForGesture, normalizeGlassEvent, redactEventPayload, summarizeRawEvent } from "./events";
import { formatGlassesText, INITIAL_DISPLAY_STATE, reduceServerMessage, type DisplayState } from "./display";
import { DEFAULT_SETTINGS, defaultRelayToken, defaultWsUrl, makeClientSessionId, normalizeSavedWsUrl, type SayNextSettings, type ServerMessage } from "./protocol";
import { SayNextWsClient } from "./ws-client";

const STORAGE_KEY = "saynext-evenhub-settings";
const SINGLE_TAP_DELAY_MS = 280;

type SavedConfig = {
  wsUrl: string;
  token: string;
  userId: string;
  sessionId: string;
  settings: SayNextSettings;
};

type EventLogEntry = {
  time: string;
  summary: string;
  payload?: unknown;
};

function readSavedConfig(): SavedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedConfig>;
      return {
        wsUrl: normalizeSavedWsUrl(parsed.wsUrl),
        token: parsed.token || defaultRelayToken(),
        userId: parsed.userId || "xiang",
        sessionId: parsed.sessionId || makeClientSessionId(),
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
    token: defaultRelayToken(),
    userId: "xiang",
    sessionId: makeClientSessionId(),
    settings: DEFAULT_SETTINGS,
  };
}

export default function App() {
  const [config, setConfig] = useState<SavedConfig>(() => readSavedConfig());
  const [display, setDisplay] = useState<DisplayState>(INITIAL_DISPLAY_STATE);
  const [bridgeStatus, setBridgeStatus] = useState("Bridge not connected");
  const [wsStatus, setWsStatus] = useState("Disconnected");
  const [debugText, setDebugText] = useState("");
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const wsRef = useRef<SayNextWsClient | null>(null);
  const configRef = useRef(config);
  const displayRef = useRef(display);
  const glassesTextRef = useRef("");
  const bridgeConnectingRef = useRef(false);
  const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const glassesText = useMemo(() => formatGlassesText(display, config.settings), [display, config.settings]);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    glassesTextRef.current = glassesText;
  }, [glassesText]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

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

  const pushEventLog = useCallback((summary: string, payload?: unknown) => {
    const time = new Date().toLocaleTimeString();
    setEventLog((current) => [{ time, summary, payload }, ...current].slice(0, 40));
  }, []);

  const copyEventLog = useCallback(() => {
    const text = JSON.stringify(eventLog, null, 2);
    void navigator.clipboard?.writeText(text);
  }, [eventLog]);

  const sendControl = useCallback((action: Parameters<SayNextWsClient["sendControl"]>[0]) => {
    wsRef.current?.sendControl(action);
  }, []);

  const clearPendingTap = useCallback(() => {
    if (!pendingTapTimerRef.current) return false;
    clearTimeout(pendingTapTimerRef.current);
    pendingTapTimerRef.current = null;
    return true;
  }, []);

  const dispatchGestureAction = useCallback((action: Parameters<SayNextWsClient["sendControl"]>[0]) => {
    if (action === "generate") {
      if (clearPendingTap()) {
        sendControl("regenerate");
        return;
      }
      pendingTapTimerRef.current = setTimeout(() => {
        pendingTapTimerRef.current = null;
        sendControl("generate");
      }, SINGLE_TAP_DELAY_MS);
      return;
    }

    if (action === "regenerate" || action === "clear") {
      clearPendingTap();
    }
    sendControl(action);
  }, [clearPendingTap, sendControl]);

  const connectWs = useCallback(() => {
    const activeConfig = configRef.current;
    wsRef.current?.close();
    const client = new SayNextWsClient({
      url: activeConfig.wsUrl,
      token: activeConfig.token,
      userId: activeConfig.userId,
      sessionId: activeConfig.sessionId,
      settings: activeConfig.settings,
      onMessage: handleServerMessage,
      onStatus: setWsStatus,
    });
    wsRef.current = client;
    client.connect();
  }, [handleServerMessage]);

  useEffect(() => {
    connectWs();
    return () => {
      clearPendingTap();
      wsRef.current?.close();
    };
  }, [connectWs]);

  const connectGlasses = useCallback(async () => {
    if (bridgeRef.current || bridgeConnectingRef.current) return;
    bridgeConnectingRef.current = true;
    setBridgeStatus("Connecting bridge...");
    try {
      const handleLifecycle = (event: BridgeLifecycleEvent) => {
        pushEventLog(`lifecycle=${event}`);
        setBridgeStatus(`G2 ${event.replace(/_/g, " ")}`);
        if (event === "foreground_exit" || event === "abnormal_exit" || event === "system_exit") {
          clearPendingTap();
          void bridgeRef.current?.setRecording(false).catch(() => undefined);
          sendControl("stop_listening");
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
          pushEventLog(summarizeRawEvent(event), redactEventPayload(event));
          const gesture = normalizeGlassEvent(event);
          const action = commandForGesture(gesture, Boolean(displayRef.current.transcript), displayRef.current.recording);
          if (!action) return;
          if (action === "start_listening") {
            void bridgeRef.current?.setRecording(true);
            sendControl("start_listening");
            setDisplay((current) => ({ ...current, recording: true, status: "Listening" }));
          } else if (action === "stop_listening") {
            void bridgeRef.current?.setRecording(false);
            sendControl("stop_listening");
            setDisplay((current) => ({ ...current, recording: false, status: "Ready" }));
          } else {
            dispatchGestureAction(action);
          }
        },
      });
      await bridgeRef.current.render(glassesTextRef.current);
      await bridgeRef.current.setRecording(true);
      sendControl("start_listening");
      setDisplay((current) => ({ ...current, recording: true, status: "Listening" }));
      setBridgeStatus("Bridge connected; listening");
    } catch (error) {
      setBridgeStatus(error instanceof Error ? error.message : String(error));
    } finally {
      bridgeConnectingRef.current = false;
    }
  }, [clearPendingTap, dispatchGestureAction, pushEventLog, sendControl]);

  useEffect(() => {
    void connectGlasses();
  }, [connectGlasses]);

  const updateSettings = (settings: Partial<SayNextSettings>) => {
    setConfig((current) => {
      const next = { ...current, settings: { ...current.settings, ...settings } };
      wsRef.current?.sendSettings(next.settings);
      return next;
    });
  };

  const startListening = async () => {
    await bridgeRef.current?.setRecording(true);
    sendControl("start_listening");
    setDisplay((current) => ({ ...current, recording: true, status: "Listening" }));
  };

  const stopListening = async () => {
    await bridgeRef.current?.setRecording(false);
    sendControl("stop_listening");
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
          <span className={wsStatus === "Connected" ? "ok" : ""}>{wsStatus}</span>
          <span className={display.recording ? "ok" : ""}>{display.recording ? "Listening" : bridgeStatus}</span>
        </div>
      </section>

      <section className="panel live-card">
        <h2>Live</h2>
        <div className="glance-grid">
          <div>
            <span>Transcript</span>
            <strong>{display.transcript ? "Ready" : "Waiting"}</strong>
          </div>
          <div>
            <span>Answer</span>
            <strong>{display.answerText ? `${display.pageIndex + 1}/${Math.max(display.totalPages, 1)}` : "None"}</strong>
          </div>
          <div>
            <span>Audio</span>
            <strong>{display.audioBytesReceived ? `${Math.round(display.audioBytesReceived / 1024)} KB` : "0 KB"}</strong>
          </div>
        </div>
        <div className="button-row primary-controls">
          <button onClick={() => sendControl("generate")}>Generate</button>
          <button onClick={() => sendControl("regenerate")}>Retry</button>
          <button onClick={() => sendControl("page_previous")}>Prev</button>
          <button onClick={() => sendControl("page_next")}>Next</button>
          <button onClick={() => sendControl("clear")}>Clear</button>
        </div>
        <p className="hint">G2/R1: tap generates from new speech, double tap retries, scroll pages.</p>
      </section>

      <section className="panel">
        <h2>Quick Settings</h2>
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
        <h2>Audio</h2>
        <div className="button-row">
          <button onClick={startListening}>Start listening</button>
          <button onClick={stopListening}>Stop</button>
          <button onClick={connectGlasses}>Reconnect G2</button>
        </div>
      </section>

      <section className="panel preview">
        <h2>G2 Preview</h2>
        <pre>{glassesText}</pre>
        <p>Audio bytes: {display.audioBytesReceived}</p>
      </section>

      <details className="panel">
        <summary>Connection</summary>
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
            Session
            <input value={config.sessionId} onChange={(event) => setConfig({ ...config, sessionId: event.target.value || makeClientSessionId() })} />
          </label>
        </div>
        <label>
          Token
          <input value={config.token} onChange={(event) => setConfig({ ...config, token: event.target.value })} />
        </label>
        <div className="button-row">
          <button onClick={connectWs}>Reconnect VPS</button>
          <button onClick={() => setConfig((current) => ({ ...current, sessionId: makeClientSessionId() }))}>New session</button>
        </div>
      </details>

      <details className="panel">
        <summary>Debug Transcript</summary>
        <textarea value={debugText} onChange={(event) => setDebugText(event.target.value)} placeholder="Type transcript text for no-glasses testing." />
        <div className="button-row">
          <button onClick={() => wsRef.current?.sendDebugTranscript(debugText, false)}>Send transcript</button>
          <button onClick={() => wsRef.current?.sendDebugTranscript(debugText, true)}>Send + generate</button>
        </div>
      </details>

      <details className="panel event-log">
        <summary>Raw Event Log</summary>
        <div className="button-row">
          <button onClick={copyEventLog}>Copy JSON</button>
          <button onClick={() => setEventLog([])}>Clear log</button>
        </div>
        <pre>{eventLog.length ? eventLog.map((entry) => `${entry.time} ${entry.summary}`).join("\n") : "No G2/R1 events yet."}</pre>
      </details>
    </main>
  );
}
