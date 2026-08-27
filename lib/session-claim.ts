/**
 * SUITE 7 — the single-seat verdict, extracted from the database.
 *
 * This is the one rule that can stop a paying member getting in, so it lives
 * here as a pure function: no `server-only`, no drizzle, no clock of its own.
 * lib/session-store.ts supplies the row and the time and performs the write;
 * everything that decides is in `decideClaim`, where it can be unit-tested in
 * CI (which has no database — see lib/session-claim.test.ts).
 *
 * The rule, restated: an account holds ONE live seat. A second sign-in is
 * REFUSED rather than granted — a shared or stolen login must not be able to
 * evict the real member simply by logging in. "Live" means a heartbeat inside
 * the idle window, never the mere existence of a JWT, so a closed laptop frees
 * the seat by itself.
 */

/** The row currently holding (or last holding) the account's seat. */
export interface ExistingClaim {
  sessionId: string;
  /** Epoch ms of the last heartbeat. */
  lastSeenAt: number;
  /** Epoch ms the session was revoked, or null while it still stands. */
  revokedAt: number | null;
}

export interface ClaimInput {
  now: number;
  incomingSessionId: string;
  existing: ExistingClaim | null;
  idleMs: number;
}

export type ClaimDecision =
  | { grant: true }
  /** Refused. `activeSince` is the incumbent's last heartbeat, for the copy. */
  | { grant: false; activeSince: number };

/**
 * True once a session has missed the whole idle window. Boundary is
 * deliberate: at EXACTLY `idleMs` the seat is free. A heartbeat in the future
 * (clock skew between instances) yields a negative age and counts as live —
 * skew must never hand a second party the seat.
 */
export function isStale(now: number, lastSeenAt: number, idleMs: number): boolean {
  return now - lastSeenAt >= idleMs;
}

/**
 * Decide whether `incomingSessionId` may take the account's seat.
 *
 * Grants when:
 *  - nobody holds the seat (no row at all);
 *  - the holder was explicitly revoked (signed out, kicked, anomaly);
 *  - the holder stopped beating for the whole idle window;
 *  - the holder IS this session — a token refresh or a repeated claim is the
 *    same seat, not a second one, and must never be self-refused.
 *
 * Refuses otherwise, reporting when the incumbent was last seen so the gate
 * can tell the newcomer how long the other session has left.
 */
export function decideClaim(input: ClaimInput): ClaimDecision {
  const { now, incomingSessionId, existing, idleMs } = input;

  if (!existing) return { grant: true };
  if (existing.revokedAt !== null) return { grant: true };
  // A refresh of the session that already holds the seat.
  if (existing.sessionId === incomingSessionId) return { grant: true };
  if (isStale(now, existing.lastSeenAt, idleMs)) return { grant: true };

  return { grant: false, activeSince: existing.lastSeenAt };
}
