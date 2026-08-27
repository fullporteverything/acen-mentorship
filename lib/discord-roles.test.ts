import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { removeAccessRole } from "@/lib/discord-roles";

function armed(): void {
  vi.stubEnv("SESSION_ANOMALY_AUTOREVOKE", "true");
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  vi.stubEnv("DISCORD_REQUIRED_ROLE_ID", "role-1");
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
}

describe("removeAccessRole — the gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing, and makes no HTTP call at all, when the flag is unset", async () => {
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_REQUIRED_ROLE_ID", "role-1");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const fetcher = vi.fn();

    await expect(removeAccessRole("member-1", "anomaly", fetcher)).resolves.toEqual({
      applied: false,
      reason: "disabled",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stays disabled for any value that is not exactly \"true\"", async () => {
    const fetcher = vi.fn();
    for (const value of ["false", "1", "yes", "TRUE", "true ", ""]) {
      vi.stubEnv("SESSION_ANOMALY_AUTOREVOKE", value);
      vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
      vi.stubEnv("DISCORD_REQUIRED_ROLE_ID", "role-1");
      vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");

      await expect(removeAccessRole("member-1", "anomaly", fetcher)).resolves.toEqual({
        applied: false,
        reason: "disabled",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("removeAccessRole — armed", () => {
  beforeEach(() => {
    armed();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("removes the role and reports success on 204", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      removeAccessRole("member-1", "4 devices in 3 countries", fetcher)
    ).resolves.toEqual({ applied: true, reason: "role removed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("calls the documented endpoint over HTTPS with the bot token and an audit reason", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await removeAccessRole("member-1", "4 devices in 3 countries", fetcher);

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/guilds/guild-1/members/member-1/roles/role-1");
    expect(init.method).toBe("DELETE");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bot bot-token");
    expect(decodeURIComponent(headers["X-Audit-Log-Reason"])).toContain(
      "4 devices in 3 countries"
    );
    expect(headers["X-Audit-Log-Reason"].length).toBeLessThanOrEqual(512);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the audit reason header inside Discord's limit and safe to send", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await removeAccessRole("member-1", "ünsafe \n injected\r header ".repeat(80), fetcher);

    const headers = (fetcher.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Audit-Log-Reason"].length).toBeLessThanOrEqual(512);
    expect(headers["X-Audit-Log-Reason"]).not.toMatch(/[\r\n]/);
  });

  it.each([401, 403])(
    "reports a %i as OUR broken credential and never claims the role was removed",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));

      const result = await removeAccessRole("member-1", "anomaly", fetcher);

      expect(result.applied).toBe(false);
      expect(result.reason).toContain(String(status));
      expect(result.reason).toMatch(/credential/i);
      expect(result.reason).toMatch(/NOT removed/);
    }
  );

  it("reports a 404 without claiming an enforcement happened", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 404 }));

    const result = await removeAccessRole("member-1", "anomaly", fetcher);

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/404/);
    expect(result.reason).toMatch(/not found/i);
  });

  it("reports a 429 as a rate limit, not as a removal", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));

    const result = await removeAccessRole("member-1", "anomaly", fetcher);

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/rate-limited/i);
  });

  it("reports a 5xx as a Discord outage", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));

    const result = await removeAccessRole("member-1", "anomaly", fetcher);

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/503/);
  });

  it("reports an unexpected status without throwing", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 400 }));

    const result = await removeAccessRole("member-1", "anomaly", fetcher);

    expect(result).toEqual({
      applied: false,
      reason: expect.stringContaining("400"),
    });
  });

  it("survives a timeout instead of taking down the caller", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const fetcher = vi.fn().mockRejectedValue(timeout);

    const result = await removeAccessRole("member-1", "anomaly", fetcher);

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/did not answer/i);
    expect(result.reason).toMatch(/NOT removed/);
  });

  it("survives any other network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const result = await removeAccessRole("member-1", "anomaly", fetcher);

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/could not reach Discord/i);
  });

  it("refuses an empty Discord ID rather than calling Discord with a hole in the URL", async () => {
    const fetcher = vi.fn();

    const result = await removeAccessRole("   ", "anomaly", fetcher);

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/no Discord ID/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("removeAccessRole — missing configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_REQUIRED_ROLE_ID"])(
    "reports missing %s and makes no call",
    async (missing) => {
      armed();
      vi.stubEnv(missing, "");
      const fetcher = vi.fn();

      const result = await removeAccessRole("member-1", "anomaly", fetcher);

      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/not configured/i);
      expect(result.reason).toContain(missing);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );
});
