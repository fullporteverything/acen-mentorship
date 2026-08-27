import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  type RoleCheckResult,
  verifyDiscordMembership,
} from "@/lib/discord-membership";
import { isSessionCurrent } from "@/lib/session-store";
import { progressViewerIds } from "@/lib/progress-link";

export interface MemberIdentity {
  /** Canonical Discord id used for all member-owned records. */
  discordId: string;
  /** Both canonical and legacy NextAuth ids accepted by owner checks. */
  ownerIds: string[];
  isAdmin: boolean;
  name?: string | null;
}

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * The caller's seat is gone: another device took it, an admin kicked it, or
 * the anomaly watch revoked it. A plain `AuthorizationError` so every existing
 * `catch` keeps working unchanged (API routes still answer 401) — the subclass
 * exists only so the page-level handler can send them to a gate that explains
 * THIS instead of the generic "role missing" copy.
 */
export class SessionSupersededError extends AuthorizationError {
  constructor(message = "This session is no longer the account's active session") {
    super(401, message);
    this.name = "SessionSupersededError";
  }
}

/**
 * The caller holds a valid-looking token that predates seat tracking, so there
 * is nothing to enforce against. Distinct from SessionSupersededError purely so
 * the copy is honest: nobody took their seat and nobody kicked them — they just
 * need to sign in again. Same 401, so API callers see no change.
 */
export class SessionExpiredError extends AuthorizationError {
  constructor(message = "This session predates seat tracking; sign in again") {
    super(401, message);
    this.name = "SessionExpiredError";
  }
}

/** Converts the centralized authorization outcome into a safe API response. */
export function authorizationErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

/**
 * Called by every dashboard page's `.catch(...)`. ANY auth failure here would
 * otherwise crash the server component render → Next returns a 500 → Chrome
 * shows its native "server error occurred" screen (bypassing the app's
 * error.tsx) → reads to the user as "the whole website isn't working."
 *
 * Instead we always redirect to the login page with an `?error=` query so
 * CrackedGate can explain what happened. The middleware skips its auto-
 * `/` → `/dashboard` bounce whenever `error` is present, so the redirect
 * doesn't loop back into the failing dashboard.
 *
 * Never returns — always throws NEXT_REDIRECT via `redirect()`. Signature
 * kept as `never` so existing callers' `?? redirect("/")` still compiles as
 * unreachable dead code.
 */
export function rethrowTemporaryAuthorizationError(error: unknown): never {
  // Checked before the generic branch: a superseded session is still logged
  // in as far as the proxy is concerned, so a bare `/` would bounce straight
  // back to /dashboard and loop. The `error` query both stops that bounce and
  // lets CrackedGate say what actually happened.
  if (error instanceof SessionSupersededError) redirect("/?error=SessionActive");
  // Same reasoning as above — still logged in as far as the proxy is
  // concerned, so a bare `/` would bounce back to /dashboard and loop.
  if (error instanceof SessionExpiredError) redirect("/?error=SessionExpired");
  if (error instanceof AuthorizationError) {
    if (error.status === 503) redirect("/?error=Verification");
    if (error.status === 403) redirect("/?error=AccessDenied");
    // 401 — no valid session. Middleware won't bounce an unauth user back
    // to /dashboard, so plain `/` is safe (and shows the login page cleanly).
    redirect("/");
  }
  // Non-authorization failures (Blob/Neon/Discord fetch timeout that
  // bubbled up unwrapped) — send to login with a generic error code so
  // middleware still skips the bounce, and CrackedGate falls through to
  // its default "Discord sign-in could not be completed" copy.
  redirect("/?error=Unavailable");
}

export async function requireMemberOrResponse(): Promise<MemberIdentity | NextResponse> {
  try {
    return await requireMember();
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function requireAdminOrResponse(): Promise<MemberIdentity | NextResponse> {
  try {
    return await requireAdmin();
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

const MEMBERSHIP_REVALIDATION_MS = 60_000;
const LOGIN_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const membershipCache = new Map<string, { checkedAt: number; result: RoleCheckResult }>();

async function revalidateMembership(discordId: string): Promise<RoleCheckResult> {
  const cached = membershipCache.get(discordId);
  if (cached && Date.now() - cached.checkedAt < MEMBERSHIP_REVALIDATION_MS) {
    return cached.result;
  }

  const result = await verifyDiscordMembership(discordId);
  // Never extend access because Discord is unavailable or the required role is absent.
  if (result.member) {
    membershipCache.set(discordId, { checkedAt: Date.now(), result });
  } else {
    membershipCache.delete(discordId);
  }
  return result;
}

/**
 * A kick has to land promptly, so this cache is deliberately tiny: at most
 * SESSION_CHECK_TTL_MS of staleness between an admin revoking a session and
 * that session stopping. It exists because `requireMember` runs on every
 * protected page render and every API call, and a Neon round-trip on each of
 * those is a real cost. Kept on globalThis so it survives dev HMR reloads,
 * matching app/api/security/check-ip/route.ts.
 */
const SESSION_CHECK_TTL_MS = 5_000;
const SESSION_CACHE_MAX = 500;
const globalSessionCache = globalThis as unknown as {
  __dojoSessionCurrentCache?: Map<string, { current: boolean; at: number }>;
};
const sessionCurrentCache =
  globalSessionCache.__dojoSessionCurrentCache ??
  (globalSessionCache.__dojoSessionCurrentCache = new Map<
    string,
    { current: boolean; at: number }
  >());

/**
 * Is the caller's seat still theirs?
 *
 * FAILS OPEN. A Neon outage, a cold-start timeout or a missing table must look
 * like "carry on", never like a kick — the alternative is an infrastructure
 * hiccup silently signing out the entire membership, which is a far worse
 * failure than briefly honouring a session that has been superseded. The
 * genuine refusals (revoked row found) are authoritative answers, not errors.
 */
async function seatIsStillOurs(
  discordId: string,
  sessionId: string
): Promise<boolean> {
  const key = `${discordId}:${sessionId}`;
  const now = Date.now();
  const cached = sessionCurrentCache.get(key);
  if (cached && now - cached.at < SESSION_CHECK_TTL_MS) return cached.current;

  try {
    const current = await isSessionCurrent(discordId, sessionId);
    if (sessionCurrentCache.size > SESSION_CACHE_MAX) {
      for (const [entryKey, entry] of sessionCurrentCache) {
        if (now - entry.at >= SESSION_CHECK_TTL_MS) sessionCurrentCache.delete(entryKey);
      }
    }
    sessionCurrentCache.set(key, { current, at: now });
    return current;
  } catch (error) {
    console.error("[authz] session registry unavailable", error);
    return true;
  }
}

/** Returns a fresh, Discord-role-verified identity or throws a fail-closed error. */
export async function requireMember(): Promise<MemberIdentity> {
  const session = await auth();
  const user = session?.user;
  const discordId = user?.discordId?.trim() || user?.id?.trim();

  if (!user || !discordId) {
    throw new AuthorizationError(401, "Authentication required");
  }

  const roleCheck = await revalidateMembership(discordId);
  if (roleCheck.unavailable) {
    // Sign-in verified the role with the USER'S own OAuth token and stamped
    // memberVerifiedAt. When the bot-token revalidation can't get an answer
    // (Discord down, bot token rotated, bot kicked / intent missing), a
    // recent login proof rides through instead of locking every member out.
    // This applies whether or not a bot token is configured — a present-but-
    // broken bot token must not be stricter than no bot token at all.
    const loginProofIsRecent =
      typeof user.memberVerifiedAt === "number" &&
      Date.now() - user.memberVerifiedAt >= 0 &&
      Date.now() - user.memberVerifiedAt <= LOGIN_PROOF_MAX_AGE_MS;
    if (!loginProofIsRecent) {
      throw new AuthorizationError(503, "Membership verification is temporarily unavailable");
    }
  }
  if (!roleCheck.member && !roleCheck.unavailable) {
    throw new AuthorizationError(403, "Discord membership is required");
  }

  // ONE LIVE SEAT. The sid rides in the JWT; the registry says whether it is
  // still the session this account is using. A session that was kicked by an
  // admin, revoked by the anomaly watch, or superseded once it went quiet
  // stops working here — on the very next request, without waiting for the
  // JWT to expire. Admins are exempt from the seat LIMIT (they may hold
  // several live sessions) but not from an explicit revocation: the registry
  // check is the same for them.
  //
  // A token minted before this shipped carries no sid, so there is no seat to
  // compare against and one-seat enforcement simply would not apply to it.
  // Rather than let those ride until the JWT ages out — during which a shared
  // login stays shareable — they are refused outright. The cost is that
  // everyone signs in once on the deploy that ships this, which the owner
  // asked for, and it doubles as the flush that puts every member on a tracked
  // seat immediately instead of gradually.
  const sessionId = user.sessionId?.trim();
  if (!sessionId) {
    throw new SessionExpiredError();
  }
  if (!(await seatIsStillOurs(discordId, sessionId))) {
    throw new SessionSupersededError();
  }

  const ownerIds = Array.from(
    new Set(
      [...progressViewerIds(discordId), user.id].filter(
        (id): id is string => Boolean(id)
      )
    )
  );
  const isAdmin =
    Boolean(process.env.ADMIN_DISCORD_ID) &&
    discordId === process.env.ADMIN_DISCORD_ID;

  return { discordId, ownerIds, isAdmin, name: user.name };
}

/** Returns a verified administrator identity or throws a fail-closed error. */
export async function requireAdmin(): Promise<MemberIdentity> {
  const identity = await requireMember();
  if (!identity.isAdmin) {
    throw new AuthorizationError(403, "Administrator access is required");
  }
  return identity;
}
