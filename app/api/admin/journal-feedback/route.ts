import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAllJournals, setEntryFeedback } from "@/lib/journal-store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/** GET: every member's journal entries, flattened newest-first. Admin-only. */
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const entries = await getAllJournals();
  return NextResponse.json({ entries });
}

/** POST: set the mentor feedback on one specific entry. Admin-only. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { discordId?: string; entryId?: string; feedback?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const discordId = (body.discordId || "").trim();
  const entryId = (body.entryId || "").trim();
  const feedback = typeof body.feedback === "string" ? body.feedback : "";

  if (!discordId || !entryId) {
    return NextResponse.json(
      { error: "discordId and entryId are required" },
      { status: 400 }
    );
  }

  const ok = await setEntryFeedback(discordId, entryId, feedback);
  if (!ok) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
