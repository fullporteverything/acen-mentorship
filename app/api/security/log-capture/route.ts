import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import { recordCaptureAttempt } from "@/lib/security-store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent, recordBlobAuditSafely } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const discordId = identity.discordId;
  const rate = await consumeRateLimit(discordId, "security.capture", { limit: 30, windowMs: 60 * 60 * 1000 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many capture events" }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const requestedTimestamp = typeof body?.timestamp === "string" ? body.timestamp : "";
  const timestamp = Number.isFinite(Date.parse(requestedTimestamp))
    ? requestedTimestamp
    : new Date().toISOString();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || undefined;
  await recordAuditEvent({
    action: "security.capture.requested", resourceType: "member", resourceId: discordId,
    actorDiscordId: discordId, memberDiscordId: discordId, ip,
  });
  const member = await recordCaptureAttempt(
    discordId,
    identity.name?.trim() || "Discord member",
    {
      timestamp,
      ip,
      userAgent: req.headers.get("user-agent") || undefined,
    }
  );
  await recordBlobAuditSafely({ action: "security.capture", resourceType: "member", resourceId: discordId, actorDiscordId: discordId, memberDiscordId: discordId, ip, details: { strikes: member.strikes } });

  return NextResponse.json({ ok: true, strikes: member.strikes, locked: member.locked });
}
