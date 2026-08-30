import { NextResponse } from "next/server";

import { PAID_COMMAND } from "@/lib/discord-interactions";

export const dynamic = "force-dynamic";

/**
 * GET /api/discord/interactions/register?key=CRON_SECRET
 *
 * Registers /paid with Discord. Run once by hand after deploying; there is no
 * cron for it because the command definition only changes when the code does.
 *
 * Registered per GUILD rather than globally on purpose: guild commands appear
 * immediately, where global ones take up to an hour to propagate — and an hour
 * of "did it work?" is how you end up registering it four times.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const url = new URL(req.url);
  const presented = (
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key")
  )?.trim();
  if (presented !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const appId = process.env.DISCORD_CLIENT_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!appId || !guildId || !token) {
    return NextResponse.json(
      { error: "DISCORD_CLIENT_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are all required" },
      { status: 400 }
    );
  }

  // PUT replaces the guild's whole command list with this one, so running it
  // twice cannot leave duplicates behind.
  const res = await fetch(
    `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([PAID_COMMAND]),
    }
  );
  const body = await res.text();
  if (!res.ok) {
    return NextResponse.json({ error: `${res.status}: ${body.slice(0, 300)}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, registered: ["/paid"], response: JSON.parse(body) });
}
