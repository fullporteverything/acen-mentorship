import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse, requireMemberOrResponse } from "@/lib/authz";
import {
  getAnnouncements,
  saveAnnouncements,
  type Announcement,
} from "@/lib/lesson-store";

export const dynamic = "force-dynamic";


/** GET: anyone signed in can read announcements. */
export async function GET() {
  const member = await requireMemberOrResponse(); if (member instanceof Response) return member;

  const announcements = await getAnnouncements();
  return NextResponse.json({ announcements });
}

/** POST: add an announcement. Admin-only. */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;

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
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;

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
