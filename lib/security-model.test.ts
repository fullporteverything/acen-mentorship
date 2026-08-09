import { describe, expect, it } from "vitest";
import { applyCaptureAttempt, normalizeSecurityMember } from "./security-model";

describe("security strike model", () => {
  it("increments strikes and permanently locks on the third attempt", () => {
    const base = normalizeSecurityMember(null, "123", "Trader");
    const one = applyCaptureAttempt(base, { timestamp: "2026-08-08T00:00:00.000Z" });
    const two = applyCaptureAttempt(one, { timestamp: "2026-08-08T00:01:00.000Z" });
    const three = applyCaptureAttempt(two, { timestamp: "2026-08-08T00:02:00.000Z" });
    expect([one.strikes, two.strikes, three.strikes]).toEqual([1, 2, 3]);
    expect(three.locked).toBe(true);
  });

  it("clamps malformed stored values and never unlocks a third-strike member", () => {
    const member = normalizeSecurityMember(
      { strikes: 99, locked: false, acknowledgedStrikes: 99 },
      "123",
      "Trader"
    );
    expect(member).toMatchObject({ strikes: 3, locked: true, acknowledgedStrikes: 3 });
    expect(applyCaptureAttempt(member, { timestamp: "now" }).strikes).toBe(3);
  });
});
