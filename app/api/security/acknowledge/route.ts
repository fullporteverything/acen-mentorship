import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { acknowledgeStrike } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await acknowledgeStrike(discordId);
  return NextResponse.json({ ok: true, acknowledgedStrikes: member.acknowledgedStrikes });
}
