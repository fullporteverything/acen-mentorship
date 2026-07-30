import { NextResponse } from "next/server";
import { auth } from "@/auth";
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

function cloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

interface LibraryVideo {
  uid: string;
  name: string;
  createdAt: string;
  /** Seconds, when Cloudflare has finished probing the file. */
  duration: number | null;
  ready: boolean;
  /** Title of the lesson this UID is attached to, or null if unassigned. */
  attachedTo: string | null;
}

/**
 * Every video in the Cloudflare Stream account, newest first, cross-referenced
 * against the effective curriculum so the admin can see which lesson (if any)
 * each UID is already attached to. This is the persistent counterpart to
 * VideoUpload's one-shot "here's your UID" panel — that panel is gone as soon
 * as the page reloads, this list is not.
 */
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = cloudflareConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Cloudflare Stream is not configured." },
      { status: 500 }
    );
  }

  // Which UID belongs to which lesson. Overrides beat the static config, which
  // `buildEffectiveLessons` already resolves for us (see lib/lessons-config.ts).
  let uidToLesson = new Map<string, string>();
  try {
    const [added, overrides] = await Promise.all([
      getAddedLessons(),
      getLessonOverrides(),
    ]);
    uidToLesson = new Map(
      buildEffectiveLessons(added, overrides)
        .filter((l) => l.videoId && l.videoId.trim())
        .map((l) => [l.videoId.trim(), l.title])
    );
  } catch {
    // Blob store unreachable — still list the videos, just without attachments.
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const message = data?.errors?.[0]?.message || "Failed to list videos.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Cloudflare's video objects carry a lot of fields and the useful ones live
    // in different places depending on how the video was created (direct
    // upload vs. copy), so read everything defensively and drop rows with no
    // uid — they'd be useless in a "copy the UID" list anyway.
    const result: unknown[] = Array.isArray(data.result) ? data.result : [];
    const videos = result
      .map((v: unknown): LibraryVideo | null => {
        const video = (v ?? {}) as Record<string, unknown>;
        const uid = typeof video.uid === "string" ? video.uid : "";
        if (!uid) return null;

        const meta = (video.meta ?? {}) as Record<string, unknown>;
        const metaName = typeof meta.name === "string" ? meta.name.trim() : "";
        const metaFile =
          typeof meta.filename === "string" ? meta.filename.trim() : "";
        const name = metaName || metaFile || uid;

        const createdAt = typeof video.created === "string" ? video.created : "";
        const duration =
          typeof video.duration === "number" && video.duration > 0
            ? video.duration
            : null;
        const ready = video.readyToStream === true;

        return {
          uid,
          name,
          createdAt,
          duration,
          ready,
          attachedTo: uidToLesson.get(uid) ?? null,
        };
      })
      .filter((v): v is LibraryVideo => v !== null);

    // Newest first; rows missing a created timestamp sink to the bottom.
    videos.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Cloudflare Stream." },
      { status: 502 }
    );
  }
}
