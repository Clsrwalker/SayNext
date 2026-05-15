import { useEffect, useState } from "react";
import Header from "../components/Header";
import {
  fetchConversationSamples,
  updateConversationSample,
  type ConversationSample,
} from "../api/conversation-samples.api";

interface SampleReviewProps {
  userId: string;
  onBack: () => void;
}

const SCORE_VALUES = [1, 2, 3, 4, 5];

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {SCORE_VALUES.map((score) => (
          <button
            key={score}
            onClick={() => onChange(score)}
            className="w-8 h-8 rounded-full text-[13px] font-semibold"
            style={{
              backgroundColor: value === score ? "var(--secondary-foreground)" : "var(--primary-foreground)",
              color: value === score ? "var(--primary-foreground)" : "var(--secondary-foreground)",
              border: "1px solid var(--border)",
            }}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

function SampleCard({
  sample,
  onUpdated,
}: {
  sample: ConversationSample;
  onUpdated: (sample: ConversationSample) => void;
}) {
  const [draft, setDraft] = useState(sample);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(sample);
  }, [sample]);

  const save = async () => {
    setIsSaving(true);
    try {
      const updated = await updateConversationSample(sample.id, {
        natural: draft.natural,
        short: draft.short,
        fitsXiang: draft.fitsXiang,
        tooOfficial: draft.tooOfficial,
        directlySayable: draft.directlySayable,
        inventedInfo: draft.inventedInfo,
        idealReply: draft.idealReply,
        notes: draft.notes,
      });
      onUpdated(updated);
    } catch (error) {
      console.error("[SampleReview] Failed to save sample:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="rounded-[8px] p-4 space-y-4"
      style={{
        backgroundColor: "var(--primary-foreground)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex justify-between gap-3">
        <div className="text-[12px] text-muted-foreground">
          {new Date(sample.timestamp).toLocaleString()}
        </div>
        <div className="text-[12px] text-muted-foreground">{sample.model || "model unknown"}</div>
      </div>

      <div>
        <div className="text-[12px] text-muted-foreground mb-1">Transcript</div>
        <div className="text-[14px] leading-relaxed">{sample.transcript}</div>
      </div>

      <div>
        <div className="text-[12px] text-muted-foreground mb-1">AI reply</div>
        <div className="text-[14px] leading-relaxed">{sample.aiReply || "(no reply)"}</div>
      </div>

      <div className="space-y-2">
        <ScoreRow label="Natural" value={draft.natural} onChange={(natural) => setDraft({ ...draft, natural })} />
        <ScoreRow label="Short" value={draft.short} onChange={(short) => setDraft({ ...draft, short })} />
        <ScoreRow label="Fits Xiang" value={draft.fitsXiang} onChange={(fitsXiang) => setDraft({ ...draft, fitsXiang })} />
      </div>

      <div className="grid grid-cols-1 gap-2 text-[13px]">
        <label className="flex items-center justify-between gap-3">
          Too official
          <input
            type="checkbox"
            checked={draft.tooOfficial === true}
            onChange={(event) => setDraft({ ...draft, tooOfficial: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          Directly sayable
          <input
            type="checkbox"
            checked={draft.directlySayable === true}
            onChange={(event) => setDraft({ ...draft, directlySayable: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          Invented info
          <input
            type="checkbox"
            checked={draft.inventedInfo === true}
            onChange={(event) => setDraft({ ...draft, inventedInfo: event.target.checked })}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[12px] text-muted-foreground">Ideal reply</span>
        <textarea
          value={draft.idealReply}
          onChange={(event) => setDraft({ ...draft, idealReply: event.target.value })}
          className="mt-1 w-full min-h-[78px] rounded-[8px] p-3 text-[14px]"
          style={{
            backgroundColor: "var(--background)",
            color: "var(--secondary-foreground)",
            border: "1px solid var(--border)",
          }}
        />
      </label>

      <label className="block">
        <span className="text-[12px] text-muted-foreground">Notes</span>
        <textarea
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          className="mt-1 w-full min-h-[58px] rounded-[8px] p-3 text-[14px]"
          style={{
            backgroundColor: "var(--background)",
            color: "var(--secondary-foreground)",
            border: "1px solid var(--border)",
          }}
        />
      </label>

      <button
        onClick={save}
        disabled={isSaving}
        className="w-full min-h-[44px] rounded-[8px] text-[15px] font-semibold disabled:opacity-60"
        style={{
          backgroundColor: "var(--secondary-foreground)",
          color: "var(--primary-foreground)",
        }}
      >
        {isSaving ? "Saving..." : "Save rating"}
      </button>
    </div>
  );
}

function SampleReview({ userId, onBack }: SampleReviewProps) {
  const [samples, setSamples] = useState<ConversationSample[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setSamples(await fetchConversationSamples(userId, 25));
      } catch (error) {
        console.error("[SampleReview] Failed to load samples:", error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [userId]);

  const updateSampleInList = (updated: ConversationSample) => {
    setSamples((prev) => prev.map((sample) => (sample.id === updated.id ? updated : sample)));
  };

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: "var(--background)" }}>
      <Header onSettingsClick={onBack} showBackArrow={true} />
      <div className="flex-1 overflow-y-auto px-[20px] py-6 space-y-4">
        <div>
          <h1 className="text-[22px] font-semibold">Training Samples</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Rate recent replies and write better versions for future RAG or fine-tuning.
          </p>
        </div>

        {isLoading && <div className="text-[14px] text-muted-foreground">Loading samples...</div>}
        {!isLoading && samples.length === 0 && (
          <div className="text-[14px] text-muted-foreground">No samples saved yet.</div>
        )}
        {samples.map((sample) => (
          <SampleCard key={sample.id} sample={sample} onUpdated={updateSampleInList} />
        ))}
      </div>
    </div>
  );
}

export default SampleReview;
