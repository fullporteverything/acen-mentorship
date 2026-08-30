import { describe, expect, it } from "vitest";

import { formatUsd, parsePayoutMessage } from "./payout-parse";

const cents = (msg: string, hasAttachment = false) => {
  const r = parsePayoutMessage(msg, { hasAttachment });
  return r.ok ? r.candidate.amountCents : null;
};
const review = (msg: string, hasAttachment = false) => {
  const r = parsePayoutMessage(msg, { hasAttachment });
  return r.ok ? false : r.needsReview;
};

describe("real payouts are counted", () => {
  it("reads the shapes people actually type", () => {
    expect(cents("just got my payout $2,500")).toBe(250_000);
    expect(cents("payout of $2500 cleared")).toBe(250_000);
    expect(cents("$1.2k payout landed today")).toBe(120_000);
    expect(cents("withdrew 1.5k from topstep")).toBe(150_000);
    expect(cents("first payout ever!! $500.50")).toBe(50_050);
    expect(cents("requested $10,000 today")).toBe(1_000_000);
  });

  it("takes the LARGEST amount so a breakdown is not double counted", () => {
    // "took 500 and 300, 800 total" must contribute 800, not 1,600.
    expect(cents("payout: $500 + $300 = $800 total")).toBe(80_000);
  });

  it("handles a payout word before or after the number", () => {
    expect(cents("$3,000 payout")).toBe(300_000);
    expect(cents("payout $3,000")).toBe(300_000);
  });
});

describe("the false positives — every one of these would inflate a public number", () => {
  it("does not count losses", () => {
    expect(cents("I lost $300 today")).toBeNull();
    expect(cents("down $1,200 this week")).toBeNull();
    expect(cents("blew a $50k account")).toBeNull();
    expect(cents("$2,000 drawdown, rough week")).toBeNull();
  });

  it("does not count goals or aspirations", () => {
    expect(cents("goal is $10k by december")).toBeNull();
    expect(cents("trying to hit $5,000 next month")).toBeNull();
    expect(cents("one day I want to withdraw $100k")).toBeNull();
  });

  it("does not count costs", () => {
    expect(cents("paid $150 eval fee")).toBeNull();
    expect(cents("$99 subscription cost")).toBeNull();
    expect(cents("bought a $300 reset")).toBeNull();
  });

  it("does not count somebody else's money", () => {
    // The one that quietly doubles a total: congratulation replies quoting
    // a number that has already been counted from the original post.
    expect(cents("congrats on the $2k bro")).toBeNull();
    expect(cents("he made $5k last week")).toBeNull();
    expect(cents("gz on your $1,500 payout")).toBeNull();
  });

  it("does not count questions or hypotheticals", () => {
    expect(cents("is $2500 a good first payout?")).toBeNull();
    expect(cents("if i hit $10k would that be good")).toBeNull();
    expect(cents("should i withdraw $500 or let it ride")).toBeNull();
  });

  it("does not read dates, times or quantities as money", () => {
    expect(cents("payout in 2025 hopefully")).toBeNull();
    expect(cents("took 5 trades today, payout soon")).toBeNull();
    expect(cents("payout after 30 days")).toBeNull();
  });
});

describe("the middle ground goes to a human, not into the total", () => {
  it("sends a bare amount with no payout word to review", () => {
    // Extremely common ("$2,500 🔥") and usually genuine — but "usually" is
    // not good enough for a figure the owner may have to defend.
    expect(cents("$2,500 🔥🔥")).toBeNull();
    expect(review("$2,500 🔥🔥")).toBe(true);
  });

  it("sends a screenshot with no readable amount to review", () => {
    expect(review("", true)).toBe(true);
    expect(review("look at this 👀", true)).toBe(true);
  });

  it("sends implausible amounts to review rather than counting them", () => {
    expect(cents("payout of $2,000,000 today")).toBeNull();
    expect(cents("payout $1")).toBeNull();
  });

  it("does NOT flag ordinary chatter for review", () => {
    // The queue is only useful if it stays short.
    expect(review("gm everyone")).toBe(false);
    expect(review("what pair are you watching")).toBe(false);
    expect(review("")).toBe(false);
  });
});

describe("never throws, never returns nonsense", () => {
  it("survives junk input", () => {
    for (const junk of ["", "   ", "$", "$$$", "$,", "$.", "k", "$0", "$-500", "💰".repeat(50)]) {
      expect(() => parsePayoutMessage(junk)).not.toThrow();
      const c = cents(junk);
      expect(c === null || c > 0).toBe(true);
    }
  });

  it("always returns whole cents, never a float", () => {
    const r = parsePayoutMessage("payout $1,234.56");
    expect(r.ok && Number.isInteger(r.candidate.amountCents)).toBe(true);
    expect(r.ok && r.candidate.amountCents).toBe(123_456);
  });
});

describe("formatting", () => {
  it("prints plain dollars for the admin panel", () => {
    expect(formatUsd(250_000)).toBe("$2,500");
    expect(formatUsd(1_234_567_00)).toBe("$1,234,567");
  });

  it("compacts for the Discord channel name, which has a length limit", () => {
    expect(formatUsd(342_150_00, { compact: true })).toBe("$342K");
    expect(formatUsd(1_500_000_00, { compact: true })).toBe("$1.5M");
    expect(formatUsd(2_500_00, { compact: true })).toBe("$2,500");
  });
});
