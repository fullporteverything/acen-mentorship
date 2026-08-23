import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { getChipState, getRank, claimGrants } from "@/lib/table-chips-store";
import { grantsForMember } from "@/lib/table-earn";
import type { ChipStateResponse } from "@/lib/table-chips-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/table/chips
 * The member's play-chip bankroll, lifetime hand stats and leaderboard rank.
 *
 * Reading this also CLAIMS any chips the member has earned since last time
 * (completed lectures, journal days, today's stipend), so simply opening The
 * Table pays out what the work has already earned. `newGrants` reports only
 * what was granted by THIS request — the UNIQUE (member_id, grant_key) in
 * table_grants means a refresh a second later grants nothing and returns [].
 *
 * A failure in the earning path must never lock a member out of their chips:
 * the bankroll still returns, minus whatever couldn't be claimed this round
 * (the grant keys are unchanged, so the next read picks them up).
 */
export async function GET() {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;

  const state = await getChipState(member.discordId, member.name);

  let balance = state.balance;
  let stats = state.stats;
  let newGrants: ChipStateResponse["newGrants"] = [];
  try {
    const grants = await grantsForMember(member.discordId);
    const claimed = await claimGrants(member.discordId, grants, member.name);
    balance = claimed.state.balance;
    stats = claimed.state.stats;
    newGrants = claimed.granted.map((grant) => ({
      grantKey: grant.grantKey,
      amount: grant.amount,
      label: grant.label,
    }));
  } catch {
    newGrants = [];
  }

  const rank = await getRank(member.discordId).catch(() => 0);

  const payload: ChipStateResponse = { balance, stats, rank, newGrants };
  return NextResponse.json(payload);
}
