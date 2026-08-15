import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lesson route parameters", () => {
  it("awaits the Next.js 16 params promise before looking up a lesson", () => {
    const source = readFileSync(
      new URL("./page.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toMatch(/params:\s*Promise<\{\s*lessonId:\s*string\s*\}>/);
    expect(source).toMatch(/const\s+\{\s*lessonId\s*\}\s*=\s*await\s+params/);
    expect(source).toContain("getLesson(lessonId, lessons)");
  });
});
