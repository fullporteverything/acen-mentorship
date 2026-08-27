import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyDiscordMembership: vi.fn(),
  isSessionCurrent: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/discord-membership", () => ({
  verifyDiscordMembership: mocks.verifyDiscordMembership,
}));
vi.mock("@/lib/session-store", () => ({
  isSessionCurrent: mocks.isSessionCurrent,
}));
vi.mock("server-only", () => ({}));

import {
  AuthorizationError,
  SessionExpiredError,
  SessionSupersededError,
  authorizationErrorResponse,
  requireAdmin,
  requireMember,
  rethrowTemporaryAuthorizationError,
} from "@/lib/authz";

describe("centralized authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISCORD_ID = "admin-discord-id";
    process.env.DISCORD_BOT_TOKEN = "configured-bot-token";
    mocks.verifyDiscordMembership.mockResolvedValue({
      member: true,
      unavailable: false,
    });
    mocks.isSessionCurrent.mockResolvedValue(true);
  });

  it("rejects an anonymous request before it reaches protected data", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(requireMember()).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.verifyDiscordMembership).not.toHaveBeenCalled();
  });

  it("unions the owner main and preview-alt IDs with a legacy account id", async () => {
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test",
        id: "next-auth-id",
        discordId: "353994234983874570",
        name: "Member",
      },
    });

    await expect(requireMember()).resolves.toEqual({
      discordId: "353994234983874570",
      ownerIds: ["353994234983874570", "1417619259252801546", "next-auth-id"],
      isAdmin: false,
      name: "Member",
    });
  });

  it("unions the preview-alt and owner-main IDs without widening ordinary members", async () => {
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test", id: "legacy-alt", discordId: "1417619259252801546" },
    });
    await expect(requireMember()).resolves.toMatchObject({
      ownerIds: ["1417619259252801546", "353994234983874570", "legacy-alt"],
    });

    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test", id: "legacy-ordinary", discordId: "ordinary-member" },
    });
    await expect(requireMember()).resolves.toMatchObject({
      ownerIds: ["ordinary-member", "legacy-ordinary"],
    });
  });

  it("preserves the authorization failure status in API responses", async () => {
    expect(authorizationErrorResponse(new AuthorizationError(503, "Discord unavailable")).status).toBe(503);
    expect(authorizationErrorResponse(new AuthorizationError(403, "Role removed")).status).toBe(403);
  });

  it("redirects every page auth failure to the login gate instead of crashing the render", () => {
    // The helper always throws NEXT_REDIRECT — an uncaught AuthorizationError
    // in a server component produced an unstyled 500 ("This page couldn't
    // load" in Chrome). CrackedGate on / explains the failure instead.
    expect(() => rethrowTemporaryAuthorizationError(new AuthorizationError(503, "Discord unavailable"))).toThrow("NEXT_REDIRECT");
    expect(() => rethrowTemporaryAuthorizationError(new AuthorizationError(403, "Role removed"))).toThrow("NEXT_REDIRECT");
    expect(() => rethrowTemporaryAuthorizationError(new AuthorizationError(401, "No session"))).toThrow("NEXT_REDIRECT");
    expect(() => rethrowTemporaryAuthorizationError(new Error("blob down"))).toThrow("NEXT_REDIRECT");
  });

  it("allows only the configured admin after membership verification", async () => {
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test", id: "next-auth-admin", discordId: "admin-discord-id" },
    });

    await expect(requireAdmin()).resolves.toMatchObject({
      discordId: "admin-discord-id",
      isAdmin: true,
    });

    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test", id: "next-auth-member", discordId: "member-discord-id" },
    });
    await expect(requireAdmin()).rejects.toMatchObject({
      status: 403,
    });
  });

  it("fails closed when a member's required Discord role has been removed", async () => {
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test", id: "next-auth-id", discordId: "removed-role-id" },
    });
    mocks.verifyDiscordMembership.mockResolvedValue({
      member: false,
      unavailable: false,
    });

    await expect(requireMember()).rejects.toMatchObject({
      status: 403,
    });
  });

  it("fails closed when Discord membership revalidation is temporarily unavailable", async () => {
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test", id: "next-auth-id", discordId: "discord-outage-id" },
    });
    mocks.verifyDiscordMembership.mockResolvedValue({
      member: false,
      unavailable: true,
    });

    await expect(requireMember()).rejects.toMatchObject({
      status: 503,
    });
  });

  it("uses a recent signed login proof when revalidation is unavailable (no bot token)", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test",
        id: "next-auth-id",
        discordId: "login-verified-id",
        memberVerifiedAt: Date.now() - 60_000,
      },
    });
    mocks.verifyDiscordMembership.mockResolvedValue({ member: false, unavailable: true });

    await expect(requireMember()).resolves.toMatchObject({ discordId: "login-verified-id" });
  });

  it("uses a recent signed login proof when the configured bot check is unavailable", async () => {
    // A present-but-broken bot token (rotated, kicked bot, missing intent)
    // must not be stricter than no bot token at all — sign-in already
    // verified the role with the user's own OAuth token.
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test",
        id: "next-auth-id",
        discordId: "bot-outage-id",
        memberVerifiedAt: Date.now() - 60_000,
      },
    });
    mocks.verifyDiscordMembership.mockResolvedValue({ member: false, unavailable: true });

    await expect(requireMember()).resolves.toMatchObject({ discordId: "bot-outage-id" });
  });

  it("rejects an expired login proof when bot revalidation is not configured", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    mocks.auth.mockResolvedValue({
      user: { sessionId: "seat-test",
        id: "next-auth-id",
        discordId: "expired-proof-id",
        memberVerifiedAt: Date.now() - 25 * 60 * 60 * 1000,
      },
    });
    mocks.verifyDiscordMembership.mockResolvedValue({ member: false, unavailable: true });

    await expect(requireMember()).rejects.toMatchObject({ status: 503 });
  });
});

describe("one live seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISCORD_ID = "admin-discord-id";
    process.env.DISCORD_BOT_TOKEN = "configured-bot-token";
    mocks.verifyDiscordMembership.mockResolvedValue({
      member: true,
      unavailable: false,
    });
    mocks.isSessionCurrent.mockResolvedValue(true);
  });

  it("refuses a token minted before seat tracking rather than letting it ride", async () => {
    // No sessionId: there is no seat to enforce against, so the one-seat rule
    // would simply not apply to this member for the life of the token. They
    // sign in again instead.
    mocks.auth.mockResolvedValue({
      user: { id: "old-token", discordId: "member-discord-id" },
    });

    await expect(requireMember()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("refuses a seat that is no longer the account's current session", async () => {
    mocks.isSessionCurrent.mockResolvedValue(false);
    mocks.auth.mockResolvedValue({
      user: {
        sessionId: "kicked-seat",
        id: "next-auth-member",
        discordId: "member-discord-id",
      },
    });

    await expect(requireMember()).rejects.toBeInstanceOf(SessionSupersededError);
  });

  it("keeps the member in when the registry cannot be reached", async () => {
    // FAILS OPEN. A database hiccup must never look like a kick — that would
    // sign out the whole membership over an infrastructure blip.
    mocks.isSessionCurrent.mockRejectedValue(new Error("neon unreachable"));
    mocks.auth.mockResolvedValue({
      user: {
        sessionId: "seat-during-outage",
        id: "next-auth-member",
        discordId: "member-discord-id",
      },
    });

    await expect(requireMember()).resolves.toMatchObject({
      discordId: "member-discord-id",
    });
  });
});
