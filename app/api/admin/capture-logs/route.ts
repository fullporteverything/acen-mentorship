import { NextResponse } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { getSecurityMembers } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;

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
