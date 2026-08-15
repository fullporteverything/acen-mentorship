import "server-only";

export interface RoleCheckResult {
  member: boolean;
  /** True only when Discord could not provide an authoritative answer. */
  unavailable: boolean;
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
    return { member: false, unavailable: true };
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
      return { member: false, unavailable: true };
    }
    if (!response.ok) {
      // Bot-token mode: 401 (token invalid/rotated) and 403 (bot kicked from
      // the guild or missing the Server Members intent) are failures of OUR
      // credential — they say nothing about the user, so they must NOT be
      // read as an authoritative "not a member" (that misclassification
      // locked out members who hold the role). Only 404 — user genuinely not
      // in the guild — is authoritative here.
      if (!usingMemberToken && response.status !== 404) {
        return { member: false, unavailable: true };
      }
      return { member: false, unavailable: false };
    }

    const member = (await response.json()) as { roles?: unknown };
    return {
      member:
        Array.isArray(member.roles) && member.roles.includes(requiredRoleId),
      unavailable: false,
    };
  } catch {
    return { member: false, unavailable: true };
  }
}
