import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { kinescopeFetch } from "@/lib/kinescope";
import { isKinescopeVideoId } from "@/lib/video-id";
import { hasEnglishSubtitle } from "@/lib/captions";
import { del, get, put } from "@vercel/blob";

export const dynamic = "force-dynamic";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;
const LEASE_MAX_AGE_MS = 2 * 60 * 1000;

function captionLeasePath(videoId: string) {
  return `dojo/caption-requests/${videoId}.json`;
}

async function acquireCaptionLease(videoId: string) {
  const pathname = captionLeasePath(videoId);
  const body = JSON.stringify({ acquiredAt: new Date().toISOString() });
  const options = {
    access: "private" as const,
    storeId: STORE_ID,
    contentType: "application/json",
    addRandomSuffix: false,
  };
  try {
    const created = await put(pathname, body, options);
    return { acquired: true as const, pathname, etag: created.etag };
  } catch {
    try {
      const current = await get(pathname, {
        access: "private",
        storeId: STORE_ID,
        useCache: false,
      });
      if (!current || current.statusCode !== 200 || !current.stream) {
        return { acquired: false as const };
      }
      const lease = JSON.parse(await new Response(current.stream).text()) as {
        acquiredAt?: string;
      };
      const acquiredAt = new Date(lease.acquiredAt || 0).getTime();
      if (Date.now() - acquiredAt <= LEASE_MAX_AGE_MS) {
        return { acquired: false as const };
      }
      const replaced = await put(pathname, body, {
        ...options,
        allowOverwrite: true,
        ifMatch: current.blob.etag,
      });
      return { acquired: true as const, pathname, etag: replaced.etag };
    } catch {
      return { acquired: false as const };
    }
  }
}

async function englishCaptionsExist(videoId: string): Promise<boolean> {
  const response = await kinescopeFetch(`/videos/${videoId}`, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return hasEnglishSubtitle(await response.json().catch(() => null));
}

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

  let activeLease: { pathname: string; etag: string } | undefined;
  try {
    if (await englishCaptionsExist(videoId)) {
      return NextResponse.json({ ok: true, language: "en", existing: true });
    }
    const lease = await acquireCaptionLease(videoId);
    if (!lease.acquired) {
      return NextResponse.json({ ok: true, language: "en", queued: true });
    }
    activeLease = { pathname: lease.pathname, etag: lease.etag };
    await kinescopeFetch(`/videos/${videoId}/subtitles/auto`, {
      method: "POST",
      body: JSON.stringify({ languages: ["en"] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json({ ok: true, language: "en" });
  } catch {
    try {
      if (await englishCaptionsExist(videoId)) {
        return NextResponse.json({ ok: true, language: "en", existing: true });
      }
    } catch {
      // Fall through to one actionable provider-safe error.
    }
    if (activeLease) {
      await del(activeLease.pathname, {
        storeId: STORE_ID,
        ifMatch: activeLease.etag,
      }).catch(() => undefined);
    }
    return NextResponse.json(
      { error: "Video uploaded, but English captions could not be queued yet." },
      { status: 502 }
    );
  }
}
