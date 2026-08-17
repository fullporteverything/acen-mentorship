import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { identityVerifications, members, ndaSignatures } from "@/lib/db/schema";
import { NDA_VERSION } from "@/lib/nda";

/**
 * Per-instance short-circuit so a hot request costs zero DDL round-trips once
 * the tables are known to exist. Mirrors homework-archive's `backfillEnsured`.
 */
let onboardingTablesEnsured = false;

/**
 * Idempotently create the onboarding tables so production gets them with no
 * separate drizzle migration step. Raw CREATE TABLE IF NOT EXISTS matching the
 * drizzle definitions in schema.ts. Runs at most once per process; a failure
 * leaves the flag unset so the next call retries.
 */
export async function ensureOnboardingTables(): Promise<void> {
  if (onboardingTablesEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nda_signatures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid NOT NULL REFERENCES members(id),
      discord_id varchar(32) NOT NULL,
      legal_name varchar(255) NOT NULL,
      nda_version integer NOT NULL,
      nda_hash varchar(128) NOT NULL,
      ip_address varchar(128),
      user_agent text,
      consent_esign boolean NOT NULL DEFAULT false,
      signed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS nda_signatures_member_version_index
      ON nda_signatures (member_id, nda_version)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS identity_verifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid NOT NULL REFERENCES members(id),
      discord_id varchar(32) NOT NULL,
      stripe_session_id varchar(255) NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'pending',
      verified_name varchar(255),
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT identity_verifications_stripe_session_id_unique UNIQUE (stripe_session_id),
      CONSTRAINT identity_verifications_valid_status
        CHECK (status IN ('pending', 'verified', 'requires_input', 'canceled'))
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS identity_verifications_member_created_index
      ON identity_verifications (member_id, created_at)
  `);

  onboardingTablesEnsured = true;
}

/**
 * Upsert the member (by discordId, like homework-archive) and append an
 * immutable NDA signature row. Append-only: never updates an existing signature.
 * Real write errors surface to the caller.
 */
export async function recordNdaSignature(input: {
  discordId: string;
  displayName?: string | null;
  legalName: string;
  ndaVersion: number;
  ndaHash: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await ensureOnboardingTables();

  const [member] = await db
    .insert(members)
    .values({ discordId: input.discordId, displayName: input.displayName ?? undefined })
    .onConflictDoUpdate({
      target: members.discordId,
      set: { displayName: input.displayName ?? undefined, updatedAt: new Date(), deletedAt: null },
    })
    .returning({ id: members.id });

  await db.insert(ndaSignatures).values({
    memberId: member.id,
    discordId: input.discordId,
    legalName: input.legalName,
    ndaVersion: input.ndaVersion,
    ndaHash: input.ndaHash,
    ipAddress: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    consentEsign: true,
  });
}

export type OnboardingStatus = {
  ndaSignedCurrent: boolean;
  identityVerified: boolean;
  /** Raw status of the member's latest identity session, or null if none exists. */
  identityStatus: "pending" | "verified" | "requires_input" | "canceled" | null;
};

/**
 * Read-only snapshot of a member's onboarding state.
 *   ndaSignedCurrent — a signature exists for the CURRENT NDA_VERSION.
 *   identityVerified — the member's latest identity session is "verified".
 * An unknown member (no row) is simply not signed and not verified.
 */
export async function getOnboardingStatus(discordId: string): Promise<OnboardingStatus> {
  // Reads must never break the dashboard render; a missing table (gate enabled
  // before the first write on a fresh DB) simply reads as "not onboarded yet".
  await ensureOnboardingTables().catch(() => undefined);

  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.discordId, discordId))
    .limit(1);
  if (!member) return { ndaSignedCurrent: false, identityVerified: false, identityStatus: null };

  const [signature] = await db
    .select({ id: ndaSignatures.id })
    .from(ndaSignatures)
    .where(and(eq(ndaSignatures.memberId, member.id), eq(ndaSignatures.ndaVersion, NDA_VERSION)))
    .limit(1);

  const [latestVerification] = await db
    .select({ status: identityVerifications.status })
    .from(identityVerifications)
    .where(eq(identityVerifications.memberId, member.id))
    .orderBy(desc(identityVerifications.createdAt))
    .limit(1);

  return {
    ndaSignedCurrent: Boolean(signature),
    identityVerified: latestVerification?.status === "verified",
    identityStatus: (latestVerification?.status as OnboardingStatus["identityStatus"]) ?? null,
  };
}

/**
 * Persist a freshly created Stripe Identity session in "pending" so the webhook
 * (which only knows the session id) can later resolve the owning member.
 */
export async function createIdentitySessionRecord(
  discordId: string,
  displayName: string | null | undefined,
  sessionId: string
): Promise<void> {
  await ensureOnboardingTables();

  const [member] = await db
    .insert(members)
    .values({ discordId, displayName: displayName ?? undefined })
    .onConflictDoUpdate({
      target: members.discordId,
      set: { displayName: displayName ?? undefined, updatedAt: new Date(), deletedAt: null },
    })
    .returning({ id: members.id });

  await db
    .insert(identityVerifications)
    .values({ memberId: member.id, discordId, stripeSessionId: sessionId, status: "pending" })
    .onConflictDoNothing({ target: identityVerifications.stripeSessionId });
}

/**
 * Advance a session's status from a verified Stripe webhook. No-op when the
 * session id is unknown (e.g. a session created out-of-band).
 */
export async function updateIdentityStatus(
  sessionId: string,
  status: "pending" | "verified" | "requires_input" | "canceled",
  verifiedName?: string | null
): Promise<void> {
  await ensureOnboardingTables();

  await db
    .update(identityVerifications)
    .set({
      status,
      verifiedName: verifiedName ?? undefined,
      verifiedAt: status === "verified" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(identityVerifications.stripeSessionId, sessionId));
}
