import "server-only";

import { count, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { youtubeAnnouncements } from "@/lib/db/schema";

/**
 * Records every YouTube video id the bot has already handled so a 5-minute poll
 * never double-posts. "Handled" covers BOTH posted long-form videos and Shorts
 * we deliberately skipped — once an id is here, we never look at it again.
 *
 * Self-creating (CREATE TABLE IF NOT EXISTS), same pattern as onboarding-store,
 * so there's no separate migration step. Reads/writes go through drizzle's typed
 * query builder so array parameters (inArray) bind correctly.
 */
let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS youtube_announcements (
      video_id varchar(64) PRIMARY KEY,
      title text,
      posted boolean NOT NULL DEFAULT false,
      handled_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  tableEnsured = true;
}

/** Number of ids already recorded — 0 means we've never polled this channel. */
export async function announcedCount(): Promise<number> {
  await ensureTable();
  const [row] = await db.select({ value: count() }).from(youtubeAnnouncements);
  return row?.value ?? 0;
}

/** The subset of the given ids we have NOT handled yet. */
export async function unhandledIds(videoIds: string[]): Promise<Set<string>> {
  await ensureTable();
  if (videoIds.length === 0) return new Set();
  const known = await db
    .select({ videoId: youtubeAnnouncements.videoId })
    .from(youtubeAnnouncements)
    .where(inArray(youtubeAnnouncements.videoId, videoIds));
  const knownSet = new Set(known.map((r) => r.videoId));
  return new Set(videoIds.filter((id) => !knownSet.has(id)));
}

/**
 * Mark a video handled. `posted` distinguishes a long-form video we announced
 * from a Short we skipped — both are recorded so neither is reconsidered. Uses
 * ON CONFLICT DO NOTHING so a race between two overlapping polls can't error or
 * double-post.
 */
export async function markHandled(
  videoId: string,
  title: string,
  posted: boolean
): Promise<void> {
  await ensureTable();
  await db
    .insert(youtubeAnnouncements)
    .values({ videoId, title, posted })
    .onConflictDoNothing({ target: youtubeAnnouncements.videoId });
}

/**
 * First-run seed: record every id currently in the feed as handled WITHOUT
 * posting, so turning the integration on doesn't blast the entire back catalog
 * to @everyone. Only meaningful when the table is empty.
 */
export async function seedHandled(videos: { videoId: string; title: string }[]): Promise<void> {
  await ensureTable();
  if (videos.length === 0) return;
  await db
    .insert(youtubeAnnouncements)
    .values(videos.map((v) => ({ videoId: v.videoId, title: v.title, posted: false })))
    .onConflictDoNothing({ target: youtubeAnnouncements.videoId });
}
