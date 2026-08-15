import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { sanitizeTicketBody, ticketThreadName } from "@/lib/support";

export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_API_TIMEOUT_MS = 5_000;
/** Discord channel type 12 — GUILD_PRIVATE_THREAD. */
const PRIVATE_THREAD = 12;
/** Three open tickets an hour is plenty; past that it's a flood, not a plea. */
const TICKET_RATE_POLICY = { limit: 3, windowMs: 60 * 60 * 1000 };

/** The owner's #tickets channel — used whenever the env override is unset. */
const DEFAULT_SUPPORT_CHANNEL_ID = "1533841096818294786";

/** One generic failure for the client. Discord's own error bodies never leave this module. */
function ticketFailed() {
  return NextResponse.json(
    { ok: false, error: "Could not open a ticket right now" },
    { status: 502 }
  );
}

function discordFetch(path: string, init: RequestInit, botToken: string) {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS),
  });
}

/**
 * POST /api/support/ticket
 * Body: { body?: string }
 *
 * Opens a private Discord thread between the member and the admins, so a
 * blocked or confused member can ask for help without knowing who to DM.
 * Returns the thread's deep link on success and nothing useful on failure —
 * a support endpoint must never become a probe for the bot's permissions.
 */
export async function POST(req: Request) {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;

  // allowMutation runs the throttle AND the audit entry off one shared bucket
  // keyed (discordId, "support.ticket"). Calling consumeRateLimit again on
  // that same key would burn two hits per request — 3/hour would really mean
  // 1 — so the ticket policy is handed to allowMutation instead.
  const denied = await allowMutation(
    member,
    "support.ticket",
    req,
    undefined,
    TICKET_RATE_POLICY
  );
  if (denied) return denied;

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const channelId =
    process.env.DISCORD_SUPPORT_CHANNEL_ID || DEFAULT_SUPPORT_CHANNEL_ID;
  if (!botToken || !guildId) return ticketFailed();

  const payload = await req.json().catch(() => ({}));
  const body = sanitizeTicketBody((payload as { body?: unknown })?.body);

  const shortId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const name = ticketThreadName(member.name, shortId);

  let threadId: string | undefined;
  try {
    const created = await discordFetch(
      `/channels/${encodeURIComponent(channelId)}/threads`,
      {
        method: "POST",
        body: JSON.stringify({ name, type: PRIVATE_THREAD, invitable: false }),
      },
      botToken
    );
    if (!created.ok) return ticketFailed();

    const thread = (await created.json()) as { id?: unknown };
    if (typeof thread.id !== "string" || !thread.id) return ticketFailed();
    threadId = thread.id;

    // Pull the member in, then greet them. Either failure leaves a thread the
    // member can't see, so the thread is torn down again below.
    const joined = await discordFetch(
      `/channels/${threadId}/thread-members/${encodeURIComponent(member.discordId)}`,
      { method: "PUT" },
      botToken
    );
    if (!joined.ok) throw new Error("thread member add failed");

    const opening = `<@${member.discordId}> opened a ticket from the Dojo site.`;
    const posted = await discordFetch(
      `/channels/${threadId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: body ? `${opening}\n\n${body}` : opening,
          // Ping the member who opened it and nobody else, whatever the body says.
          allowed_mentions: { parse: [], users: [member.discordId] },
        }),
      },
      botToken
    );
    if (!posted.ok) throw new Error("opening message failed");

    return NextResponse.json({
      ok: true,
      url: `https://discord.com/channels/${guildId}/${threadId}`,
    });
  } catch {
    // Best effort: don't litter #tickets with half-built threads nobody joined.
    if (threadId) {
      await discordFetch(`/channels/${threadId}`, { method: "DELETE" }, botToken).catch(
        () => {}
      );
    }
    return ticketFailed();
  }
}
