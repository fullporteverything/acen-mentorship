import { NextResponse } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { resetSecurityMember } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.unlock_all", request); if (denied) return denied;

  const body = await request.json().catch(() => null);
  const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
  if (!discordId || discordId.length > 100) {
    return NextResponse.json({ error: "A member is required." }, { status: 400 });
  }
  const member = await resetSecurityMember(discordId);
  return NextResponse.json({ ok: true, member });
}
