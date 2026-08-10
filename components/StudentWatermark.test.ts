import { describe, expect, it } from "vitest";
import { watermarkLabelStyle } from "@/lib/watermark-style";

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
