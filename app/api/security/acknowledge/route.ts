import { NextResponse } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import { acknowledgeStrike } from "@/lib/security-store";
import { allowMutation } from "@/lib/mutation-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const denied = await allowMutation(identity, "security.acknowledge", request);
  if (denied) return denied;
  const discordId = identity.discordId;
  const member = await acknowledgeStrike(discordId);
  return NextResponse.json({ ok: true, acknowledgedStrikes: member.acknowledgedStrikes });
}
