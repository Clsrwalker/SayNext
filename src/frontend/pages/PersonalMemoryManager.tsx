import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Plus, Save, Search, Trash2 } from "lucide-react";
import Header from "../components/Header";
import {
  createPersonalMemory,
  deletePersonalMemory,
  fetchPersonalMemories,
  updatePersonalMemory,
  type PersonalMemory,
  type PersonalMemorySensitivity,
} from "../api/personal-memories.api";

interface PersonalMemoryManagerProps {
  userId: string;
  onBack: () => void;
}

type PageMode = "list" | "detail" | "create";

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

function PersonalMemoryManager({ userId, onBack }: PersonalMemoryManagerProps) {
  const [page, setPage] = useState<PageMode>("list");
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("personal");
  const [sensitivity, setSensitivity] = useState<PersonalMemorySensitivity>("medium");
  const [content, setContent] = useState("");
  const [usageRule, setUsageRule] = useState("");
  const [keywords, setKeywords] = useState("");

  const selectedMemory = memories.find((memory) => memory.id === selectedId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter((memory) => [
      memory.title,
      memory.category,
      memory.source,
      memory.content,
      memory.keywords.join(" "),
    ].join("\n").toLowerCase().includes(q));
  }, [memories, query]);

  const loadMemories = async () => {
    setIsLoading(true);
    setError("");
    try {
      setMemories(await fetchPersonalMemories(userId, "all"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personal memory");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
  }, [userId]);

  const resetEditor = () => {
    setTitle("");
    setCategory("personal");
    setSensitivity("medium");
    setContent("");
    setUsageRule("");
    setKeywords("");
  };

  const openMemory = (memory: PersonalMemory) => {
    setSelectedId(memory.id);
    setTitle(memory.title);
    setCategory(memory.category);
    setSensitivity(memory.sensitivity);
    setContent(memory.content);
    setUsageRule(memory.usageRule);
    setKeywords(memory.keywords.join(", "));
    setError("");
    setPage("detail");
  };

  const goList = async () => {
    setPage("list");
    setSelectedId(null);
    resetEditor();
    await loadMemories();
  };

  const handleCreate = async () => {
    if (!content.trim()) {
      setError("Content is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await createPersonalMemory({
        userId,
        title: title.trim() || "Personal memory",
        category: category.trim() || "personal",
        sensitivity,
        content,
        usageRule,
        keywords,
        status: "active",
        source: "manual",
      });
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create memory");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedMemory) return;
    if (!content.trim()) {
      setError("Content is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await updatePersonalMemory({
        userId,
        id: selectedMemory.id,
        title,
        category,
        sensitivity,
        content,
        usageRule,
        keywords,
      });
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMemory) return;

    setIsSaving(true);
    setError("");
    try {
      await deletePersonalMemory(userId, selectedMemory.id);
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    } finally {
      setIsSaving(false);
    }
  };

  const renderEditor = (isCreate: boolean) => (
    <div className="space-y-3">
      <div>
        <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
          {isCreate ? "Add Memory" : "Edit Memory"}
        </h1>
        {!isCreate && selectedMemory && (
          <p className="text-[12px] mt-1 text-muted-foreground">
            {selectedMemory.source}
            {selectedMemory.sourceRef ? ` - ${selectedMemory.sourceRef}` : ""}
          </p>
        )}
      </div>

      {error && <p className="text-[13px] text-red-500">{error}</p>}

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
        className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none border"
        style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
      />

      <div className="grid grid-cols-2 gap-3">
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="Category"
          className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
          style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
        />
        <select
          value={sensitivity}
          onChange={(event) => setSensitivity(event.target.value as PersonalMemorySensitivity)}
          className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
          style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Memory content"
        rows={14}
        className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
        style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
      />

      <textarea
        value={usageRule}
        onChange={(event) => setUsageRule(event.target.value)}
        placeholder="Usage rule optional"
        rows={3}
        className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
        style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
      />

      <input
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        placeholder="Keywords, comma separated"
        className="w-full rounded-[8px] px-3 py-3 text-[14px] outline-none border"
        style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
      />

      <button
        onClick={isCreate ? handleCreate : handleSave}
        disabled={isSaving}
        className="w-full flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60"
        style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
      >
        <Save size={16} />
        {isSaving ? "Saving..." : "Save"}
      </button>

      {!isCreate && (
        <button
          onClick={handleDelete}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold border disabled:opacity-60"
          style={{ color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
        >
          <Trash2 size={16} />
          Delete
        </button>
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: "var(--background)", overscrollBehavior: "none", touchAction: "pan-y" }}>
      <Header onSettingsClick={page === "list" ? onBack : goList} showBackArrow={true} />

      <div className="flex-1 px-[22px] pt-[20px] pb-[32px] overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
        <div className="max-w-3xl mx-auto">
          {page === "list" && (
            <>
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                    Personal Memory
                  </h1>
                  <p className="text-[13px] mt-1 text-muted-foreground">{memories.length} saved memories</p>
                </div>
                <button
                  aria-label="Add memory"
                  onClick={() => {
                    resetEditor();
                    setError("");
                    setPage("create");
                  }}
                  className="w-[44px] h-[44px] shrink-0 rounded-full flex items-center justify-center transition-transform active:scale-95"
                  style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
                >
                  <Plus size={23} />
                </button>
              </div>

              {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search memory"
                  className="w-full rounded-[8px] pl-9 pr-3 py-3 text-[14px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />
              </div>

              {isLoading ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : filtered.length === 0 ? (
                <div className="min-h-[45vh]" />
              ) : (
                <div className="space-y-3">
                  {filtered.map((memory) => (
                    <FieldShell key={memory.id}>
                      <button type="button" onClick={() => openMemory(memory)} className="w-full p-4 text-left flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[16px] font-semibold leading-snug truncate" style={{ color: "var(--secondary-foreground)" }}>
                            {memory.title}
                          </h2>
                          <p className="text-[12px] mt-1 text-muted-foreground">
                            {memory.category} - {memory.sensitivity} - {memory.source} - {memory.contentLength} chars
                          </p>
                          <p className="text-[13px] mt-2 text-muted-foreground line-clamp-2">{memory.content}</p>
                        </div>
                        <ChevronRight size={18} className="text-muted-foreground shrink-0 mt-1" />
                      </button>
                    </FieldShell>
                  ))}
                </div>
              )}
            </>
          )}

          {page === "create" && renderEditor(true)}
          {page === "detail" && renderEditor(false)}
        </div>
      </div>
    </div>
  );
}

export default PersonalMemoryManager;
