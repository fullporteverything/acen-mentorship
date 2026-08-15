import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  allowMutation: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: mocks.allowMutation }));

import { POST } from "./route";

const GUILD = "guild-1";
const CHANNEL = "channel-1";

function request(body: unknown = {}) {
  return new Request("http://localhost/api/support/ticket", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Happy-path Discord: create thread → add member → post message. */
function discordOk() {
  return vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "thread-9" }), { status: 201 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));
}

describe("POST /api/support/ticket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMemberOrResponse.mockResolvedValue({
      discordId: "member-1",
      ownerIds: ["member-1"],
      isAdmin: false,
      name: "Kenji.Sato",
    });
    mocks.allowMutation.mockResolvedValue(null);
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_GUILD_ID", GUILD);
    vi.stubEnv("DISCORD_SUPPORT_CHANNEL_ID", CHANNEL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("preserves centralized authorization responses", async () => {
    mocks.requireMemberOrResponse.mockResolvedValue(
      new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 })
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect((await POST(request())).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the throttle response instead of opening a thread", async () => {
    mocks.allowMutation.mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 })
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect((await POST(request())).status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throttles tickets at three an hour on the shared mutation bucket", async () => {
    vi.stubGlobal("fetch", discordOk());
    await POST(request());

    expect(mocks.allowMutation).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: "member-1" }),
      "support.ticket",
      expect.anything(),
      undefined,
      { limit: 3, windowMs: 60 * 60 * 1000 }
    );
  });

  it("opens a private thread, adds the member, and returns its deep link", async () => {
    const fetchSpy = discordOk();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(request({ body: "I can't sign in" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      url: `https://discord.com/channels/${GUILD}/thread-9`,
    });

    const [createUrl, createInit] = fetchSpy.mock.calls[0];
    expect(createUrl).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/threads`);
    const created = JSON.parse(createInit.body);
    expect(created).toMatchObject({ type: 12, invitable: false });
    expect(created.name).toMatch(/^ticket-kenji-sato-[a-f0-9]{8}$/);

    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://discord.com/api/v10/channels/thread-9/thread-members/member-1"
    );
    expect(fetchSpy.mock.calls[1][1].method).toBe("PUT");

    const posted = JSON.parse(fetchSpy.mock.calls[2][1].body);
    expect(posted.content).toContain("<@member-1> opened a ticket from the Dojo site.");
    expect(posted.content).toContain("I can't sign in");
    expect(posted.allowed_mentions).toEqual({ parse: [], users: ["member-1"] });
  });

  it("falls back to the owner's tickets channel when the env var is unset", async () => {
    vi.stubEnv("DISCORD_SUPPORT_CHANNEL_ID", "");
    const fetchSpy = discordOk();
    vi.stubGlobal("fetch", fetchSpy);

    await POST(request());
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://discord.com/api/v10/channels/1533841096818294786/threads"
    );
  });

  it("never leaks Discord's error body to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: "Missing Access", code: 50001 }), {
            status: 403,
          })
        )
    );

    const response = await POST(request());
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/Missing Access|50001/);
  });

  it("tears the thread down when the member can't be added to it", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "thread-9" }), { status: 201 }))
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    expect((await POST(request())).status).toBe(502);
    expect(fetchSpy.mock.calls[2][0]).toBe("https://discord.com/api/v10/channels/thread-9");
    expect(fetchSpy.mock.calls[2][1].method).toBe("DELETE");
  });

  it("fails closed without a bot token", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect((await POST(request())).status).toBe(502);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
