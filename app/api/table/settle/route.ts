import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { RANKS, SUITS, settle, type Card } from "@/lib/blackjack";
import { applyHandResult, getChipState } from "@/lib/table-chips-store";
import {
  BET_INCREMENT,
  MAX_BET,
  MAX_HAND_CARDS,
  MIN_BET,
  type SettleResponse,
} from "@/lib/table-chips-client";

export const dynamic = "force-dynamic";

/**
 * POST /api/table/settle
 * Body: { bet, playerHand, dealerHand, doubled? }
 *
 * SERVER-AUTHORITATIVE SETTLEMENT. The client sends the cards it finished the
 * hand with; the server re-runs `settle()` from lib/blackjack on those cards
 * and applies ITS OWN delta. A client-supplied payout is never read — there is
 * no `delta` field in the request at all.
 *
 * HONEST LIMIT OF THIS DESIGN: this prevents fabricated PAYOUTS, not
 * fabricated CARDS. A determined player can still POST a hand they were never
 * dealt (a pair of aces against a dealer 20) and be paid correctly for it,
 * because the shoe lives in the browser. Making that impossible needs a fully
 * authoritative dealer — the server holds the shoe, deals, and the client only
 * sends hit/stand/double intents. That's the v2 if the leaderboard ever gets
 * gamed. It is deliberately not v1: these are cosmetic play chips with no
 * purchase and no cash-out, so the payoff for cheating is bragging rights.
 *
 * Everything the request CAN control is bounded: the bet must be a positive
 * integer built from the table's chip denominations, within the house limits,
 * and covered by the member's real server-held balance; the hands must be
 * well-formed Card objects of a sane size. Anything else is a 400.
 */

const RANK_SET = new Set<string>(RANKS);
const SUIT_SET = new Set<string>(SUITS);

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") return false;
  const card = value as { rank?: unknown; suit?: unknown };
  return (
    typeof card.rank === "string" &&
    RANK_SET.has(card.rank) &&
    typeof card.suit === "string" &&
    SUIT_SET.has(card.suit)
  );
}

/** A hand is 2..MAX_HAND_CARDS well-formed cards and nothing else. */
function parseHand(value: unknown): Card[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 2 || value.length > MAX_HAND_CARDS) return null;
  if (!value.every(isCard)) return null;
  return value.map((card) => ({ rank: card.rank, suit: card.suit }));
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(req: Request) {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;
  // A fast player plays a LOT of hands, so the throttle is generous — but it
  // is still a ceiling on how quickly the leaderboard can be climbed. Applied
  // through allowMutation (which also enforces same-origin and audits) so
  // there is exactly one bucket for the action.
  const denied = await allowMutation(member, "table.settle", req, undefined, {
    limit: 400,
    windowMs: 3_600_000,
  });
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("bad body");
  }
  const record = (body ?? {}) as {
    bet?: unknown;
    playerHand?: unknown;
    dealerHand?: unknown;
    doubled?: unknown;
  };

  const bet = record.bet;
  if (
    typeof bet !== "number" ||
    !Number.isInteger(bet) ||
    bet < MIN_BET ||
    bet > MAX_BET ||
    bet % BET_INCREMENT !== 0
  ) {
    return badRequest("Invalid bet");
  }
  if (record.doubled !== undefined && typeof record.doubled !== "boolean") {
    return badRequest("Invalid bet");
  }

  const playerHand = parseHand(record.playerHand);
  const dealerHand = parseHand(record.dealerHand);
  if (!playerHand || !dealerHand) return badRequest("Invalid hand");

  // A double is only legal off the first two cards, so the player can hold at
  // most three when the stake is doubled.
  const doubled = record.doubled === true;
  if (doubled && playerHand.length > 3) return badRequest("Invalid hand");

  // Total chips at risk. This — not the base bet — is what must be covered.
  const wagered = doubled ? bet * 2 : bet;
  if (wagered > MAX_BET) return badRequest("Invalid bet");

  const current = await getChipState(member.discordId, member.name);
  if (wagered > current.balance) return badRequest("Bet exceeds your chip balance");

  // The one line that decides the money: the server's own rules, on the
  // server's own stake. Naturals pay 3:2, so an odd stake can settle on a half
  // chip — the ledger is integer, and rounding goes to the player.
  const settlement = settle(wagered, playerHand, dealerHand);
  const delta = Math.round(settlement.delta);

  const next = await applyHandResult(
    member.discordId,
    { delta, wagered, outcome: settlement.outcome },
    member.name
  );

  const payload: SettleResponse = {
    balance: next.balance,
    stats: next.stats,
    delta,
    outcome: settlement.outcome,
    wagered,
  };
  return NextResponse.json(payload);
}
