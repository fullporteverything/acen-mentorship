/**
 * Typed browser-side client for the server-held play-chip bankroll.
 *
 * No React, no DOM assumptions beyond `fetch` — wiring components/TableGame.tsx
 * to the server should be a two-line change. This module is also the single
 * source of truth for the wire types and the betting limits, so the API routes
 * validate against exactly what the client is allowed to send.
 *
 * PLAY CHIPS ONLY: cosmetic bragging rights earned from course progress. There
 * is no purchase endpoint and no cash-out, by design.
 */

import type { Card, Outcome } from "@/lib/blackjack";

/** Chip denominations a bet can be built from (mirrors the table's rail). */
export const CHIP_DENOMS = [25, 100, 500] as const;
/** Smallest legal bet, and the increment every legal bet is a multiple of. */
export const MIN_BET = 25;
export const BET_INCREMENT = 25;
/** House ceiling on a single hand — a sanity bound, not a bankroll rule. */
export const MAX_BET = 100_000;
/** No legitimate blackjack hand runs longer than this; anything more is junk. */
export const MAX_HAND_CARDS = 12;

export interface ChipStats {
  handsPlayed: number;
  handsWon: number;
  handsPushed: number;
  blackjacks: number;
  biggestWin: number;
  totalWagered: number;
}

/** A grant that was just paid out, for the "you earned chips" toast. */
export interface NewGrant {
  grantKey: string;
  amount: number;
  label: string;
}

export interface ChipStateResponse {
  balance: number;
  stats: ChipStats;
  rank: number;
  /** Grants claimed by THIS read — empty on every subsequent read. */
  newGrants: NewGrant[];
}

export interface SettleRequest {
  /** The base stake. With `doubled`, the server risks twice this. */
  bet: number;
  playerHand: Card[];
  dealerHand: Card[];
  doubled?: boolean;
}

export interface SettleResponse {
  balance: number;
  stats: ChipStats;
  /** The SERVER's settlement — authoritative, never echoed from the client. */
  delta: number;
  outcome: Outcome;
  wagered: number;
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  balance: number;
  handsWon: number;
  isViewer: boolean;
}

export interface LeaderboardResponse {
  entries: LeaderboardRow[];
  /** The caller's own standing, even when they're outside the top rows. */
  viewer: LeaderboardRow | null;
}

/** Thrown for any non-2xx response, carrying the route's error copy. */
export class TableChipsError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "TableChipsError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new TableChipsError(
      response.status,
      payload?.error ?? "The table is unavailable right now."
    );
  }
  return payload;
}

/**
 * Read the bankroll. This also CLAIMS any chips the member has earned since
 * last time, so `newGrants` is what to toast.
 */
export function fetchChipState(): Promise<ChipStateResponse> {
  return request<ChipStateResponse>("/api/table/chips", { cache: "no-store" });
}

/**
 * Submit a finished hand. The server re-runs the rules on the submitted cards
 * and applies ITS OWN delta — the client cannot name its own payout.
 */
export function postSettle(input: SettleRequest): Promise<SettleResponse> {
  return request<SettleResponse>("/api/table/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchLeaderboard(): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>("/api/table/leaderboard", { cache: "no-store" });
}
