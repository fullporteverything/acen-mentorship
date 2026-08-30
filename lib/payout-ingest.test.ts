import { describe, expect, it } from "vitest";

import {
  decideFromReactions,
  decideFromReply,
  decideIngest,
  looksBlind,
  reviewerIds,
  type IngestedMessage,
} from "./payout-ingest";

const msg = (over: Partial<IngestedMessage> = {}): IngestedMessage => ({
  id: "1",
  content: "",
  author: { id: "student", username: "student" },
  timestamp: new Date().toISOString(),
  attachments: [],
  ...over,
});

describe("what happens to a message from the payouts channel", () => {
  it("auto-approves a confident payout so nobody has to do anything", () => {
    const d = decideIngest(msg({ content: "just got my payout $2,500" }));
    expect(d.status).toBe("approved");
    expect(d.amountCents).toBe(250_000);
  });

  it("queues an unclear amount for a human, carrying the number along", () => {
    // The reviewer should only have to press ✅ — not go and read the message
    // to find out what number they are agreeing to.
    const d = decideIngest(msg({ content: "$2,500 🔥🔥" }));
    expect(d.status).toBe("pending");
    expect(d.amountCents).toBe(250_000);
  });

  it("queues a screenshot with no readable amount, with no number", () => {
    const d = decideIngest(
      msg({ content: "look at this 👀", attachments: [{ id: "a", url: "u" }] })
    );
    expect(d.status).toBe("pending");
    expect(d.amountCents).toBeNull();
  });

  it("ignores ordinary chatter instead of queueing it", () => {
    // A review queue full of "gm" is a review queue nobody opens, which means
    // the real payouts sitting in it never get counted either.
    expect(decideIngest(msg({ content: "gm everyone" })).status).toBe("ignored");
    expect(decideIngest(msg({ content: "I lost $300 today" })).status).toBe("ignored");
  });

  it("ignores its own posts", () => {
    // The bot posts into these channels. Reading its own review posts back in
    // would loop, and each loop would add the same figure again.
    const d = decideIngest(
      msg({ content: "payout $5,000", author: { id: "bot", username: "suite7", bot: true } })
    );
    expect(d.status).toBe("ignored");
  });
});

describe("a reviewer replying to the bot", () => {
  it("counts the amount they type, overriding whatever was parsed", () => {
    expect(decideFromReply("$2,500", null)).toEqual({ status: "approved", amountCents: 250_000 });
    expect(decideFromReply("actually it was 1.5k", 250_000)).toEqual({
      status: "approved",
      amountCents: 150_000,
    });
  });

  it("takes a bare yes only when there is already a number to say yes to", () => {
    expect(decideFromReply("yes", 250_000)).toEqual({ status: "approved", amountCents: 250_000 });
    // Approving nothing would close the row at zero and lose the payout.
    expect(decideFromReply("yes", null)).toBeNull();
  });

  it("takes a no", () => {
    expect(decideFromReply("no", 250_000)?.status).toBe("rejected");
    expect(decideFromReply("❌", null)?.status).toBe("rejected");
  });

  it("ignores chatter in the review channel", () => {
    expect(decideFromReply("lol", 250_000)).toBeNull();
    expect(decideFromReply("   ", 250_000)).toBeNull();
  });
});

describe("reactions on a review post", () => {
  const reviewers = new Set(["admin"]);

  it("approves on a reviewer's ✅", () => {
    expect(
      decideFromReactions({ approvers: ["admin"], rejecters: [], reviewers, knownAmountCents: 1000 })
    ).toEqual({ status: "approved", decidedBy: "admin" });
  });

  it("ignores a reaction from anyone who is not a reviewer", () => {
    // The review channel should be staff-only, but a permissions slip in
    // Discord must not be able to move a public figure.
    expect(
      decideFromReactions({
        approvers: ["random-student"],
        rejecters: [],
        reviewers,
        knownAmountCents: 1000,
      })
    ).toBeNull();
  });

  it("lets ❌ beat ✅ when both were pressed", () => {
    expect(
      decideFromReactions({
        approvers: ["admin"],
        rejecters: ["admin"],
        reviewers,
        knownAmountCents: 1000,
      })
    ).toEqual({ status: "rejected", decidedBy: "admin" });
  });

  it("does not approve a row that still has no amount", () => {
    expect(
      decideFromReactions({ approvers: ["admin"], rejecters: [], reviewers, knownAmountCents: null })
    ).toBeNull();
  });
});

describe("who may approve", () => {
  it("fails closed when nothing is configured", () => {
    expect(reviewerIds({}).size).toBe(0);
  });

  it("accepts the admin and an explicit list", () => {
    const ids = reviewerIds({
      ADMIN_DISCORD_ID: "admin",
      PAYOUT_REVIEWER_IDS: "a, b ,",
    });
    expect([...ids].sort()).toEqual(["a", "admin", "b"]);
  });
});

describe("noticing that Discord is handing us blank messages", () => {
  const blank = { content: "", attachments: [] };

  it("spots a channel read with the Message Content intent off", () => {
    // The failure this exists to catch: every message parses as empty, the
    // scan reports success having recorded nothing, and marks the backfill
    // complete — so the counter sits at $0 and never tries again.
    expect(looksBlind([blank, blank, blank, blank, blank])).toBe(true);
  });

  it("does not cry wolf over a genuinely quiet channel", () => {
    expect(looksBlind([blank, blank])).toBe(false);
    expect(looksBlind([])).toBe(false);
    expect(
      looksBlind([blank, blank, { content: "gm", attachments: [] }])
    ).toBe(false);
    // Attachments present means content is flowing, even with no text.
    expect(
      looksBlind([blank, blank, { content: "", attachments: [{ id: "a" }] }])
    ).toBe(false);
  });
});
