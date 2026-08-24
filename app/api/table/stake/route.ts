import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { stakeIfBroke } from "@/lib/table-chips-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/table/stake
 * "The House stakes you." — resets a BROKE bankroll to the stake amount.
 *
 * Server-authoritative: the grant only happens when the member's real
 * balance is below the table minimum (enforced in SQL, race-safe), so it
 * cannot be used to top up a healthy stack. Rate-limited generously — a
 * genuine broke player hits this at most once per bust-out.
 */
export async function POST(req: Request) {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;
  const denied = await allowMutation(member, "table.stake", req, undefined, {
    limit: 30,
    windowMs: 3_600_000,
  });
  if (denied) return denied;

  const { state, staked } = await stakeIfBroke(member.discordId, member.name);
  return NextResponse.json({ balance: state.balance, stats: state.stats, staked });
}
