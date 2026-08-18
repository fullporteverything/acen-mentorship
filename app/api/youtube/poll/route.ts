import { NextResponse } from "next/server";

import { fetchChannelFeed, isLikelyShort } from "@/lib/youtube-feed";
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

  let feed;
  try {
    feed = await fetchChannelFeed(channelId);
  } catch (error) {
    console.error("[youtube-poll] feed fetch failed", error);
    return NextResponse.json({ error: "feed unavailable" }, { status: 502 });
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
    const ok = await postToDiscord(announceChannelId, botToken, video.title, video.url);
    // Only mark handled once it's actually out — a failed post is retried next
    // poll rather than silently dropped.
    if (ok) {
      await markHandled(video.videoId, video.title, true);
      posted += 1;
    }
  }

  return NextResponse.json({ posted, skippedShorts });
}

/** Post the announcement with a real @everyone ping. Returns whether it landed. */
async function postToDiscord(
  channelId: string,
  botToken: string,
  title: string,
  videoUrl: string
): Promise<boolean> {
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Discord auto-embeds the bare YouTube link into a rich video card.
        content: `@everyone\n**${title}**\n${videoUrl}`,
        allowed_mentions: { parse: ["everyone"] },
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
