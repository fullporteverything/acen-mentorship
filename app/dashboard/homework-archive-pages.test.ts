import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("homework archive page placement", () => {
  it("places the latest archive on Overview and provides the full dashboard page", () => {
    const overview = readFileSync("app/dashboard/page.tsx", "utf8");
    expect(overview).toContain("<MyHomeworkCard");
    expect(existsSync("app/dashboard/homework/page.tsx")).toBe(true);
  });
});
