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
  test("isolates each code detail upgrade from the main cue and other code cues", () => {
    const firstCode = {
      ...TEST_CUES[0],
      id: "cue-code-first",
      category: "code" as const,
      output: "def first():\n  return 1",
      code: "def first():\n  return 1",
    };
    const secondCode = {
      ...firstCode,
      id: "cue-code-second",
      output: "def second():\n  return 2",
      code: "def second():\n  return 2",
    };
    const detailContainer = (cue: typeof firstCode) => {
      const page = buildGlassesPage({
        state: { ...startLiveGlasses(cue.id), view: "cue_detail" },
        cues: [cue],
        prenote: null,
        transcript: TEST_TRANSCRIPT,
      });
      return page.containers.find(
        (container) => container.kind === "text" && container.deferContentUntilUpgrade,
      );
    };

    const first = detailContainer(firstCode);
    const second = detailContainer(secondCode);

    expect(first?.kind).toBe("text");
    expect(first?.name).not.toBe("ai-cue");
    expect(first?.name).not.toBe(second?.name);
  });

  test("uses a wider subtitle line budget", () => {
    expect(GLASS_TRANSCRIPT_LINE_CHARS).toBe(48);
  });

  test("root idle shows one visible R1-selectable start button", () => {
    const page = buildGlassesPage({
      state: {
        view: "root_idle",
        selectedIndex: 0,
        activeCueId: null,
        latestCueId: null,
        autoCueVisibleUntil: null,
      },
      cues: [],
      prenote: null,
      transcript: [],
    });

    const start = page.containers.find((container) => container.name === "start-conversation");
    expect(start?.kind).toBe("text");
    if (start?.kind === "text") {
      expect(start.content).toBe("Start conversation");
      expect(start.borderWidth).toBeGreaterThan(0);
      expect(start.eventCapture).toBe(true);
    }
    expect(page.containers.filter((container) => container.eventCapture)).toHaveLength(1);
    expect(page.containers.some(
      (container) => container.kind === "text" && container.content.includes("from the phone"),
    )).toBe(false);
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

  test("shows the same complete answer on main and in cue detail", () => {
    const cue = {
      ...TEST_CUES[0],
      preview: "A short answer preview.",
      fullAnswer: "A short answer preview. This second sentence contains the implementation detail needed to finish the answer.",
      output: "A short answer preview. This second sentence contains the implementation detail needed to finish the answer.",
    };
    const main = buildGlassesPage({
      state: startLiveGlasses(cue.id),
      cues: [cue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const detail = buildGlassesPage({
      state: { ...startLiveGlasses(cue.id), view: "cue_detail" },
      cues: [cue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });

    const mainCue = main.containers.find((container) => container.kind === "text" && container.name === "ai-cue");
    const detailCue = detail.containers.find((container) => container.kind === "text" && container.name === "ai-cue");
    const completeAnswer = "A short answer preview. This second sentence contains the implementation detail needed to finish the answer.";
    expect(mainCue?.kind === "text" ? mainCue.content : "").toBe(completeAnswer);
    expect(detailCue?.kind === "text" ? detailCue.content : "").toBe(completeAnswer);
  });

  test("code cue keeps only complete source, newlines, and indentation in the scrollable cue container", () => {
    const middle = Array.from(
      { length: 20 },
      (_, index) => `  const value${index} = nums[${index % 3}];`,
    ).join("\n");
    const code = `function solve(nums: number[]) {\n${middle}\n\n  return nums.length;\n}`;
    const cue = {
      id: "cue-code-1",
      category: "code" as const,
      title: "Solve array",
      g2Title: "Solve array",
      preview: "Use one pass.",
      fullAnswer: "I use one pass through the array.",
      output: code,
      language: "typescript",
      code,
      createdAt: "2026-07-21T10:00:00.000Z",
      source: "auto" as const,
    };
    const page = buildGlassesPage({
      state: startLiveGlasses(cue.id),
      cues: [cue],
      prenote: null,
      transcript: TEST_TRANSCRIPT,
    });
    const codeContainer = page.containers.find(
      (container) => container.kind === "text" && container.name === "ai-cue",
    );

    expect(codeContainer?.kind).toBe("text");
    if (codeContainer?.kind === "text") {
      expect(codeContainer.eventCapture).toBe(true);
      expect(codeContainer.content).toBe(code);
      expect(codeContainer.content).not.toContain("I use one pass through the array.");
      expect(codeContainer.content).toContain("\n  const value0");
      expect(codeContainer.content).toContain("\n\n  return nums.length;\n}");
      expect(codeContainer.content).not.toContain("...");
    }
  });

  test("can hide transcript from the glasses page without affecting phone data", () => {
    const page = buildGlassesPage({
      state: startLiveGlasses(TEST_CUES[0].id),
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      glassContent: {
        aiCue: true,
        transcript: false,
      },
    });

    expect(page.containers.some((container) => container.kind === "text" && container.name === "transcript")).toBe(false);
    expect(page.containers.some((container) => container.kind === "text" && container.name === "ai-cue")).toBe(true);
  });

  test("can hide AI cue body from the glasses page while keeping the layout stable", () => {
    const page = buildGlassesPage({
      state: startLiveGlasses(TEST_CUES[0].id),
      cues: TEST_CUES,
      prenote: TEST_PRENOTES[0],
      transcript: TEST_TRANSCRIPT,
      glassContent: {
        aiCue: false,
        transcript: true,
      },
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
