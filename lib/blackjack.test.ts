import { describe, expect, it } from "vitest";
import {
  buildShoe,
  dealerShouldHit,
  handValue,
  isBlackjack,
  isBust,
  settle,
  shuffle,
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

describe("buildShoe / shuffle", () => {
  it("builds a 6-deck shoe of 312 cards with 24 of each rank", () => {
    const shoe = buildShoe();
    expect(shoe).toHaveLength(312);
    expect(shoe.filter((c) => c.rank === "A")).toHaveLength(24);
    expect(shoe.filter((c) => c.suit === "♦")).toHaveLength(78);
  });

  it("shuffle keeps the multiset, does not mutate input, and honors the injected rng", () => {
    const shoe = buildShoe(1);
    const before = JSON.stringify(shoe);
    // rng() === 0 → every j is 0: a deterministic (rotated) permutation.
    const shuffled = shuffle(shoe, () => 0);
    expect(JSON.stringify(shoe)).toBe(before);
    expect(shuffled).toHaveLength(52);
    const key = (c: Card) => `${c.rank}${c.suit}`;
    expect(shuffled.map(key).sort()).toEqual(shoe.map(key).sort());
    // Deterministic given the constant rng.
    expect(shuffle(shoe, () => 0)).toEqual(shuffled);
  });
});

describe("handValue — soft/hard aces", () => {
  it("counts a lone ace as 11 (soft)", () => {
    expect(handValue(h("A", "6"))).toEqual({ total: 17, soft: true });
  });

  it("drops the ace to 1 when 11 would bust (hard)", () => {
    expect(handValue(h("A", "6", "9"))).toEqual({ total: 16, soft: false });
  });

  it("handles multiple aces: only one stays 11", () => {
    expect(handValue(h("A", "A"))).toEqual({ total: 12, soft: true });
    expect(handValue(h("A", "A", "9"))).toEqual({ total: 21, soft: true });
    expect(handValue(h("A", "A", "A", "8"))).toEqual({ total: 21, soft: true });
    expect(handValue(h("A", "A", "10", "9"))).toEqual({ total: 21, soft: false });
  });

  it("face cards and tens are 10", () => {
    expect(handValue(h("K", "Q")).total).toBe(20);
    expect(handValue(h("10", "J", "2")).total).toBe(22);
    expect(isBust(h("10", "J", "2"))).toBe(true);
  });
});

describe("blackjack detection", () => {
  it("two-card 21 is a natural; three-card 21 is not", () => {
    expect(isBlackjack(h("A", "K"))).toBe(true);
    expect(isBlackjack(h("7", "5", "9"))).toBe(false);
    expect(isBlackjack(h("A", "5", "5"))).toBe(false);
  });
});

describe("dealerShouldHit — hits to 17, stands on all 17s", () => {
  it("hits 16 and below", () => {
    expect(dealerShouldHit(h("10", "6"))).toBe(true);
    expect(dealerShouldHit(h("2", "3"))).toBe(true);
  });

  it("stands on hard 17 and above", () => {
    expect(dealerShouldHit(h("10", "7"))).toBe(false);
    expect(dealerShouldHit(h("10", "K"))).toBe(false);
  });

  it("stands on soft 17 (A+6)", () => {
    expect(dealerShouldHit(h("A", "6"))).toBe(false);
  });

  it("hits soft 16 (A+5) and a hard 16 made from a demoted ace", () => {
    expect(dealerShouldHit(h("A", "5"))).toBe(true);
    expect(dealerShouldHit(h("A", "6", "9"))).toBe(true); // hard 16
  });
});

describe("settle", () => {
  it("natural blackjack pays 3:2", () => {
    expect(settle(100, h("A", "K"), h("10", "9"))).toEqual({
      delta: 150,
      outcome: "blackjack",
    });
  });

  it("player natural vs dealer natural is a push", () => {
    expect(settle(100, h("A", "K"), h("A", "Q"))).toEqual({
      delta: 0,
      outcome: "push",
    });
  });

  it("dealer natural beats a non-natural 21", () => {
    expect(settle(100, h("7", "7", "7"), h("A", "J"))).toEqual({
      delta: -100,
      outcome: "lose",
    });
  });

  it("three-card 21 is NOT paid 3:2", () => {
    expect(settle(100, h("7", "7", "7"), h("10", "8"))).toEqual({
      delta: 100,
      outcome: "win",
    });
  });

  it("regular win pays 1:1, loss costs the bet, tie pushes", () => {
    expect(settle(25, h("10", "9"), h("10", "8"))).toEqual({ delta: 25, outcome: "win" });
    expect(settle(25, h("10", "8"), h("10", "9"))).toEqual({ delta: -25, outcome: "lose" });
    expect(settle(25, h("10", "9"), h("K", "9"))).toEqual({ delta: 0, outcome: "push" });
  });

  it("player bust loses even when the dealer also busts", () => {
    expect(settle(100, h("10", "6", "8"), h("10", "6", "K"))).toEqual({
      delta: -100,
      outcome: "lose",
    });
  });

  it("dealer bust pays the player", () => {
    expect(settle(100, h("10", "2"), h("10", "6", "K"))).toEqual({
      delta: 100,
      outcome: "win",
    });
  });

  it("double resolution: pass the doubled stake, delta doubles both ways", () => {
    // 100 doubled to 200 — one card drawn, then dealer plays out.
    expect(settle(200, h("5", "6", "10"), h("10", "9"))).toEqual({
      delta: 200,
      outcome: "win",
    });
    expect(settle(200, h("5", "6", "5"), h("10", "9"))).toEqual({
      delta: -200,
      outcome: "lose",
    });
    expect(settle(200, h("5", "6", "8"), h("10", "9"))).toEqual({
      delta: 0,
      outcome: "push",
    });
  });

  it("a doubled 21 (three cards) still pays 1:1, not 3:2", () => {
    expect(settle(200, h("5", "6", "10"), h("10", "10"))).toEqual({
      delta: 200,
      outcome: "win",
    });
  });
});
