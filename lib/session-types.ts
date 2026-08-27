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
 * No heartbeat for this long and the seat is free again. Three missed beats —
 * generous enough to survive a tab suspend, a tunnel hiccup or a sleeping
 * phone, short enough that a member who closes the laptop can sign in from
 * the desktop a few minutes later without calling for help.
 */
export const SESSION_IDLE_MS = 3 * SESSION_HEARTBEAT_MS;

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
  | "datacenter_ip";

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
}
