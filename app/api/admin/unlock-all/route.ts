import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearLocks } from "@/lib/security-store";

export const dynamic = "force-dynamic";

/** Releases the server-side screen-lock flag. Admin-only. */
export async function POST() {
  const session = await auth();
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;

  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  clearLocks();
  return NextResponse.json({ ok: true }, { status: 200 });
}
