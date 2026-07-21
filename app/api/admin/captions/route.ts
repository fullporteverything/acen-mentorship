import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/**
 * A real Cloudflare Stream UID is a 32-char lowercase hex string. Mirror the
 * `isValidVideoId` heuristic in components/CloudflarePlayer.tsx: reject empty,
 * whitespace, underscores, or anything shorter than 16 chars.
 */
function isPlausibleVideoId(videoId: string | undefined | null): boolean {
  if (!videoId) return false;
  const id = videoId.trim();
  if (id.length < 16) return false;
  if (/\s/.test(id)) return false;
  if (id.includes("_")) return false;
  return true;
}

function cloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

/**
 * GET `?videoId=...` — list the caption tracks Cloudflare has for a video.
 * Returns `{ captions: [{ language, label, status? }] }` (empty array on none).
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const videoId = req.nextUrl.searchParams.get("videoId") || "";
  if (!isPlausibleVideoId(videoId)) {
    return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
  }

  const config = cloudflareConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Cloudflare Stream is not configured." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${videoId}/captions`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const message =
        data?.errors?.[0]?.message || "Failed to list captions.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Cloudflare returns `result` as an array of caption objects. Shape has
    // varied historically (`language`/`label`, sometimes a `status` for
    // generated tracks), so map defensively and drop anything unusable.
    type CaptionTrack = { language: string; label: string; status?: string };
    const result: unknown[] = Array.isArray(data.result) ? data.result : [];
    const captions = result
      .map((c: unknown): CaptionTrack | null => {
        const track = (c ?? {}) as Record<string, unknown>;
        const language =
          typeof track.language === "string" ? track.language : "";
        if (!language) return null;
        const label =
          typeof track.label === "string" && track.label
            ? track.label
            : language;
        const status =
          typeof track.status === "string" ? track.status : undefined;
        return { language, label, status };
      })
      .filter((c): c is CaptionTrack => c !== null);

    return NextResponse.json({ captions });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Cloudflare Stream." },
      { status: 502 }
    );
  }
}

/**
 * POST `{ videoId }` — ask Cloudflare to AI-generate an English caption track.
 * Cloudflare processes this asynchronously; a track appears in GET once ready.
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { videoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const videoId = (body.videoId || "").trim();
  if (!isPlausibleVideoId(videoId)) {
    return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
  }

  const config = cloudflareConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Cloudflare Stream is not configured." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${videoId}/captions/en/generate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const message =
        data?.errors?.[0]?.message || "Failed to generate captions.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Cloudflare Stream." },
      { status: 502 }
    );
  }
}
