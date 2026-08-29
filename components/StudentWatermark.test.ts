import { describe, expect, it } from "vitest";
import { watermarkLabelStyle, watermarkName } from "@/lib/watermark-style";

describe("student watermark rendering", () => {
  it("uses a crisp high-contrast outline without blurred shadows", () => {
    const style = watermarkLabelStyle(false);

    expect(style.color).toBe("rgba(255,255,255,0.72)");
    expect(style.fontWeight).toBe(700);
    expect(style.WebkitTextStroke).toBe("0.45px rgba(0,0,0,0.9)");
    expect(style.textShadow).not.toContain("3px");
    expect(style.transition).toBeUndefined();
  });
});

describe("which name goes on the watermark", () => {
  it("uses the Discord @handle, not the display name", () => {
    // The display name is changeable and not unique; the handle is neither.
    // Naming the wrong member on a leaked frame is the failure to avoid.
    expect(watermarkName({ username: "acen", name: "ACEN | Mentor" })).toBe("acen");
  });

  it("falls back to the display name only when no handle was captured", () => {
    // Sessions issued before the handle was stored. They age out with the
    // 8-hour session lifetime.
    expect(watermarkName({ name: "ACEN | Mentor" })).toBe("ACEN | Mentor");
    expect(watermarkName({ username: null, name: "ACEN | Mentor" })).toBe(
      "ACEN | Mentor"
    );
  });

  it("ignores a blank handle rather than watermarking with nothing", () => {
    expect(watermarkName({ username: "   ", name: "ACEN | Mentor" })).toBe(
      "ACEN | Mentor"
    );
  });

  it("never returns an empty label", () => {
    // An unlabelled watermark is worse than none: it looks like protection
    // while identifying nobody.
    expect(watermarkName({})).toBe("Discord user");
    expect(watermarkName({ username: "", name: "" })).toBe("Discord user");
  });

  it("trims surrounding whitespace so the label sits where it is placed", () => {
    expect(watermarkName({ username: "  acen  " })).toBe("acen");
  });
});
