import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Clipboard, FileText, Sparkles } from "lucide-react";
import Header from "../components/Header";
import {
  fetchTranscriptExport,
  fetchTranscriptExports,
  summarizeTranscriptExport,
  type TranscriptExportDetail,
  type TranscriptExportSession,
} from "../api/transcript-export.api";

interface TranscriptExportProps {
  userId: string;
  onBack: () => void;
}

type PageMode = "list" | "detail";
type CopyTarget = "transcript" | "ai" | "full";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-semibold" style={{ color: "var(--secondary-foreground)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextBox({ text }: { text: string }) {
  return (
    <pre
      className="text-[12px] whitespace-pre-wrap rounded-[8px] border p-3 max-h-[360px] overflow-y-auto leading-relaxed"
      style={{
        color: "var(--secondary-foreground)",
        backgroundColor: "var(--primary-foreground)",
        borderColor: "var(--border)",
      }}
    >
      {text || "(Empty)"}
    </pre>
  );
}

function TranscriptExport({ userId, onBack }: TranscriptExportProps) {
  const [page, setPage] = useState<PageMode>("list");
  const [sessions, setSessions] = useState<TranscriptExportSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [detail, setDetail] = useState<TranscriptExportDetail | null>(null);
  const [summary, setSummary] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [error, setError] = useState("");

  const loadSessions = async () => {
    setIsLoading(true);
    setError("");
    try {
      setSessions(await fetchTranscriptExports(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transcript exports");
    } finally {
      setIsLoading(false);
    }
  };

  const loadDetail = async (sessionId: string) => {
    setIsLoadingDetail(true);
    setSummary("");
    setCopiedTarget(null);
    setError("");
    try {
      setDetail(await fetchTranscriptExport(userId, sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transcript export");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [userId]);

  useEffect(() => {
    if (page === "detail" && selectedSessionId) {
      loadDetail(selectedSessionId);
    }
  }, [page, selectedSessionId]);

  const goList = async () => {
    setPage("list");
    setSelectedSessionId("");
    setDetail(null);
    setSummary("");
    await loadSessions();
  };

  const openDetail = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setPage("detail");
  };

  const copyText = async (target: CopyTarget, text: string) => {
    await navigator.clipboard.writeText(text || "");
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget(null), 1200);
  };

  const handleSummarize = async () => {
    if (!detail) return;
    setIsSummarizing(true);
    setError("");
    try {
      const result = await summarizeTranscriptExport(userId, detail.session.sessionId);
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to summarize transcript");
    } finally {
      setIsSummarizing(false);
    }
  };

  const headerBack = page === "list" ? onBack : goList;

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        backgroundColor: "var(--background)",
        overscrollBehavior: "none",
        touchAction: "pan-y",
      }}
    >
      <Header onSettingsClick={headerBack} showBackArrow={true} />

      <div
        className="flex-1 px-[22px] pt-[20px] pb-[32px] overflow-y-auto"
        style={{
          overscrollBehavior: "none",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
        }}
      >
        <div className="max-w-3xl mx-auto">
          {page === "list" && (
            <>
              <div className="mb-5">
                <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                  Transcript Export
                </h1>
                <p className="text-[13px] mt-1 text-muted-foreground">Sessions from app start to disconnect.</p>
              </div>

              {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

              {isLoading ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : sessions.length === 0 ? (
                <div className="min-h-[45vh]" />
              ) : (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <button
                      key={session.sessionId}
                      onClick={() => openDetail(session.sessionId)}
                      className="w-full rounded-[8px] border p-4 text-left flex items-start gap-3"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--primary-foreground)",
                      }}
                    >
                      <FileText size={18} className="mt-1 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[16px] font-semibold truncate" style={{ color: "var(--secondary-foreground)" }}>
                          {session.title}
                        </h2>
                        <p className="text-[12px] mt-1 text-muted-foreground">
                          {formatDate(session.startTimestamp)} - {formatDate(session.lastTimestamp)}
                        </p>
                        <p className="text-[12px] mt-1 text-muted-foreground">
                          {session.transcriptCount} transcripts - {session.aiReplyCount} AI outputs - {session.status}
                        </p>
                      </div>
                      <ChevronRight size={18} className="mt-1 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {page === "detail" && (
            <>
              {isLoadingDetail ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : detail ? (
                <div className="space-y-5">
                  <div>
                    <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                      {detail.session.title}
                    </h1>
                    <p className="text-[13px] mt-1 text-muted-foreground">
                      {formatDate(detail.session.startTimestamp)} - {formatDate(detail.session.lastTimestamp)}
                    </p>
                    <p className="text-[12px] mt-1 text-muted-foreground">
                      {detail.session.transcriptCount} transcripts - {detail.session.aiReplyCount} AI outputs
                    </p>
                  </div>

                  {error && <p className="text-[13px] text-red-500">{error}</p>}

                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => copyText("transcript", detail.transcriptText)}
                      className="rounded-[8px] px-4 py-3 text-[14px] font-semibold flex items-center justify-center gap-2"
                      style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
                    >
                      <Clipboard size={16} />
                      {copiedTarget === "transcript" ? "Copied transcript" : "Copy transcript"}
                    </button>
                    <button
                      onClick={() => copyText("ai", detail.aiOutputText)}
                      className="rounded-[8px] px-4 py-3 text-[14px] font-semibold border flex items-center justify-center gap-2"
                      style={{ borderColor: "var(--border)", color: "var(--secondary-foreground)" }}
                    >
                      <Clipboard size={16} />
                      {copiedTarget === "ai" ? "Copied AI outputs" : "Copy AI outputs"}
                    </button>
                    <button
                      onClick={() => copyText("full", detail.fullText)}
                      className="rounded-[8px] px-4 py-3 text-[14px] font-semibold border flex items-center justify-center gap-2"
                      style={{ borderColor: "var(--border)", color: "var(--secondary-foreground)" }}
                    >
                      <Clipboard size={16} />
                      {copiedTarget === "full" ? "Copied full export" : "Copy full export"}
                    </button>
                  </div>

                  <button
                    onClick={handleSummarize}
                    disabled={isSummarizing}
                    className="w-full rounded-[8px] px-4 py-3 text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
                  >
                    <Sparkles size={16} />
                    {isSummarizing ? "Summarizing..." : "AI summary"}
                  </button>

                  {summary && (
                    <Section title="AI summary">
                      <TextBox text={summary} />
                    </Section>
                  )}

                  <Section title="Transcript">
                    <TextBox text={detail.transcriptText} />
                  </Section>

                  <Section title="AI outputs">
                    <TextBox text={detail.aiOutputText} />
                  </Section>

                  <details className="rounded-[8px] border p-3" style={{ borderColor: "var(--border)" }}>
                    <summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--secondary-foreground)" }}>
                      Full export
                    </summary>
                    <pre className="text-[12px] whitespace-pre-wrap mt-3 text-muted-foreground">{detail.fullText}</pre>
                  </details>
                </div>
              ) : (
                <p className="text-[14px] text-muted-foreground">Session not found.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TranscriptExport;
