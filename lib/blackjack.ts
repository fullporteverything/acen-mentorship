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
 *   - Double on first two cards only. No splits yet (TODO in TableGame).
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
