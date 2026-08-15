import "server-only";

export interface RoleCheckResult {
  member: boolean;
  /** True only when Discord could not provide an authoritative answer. */
  unavailable: boolean;
  /**
   * Why a non-member was refused, when Discord told us enough to say. Purely
   * additive — `member` / `unavailable` keep their existing meaning, and
   * callers that don't care (authz.ts) can ignore this entirely. Used by the
   * sign-in callback to send the visitor to a denial page that names the
   * actual problem instead of a flat "access denied".
   */
  reason?: "not_in_server" | "role_missing" | "unavailable";
}

const DISCORD_API_TIMEOUT_MS = 5_000;

/**
 * Checks the configured guild role using a short-lived OAuth token at sign-in
 * or the application bot token for later server-side revalidation.
 */
export async function verifyDiscordMembership(
  discordId: string,
  accessToken?: string
): Promise<RoleCheckResult> {
  const guildId = process.env.DISCORD_GUILD_ID;
  const requiredRoleId = process.env.DISCORD_REQUIRED_ROLE_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!guildId || !requiredRoleId || (!accessToken && !botToken)) {
    return { member: false, unavailable: true, reason: "unavailable" };
  }

  const usingMemberToken = Boolean(accessToken);
  const url = usingMemberToken
    ? `https://discord.com/api/users/@me/guilds/${guildId}/member`
    : `https://discord.com/api/guilds/${guildId}/members/${encodeURIComponent(discordId)}`;
  const authorization = usingMemberToken
    ? `Bearer ${accessToken}`
    : `Bot ${botToken}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS),
    });

    if (response.status === 429 || response.status >= 500) {
      return { member: false, unavailable: true, reason: "unavailable" };
    }
    if (!response.ok) {
      // Bot-token mode: 401 (token invalid/rotated) and 403 (bot kicked from
      // the guild or missing the Server Members intent) are failures of OUR
      // credential — they say nothing about the user, so they must NOT be
      // read as an authoritative "not a member" (that misclassification
      // locked out members who hold the role). Only 404 — user genuinely not
      // in the guild — is authoritative here.
      if (!usingMemberToken && response.status !== 404) {
        return { member: false, unavailable: true, reason: "unavailable" };
      }
      // Authoritative "this Discord account is not in the guild" — on the
      // Bearer path any non-ok that got here means the member endpoint found
      // no guild membership for the token's owner.
      return { member: false, unavailable: false, reason: "not_in_server" };
    }

    const member = (await response.json()) as { roles?: unknown };
    const roles = Array.isArray(member.roles) ? member.roles : null;
    if (roles?.includes(requiredRoleId)) {
      return { member: true, unavailable: false };
    }
    return {
      member: false,
      unavailable: false,
      // They ARE in the guild (Discord returned a member object) — the
      // required role just isn't on the account. A malformed payload with no
      // roles array stays reasonless so callers fall back to generic copy.
      ...(roles ? { reason: "role_missing" as const } : {}),
    };
  } catch {
    return { member: false, unavailable: true, reason: "unavailable" };
  }
}
