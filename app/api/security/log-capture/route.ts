import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import { recordCaptureAttempt } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const discordId = identity.discordId;

  const body = await req.json().catch(() => ({}));
  const requestedTimestamp = typeof body?.timestamp === "string" ? body.timestamp : "";
  const timestamp = Number.isFinite(Date.parse(requestedTimestamp))
    ? requestedTimestamp
    : new Date().toISOString();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || undefined;
  const member = await recordCaptureAttempt(
    discordId,
    identity.name?.trim() || "Discord member",
    {
      timestamp,
      ip,
      userAgent: req.headers.get("user-agent") || undefined,
    }
  );

  return NextResponse.json({ ok: true, strikes: member.strikes, locked: member.locked });
}
