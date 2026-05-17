import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, FileText, Plus, Save, Trash2, Upload } from "lucide-react";
import Header from "../components/Header";
import {
  createPrenote,
  deletePrenote,
  fetchPrenote,
  fetchPrenotes,
  setActivePrenote,
  updatePrenoteMemory,
  type Prenote,
} from "../api/prenotes.api";
import { createPersonalMemory } from "../api/personal-memories.api";

interface PrenoteManagerProps {
  userId: string;
  onBack: () => void;
}

type PageMode = "list" | "create" | "detail";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function FieldShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-[8px] border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--primary-foreground)" }}
    >
      {children}
    </div>
  );
}

function PrenoteManager({ userId, onBack }: PrenoteManagerProps) {
  const [page, setPage] = useState<PageMode>("list");
  const [prenotes, setPrenotes] = useState<Prenote[]>([]);
  const [selectedPrenoteId, setSelectedPrenoteId] = useState<number | null>(null);
  const [detailPrenote, setDetailPrenote] = useState<Prenote | null>(null);
  const [title, setTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [detailTitle, setDetailTitle] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [isAddingKnowledge, setIsAddingKnowledge] = useState(false);
  const [knowledgeStatus, setKnowledgeStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const [error, setError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedCount = prenotes.filter((prenote) => prenote.isActive).length;

  const loadPrenotes = async () => {
    if (!userId.trim()) {
      setPrenotes([]);
      setError("Missing userId. Reopen the MiniApp from MentraOS.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      setPrenotes(await fetchPrenotes(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prenotes");
    } finally {
      setIsLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    setIsLoadingDetail(true);
    setError("");
    try {
      const prenote = await fetchPrenote(userId, id);
      setDetailPrenote(prenote);
      setDetailTitle(prenote.title);
      setMemoryDraft(prenote.runtimeContext || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prenote");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadPrenotes();
  }, [userId]);

  useEffect(() => {
    if (page === "detail" && selectedPrenoteId !== null) {
      loadDetail(selectedPrenoteId);
    }
  }, [page, selectedPrenoteId]);

  const goList = async () => {
    setPage("list");
    setSelectedPrenoteId(null);
    setDetailPrenote(null);
    setError("");
    await loadPrenotes();
  };

  const resetCreateForm = () => {
    setTitle("");
    setSourceText("");
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreate = async () => {
    const files = fileInputRef.current?.files;
    if (!sourceText.trim() && (!files || files.length === 0)) {
      setError("Add text or upload at least one file.");
      return;
    }

    setIsCreating(true);
    setError("");
    try {
      await createPrenote({
        userId,
        title: title.trim(),
        sourceText,
        files: files || undefined,
        setActive: false,
      });
      resetCreateForm();
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prenote");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (id: number, active: boolean) => {
    const previous = prenotes;
    setPrenotes((current) => current.map((prenote) => (prenote.id === id ? { ...prenote, isActive: active } : prenote)));
    setError("");

    try {
      await setActivePrenote(userId, id, active);
      await loadPrenotes();
      if (detailPrenote?.id === id) {
        setDetailPrenote({ ...detailPrenote, isActive: active });
      }
    } catch (err) {
      setPrenotes(previous);
      setError(err instanceof Error ? err.message : "Failed to update prenote");
    }
  };

  const handleDelete = async (id: number) => {
    setError("");
    try {
      await deletePrenote(userId, id);
      if (selectedPrenoteId === id) {
        await goList();
      } else {
        await loadPrenotes();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete prenote");
    }
  };

  const handleSaveMemory = async () => {
    if (!detailPrenote) return;

    setIsSavingMemory(true);
    setError("");
    try {
      const updated = await updatePrenoteMemory({
        userId,
        id: detailPrenote.id,
        title: detailTitle,
        runtimeContext: memoryDraft,
      });
      setDetailPrenote({ ...detailPrenote, ...updated });
      setPrenotes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleAddToKnowledge = async () => {
    if (!detailPrenote) return;

    const content = memoryDraft.trim() || detailPrenote.runtimeContext.trim() || detailPrenote.extractedText?.trim() || detailPrenote.sourceText?.trim();
    if (!content) {
      setError("No prenote memory to add.");
      return;
    }

    setIsAddingKnowledge(true);
    setKnowledgeStatus('idle');
    setError("");
    try {
      const keywordSeeds = [
        detailTitle,
        detailPrenote.title,
        ...detailPrenote.files.map((file) => file.fileName.replace(/\.[^.]+$/, "")),
      ]
        .join(" ")
        .split(/[\s,，/|_-]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 2)
        .slice(0, 12);

      await createPersonalMemory({
        userId,
        title: detailTitle || detailPrenote.title,
        category: "knowledge",
        sensitivity: "medium",
        content,
        usageRule: "Use when the current conversation is related to this uploaded prenote material.",
        keywords: Array.from(new Set(keywordSeeds)),
        status: "active",
        source: "knowledge",
        sourceRef: `prenote:${detailPrenote.id}`,
        upsertBySource: true,
      });
      setKnowledgeStatus('done');
    } catch (err) {
      setKnowledgeStatus('error');
      setError(err instanceof Error ? err.message : "Failed to add to knowledge memory");
    } finally {
      setIsAddingKnowledge(false);
    }
  };

  const openDetail = (id: number) => {
    setSelectedPrenoteId(id);
    setPage("detail");
    setError("");
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
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                    Prenote
                  </h1>
                  <p className="text-[13px] mt-1 text-muted-foreground">
                    {selectedCount > 0 ? `${selectedCount} selected as memory` : "Select notes to use as memory"}
                  </p>
                </div>

                <button
                  aria-label="Add prenote"
                  onClick={() => {
                    setError("");
                    setPage("create");
                  }}
                  className="w-[44px] h-[44px] shrink-0 rounded-full flex items-center justify-center transition-transform active:scale-95"
                  style={{
                    backgroundColor: "var(--secondary-foreground)",
                    color: "var(--primary-foreground)",
                  }}
                >
                  <Plus size={23} />
                </button>
              </div>

              {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

              {isLoading ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : prenotes.length === 0 ? (
                <div className="min-h-[45vh]" />
              ) : (
                <div className="space-y-3">
                  {prenotes.map((prenote) => {
                    const canSelect = prenote.status === "ready";
                    return (
                      <FieldShell key={prenote.id}>
                        <div className="flex items-start gap-3 p-4">
                          <input
                            aria-label={prenote.isActive ? "Remove from memory" : "Use as memory"}
                            type="checkbox"
                            checked={prenote.isActive}
                            disabled={!canSelect}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => handleToggleActive(prenote.id, event.target.checked)}
                            className="mt-1 w-[24px] h-[24px] shrink-0 disabled:opacity-40"
                            style={{ accentColor: "var(--secondary-foreground)" }}
                          />

                          <button
                            type="button"
                            onClick={() => openDetail(prenote.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <h2
                              className="text-[16px] font-semibold leading-snug truncate"
                              style={{ color: "var(--secondary-foreground)" }}
                            >
                              {prenote.title}
                            </h2>
                            <p className="text-[12px] mt-1 text-muted-foreground">
                              {prenote.status}
                              {prenote.runtimeContextLength > 0 ? ` - ${prenote.runtimeContextLength} chars memory` : ""}
                              {prenote.files.length > 0 ? ` - ${prenote.files.length} files` : ""}
                            </p>
                            {prenote.error && (
                              <p className="text-[12px] text-yellow-600 whitespace-pre-wrap mt-2">{prenote.error}</p>
                            )}
                          </button>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              aria-label="Delete prenote"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDelete(prenote.id);
                              }}
                              className="w-[34px] h-[34px] rounded-[6px] border flex items-center justify-center transition-transform active:scale-95"
                              style={{
                                borderColor: "var(--border)",
                                color: "var(--secondary-foreground)",
                              }}
                            >
                              <Trash2 size={17} />
                            </button>
                            <ChevronRight size={18} className="text-muted-foreground" />
                          </div>
                        </div>
                      </FieldShell>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {page === "create" && (
            <>
              <div className="mb-5">
                <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                  Add Prenote
                </h1>
                <p className="text-[13px] mt-1 text-muted-foreground">Paste text or upload files for prepared memory.</p>
              </div>

              {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Name optional"
                  className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none border"
                  style={{
                    backgroundColor: "var(--primary-foreground)",
                    color: "var(--secondary-foreground)",
                    borderColor: "var(--border)",
                  }}
                />

                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder="Paste text, class notes, interview info, meeting agenda..."
                  rows={12}
                  className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none resize-y border leading-relaxed"
                  style={{
                    backgroundColor: "var(--primary-foreground)",
                    color: "var(--secondary-foreground)",
                    borderColor: "var(--border)",
                  }}
                />

                <label
                  className="flex items-center gap-3 rounded-[8px] border px-3 py-3 cursor-pointer"
                  style={{
                    backgroundColor: "var(--primary-foreground)",
                    color: "var(--secondary-foreground)",
                    borderColor: "var(--border)",
                  }}
                >
                  <Upload size={18} />
                  <span className="text-[14px] font-medium">Add files</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
                    accept=".pdf,.doc,.docx,.pptx,.xlsx,.xml,.html,.htm,.txt,.md,.csv,.json,.yaml,.yml,.rtf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.heic,image/*,application/pdf"
                    className="hidden"
                  />
                </label>

                {selectedFiles.length > 0 && (
                  <FieldShell>
                    <div className="p-3 space-y-2">
                      {selectedFiles.map((file) => (
                        <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                          <FileText size={13} />
                          <span className="truncate">{file.name}</span>
                          <span className="shrink-0">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                    </div>
                  </FieldShell>
                )}

                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60 transition-transform active:scale-[0.99]"
                  style={{
                    backgroundColor: "var(--secondary-foreground)",
                    color: "var(--primary-foreground)",
                  }}
                >
                  {isCreating ? "Processing..." : "Add prenote"}
                </button>
              </div>
            </>
          )}

          {page === "detail" && (
            <>
              {isLoadingDetail ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : detailPrenote ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                        Edit Prenote
                      </h1>
                      <p className="text-[13px] mt-1 text-muted-foreground">
                        {detailPrenote.status} - {memoryDraft.length} chars memory
                      </p>
                    </div>
                    <input
                      aria-label={detailPrenote.isActive ? "Remove from memory" : "Use as memory"}
                      type="checkbox"
                      checked={detailPrenote.isActive}
                      disabled={detailPrenote.status !== "ready"}
                      onChange={(event) => handleToggleActive(detailPrenote.id, event.target.checked)}
                      className="mt-1 w-[26px] h-[26px] shrink-0 disabled:opacity-40"
                      style={{ accentColor: "var(--secondary-foreground)" }}
                    />
                  </div>

                  {error && <p className="text-[13px] text-red-500">{error}</p>}

                  <input
                    value={detailTitle}
                    onChange={(event) => setDetailTitle(event.target.value)}
                    placeholder="Name"
                    className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none border"
                    style={{
                      backgroundColor: "var(--primary-foreground)",
                      color: "var(--secondary-foreground)",
                      borderColor: "var(--border)",
                    }}
                  />

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <h2 className="text-[15px] font-semibold" style={{ color: "var(--secondary-foreground)" }}>
                        Memory sent to AI
                      </h2>
                      <span className="text-[12px] text-muted-foreground">{memoryDraft.length} chars</span>
                    </div>
                    <textarea
                      value={memoryDraft}
                      onChange={(event) => setMemoryDraft(event.target.value)}
                      rows={14}
                      className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
                      style={{
                        backgroundColor: "var(--primary-foreground)",
                        color: "var(--secondary-foreground)",
                        borderColor: "var(--border)",
                      }}
                    />
                  </div>

                  <button
                    onClick={handleSaveMemory}
                    disabled={isSavingMemory}
                    className="w-full flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60"
                    style={{
                      backgroundColor: "var(--secondary-foreground)",
                      color: "var(--primary-foreground)",
                    }}
                  >
                    <Save size={16} />
                    {isSavingMemory ? "Saving..." : "Save memory"}
                  </button>

                  <button
                    onClick={handleAddToKnowledge}
                    disabled={isAddingKnowledge || detailPrenote.status !== "ready"}
                    className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold border flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{
                      color: knowledgeStatus === 'error' ? '#ef4444' : 'var(--secondary-foreground)',
                      borderColor: "var(--border)",
                    }}
                  >
                    <FileText size={16} />
                    {isAddingKnowledge
                      ? "Adding..."
                      : knowledgeStatus === 'done'
                        ? "Saved to Knowledge"
                        : knowledgeStatus === 'error'
                          ? "Retry Add to Knowledge"
                          : "Add to Knowledge Memory"}
                  </button>

                  {detailPrenote.files.length > 0 && (
                    <FieldShell>
                      <div className="p-3 space-y-2">
                        <p className="text-[13px] font-semibold" style={{ color: "var(--secondary-foreground)" }}>
                          Files
                        </p>
                        {detailPrenote.files.map((file) => (
                          <div key={file.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <FileText size={13} />
                            <span className="truncate">{file.fileName}</span>
                            <span className="shrink-0">{formatBytes(file.sizeBytes)}</span>
                          </div>
                        ))}
                      </div>
                    </FieldShell>
                  )}

                  <details className="rounded-[8px] border p-3" style={{ borderColor: "var(--border)" }}>
                    <summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--secondary-foreground)" }}>
                      Original text
                    </summary>
                    <pre className="text-[12px] whitespace-pre-wrap mt-3 text-muted-foreground">
                      {detailPrenote.sourceText || "No direct text input."}
                    </pre>
                  </details>

                  <details className="rounded-[8px] border p-3" style={{ borderColor: "var(--border)" }}>
                    <summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--secondary-foreground)" }}>
                      Extracted text
                    </summary>
                    <pre className="text-[12px] whitespace-pre-wrap mt-3 text-muted-foreground">
                      {detailPrenote.extractedText || "No extracted text."}
                    </pre>
                  </details>

                  <details className="rounded-[8px] border p-3" style={{ borderColor: "var(--border)" }}>
                    <summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--secondary-foreground)" }}>
                      AI processed JSON
                    </summary>
                    <pre className="text-[12px] whitespace-pre-wrap mt-3 text-muted-foreground">
                      {detailPrenote.processedJson || "No processed JSON."}
                    </pre>
                  </details>

                  <button
                    onClick={() => handleDelete(detailPrenote.id)}
                    className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold border flex items-center justify-center gap-2"
                    style={{
                      color: "var(--secondary-foreground)",
                      borderColor: "var(--border)",
                    }}
                  >
                    <Trash2 size={16} />
                    Delete prenote
                  </button>
                </div>
              ) : (
                <p className="text-[14px] text-muted-foreground">Prenote not found.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PrenoteManager;
