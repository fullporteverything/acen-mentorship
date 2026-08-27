import "server-only";

import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { db, dbTransaction } from "@/lib/db/client";
import {
  memberSessionSightings,
  memberSessions,
  members,
} from "@/lib/db/schema";
import { decideClaim } from "./session-claim";
import {
  SESSION_IDLE_MS,
  type MemberSession,
  type SessionClaim,
  type SessionRevokeReason,
  type SessionSighting,
} from "./session-types";

/**
 * Single-seat session registry. See lib/session-types.ts for the rules and
 * lib/session-claim.ts for the verdict itself (kept pure so CI, which has no
 * database, can still test the rule that decides whether somebody gets in).
 *
 * Tables are self-creating in the table-chips-store style: a module-level
 * boolean short-circuits the DDL after the first call, and every exported
 * function begins with `ensureSessionTables()`, so production needs no
 * separate migration step.
 *
 * Signatures are the fixed contract that the API routes, the admin panel and
 * the anomaly scorer are written against; do not change them without updating
 * all callers.
 */

/** Per-instance short-circuit so a hot request costs zero DDL round-trips. */
let sessionTablesEnsured = false;

/**
 * The administrator works from several devices on purpose (phone for the
 * Discord side, desktop for review), so the one-seat rule does not apply to
 * them. They are NOT exempt from explicit revocation — an admin_kick or an
 * anomaly revoke still ends an admin session, and `isSessionCurrent` treats
 * their rows exactly like anyone else's.
 */
function isSeatExempt(discordId: string): boolean {
  const admin = process.env.ADMIN_DISCORD_ID?.trim();
  return Boolean(admin) && discordId === admin;
}

/** The moment before which a session is considered to have stopped beating. */
function idleCutoff(now = Date.now()): Date {
  return new Date(now - SESSION_IDLE_MS);
}

/**
 * Idempotently create the session tables so production gets them with no
 * separate drizzle migration step. Raw CREATE TABLE IF NOT EXISTS matching the
 * drizzle definitions in schema.ts. Runs at most once per process; a failure
 * leaves the flag unset so the next call retries.
 */
export async function ensureSessionTables(): Promise<void> {
  if (sessionTablesEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS member_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid REFERENCES members(id),
      discord_id varchar(32) NOT NULL,
      session_id varchar(64) NOT NULL,
      display_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      ip varchar(64),
      country varchar(2),
      user_agent text,
      fingerprint varchar(64),
      revoked_at timestamptz,
      revoke_reason varchar(32),
      CONSTRAINT member_sessions_session_id_unique UNIQUE (session_id)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS member_sessions_account_live_index
      ON member_sessions (discord_id, revoked_at, last_seen_at DESC)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS member_session_sightings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      discord_id varchar(32) NOT NULL,
      session_id varchar(64),
      at timestamptz NOT NULL DEFAULT now(),
      ip varchar(64),
      country varchar(2),
      fingerprint varchar(64)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS member_session_sightings_account_at_index
      ON member_session_sightings (discord_id, at DESC)
  `);

  sessionTablesEnsured = true;
}

/**
 * Upsert the member row (by discordId, like table-chips-store) so a session
 * always hangs off a real members.id. Best-effort: a session row is still
 * valid with a null member_id, and refusing to record the seat because the
 * member upsert failed would be a worse outcome than a dangling session.
 */
async function resolveMemberId(
  discordId: string,
  displayName?: string | null
): Promise<string | null> {
  try {
    const [member] = await db
      .insert(members)
      .values({ discordId, displayName: displayName ?? undefined })
      .onConflictDoUpdate({
        target: members.discordId,
        set: {
          displayName: displayName ?? undefined,
          updatedAt: new Date(),
          deletedAt: null,
        },
      })
      .returning({ id: members.id });
    return member?.id ?? null;
  } catch {
    return null;
  }
}

const SESSION_COLUMNS = {
  sessionId: memberSessions.sessionId,
  discordId: memberSessions.discordId,
  displayName: memberSessions.displayName,
  createdAt: memberSessions.createdAt,
  lastSeenAt: memberSessions.lastSeenAt,
  ip: memberSessions.ip,
  country: memberSessions.country,
  userAgent: memberSessions.userAgent,
  fingerprint: memberSessions.fingerprint,
  revokedAt: memberSessions.revokedAt,
  revokeReason: memberSessions.revokeReason,
} as const;

type SessionRow = {
  sessionId: string;
  discordId: string;
  displayName: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  fingerprint: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
};

function toMemberSession(row: SessionRow): MemberSession {
  return {
    sessionId: row.sessionId,
    discordId: row.discordId,
    displayName: row.displayName?.trim() || "Member",
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    ip: row.ip,
    country: row.country,
    userAgent: row.userAgent,
    fingerprint: row.fingerprint,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokeReason: (row.revokeReason as SessionRevokeReason | null) ?? null,
  };
}

/**
 * Atomically take the single seat, or report who already holds it.
 *
 * HOW THIS IS RACE-SAFE. The verdict needs a read (who holds the seat?)
 * followed by a write (take it), and under READ COMMITTED two simultaneous
 * logins would each read "seat free" — neither sees the other's uncommitted
 * insert — and both would win, which is precisely the bug the feature exists
 * to prevent. So:
 *
 *  1. Everything below runs inside ONE transaction.
 *  2. Its first statement takes `pg_advisory_xact_lock` on a hash of the
 *     account id. That serializes claims PER ACCOUNT (and only per account —
 *     unrelated members never queue behind each other). The lock is released
 *     by commit or rollback, so a crashed request cannot wedge an account.
 *  3. The read, the revoke of the dead rows and the insert therefore happen
 *     with no other claim for this account in flight. The loser of the race
 *     blocks on the lock, then re-reads and sees the winner's live row, and is
 *     refused with `active_elsewhere` rather than granted a second seat.
 *  4. UNIQUE (session_id) is the backstop: even if a claim were somehow
 *     replayed concurrently, one session id can only ever own one row, and the
 *     conflicting insert lands on the ON CONFLICT refresh path instead of
 *     duplicating the seat.
 */
export async function claimSession(input: {
  discordId: string;
  sessionId: string;
  displayName?: string;
  ip?: string | null;
  country?: string | null;
  userAgent?: string | null;
  fingerprint?: string | null;
}): Promise<SessionClaim> {
  await ensureSessionTables();

  const { discordId, sessionId } = input;
  const memberId = await resolveMemberId(discordId, input.displayName);
  const seatExempt = isSeatExempt(discordId);

  return dbTransaction(async (tx) => {
    // (2) Serialize every claim for this one account. Namespaced so the hash
    // cannot collide with an advisory lock taken for some other purpose.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`member_session:${discordId}`}::text, 0::bigint))`
    );

    const now = Date.now();
    const [incumbent] = await tx
      .select({
        sessionId: memberSessions.sessionId,
        lastSeenAt: memberSessions.lastSeenAt,
        revokedAt: memberSessions.revokedAt,
      })
      .from(memberSessions)
      .where(
        and(
          eq(memberSessions.discordId, discordId),
          isNull(memberSessions.revokedAt)
        )
      )
      .orderBy(desc(memberSessions.lastSeenAt))
      .limit(1);

    const verdict = seatExempt
      ? ({ grant: true } as const)
      : decideClaim({
          now,
          incomingSessionId: sessionId,
          existing: incumbent
            ? {
                sessionId: incumbent.sessionId,
                lastSeenAt: incumbent.lastSeenAt.getTime(),
                revokedAt: incumbent.revokedAt
                  ? incumbent.revokedAt.getTime()
                  : null,
              }
            : null,
          idleMs: SESSION_IDLE_MS,
        });

    if (!verdict.grant) {
      return {
        ok: false,
        reason: "active_elsewhere",
        activeSince: new Date(verdict.activeSince).toISOString(),
      };
    }

    // Only ever reached when nothing live is holding the seat, so this closes
    // out rows that stopped beating — never a session somebody is using.
    if (!seatExempt) {
      await tx
        .update(memberSessions)
        .set({ revokedAt: new Date(), revokeReason: "superseded" })
        .where(
          and(
            eq(memberSessions.discordId, discordId),
            isNull(memberSessions.revokedAt),
            ne(memberSessions.sessionId, sessionId)
          )
        );
    }

    await tx
      .insert(memberSessions)
      .values({
        memberId,
        discordId,
        sessionId,
        displayName: input.displayName ?? null,
        lastSeenAt: new Date(),
        ip: input.ip ?? null,
        country: input.country ?? null,
        userAgent: input.userAgent ?? null,
        fingerprint: input.fingerprint ?? null,
      })
      // Same session id claiming again is a refresh of its own seat: keep the
      // row, clear any revocation it is entitled to shed (the claim was
      // granted above), and refresh what we know about the device.
      .onConflictDoUpdate({
        target: memberSessions.sessionId,
        set: {
          memberId: memberId ?? undefined,
          lastSeenAt: new Date(),
          revokedAt: null,
          revokeReason: null,
          displayName: input.displayName ?? undefined,
          ip: input.ip ?? undefined,
          country: input.country ?? undefined,
          userAgent: input.userAgent ?? undefined,
          fingerprint: input.fingerprint ?? undefined,
        },
      });

    return { ok: true, sessionId };
  });
}

/**
 * Heartbeat. `current: false` means this session has been superseded (or
 * kicked, or signed out) and the client should stop and send the member back
 * to the gate.
 *
 * A sighting is appended ONLY when the ip / country / fingerprint differ from
 * the account's last one, so a member reading a lesson for an hour writes one
 * row, not sixty. The insert is a single conditional statement, so two
 * heartbeats arriving together cannot both decide "it changed" off a stale
 * read and write the same sighting twice.
 */
export async function touchSession(input: {
  discordId: string;
  sessionId: string;
  ip?: string | null;
  country?: string | null;
  userAgent?: string | null;
  fingerprint?: string | null;
}): Promise<{ current: boolean }> {
  await ensureSessionTables();

  const { discordId, sessionId } = input;
  const seen: Partial<typeof memberSessions.$inferInsert> = {
    lastSeenAt: new Date(),
  };
  // Only overwrite what this beat actually carried — a heartbeat without a
  // fingerprint must not erase the one we already have.
  if (input.ip != null) seen.ip = input.ip;
  if (input.country != null) seen.country = input.country;
  if (input.userAgent != null) seen.userAgent = input.userAgent;
  if (input.fingerprint != null) seen.fingerprint = input.fingerprint;

  const beaten = await db
    .update(memberSessions)
    .set(seen)
    .where(
      and(
        eq(memberSessions.discordId, discordId),
        eq(memberSessions.sessionId, sessionId),
        isNull(memberSessions.revokedAt)
      )
    )
    .returning({ sessionId: memberSessions.sessionId });

  if (beaten.length === 0) return { current: false };

  const ip = input.ip ?? null;
  const country = input.country ?? null;
  const fingerprint = input.fingerprint ?? null;
  await db.execute(sql`
    WITH previous AS (
      SELECT ip, country, fingerprint
        FROM member_session_sightings
       WHERE discord_id = ${discordId}::varchar(32)
       ORDER BY at DESC
       LIMIT 1
    )
    INSERT INTO member_session_sightings (discord_id, session_id, ip, country, fingerprint)
    SELECT ${discordId}::varchar(32), ${sessionId}::varchar(64),
           ${ip}::varchar(64), ${country}::varchar(2), ${fingerprint}::varchar(64)
     WHERE NOT EXISTS (
       SELECT 1 FROM previous
        WHERE previous.ip IS NOT DISTINCT FROM ${ip}::varchar(64)
          AND previous.country IS NOT DISTINCT FROM ${country}::varchar(2)
          AND previous.fingerprint IS NOT DISTINCT FROM ${fingerprint}::varchar(64)
     )
  `);

  return { current: true };
}

/**
 * Is this session still the one the account is using?
 *
 * Deliberately NOT gated on the idle window: the request being served IS
 * activity, and a member whose heartbeat was throttled by a background tab
 * must not be logged out mid-page. A session stops being current only when
 * something explicitly revoked it — signed out, admin kick, anomaly, or
 * superseded by a later claim once its seat had gone quiet.
 */
export async function isSessionCurrent(
  discordId: string,
  sessionId: string
): Promise<boolean> {
  await ensureSessionTables();

  const [row] = await db
    .select({ sessionId: memberSessions.sessionId })
    .from(memberSessions)
    .where(
      and(
        eq(memberSessions.discordId, discordId),
        eq(memberSessions.sessionId, sessionId),
        isNull(memberSessions.revokedAt)
      )
    )
    .limit(1);

  return Boolean(row);
}

/** The session holding the seat right now, or null when the seat is free. */
export async function getActiveSession(
  discordId: string
): Promise<MemberSession | null> {
  await ensureSessionTables();

  const [row] = await db
    .select(SESSION_COLUMNS)
    .from(memberSessions)
    .where(
      and(
        eq(memberSessions.discordId, discordId),
        isNull(memberSessions.revokedAt),
        gt(memberSessions.lastSeenAt, idleCutoff())
      )
    )
    .orderBy(desc(memberSessions.lastSeenAt))
    .limit(1);

  return row ? toMemberSession(row) : null;
}

/** Every session seen inside the idle window, newest first. Admin monitor. */
export async function listActiveSessions(): Promise<MemberSession[]> {
  await ensureSessionTables();

  const rows = await db
    .select(SESSION_COLUMNS)
    .from(memberSessions)
    .where(
      and(
        isNull(memberSessions.revokedAt),
        gt(memberSessions.lastSeenAt, idleCutoff())
      )
    )
    .orderBy(desc(memberSessions.lastSeenAt));

  return rows.map(toMemberSession);
}

/** Frees the seat. Returns how many rows were revoked. */
export async function revokeSessions(
  discordId: string,
  reason: SessionRevokeReason
): Promise<number> {
  await ensureSessionTables();

  const revoked = await db
    .update(memberSessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(memberSessions.discordId, discordId),
        isNull(memberSessions.revokedAt)
      )
    )
    .returning({ sessionId: memberSessions.sessionId });

  return revoked.length;
}

/** Recent heartbeat history for one account, newest first. */
export async function recentSightings(
  discordId: string,
  windowMs: number
): Promise<SessionSighting[]> {
  await ensureSessionTables();

  const since = new Date(Date.now() - Math.max(0, windowMs));
  const rows = await db
    .select({
      at: memberSessionSightings.at,
      ip: memberSessionSightings.ip,
      country: memberSessionSightings.country,
      fingerprint: memberSessionSightings.fingerprint,
    })
    .from(memberSessionSightings)
    .where(
      and(
        eq(memberSessionSightings.discordId, discordId),
        gt(memberSessionSightings.at, since)
      )
    )
    .orderBy(desc(memberSessionSightings.at));

  return rows.map((row) => ({
    at: row.at.toISOString(),
    ip: row.ip,
    country: row.country,
    fingerprint: row.fingerprint,
  }));
}
