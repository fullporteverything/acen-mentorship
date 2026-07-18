import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAddedLessons, saveAddedLessons } from "@/lib/lesson-store";
import type { Lesson } from "@/lib/lessons-config";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/**
 * POST: append a new lesson to the admin-added list. Admin-only.
 * Body: { title, description, section, homeworkPrompt }
 * The `section` becomes the lesson's group — a new section name simply
 * creates a new group when the curriculum is grouped for display.
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    title?: string;
    description?: string;
    section?: string;
    homeworkPrompt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const section = (body.section || "").trim();
  if (!title || !section) {
    return NextResponse.json(
      { error: "Title and section are required" },
      { status: 400 }
    );
  }

  const lesson: Lesson = {
    id: `lesson_${Date.now()}`,
    title,
    description: (body.description || "").trim(),
    videoId: "YOUR_VIDEO_ID_HERE",
    homeworkPrompt:
      (body.homeworkPrompt || "").trim() || "Submit your homework for this lesson.",
    group: section,
  };

  const added = await getAddedLessons();
  added.push(lesson);
  await saveAddedLessons(added);

  return NextResponse.json({ ok: true, lesson });
}
