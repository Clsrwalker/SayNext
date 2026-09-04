import { describe, expect, test } from "vitest";
import { describeGlassPage } from "./glass-diagnostics";
import type { GlassPageSpec } from "./glasses-layout";

describe("glass diagnostics", () => {
  test("measures UTF-8 bytes without retaining rendered text", () => {
    const page: GlassPageSpec = {
      view: "cue_detail",
      containers: [
        {
          kind: "text",
          id: 1,
          name: "answer",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          content: "A你",
        },
        {
          kind: "list",
          id: 2,
          name: "menu",
          x: 0,
          y: 100,
          width: 100,
          height: 100,
          items: ["one", "问题"],
          selectedIndex: 0,
        },
      ],
    };

    expect(describeGlassPage(page)).toEqual({
      view: "cue_detail",
      textContainerCount: 1,
      listItemCount: 2,
      totalTextBytes: 4,
      maxTextBytes: 4,
      maxListItemBytes: 6,
    });
  });
});
