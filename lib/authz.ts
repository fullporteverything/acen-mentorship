import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  type RoleCheckResult,
  verifyDiscordMembership,
} from "@/lib/discord-membership";
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
