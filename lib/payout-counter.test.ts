import { describe, expect, it } from "vitest";

import {
  RENAME_MIN_INTERVAL_MS,
  counterName,
  reviewPostContent,
  shouldRename,
} from "./payout-counter";

describe("the channel name", () => {
  it("compacts the total, because a sidebar truncates", () => {
    expect(counterName(342_150_00)).toBe("💰 Student Payouts: $342K");
    expect(counterName(2_500_00)).toBe("💰 Student Payouts: $2,500");
  });

  it("supports a custom template and an exact figure", () => {
    expect(counterName(342_150_00, "payouts-{exact}")).toBe("payouts-$342,150");
  });

  it("survives an empty ledger and junk input", () => {
    expect(counterName(0)).toBe("💰 Student Payouts: $0");
    expect(counterName(Number.NaN)).toBe("💰 Student Payouts: $0");
    expect(counterName(-5)).toBe("💰 Student Payouts: $0");
  });

  it("never exceeds Discord's 100 character limit", () => {
    expect(counterName(1000, "x".repeat(200)).length).toBe(100);
  });
});

describe("when to spend the one rename we get", () => {
  const now = Date.now();

  it("renames when the name has never been set", () => {
    expect(shouldRename({ desired: "a", current: null, lastRenamedAt: null, now })).toBe(true);
  });

  it("does NOT rename when nothing visible changed", () => {
    // Discord allows 2 renames per 10 minutes and silently ignores the excess.
    // Burning one on an identical name means the next real update is dropped.
    expect(shouldRename({ desired: "a", current: "a", lastRenamedAt: null, now })).toBe(false);
  });

  it("holds off until the rate-limit window has passed", () => {
    const justNow = new Date(now - 60_000);
    expect(shouldRename({ desired: "b", current: "a", lastRenamedAt: justNow, now })).toBe(false);

    const longEnough = new Date(now - RENAME_MIN_INTERVAL_MS - 1);
    expect(shouldRename({ desired: "b", current: "a", lastRenamedAt: longEnough, now })).toBe(true);
  });

  it("does not treat a clock skewed into the future as 'ages ago'", () => {
    const future = new Date(now + 60 * 60 * 1000);
    expect(shouldRename({ desired: "b", current: "a", lastRenamedAt: future, now })).toBe(false);
  });
});

describe("the review post", () => {
  const base = {
    authorName: "sam",
    reason: "read from screenshot: Payout approved $2,500.00",
    messageLink: "https://discord.com/channels/1/2/3",
  };

  it("asks a question when a human still has to decide", () => {
    const post = reviewPostContent({ ...base, amountCents: 250_000 });
    expect(post).toContain("needs a look");
    expect(post).toContain("✅ to count it");
  });

  it("asks for the number when there isn't one", () => {
    const post = reviewPostContent({ ...base, amountCents: null });
    expect(post).toContain("no amount readable");
    expect(post).toContain("Reply with the amount");
  });

  it("reports rather than asks when it already counted it — and offers a way back", () => {
    // A number that moves on a public channel with no record of why and no way
    // to take it back is worse than one nobody automated.
    const post = reviewPostContent({ ...base, amountCents: 250_000, autoCounted: true });
    expect(post).toContain("Counted automatically");
    expect(post).toContain("❌ to remove it");
  });
});
