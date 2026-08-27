/**
 * SUITE 7 — SESSION RESET TOKEN.
 *
 * Proof that the bearer completed Discord OAuth for a specific account, moments
 * ago. It exists for exactly one button: "sign out everywhere", offered on the
 * gate a member hits when their account is already open somewhere else.
 *
 * ── WHY A TOKEN AND NOT JUST A BUTTON ───────────────────────────────────────
 * That gate is shown to somebody who is NOT signed in — the whole point is that
 * their sign-in was refused. So the endpoint behind the button cannot use the
 * session to decide who is asking, and an endpoint that took a Discord id and
 * killed its sessions would let anyone who knows a member's id log them out of
 * a lesson, over and over, forever. A public denial-of-service button.
 *
 * The one thing we DO know at that moment is that Discord just authenticated
 * this person for this account: `signIn` only reaches the refusal after the
 * OAuth exchange and the role check both succeed. This captures that fact in a
 * signed, short-lived, account-bound token, so the endpoint can verify it
 * without a session.
 *
 * ── PROPERTIES ──────────────────────────────────────────────────────────────
 *  - Signed with AUTH_SECRET (HMAC-SHA-256). Unforgeable without the secret.
 *  - Bound to ONE Discord id — it can only ever clear that account.
 *  - Expires in five minutes. Long enough to read the page and click; short
 *    enough that a token left in browser history is worthless later.
 *  - Verified in constant time, so the comparison cannot be used as an oracle.
 *  - Replaying it inside its window only re-clears the bearer's own sessions,
 *    which they could do by clicking again anyway. Nothing to gain.
 *
 * Web Crypto rather than node:crypto so this is usable from any runtime the
 * auth callbacks might end up in.
 */

const TOKEN_TTL_MS = 5 * 60 * 1000;
const VERSION = "s7r1";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return base64url(new Uint8Array(signature));
}

/** Length-safe, timing-safe string comparison. */
function equals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // Compare a fixed number of bytes regardless of length, and fold the length
  // difference into the result, so neither content nor length leaks by timing.
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Mints a reset token. Returns null when there is no secret configured — in
 * which case the button is never offered, which is the correct failure
 * direction: no secret means no way to verify, so no way to act.
 */
export async function mintResetToken(
  discordId: string,
  secret: string | undefined,
  now = Date.now()
): Promise<string | null> {
  if (!secret || !/^\d{17,20}$/.test(discordId)) return null;
  const payload = `${VERSION}.${discordId}.${now + TOKEN_TTL_MS}`;
  const signature = await sign(payload, secret);
  return `${base64url(new TextEncoder().encode(payload))}.${signature}`;
}

export type ResetTokenResult =
  | { ok: true; discordId: string }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" | "unconfigured" };

/**
 * Verifies a reset token and returns the account it authorises.
 *
 * Every failure is reported the same way to the caller's user — the reasons
 * exist for logs, not for the response body. Telling an unauthenticated caller
 * whether a token expired or was forged tells them how close they got.
 */
export async function verifyResetToken(
  token: string,
  secret: string | undefined,
  now = Date.now()
): Promise<ResetTokenResult> {
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (typeof token !== "string" || token.length > 512) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  const payloadBytes = fromBase64url(parts[0]);
  if (!payloadBytes) return { ok: false, reason: "malformed" };
  const payload = new TextDecoder().decode(payloadBytes);

  // The signature is checked BEFORE the payload is trusted for anything,
  // including its expiry.
  const expected = await sign(payload, secret);
  if (!equals(expected, parts[1])) return { ok: false, reason: "bad_signature" };

  const [version, discordId, expiresAt] = payload.split(".");
  if (version !== VERSION || !/^\d{17,20}$/.test(discordId ?? "")) {
    return { ok: false, reason: "malformed" };
  }
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry)) return { ok: false, reason: "malformed" };
  if (now >= expiry) return { ok: false, reason: "expired" };

  return { ok: true, discordId };
}
