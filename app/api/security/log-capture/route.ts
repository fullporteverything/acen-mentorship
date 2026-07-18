import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { addCaptureLog } from "@/lib/security-store";

export const dynamic = "force-dynamic";

/**
 * Records a screen-capture attempt reported by the client ScreenGuard.
 * Best-effort: we never reject, we just log what we were told plus the
 * request IP / UA for the admin panel.
 */
export async function POST(req: NextRequest) {
  let body: {
    discordId?: string;
    discordUsername?: string;
    timestamp?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    // Malformed body — still log the attempt with what we have.
  }

  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || undefined;

  addCaptureLog({
    discordId: body.discordId,
    discordUsername: body.discordUsername,
    timestamp: body.timestamp || new Date().toISOString(),
    ip,
    userAgent: req.headers.get("user-agent") || undefined,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
