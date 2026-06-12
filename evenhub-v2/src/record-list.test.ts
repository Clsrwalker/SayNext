import { describe, expect, test } from "vitest";
import { removeRecordById, replaceRecordInPlace } from "./record-list";
import type { ConversationRecord } from "./types";

function record(id: string): ConversationRecord {
  return {
    id,
    title: id,
    startedAt: id,
    location: "-",
    duration: "00:00:00",
    summary: "-",
    keyPoints: [],
    actionItems: [],
    transcript: [],
    cueHistory: [],
  };
}

describe("record list helpers", () => {
  test("replaces a record without moving it to the top", () => {
    const result = replaceRecordInPlace([record("newest"), record("middle"), record("oldest")], {
      ...record("middle"),
      title: "Loaded detail",
    });

    expect(result.map((item) => item.id)).toEqual(["newest", "middle", "oldest"]);
    expect(result[1].title).toBe("Loaded detail");
  });

  test("removes only the selected record", () => {
    const result = removeRecordById([record("newest"), record("middle"), record("oldest")], "middle");
    expect(result.map((item) => item.id)).toEqual(["newest", "oldest"]);
  });
});
