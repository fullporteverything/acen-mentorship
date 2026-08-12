import { NextResponse } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import {
  getAnnouncements,
  getSeenNotifications,
  getViewerProgress,
  markNotificationsSeen,
} from "@/lib/lesson-store";
import { getJournal } from "@/lib/journal-store";
import { getSecurityMembers } from "@/lib/security-store";

export const dynamic = "force-dynamic";

interface NotificationItem {
  id: string;
  type: "announcement" | "homework" | "journal" | "security";
  title: string;
  body: string;
  createdAt: string;
}

export async function GET() {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const { discordId } = identity;
  const [announcements, progress, journal, securityMembers, seen] =
    await Promise.all([
      getAnnouncements(),
      getViewerProgress(discordId),
      getJournal(discordId),
      getSecurityMembers(),
      getSeenNotifications(discordId),
    ]);
  const items: NotificationItem[] = announcements.map((announcement) => ({
    id: `announcement:${announcement.id}`,
    type: "announcement",
    title: announcement.title,
    body: announcement.body,
    createdAt: announcement.createdAt,
  }));
  for (const [lessonId, submission] of Object.entries(progress.submissions)) {
    if (submission.status === "pending") continue;
    items.push({
      id: `homework:${lessonId}:${submission.reviewedAt || submission.submittedAt}:${submission.status}`,
      type: "homework",
      title: `Homework ${submission.status}`,
      body: submission.feedback || `${lessonId} has been ${submission.status}.`,
      createdAt: submission.reviewedAt || submission.submittedAt,
    });
  }
  for (const entry of journal) {
    if (!entry.feedbackAt || !entry.feedback) continue;
    items.push({
      id: `journal:${entry.id}:${entry.feedbackAt}`,
      type: "journal",
      title: "New journal feedback",
      body: entry.feedback,
      createdAt: entry.feedbackAt,
    });
  }
  const security = securityMembers.find(
    (member) => member.discordId === discordId && member.strikes > 0
  );
  if (security) {
    items.push({
      id: `security:${security.strikes}:${security.updatedAt}`,
      type: "security",
      title: `Security strike ${security.strikes} of 3`,
      body: security.locked
        ? "Access is locked. Contact admin support to appeal."
        : "Screen sharing or recording was detected on this account.",
      createdAt: security.updatedAt,
    });
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seenSet = new Set(seen);
  return NextResponse.json({
    items: items.slice(0, 50).map((item) => ({
      ...item,
      unread: !seenSet.has(item.id),
    })),
  });
}

export async function POST(request: Request) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const { discordId } = identity;
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string").slice(0, 100)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No notifications supplied" }, { status: 400 });
  }
  await markNotificationsSeen(discordId, ids);
  return NextResponse.json({ ok: true });
}
