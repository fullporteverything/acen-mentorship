import { NextResponse } from "next/server";

import {
  deleteMessage,
  fetchMessages,
  getGuildMember,
  kickMember,
  listGuildChannels,
  postMessage,
  type DiscordMessage,
} from "@/lib/discord-api";
import {
  assessMessage,
  normalizeForComparison,
  snowflakeToMs,
  type MemberFacts,
  type ScanMessage,
} from "@/lib/spam-detect";
import { getCursors, priorFlagCount, recordReport, setCursor } from "@/lib/spam-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/discord/guard/sweep — looks for scam posts and reports them.
 *
 * ⚠ THIS IS THE SECOND LINE, NOT THE FIRST. Discord's own AutoMod blocks a
 * message before anyone sees it; this polls on a cron, so a phishing link is
 * visible until the next run. AutoMod should be doing the blocking. What this
 * adds is the part AutoMod cannot do: judging the ACCOUNT — its age, how long
 * it has been here, whether it is spraying the same text across channels — and
 * removing it.
 *
 * REPORTING IS ON, REMOVING IS OFF, and that is the project's standing rule for
 * anything that takes access away (see AGENTS.md). Set
 * DISCORD_GUARD_AUTOKICK=true once you have watched the reports for a week and
 * agree with them.
 */

/** Channels read per run. Enough for a server this size, bounded for the timeout. */
const MAX_CHANNELS = 40;
/** Messages read per channel per run. A cursor means we only ever read new ones. */
const PER_CHANNEL = 50;
/** Text (0) and announcement (5). Voice, categories and forums hold no messages to sweep. */
const SWEEPABLE = new Set([0, 5]);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const url = new URL(req.url);
  const presented = (
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key")
  )?.trim();
  if (presented !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!guildId || !botToken) return NextResponse.json({ skipped: "guard not configured" });

  const reportChannelId =
    process.env.DISCORD_GUARD_REPORT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_PAYOUT_REVIEW_CHANNEL_ID?.trim() ||
    null;
  const accessRoleId = process.env.DISCORD_REQUIRED_ROLE_ID?.trim();
  const adminId = process.env.ADMIN_DISCORD_ID?.trim();
  const autoKick = process.env.DISCORD_GUARD_AUTOKICK?.trim() === "true";
  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const channels = (await listGuildChannels(guildId))
      .filter((c) => SWEEPABLE.has(c.type) && c.id !== reportChannelId)
      .slice(0, MAX_CHANNELS);

    const cursors = await getCursors();
    const batch: { message: DiscordMessage; channelId: string }[] = [];
    const newCursors = new Map<string, string>();
    let unreadable = 0;

    for (const channel of channels) {
      const after = cursors.get(channel.id);
      let page: DiscordMessage[];
      try {
        page = await fetchMessages(channel.id, { limit: PER_CHANNEL, ...(after ? { after } : {}) });
      } catch {
        // No read permission on that channel, or it vanished. Not an error —
        // a private staff channel the bot cannot see is normal.
        unreadable += 1;
        continue;
      }
      if (page.length === 0) continue;

      // A channel with NO cursor is being seen for the first time. Record where
      // it is and read nothing: otherwise the first run would assess the whole
      // recent history of every channel at once and report a pile of things
      // that were dealt with months ago.
      const newest = page.reduce((acc, m) => (m.id > acc || m.id.length > acc.length ? m.id : acc), page[0].id);
      newCursors.set(channel.id, newest);
      if (!after) continue;

      for (const message of page) batch.push({ message, channelId: channel.id });
    }

    // Cross-posting is the strongest signal available, and it can only be seen
    // across the whole batch — so it is counted before anything is judged.
    const spread = new Map<string, Set<string>>();
    for (const { message, channelId } of batch) {
      const text = normalizeForComparison(message.content);
      if (!text) continue;
      const key = `${message.author.id}:${text}`;
      const channels = spread.get(key) ?? new Set<string>();
      channels.add(channelId);
      spread.set(key, channels);
    }

    const memberCache = new Map<string, MemberFacts>();
    const reports: unknown[] = [];
    let removed = 0;

    for (const { message, channelId } of batch) {
      if (message.author?.id === adminId) continue;

      const member = await memberFacts({
        guildId,
        userId: message.author.id,
        accessRoleId,
        adminId,
        cache: memberCache,
      });

      const scan: ScanMessage = {
        id: message.id,
        channelId,
        content: message.content ?? "",
        authorId: message.author.id,
        authorName: message.author.username,
        authorIsBot: Boolean(message.author.bot),
        // Discord does not send mention_everyone on every shape of payload, so
        // read the text as well rather than trusting the flag alone.
        mentionsEveryone: /@(everyone|here)\b/.test(message.content ?? ""),
      };

      const key = `${message.author.id}:${normalizeForComparison(message.content)}`;
      const verdict = assessMessage({
        message: scan,
        member,
        crossPostChannels: spread.get(key)?.size ?? 1,
      });
      if (verdict.action === "ignore") continue;

      const willRemove = verdict.action === "remove" && autoKick && !dryRun;

      // Deduped in the database, so a re-run cannot post the same warning
      // twice — and a report that was already made is not acted on again.
      const fresh = dryRun
        ? true
        : await recordReport({
            messageId: message.id,
            channelId,
            authorId: message.author.id,
            authorName: message.author.username,
            score: verdict.score,
            signals: verdict.signals.join("; "),
            action: verdict.action,
            acted: willRemove,
          });
      if (!fresh) continue;

      const priors = dryRun ? 0 : await priorFlagCount(message.author.id);
      reports.push({
        author: message.author.username,
        score: verdict.score,
        action: verdict.action,
        signals: verdict.signals,
      });

      if (willRemove) {
        // Message first. Kicking first leaves the link up for anyone reading
        // while the second call is in flight.
        await deleteMessage(channelId, message.id, `Suite 7 guard: ${verdict.signals[0]}`).catch(
          () => {}
        );
        await kickMember(guildId, message.author.id, `Suite 7 guard: ${verdict.signals.join("; ")}`)
          .then(() => {
            removed += 1;
          })
          .catch(() => {});
      }

      if (reportChannelId && !dryRun) {
        await postMessage(
          reportChannelId,
          reportContent({
            authorName: message.author.username,
            authorId: message.author.id,
            score: verdict.score,
            signals: verdict.signals,
            link: `https://discord.com/channels/${guildId}/${channelId}/${message.id}`,
            removed: willRemove,
            autoKick,
            priors,
          })
        ).catch(() => {});
      }
    }

    if (!dryRun) {
      for (const [channelId, messageId] of newCursors) await setCursor(channelId, messageId);
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      channelsSwept: channels.length,
      channelsUnreadable: unreadable,
      messagesRead: batch.length,
      flagged: reports.length,
      removed,
      autoKick,
      reports,
      notes: [
        autoKick ? null : "DISCORD_GUARD_AUTOKICK is off — flagged accounts are reported, not removed",
        reportChannelId ? null : "no report channel configured, so nothing is being told to anyone",
      ].filter(Boolean),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Facts about a member, cached — one sweep often sees the same author repeatedly. */
async function memberFacts(opts: {
  guildId: string;
  userId: string;
  accessRoleId: string | undefined;
  adminId: string | undefined;
  cache: Map<string, MemberFacts>;
}): Promise<MemberFacts> {
  const cached = opts.cache.get(opts.userId);
  if (cached) return cached;

  // Account age comes free from the snowflake, so even a failed member lookup
  // leaves us with something.
  const accountCreatedMs = snowflakeToMs(opts.userId);
  let facts: MemberFacts = {
    accountCreatedMs,
    joinedAtMs: null,
    roleCount: 0,
    hasAccessRole: false,
    isAdmin: opts.userId === opts.adminId,
  };

  try {
    const member = await getGuildMember(opts.guildId, opts.userId);
    facts = {
      ...facts,
      joinedAtMs: member.joined_at ? Date.parse(member.joined_at) : null,
      roleCount: member.roles?.length ?? 0,
      hasAccessRole: Boolean(opts.accessRoleId && member.roles?.includes(opts.accessRoleId)),
    };
  } catch {
    // Lookup failed — they may have already left. Treat them as a role holder,
    // which is the SAFE direction: it caps the outcome at a report. Guessing
    // the other way would let a failed API call become a kick.
    facts = { ...facts, hasAccessRole: true };
  }

  opts.cache.set(opts.userId, facts);
  return facts;
}

function reportContent(opts: {
  authorName: string;
  authorId: string;
  score: number;
  signals: string[];
  link: string;
  removed: boolean;
  autoKick: boolean;
  priors: number;
}): string {
  const head = opts.removed
    ? `🚫 **Removed** — ${opts.authorName}`
    : `⚠️ **Possible scam post** — ${opts.authorName}`;
  const lines = [
    head,
    `Score ${opts.score} · \`${opts.authorId}\``,
    opts.signals.map((s) => `• ${s}`).join("\n"),
    opts.link,
  ];
  if (opts.priors > 1) lines.push(`Flagged ${opts.priors} times before.`);
  if (!opts.removed && !opts.autoKick) {
    lines.push("_Reporting only — set `DISCORD_GUARD_AUTOKICK=true` to let it remove these._");
  }
  return lines.join("\n");
}
