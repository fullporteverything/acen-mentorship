import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJournal } from "@/lib/journal-store";

export const dynamic = "force-dynamic";

/**
 * Latest mentor-feedback timestamp across the signed-in member's own journal.
 * The nav badge compares it to a locally-stored "last seen" to show a dot.
 */
export async function GET() {
  const session = await auth();
  const uid = session?.user?.discordId || session?.user?.id;
  if (!uid) return NextResponse.json({ latestFeedbackAt: null });

  const entries = await getJournal(uid);
  let latest: string | null = null;
  for (const e of entries) {
    if (e.feedbackAt && (!latest || e.feedbackAt > latest)) latest = e.feedbackAt;
  }
  return NextResponse.json({ latestFeedbackAt: latest });
}
