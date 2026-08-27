import "server-only";

/**
 * Removes the mentorship access role from a Discord account.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS OFF BY DEFAULT
 *
 * Stripping the access role is destructive, immediately visible to the member
 * (channels vanish from their sidebar), and driven here by a HEURISTIC — the
 * anomaly score in lib/session-anomaly.ts, built out of weak proxies like IPs
 * and browser fingerprints. A wrong call takes something away from someone who
 * paid for it, and the member finds out before we do.
 *
 * So the default posture is RECORD AND ALERT, not act. Nothing happens unless
 * SESSION_ANOMALY_AUTOREVOKE is exactly "true". The intent is that the owner
 * watches the flags land in the admin panel for a while, satisfies himself
 * that the ones firing are real, and only then arms this deliberately — not on
 * day one, and never as a side effect of some other deploy.
 *
 * WHY IT NEVER THROWS
 *
 * This is called from the tail end of a heartbeat or an admin action. A failure
 * to strip a role is not a reason to fail whatever called us, so every path —
 * including a broken bot token and a network timeout — returns
 * { applied: false, reason } with a reason a human can read in the audit log.
 *
 * WHY A 401/403 IS NOT "DONE"
 *
 * Carried over from the bug fixed in lib/discord-membership.ts: a 401 or 403
 * is a failure of OUR credential (token rotated, bot kicked, Manage Roles
 * missing, role above the bot in the hierarchy). It says nothing about the
 * member and it certainly does not mean the role came off. It is reported as
 * the credential problem it is, with applied:false, so nobody reads the audit
 * log later and believes an enforcement happened that did not.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Fetcher = typeof fetch;

/** Matches lib/discord-membership.ts — same API, same patience. */
const DISCORD_API_TIMEOUT_MS = 5_000;

/** Discord truncates X-Audit-Log-Reason past 512 characters. */
const AUDIT_REASON_MAX = 512;

/**
 * Discord expects this header URL-encoded, and a raw header value must not
 * carry newlines or non-latin-1 bytes anyway.
 */
function auditHeaderValue(reason: string): string {
  const text = `Session anomaly auto-revoke: ${reason || "no reason given"}`;
  return encodeURIComponent(text).slice(0, AUDIT_REASON_MAX);
}

export async function removeAccessRole(
  discordId: string,
  reason: string,
  fetcher: Fetcher = fetch
): Promise<{ applied: boolean; reason: string }> {
  // The gate comes first, before ANY env read or network call, so that with
  // the flag off this function cannot touch Discord even if it is buggy.
  if (process.env.SESSION_ANOMALY_AUTOREVOKE !== "true") {
    return { applied: false, reason: "disabled" };
  }

  if (!discordId?.trim()) {
    return { applied: false, reason: "no Discord ID was supplied; nothing was changed" };
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  const roleId = process.env.DISCORD_REQUIRED_ROLE_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !roleId || !botToken) {
    return {
      applied: false,
      reason:
        "not configured: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID and DISCORD_REQUIRED_ROLE_ID must all be set; nothing was changed",
    };
  }

  const url =
    `https://discord.com/api/guilds/${encodeURIComponent(guildId)}` +
    `/members/${encodeURIComponent(discordId.trim())}` +
    `/roles/${encodeURIComponent(roleId)}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${botToken}`,
        // Puts the action in Discord's own audit log, so the member (and the
        // owner) can see who did what and why without our logs.
        "X-Audit-Log-Reason": auditHeaderValue(reason),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return {
        applied: false,
        reason: `Discord did not answer within ${DISCORD_API_TIMEOUT_MS}ms; the role was NOT removed`,
      };
    }
    return {
      applied: false,
      reason: "could not reach Discord; the role was NOT removed",
    };
  }

  // 204 is the documented success. Any other 2xx is accepted as success too
  // rather than being reported as a failure the owner would chase.
  if (response.ok) {
    return { applied: true, reason: "role removed" };
  }

  switch (response.status) {
    case 401:
    case 403:
      // OUR problem, not the member's. Never reported as an enforcement.
      return {
        applied: false,
        reason: `Discord rejected our bot credential (${response.status}) — token invalid, bot missing Manage Roles, or the role sits above the bot; the role was NOT removed`,
      };
    case 404:
      // Ambiguous by design: could be an unknown member, an unknown role, or a
      // role already gone. Not claimed as an enforcement either way.
      return {
        applied: false,
        reason:
          "Discord returned 404 — the member, the guild or the role was not found; nothing was changed",
      };
    case 429:
      return {
        applied: false,
        reason: "Discord rate-limited the request (429); the role was NOT removed",
      };
    default:
      if (response.status >= 500) {
        return {
          applied: false,
          reason: `Discord is having trouble (${response.status}); the role was NOT removed`,
        };
      }
      return {
        applied: false,
        reason: `Discord returned an unexpected ${response.status}; the role was NOT removed`,
      };
  }
}
