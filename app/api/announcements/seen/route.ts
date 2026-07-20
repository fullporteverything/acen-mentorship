import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { markAnnouncementSeen } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/announcements/seen
 * Body: { id: string }
 * Records that the current user has seen this announcement.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const uid = session.user.discordId || session.user.id || "unknown";

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
