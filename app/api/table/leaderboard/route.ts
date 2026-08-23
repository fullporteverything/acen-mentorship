import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { getChipState, getLeaderboard, getRank } from "@/lib/table-chips-store";
import type { LeaderboardResponse, LeaderboardRow } from "@/lib/table-chips-client";

export const dynamic = "force-dynamic";

const TOP_N = 10;

/**
 * GET /api/table/leaderboard
 * The top {TOP_N} play-chip bankrolls plus the caller's own standing.
 *
 * Display names and chip counts only — no Discord ids reach the response, so
 * the board can never be used to enumerate accounts. Soft-deleted members are
 * excluded by the store.
 */
export async function GET() {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;

  const [entries, state, rank] = await Promise.all([
    getLeaderboard(TOP_N, member.discordId),
    getChipState(member.discordId, member.name),
    getRank(member.discordId),
  ]);

  // Only pin the caller's own row when they aren't already on the board.
  const onBoard = entries.some((entry) => entry.isViewer);
  const viewer: LeaderboardRow | null = onBoard
    ? null
    : {
        rank,
        displayName: member.name?.trim() || "You",
        balance: state.balance,
        handsWon: state.stats.handsWon,
        isViewer: true,
      };

  const payload: LeaderboardResponse = { entries, viewer };
  return NextResponse.json(payload);
}
