import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import {
  getAddedLessons,
  getAddedSections,
  saveAddedLessons,
  saveAddedSections,
} from "@/lib/lesson-store";
import type { Lesson } from "@/lib/lessons-config";
import { isKinescopeVideoId } from "@/lib/video-id";

export const dynamic = "force-dynamic";


/**
 * POST: append a new lesson to the admin-added list. Admin-only.
 * Body: { title, description, section, homeworkPrompt, videoId? }
 * The `section` becomes the lesson's group — a new section name simply
 * creates a new group when the curriculum is grouped for display.
 *
 * If `section` is provided but `title` is empty, an EMPTY SECTION is created
 * instead of a lesson: the section name is appended to the admin-added
 * sections list so it renders even before it holds any lesson.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;

  let body: {
    title?: string;
    description?: string;
    section?: string;
    homeworkPrompt?: string;
    videoId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const section = (body.section || "").trim();
  const description = (body.description || "").trim();
  const homeworkPrompt = (body.homeworkPrompt || "").trim();
  const videoId = (body.videoId || "").trim();
  if (!section) {
    return NextResponse.json(
      { error: "Section is required" },
      { status: 400 }
    );
  }
  if (section.length > 255) {
    return NextResponse.json(
      { error: "Section must be 255 characters or fewer" },
      { status: 400 }
    );
  }

  // No lesson title → create an empty section (dedupe against existing ones).
  if (!title) {
    const sections = await getAddedSections();
    if (!sections.includes(section)) {
      sections.push(section);
      await saveAddedSections(sections);
    }
    return NextResponse.json({ ok: true, section });
  }

  if (title.length > 255) {
    return NextResponse.json(
      { error: "Title must be 255 characters or fewer" },
      { status: 400 }
    );
  }
  if (description.length > 2000) {
    return NextResponse.json(
      { error: "Description must be 2000 characters or fewer" },
      { status: 400 }
    );
  }
  if (homeworkPrompt.length > 5000) {
    return NextResponse.json(
      { error: "Homework prompt must be 5000 characters or fewer" },
      { status: 400 }
    );
  }
  if (videoId && !isKinescopeVideoId(videoId)) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Kinescope video UUID. Paste the video ID shown after upload, or leave it empty to add the video later.",
      },
      { status: 400 }
    );
  }

  const lesson: Lesson = {
    id: `lesson_${Date.now()}`,
    title,
    description,
    // A blank ID keeps the lesson unavailable until a video is assigned.
    videoId,
    homeworkPrompt: homeworkPrompt || "Submit your homework for this lesson.",
    group: section,
  };

  const added = await getAddedLessons();
  added.push(lesson);
  await saveAddedLessons(added);

  return NextResponse.json({ ok: true, lesson });
}
