import "server-only";

/**
 * Thin REST helpers for the bot. No gateway, no WebSocket — Vercel functions
 * cannot hold one open, so everything here polls.
 *
 * That choice has a useful side effect: the MESSAGE_CONTENT privileged intent
 * gates message content in GATEWAY events, not REST reads. Fetching history
 * over REST returns content on the strength of the bot's channel permissions
 * (View Channel + Read Message History). If content ever comes back empty,
 * that is the signal the intent is being enforced and needs enabling.
 */

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8_000;

export class DiscordError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  attempt = 0
): Promise<T> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new DiscordError("DISCORD_BOT_TOKEN is not set", 0);

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new DiscordError(`network failure: ${String(error)}`, 0);
  }

  // Discord hands back exactly how long to wait. Honour it rather than
  // guessing — a bot that ignores 429s gets its token limited globally.
  if (res.status === 429 && attempt < 2) {
    const retry = Number(res.headers.get("retry-after") ?? "1");
    await new Promise((r) => setTimeout(r, Math.min(10_000, retry * 1000 + 250)));
    return call<T>(path, init, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DiscordError(`${res.status} on ${path}: ${body.slice(0, 200)}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  timestamp: string;
  attachments: { id: string; url: string }[];
  /**
   * Present when the message is a reply. This is how an approval reply in the
   * review channel is tied back to the bot's own review post — the reviewer
   * just hits reply, which needs no slash command and no site.
   */
  message_reference?: { message_id?: string; channel_id?: string } | null;
}

/**
 * One page of channel history, newest first.
 *
 * `after` walks FORWARD in time (used for incremental syncs), `before` walks
 * backward (used for the initial backfill). Discord caps `limit` at 100.
 */
export function fetchMessages(
  channelId: string,
  opts: { after?: string; before?: string; limit?: number } = {}
): Promise<DiscordMessage[]> {
  const q = new URLSearchParams({ limit: String(Math.min(100, opts.limit ?? 100)) });
  if (opts.after) q.set("after", opts.after);
  if (opts.before) q.set("before", opts.before);
  return call<DiscordMessage[]>(`/channels/${channelId}/messages?${q}`);
}

export function postMessage(channelId: string, content: string): Promise<DiscordMessage> {
  return call<DiscordMessage>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      // Never let a bot post ping the server. These messages are for the owner.
      allowed_mentions: { parse: [] },
    }),
  });
}

export function addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  return call<void>(
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    { method: "PUT" }
  );
}

/** Who reacted with `emoji`. Used to read approve/reject decisions. */
export function fetchReactors(
  channelId: string,
  messageId: string,
  emoji: string
): Promise<{ id: string; username: string }[]> {
  return call<{ id: string; username: string }[]>(
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}?limit=25`
  );
}

/**
 * Renames a channel — this is how every "member counter" on Discord works.
 *
 * ⚠ HARD RATE LIMIT: 2 renames per 10 MINUTES per channel, and it is not the
 * usual 429. Exceed it and the request hangs or silently no-ops, so the
 * counter must never be driven faster than a ~10 minute cron.
 */
export function renameChannel(channelId: string, name: string): Promise<unknown> {
  return call(`/channels/${channelId}`, {
    method: "PATCH",
    // Discord truncates past 100 chars; do it ourselves so the result is
    // predictable rather than mangled mid-number.
    body: JSON.stringify({ name: name.slice(0, 100) }),
  });
}
