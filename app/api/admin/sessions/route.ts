import { NextResponse } from "next/server";

import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { recordAuditEvent } from "@/lib/audit";
import { listActiveSessions, revokeSessions } from "@/lib/session-store";
import type { AdminSessionRow } from "@/components/SessionAdmin";

/**
 * /api/admin/sessions — the single-seat monitor's back end. ADMIN ONLY.
 *
 * This is the most sensitive JSON this app serves: it is a live list of where
 * paying members are sitting right now, complete with IP addresses. Three
 * things follow from that, and all three are deliberate:
 *
 *  1. `force-dynamic` + an explicit `no-store`. A cached copy of this payload
 *     is a copy of members' whereabouts sitting somewhere nobody is watching.
 *     Route handlers are already uncached by default in this Next version, so
 *     both of these are belt-and-braces rather than load-bearing — which is
 *     exactly what you want guarding personal data.
 *  2. The response is a hand-written PROJECTION of MemberSession, not the row.
 *     The user agent never leaves the server (the panel doesn't show it), and
 *     the device fingerprint is truncated here rather than in the browser, so
 *     the full hash is never transmitted at all.
 *  3. The IP *is* sent in full, because the admin's actual job — telling two
 *     sessions apart, reporting an abusive one — needs the whole address. The
 *     panel is what decides not to leave it legible on screen at rest.
 */

export const dynamic = "force-dynamic";

/**
 * Enough of the device hash to tell two browsers apart at a glance, and not
 * enough to be worth passing around. It is a signal, never an identity.
 */
const FINGERPRINT_PREFIX = 12;

/**
 * Discord snowflakes are decimal, and have been 17-19 digits since 2015; 20
 * leaves headroom for the timestamp field rolling over. Checked before the
 * store is touched so a typo can't turn into a lookup for an arbitrary string.
 */
const SNOWFLAKE = /^\d{17,20}$/;

/** Belt to `force-dynamic`'s braces — nothing downstream may keep this. */
const NO_STORE: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * GET — every session seen inside the idle window, newest first.
 *
 * `serverNow` rides along so the panel can render "42s ago" against the clock
 * that wrote `lastSeenAt`. An admin laptop running a few minutes fast would
 * otherwise show live sessions as stale, or stale ones as live.
 */
export async function GET() {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;

  const sessions = await listActiveSessions();
  const rows: AdminSessionRow[] = sessions.map((session) => ({
    sessionId: session.sessionId,
    discordId: session.discordId,
    displayName: session.displayName,
    country: session.country,
    ip: session.ip,
    fingerprint: session.fingerprint
      ? session.fingerprint.slice(0, FINGERPRINT_PREFIX)
      : null,
    lastSeenAt: session.lastSeenAt,
  }));

  return NextResponse.json(
    { sessions: rows, serverNow: new Date().toISOString() },
    { headers: NO_STORE }
  );
}

/**
 * POST { discordId } — free the member's seat.
 *
 * Guards compose exactly as the other admin mutations do: a real server-side
 * admin check first, then the shared same-origin + rate-limit boundary, then
 * the body. The rate limit is tighter than the admin default because every
 * call here signs a real person out of a real lesson.
 */
export async function POST(request: Request) {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.session_revoke", request, undefined, {
    limit: 30,
    windowMs: 3_600_000,
  });
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400, headers: NO_STORE });
  }
  const raw = (body as { discordId?: unknown })?.discordId;
  const discordId = typeof raw === "string" ? raw.trim() : "";
  if (!SNOWFLAKE.test(discordId)) {
    return NextResponse.json(
      { error: "discordId must be a Discord id" },
      { status: 400, headers: NO_STORE }
    );
  }

  const revoked = await revokeSessions(discordId, "admin_kick");
  await recordAuditEvent({
    action: "admin.session_revoke",
    resourceType: "member_session",
    resourceId: discordId,
    actorDiscordId: admin.discordId,
    memberDiscordId: discordId,
    details: { revoked, reason: "admin_kick" },
  }).catch(() => {});

  return NextResponse.json({ revoked }, { headers: NO_STORE });
}
