import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectBridge, type BridgeHandle, type BridgeLifecycleEvent } from "./bridge";
import { commandForGesture, normalizeGlassEvent, redactEventPayload, summarizeRawEvent } from "./events";
import { formatGlassesText, INITIAL_DISPLAY_STATE, reduceServerMessage, type DisplayState } from "./display";
import { DEFAULT_SETTINGS, defaultRelayToken, defaultWsUrl, makeClientSessionId, normalizeSavedWsUrl, normalizeSettings, type SayNextSettings, type ServerMessage } from "./protocol";
import { startPhoneMic, type PhoneMicHandle } from "./phone-audio";
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
        settings: normalizeSettings(parsed.settings),
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
  const [, setAudioStatus] = useState("Audio idle");
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const wsRef = useRef<SayNextWsClient | null>(null);
  const configRef = useRef(config);
  const displayRef = useRef(display);
  const glassesTextRef = useRef("");
  const bridgeConnectingRef = useRef(false);
  const phoneMicRef = useRef<PhoneMicHandle | null>(null);
  const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantListeningRef = useRef(true);
  const previousMicSourceRef = useRef(config.settings.micSource);

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

  const sendControl = useCallback((action: Parameters<SayNextWsClient["sendControl"]>[0]) => {
    wsRef.current?.sendControl(action);
  }, []);

  const sendClientEventLog = useCallback((summary: string, payload?: unknown) => {
    wsRef.current?.sendClientEventLog(summary, payload);
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

  const stopPhoneMic = useCallback(async () => {
    const handle = phoneMicRef.current;
    phoneMicRef.current = null;
    if (!handle) return;
    await handle.stop().catch((error) => {
      setAudioStatus(error instanceof Error ? error.message : String(error));
    });
  }, []);

  const startSelectedAudio = useCallback(async () => {
    wantListeningRef.current = true;
    sendControl("start_listening");

    if (configRef.current.settings.micSource === "phone") {
      await bridgeRef.current?.setRecording(false).catch(() => undefined);
      if (!phoneMicRef.current) {
        phoneMicRef.current = await startPhoneMic({
          onPcm: (pcm) => wsRef.current?.sendAudio(pcm),
          onStatus: setAudioStatus,
        });
      }
      setAudioStatus("Phone mic listening");
    } else {
      await stopPhoneMic();
      await bridgeRef.current?.setRecording(true);
      setAudioStatus("G2 mic listening");
    }

    setDisplay((current) => ({ ...current, recording: true, status: "Listening" }));
  }, [sendControl, stopPhoneMic]);

  const stopSelectedAudio = useCallback(async () => {
    wantListeningRef.current = false;
    await bridgeRef.current?.setRecording(false).catch(() => undefined);
    await stopPhoneMic();
    sendControl("stop_listening");
    setDisplay((current) => ({ ...current, recording: false, status: "Ready" }));
    setAudioStatus("Audio idle");
  }, [sendControl, stopPhoneMic]);

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
      onOpen: () => {
        if (!wantListeningRef.current) return;
        void startSelectedAudio().catch((error) => {
          setAudioStatus(error instanceof Error ? error.message : String(error));
        });
      },
    });
    wsRef.current = client;
    client.connect();
  }, [handleServerMessage, startSelectedAudio]);

  useEffect(() => {
    connectWs();
    return () => {
      clearPendingTap();
      void stopPhoneMic();
      wsRef.current?.close();
    };
  }, [clearPendingTap, connectWs, stopPhoneMic]);

  const connectGlasses = useCallback(async () => {
    if (bridgeRef.current || bridgeConnectingRef.current) return;
    bridgeConnectingRef.current = true;
    setBridgeStatus("Connecting bridge...");
    try {
      const handleLifecycle = (event: BridgeLifecycleEvent) => {
        sendClientEventLog(`lifecycle=${event}`);
        setBridgeStatus(`G2 ${event.replace(/_/g, " ")}`);
        if (event === "foreground_exit" || event === "abnormal_exit" || event === "system_exit") {
          clearPendingTap();
          void stopSelectedAudio().then(() => {
            setDisplay((current) => ({
              ...current,
              recording: false,
              status: event.replace(/_/g, " "),
            }));
          });
        }
      };

      bridgeRef.current = await connectBridge({
        onStatus: setBridgeStatus,
        onAudio: (pcm) => {
          if (configRef.current.settings.micSource === "g2") {
            wsRef.current?.sendAudio(pcm);
          }
        },
        onLifecycle: handleLifecycle,
        onEvent: (event) => {
          const summary = summarizeRawEvent(event);
          sendClientEventLog(summary, redactEventPayload(event));
          const gesture = normalizeGlassEvent(event);
          const action = commandForGesture(gesture, Boolean(displayRef.current.transcript), displayRef.current.recording);
          if (!action) return;
          if (action === "start_listening") {
            void startSelectedAudio().catch((error) => {
              setAudioStatus(error instanceof Error ? error.message : String(error));
            });
          } else if (action === "stop_listening") {
            void stopSelectedAudio();
          } else {
            dispatchGestureAction(action);
          }
        },
      });
      await bridgeRef.current.render(glassesTextRef.current);
      await startSelectedAudio();
      setBridgeStatus("Bridge connected; listening");
    } catch (error) {
      setBridgeStatus(error instanceof Error ? error.message : String(error));
    } finally {
      bridgeConnectingRef.current = false;
    }
  }, [clearPendingTap, dispatchGestureAction, sendClientEventLog, startSelectedAudio, stopSelectedAudio]);

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
    await startSelectedAudio();
  };

  const stopListening = async () => {
    await stopSelectedAudio();
  };

  useEffect(() => {
    if (previousMicSourceRef.current === config.settings.micSource) return;
    previousMicSourceRef.current = config.settings.micSource;
    if (!wantListeningRef.current || !displayRef.current.recording) return;
    void startSelectedAudio().catch((error) => {
      setAudioStatus(error instanceof Error ? error.message : String(error));
    });
  }, [config.settings.micSource, startSelectedAudio]);

  const pageCount = Math.max(display.totalPages, 1);
  const currentPage = display.answerText ? display.pageIndex + 1 : 0;
  const micLabel = config.settings.micSource === "g2" ? "G2 Mic" : "Phone Mic";
  const activityLabel = display.recording ? "Listening" : "Paused";
  const sessionState = wsStatus === "Connected" ? "Connected" : "Disconnected";
  const bridgeReady = bridgeStatus.toLowerCase().includes("connected")
    || bridgeStatus.toLowerCase().includes("ready")
    || display.recording;
  const transcriptLabel = display.transcript
    ? "Last transcript"
    : display.recording
      ? "Waiting for speech"
      : "Transcript paused";
  const answerLabel = display.answerText
    ? `Pinned answer ${currentPage}/${pageCount}`
    : "Pinned answer";

  return (
    <main className="app-shell product-app">
      <section className="session-hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">SayNext</p>
            <h1>Live cue session</h1>
          </div>
          <span className={sessionState === "Connected" ? "presence online" : "presence"}>
            {sessionState}
          </span>
        </div>

        <div className="session-strip">
          <div>
            <span>Mic</span>
            <strong>{micLabel}</strong>
          </div>
          <div>
            <span>State</span>
            <strong>{activityLabel}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{config.settings.sceneMode}</strong>
          </div>
        </div>
      </section>

      <section className="now-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{answerLabel}</p>
            <h2>AI Cues</h2>
          </div>
          <span className={display.answerText ? "answer-state ready" : "answer-state"}>
            {display.answerText ? "Ready" : "Empty"}
          </span>
        </div>
        <div className={display.answerText ? "answer-body" : "answer-body empty"}>
          {display.answerText || "Start listening, then generate when you want a short cue on the glasses."}
        </div>
        <div className="page-controls">
          <button disabled={pageCount <= 1} onClick={() => sendControl("page_previous")}>Previous</button>
          <span>{display.answerText ? `${currentPage}/${pageCount}` : "No answer"}</span>
          <button disabled={pageCount <= 1} onClick={() => sendControl("page_next")}>Next</button>
        </div>
      </section>

      <section className="transcript-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{transcriptLabel}</p>
            <h2>Transcript</h2>
          </div>
          <span className={display.recording ? "presence online" : "presence"}>
            {display.recording ? "Live" : "Paused"}
          </span>
        </div>
        <p className={display.transcript ? "transcript-text" : "transcript-text empty"}>
          {display.transcript || "No speech captured yet."}
        </p>
      </section>

      <section className="settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Session controls</p>
            <h2>Input and mode</h2>
          </div>
          <button className="compact-button" onClick={connectGlasses}>
            {bridgeReady ? "Reconnect" : "Connect G2"}
          </button>
        </div>

        <div className="setting-group">
          <span>Mic source</span>
          <div className="segmented">
            {(["g2", "phone"] as const).map((source) => (
              <button
                key={source}
                className={config.settings.micSource === source ? "active" : ""}
                onClick={() => updateSettings({ micSource: source })}
              >
                {source === "g2" ? "G2 glasses" : "Phone"}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-group">
          <span>Scene</span>
          <div className="segmented compact">
            {(["auto", "classroom", "interview", "discussion", "daily"] as const).map((mode) => (
              <button
                key={mode}
                className={config.settings.sceneMode === mode ? "active" : ""}
                onClick={() => updateSettings({ sceneMode: mode })}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <label>
            Depth
            <select value={config.settings.depth} onChange={(event) => updateSettings({ depth: event.target.value as SayNextSettings["depth"] })}>
              <option value="short">Short</option>
              <option value="normal">Normal</option>
              <option value="deep">Deep</option>
            </select>
          </label>
          <label>
            Language
            <select value={config.settings.outputLanguage} onChange={(event) => updateSettings({ outputLanguage: event.target.value as SayNextSettings["outputLanguage"] })}>
              <option value="english">English</option>
              <option value="chinese">Chinese</option>
            </select>
          </label>
        </div>
      </section>

      <nav className="action-bar" aria-label="Session actions">
        <button className={display.recording ? "secondary-action" : "primary-action"} onClick={display.recording ? stopListening : startListening}>
          {display.recording ? "Pause" : "Resume"}
        </button>
        <button className="primary-action" onClick={() => sendControl("generate")}>Generate</button>
        <button onClick={() => sendControl("regenerate")}>Retry</button>
        <button onClick={() => sendControl("clear")}>Clear</button>
      </nav>
    </main>
  );
}
