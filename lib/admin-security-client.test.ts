import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAdminSecurity } from "./admin-security-client";

describe("admin security recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("can retry a failed GET and return the recovered state in place", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => null })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          logs: [{ timestamp: "2026-08-09T12:00:00.000Z" }],
          members: [{ discordId: "student", strikes: 1 }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadAdminSecurity()).rejects.toThrow();
    await expect(loadAdminSecurity()).resolves.toEqual({
      logs: [{ timestamp: "2026-08-09T12:00:00.000Z" }],
      members: [{ discordId: "student", strikes: 1 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
