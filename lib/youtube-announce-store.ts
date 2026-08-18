import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

/**
 * Records every YouTube video id the bot has already handled so a 5-minute poll
 * never double-posts. "Handled" covers BOTH posted long-form videos and Shorts
 * we deliberately skipped — once a id is here, we never look at it again.
 *
 * Self-creating (CREATE TABLE IF NOT EXISTS), same pattern as onboarding-store,
 * so there's no separate migration step.
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
  const result = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM youtube_announcements`
  );
  return result.rows[0]?.count ?? 0;
}

/** The subset of the given ids we have NOT handled yet. */
export async function unhandledIds(videoIds: string[]): Promise<Set<string>> {
  await ensureTable();
  if (videoIds.length === 0) return new Set();
  const result = await db.execute<{ video_id: string }>(
    sql`SELECT video_id FROM youtube_announcements WHERE video_id = ANY(${videoIds})`
  );
  const known = new Set(result.rows.map((r) => r.video_id));
  return new Set(videoIds.filter((id) => !known.has(id)));
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
  await db.execute(sql`
    INSERT INTO youtube_announcements (video_id, title, posted)
    VALUES (${videoId}, ${title}, ${posted})
    ON CONFLICT (video_id) DO NOTHING
  `);
}

/**
 * First-run seed: record every id currently in the feed as handled WITHOUT
 * posting, so turning the integration on doesn't blast the entire back catalog
 * to @everyone. Only meaningful when the table is empty.
 */
export async function seedHandled(videoIds: { videoId: string; title: string }[]): Promise<void> {
  await ensureTable();
  for (const v of videoIds) {
    await markHandled(v.videoId, v.title, false);
  }
}
