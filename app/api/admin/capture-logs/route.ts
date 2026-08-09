import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSecurityMembers } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const isAdmin = !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const members = await getSecurityMembers();
  const logs = members.flatMap((member) =>
    member.attempts.map((attempt) => ({
      ...attempt,
      discordId: member.discordId,
      discordUsername: member.discordUsername,
    }))
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return NextResponse.json({ logs, members });
}
