type MembershipToken = Record<string, unknown> & {
  accessToken?: unknown;
  iat?: unknown;
  memberVerifiedAt?: unknown;
};

/**
 * Converts sessions issued by the previous role-verified login flow to the
 * timestamp-only proof. The sensitive OAuth token is removed immediately.
 */
export function upgradeLegacyMembershipProof<T extends MembershipToken>(
  token: T,
  now = Date.now()
): T {
  const issuedAt =
    typeof token.iat === "number" &&
    Number.isFinite(token.iat) &&
    token.iat >= 0 &&
    token.iat * 1000 <= now
      ? token.iat * 1000
      : undefined;
  if (
    typeof token.memberVerifiedAt !== "number" &&
    typeof token.accessToken === "string" &&
    token.accessToken.length > 0 &&
    issuedAt !== undefined
  ) {
    token.memberVerifiedAt = issuedAt;
  }
  delete token.accessToken;
  return token;
}
