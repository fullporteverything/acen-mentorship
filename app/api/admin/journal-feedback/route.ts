import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { getAllJournals, setEntryFeedback } from "@/lib/journal-store";
import { allowMutation } from "@/lib/mutation-security";

export const dynamic = "force-dynamic";


/** GET: every member's journal entries, flattened newest-first. Admin-only. */
export async function GET() {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const entries = await getAllJournals();
  return NextResponse.json({ entries });
}

/** POST: set the mentor feedback on one specific entry. Admin-only. */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.journal.feedback", req); if (denied) return denied;

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
