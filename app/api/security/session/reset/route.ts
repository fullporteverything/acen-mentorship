import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";
import { verifyResetToken } from "@/lib/session-reset-token";
import { revokeSessions } from "@/lib/session-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/security/session/reset
 *
 * Clears every session on one account. Backs the "sign out everywhere" button
 * on the gate a member hits when their account is already open somewhere else.
 *
 * ── THIS ROUTE IS DELIBERATELY UNAUTHENTICATED, AND THAT IS THE WHOLE RISK ──
 * The caller is by definition NOT signed in — their sign-in was just refused.
 * So there is no session to check, and a route that simply took a Discord id
 * and cleared it would be a public button for logging any member out of a
 * lesson, repeatedly, forever.
 *
 * What stands in for a session is the reset token, which is only ever minted
 * inside the sign-in callback AFTER Discord has authenticated the caller for
 * that specific account and the role check has passed. See
 * lib/session-reset-token.ts. The token is signed with AUTH_SECRET, bound to
 * one account, and dead after five minutes.
 *
 * Layered on top of that:
 *  - The account cleared is the one INSIDE the token. Nothing in the request
 *    body chooses a target, so there is no id for a caller to tamper with.
 *  - Rate limited per account and per IP, because unauthenticated endpoints get
 *    hammered and a valid token replayed in a loop should still hit a wall.
 *  - Every failure returns the SAME response. Distinguishing "expired" from
 *    "forged" tells a prober how close they are.
 *  - Audited on success, so a member who says "something logged me out" can be
 *    answered from the record.
 *
 * The action itself is safe by construction even if a token did leak: it can
 * only ever sign that one account out. It cannot read anything, change
 * anything, or grant access.
 */

/** Per account: enough for a member fixing a stuck session, not for a loop. */
const PER_ACCOUNT = { limit: 6, windowMs: 60 * 60 * 1000 };
/** Per IP, to blunt someone farming tokens across several accounts. */
const PER_IP = { limit: 20, windowMs: 60 * 60 * 1000 };

/** One response for every refusal. See the note above. */
function refuse() {
  return NextResponse.json(
    { error: "This link is no longer valid. Sign in again to continue." },
    { status: 400, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return refuse();

  const verdict = await verifyResetToken(token, process.env.AUTH_SECRET);
  if (!verdict.ok) {
    // Reason logged, never returned.
    console.warn(`session reset refused: ${verdict.reason}`);
    return refuse();
  }

  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  try {
    const [byAccount, byIp] = await Promise.all([
      consumeRateLimit(verdict.discordId, "session.reset", PER_ACCOUNT),
      consumeRateLimit(ip, "session.reset.ip", PER_IP),
    ]);
    if (!byAccount.allowed || !byIp.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again shortly." },
        { status: 429, headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch (error) {
    // FAILS CLOSED, unlike the rest of the session code. Everywhere else a
    // database failure must not lock a member out, so it fails open. Here the
    // failure mode is the opposite: an unauthenticated endpoint that cannot
    // rate limit itself is one that can be hammered, and refusing costs the
    // member a retry rather than costing everyone their session.
    console.error("session reset: rate limiter unavailable", error);
    return NextResponse.json(
      { error: "Temporarily unavailable. Try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let revoked = 0;
  try {
    revoked = await revokeSessions(verdict.discordId, "signed_out");
  } catch (error) {
    console.error("session reset: revoke failed", error);
    return NextResponse.json(
      { error: "Could not clear your sessions. Try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    await recordAuditEvent({
      action: "session.reset_all",
      resourceType: "member_session",
      resourceId: verdict.discordId,
      memberDiscordId: verdict.discordId,
      details: { revoked, via: "reset_token" },
    });
  } catch (error) {
    // The sessions are already gone; losing the audit line must not turn a
    // successful clear into an error the member has to puzzle over.
    console.error("session reset: audit write failed", error);
  }

  return NextResponse.json(
    { cleared: revoked },
    { headers: { "Cache-Control": "no-store" } }
  );
}
