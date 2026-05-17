import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import Header from "../components/Header";
import {
  createSceneProfile,
  deleteSceneProfile,
  fetchSceneProfile,
  fetchSceneProfiles,
  updateSceneProfile,
  type SceneProfile,
} from "../api/scene-profiles.api";

interface SceneProfileManagerProps {
  userId: string;
  onBack: () => void;
}

type PageMode = "list" | "create" | "detail";

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

const EMPTY_CUSTOM_PROMPT = `Scene:

Goal:

Style:

When to speak:

When to keep it minimal:

Avoid:
`;

function SceneProfileManager({ userId, onBack }: SceneProfileManagerProps) {
  const [page, setPage] = useState<PageMode>("list");
  const [profiles, setProfiles] = useState<SceneProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SceneProfile | null>(null);
  const [createName, setCreateName] = useState("");
  const [createPrompt, setCreatePrompt] = useState(EMPTY_CUSTOM_PROMPT);
  const [detailName, setDetailName] = useState("");
  const [detailPrompt, setDetailPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const activeProfile = profiles.find((profile) => profile.isActive);

  const loadProfiles = async () => {
    setIsLoading(true);
    setError("");
    try {
      setProfiles(await fetchSceneProfiles(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scene profiles");
    } finally {
      setIsLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    setIsLoadingDetail(true);
    setError("");
    try {
      const profile = await fetchSceneProfile(userId, id);
      setDetail(profile);
      setDetailName(profile.name);
      setDetailPrompt(profile.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scene profile");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, [userId]);

  useEffect(() => {
    if (page === "detail" && selectedId !== null) {
      loadDetail(selectedId);
    }
  }, [page, selectedId]);

  const goList = async () => {
    setPage("list");
    setSelectedId(null);
    setDetail(null);
    setError("");
    await loadProfiles();
  };

  const handleSetActive = async (profile: SceneProfile) => {
    const previous = profiles;
    setProfiles((current) => current.map((item) => ({ ...item, isActive: item.id === profile.id })));
    setError("");

    try {
      const updated = await updateSceneProfile({ userId, id: profile.id, isActive: true });
      setProfiles((current) => current.map((item) => ({ ...item, isActive: item.id === updated.id })));
      if (detail?.id === updated.id) setDetail(updated);
    } catch (err) {
      setProfiles(previous);
      setError(err instanceof Error ? err.message : "Failed to activate scene profile");
    }
  };

  const handleCreate = async () => {
    if (!createPrompt.trim()) {
      setError("Prompt is required.");
      return;
    }

    setIsCreating(true);
    setError("");
    try {
      await createSceneProfile({
        userId,
        name: createName.trim() || "Custom Scene",
        prompt: createPrompt,
        isActive: true,
      });
      setCreateName("");
      setCreatePrompt(EMPTY_CUSTOM_PROMPT);
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scene profile");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (!detail) return;
    if (!detailPrompt.trim()) {
      setError("Prompt is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const updated = await updateSceneProfile({
        userId,
        id: detail.id,
        name: detailName,
        prompt: detailPrompt,
      });
      setDetail(updated);
      setProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scene profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefault = async () => {
    if (!detail?.isBuiltin) return;

    setIsSaving(true);
    setError("");
    try {
      const updated = await updateSceneProfile({ userId, id: detail.id, resetDefault: true });
      setDetail(updated);
      setDetailName(updated.name);
      setDetailPrompt(updated.prompt);
      setProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset default scene profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (profile: SceneProfile) => {
    setError("");
    try {
      await deleteSceneProfile(userId, profile.id);
      await goList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete scene profile");
    }
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setPage("detail");
    setError("");
  };

  const headerBack = page === "list" ? onBack : goList;

  return (
    <div
      className="h-screen flex flex-col"
      style={{ backgroundColor: "var(--background)", overscrollBehavior: "none", touchAction: "pan-y" }}
    >
      <Header onSettingsClick={headerBack} showBackArrow={true} />

      <div
        className="flex-1 px-[22px] pt-[20px] pb-[32px] overflow-y-auto"
        style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
      >
        <div className="max-w-3xl mx-auto">
          {page === "list" && (
            <>
              <div className="flex items-center justify-between gap-4 mb-5">
                <div className="min-w-0">
                  <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                    Scene Profiles
                  </h1>
                  <p className="text-[13px] mt-1 text-muted-foreground truncate">
                    {activeProfile ? `Active: ${activeProfile.name}` : "Choose one active scene"}
                  </p>
                </div>

                <button
                  aria-label="Add scene profile"
                  onClick={() => {
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

              {isLoading ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : (
                <div className="space-y-3">
                  {profiles.map((profile) => (
                    <FieldShell key={profile.id}>
                      <div className="flex items-start gap-3 p-4">
                        <input
                          aria-label={`Use ${profile.name}`}
                          type="radio"
                          name="active-scene-profile"
                          checked={profile.isActive}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => handleSetActive(profile)}
                          className="mt-1 w-[24px] h-[24px] shrink-0"
                          style={{ accentColor: "var(--secondary-foreground)" }}
                        />

                        <button type="button" onClick={() => openDetail(profile.id)} className="min-w-0 flex-1 text-left">
                          <h2 className="text-[16px] font-semibold leading-snug truncate" style={{ color: "var(--secondary-foreground)" }}>
                            {profile.name}
                          </h2>
                          <p className="text-[12px] mt-1 text-muted-foreground">
                            {profile.isBuiltin ? "built-in" : "custom"} - {profile.promptLength} chars prompt
                          </p>
                        </button>

                        <ChevronRight size={18} className="mt-2 shrink-0 text-muted-foreground" />
                      </div>
                    </FieldShell>
                  ))}
                </div>
              )}
            </>
          )}

          {page === "create" && (
            <>
              <div className="mb-5">
                <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                  Add Scene
                </h1>
                <p className="text-[13px] mt-1 text-muted-foreground">Write one prompt that defines behavior for this scene.</p>
              </div>

              {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

              <div className="space-y-3">
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Scene name"
                  className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none border"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />

                <textarea
                  value={createPrompt}
                  onChange={(event) => setCreatePrompt(event.target.value)}
                  rows={18}
                  className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
                  style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                />

                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60 transition-transform active:scale-[0.99]"
                  style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
                >
                  {isCreating ? "Creating..." : "Add and use scene"}
                </button>
              </div>
            </>
          )}

          {page === "detail" && (
            <>
              {isLoadingDetail ? (
                <p className="text-[14px] text-muted-foreground">Loading...</p>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h1 className="text-[24px] font-bold leading-tight" style={{ color: "var(--secondary-foreground)" }}>
                        Edit Scene
                      </h1>
                      <p className="text-[13px] mt-1 text-muted-foreground">
                        {detail.isBuiltin ? "Built-in profile" : "Custom profile"} - {detailPrompt.length} chars
                      </p>
                    </div>
                    <input
                      aria-label={`Use ${detail.name}`}
                      type="radio"
                      name="detail-active-scene-profile"
                      checked={detail.isActive}
                      onChange={() => handleSetActive(detail)}
                      className="mt-1 w-[26px] h-[26px] shrink-0"
                      style={{ accentColor: "var(--secondary-foreground)" }}
                    />
                  </div>

                  {error && <p className="text-[13px] text-red-500">{error}</p>}

                  <input
                    value={detailName}
                    onChange={(event) => setDetailName(event.target.value)}
                    placeholder="Scene name"
                    className="w-full rounded-[8px] px-3 py-3 text-[15px] outline-none border"
                    style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                  />

                  <textarea
                    value={detailPrompt}
                    onChange={(event) => setDetailPrompt(event.target.value)}
                    rows={20}
                    className="w-full rounded-[8px] px-3 py-3 text-[13px] outline-none resize-y border leading-relaxed"
                    style={{ backgroundColor: "var(--primary-foreground)", color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                  />

                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold disabled:opacity-60"
                    style={{ backgroundColor: "var(--secondary-foreground)", color: "var(--primary-foreground)" }}
                  >
                    <Save size={16} />
                    {isSaving ? "Saving..." : "Save scene"}
                  </button>

                  {detail.isBuiltin ? (
                    <button
                      onClick={handleResetDefault}
                      disabled={isSaving}
                      className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold border flex items-center justify-center gap-2 disabled:opacity-60"
                      style={{ color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                    >
                      <RotateCcw size={16} />
                      Reset to default
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDelete(detail)}
                      className="w-full rounded-[8px] px-4 py-3 text-[15px] font-semibold border flex items-center justify-center gap-2"
                      style={{ color: "var(--secondary-foreground)", borderColor: "var(--border)" }}
                    >
                      <Trash2 size={16} />
                      Delete scene
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[14px] text-muted-foreground">Scene profile not found.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SceneProfileManager;
