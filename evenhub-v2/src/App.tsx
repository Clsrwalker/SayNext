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
import { normalizeGlassGesture, readGlassListSelection, type GlassListSelection } from "./events";
import { decideGlassEvent } from "./glasses-event-controller";
import { connectGlassBridge, type GlassBridgeHandle } from "./glasses-bridge";
import { buildGlassesPage } from "./glasses-layout";
import { buildMenuItems, makeAutoCueVisibility, startLiveGlasses } from "./glasses-state";
import {
  DEFAULT_SETTINGS,
  MOCK_CUES,
  MOCK_PRENOTES,
  MOCK_RECORDS,
  MOCK_TRANSCRIPT,
  makeManualCue,
} from "./mock-data";
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

function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((line) => line.text).join(" ");
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<ConversationSettings>(DEFAULT_SETTINGS);
  const [records, setRecords] = useState<ConversationRecord[]>(MOCK_RECORDS);
  const [prenotes, setPrenotes] = useState<Prenote[]>(MOCK_PRENOTES);
  const [cues, setCues] = useState<AiCue[]>(MOCK_CUES);
  const [transcript, setTranscript] = useState<TranscriptLine[]>(MOCK_TRANSCRIPT);
  const [liveTab, setLiveTab] = useState<ConversationTab>("transcript");
  const [historyTab, setHistoryTab] = useState<ConversationTab>("summary");
  const [activeRecordId, setActiveRecordId] = useState(MOCK_RECORDS[0].id);
  const [noteDraft, setNoteDraft] = useState<Prenote | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(24);
  const [glassState, setGlassState] = useState<GlassRuntimeState>(() => startLiveGlasses(null));
  const bridgeRef = useRef<GlassBridgeHandle | null>(null);
  const connectingBridgeRef = useRef(false);

  const activePrenote = useMemo(() => selectedPrenote(prenotes), [prenotes]);
  const activeRecord = records.find((record) => record.id === activeRecordId) || records[0];
  const glassStateRef = useRef(glassState);
  const cuesRef = useRef(cues);
  const transcriptRef = useRef(transcript);
  const activePrenoteRef = useRef(activePrenote);
  const glassPage = useMemo(() => buildGlassesPage({
    state: glassState,
    cues,
    prenote: activePrenote,
    transcript,
  }), [activePrenote, cues, glassState, transcript]);

  useEffect(() => {
    glassStateRef.current = glassState;
    cuesRef.current = cues;
    transcriptRef.current = transcript;
    activePrenoteRef.current = activePrenote;
  }, [activePrenote, cues, glassState, transcript]);

  useEffect(() => {
    if (!isListening) return;
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [isListening]);

  useEffect(() => {
    if (bridgeRef.current) {
      void bridgeRef.current.render(glassPage).catch(() => undefined);
      return;
    }
    if (connectingBridgeRef.current) return;
    connectingBridgeRef.current = true;
    void connectGlassBridge({
      initialPage: glassPage,
      onEvent: (event) => {
        const gesture = normalizeGlassGesture(event);
        if (gesture) handleGlassGesture(gesture, readGlassListSelection(event));
      },
    })
      .then((bridge) => {
        bridgeRef.current = bridge;
      })
      .catch(() => undefined)
      .finally(() => {
        connectingBridgeRef.current = false;
      });
  }, [glassPage]);

  const elapsedLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `00:${minutes}:${seconds}`;
  }, [elapsedSeconds]);

  function commitGlassState(nextState: GlassRuntimeState) {
    glassStateRef.current = nextState;
    setGlassState(nextState);
  }

  function handleGlassGesture(gesture: GlassGesture, selection: GlassListSelection = { index: null, name: null }) {
    const currentState = glassStateRef.current;
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

    commitGlassState(decision.state);
    if (decision.effect === "manual_generate") {
      addManualCue();
    }
  }

  function addManualCue() {
    const cue = makeManualCue(transcriptText(transcriptRef.current));
    setCues((current) => {
      const nextCues = [cue, ...current];
      cuesRef.current = nextCues;
      return nextCues;
    });
    commitGlassState({
      ...glassStateRef.current,
      view: "main",
      latestCueId: cue.id,
      activeCueId: cue.id,
      autoCueVisibleUntil: null,
    });
  }

  function addMockAutoCue(category: CueCategory) {
    const titleByCategory: Record<CueCategory, string> = {
      response: "Possible reply",
      concept: "New concept",
      suggestion: "Next step",
      person: "Speaker note",
    };
    const outputByCategory: Record<CueCategory, string> = {
      response: "I think the direct answer is that it normalizes activations using the batch mean and variance, then learns scale and shift.",
      concept: "Batch normalization changes training behavior by stabilizing activation distributions across mini-batches.",
      suggestion: "It may help to mention the training versus inference difference next.",
      person: "The speaker is explaining the topic from a teaching perspective, not asking for a personal example yet.",
    };
    const cue: AiCue = {
      id: `auto-${category}-${Date.now()}`,
      category,
      title: titleByCategory[category],
      output: outputByCategory[category],
      createdAt: new Date().toISOString(),
      source: "auto",
    };
    setCues((current) => [cue, ...current]);
    setGlassState((current) => {
      if (current.view !== "main") {
        return {
          ...current,
          latestCueId: cue.id,
          activeCueId: current.activeCueId || cue.id,
          autoCueVisibleUntil: makeAutoCueVisibility(settings.cueDuration, Date.now()),
        };
      }
      return {
        ...current,
        latestCueId: cue.id,
        activeCueId: cue.id,
        autoCueVisibleUntil: makeAutoCueVisibility(settings.cueDuration, Date.now()),
      };
    });
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
        status: "mock_ready",
      });
    }
    setNoteDraft({
      ...noteDraft,
      files: [...existing, ...next],
      text: noteDraft.text || "Uploaded files will be converted into editable prepared-note text in the backend phase.",
    });
  }

  function startConversation() {
    setIsListening(true);
    setElapsedSeconds(24);
    setGlassState(startLiveGlasses(null));
    setLiveTab("transcript");
    setScreen("live");
  }

  function endConversation() {
    setIsListening(false);
    const record: ConversationRecord = {
      id: `rec-${Date.now()}`,
      title: "新对话",
      startedAt: "01:35 PM 2026/06/05",
      location: "哈利法克斯, CA",
      duration: elapsedLabel,
      summary: "Mock summary will be generated by the backend phase.",
      keyPoints: ["Cue history and transcript are preserved."],
      actionItems: [],
      transcript,
      cueHistory: cues,
      usedPrenote: activePrenote || undefined,
    };
    setRecords((current) => [record, ...current]);
    setActiveRecordId(record.id);
    setScreen("history");
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
              眼镜 {settings.voiceInput === "glasses" && <Check size={28} />}
            </button>
            <button className="setting-choice" onClick={() => setSettings({ ...settings, voiceInput: "phone" })}>
              手机 {settings.voiceInput === "phone" && <Check size={28} />}
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
              <span>AI提示</span>
              <input
                type="checkbox"
                checked={settings.glassContent.aiCue}
                onChange={(event) => setSettings({ ...settings, glassContent: { ...settings.glassContent, aiCue: event.target.checked } })}
              />
            </label>
            <label className="switch-row">
              <span>实时转录</span>
              <input
                type="checkbox"
                checked={settings.glassContent.transcript}
                onChange={(event) => setSettings({ ...settings, glassContent: { ...settings.glassContent, transcript: event.target.checked } })}
              />
            </label>
          </div>
          <p className="muted-copy">这些设置仅影响对话期间的眼镜界面。应用仍会进行转录并生成实时 AI 总结。</p>
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
            placeholder="您将能够在会话期间在眼镜上访问这些笔记。"
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
          <p>最多添加5个文件。每个最大 5 MB。</p>
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
          <p>对话将使用您的准备笔记和任何上传的文件来理解上下文。这将有助于提供更有用的实时 AI 提示和对话摘要。</p>
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
            <div className="setting-choice">眼镜</div>
            <div className="setting-choice">手机 <Check size={28} /></div>
          </div>
        </section>
        <section className="settings-section">
          <h2>眼镜显示内容</h2>
          <div className="setting-card">
            <label className="switch-row">
              <span>AI提示</span>
              <input type="checkbox" checked={settings.glassContent.aiCue} readOnly />
            </label>
            <label className="switch-row">
              <span>实时转录</span>
              <input type="checkbox" checked={settings.glassContent.transcript} readOnly />
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
            <p>01:35 PM 2026/06/05 ・ 哈利法克斯, CA</p>
          </div>
          <span className="live-duration"><span />{elapsedLabel}</span>
        </section>
        {renderTabs(liveTab, setLiveTab, Boolean(activePrenote))}
        <section className="live-content">
          {liveTab === "summary" && renderCuePanel(cues, addMockAutoCue)}
          {liveTab === "transcript" && renderTranscript(transcript)}
          {liveTab === "prenote" && renderPrenote(activePrenote)}
        </section>
        <footer className="live-actions">
          <button onClick={() => setIsListening((value) => !value)}>
            <Pause size={29} strokeWidth={1.4} /> {isListening ? "暂停" : "继续"}
          </button>
          <button onClick={endConversation}>
            <X size={31} strokeWidth={1.35} /> 结束
          </button>
        </footer>
      </main>
    );
  }

  if (screen === "history") {
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
            <p>{activeRecord.startedAt} ・ {activeRecord.location}</p>
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
            <button className="record-card" key={record.id} onClick={() => {
              setActiveRecordId(record.id);
              setHistoryTab("summary");
              setScreen("history");
            }}>
              <div>
                <h3>{record.title}</h3>
                <p>{record.startedAt} ・ {record.location}</p>
              </div>
              <ChevronRight size={34} strokeWidth={1.4} />
            </button>
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

function renderCuePanel(cues: AiCue[], addMockAutoCue: (category: CueCategory) => void) {
  return (
    <div className="summary-stack">
      <section className="summary-card">
        <h2>AI提示</h2>
        <div className="cue-list">
          {cues.slice(0, 6).map((cue) => (
            <article className="cue-row" key={cue.id}>
              <span className="cue-icon">{cueIcon(cue.category)}</span>
              <div>
                <h3>{cue.title}</h3>
                <p>{cue.output}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="summary-card compact-cue-tools">
        {(["response", "concept", "suggestion", "person"] as const).map((category) => (
          <button key={category} onClick={() => addMockAutoCue(category)}>
            <span>{cueIcon(category)}</span>
            {PHONE_CUE_LABEL[category]}
          </button>
        ))}
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
          <span>分享至速记 ({record.actionItems.length}/{record.actionItems.length}) ↗</span>
        </div>
        <p>{record.actionItems.length ? record.actionItems.join("\n") : "-"}</p>
      </section>
      <section className="summary-card muted-cues">
        <h2>AI提示</h2>
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

function renderTranscript(lines: TranscriptLine[]) {
  return (
    <section className="transcript-card">
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
