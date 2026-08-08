import { describe, expect, it } from "vitest";
import { isKinescopeVideoId } from "./video-id";

describe("isKinescopeVideoId", () => {
  it("accepts lowercase canonical UUIDs", () => {
    expect(isKinescopeVideoId("57c95d80-7a5b-43f5-b3c9-7fbabb5c54f0")).toBe(true);
  });

  it("accepts uppercase canonical UUIDs", () => {
    expect(isKinescopeVideoId("57C95D80-7A5B-43F5-B3C9-7FBABB5C54F0")).toBe(true);
  });

  it("rejects Cloudflare IDs, placeholders, and non-string values", () => {
    expect(isKinescopeVideoId("0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isKinescopeVideoId("your-video-id")).toBe(false);
    expect(isKinescopeVideoId(42)).toBe(false);
    expect(isKinescopeVideoId(null)).toBe(false);
  });
});
