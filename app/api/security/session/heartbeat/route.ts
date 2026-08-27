import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { requireMemberOrResponse } from "@/lib/authz";
import { getBaseline, recentSightings, touchSession } from "@/lib/session-store";
import { evaluateSessionAnomaly } from "@/lib/session-anomaly";
import { applyAnomalyConsequence } from "@/lib/session-consequence";

export const dynamic = "force-dynamic";

/**
 * SUITE 7 — SESSION HEARTBEAT.
 *
 * components/SessionGuard.tsx POSTs here every SESSION_HEARTBEAT_MS. Two jobs:
 *   1. Keep this session's seat alive, and tell the page when the seat is no
 *      longer its own (`current: false` → the guard shows its final overlay).
 *   2. Record where and what the beat came from, so the anomaly scorer has a
 *      history to read.
 *
 * The failure posture is FAIL OPEN, deliberately and everywhere. A heartbeat
 * that stops landing is indistinguishable from a member who closed the laptop:
 * SESSION_IDLE_MS elapses, the seat is released, and the next thing they see is
 * a sign-in prompt. So nothing optional in this handler is allowed to throw —
 * a scoring bug must not be able to evict the membership.
 *
 * Not rate limited on purpose: at one beat a minute plus a beat on every tab
 * focus, a member legitimately exceeds the shared allowMutation budget within
 * the hour, and a 429 here means a lost seat. The endpoint is authenticated,
 * writes only the caller's own row, and the worst a forged same-account POST
 * can do is keep a session the caller already owns alive.
 */

/**
 * Client input, so trusted for nothing. The signature this accepts is exactly
 * what lib/device-fingerprint.ts emits (16 lowercase hex), widened a little so
 * the format can change without a flag day. Anything else is dropped — not
 * rejected, since a bad signature is a missing signal, not a reason to refuse
 * the beat and cost the member their seat.
 */
const FINGERPRINT = /^[0-9a-z]{8,64}$/;

/**
 * How much heartbeat history the scorer sees. Long enough for "impossible
 * travel" to mean anything (two continents inside half a day), short enough
 * that last week's holiday is not still being held against anybody.
 */
const ANOMALY_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;

  // The session id is read from the SESSION, never from the body: a client
  // that could name the seat it is beating for could keep somebody else's
  // seat warm, or beat a seat it does not hold.
  const session = await auth();
  const sessionId = (session?.user as { sessionId?: string } | undefined)?.sessionId?.trim();
  if (!sessionId) {
    // A JWT minted before single-session enforcement shipped carries no seat
    // id. Those members are untracked until their next sign-in, and untracked
    // must read as "fine", never as "revoked".
    return NextResponse.json({ current: true, untracked: true });
  }

  const body = await req.json().catch(() => ({}));
  const claimed = typeof body?.fingerprint === "string" ? body.fingerprint.trim() : "";
  const fingerprint = FINGERPRINT.test(claimed) ? claimed : null;

  // Same client-IP read as app/api/security/check-ip/route.ts.
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "";

  const { current } = await touchSession({
    discordId: identity.discordId,
    sessionId,
    ip: ip || null,
    userAgent: req.headers.get("user-agent") || null,
    fingerprint,
  });

  if (!current) {
    // The seat belongs to another session now. Nothing to score — this one is
    // already over.
    return NextResponse.json({ current: false });
  }

  let flagged = false;
  try {
    const [sightings, baseline] = await Promise.all([
      recentSightings(identity.discordId, ANOMALY_WINDOW_MS),
      // A missing or cold profile is not a problem: the scorer falls back to
      // its absolute thresholds, which are the conservative ones. Losing a
      // baseline costs accuracy, never access.
      getBaseline(identity.discordId).catch(() => null),
    ]);
    // `datacenterIp` is left unset: resolving it means an outbound lookup, and
    // one of those per member per minute is both slow and rate-limited by the
    // provider. The VPN/proxy determination already happens on its own cadence
    // in /api/security/check-ip.
    const verdict = evaluateSessionAnomaly(sightings, { baseline });
    flagged = verdict.actionable;
    if (flagged) {
      console.warn(
        `session heartbeat: anomaly flagged for ${identity.discordId} (score ${verdict.score}): ${verdict.summary}`
      );
      await applyAnomalyConsequence({ discordId: identity.discordId, verdict });
    }
  } catch (error) {
    // FAIL OPEN, LOUDLY. A scorer that throws must cost us a signal, not a
    // member: the beat still succeeds and the seat stays alive.
    console.error("session heartbeat: anomaly scoring failed", error);
  }

  // ⚠ NO CONSEQUENCE LOGIC IN THIS FILE, BY DESIGN. Everything that can cost a
  // member access lives in lib/session-consequence.ts — one module somebody
  // can read end to end before arming it, rather than a decision buried in a
  // heartbeat handler. With SESSION_ANOMALY_AUTOREVOKE unset (the default) that
  // call records the flag for the audit log and changes nothing the member can
  // see. Keep it that way: add consequences there, not here.
  return flagged
    ? NextResponse.json({ current: true, flagged: true })
    : NextResponse.json({ current: true });
}
