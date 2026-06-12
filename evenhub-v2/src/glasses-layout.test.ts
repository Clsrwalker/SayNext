import { describe, expect, test } from "vitest";
import { buildGlassesPage, GLASS_TRANSCRIPT_LINE_CHARS, GLASS_TRANSCRIPT_MAX_LINES } from "./glasses-layout";
import { buildMenuItems, startLiveGlasses } from "./glasses-state";
import { TEST_CUES, TEST_PRENOTES, TEST_TRANSCRIPT } from "./test-fixtures";
import type { TranscriptLine } from "./types";

const LONG_TRANSCRIPT: TranscriptLine[] = [
  {
    id: "long-1",
    time: "00:00:01",
    text: "This older sentence should disappear when there are newer transcript lines available.",
  },
  {
    id: "long-2",
    time: "00:00:02",
    text: "Questions generally are going to cost normalizing the inputs itself with enough words to wrap.",
  },
  {
    id: "long-3",
    time: "00:00:03",
    text: "You think about how the activations themselves are normalized across a batch during training.",
  },
  {
    id: "long-4",
    time: "00:00:04",
    text: "So we are going to get the mean and variance of this batch before applying scale and shift.",
    partial: true,
  },
];

describe("buildGlassesPage", () => {
  test("uses a wider subtitle line budget", () => {
    expect(GLASS_TRANSCRIPT_LINE_CHARS).toBe(48);
  });

  test("main layout has header, AI cue box, and three-line transcript box", () => {
    const page = buildGlassesPage({
      state: startLiveGlasses(TEST_CUES[0].id),
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      now: new Date("2026-06-05T13:35:00-03:00"),
    });

    expect(page.view).toBe("main");
    expect(page.containers).toHaveLength(3);
    const rightHeader = page.containers.find((container) => container.kind === "text" && container.name === "h-right");
    expect(rightHeader?.kind).toBe("text");
    if (rightHeader?.kind === "text") {
      expect(rightHeader.x).toBeGreaterThan(400);
      expect(rightHeader.content).toContain("1:35");
      expect(rightHeader.padding).toBe(0);
    }
    const transcript = page.containers.find((container) => container.kind === "text" && container.name === "transcript");
    const cue = page.containers.find((container) => container.kind === "text" && container.name === "ai-cue");
    expect(transcript?.kind).toBe("text");
    expect(cue?.kind).toBe("text");
    if (cue?.kind === "text") {
      expect(cue.y).toBe(34);
      expect(cue.height).toBe(166);
    }
    if (transcript?.kind === "text") {
      expect(transcript.content.split("\n")).toHaveLength(3);
      expect(transcript.y).toBe(204);
      expect(transcript.height).toBe(84);
      expect(transcript.padding).toBe(0);
    }
  });

  test("main layout is blank before a cue is explicitly generated or selected", () => {
    const page = buildGlassesPage({
      state: startLiveGlasses(null),
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const cue = page.containers.find((container) => container.kind === "text" && container.name === "ai-cue");
    expect(cue?.kind).toBe("text");
    if (cue?.kind === "text") {
      expect(cue.content).toBe("");
    }
  });

  test("transcript content wraps into the latest subtitle lines without ellipsis", () => {
    const page = buildGlassesPage({
      state: startLiveGlasses(null),
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: LONG_TRANSCRIPT,
    });
    const transcript = page.containers.find((container) => container.kind === "text" && container.name === "transcript");
    expect(transcript?.kind).toBe("text");
    if (transcript?.kind === "text") {
      const lines = transcript.content.split("\n");
      expect(lines).toHaveLength(GLASS_TRANSCRIPT_MAX_LINES);
      expect(transcript.content).not.toContain("older sentence");
      expect(transcript.content).not.toContain("...");
      expect(transcript.content.replace(/\s+/g, " ")).toContain("scale and shift");
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(GLASS_TRANSCRIPT_LINE_CHARS);
      }
    }
  });

  test("transcript wrapping prefers punctuation boundaries", () => {
    const page = buildGlassesPage({
      state: startLiveGlasses(null),
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: [
        {
          id: "semantic-1",
          time: "00:00:01",
          text: "The answer is batch normalization. It uses mean and variance, then it learns scale and shift?",
          partial: true,
        },
      ],
    });
    const transcript = page.containers.find((container) => container.kind === "text" && container.name === "transcript");
    expect(transcript?.kind).toBe("text");
    if (transcript?.kind === "text") {
      const lines = transcript.content.split("\n");
      expect(lines).toHaveLength(3);
      expect(transcript.content).toContain("normalization.\n");
      expect(transcript.content).toContain("variance,\n");
      expect(transcript.content).not.toContain("...");
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(GLASS_TRANSCRIPT_LINE_CHARS);
      }
    }
  });


  test("menu layout uses the official ListContainer and keeps transcript visible below it", () => {
    const state = { ...startLiveGlasses(TEST_CUES[0].id), view: "menu" as const, selectedIndex: 0 };
    const page = buildGlassesPage({
      state,
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const list = page.containers.find((container) => container.kind === "list");
    const rows = page.containers.filter((container) => container.kind === "text" && container.name.startsWith("menu-row"));
    const selection = page.containers.find((container) => container.kind === "text" && container.name === "menu-selection");
    const transcript = page.containers.find((container) => container.kind === "text" && container.name === "transcript");
    expect(list?.kind).toBe("list");
    expect(rows).toHaveLength(0);
    expect(selection).toBeUndefined();
    expect(transcript?.kind).toBe("text");
    if (list?.kind === "list") {
      expect(list.items).toHaveLength(buildMenuItems({ prenote: TEST_PRENOTES[0], cues: TEST_CUES }).length);
      expect(list.items[0]).toContain("Prenote");
      expect(list.y).toBe(28);
      expect(list.height).toBe(176);
      expect(list.borderWidth).toBe(0);
      expect(list.eventCapture).toBe(true);
    }
    if (transcript?.kind === "text" && list?.kind === "list") {
      expect(transcript.y).toBe(204);
      expect(transcript.height).toBe(84);
      expect(transcript.y).toBeGreaterThanOrEqual(list.y + list.height);
    }
  });

  test("prenote detail covers the transcript area with one large text container", () => {
    const page = buildGlassesPage({
      state: { ...startLiveGlasses(TEST_CUES[0].id), view: "prenote_detail" },
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
    });
    const detail = page.containers.find((container) => container.kind === "text" && container.name === "prenote");
    expect(detail?.kind).toBe("text");
    if (detail?.kind === "text") {
      expect(detail.height).toBeGreaterThan(220);
      expect(detail.content).toContain("TRANSFER LEARNING");
    }
  });
});
