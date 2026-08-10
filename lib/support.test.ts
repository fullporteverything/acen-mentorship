import { describe, expect, it } from "vitest";
import { supportUrl } from "./support";

describe("supportUrl", () => {
  it("accepts safe local and web destinations", () => {
    expect(supportUrl("/help")).toBe("/help");
    expect(supportUrl("https://discord.gg/example")).toBe("https://discord.gg/example");
  });

  it("falls back in-site for missing or unsafe destinations", () => {
    expect(supportUrl("")).toBe("/support");
    expect(supportUrl("javascript:alert(1)")).toBe("/support");
    expect(supportUrl("//host.example/path")).toBe("/support");
    expect(supportUrl("/\\evil.example/path")).toBe("/support");
  });
});
