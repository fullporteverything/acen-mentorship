import { describe, expect, it } from "vitest";

import {
  RENAME_MIN_INTERVAL_MS,
  counterName,
  decisionConfirmation,
  reviewPostContent,
  shouldRename,
} from "./payout-counter";

describe("the channel name", () => {
  it("compacts the total, because a sidebar truncates", () => {
    expect(counterName(342_150_00)).toBe("💰 $342K Paid Out");
    expect(counterName(2_500_00)).toBe("💰 $2,500 Paid Out");
  });

  it("puts the figure first so truncation eats the label, not the number", () => {
    // Discord clips a channel name to the sidebar width. With the label first,
    // "💰 Student Payouts: $12,750" renders as "💰 Student Pay…" — the number,
    // the only reason the channel exists, is exactly what gets cut.
    const name = counterName(1_275_000);
    expect(name.indexOf("$12,750")).toBeLessThan(name.indexOf("Paid"));
  });

  it("supports a custom template and an exact figure", () => {
    expect(counterName(342_150_00, "payouts-{exact}")).toBe("payouts-$342,150");
  });

  it("survives an empty ledger and junk input", () => {
    expect(counterName(0)).toBe("💰 $0 Paid Out");
    expect(counterName(Number.NaN)).toBe("💰 $0 Paid Out");
    expect(counterName(-5)).toBe("💰 $0 Paid Out");
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

describe("acknowledging a reviewer's decision", () => {
  it("names the figure AND the new total, not just 'ok'", () => {
    // What a reviewer is checking is not that the bot heard them — it is that
    // it took the RIGHT number rather than quietly keeping its own guess.
    const msg = decisionConfirmation({
      status: "approved",
      amountCents: 250_000,
      totalCents: 1_275_000,
    });
    expect(msg).toContain("$2,500");
    expect(msg).toContain("$12,750");
  });

  it("says so plainly when the payout was skipped", () => {
    const msg = decisionConfirmation({ status: "rejected", amountCents: null, totalCents: 1_275_000 });
    expect(msg).toContain("not counted");
    expect(msg).toContain("$12,750");
  });
})
