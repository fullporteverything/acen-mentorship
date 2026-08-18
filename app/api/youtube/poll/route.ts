import { NextResponse } from "next/server";

import { fetchChannelFeed, isLikelyShort, type FeedVideo } from "@/lib/youtube-feed";
import {
  announcedCount,
  markHandled,
  seedHandled,
  unhandledIds,
} from "@/lib/youtube-announce-store";

export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_TIMEOUT_MS = 5_000;

/**
 * GET /api/youtube/poll
 *
 * Polls the configured YouTube channel's public RSS feed and posts any NEW
 * long-form upload to a Discord channel with an @everyone ping. Meant to be hit
 * every ~5 minutes by a scheduler (Vercel Cron, or any free external cron).
 *
 * Auth: requires the CRON_SECRET, sent either as `Authorization: Bearer <secret>`
 * (what Vercel Cron sends automatically) or `?key=<secret>`. Without a configured
 * secret the route refuses to run, so it can never be triggered anonymously.
 *
 * Safe when unconfigured: if the channel / Discord env vars are missing it
 * returns 200 `{ skipped }` and does nothing — the integration is dormant until
 * you set the env vars, exactly like the NDA gate.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (presented !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const announceChannelId = process.env.YOUTUBE_ANNOUNCE_CHANNEL_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!channelId || !announceChannelId || !botToken) {
    return NextResponse.json({ skipped: "youtube integration not configured" });
  }

  const previewMode = url.searchParams.get("preview") === "1";
  const testMode = url.searchParams.get("test") === "1";

  // The whole flow (feed + DB + Discord) is wrapped so any thrown error becomes
  // a clean 500 with its message rather than an opaque Vercel crash page. This
  // endpoint is secret-gated, so echoing the detail back is safe and makes the
  // 5-minute cron debuggable from the response alone.
  try {
    const feed = await fetchChannelFeed(channelId);

    // ?preview=1 / ?test=1 — diagnostics that use the LATEST long-form video but
    // never touch the dedup table, so they can be run any time without changing
    // what the real cron will post.
    if (previewMode || testMode) {
      const latest = await pickLatestLongform(feed);
      if (!latest) {
        return NextResponse.json({ mode: previewMode ? "preview" : "test", note: "no long-form video found in the feed" });
      }
      const content = buildContent(latest.url);
      if (previewMode) {
        // Dry run: show exactly what would be posted, post nothing.
        return NextResponse.json({ mode: "preview", channelId: announceChannelId, video: latest, content });
      }
      // Test post: real message + embed land in the channel, but pings are
      // SUPPRESSED so it doesn't notify anyone. Delete it after eyeballing it.
      const ok = await postToDiscord(announceChannelId, botToken, latest.url, false);
      return NextResponse.json({ mode: "test", posted: ok, video: latest, note: "no ping fired; delete the test message when done" });
    }

    // First ever run for this channel: record the whole feed as "seen" without
    // posting, so we don't dump the back catalog to @everyone. Newest upload
    // after this seed is the first thing that actually posts.
    if ((await announcedCount()) === 0) {
      await seedHandled(feed.map((v) => ({ videoId: v.videoId, title: v.title })));
      return NextResponse.json({ seeded: feed.length });
    }

    const unhandled = await unhandledIds(feed.map((v) => v.videoId));
    if (unhandled.size === 0) {
      return NextResponse.json({ posted: 0 });
    }

    // Post oldest→newest so the channel reads chronologically when several land
    // between polls.
    const fresh = feed.filter((v) => unhandled.has(v.videoId)).reverse();
    let posted = 0;
    let skippedShorts = 0;
    for (const video of fresh) {
      if (await isLikelyShort(video.videoId)) {
        await markHandled(video.videoId, video.title, false);
        skippedShorts += 1;
        continue;
      }
      const ok = await postToDiscord(announceChannelId, botToken, video.url, true);
      // Only mark handled once it's actually out — a failed post is retried next
      // poll rather than silently dropped.
      if (ok) {
        await markHandled(video.videoId, video.title, true);
        posted += 1;
      }
    }

    return NextResponse.json({ posted, skippedShorts });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[youtube-poll] failed", error);
    return NextResponse.json({ error: "poll failed", detail }, { status: 500 });
  }
}

/** The exact announcement text. Kept in one place so preview shows what posts. */
function buildContent(videoUrl: string): string {
  // The bare YouTube link auto-expands into Discord's rich video card
  // (thumbnail + title), so we don't repeat the title in the text.
  return `@everyone @here\nNEW YOUTUBE VIDEO OUT!\n\n${videoUrl}`;
}

/** Newest video in the feed that isn't a Short, or null. Used by the test modes. */
async function pickLatestLongform(feed: FeedVideo[]): Promise<FeedVideo | null> {
  for (const video of feed) {
    if (!(await isLikelyShort(video.videoId))) return video;
  }
  return null;
}

/**
 * Post the announcement. Returns whether it landed. When `ping` is true it fires
 * real @everyone + @here mentions (parse:["everyone"] covers both); when false
 * (test mode) mentions are suppressed so no one is notified.
 */
async function postToDiscord(
  channelId: string,
  botToken: string,
  videoUrl: string,
  ping: boolean
): Promise<boolean> {
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: buildContent(videoUrl),
        allowed_mentions: { parse: ping ? ["everyone"] : [] },
      }),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[youtube-poll] discord post failed", res.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[youtube-poll] discord post error", error);
    return false;
  }
}
