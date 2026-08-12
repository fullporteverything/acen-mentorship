import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyDiscordMembership } from "@/lib/discord-membership";

describe("Discord membership verification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a member whose required Discord role is no longer present", async () => {
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_REQUIRED_ROLE_ID", "role-1");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ roles: ["different-role"] }), { status: 200 })
      )
    );

    await expect(verifyDiscordMembership("member-1")).resolves.toEqual({
      member: false,
      unavailable: false,
    });
  });

  it("reports a temporary Discord failure so callers can deny access safely", async () => {
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_REQUIRED_ROLE_ID", "role-1");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(verifyDiscordMembership("member-1")).resolves.toEqual({
      member: false,
      unavailable: true,
    });
  });
});
