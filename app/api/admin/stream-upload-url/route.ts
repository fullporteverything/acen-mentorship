import { NextResponse } from "next/server";
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
 * Mint a one-time Cloudflare Stream "direct creator upload" URL. The admin's
 * browser then POSTs the video bytes straight to Cloudflare — nothing large
 * ever transits Vercel. Returns `{ uploadURL, uid }`.
 */
export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) {
    return NextResponse.json(
      { error: "Cloudflare Stream is not configured." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxDurationSeconds: 7200,
          requireSignedURLs: false,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data?.result?.uploadURL) {
      const message =
        data?.errors?.[0]?.message || "Failed to create upload URL.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({
      uploadURL: data.result.uploadURL,
      uid: data.result.uid,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Cloudflare Stream." },
      { status: 502 }
    );
  }
}
