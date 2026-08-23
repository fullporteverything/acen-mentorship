import { describe, expect, it } from "vitest";
import {
  INSURANCE_PAYOUT,
  MAX_SPLIT_HANDS,
  canSplit,
  insuranceAvailable,
  insuranceCost,
  settle,
  settleHand,
  settleHands,
  settleInsurance,
  splitAcesLocked,
  splitHand,
  type Card,
  type CardRank,
  type Suit,
} from "./blackjack";

/** Terse hand builder: h("A♠", "6♥") — suit defaults to ♠. */
function h(...specs: string[]): Card[] {
  return specs.map((s) => {
    const suit = (["♠", "♥", "♦", "♣"] as Suit[]).find((x) => s.endsWith(x)) ?? "♠";
    const rank = (s.endsWith(suit) ? s.slice(0, -1) : s) as CardRank;
    return { rank, suit };
  });
}

describe("canSplit — same RANK only", () => {
  it("splits a true pair regardless of suit", () => {
    expect(canSplit(h("8♠", "8♥"))).toBe(true);
    expect(canSplit(h("A♦", "A♣"))).toBe(true);
    expect(canSplit(h("K♠", "K♠"))).toBe(true);
    expect(canSplit(h("2", "2"))).toBe(true);
  });

  it("house rule: same VALUE but different rank is NOT splittable", () => {
    expect(canSplit(h("K", "Q"))).toBe(false);
    expect(canSplit(h("10", "J"))).toBe(false);
    expect(canSplit(h("J♠", "Q♥"))).toBe(false);
  });

  it("rejects unequal ranks and non-two-card hands", () => {
    expect(canSplit(h("8", "9"))).toBe(false);
    expect(canSplit(h("8", "8", "8"))).toBe(false); // already hit
    expect(canSplit(h("8"))).toBe(false);
    expect(canSplit([])).toBe(false);
  });

  it("honours the resplit cap (default 4 hands)", () => {
    expect(MAX_SPLIT_HANDS).toBe(4);
    expect(canSplit(h("8", "8"), { handsAlready: 1 })).toBe(true);
    expect(canSplit(h("8", "8"), { handsAlready: 2 })).toBe(true);
    expect(canSplit(h("8", "8"), { handsAlready: 3 })).toBe(true);
    // 4 hands already out — splitting would make 5.
    expect(canSplit(h("8", "8"), { handsAlready: 4 })).toBe(false);
    expect(canSplit(h("8", "8"), { handsAlready: 5 })).toBe(false);
  });

  it("respects a custom maxHands (e.g. a no-resplit table)", () => {
    expect(canSplit(h("8", "8"), { handsAlready: 1, maxHands: 2 })).toBe(true);
    expect(canSplit(h("8", "8"), { handsAlready: 2, maxHands: 2 })).toBe(false);
    expect(canSplit(h("8", "8"), { handsAlready: 1, maxHands: 1 })).toBe(false);
  });
});

describe("splitHand", () => {
  it("returns the two one-card hands in order, preserving suits", () => {
    const pair = h("8♠", "8♥");
    expect(splitHand(pair)).toEqual([
      [{ rank: "8", suit: "♠" }],
      [{ rank: "8", suit: "♥" }],
    ]);
  });

  it("does not mutate or alias the input hand", () => {
    const pair = h("A♦", "A♣");
    const before = JSON.stringify(pair);
    const [a, b] = splitHand(pair);
    a.push(...h("9"));
    b.push(...h("7"));
    expect(JSON.stringify(pair)).toBe(before);
    expect(pair).toHaveLength(2);
  });

  it("throws on a hand that is not a same-rank pair", () => {
    expect(() => splitHand(h("K", "Q"))).toThrow(RangeError);
    expect(() => splitHand(h("8", "9"))).toThrow(/same-rank pair/);
    expect(() => splitHand(h("8", "8", "8"))).toThrow(RangeError);
    expect(() => splitHand(h("8"))).toThrow(RangeError);
  });
});

describe("splitAcesLocked — one card each, then done", () => {
  it("is unlocked while the split ace still holds only its ace", () => {
    expect(splitAcesLocked(h("A"))).toBe(false);
  });

  it("locks as soon as the one card lands", () => {
    expect(splitAcesLocked(h("A", "9"))).toBe(true);
    expect(splitAcesLocked(h("A", "K"))).toBe(true);
    // Even a second ace is locked: no resplit of split aces.
    expect(splitAcesLocked(h("A", "A"))).toBe(true);
  });

  it("is false for a split hand that did not start with an ace", () => {
    expect(splitAcesLocked(h("8", "3"))).toBe(false);
    expect(splitAcesLocked(h("8", "A"))).toBe(false);
    expect(splitAcesLocked([])).toBe(false);
  });
});

describe("settleHand — 21 after a split pays 1:1, not 3:2", () => {
  it("A+K on a split hand is a plain win", () => {
    expect(settleHand(100, h("A", "K"), h("10", "9"), { fromSplit: true })).toEqual({
      delta: 100,
      outcome: "win",
    });
  });

  it("the same cards NOT from a split are still a 3:2 natural", () => {
    expect(settleHand(100, h("A", "K"), h("10", "9"))).toEqual({
      delta: 150,
      outcome: "blackjack",
    });
    expect(settleHand(100, h("A", "K"), h("10", "9"), { fromSplit: false })).toEqual({
      delta: 150,
      outcome: "blackjack",
    });
  });

  it("a split 21 loses to a dealer natural (no natural-vs-natural push)", () => {
    expect(settleHand(100, h("A", "Q"), h("A", "J"), { fromSplit: true })).toEqual({
      delta: -100,
      outcome: "lose",
    });
  });

  it("a split 21 pushes a dealer three-card 21", () => {
    expect(settleHand(100, h("A", "K"), h("7", "7", "7"), { fromSplit: true })).toEqual({
      delta: 0,
      outcome: "push",
    });
  });

  it("ordinary split-hand results: bust, dealer bust, push, high total", () => {
    expect(settleHand(50, h("8", "9", "10"), h("10", "8"), { fromSplit: true })).toEqual({
      delta: -50,
      outcome: "lose",
    });
    expect(settleHand(50, h("8", "9"), h("10", "6", "K"), { fromSplit: true })).toEqual({
      delta: 50,
      outcome: "win",
    });
    expect(settleHand(50, h("10", "9"), h("K", "9"), { fromSplit: true })).toEqual({
      delta: 0,
      outcome: "push",
    });
    expect(settleHand(50, h("10", "9"), h("K", "8"), { fromSplit: true })).toEqual({
      delta: 50,
      outcome: "win",
    });
  });

  it("a split hand that was then doubled resolves at the doubled stake", () => {
    expect(settleHand(200, h("5", "6", "10"), h("10", "9"), { fromSplit: true })).toEqual({
      delta: 200,
      outcome: "win",
    });
  });

  it("without fromSplit it is byte-for-byte settle()", () => {
    const cases: [number, Card[], Card[]][] = [
      [100, h("A", "K"), h("10", "9")],
      [100, h("A", "K"), h("A", "Q")],
      [100, h("7", "7", "7"), h("A", "J")],
      [25, h("10", "9"), h("K", "9")],
      [100, h("10", "6", "8"), h("10", "6", "K")],
    ];
    for (const [bet, player, dealer] of cases) {
      expect(settleHand(bet, player, dealer)).toEqual(settle(bet, player, dealer));
    }
  });
});

describe("settleHands — multi-hand totals", () => {
  const dealer19 = h("10", "9");

  it("one hand wins, one loses → net zero at equal stakes", () => {
    const result = settleHands([100, 100], [h("10", "K"), h("10", "8")], dealer19);
    expect(result.hands).toEqual([
      { delta: 100, outcome: "win" },
      { delta: -100, outcome: "lose" },
    ]);
    expect(result.delta).toBe(0);
  });

  it("both hands win", () => {
    const result = settleHands([100, 50], [h("10", "K"), h("10", "10")], dealer19);
    expect(result.hands.map((s) => s.outcome)).toEqual(["win", "win"]);
    expect(result.delta).toBe(150);
  });

  it("both hands bust — dealer's own bust does not save them", () => {
    const result = settleHands(
      [100, 100],
      [h("10", "6", "9"), h("10", "7", "8")],
      h("10", "6", "K")
    );
    expect(result.hands.map((s) => s.outcome)).toEqual(["lose", "lose"]);
    expect(result.delta).toBe(-200);
  });

  it("win + push + loss sums correctly", () => {
    const result = settleHands(
      [100, 100, 40],
      [h("10", "K"), h("10", "9"), h("10", "7")],
      dealer19
    );
    expect(result.hands).toEqual([
      { delta: 100, outcome: "win" },
      { delta: 0, outcome: "push" },
      { delta: -40, outcome: "lose" },
    ]);
    expect(result.delta).toBe(60);
  });

  it("dealer bust pays every hand that did not bust", () => {
    const result = settleHands(
      [100, 100, 100],
      [h("10", "2"), h("6", "5"), h("10", "9", "5")],
      h("10", "6", "K")
    );
    expect(result.hands.map((s) => s.outcome)).toEqual(["win", "win", "lose"]);
    expect(result.delta).toBe(100);
  });

  it("multi-hand defaults to fromSplit: a split 21 pays 1:1", () => {
    const result = settleHands([100, 100], [h("A", "K"), h("A", "Q")], dealer19);
    expect(result.hands).toEqual([
      { delta: 100, outcome: "win" },
      { delta: 100, outcome: "win" },
    ]);
    expect(result.delta).toBe(200);
  });

  it("a lone hand defaults to the normal path (natural still pays 3:2)", () => {
    expect(settleHands([100], [h("A", "K")], dealer19)).toEqual({
      hands: [{ delta: 150, outcome: "blackjack" }],
      delta: 150,
    });
  });

  it("fromSplit: true forces the split rule on a single hand", () => {
    expect(settleHands([100], [h("A", "K")], dealer19, { fromSplit: true })).toEqual({
      hands: [{ delta: 100, outcome: "win" }],
      delta: 100,
    });
  });

  it("fromSplit accepts a per-hand array", () => {
    const result = settleHands(
      [100, 100],
      [h("A", "K"), h("A", "Q")],
      dealer19,
      { fromSplit: [false, true] }
    );
    expect(result.hands).toEqual([
      { delta: 150, outcome: "blackjack" },
      { delta: 100, outcome: "win" },
    ]);
    expect(result.delta).toBe(250);
  });

  it("a dealer natural beats every split hand", () => {
    const result = settleHands([100, 100], [h("A", "K"), h("10", "10")], h("A", "J"));
    expect(result.hands.map((s) => s.outcome)).toEqual(["lose", "lose"]);
    expect(result.delta).toBe(-200);
  });

  it("hands settle at their own stakes after a post-split double", () => {
    const result = settleHands([200, 100], [h("5", "6", "10"), h("10", "8")], dealer19);
    expect(result.delta).toBe(100); // +200 doubled win, −100 loss
  });

  it("an empty seat settles to nothing", () => {
    expect(settleHands([], [], dealer19)).toEqual({ hands: [], delta: 0 });
  });

  it("throws when bets and hands do not line up", () => {
    expect(() => settleHands([100], [h("10", "9"), h("10", "8")], dealer19)).toThrow(
      RangeError
    );
  });
});

describe("insuranceAvailable", () => {
  it("is offered on a dealer ace UP card (index 0)", () => {
    expect(insuranceAvailable(h("A♠", "K♥"))).toBe(true);
    expect(insuranceAvailable(h("A", "6"))).toBe(true);
  });

  it("is not offered when the ace is the hole card", () => {
    expect(insuranceAvailable(h("K", "A"))).toBe(false);
  });

  it("is not offered on a non-ace up card", () => {
    expect(insuranceAvailable(h("K", "K"))).toBe(false);
    expect(insuranceAvailable(h("10", "A"))).toBe(false);
  });

  it("is only offered on the opening two-card dealer hand", () => {
    expect(insuranceAvailable(h("A", "2", "5"))).toBe(false);
    expect(insuranceAvailable(h("A"))).toBe(false);
    expect(insuranceAvailable([])).toBe(false);
  });
});

describe("insuranceCost", () => {
  it("is half the bet", () => {
    expect(insuranceCost(100)).toBe(50);
    expect(insuranceCost(50)).toBe(25);
    expect(insuranceCost(0)).toBe(0);
  });

  it("returns the exact half on an odd bet (caller floors to stay integer)", () => {
    expect(insuranceCost(25)).toBe(12.5);
    expect(Math.floor(insuranceCost(25))).toBe(12);
  });
});

describe("settleInsurance — 2:1 on a dealer natural", () => {
  it("pays 2:1 when the dealer has a natural", () => {
    expect(INSURANCE_PAYOUT).toBe(2);
    expect(settleInsurance(50, h("A", "K"))).toEqual({ delta: 100, won: true });
    expect(settleInsurance(12, h("A", "10"))).toEqual({ delta: 24, won: true });
  });

  it("loses when the dealer makes 21 from THREE cards (not a natural)", () => {
    expect(settleInsurance(50, h("A", "5", "5"))).toEqual({ delta: -50, won: false });
    expect(settleInsurance(50, h("A", "A", "9"))).toEqual({ delta: -50, won: false });
  });

  it("loses on any ordinary dealer hand", () => {
    expect(settleInsurance(50, h("A", "9"))).toEqual({ delta: -50, won: false });
    expect(settleInsurance(50, h("A", "6", "K"))).toEqual({ delta: -50, won: false });
  });

  it("a dealer natural on a non-ace up card still pays (the check is the hand)", () => {
    // Insurance is not OFFERED here (insuranceAvailable is false), but if a
    // caller settles a stake anyway the rule is the same: natural pays 2:1.
    expect(insuranceAvailable(h("K", "A"))).toBe(false);
    expect(settleInsurance(50, h("K", "A"))).toEqual({ delta: 100, won: true });
  });

  it("insurance settles independently of the main hand", () => {
    // Classic: player 20 loses to the dealer natural, insurance makes it whole.
    const main = settle(100, h("10", "K"), h("A", "J"));
    const side = settleInsurance(insuranceCost(100), h("A", "J"));
    expect(main.delta).toBe(-100);
    expect(side.delta).toBe(100);
    expect(main.delta + side.delta).toBe(0);
  });
});

describe("regression — existing settle() behaviour is untouched", () => {
  it("a normal (non-split) natural still pays 3:2 through settle()", () => {
    expect(settle(100, h("A", "K"), h("10", "9"))).toEqual({
      delta: 150,
      outcome: "blackjack",
    });
    expect(settle(100, h("A", "K"), h("A", "Q"))).toEqual({ delta: 0, outcome: "push" });
    expect(settle(100, h("7", "7", "7"), h("10", "8"))).toEqual({
      delta: 100,
      outcome: "win",
    });
  });
});
