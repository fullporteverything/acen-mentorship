export interface CaptureLog {
  timestamp: string;
  ip?: string;
  userAgent?: string;
}

export interface SecurityMember {
  discordId: string;
  discordUsername: string;
  strikes: number;
  acknowledgedStrikes: number;
  locked: boolean;
  updatedAt: string;
  attempts: CaptureLog[];
}

export function normalizeSecurityMember(
  raw: unknown,
  discordId: string,
  discordUsername = "Discord member"
): SecurityMember {
  const value = raw && typeof raw === "object" ? raw as Partial<SecurityMember> : {};
  const strikes = Math.min(3, Math.max(0, Number.isFinite(value.strikes) ? Number(value.strikes) : 0));
  const acknowledgedStrikes = Math.min(
    strikes,
    Math.max(0, Number.isFinite(value.acknowledgedStrikes) ? Number(value.acknowledgedStrikes) : 0)
  );
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter((attempt): attempt is CaptureLog =>
        Boolean(attempt && typeof attempt.timestamp === "string")
      ).slice(-100)
    : [];

  return {
    discordId,
    discordUsername:
      typeof value.discordUsername === "string" && value.discordUsername.trim()
        ? value.discordUsername.trim().slice(0, 100)
        : discordUsername.trim().slice(0, 100) || "Discord member",
    strikes,
    acknowledgedStrikes,
    locked: strikes >= 3 || value.locked === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    attempts,
  };
}

export function applyCaptureAttempt(
  member: SecurityMember,
  attempt: CaptureLog,
  discordUsername?: string
): SecurityMember {
  const strikes = Math.min(3, member.strikes + 1);
  return {
    ...member,
    discordUsername: discordUsername?.trim().slice(0, 100) || member.discordUsername,
    strikes,
    locked: strikes >= 3,
    updatedAt: attempt.timestamp,
    attempts: [...member.attempts, attempt].slice(-100),
  };
}
