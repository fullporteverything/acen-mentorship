import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resetSecurityMember } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const isAdmin = !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
  if (!discordId || discordId.length > 100) {
    return NextResponse.json({ error: "A member is required." }, { status: 400 });
  }
  const member = await resetSecurityMember(discordId);
  return NextResponse.json({ ok: true, member });
}
