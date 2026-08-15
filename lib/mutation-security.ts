import { NextResponse } from "next/server";

import type { MemberIdentity } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { consumeRateLimit, type RateLimitPolicy } from "@/lib/rate-limit";

/** Shared boundary for all admin/member mutations: persistent throttle + audit. */
export async function allowMutation(
  identity: MemberIdentity,
  action: string,
  request?: Request,
  targetDiscordId?: string,
  policy?: RateLimitPolicy
): Promise<NextResponse | null> {
  const rate = await consumeRateLimit(
    identity.discordId,
    action,
    policy ?? { limit: identity.isAdmin ? 60 : 20, windowMs: 60 * 60 * 1000 }
  );
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  await recordAuditEvent({
    action: `${action}.requested`, resourceType: "mutation", resourceId: targetDiscordId,
    actorDiscordId: identity.discordId, memberDiscordId: targetDiscordId ?? identity.discordId,
    ip: request?.headers.get("x-forwarded-for")?.split(",")[0].trim(),
  });
  return null;
}
