import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getKinescopeConfig,
  KinescopeProjectResolutionError,
  kinescopeFetch,
  normalizeKinescopeVideo,
  resolveKinescopeProjectId,
  type LibraryVideo,
} from "@/lib/kinescope";
import { buildEffectiveLessons } from "@/lib/lessons-config";
import { getAddedLessons, getLessonOverrides } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

interface AttachedLibraryVideo extends LibraryVideo {
  attachedTo: string | null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let projectId: string;
  try {
    getKinescopeConfig();
    projectId = await resolveKinescopeProjectId();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof KinescopeProjectResolutionError
            ? error.message
            : "Kinescope is not configured.",
      },
      { status: 500 }
    );
  }

  let idToLesson = new Map<string, string>();
  try {
    const [added, overrides] = await Promise.all([
      getAddedLessons(),
      getLessonOverrides(),
    ]);
    idToLesson = new Map(
      buildEffectiveLessons(added, overrides)
        .filter((lesson) => lesson.videoId)
        .map((lesson) => [lesson.videoId, lesson.title])
    );
  } catch {
    // The video library remains useful when persisted lesson data is unavailable.
  }

  try {
    const query = new URLSearchParams({
      project_id: projectId,
      page: "1",
      per_page: "100",
      order: "created_at.desc,title.asc",
    });
    const response = await kinescopeFetch(`/videos?${query.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.data)) {
      return NextResponse.json(
        { error: "Kinescope returned an invalid video list." },
        { status: 502 }
      );
    }

    const videos = payload.data
      .map((raw: unknown): AttachedLibraryVideo | null => {
        try {
          const video = normalizeKinescopeVideo(raw);
          return { ...video, attachedTo: idToLesson.get(video.id) ?? null };
        } catch {
          return null;
        }
      })
      .filter((video: AttachedLibraryVideo | null): video is AttachedLibraryVideo =>
        video !== null
      )
      .sort((a: AttachedLibraryVideo, b: AttachedLibraryVideo) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });

    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Kinescope." },
      { status: 502 }
    );
  }
}
