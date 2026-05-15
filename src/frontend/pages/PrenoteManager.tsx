import { useEffect, useRef, useState } from "react";
import Header from "../components/Header";
import { createPrenote, deletePrenote, fetchPrenotes, setActivePrenote, type Prenote } from "../api/prenotes.api";

interface PrenoteManagerProps {
  userId: string;
  onBack: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function PrenoteManager({ userId, onBack }: PrenoteManagerProps) {
  const [prenotes, setPrenotes] = useState<Prenote[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPrenotes = async () => {
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

  useEffect(() => {
    loadPrenotes();
  }, [userId]);

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
        description: description.trim(),
        sourceText,
        files: files || undefined,
        setActive: true,
      });
      setTitle("");
      setDescription("");
      setSourceText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadPrenotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prenote");
    } finally {
      setIsCreating(false);
    }
  };

  const handleActivate = async (id: number) => {
    setError("");
    try {
      await setActivePrenote(userId, id, true);
      await loadPrenotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate prenote");
    }
  };

  const handleDelete = async (id: number) => {
    setError("");
    try {
      await deletePrenote(userId, id);
      await loadPrenotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete prenote");
    }
  };

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        backgroundColor: "var(--background)",
        overscrollBehavior: "none",
        touchAction: "pan-y",
      }}
    >
      <Header onSettingsClick={onBack} showBackArrow={true} />

      <div
        className="flex-1 px-[24px] pt-[32px] pb-[32px] overflow-y-auto"
        style={{
          overscrollBehavior: "none",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
        }}
      >
        <div className="max-w-3xl mx-auto space-y-5">
          <div>
            <h1 className="text-[24px] font-bold" style={{ color: "var(--secondary-foreground)" }}>
              Prenote
            </h1>
            <p className="text-[13px] mt-1 text-muted-foreground">
              Prepare context before a class, interview, meeting, or task.
            </p>
          </div>

          <div
            className="rounded-[8px] border p-4 space-y-3"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--primary-foreground)" }}
          >
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title optional"
              className="w-full rounded-[6px] px-3 py-2 text-[15px] outline-none"
              style={{ backgroundColor: "var(--background)", color: "var(--secondary-foreground)" }}
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short description"
              className="w-full rounded-[6px] px-3 py-2 text-[15px] outline-none"
              style={{ backgroundColor: "var(--background)", color: "var(--secondary-foreground)" }}
            />
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste notes, job description, course content, meeting agenda..."
              rows={7}
              className="w-full rounded-[6px] px-3 py-2 text-[15px] outline-none resize-y"
              style={{ backgroundColor: "var(--background)", color: "var(--secondary-foreground)" }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.pptx,.xlsx,.xml,.html,.htm,.txt,.md,.csv,.json,.yaml,.yml,.rtf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.heic,image/*,application/pdf"
              className="block w-full text-[13px]"
              style={{ color: "var(--secondary-foreground)" }}
            />
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60"
              style={{
                backgroundColor: "var(--secondary-foreground)",
                color: "var(--primary-foreground)",
              }}
            >
              {isCreating ? "Processing..." : "Create and Activate"}
            </button>
            {error && <p className="text-[13px] text-red-500">{error}</p>}
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <p className="text-[14px] text-muted-foreground">Loading prenotes...</p>
            ) : prenotes.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">No prenotes yet.</p>
            ) : (
              prenotes.map((prenote) => (
                <div
                  key={prenote.id}
                  className="rounded-[8px] border p-4 space-y-3"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--primary-foreground)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-[16px] font-semibold" style={{ color: "var(--secondary-foreground)" }}>
                          {prenote.title}
                        </h2>
                        {prenote.isActive && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600">
                            Active
                          </span>
                        )}
                      </div>
                      {prenote.description && (
                        <p className="text-[13px] mt-1 text-muted-foreground">{prenote.description}</p>
                      )}
                    </div>
                    <span className="text-[12px] text-muted-foreground">{prenote.status}</span>
                  </div>

                  <div className="text-[12px] text-muted-foreground">
                    Runtime: {prenote.runtimeContextLength} chars · Extracted: {prenote.extractedTextLength} chars
                  </div>

                  {prenote.files.length > 0 && (
                    <div className="space-y-1">
                      {prenote.files.map((file) => (
                        <div key={file.id} className="text-[12px] text-muted-foreground">
                          {file.fileName} · {formatBytes(file.sizeBytes)} · {file.status}
                          {file.error ? ` · ${file.error}` : ""}
                        </div>
                      ))}
                    </div>
                  )}

                  {prenote.error && (
                    <p className="text-[12px] text-yellow-600 whitespace-pre-wrap">{prenote.error}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleActivate(prenote.id)}
                      disabled={prenote.isActive}
                      className="px-3 py-2 rounded-[6px] text-[13px] font-semibold disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--secondary-foreground)",
                        color: "var(--primary-foreground)",
                      }}
                    >
                      Use
                    </button>
                    <button
                      onClick={() => handleDelete(prenote.id)}
                      className="px-3 py-2 rounded-[6px] text-[13px] font-semibold"
                      style={{
                        backgroundColor: "transparent",
                        color: "var(--secondary-foreground)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PrenoteManager;
