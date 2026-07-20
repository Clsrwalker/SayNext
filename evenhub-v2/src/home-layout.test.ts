import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("home record list layout", () => {
  test("record list is a constrained scroll region above the fixed prenote dock", () => {
    expect(styles).toMatch(/\.record-section\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
    expect(styles).toMatch(/\.record-list\s*{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });
});
