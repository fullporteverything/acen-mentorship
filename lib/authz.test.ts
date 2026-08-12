import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyDiscordMembership: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/discord-membership", () => ({
  verifyDiscordMembership: mocks.verifyDiscordMembership,
}));
vi.mock("server-only", () => ({}));

import {
  AuthorizationError,
  authorizationErrorResponse,
  requireAdmin,
  requireMember,
  rethrowTemporaryAuthorizationError,
} from "@/lib/authz";

describe("centralized authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISCORD_ID = "admin-discord-id";
    mocks.verifyDiscordMembership.mockResolvedValue({
      member: true,
      unavailable: false,
    });
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
      user: {
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
      user: { id: "legacy-alt", discordId: "1417619259252801546" },
    });
    await expect(requireMember()).resolves.toMatchObject({
      ownerIds: ["1417619259252801546", "353994234983874570", "legacy-alt"],
    });

    mocks.auth.mockResolvedValue({
      user: { id: "legacy-ordinary", discordId: "ordinary-member" },
    });
    await expect(requireMember()).resolves.toMatchObject({
      ownerIds: ["ordinary-member", "legacy-ordinary"],
    });
  });

  it("preserves the authorization failure status in API responses", async () => {
    expect(authorizationErrorResponse(new AuthorizationError(503, "Discord unavailable")).status).toBe(503);
    expect(authorizationErrorResponse(new AuthorizationError(403, "Role removed")).status).toBe(403);
  });

  it("does not redirect a page when membership verification is temporarily unavailable", () => {
    expect(() => rethrowTemporaryAuthorizationError(new AuthorizationError(503, "Discord unavailable"))).toThrow("Discord unavailable");
    expect(rethrowTemporaryAuthorizationError(new AuthorizationError(403, "Role removed"))).toBeNull();
  });

  it("allows only the configured admin after membership verification", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "next-auth-admin", discordId: "admin-discord-id" },
    });

    await expect(requireAdmin()).resolves.toMatchObject({
      discordId: "admin-discord-id",
      isAdmin: true,
    });

    mocks.auth.mockResolvedValue({
      user: { id: "next-auth-member", discordId: "member-discord-id" },
    });
    await expect(requireAdmin()).rejects.toMatchObject({
      status: 403,
    });
  });

  it("fails closed when a member's required Discord role has been removed", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "next-auth-id", discordId: "removed-role-id" },
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
      user: { id: "next-auth-id", discordId: "discord-outage-id" },
    });
    mocks.verifyDiscordMembership.mockResolvedValue({
      member: false,
      unavailable: true,
    });

    await expect(requireMember()).rejects.toMatchObject({
      status: 503,
    });
  });
});
