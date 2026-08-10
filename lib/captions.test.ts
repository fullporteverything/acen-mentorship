import { describe, expect, it } from "vitest";
import { hasEnglishSubtitle } from "./captions";

describe("caption retry state", () => {
  it("recognizes existing and pending English subtitle records", () => {
    expect(
      hasEnglishSubtitle({ data: { subtitles: [{ language: "en", status: "pending" }] } })
    ).toBe(true);
    expect(hasEnglishSubtitle({ subtitles: [{ lang: "English" }] })).toBe(true);
  });

  it("does not mistake another language for English", () => {
    expect(hasEnglishSubtitle({ data: { subtitles: [{ language: "es" }] } })).toBe(false);
  });
});
