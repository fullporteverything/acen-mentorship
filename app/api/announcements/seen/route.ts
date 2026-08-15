import { NextResponse } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import { markAnnouncementSeen } from "@/lib/lesson-store";
import { allowMutation } from "@/lib/mutation-security";

export const dynamic = "force-dynamic";

/**
 * POST /api/announcements/seen
 * Body: { id: string }
 * Records that the current user has seen this announcement.
 */
export async function POST(req: Request) {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;
  const denied = await allowMutation(member, "announcements.seen", req);
  if (denied) return denied;
  const uid = member.discordId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  const id =
    body && typeof body === "object" && "id" in body
      ? String((body as { id: unknown }).id)
      : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  await markAnnouncementSeen(uid, id);
  return NextResponse.json({ ok: true });
}
