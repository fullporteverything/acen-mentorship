import "server-only";

/**
 * A single upload as read from a channel's public RSS feed. No YouTube Data API
 * key is required — the feed at
 *   https://www.youtube.com/feeds/videos.xml?channel_id=<id>
 * is public and free, which is exactly why we poll it instead of the quota'd API.
 */
export interface FeedVideo {
  videoId: string;
  title: string;
  /** Canonical watch URL — Discord auto-embeds this into a rich video card. */
  url: string;
  publishedAt: string;
}

const FEED_TIMEOUT_MS = 8_000;
const SHORTS_TIMEOUT_MS = 5_000;

function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

/** Decode the handful of XML entities that show up in feed titles. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&"); // last, so we don't double-decode
}

function firstMatch(block: string, re: RegExp): string | null {
  const m = block.match(re);
  return m ? m[1] : null;
}

/**
 * Parse a YouTube uploads RSS document into videos, newest first (the feed's
 * own order). Tolerant by design: any entry missing an id/title/link is skipped
 * rather than throwing, so one malformed entry never sinks a poll.
 */
export function parseFeed(xml: string): FeedVideo[] {
  const videos: FeedVideo[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let entry: RegExpExecArray | null;
  while ((entry = entryRe.exec(xml)) !== null) {
    const block = entry[1];
    const videoId = firstMatch(block, /<yt:videoId>([^<]+)<\/yt:videoId>/);
    const rawTitle = firstMatch(block, /<title>([\s\S]*?)<\/title>/);
    const published = firstMatch(block, /<published>([^<]+)<\/published>/);
    if (!videoId || !rawTitle) continue;
    videos.push({
      videoId,
      title: decodeEntities(rawTitle).trim(),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published ?? "",
    });
  }
  return videos;
}

/** Fetch + parse the channel feed. Throws on network / non-200 so the caller can log. */
export async function fetchChannelFeed(channelId: string): Promise<FeedVideo[]> {
  const res = await fetch(feedUrl(channelId), {
    headers: { "User-Agent": "acen-mentorship-bot/1.0" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`YouTube feed responded ${res.status}`);
  }
  return parseFeed(await res.text());
}

/**
 * Best-effort Short detection. The RSS feed doesn't label Shorts, so we probe
 * https://www.youtube.com/shorts/<id>: YouTube serves a real Short at 200 and
 * redirects a normal video to /watch. We fail OPEN — any error or ambiguity
 * returns false (treat as long-form) because missing a real upload is worse
 * than the rare Short slipping through.
 */
export async function isLikelyShort(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "acen-mentorship-bot/1.0" },
      signal: AbortSignal.timeout(SHORTS_TIMEOUT_MS),
      cache: "no-store",
    });
    // 200 = the /shorts/ page rendered → it's a Short. 3xx = redirected to
    // /watch → long-form. Anything else → don't guess, treat as long-form.
    return res.status === 200;
  } catch {
    return false;
  }
}
