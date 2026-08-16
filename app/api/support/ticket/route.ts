import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sanitizeTicketBody, ticketThreadName } from "@/lib/support";

export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_API_TIMEOUT_MS = 5_000;
/** Discord channel type 12 — GUILD_PRIVATE_THREAD. */
const PRIVATE_THREAD = 12;
/** Three open tickets an hour is plenty; past that it's a flood, not a plea. */
const TICKET_RATE_POLICY = { limit: 3, windowMs: 60 * 60 * 1000 };
/**
 * Coarse anti-flood ceilings layered under the per-user cap. The per-user 3/hour
 * is keyed on discordId alone, so N Discord accounts = N×3 threads into #tickets;
 * these two catch that. Numbers are intentionally generous — they are a flood
 * ceiling, not a per-member quota.
 */
const TICKET_IP_POLICY = { limit: 5, windowMs: 60 * 60 * 1000 };
const TICKET_GLOBAL_POLICY = { limit: 20, windowMs: 60 * 60 * 1000 };
/** Ticket bodies are short text; anything past this is not a genuine ticket. */
const TICKET_MAX_BODY_BYTES = 8 * 1024;

/** Cheap first gate: reject oversized bodies via Content-Length before buffering. */
function bodyTooLarge(req: Request, maxBytes: number): NextResponse | null {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  return null;
}

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

  const oversized = bodyTooLarge(req, TICKET_MAX_BODY_BYTES);
  if (oversized) return oversized;

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

  // Two coarser ceilings sit under the per-user cap, checked most-specific first
  // (per-IP, then channel-wide global). Either trip returns the SAME generic
  // failure as everything else here — a support endpoint must never reveal which
  // limit stopped a request.

  // Per-IP soft cap. Read the client IP exactly the way the rest of the app does
  // (see app/api/security/check-ip, lib/mutation-security). XFF is client-
  // influenced — any proxy hop can prepend a value — so this is deliberately a
  // soft layer under the per-user cap, not a source of truth. Skip if no IP.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "";
  if (ip) {
    const perIp = await consumeRateLimit(ip, "support.ticket.ip", TICKET_IP_POLICY);
    if (!perIp.allowed) return ticketFailed();
  }

  // Channel-wide flood ceiling across ALL users: past this many new threads an
  // hour, #tickets is being flooded (many accounts, one IP pool, whatever) and
  // the right move is to shed load rather than keep opening threads.
  const global = await consumeRateLimit(
    "__global__",
    "support.ticket.global",
    TICKET_GLOBAL_POLICY
  );
  if (!global.allowed) return ticketFailed();

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
