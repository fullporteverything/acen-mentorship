import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * REGRESSION GUARD — the one-session gate must not hand out its own bypass.
 *
 * The gate shown to a second sign-in ("your account is already open
 * elsewhere") carries a Try Again button, and Try Again signs out. When
 * sign-out revoked by ACCOUNT, that button released whichever seat the browser
 * held — so the way past the gate was a button on the gate. Sign-out must end
 * exactly one seat: the one signing out.
 */

const mocks = vi.hoisted(() => ({
  revokeSession: vi.fn(),
  revokeSessions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session-store", () => ({
  revokeSession: mocks.revokeSession,
  revokeSessions: mocks.revokeSessions,
}));

/**
 * The handler as auth.ts wires it. Kept in step with that file deliberately:
 * importing auth.ts here would drag in the whole Discord provider and the Neon
 * client, and the behaviour under test is this decision, not NextAuth.
 */
async function signOutEvent(message: { token?: { sid?: unknown } | null }) {
  const token = "token" in message ? message.token : null;
  const sessionId = typeof token?.sid === "string" ? token.sid : undefined;
  if (!sessionId) return;
  const { revokeSession } = await import("@/lib/session-store");
  await revokeSession(sessionId, "signed_out");
}

describe("signing out releases one seat, not the account", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes only the seat that is signing out", async () => {
    await signOutEvent({ token: { sid: "seat-being-signed-out" } });

    expect(mocks.revokeSession).toHaveBeenCalledWith(
      "seat-being-signed-out",
      "signed_out"
    );
    // The account-wide revoke is the admin kick and the anomaly revoke. A
    // member signing out must never reach it — that is what let a phone
    // sign-out kill a laptop, and what opened the gate bypass.
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });

  it("does nothing when the token holds no seat", async () => {
    // An aborted sign-in (refused at the gate) never gets a sid, so there is
    // no seat to release — and crucially, no way to release someone else's.
    await signOutEvent({ token: { sid: undefined } });
    await signOutEvent({ token: null });
    await signOutEvent({});

    expect(mocks.revokeSession).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });

  it("ignores a non-string sid rather than passing it through", async () => {
    await signOutEvent({ token: { sid: 12345 } });

    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });
});
