/**
 * SUITE 7 — SINGLE-SESSION CONTRACT.
 *
 * Shared types for one-session-per-account enforcement, the admin session
 * monitor, and the anomaly watch. Deliberately free of `server-only` and of
 * any database import so the client components can read the constants too.
 *
 * The rule: an account may hold ONE live session. A second sign-in is REFUSED
 * (the newcomer is told to close the other one) rather than silently booting
 * the first — a stolen or shared login should not be able to evict the real
 * member just by logging in.
 *
 * "Live" is defined by a heartbeat, not by the JWT. A session that stops
 * beating for SESSION_IDLE_MS is treated as gone, so closing a laptop lid
 * releases the seat on its own and nobody has to wait on an admin.
 */

/** Client beat interval. */
export const SESSION_HEARTBEAT_MS = 60_000;

/**
 * No heartbeat for this long and the seat is free again.
 *
 * TEN beats, not three. Three was tuned for a tab in the foreground and did
 * not survive contact with Chrome: a hidden tab has its timers throttled, and
 * after a few minutes Chrome may freeze or discard it outright. A member who
 * leaves the lesson in a background tab then stops beating through no fault of
 * their own — and at three minutes that quietly released their seat, so a
 * second sign-in sailed straight through the gate that was supposed to stop
 * it. Holding the seat longer makes the one-session rule STRICTER, not looser.
 *
 * It costs the legitimate holder nothing: their own seat is theirs regardless
 * of how long it has been quiet (isSessionCurrent does not check the idle
 * window — the request being served is itself proof of life). The only price
 * is that switching devices without signing out means a wait, and there are
 * two immediate outs: signing out releases that one seat at once, and the
 * admin kick is instant.
 */
export const SESSION_IDLE_MS = 10 * SESSION_HEARTBEAT_MS;

/** Why a session stopped being the current one. Persisted for the audit. */
export type SessionRevokeReason =
  | "admin_kick"
  | "anomaly"
  | "signed_out"
  | "superseded";

export interface MemberSession {
  sessionId: string;
  discordId: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  /** ISO-3166 alpha-2 from the IP lookup, when available. */
  country: string | null;
  userAgent: string | null;
  /** Opaque browser/device hash. A SIGNAL, never an identity. */
  fingerprint: string | null;
  revokedAt: string | null;
  revokeReason: SessionRevokeReason | null;
}

/** Result of trying to take the single seat. */
export type SessionClaim =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      reason: "active_elsewhere";
      /** When the session already holding the seat was last seen. */
      activeSince: string;
    };

/**
 * Anomaly signals. Each is independently weak — a phone hopping between wifi
 * and cellular trips `many_ips` all day long — so a verdict must never rest on
 * one of them alone. See lib/session-anomaly.ts for the scoring.
 */
export type AnomalySignal =
  | "impossible_travel"
  | "many_ips"
  | "many_devices"
  | "datacenter_ip"
  /**
   * Far more sign-ins in a day than this account normally makes. Only
   * meaningful against a warm baseline (lib/session-baseline).
   *
   * This one exists BECAUSE of one-seat enforcement. Once concurrent sharing
   * is refused, sharing does not stop — it goes SERIAL: two people taking
   * turns, each signing in after the other's seat goes idle. That leaves no
   * co-occurrence for the other signals to see, and looks instead like an
   * account that suddenly signs in six times a day instead of once.
   */
  | "session_churn";

export interface AnomalyVerdict {
  /** 0..100. Higher is more suspicious. */
  score: number;
  signals: AnomalySignal[];
  /** True once the score clears ANOMALY_REVOKE_SCORE. */
  actionable: boolean;
  /** One plain sentence for the audit log and the admin panel. */
  summary: string;
}

/** Score at or above which a session is revoked and the account flagged. */
export const ANOMALY_REVOKE_SCORE = 70;

/** One heartbeat's worth of where-and-what, kept for anomaly scoring. */
export interface SessionSighting {
  at: string;
  ip: string | null;
  country: string | null;
  fingerprint: string | null;
  /** Which seat produced this beat. Drives the session-churn baseline. */
  sessionId: string | null;
}
