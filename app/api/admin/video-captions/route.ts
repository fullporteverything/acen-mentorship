import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { kinescopeFetch } from "@/lib/kinescope";
import { isKinescopeVideoId } from "@/lib/video-id";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const isAdmin = !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const videoId = body?.videoId;
  if (!isKinescopeVideoId(videoId)) {
    return NextResponse.json({ error: "A valid video is required." }, { status: 400 });
  }

  try {
    await kinescopeFetch(`/videos/${videoId}/subtitles/auto`, {
      method: "POST",
      body: JSON.stringify({ languages: ["en"] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json({ ok: true, language: "en" });
  } catch {
    return NextResponse.json(
      { error: "Video uploaded, but English captions could not be queued yet." },
      { status: 502 }
    );
  }
}
