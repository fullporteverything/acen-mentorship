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
 * Called by every dashboard page's `.catch(...)`. When Discord membership
 * verification is temporarily unavailable (503), sending an uncaught error up
 * to Next.js produces an unstyled 500 that Chrome displays as its own "server
 * error occurred" screen — which reads to the user as "the whole site is
 * down." Instead we redirect to the login page with an `?error=` query so the
 * CrackedGate surface explains what happened; middleware skips its auto-
 * `/` → `/dashboard` bounce when `error` is present, so no redirect loop.
 *
 * Returns null for non-temporary errors so the caller's own `redirect("/")`
 * (401/403) still runs.
 */
export function rethrowTemporaryAuthorizationError(error: unknown): null {
  if (error instanceof AuthorizationError && error.status === 503) {
    redirect("/?error=Verification");
  }
  return null;
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
    const loginProofIsRecent =
      !process.env.DISCORD_BOT_TOKEN &&
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
