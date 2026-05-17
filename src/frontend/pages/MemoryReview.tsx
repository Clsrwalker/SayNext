import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, RefreshCcw, Save, Search, Trash2, X } from "lucide-react";
import Header from "../components/Header";
import { fetchTranscriptExports, type TranscriptExportSession } from "../api/transcript-export.api";
import {
  deleteSessionMemoryCandidate,
  extractSessionMemoryCandidates,
  fetchSessionMemoryCandidates,
  promoteSessionMemoryCandidate,
  rejectSessionMemoryCandidate,
  updateSessionMemoryCandidate,
  type SessionMemoryCandidate,
  type SessionMemoryCandidateSensitivity,
  type SessionMemoryReviewMode,
  type SessionMemoryCandidateStatus,
} from "../api/session-memory-candidates.api";

interface MemoryReviewProps {
  userId: string;
  onBack: () => void;
}

type PageMode = "list" | "detail";

const STATUS_OPTIONS: Array<{ value: SessionMemoryCandidateStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "promoted", label: "Promoted" },
  { value: "all", label: "All" },
];

const REVIEW_MODE_OPTIONS: Array<{ value: SessionMemoryReviewMode; label: string; description: string }> = [
  {
    value: "manual_only",
    label: "Manual only",
    description: "Keep the validator result. Valid candidates stay pending; unsafe ones stay rejected.",
  },
  {
    value: "auto_safe_knowledge",
    label: "Auto-promote safe knowledge",
    description: "Only low-risk core knowledge can enter memory automatically. Personal facts still need review.",
  },
  {
    value: "review_all",
    label: "Review all",
    description: "Put extracted candidates in pending, with flags visible, so Xiang can decide manually.",
  },
];

function formatDate(value?: string | null): string {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { hour12: false });
}

function splitLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function FieldLabel({ children }: { children: string }) {
  return <label className="block text-[12px] font-semibold mb-1 text-muted-foreground">{children}</label>;
}

function MemoryReview({ userId, onBack }: MemoryReviewProps) {
  const [page, setPage] = useState<PageMode>("list");
  const [status, setStatus] = useState<SessionMemoryCandidateStatus | "all">("pending");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<SessionMemoryCandidate[]>([]);
  const [sessions, setSessions] = useState<TranscriptExportSession[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [extractStatus, setExtractStatus] = useState("");
  const [reviewMode, setReviewMode] = useState<SessionMemoryReviewMode>(() => {
    const saved = localStorage.getItem(`saynext:memoryReviewMode:${userId}`);
    return saved === "review_all" || saved === "auto_safe_knowledge" ? saved : "manual_only";
  });

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [sensitivity, setSensitivity] = useState<SessionMemoryCandidateSensitivity>("medium");
  const [content, setContent] = useState("");
  const [usageRule, setUsageRule] = useState("");
  const [keywords, setKeywords] = useState("");
  const [evidence, setEvidence] = useState("");

  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((candidate) => [
      candidate.title,
      candidate.candidateType,
      candidate.category,
      candidate.content,
      candidate.keywords.join(" "),
      candidate.evidence.join(" "),
      candidate.validation.flags?.join(" ") || "",
    ].join("\n").toLowerCase().includes(q));
  }, [candidates, query]);

  const loadCandidates = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [loadedCandidates, loadedSessions] = await Promise.all([
        fetchSessionMemoryCandidates({ userId, status, limit: 200 }),
        fetchTranscriptExports(userId, 20),
      ]);
      setCandidates(loadedCandidates);
      setSessions(loadedSessions);
      if (!selectedSessionId && loadedSessions[0]) setSelectedSessionId(loadedSessions[0].sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory review");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCandidates();
  }, [userId, status]);

  useEffect(() => {
    localStorage.setItem(`saynext:memoryReviewMode:${userId}`, reviewMode);
  }, [userId, reviewMode]);

  const openCandidate = (candidate: SessionMemoryCandidate) => {
    setSelectedId(candidate.id);
    setTitle(candidate.title);
    setCategory(candidate.category);
    setSensitivity(candidate.sensitivity);
    setContent(candidate.content);
    setUsageRule(candidate.usageRule);
    setKeywords(candidate.keywords.join(", "));
    setEvidence(candidate.evidence.join("\n"));
    setError("");
    setPage("detail");
  };

  const goList = async () => {
    setPage("list");
    setSelectedId(null);
    await loadCandidates();
  };

  const handleExtract = async () => {
    if (!selectedSessionId) {
      setError("No transcript session selected.");
      return;
    }

    setIsExtracting(true);
    setError("");
    setExtractStatus("");
    try {
      const result = await extractSessionMemoryCandidates({
        userId,
        sessionId: selectedSessionId,
        limitCandidates: 8,
        reviewMode,
      });
      setStatus("pending");
      const promotedCount = result.promoted?.length || 0;
      const runtimeLabel = result.runtimeMode
        ? ` ${result.runtimeMode}/${result.provider || "provider"}${result.batchEnabled ? "/batch" : "/sync"}`
        : "";
      setExtractStatus(promotedCount > 0
        ? `Extracted ${result.candidates.length} candidates and promoted ${promotedCount} safe knowledge item${promotedCount === 1 ? "" : "s"}.${runtimeLabel}`
        : `Extracted ${result.candidates.length} candidates.${runtimeLabel}`);
      await loadCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract candidates");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedCandidate) return;
    if (!content.trim()) {
      setError("Content is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await updateSessionMemoryCandidate({
        userId,
        id: selectedCandidate.id,
        title,
        category,
        sensitivity,
        content,
        usageRule,
        keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
        evidence: splitLines(evidence),
        status: selectedCandidate.status === "rejected" ? "pending" : selectedCandidate.status,
      });
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save candidate");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromote = async () => {
    if (!selectedCandidate) return;
    if (selectedCandidate.candidateType === "event_summary") {
      setError("Event summaries stay in transcript history and cannot be promoted to long-term memory.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await promoteSessionMemoryCandidate({
        userId,
        id: selectedCandidate.id,
        edit: {
          title,
          category,
          sensitivity,
          content,
          usageRule,
          keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
          evidence: splitLines(evidence),
        },
      });
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote candidate");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedCandidate) return;

    setIsSaving(true);
    setError("");
    try {
      await rejectSessionMemoryCandidate({ userId, id: selectedCandidate.id });
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject candidate");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCandidate) return;

    setIsSaving(true);
    setError("");
    try {
      await deleteSessionMemoryCandidate(userId, selectedCandidate.id);
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete candidate");
    } finally {
      setIsSaving(false);
    }
  };

  const renderStatusBadge = (candidate: SessionMemoryCandidate) => {
    const flags = candidate.validation.flags || [];
    const color = candidate.status === "rejected"
      ? "#ef4444"
      : candidate.status === "promoted"
        ? "#16a34a"
        : flags.length
          ? "#d97706"
          : "var(--secondary-foreground)";

    return (
      <span className="px-2 py-1 rounded-full text-[11px] font-semibold" style={{ backgroundColor: color, color: "var(--primary-foreground)" }}>
        {candidate.status}
      </span>
    );
  };

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: "var(--background)", overscrollBehavior: "none", touchAction: "pan-y" }}>
      <Header onSettingsClick={page === "list" ? onBack : goList} showBackArrow={true} />

      <div className="flex-1 px-[22px] pt-[20px] pb-[32px] overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
        <div className="max-w-3xl mx-auto">
          {page === "list" ? (
            <>
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                    Memory Review
                  </h1>
                  <p className="text-[13px] mt-1 text-muted-foreground">{candidates.length} candidates</p>
                </div>
                <button
                  onClick={loadCandidates}
                  aria-label="Refresh"
                  className="w-[44px] h-[44px] shrink-0 rounded-full flex items-center justify-center active:scale-95"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)" }}
                >
                  <RefreshCcw size={18} />
                </button>
              </div>

              {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}
              {extractStatus && <p className="text-[13px] text-muted-foreground mb-4">{extractStatus}</p>}

              <div className="grid grid-cols-2 gap-3 mb-3">
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as SessionMemoryCandidateStatus | "all")}
                  className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                >
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select
                  value={selectedSessionId}
                  onChange={(event) => setSelectedSessionId(event.target.value)}
                  className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                >
                  {sessions.map((session) => (
                    <option key={session.sessionId} value={session.sessionId}>
                      {session.title.slice(0, 42)} ({session.transcriptCount})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-[8px] border p-3 mb-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--primary-foreground)" }}>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {REVIEW_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setReviewMode(option.value)}
                      className="rounded-[8px] px-2 py-2 text-[12px] font-semibold border active:scale-[0.98]"
                      style={{
                        borderColor: reviewMode === option.value ? "var(--secondary-foreground)" : "var(--border)",
                        backgroundColor: reviewMode === option.value ? "var(--secondary-foreground)" : "transparent",
                        color: reviewMode === option.value ? "var(--primary-foreground)" : "var(--secondary-foreground)",
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {REVIEW_MODE_OPTIONS.find((option) => option.value === reviewMode)?.description}
                </p>
              </div>

              <button
                onClick={handleExtract}
                disabled={isExtracting || !selectedSessionId}
                className="w-full mb-4 rounded-[8px] px-4 py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
              >
                {isExtracting ? "Extracting..." : "Extract selected session"}
              </button>

              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search candidates"
                  className="w-full rounded-[8px] pl-9 pr-3 py-3 text-[14px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              {isLoading ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : filtered.length === 0 ? (
                <div className="min-h-[40vh]" />
              ) : (
                <div className="space-y-3">
                  {filtered.map((candidate) => {
                    const date = candidate.dateMetadata || candidate.validation.dateMetadata;
                    const flags = candidate.validation.flags || [];
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => openCandidate(candidate)}
                        className="w-full rounded-[8px] border p-4 text-left flex items-start gap-3"
                        style={{ borderColor: "var(--border)", backgroundColor: "var(--primary-foreground)" }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h2 className="text-[16px] font-semibold leading-snug" style={{ color: "var(--secondary-foreground)" }}>
                              {candidate.title}
                            </h2>
                            {renderStatusBadge(candidate)}
                          </div>
                          <p className="text-[12px] mt-1 text-muted-foreground">
                            {candidate.candidateType} - {candidate.category} - {candidate.sensitivity}
                          </p>
                          <p className="text-[12px] mt-1 text-muted-foreground">
                            date: {date?.dateSource || "unknown"} / {date?.mentionedDate || "none"}
                          </p>
                          {flags.length > 0 && <p className="text-[12px] mt-1 text-amber-600">{flags.slice(0, 3).join(", ")}</p>}
                          <p className="text-[13px] mt-2 text-muted-foreground line-clamp-2">{candidate.content}</p>
                        </div>
                        <ChevronRight size={18} className="text-muted-foreground shrink-0 mt-1" />
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : selectedCandidate ? (
            <div className="space-y-3">
              <div>
                <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                  Review Candidate
                </h1>
                <p className="text-[12px] mt-1 text-muted-foreground">
                  {selectedCandidate.candidateType} - {selectedCandidate.status} - #{selectedCandidate.id}
                </p>
              </div>

              {error && <p className="text-[13px] text-red-500">{error}</p>}

              <div className="rounded-[8px] border p-3 text-[12px] space-y-1" style={{ borderColor: "var(--border)", backgroundColor: "var(--primary-foreground)" }}>
                <p className="text-muted-foreground">event: {formatDate(selectedCandidate.dateMetadata?.eventTime || selectedCandidate.validation.dateMetadata?.eventTime)}</p>
                <p className="text-muted-foreground">mentioned: {selectedCandidate.dateMetadata?.mentionedDate || selectedCandidate.validation.dateMetadata?.mentionedDate || "none"}</p>
                <p className="text-muted-foreground">source: {selectedCandidate.dateMetadata?.dateSource || selectedCandidate.validation.dateMetadata?.dateSource || "unknown"}</p>
                <p className="text-muted-foreground">flags: {(selectedCandidate.validation.flags || []).join(", ") || "none"}</p>
              </div>

              <div>
                <FieldLabel>Title</FieldLabel>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Category</FieldLabel>
                  <input
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
                    style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                  />
                </div>
                <div>
                  <FieldLabel>Sensitivity</FieldLabel>
                  <select
                    value={sensitivity}
                    onChange={(event) => setSensitivity(event.target.value as SessionMemoryCandidateSensitivity)}
                    className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
                    style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
              </div>

              <div>
                <FieldLabel>Memory Content</FieldLabel>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={12}
                  className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              <div>
                <FieldLabel>Usage Rule</FieldLabel>
                <textarea
                  value={usageRule}
                  onChange={(event) => setUsageRule(event.target.value)}
                  rows={3}
                  className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              <div>
                <FieldLabel>Keywords</FieldLabel>
                <input
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                  className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              <div>
                <FieldLabel>Evidence</FieldLabel>
                <textarea
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  rows={5}
                  className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)" }}
                >
                  <Save size={16} />
                  Save
                </button>
                <button
                  onClick={handlePromote}
                  disabled={isSaving || selectedCandidate.status === "promoted" || selectedCandidate.candidateType === "event_summary"}
                  className="flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
                >
                  <Check size={16} />
                  Promote
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleReject}
                  disabled={isSaving}
                  className="flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold border disabled:opacity-60"
                  style={{ color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                >
                  <X size={16} />
                  Reject
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isSaving}
                  className="flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold border disabled:opacity-60"
                  style={{ color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[14px] text-muted-foreground">Candidate not found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default MemoryReview;
