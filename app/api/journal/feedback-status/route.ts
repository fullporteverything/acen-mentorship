import { NextResponse } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import { getJournal } from "@/lib/journal-store";

export const dynamic = "force-dynamic";

/**
 * Latest mentor-feedback timestamp across the signed-in member's own journal.
 * The nav badge compares it to a locally-stored "last seen" to show a dot.
 */
export async function GET() {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;
  const uid = member.discordId;

  const entries = await getJournal(uid);
  let latest: string | null = null;
  for (const e of entries) {
    if (e.feedbackAt && (!latest || e.feedbackAt > latest)) latest = e.feedbackAt;
  }
  return NextResponse.json({ latestFeedbackAt: latest });
}
