import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { NDA_HASH, NDA_OPERATOR, NDA_TEXT, NDA_VERSION } from "@/lib/nda";

describe("nda", () => {
  it("computes NDA_HASH as the sha256 hex of NDA_TEXT", () => {
    const expected = createHash("sha256").update(NDA_TEXT, "utf8").digest("hex");
    expect(NDA_HASH).toBe(expected);
    expect(NDA_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names ACEN LLC as the operator and marks the text as a placeholder", () => {
    expect(NDA_OPERATOR).toBe("ACEN LLC");
    expect(NDA_TEXT).toContain("ACEN LLC");
    expect(NDA_TEXT).toContain("PLACEHOLDER");
  });

  it("keeps the version a positive integer", () => {
    expect(NDA_VERSION).toBe(1);
    expect(Number.isInteger(NDA_VERSION)).toBe(true);
  });
});
