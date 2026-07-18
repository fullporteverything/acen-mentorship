import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCaptureLogs } from "@/lib/security-store";

export const dynamic = "force-dynamic";

/** Returns the screen-capture attempt log. Admin-only. */
export async function GET() {
  const session = await auth();
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;

  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ logs: getCaptureLogs() });
}
