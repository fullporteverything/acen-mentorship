import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireAdminOrResponse } from "@/lib/authz";
import { listAccountSessions } from "@/lib/session-store";
import { SESSION_IDLE_MS } from "@/lib/session-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/sessions/history?discordId=...
 *
 * Admin-only diagnostic: every seat this account has held, newest first,
 * revoked ones included. It exists to answer the one question the live list
 * cannot — "the gate refused me, then let me straight in; why?"
 *
 * Read `revokeReason` on the seat that stopped being current:
 *
 *   signed_out  Sign-out was called on that seat. If no admin touched it, the
 *               sign-out came from a browser — the "Try Again" button on the
 *               refusal gate being the usual culprit. It should now only ever
 *               end the seat the clicking browser holds.
 *   superseded  The seat had gone quiet past SESSION_IDLE_MS and a later
 *               sign-in took it. If the member insists they were sitting right
 *               there, their tab was backgrounded and Chrome throttled or
 *               froze its heartbeat.
 *   admin_kick  Someone pressed the button in the panel.
 *   anomaly     The watch revoked it (only possible with auto-revoke armed).
 *
 * `staleForMs` on a still-live row shows how long since its last beat, so a
 * seat that is quietly not beating is visible BEFORE it costs anyone anything.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;

  const requested = req.nextUrl.searchParams.get("discordId")?.trim();
  // Defaults to the caller so the admin can diagnose their own test without
  // typing an id; validated when supplied, since it reaches the store.
  const discordId = requested || admin.discordId;
  if (!/^\d{17,20}$/.test(discordId)) {
    return NextResponse.json({ error: "invalid discordId" }, { status: 400 });
  }

  const now = Date.now();
  const sessions = await listAccountSessions(discordId);

  return NextResponse.json(
    {
      discordId,
      idleWindowMs: SESSION_IDLE_MS,
      serverNow: new Date(now).toISOString(),
      sessions: sessions.map((session) => {
        const staleFor = now - Date.parse(session.lastSeenAt);
        return {
          sessionId: session.sessionId,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          staleForMs: Number.isFinite(staleFor) ? staleFor : null,
          // What the seat check would make of this row right now.
          countsAsLive: session.revokedAt === null && staleFor < SESSION_IDLE_MS,
          revokedAt: session.revokedAt,
          revokeReason: session.revokeReason,
          country: session.country,
          fingerprint: session.fingerprint?.slice(0, 12) ?? null,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
