import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getSettings, saveSettings } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/** GET: current site settings. Admin-only. */
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getSettings());
}

/** POST: update site settings. Admin-only. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { autoApprove?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const settings = { autoApprove: Boolean(body.autoApprove) };
  await saveSettings(settings);

  return NextResponse.json({ ok: true, ...settings });
}
