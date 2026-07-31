import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/** Sanity ceiling so a bad client can't reserve an absurd upload. ~30 GB. */
const MAX_FILE_SIZE = 30 * 1024 * 1024 * 1024;

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/**
 * Mint a one-time Cloudflare Stream tus upload URL. Unlike the basic direct
 * creator upload (capped at 200MB), tus is resumable and has no practical size
 * limit, so full-length lesson recordings can go straight from the admin's
 * browser to Cloudflare. Returns `{ uploadUrl, uid }`.
 */
export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const fileSize = body?.fileSize;
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";

  if (
    typeof fileSize !== "number" ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0
  ) {
    return NextResponse.json(
      { error: "A positive integer fileSize (bytes) is required." },
      { status: 400 }
    );
  }
  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "That file is too large to upload." },
      { status: 400 }
    );
  }

  // tus metadata is `key base64(value)` pairs joined by commas. This is where
  // the direct-upload constraints live for tus (the basic upload sent them as
  // JSON) — keep the same 2 hour ceiling the old route used.
  const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
  const metadata = [`maxDurationSeconds ${b64("7200")}`];
  if (fileName) metadata.push(`name ${b64(fileName)}`);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    "Tus-Resumable": "1.0.0",
    "Upload-Length": String(fileSize),
    "Upload-Metadata": metadata.join(","),
  };

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: text?.slice(0, 500) || "Failed to create upload URL." },
        { status: 502 }
      );
    }

    // Success is a 201 with no body — everything lives in the headers.
    const uploadUrl = res.headers.get("Location");
    const uid = res.headers.get("stream-media-id") || "";
    if (!uploadUrl) {
      return NextResponse.json(
        { error: "Cloudflare did not return an upload URL." },
        { status: 502 }
      );
    }

    return NextResponse.json({ uploadUrl, uid });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Cloudflare Stream." },
      { status: 502 }
    );
  }
}
