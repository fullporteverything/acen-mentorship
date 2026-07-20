import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  getAnnouncements,
  saveAnnouncements,
  type Announcement,
} from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/** GET: anyone signed in can read announcements. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const announcements = await getAnnouncements();
  return NextResponse.json({ announcements });
}

/** POST: add an announcement. Admin-only. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { title?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const text = (body.body || "").trim();
  if (!title || !text) {
    return NextResponse.json(
      { error: "Title and body are required" },
      { status: 400 }
    );
  }
  if (title.length > 200) {
    return NextResponse.json(
      { error: "Title must be 200 characters or fewer" },
      { status: 400 }
    );
  }
  if (text.length > 10000) {
    return NextResponse.json(
      { error: "Body must be 10000 characters or fewer" },
      { status: 400 }
    );
  }

  const announcement: Announcement = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    body: text,
    createdAt: new Date().toISOString(),
  };

  const announcements = await getAnnouncements();
  // Newest first.
  announcements.unshift(announcement);
  await saveAnnouncements(announcements);

  return NextResponse.json({ ok: true, announcement });
}

/** DELETE: remove an announcement by id. Admin-only. */
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const announcements = await getAnnouncements();
  const filtered = announcements.filter((a) => a.id !== body.id);
  await saveAnnouncements(filtered);

  return NextResponse.json({ ok: true });
}
