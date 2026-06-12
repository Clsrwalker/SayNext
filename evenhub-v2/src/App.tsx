import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Lightbulb,
  MoreHorizontal,
  Pause,
  Plus,
  Settings2,
  Square,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { PHONE_CUE_LABEL } from "./cue-icons";
import {
  conversationStartPayload,
  createClientMessage,
  cueFromServer,
  deleteConversationRecord,
  loadBootstrap,
  loadConversationDetail,
  partialTranscriptFromServer,
  transcriptFromServer,
  wsUrl,
  type EvenHubV2ServerMessage,
} from "./evenhub-v2-client";
import { planPauseToggle } from "./conversation-audio";
import { normalizeGlassGesture, readGlassListSelection, type GlassListSelection } from "./events";
import {
  DETAIL_BACK_DOUBLE_CLICK_SUPPRESS_MS,
  decideGlassEvent,
  shouldSuppressDuplicateMenuDoubleClick,
} from "./glasses-event-controller";
import { connectGlassBridge, type GlassBridgeHandle } from "./glasses-bridge";
import { updateGlassContentSetting } from "./glass-content-settings";
import { buildGlassesPage } from "./glasses-layout";
import { createGlassRenderer, type GlassRendererHandle } from "./glasses-renderer";
import { buildMenuItems, INITIAL_GLASS_STATE, makeAutoCueVisibility, startLiveGlasses } from "./glasses-state";
import { removeRecordById, replaceRecordInPlace } from "./record-list";
import { shouldAutoFollowTranscriptScroll } from "./transcript-scroll";
import { normalizeSupportedVoiceInput } from "./voice-input";
import type {
  AiCue,
  ConversationRecord,
  ConversationSettings,
  ConversationTab,
  CueCategory,
  GlassGesture,
  GlassRuntimeState,
  Prenote,
  PrenoteFile,
  TranscriptLine,
} from "./types";

const DEFAULT_SETTINGS: ConversationSettings = {
  voiceInput: "glasses",
  language: "english",
  glassContent: {
    aiCue: true,
    transcript: true,
  },
  autoPopup: true,
  cueDuration: 10000,
};

type Screen = "home" | "settings" | "noteEditor" | "live" | "history" | "conversationSettings";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function cueIcon(category: CueCategory) {
  if (category === "concept") return <BookOpen size={22} strokeWidth={1.7} />;
  if (category === "response") return <span className="question-icon">?</span>;
  if (category === "suggestion") return <Lightbulb size={22} strokeWidth={1.7} />;
  return <UserRound size={22} strokeWidth={1.7} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function selectedPrenote(prenotes: Prenote[]): Prenote | null {
  const selected = prenotes.filter((note) => note.selected);
  if (!selected.length) return null;
  if (selected.length === 1) return selected[0];
  return {
    id: "combined-prenote",
    title: "Selected Notes",
    text: selected.map((note) => `# ${note.title}\n${note.text}`).join("\n\n---\n\n"),
    selected: true,
    files: selected.flatMap((note) => note.files),
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<ConversationSettings>(DEFAULT_SETTINGS);
  const [records, setRecords] = useState<ConversationRecord[]>([]);
  const [prenotes, setPrenotes] = useState<Prenote[]>([]);
  const [cues, setCues] = useState<AiCue[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [liveTab, setLiveTab] = useState<ConversationTab>("transcript");
  const [historyTab, setHistoryTab] = useState<ConversationTab>("summary");
  const [activeRecordId, setActiveRecordId] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState<Prenote | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(24);
  const [glassState, setGlassState] = useState<GlassRuntimeState>(() => INITIAL_GLASS_STATE);
  const [connectionStatus, setConnectionStatus] = useState("offline");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [swipedRecordId, setSwipedRecordId] = useState<string | null>(null);
  const bridgeRef = useRef<GlassBridgeHandle | null>(null);
  const glassRendererRef = useRef<GlassRendererHandle | null>(null);
  const connectingBridgeRef = useRef(false);
  const pendingGlassRenderRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const isListeningRef = useRef(false);
  const pendingStartPayloadRef = useRef<unknown | null>(null);
  const pendingAudioStartRef = useRef(false);
  const recordPointerRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const skipNextRecordClickRef = useRef(false);
  const pendingDetailBackViewRef = useRef<"cue_detail" | "prenote_detail" | null>(null);
  const suppressMenuDoubleClickUntilRef = useRef(0);

  const activePrenote = useMemo(() => selectedPrenote(prenotes), [prenotes]);
  const activeRecord = records.find((record) => record.id === activeRecordId) || records[0] || null;
  const effectiveVoiceInput = normalizeSupportedVoiceInput(settings.voiceInput);
  const glassStateRef = useRef(glassState);
  const cuesRef = useRef(cues);
  const transcriptRef = useRef(transcript);
  const activePrenoteRef = useRef(activePrenote);
  const settingsRef = useRef(settings);
  const glassPage = useMemo(() => buildGlassesPage({
    state: glassState,
    cues,
    prenote: activePrenote,
    transcript,
    glassContent: settings.glassContent,
  }), [activePrenote, cues, glassState, settings.glassContent, transcript]);
  const glassPageRef = useRef(glassPage);

  useEffect(() => {
    glassPageRef.current = glassPage;
    glassStateRef.current = glassState;
    cuesRef.current = cues;
    transcriptRef.current = transcript;
    activePrenoteRef.current = activePrenote;
    settingsRef.current = settings;
    activeConversationIdRef.current = activeConversationId;
    isListeningRef.current = isListening;
  }, [activeConversationId, activePrenote, cues, glassPage, glassState, isListening, settings, transcript]);

  useEffect(() => {
    const normalized = normalizeSupportedVoiceInput(settings.voiceInput);
    if (normalized !== settings.voiceInput) {
      setSettings((current) => ({
        ...current,
        voiceInput: normalizeSupportedVoiceInput(current.voiceInput),
      }));
    }
  }, [settings.voiceInput]);

  useEffect(() => {
    let cancelled = false;
    void loadBootstrap()
      .then((bootstrap) => {
        if (cancelled) return;
        if (bootstrap.settings) {
          setSettings((current) => ({
            ...current,
            ...bootstrap.settings,
            glassContent: {
              ...current.glassContent,
              ...bootstrap.settings?.glassContent,
            },
          }));
        }
        setPrenotes(bootstrap.prenotes);
        setRecords(bootstrap.records);
        setActiveRecordId(bootstrap.records[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setConnectionStatus("bootstrap_failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      setConnectionStatus("connecting");
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (disposed) return;
        setConnectionStatus("connected");
        ws.send(JSON.stringify(createClientMessage("hello", { settings: {} })));
        if (pendingStartPayloadRef.current) {
          const payload = pendingStartPayloadRef.current;
          pendingStartPayloadRef.current = null;
          ws.send(JSON.stringify(createClientMessage("conversation_start", payload, activeConversationIdRef.current)));
        }
        if (pendingAudioStartRef.current && activeConversationIdRef.current && isListeningRef.current && !pendingStartPayloadRef.current) {
          pendingAudioStartRef.current = false;
          ws.send(JSON.stringify(createClientMessage("audio_start", { codec: "linear16", sampleRate: 16000, channels: 1 }, activeConversationIdRef.current)));
        }
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          handleServerMessage(JSON.parse(event.data) as EvenHubV2ServerMessage);
        } catch {
          setConnectionStatus("message_error");
        }
      };
      ws.onerror = () => setConnectionStatus("ws_error");
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) return;
        setConnectionStatus("offline");
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (!isListening) return;
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [isListening]);

  useEffect(() => {
    if (bridgeRef.current && glassRendererRef.current) {
      pendingGlassRenderRef.current = false;
      void glassRendererRef.current.render(glassPage).catch(handleGlassRenderError);
      return;
    }
    if (connectingBridgeRef.current) {
      pendingGlassRenderRef.current = true;
      return;
    }
    connectingBridgeRef.current = true;
    const initialPage = glassPage;
    void connectGlassBridge({
      initialPage: glassPage,
      onEvent: (event) => {
        const gesture = normalizeGlassGesture(event);
        if (gesture) handleGlassGesture(gesture, readGlassListSelection(event));
      },
      onAudio: (pcm) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN && activeConversationIdRef.current && isListeningRef.current) {
          ws.send(pcm);
        }
      },
      })
      .then(async (bridge) => {
        bridgeRef.current = bridge;
        const latestPage = glassPageRef.current;
        let renderedPage = initialPage;
        if (pendingGlassRenderRef.current || latestPage !== initialPage) {
          try {
            await bridge.render(latestPage);
            renderedPage = latestPage;
          } catch (error) {
            handleGlassRenderError(error);
          }
        }
        pendingGlassRenderRef.current = false;
        glassRendererRef.current = createGlassRenderer(bridge, renderedPage);
        if (renderedPage !== latestPage) {
          void glassRendererRef.current.render(latestPage).catch(handleGlassRenderError);
        }
        if (isListeningRef.current) {
          void bridge.setAudioEnabled(true).then((enabled) => {
            if (!enabled) setConnectionStatus("g2_mic_failed");
          }).catch(() => setConnectionStatus("g2_mic_error"));
        }
      })
      .catch(handleGlassRenderError)
      .finally(() => {
        connectingBridgeRef.current = false;
      });
  }, [glassPage]);

  useEffect(() => () => {
    glassRendererRef.current?.dispose();
  }, []);

  const elapsedLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `00:${minutes}:${seconds}`;
  }, [elapsedSeconds]);

  function commitGlassState(nextState: GlassRuntimeState) {
    glassStateRef.current = nextState;
    setGlassState(nextState);
  }

  function handleGlassRenderError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setConnectionStatus(message.includes("rebuild_unavailable") ? "glass_render_unsupported" : "glass_render_error");
  }

  function sendWs(type: string, payload: unknown = {}) {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      setConnectionStatus("offline");
      return false;
    }
    ws.send(JSON.stringify(createClientMessage(type, payload, activeConversationIdRef.current)));
    return true;
  }

  function isWsOpen() {
    return wsRef.current?.readyState === WebSocket.OPEN;
  }

  function sendAudioStart() {
    return sendWs("audio_start", { codec: "linear16", sampleRate: 16000, channels: 1 });
  }

  function sendAudioStop() {
    return sendWs("audio_stop", {});
  }

  function setGlassAudioEnabled(enabled: boolean) {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    void bridge.setAudioEnabled(enabled).then((ok) => {
      if (!ok && enabled) setConnectionStatus("g2_mic_failed");
    }).catch(() => {
      if (enabled) setConnectionStatus("g2_mic_error");
    });
  }

  function handleServerMessage(message: EvenHubV2ServerMessage) {
    if (message.type === "ready") {
      setConnectionStatus("ready");
      return;
    }
    if (message.type === "conversation_started") {
      const id = message.payload?.conversationId || message.conversationId || null;
      setActiveConversationId(id);
      activeConversationIdRef.current = id;
      setConnectionStatus("listening_ready");
      if (pendingAudioStartRef.current) {
        pendingAudioStartRef.current = false;
        window.setTimeout(() => {
          sendAudioStart();
        }, 0);
      }
      return;
    }
    if (message.type === "audio_status") {
      setConnectionStatus(message.payload?.audioStatus || "audio");
      return;
    }
    if (message.type === "transcript_partial") {
      const partial = partialTranscriptFromServer(message);
      setTranscript((current) => {
        const withoutPartial = current.filter((line) => !line.partial);
        const next = partial.text ? [...withoutPartial, partial] : withoutPartial;
        transcriptRef.current = next;
        return next;
      });
      return;
    }
    if (message.type === "transcript_final") {
      const line = transcriptFromServer(message);
      setTranscript((current) => {
        const withoutPartial = current.filter((item) => !item.partial);
        if (withoutPartial.some((item) => item.id === line.id)) {
          const next = withoutPartial.map((item) => item.id === line.id ? line : item);
          transcriptRef.current = next;
          return next;
        }
        const next = [...withoutPartial, line];
        transcriptRef.current = next;
        return next;
      });
      return;
    }
    if (message.type === "cue_created") {
      const cue = cueFromServer(message);
      setCues((current) => {
        if (current.some((item) => item.id === cue.id)) return current;
        const next = [cue, ...current];
        cuesRef.current = next;
        return next;
      });
      setGlassState((current) => {
        const next = current.view === "main"
          ? {
              ...current,
              latestCueId: cue.id,
              activeCueId: cue.id,
              autoCueVisibleUntil: makeAutoCueVisibility(settingsRef.current.cueDuration, Date.now()),
            }
          : {
              ...current,
              latestCueId: cue.id,
              activeCueId: current.activeCueId || cue.id,
              autoCueVisibleUntil: makeAutoCueVisibility(settingsRef.current.cueDuration, Date.now()),
            };
        glassStateRef.current = next;
        return next;
      });
      return;
    }
    if (message.type === "conversation_saved") {
      const id = message.payload?.conversationId || message.conversationId || activeConversationIdRef.current;
      setIsListening(false);
      setGlassAudioEnabled(false);
      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      if (id) {
        void loadConversationDetail(id)
          .then((record) => {
            setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
            setActiveRecordId(record.id);
            setHistoryTab("summary");
            setScreen("history");
          })
          .catch(() => setScreen("home"));
      } else {
        setScreen("home");
      }
      return;
    }
    if (message.type === "error") {
      setConnectionStatus(message.payload?.code || "error");
    }
  }

  function handleGlassGesture(gesture: GlassGesture, selection: GlassListSelection = { index: null, name: null }) {
    const nowMs = Date.now();
    let currentState = glassStateRef.current;
    if (shouldSuppressDuplicateMenuDoubleClick({
      state: currentState,
      gesture,
      nowMs,
      suppressUntilMs: suppressMenuDoubleClickUntilRef.current,
    })) {
      return;
    }
    if (gesture === "double_click" && pendingDetailBackViewRef.current && currentState.view === "menu") {
      currentState = {
        ...currentState,
        view: pendingDetailBackViewRef.current,
      };
    }
    const menuItems = buildMenuItems({ prenote: activePrenoteRef.current, cues: cuesRef.current });
    const decision = decideGlassEvent({
      state: currentState,
      gesture,
      selection,
      menuItems,
    });

    if (!decision.shouldRender) {
      glassStateRef.current = decision.state;
      return;
    }

    const isDetailBack = gesture === "double_click"
      && (currentState.view === "cue_detail" || currentState.view === "prenote_detail")
      && decision.state.view === "menu";

    if (decision.state.view === "cue_detail" || decision.state.view === "prenote_detail") {
      pendingDetailBackViewRef.current = decision.state.view;
    } else if (gesture === "double_click" || decision.state.view === "main" || decision.state.view === "root_idle") {
      pendingDetailBackViewRef.current = null;
    }
    if (isDetailBack) {
      suppressMenuDoubleClickUntilRef.current = nowMs + DETAIL_BACK_DOUBLE_CLICK_SUPPRESS_MS;
    }

    commitGlassState(decision.state);
    if (decision.effect === "manual_generate") {
      setConnectionStatus("manual_disabled");
    }
  }

  function togglePrenote(id: string) {
    setPrenotes((current) => current.map((note) => note.id === id ? { ...note, selected: !note.selected } : note));
  }

  function openNewNote() {
    setNoteDraft({
      id: `pn-${Date.now()}`,
      title: "新笔记",
      text: "",
      selected: true,
      files: [],
    });
    setScreen("noteEditor");
  }

  function saveNoteDraft() {
    if (!noteDraft) return;
    const firstLine = noteDraft.text.split(/\r?\n/).find((line) => line.trim())?.trim();
    const nextNote = {
      ...noteDraft,
      title: firstLine ? firstLine.replace(/^#+\s*/, "").slice(0, 48) : noteDraft.title,
    };
    setPrenotes((current) => [nextNote, ...current]);
    setNoteDraft(null);
    setScreen("home");
  }

  function addFiles(files: FileList | null) {
    if (!noteDraft || !files?.length) return;
    const existing = noteDraft.files;
    const next: PrenoteFile[] = [];
    for (const file of Array.from(files)) {
      if (existing.length + next.length >= MAX_FILES) break;
      if (file.size > MAX_FILE_SIZE) continue;
      next.push({
        id: `file-${Date.now()}-${next.length}`,
        name: file.name,
        sizeBytes: file.size,
        status: "ready",
      });
    }
    setNoteDraft({
      ...noteDraft,
      files: [...existing, ...next],
      text: noteDraft.text || "Uploaded files will be converted into editable prepared-note text in the backend phase.",
    });
  }

  function startConversation() {
    const voiceInput = normalizeSupportedVoiceInput(settings.voiceInput);
    const startSettings = voiceInput === settings.voiceInput ? settings : { ...settings, voiceInput };
    const payload = conversationStartPayload(startSettings, activePrenote);
    const started = sendWs("conversation_start", payload);
    if (!started) {
      pendingStartPayloadRef.current = payload;
      setConnectionStatus("connecting_backend");
    }
    pendingAudioStartRef.current = true;
    setIsListening(true);
    setElapsedSeconds(0);
    setCues([]);
    setTranscript([]);
    setGlassState(startLiveGlasses(null));
    setGlassAudioEnabled(voiceInput === "glasses");
    setLiveTab("transcript");
    setScreen("live");
  }

  function endConversation() {
    setIsListening(false);
    setGlassAudioEnabled(false);
    pendingStartPayloadRef.current = null;
    pendingAudioStartRef.current = false;
    const sent = sendWs("conversation_end", {});
    if (!sent || !activeConversationIdRef.current) {
      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      setGlassState(INITIAL_GLASS_STATE);
      setScreen("home");
    }
  }

  function togglePauseConversation() {
    const voiceInput = normalizeSupportedVoiceInput(settingsRef.current.voiceInput);
    const plan = planPauseToggle({
      isListening: isListeningRef.current,
      wsOpen: isWsOpen(),
      voiceInput,
    });
    setIsListening(plan.nextListening);
    isListeningRef.current = plan.nextListening;
    setGlassAudioEnabled(plan.enableGlassAudio);

    if (plan.wsType === "audio_start") {
      pendingAudioStartRef.current = false;
      sendAudioStart();
    } else if (plan.wsType === "audio_stop") {
      pendingAudioStartRef.current = false;
      sendAudioStop();
    } else if (plan.offlineStatus === "resume_offline") {
      pendingAudioStartRef.current = true;
    }

    if (plan.offlineStatus) {
      setConnectionStatus(plan.offlineStatus);
    } else {
      setConnectionStatus(plan.nextListening ? "listening" : "paused");
    }
  }

  function openHistoryRecord(id: string) {
    if (swipedRecordId === id) {
      setSwipedRecordId(null);
      return;
    }
    setActiveRecordId(id);
    setHistoryTab("summary");
    setScreen("history");
    void loadConversationDetail(id)
      .then((record) => {
        setRecords((current) => replaceRecordInPlace(current, record));
        setActiveRecordId(record.id);
      })
      .catch(() => undefined);
  }

  function handleRecordPointerDown(id: string, event: { clientX: number; clientY: number }) {
    recordPointerRef.current = { id, x: event.clientX, y: event.clientY };
  }

  function handleRecordPointerUp(id: string, event: { clientX: number; clientY: number }) {
    const start = recordPointerRef.current;
    recordPointerRef.current = null;
    if (!start || start.id !== id) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 38 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    skipNextRecordClickRef.current = true;
    setSwipedRecordId(deltaX < 0 ? id : null);
  }

  function handleRecordClick(id: string) {
    if (skipNextRecordClickRef.current) {
      skipNextRecordClickRef.current = false;
      return;
    }
    openHistoryRecord(id);
  }

  function deleteHistoryRecord(id: string) {
    void deleteConversationRecord(id)
      .then(() => {
        setRecords((current) => removeRecordById(current, id));
        setSwipedRecordId(null);
        if (activeRecordId === id) {
          setActiveRecordId("");
        }
      })
      .catch(() => setConnectionStatus("delete_failed"));
  }

  function renderHeader(title: string, right?: React.ReactNode, backTarget: Screen = "home") {
    return (
      <header className="topbar">
        <button className="icon-button" aria-label="Back" onClick={() => setScreen(backTarget)}>
          <ArrowLeft size={27} strokeWidth={1.5} />
        </button>
        <h1>{title}</h1>
        <div className="topbar-right">{right}</div>
      </header>
    );
  }

  if (screen === "settings") {
    return (
      <main className="phone-shell">
        {renderHeader("设置", <span />, "home")}
        <section className="settings-section">
          <h2>语音输入方式</h2>
          <div className="setting-card tall">
            <button className="setting-choice" onClick={() => setSettings({ ...settings, voiceInput: "glasses" })}>
              眼镜 {effectiveVoiceInput === "glasses" && <Check size={28} />}
            </button>
            <button
              className="setting-choice"
              disabled
              onClick={() => setSettings({ ...settings, voiceInput: "phone" })}
            >
              手机 {effectiveVoiceInput === "phone" && <Check size={28} />}
            </button>
          </div>
        </section>
        <section className="settings-section">
          <h2>语言</h2>
          <button className="setting-row" onClick={() => setSettings({ ...settings, language: settings.language === "english" ? "chinese" : "english" })}>
            <span>语音语言</span>
            <span>{settings.language === "english" ? "英语" : settings.language === "chinese" ? "中文" : "自动"} <ChevronRight size={25} /></span>
          </button>
        </section>
        <section className="settings-section">
          <h2>眼镜显示内容</h2>
          <div className="setting-card">
            <label className="switch-row">
              <span>AI 提示</span>
              <input
                type="checkbox"
                checked={settings.glassContent.aiCue}
                onChange={(event) => setSettings((current) => updateGlassContentSetting(current, "aiCue", event.target.checked))}
              />
            </label>
            <label className="switch-row">
              <span>实时转录</span>
              <input
                type="checkbox"
                checked={settings.glassContent.transcript}
                onChange={(event) => setSettings((current) => updateGlassContentSetting(current, "transcript", event.target.checked))}
              />
            </label>
          </div>
          <p className="muted-copy">这些设置只影响对话期间的眼镜界面。</p>
        </section>
        <section className="settings-section">
          <div className="setting-card">
            <label className="switch-row">
              <span>自动弹窗</span>
              <input type="checkbox" checked={settings.autoPopup} onChange={(event) => setSettings({ ...settings, autoPopup: event.target.checked })} />
            </label>
            <button className="setting-row" onClick={() => setSettings({
              ...settings,
              cueDuration: settings.cueDuration === 5000 ? 10000 : settings.cueDuration === 10000 ? 15000 : settings.cueDuration === 15000 ? "forever" : 5000,
            })}>
              <span>提示时长</span>
              <span>{settings.cueDuration === "forever" ? "常驻" : `${settings.cueDuration / 1000}秒`} <ChevronRight size={25} /></span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "noteEditor" && noteDraft) {
    return (
      <main className="phone-shell modal-page">
        <header className="modal-header">
          <h1>新笔记</h1>
          <button className="icon-button" aria-label="Cancel" onClick={() => setScreen("home")}>
            <X size={37} strokeWidth={1.35} />
          </button>
        </header>
        <section className="note-editor">
          <textarea
            maxLength={5000}
            value={noteDraft.text}
            placeholder="你可以在会话期间在眼镜上访问这些笔记。"
            onChange={(event) => setNoteDraft({ ...noteDraft, text: event.target.value })}
          />
          <span className="char-count">{noteDraft.text.length}/5000</span>
        </section>
        <section className="file-section">
          <label className="file-add">
            <Plus size={32} strokeWidth={1.6} />
            <input
              type="file"
              multiple
              accept=".txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg,.webp,.heic"
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
          <p>最多添加 5 个文件。每个最大 5 MB。</p>
          {noteDraft.files.map((file) => (
            <div className="file-pill" key={file.id}>
              <Upload size={17} />
              <span>{file.name}</span>
              <small>{formatFileSize(file.sizeBytes)}</small>
            </div>
          ))}
        </section>
        <section className="note-info">
          <Square size={23} strokeWidth={1.5} />
          <p>对话会使用准备笔记理解上下文，帮助生成实时 AI 提示。</p>
        </section>
        <footer className="bottom-actions">
          <button className="soft-danger" onClick={() => setNoteDraft(null)}>
            删除
          </button>
          <button className="muted-action" disabled={!noteDraft.text.trim() && !noteDraft.files.length} onClick={saveNoteDraft}>
            保存
          </button>
        </footer>
      </main>
    );
  }

  if (screen === "conversationSettings") {
    return (
      <main className="phone-shell">
        {renderHeader("对话设置", <span />, "live")}
        <section className="settings-section">
          <h2>语音输入方式</h2>
          <div className="setting-card tall locked">
            <div className="setting-choice">眼镜 {effectiveVoiceInput === "glasses" && <Check size={28} />}</div>
            <div className="setting-choice">手机 {effectiveVoiceInput === "phone" && <Check size={28} />}</div>
          </div>
        </section>
        <section className="settings-section">
          <h2>眼镜显示内容</h2>
          <div className="setting-card">
            <label className="switch-row">
              <span>AI 提示</span>
              <input
                type="checkbox"
                checked={settings.glassContent.aiCue}
                onChange={(event) => setSettings((current) => updateGlassContentSetting(current, "aiCue", event.target.checked))}
              />
            </label>
            <label className="switch-row">
              <span>实时转录</span>
              <input
                type="checkbox"
                checked={settings.glassContent.transcript}
                onChange={(event) => setSettings((current) => updateGlassContentSetting(current, "transcript", event.target.checked))}
              />
            </label>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "live") {
    return (
      <main className="phone-shell live-page">
        {renderHeader("对话", (
          <button className="icon-button" aria-label="Conversation settings" onClick={() => setScreen("conversationSettings")}>
            <MoreHorizontal size={33} strokeWidth={1.5} />
          </button>
        ), "home")}
        <section className="conversation-title-card live-title">
          <div>
            <h2>新对话</h2>
            <p>01:35 PM 2026/06/05 · 哈利法克斯, CA</p>
            <p className="connection-status">连接状态：{connectionStatus}</p>
          </div>
          <span className="live-duration"><span />{elapsedLabel}</span>
        </section>
        {renderTabs(liveTab, setLiveTab, Boolean(activePrenote))}
        <section className="live-content">
          {liveTab === "summary" && renderCuePanel(cues)}
          {liveTab === "transcript" && renderTranscript(transcript, true)}
          {liveTab === "prenote" && renderPrenote(activePrenote)}
        </section>
        <footer className="live-actions">
          <button onClick={togglePauseConversation}>
            <Pause size={29} strokeWidth={1.4} /> {isListening ? "暂停" : "继续"}
          </button>
          <button onClick={endConversation}>
            <X size={31} strokeWidth={1.35} /> 结束
          </button>
        </footer>
      </main>
    );
  }

  if (screen === "history" && !activeRecord) {
    return (
      <main className="phone-shell">
        {renderHeader("对话", <span />, "home")}
        <section className="history-content">
          <section className="summary-card">
            <p>-</p>
          </section>
        </section>
      </main>
    );
  }

  if (screen === "history" && activeRecord) {
    return (
      <main className="phone-shell">
        {renderHeader("对话", (
          <button className="icon-button" aria-label="More">
            <MoreHorizontal size={33} strokeWidth={1.5} />
          </button>
        ), "home")}
        <section className="conversation-title-card">
          <div>
            <h2>{activeRecord.title}</h2>
            <p>{activeRecord.startedAt} · {activeRecord.location}</p>
          </div>
          <span>{activeRecord.duration}</span>
        </section>
        {renderTabs(historyTab, setHistoryTab, Boolean(activeRecord.usedPrenote))}
        <section className="history-content">
          {historyTab === "summary" && renderSummary(activeRecord)}
          {historyTab === "transcript" && renderTranscript(activeRecord.transcript)}
          {historyTab === "prenote" && renderPrenote(activeRecord.usedPrenote || null)}
        </section>
      </main>
    );
  }

  return (
    <main className="phone-shell home-page">
      <header className="home-header">
        <button className="corner-mark" aria-label="Main">
          <span />
        </button>
        <h1>对话</h1>
        <button className="icon-button" aria-label="Settings" onClick={() => setScreen("settings")}>
          <Settings2 size={33} strokeWidth={1.55} />
        </button>
      </header>

      <section className="record-section">
        <div className="section-row">
          <h2>我的记录</h2>
          <span>{records.length}</span>
        </div>
        <div className="record-list">
          {records.map((record) => (
            <div className={swipedRecordId === record.id ? "record-row swiped" : "record-row"} key={record.id}>
              <button className="record-delete-button" onClick={() => deleteHistoryRecord(record.id)}>
                删除
              </button>
              <button
                className="record-card"
                onClick={() => handleRecordClick(record.id)}
                onPointerDown={(event) => handleRecordPointerDown(record.id, event)}
                onPointerUp={(event) => handleRecordPointerUp(record.id, event)}
                onPointerCancel={() => {
                  recordPointerRef.current = null;
                }}
              >
                <div>
                  <h3>{record.title}</h3>
                  <p>{record.startedAt} · {record.location}</p>
                </div>
                <ChevronRight size={34} strokeWidth={1.4} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="prenote-dock">
        <h2>预备笔记</h2>
        <div className="prenote-row">
          <button className="add-note-card" onClick={openNewNote}>
            <Plus size={45} strokeWidth={1.45} />
          </button>
          {prenotes.map((note) => (
            <button className="prenote-card" key={note.id} onClick={() => togglePrenote(note.id)}>
              <span className={note.selected ? "note-checkbox checked" : "note-checkbox"}>{note.selected && <Check size={18} />}</span>
              <h3>{note.title}</h3>
              <p>{note.text.split(/\r?\n/).slice(0, 2).join(" ")}</p>
            </button>
          ))}
        </div>
        <button className="start-button" onClick={startConversation}>
          <span>→</span> 开始
        </button>
      </section>
    </main>
  );
}

function renderTabs(active: ConversationTab, setActive: (tab: ConversationTab) => void, hasPrenote: boolean) {
  const tabs: Array<{ key: ConversationTab; label: string }> = [
    { key: "summary", label: "AI 总结" },
    { key: "transcript", label: "转写" },
  ];
  if (hasPrenote) tabs.push({ key: "prenote", label: "预备笔记" });
  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <button key={tab.key} className={active === tab.key ? "active" : ""} onClick={() => setActive(tab.key)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function renderCuePanel(cues: AiCue[]) {
  return (
    <div className="summary-stack">
      <section className="summary-card">
        <h2>AI 提示</h2>
        <div className="cue-list">
          {cues.length ? cues.slice(0, 6).map((cue) => (
            <article className="cue-row" key={cue.id}>
              <span className="cue-icon">{cueIcon(cue.category)}</span>
              <div>
                <h3>{cue.title}</h3>
                <p>{cue.output}</p>
              </div>
            </article>
          )) : <p>-</p>}
        </div>
      </section>
    </div>
  );
}

function renderSummary(record: ConversationRecord) {
  return (
    <div className="summary-stack">
      <section className="summary-card">
        <h2>对话摘要</h2>
        <p>{record.summary}</p>
        <h2>关键点</h2>
        <ul>
          {record.keyPoints.length ? record.keyPoints.map((point) => <li key={point}>{point}</li>) : <li>-</li>}
        </ul>
      </section>
      <section className="summary-card">
        <div className="card-title-row">
          <h2>行动事项</h2>
          <span>分享至速记 ({record.actionItems.length}/{record.actionItems.length}) →</span>
        </div>
        <p>{record.actionItems.length ? record.actionItems.join("\n") : "-"}</p>
      </section>
      <section className="summary-card muted-cues">
        <h2>AI 提示</h2>
        {record.cueHistory.map((cue) => (
          <details key={cue.id}>
            <summary><span>{cueIcon(cue.category)}</span>{PHONE_CUE_LABEL[cue.category]}</summary>
            <p>{cue.output}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

function renderTranscript(lines: TranscriptLine[], autoFollow = false) {
  return <TranscriptCard lines={lines} autoFollow={autoFollow} />;
}

function TranscriptCard({ lines, autoFollow }: { lines: TranscriptLine[]; autoFollow: boolean }) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const shouldFollowRef = useRef(true);
  const lastLine = lines[lines.length - 1];

  useEffect(() => {
    if (!autoFollow || !shouldFollowRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFollow, lines.length, lastLine?.id, lastLine?.text]);

  function handleScroll() {
    if (!autoFollow) return;
    const element = scrollRef.current;
    if (!element) return;
    shouldFollowRef.current = shouldAutoFollowTranscriptScroll({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
    });
  }

  return (
    <section className="transcript-card" ref={scrollRef} onScroll={handleScroll}>
      {lines.length ? lines.map((line) => (
        <article key={line.id}>
          <time>{line.time}</time>
          <p>{line.text}</p>
        </article>
      )) : <p>-</p>}
    </section>
  );
}

function renderPrenote(note: Prenote | null) {
  return (
    <section className="summary-card prenote-readonly">
      <h2>{note?.title || "预备笔记"}</h2>
      <pre>{note?.text || "-"}</pre>
    </section>
  );
}

