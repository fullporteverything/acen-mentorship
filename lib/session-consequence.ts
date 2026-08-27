import "server-only";

import { recordAuditEvent } from "./audit";
import { removeAccessRole } from "./discord-roles";
import { revokeSessions } from "./session-store";
import type { AnomalyVerdict } from "./session-types";

/**
 * SUITE 7 — WHAT HAPPENS WHEN AN ACCOUNT IS FLAGGED.
 *
 * The heartbeat handler scores; it deliberately does not act. Everything that
 * can cost a member access lives here instead, in one file somebody can read
 * end to end before arming it.
 *
 * ── THE DEFAULT IS TO DO NOTHING ────────────────────────────────────────────
 * Unless SESSION_ANOMALY_AUTOREVOKE is exactly "true", this records the flag
 * and stops. No session is revoked, no Discord role is touched, the member
 * notices nothing. That is not timidity — it is the only responsible starting
 * position for a heuristic that can be wrong:
 *
 *   - The signals are proxies. lib/session-anomaly.ts documents at length what
 *     each one cannot know.
 *   - The people it is aimed at are PAYING members. A wrong revocation takes
 *     away something someone bought, publicly, in a Discord their peers can
 *     see. A missed sharer costs a fraction of one subscription.
 *   - Those errors are not symmetric, so the thresholds should not be either.
 *
 * The intended path is: ship it off, let the flags accumulate in the audit log
 * and the admin panel, read them for a few weeks against accounts you can
 * verify by hand, and only then decide whether the scoring earns the right to
 * act on its own. Arming it on day one means finding out it was wrong by
 * refunding somebody.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * One flag per account per hour. Heartbeats arrive every 60 seconds, and a
 * genuinely odd account stays odd — without this, one flagged member would
 * write sixty audit rows an hour and bury every other event in the log.
 */
const FLAG_COOLDOWN_MS = 60 * 60 * 1000;

const globalCooldown = globalThis as unknown as {
  __suite7AnomalyFlags?: Map<string, number>;
};
const lastFlagged =
  globalCooldown.__suite7AnomalyFlags ??
  (globalCooldown.__suite7AnomalyFlags = new Map<string, number>());

export interface ConsequenceOutcome {
  /** True when this call actually recorded something (i.e. not cooled down). */
  recorded: boolean;
  /** Sessions ended. Always 0 while auto-revoke is disabled. */
  revoked: number;
  /** Whether the Discord access role was removed. */
  roleRemoved: boolean;
  /** Readable reason, safe to log. */
  reason: string;
}

function autoRevokeArmed(): boolean {
  return process.env.SESSION_ANOMALY_AUTOREVOKE === "true";
}

/**
 * Records an anomaly flag and, only when explicitly armed, acts on it.
 *
 * Never throws. It is called from the heartbeat path, where an exception would
 * cost the member their seat — the exact outcome this module exists to avoid
 * inflicting by accident.
 */
export async function applyAnomalyConsequence(input: {
  discordId: string;
  verdict: AnomalyVerdict;
}): Promise<ConsequenceOutcome> {
  const { discordId, verdict } = input;

  const now = Date.now();
  const previous = lastFlagged.get(discordId);
  if (previous !== undefined && now - previous < FLAG_COOLDOWN_MS) {
    return {
      recorded: false,
      revoked: 0,
      roleRemoved: false,
      reason: "cooled_down",
    };
  }
  lastFlagged.set(discordId, now);
  // The map is keyed by member and bounded by membership size, but a long
  // uptime with a large roster still shouldn't grow it forever.
  if (lastFlagged.size > 5_000) {
    for (const [key, at] of lastFlagged) {
      if (now - at >= FLAG_COOLDOWN_MS) lastFlagged.delete(key);
    }
  }

  const armed = autoRevokeArmed();
  let revoked = 0;
  let roleRemoved = false;
  let reason = armed ? "armed" : "disabled";

  if (armed) {
    try {
      revoked = await revokeSessions(discordId, "anomaly");
    } catch (error) {
      console.error("anomaly consequence: revokeSessions failed", error);
      reason = "revoke_failed";
    }
    // removeAccessRole carries its own SESSION_ANOMALY_AUTOREVOKE gate and
    // never throws; the redundancy is intentional, since this is the call that
    // is visible to the member and to everyone else in the server.
    const role = await removeAccessRole(discordId, `Suite 7 anomaly: ${verdict.summary}`);
    roleRemoved = role.applied;
    if (!role.applied) reason = `role_not_removed:${role.reason}`;
  }

  try {
    await recordAuditEvent({
      action: armed ? "session.anomaly_revoked" : "session.anomaly_flagged",
      resourceType: "member_session",
      resourceId: discordId,
      memberDiscordId: discordId,
      details: {
        score: verdict.score,
        signals: verdict.signals,
        summary: verdict.summary,
        autoRevokeArmed: armed,
        revoked,
        roleRemoved,
        reason,
      },
    });
  } catch (error) {
    // The audit write is the part that matters most when disarmed, so a
    // failure here is worth shouting about — but still not worth throwing,
    // because the caller is a heartbeat.
    console.error("anomaly consequence: audit write failed", error);
  }

  return { recorded: true, revoked, roleRemoved, reason };
}
