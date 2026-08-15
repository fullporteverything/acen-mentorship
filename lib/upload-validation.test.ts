import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { contentDisposition, validateImage, validatePdf } from "./upload-validation";
import { minimalPdf } from "@/test/fixtures/pdf";

const bytes = (...values: number[]) => new Blob([new Uint8Array(values)]);

describe("upload validation", () => {
  it("does not load the DOMMatrix-dependent PDF renderer", () => {
    const source = readFileSync(new URL("./upload-validation.ts", import.meta.url), "utf8");
    expect(source).not.toContain("pdf-parse");
  });
  it("requires PDF magic bytes and a parseable trailer", async () => {
    await expect(validatePdf(new Blob([minimalPdf()]))).resolves.toMatchObject({ valid: true });
    await expect(validatePdf(bytes(...new TextEncoder().encode("<script>")))).resolves.toMatchObject({ valid: false });
    await expect(validatePdf(bytes(...new TextEncoder().encode("%PDF-1.7\n")))).resolves.toMatchObject({ valid: false });
  });

  it("requires recognized image signatures and non-zero dimensions", async () => {
    const png = bytes(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 73, 69, 78, 68, 174, 66, 96, 130);
    await expect(validateImage(png)).resolves.toMatchObject({ valid: true, contentType: "image/png", width: 1, height: 1 });
    await expect(validateImage(bytes(1, 2, 3))).resolves.toMatchObject({ valid: false });
  });

  it("uses a safe attachment disposition without reflected control characters", () => {
    expect(contentDisposition('evil\r\nX-Test: yes.pdf')).toBe('attachment; filename="evil__X-Test_ yes.pdf"');
  });
});
