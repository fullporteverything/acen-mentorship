import { describe, expect, it } from "vitest";
import {
  MAX_TICKET_BODY,
  sanitizeTicketBody,
  supportUrl,
  ticketThreadName,
} from "./support";

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

describe("sanitizeTicketBody", () => {
  it("keeps ordinary prose and its line breaks", () => {
    expect(sanitizeTicketBody("Locked out.\nCan you check?")).toBe(
      "Locked out.\nCan you check?"
    );
  });

  it("defuses mass mentions without hiding what was written", () => {
    const cleaned = sanitizeTicketBody("help @everyone and @HERE now");
    expect(cleaned).not.toMatch(/@everyone/);
    expect(cleaned).not.toMatch(/@HERE/);
    expect(cleaned).toContain("everyone");
    expect(cleaned).toContain("HERE");
  });

  it("strips control characters and caps the length", () => {
    expect(sanitizeTicketBody("a\u0000b\u001fc")).toBe("abc");
    expect(sanitizeTicketBody("x".repeat(900))).toHaveLength(MAX_TICKET_BODY);
  });

  it("treats a missing or non-string body as empty", () => {
    expect(sanitizeTicketBody(undefined)).toBe("");
    expect(sanitizeTicketBody({ toString: () => "nope" })).toBe("");
  });
});

describe("ticketThreadName", () => {
  it("slugs the username into Discord-safe characters", () => {
    expect(ticketThreadName("Kenji.Sato", "abc12345")).toBe("ticket-kenji-sato-abc12345");
  });

  it("names a thread even when the username survives nothing", () => {
    expect(ticketThreadName("!!!", "abc12345")).toBe("ticket-member-abc12345");
    expect(ticketThreadName(null, "abc12345")).toBe("ticket-member-abc12345");
  });

  it("stays inside Discord's 100-character thread name limit", () => {
    expect(ticketThreadName("n".repeat(300), "abc12345").length).toBeLessThanOrEqual(100);
  });
});
