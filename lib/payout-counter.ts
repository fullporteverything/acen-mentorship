import { formatUsd } from "./payout-parse";

/**
 * The channel-name side of the counter, kept pure so the rename rule can be
 * tested without a bot token.
 *
 * ⚠ THE RATE LIMIT IS THE WHOLE DESIGN. Discord allows 2 channel renames per
 * 10 MINUTES per channel, and going over does not fail loudly — the request
 * hangs or silently no-ops, so a counter that renames too eagerly simply stops
 * updating and looks broken. Everything below exists to make that impossible:
 * one rename per tick at most, only when the visible text actually changed.
 */

/** Comfortably inside the 2-per-10-minutes ceiling even if a tick runs twice. */
export const RENAME_MIN_INTERVAL_MS = 9 * 60 * 1000;

const DEFAULT_TEMPLATE = "💰 Student Payouts: {total}";

/**
 * Builds the channel name.
 *
 * `{total}` is compacted ($342K) because a channel name is read at a glance in
 * a sidebar, and Discord truncates it visually long before its 100-character
 * limit. `{exact}` is there for anyone who wants the full figure instead.
 */
export function counterName(totalCents: number, template = DEFAULT_TEMPLATE): string {
  const safe = Number.isFinite(totalCents) && totalCents > 0 ? Math.round(totalCents) : 0;
  return (template || DEFAULT_TEMPLATE)
    .replace(/\{total\}/g, formatUsd(safe, { compact: true }))
    .replace(/\{exact\}/g, formatUsd(safe))
    .slice(0, 100);
}

/**
 * Should this tick spend its one rename?
 *
 * No when the name is unchanged — the common case by far, since most ticks find
 * no new payouts, and a rename that changes nothing still burns the budget that
 * the NEXT tick (the one with real news) needs.
 */
export function shouldRename(opts: {
  desired: string;
  current: string | null | undefined;
  lastRenamedAt: Date | null | undefined;
  now?: number;
}): boolean {
  if (!opts.desired) return false;
  if (opts.current === opts.desired) return false;
  if (!opts.lastRenamedAt) return true;
  const now = opts.now ?? Date.now();
  const elapsed = now - opts.lastRenamedAt.getTime();
  // A clock that reads backwards (a stored time in the future) must not be
  // treated as "ages ago" and unlock a rename.
  if (elapsed < 0) return false;
  return elapsed >= RENAME_MIN_INTERVAL_MS;
}

/** The bot's review post. Written for someone reading it on a phone. */
export function reviewPostContent(opts: {
  authorName: string;
  amountCents: number | null;
  reason: string;
  messageLink: string;
}): string {
  const amount =
    opts.amountCents === null ? "no amount readable" : formatUsd(opts.amountCents);
  return [
    `**Payout needs a look** — ${opts.authorName}`,
    `Amount: **${amount}**`,
    `Why: ${opts.reason}`,
    opts.messageLink,
    opts.amountCents === null
      ? "Reply with the amount (e.g. `$2,500`) to count it, or ❌ to skip."
      : "✅ to count it, ❌ to skip. Reply with a different amount to correct it.",
  ].join("\n");
}

/** Jump link to the original message, so a reviewer can read it in context. */
export function messageLink(guildId: string | undefined, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId || "@me"}/${channelId}/${messageId}`;
}
