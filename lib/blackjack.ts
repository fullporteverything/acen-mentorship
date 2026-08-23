/**
 * Pure blackjack rules for The Table (/dashboard/table).
 *
 * Zero DOM, zero React, zero side effects — everything here is deterministic
 * given its inputs (shuffle takes an injectable rng) so it can be unit-tested
 * in isolation. components/TableGame.tsx owns the state machine + rendering
 * and calls ONLY into this module for rules decisions.
 *
 * House rules (v1):
 *   - 6-deck shoe, reshuffled when fewer than 52 cards remain.
 *   - Dealer stands on all 17s (soft 17 included).
 *   - Natural blackjack pays 3:2; wins pay 1:1; push returns the bet.
 *   - Double on first two cards only.
 *   - Splits: same-RANK pairs only, up to 4 hands, 21 on a split hand pays 1:1,
 *     split aces get exactly one card each. See the SPLITS section below.
 *   - Insurance: offered on a dealer ace up card, costs half the bet, pays 2:1.
 */

export type Suit = "♠" | "♥" | "♦" | "♣";
export type CardRank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K";

export interface Card {
  rank: CardRank;
  suit: Suit;
}

export const SUITS: readonly Suit[] = ["♠", "♥", "♦", "♣"];
export const RANKS: readonly CardRank[] = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

export const SHOE_DECKS = 6;
/** Reshuffle the shoe between rounds once it drops below this many cards. */
export const RESHUFFLE_BELOW = 52;

/** Random source in [0, 1) — injectable so shuffles are testable. */
export type Rng = () => number;

/** One card's pip value with aces counted high (11). */
function pip(rank: CardRank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") return 10;
  return Number(rank);
}

/** Build an unshuffled shoe of `decks` standard 52-card decks. */
export function buildShoe(decks: number = SHOE_DECKS): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit });
      }
    }
  }
  return shoe;
}

/**
 * Fisher–Yates shuffle. Returns a NEW array; the input is not mutated.
 * Pass a seeded rng in tests for deterministic order.
 */
export function shuffle<T>(cards: readonly T[], rng: Rng = Math.random): T[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface HandValue {
  /** Best total ≤ 21 when possible (aces dropped from 11 to 1 as needed). */
  total: number;
  /** True when an ace is still counted as 11 in `total`. */
  soft: boolean;
}

/**
 * Hand total with proper soft-ace logic: every ace starts at 11, then aces
 * drop to 1 one at a time while the hand would otherwise bust.
 */
export function handValue(hand: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += pip(card.rank);
    if (card.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBust(hand: readonly Card[]): boolean {
  return handValue(hand).total > 21;
}

/** Natural blackjack: exactly two cards totalling 21. */
export function isBlackjack(hand: readonly Card[]): boolean {
  return hand.length === 2 && handValue(hand).total === 21;
}

/** Dealer hits below 17 and stands on ALL 17s, soft 17 included. */
export function dealerShouldHit(hand: readonly Card[]): boolean {
  return handValue(hand).total < 17;
}

export type Outcome = "blackjack" | "win" | "push" | "lose";

export interface Settlement {
  /** Bankroll change: +1.5×bet natural, +bet win, 0 push, −bet loss. */
  delta: number;
  outcome: Outcome;
}

/**
 * Settle a finished round. `bet` is the TOTAL amount wagered — after a
 * double, pass the doubled stake and the delta resolves at the doubled size.
 *
 * Order of resolution:
 *   1. Both naturals → push. Player natural alone → 3:2. Dealer natural → loss.
 *   2. Player bust loses outright (even if the dealer would also have busted).
 *   3. Dealer bust → player wins 1:1.
 *   4. Otherwise higher total wins; equal totals push.
 */
export function settle(
  bet: number,
  playerHand: readonly Card[],
  dealerHand: readonly Card[]
): Settlement {
  const playerBJ = isBlackjack(playerHand);
  const dealerBJ = isBlackjack(dealerHand);

  if (playerBJ && dealerBJ) return { delta: 0, outcome: "push" };
  if (playerBJ) return { delta: bet * 1.5, outcome: "blackjack" };
  if (dealerBJ) return { delta: -bet, outcome: "lose" };

  const player = handValue(playerHand).total;
  const dealer = handValue(dealerHand).total;

  if (player > 21) return { delta: -bet, outcome: "lose" };
  if (dealer > 21) return { delta: bet, outcome: "win" };
  if (player > dealer) return { delta: bet, outcome: "win" };
  if (player < dealer) return { delta: -bet, outcome: "lose" };
  return { delta: 0, outcome: "push" };
}

/* ------------------------------------------------------------------------ *
 * SPLITS
 *
 * All of this is additive: `settle()` above is untouched and still owns the
 * single-hand path used by app/api/table/settle/route.ts. Split-aware
 * settlement lives in `settleHand` / `settleHands` below.
 * ------------------------------------------------------------------------ */

/**
 * Ceiling on how many hands one seat may hold (the original plus three
 * resplits). House rule: 4.
 */
export const MAX_SPLIT_HANDS = 4;

export interface SplitOptions {
  /** How many hands the seat already holds, INCLUDING the one being split. */
  handsAlready?: number;
  /** Override the 4-hand cap. */
  maxHands?: number;
}

/**
 * Can this hand be split?
 *
 * HOUSE RULE — RANK MATCH, NOT VALUE MATCH: the two cards must share the exact
 * same rank. K+Q, K+10 and J+Q are each 20 but are NOT splittable here. This is
 * the stricter of the two common rules and it is the one this table plays; it
 * also keeps the predicate honest about what the player sees (two identical
 * card faces) instead of quietly splitting look-alike tens.
 *
 * A hand is splittable only when it is EXACTLY two cards — a hand that has
 * already been hit can never be split — and only while the seat is under the
 * resplit cap (`handsAlready < maxHands`, default 4 hands).
 *
 * Note this deliberately says nothing about split aces: a caller that split
 * aces must additionally consult `splitAcesLocked()`, which forbids the
 * resplit (and the hit, and the double) once the ace hand has its one card.
 */
export function canSplit(hand: readonly Card[], opts: SplitOptions = {}): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].rank !== hand[1].rank) return false;
  const maxHands = opts.maxHands ?? MAX_SPLIT_HANDS;
  const handsAlready = opts.handsAlready ?? 1;
  // Splitting turns `handsAlready` hands into `handsAlready + 1`, so the seat
  // must currently be strictly under the cap.
  return handsAlready < maxHands;
}

/**
 * Split a pair into its two new one-card hands, in order: `[first, second]`.
 *
 * THROWS a RangeError on a hand that is not a same-rank pair (rather than
 * returning null) — splitting is a deliberate player action the caller has
 * already gated behind `canSplit()`, so reaching here with junk is a bug in
 * the caller's state machine and should be loud, not silently absorbed.
 *
 * The resplit cap is NOT re-checked here; it is a seat-level rule and
 * `canSplit({ handsAlready })` owns it. Returned hands are fresh arrays;
 * the input is never mutated.
 */
export function splitHand(hand: readonly Card[]): [Card[], Card[]] {
  if (hand.length !== 2 || hand[0].rank !== hand[1].rank) {
    throw new RangeError("splitHand: hand is not a same-rank pair");
  }
  return [[{ ...hand[0] }], [{ ...hand[1] }]];
}

/**
 * HOUSE RULE — SPLIT ACES DRAW EXACTLY ONE CARD: a hand created by splitting
 * aces receives one card and is then locked — no hit, no double, no resplit,
 * even if that card makes another ace.
 *
 * This predicate is for hands that CAME FROM a split of aces (the caller
 * tracks that flag); it returns true once such a hand holds two or more cards.
 * Applied to a freshly dealt A+A it would also return true, which is why the
 * caller must only ask it about split hands.
 */
export function splitAcesLocked(hand: readonly Card[]): boolean {
  return hand.length >= 2 && hand[0]?.rank === "A";
}

export interface HandSettleOptions {
  /**
   * True when this hand came out of a split. A split hand can never be a
   * natural: 21 on two cards after a split pays 1:1 like any other win.
   */
  fromSplit?: boolean;
}

/**
 * Settle ONE hand, optionally as a split hand.
 *
 * With `fromSplit` falsy this is exactly `settle()` — same delegation, same
 * numbers — so there is one implementation of the normal path.
 *
 * With `fromSplit: true` the player-natural check is skipped entirely:
 *   - A+K on a split hand is a plain 21 → "win" at 1:1, never "blackjack".
 *   - A dealer natural still beats the split hand (it loses the bet); a split
 *     21 against a dealer natural does NOT push, because only a natural pushes
 *     a natural.
 *   - Otherwise: player bust loses, dealer bust wins, then high total wins and
 *     equal totals push.
 */
export function settleHand(
  bet: number,
  playerHand: readonly Card[],
  dealerHand: readonly Card[],
  opts: HandSettleOptions = {}
): Settlement {
  if (!opts.fromSplit) return settle(bet, playerHand, dealerHand);

  if (isBlackjack(dealerHand)) return { delta: -bet, outcome: "lose" };

  const player = handValue(playerHand).total;
  const dealer = handValue(dealerHand).total;

  if (player > 21) return { delta: -bet, outcome: "lose" };
  if (dealer > 21) return { delta: bet, outcome: "win" };
  if (player > dealer) return { delta: bet, outcome: "win" };
  if (player < dealer) return { delta: -bet, outcome: "lose" };
  return { delta: 0, outcome: "push" };
}

export interface HandsSettlement {
  /** One settlement per player hand, in the order the hands were passed. */
  hands: Settlement[];
  /** Sum of every hand's delta — the single number to apply to the bankroll. */
  delta: number;
}

export interface HandsSettleOptions {
  /**
   * Which hands came from a split. Pass a single boolean for all of them or a
   * per-hand array. DEFAULT: `playerHands.length > 1`, i.e. any multi-hand
   * round is treated as a split (that is the only way a seat gets more than
   * one hand at this table), while a lone hand settles exactly like `settle()`.
   * Pass `fromSplit: true` explicitly when settling a single split hand.
   */
  fromSplit?: boolean | readonly boolean[];
}

/**
 * Settle a whole seat: N hands with N bets against one dealer hand.
 *
 * `bets[i]` is the TOTAL wagered on `playerHands[i]` — a hand that was doubled
 * after the split passes its doubled stake, exactly like `settle()`.
 *
 * THROWS a RangeError when `bets` and `playerHands` are different lengths,
 * because a mismatched pairing silently pays the wrong hand.
 */
export function settleHands(
  bets: readonly number[],
  playerHands: readonly (readonly Card[])[],
  dealerHand: readonly Card[],
  opts: HandsSettleOptions = {}
): HandsSettlement {
  if (bets.length !== playerHands.length) {
    throw new RangeError("settleHands: bets and playerHands length mismatch");
  }
  const fallback = playerHands.length > 1;
  const flags = opts.fromSplit;
  const hands = playerHands.map((hand, i) => {
    const fromSplit = Array.isArray(flags)
      ? flags[i] === true
      : typeof flags === "boolean"
        ? flags
        : fallback;
    return settleHand(bets[i], hand, dealerHand, { fromSplit });
  });
  return { hands, delta: hands.reduce((sum, s) => sum + s.delta, 0) };
}

/* ------------------------------------------------------------------------ *
 * INSURANCE
 * ------------------------------------------------------------------------ */

/** Insurance pays 2:1 when the dealer turns over a natural. */
export const INSURANCE_PAYOUT = 2;

/**
 * Insurance is offered when the dealer's UP card (index 0 — the face-up card
 * this table deals first) is an ace, and only on the opening two-card dealer
 * hand, before any hole card is revealed or drawn.
 */
export function insuranceAvailable(dealerHand: readonly Card[]): boolean {
  return dealerHand.length === 2 && dealerHand[0].rank === "A";
}

/**
 * The side bet costs HALF the main bet.
 *
 * ROUNDING: this returns the exact half and may therefore be fractional on an
 * odd bet. The chip ledger is integer, so the house rule is to only OFFER
 * insurance on even bets (all table chip denominations are even multiples, so
 * in practice every legal bet halves cleanly). A caller that must handle an
 * odd stake should floor the cost — rounding the price DOWN is the direction
 * that favours the player, matching how the settlement route rounds payouts.
 */
export function insuranceCost(bet: number): number {
  return bet / 2;
}

export interface InsuranceSettlement {
  /** Bankroll change on the side bet: +2×stake on a dealer natural, else −stake. */
  delta: number;
  /** True when the dealer had a natural and insurance paid. */
  won: boolean;
}

/**
 * Settle the insurance side bet on its own, independent of the main hand.
 *
 * Pays 2:1 (delta = +2 × stake, on top of the returned stake the caller never
 * removed from the ledger) when the dealer holds a NATURAL — exactly two cards
 * totalling 21. A dealer 21 built from three or more cards is not a natural and
 * insurance loses, which is the whole point of the bet.
 */
export function settleInsurance(
  insuranceBet: number,
  dealerHand: readonly Card[]
): InsuranceSettlement {
  const won = isBlackjack(dealerHand);
  return {
    delta: won ? insuranceBet * INSURANCE_PAYOUT : -insuranceBet,
    won,
  };
}
