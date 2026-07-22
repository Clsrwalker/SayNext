import { describe, expect, test } from "vitest";
import { formatG2CueTitle, PHONE_CUE_LABEL } from "./cue-icons";

describe("code cue icon mapping", () => {
  test("uses a stable ASCII marker on G2 and a readable phone label", () => {
    expect(formatG2CueTitle("code", "Two sum")).toBe("[C] Two sum");
    expect(PHONE_CUE_LABEL.code).toBe("Code");
  });
});
