import { NextResponse } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import { acknowledgeStrike } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const discordId = identity.discordId;
  const member = await acknowledgeStrike(discordId);
  return NextResponse.json({ ok: true, acknowledgedStrikes: member.acknowledgedStrikes });
}
