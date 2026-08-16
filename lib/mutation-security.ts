import { NextResponse } from "next/server";

import type { MemberIdentity } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { consumeRateLimit, type RateLimitPolicy } from "@/lib/rate-limit";

/**
 * Reject a state-changing request whose Origin isn't this same site.
 *
 * The session cookie is SameSite=Lax, so a cross-site page's POST already
 * arrives without the cookie and fails auth — this is the belt to that
 * suspenders: an explicit "no requests from outside the website." A browser
 * always sends Origin on fetch/XHR mutations; when it matches the request's
 * own Host, allow. A missing Origin (rare non-browser client, or a same-site
 * top-level navigation that never reaches a mutation) is allowed, since the
 * SameSite cookie still gates those. A present-but-foreign Origin is refused.
 */
function isSameOriginMutation(request?: Request): boolean {
  if (!request) return true; // internal / server-action caller, no HTTP origin
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // malformed Origin — treat as hostile
  }
}

/** Shared boundary for all admin/member mutations: origin check + throttle + audit. */
export async function allowMutation(
  identity: MemberIdentity,
  action: string,
  request?: Request,
  targetDiscordId?: string,
  policy?: RateLimitPolicy
): Promise<NextResponse | null> {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
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
