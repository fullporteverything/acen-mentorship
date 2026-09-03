import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

/**
 * Where the server sweep got to, and what it has already reported.
 *
 * Two tiny tables, self-creating like every other store here. The cursor table
 * is what keeps the sweep cheap — without it, every run would re-read and
 * re-report the same history forever.
 */

let ensured = false;

export async function ensureGuardTables(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS guild_scan_state (
      channel_id varchar(32) PRIMARY KEY,
      last_message_id varchar(32),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS spam_reports (
      message_id varchar(32) PRIMARY KEY,
      channel_id varchar(32) NOT NULL,
      author_id varchar(32) NOT NULL,
      author_name text,
      score integer NOT NULL,
      signals text,
      action varchar(16) NOT NULL,
      acted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS spam_reports_author_index ON spam_reports (author_id, created_at DESC)
  `);
  ensured = true;
}

export async function getCursors(): Promise<Map<string, string>> {
  await ensureGuardTables();
  const rows = await db.execute<{ channel_id: string; last_message_id: string | null }>(
    sql`SELECT channel_id, last_message_id FROM guild_scan_state`
  );
  const out = new Map<string, string>();
  for (const row of rows.rows ?? []) {
    if (row.last_message_id) out.set(row.channel_id, row.last_message_id);
  }
  return out;
}

export async function setCursor(channelId: string, lastMessageId: string): Promise<void> {
  await ensureGuardTables();
  await db.execute(sql`
    INSERT INTO guild_scan_state (channel_id, last_message_id, updated_at)
    VALUES (${channelId}, ${lastMessageId}, now())
    ON CONFLICT (channel_id) DO UPDATE
      SET last_message_id = ${lastMessageId}, updated_at = now()
  `);
}

/**
 * Records a report. Returns false when this message has already been reported,
 * so a re-run cannot post the same warning twice.
 */
export async function recordReport(row: {
  messageId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  score: number;
  signals: string;
  action: string;
  acted: boolean;
}): Promise<boolean> {
  await ensureGuardTables();
  const result = await db.execute(sql`
    INSERT INTO spam_reports
      (message_id, channel_id, author_id, author_name, score, signals, action, acted)
    VALUES (${row.messageId}, ${row.channelId}, ${row.authorId}, ${row.authorName},
            ${row.score}, ${row.signals}, ${row.action}, ${row.acted})
    ON CONFLICT (message_id) DO NOTHING
    RETURNING message_id
  `);
  return (result.rows?.length ?? 0) > 0;
}

/** How many times this account has been flagged before — shown in the report. */
export async function priorFlagCount(authorId: string): Promise<number> {
  await ensureGuardTables();
  const result = await db.execute<{ n: string }>(
    sql`SELECT count(*) AS n FROM spam_reports WHERE author_id = ${authorId}`
  );
  return Number(result.rows?.[0]?.n ?? 0);
}
