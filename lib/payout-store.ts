import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { payoutSyncState, studentPayouts, type StudentPayoutRow } from "@/lib/db/schema";
import type { PayoutStatus } from "./payout-ingest";

/**
 * Storage for the student-payout counter.
 *
 * Self-creating tables (CREATE TABLE IF NOT EXISTS), the same pattern as
 * youtube-announce-store and session-store, so shipping this needs no migration
 * step — the first cron run after deploy creates everything and starts the
 * backfill on its own.
 *
 * The row key is the DISCORD MESSAGE ID. That single choice is what makes the
 * whole thing safe to re-run: the backfill can sweep the channel as many times
 * as it likes, a tick can overlap with the previous one, the state row can be
 * deleted to force a full re-scan — and every message still lands on exactly
 * one row. A public total that double counts on a retry would be worse than no
 * total at all.
 */

let tablesEnsured = false;

export async function ensurePayoutTables(): Promise<void> {
  if (tablesEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS student_payouts (
      message_id varchar(32) PRIMARY KEY,
      channel_id varchar(32) NOT NULL,
      author_discord_id varchar(32) NOT NULL,
      author_name text,
      amount_cents integer,
      matched text,
      reason text,
      status varchar(16) NOT NULL DEFAULT 'pending',
      review_message_id varchar(32),
      decided_by varchar(32),
      decided_at timestamptz,
      posted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS student_payouts_status_index ON student_payouts (status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS student_payouts_review_message_index
      ON student_payouts (review_message_id)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payout_sync_state (
      channel_id varchar(32) PRIMARY KEY,
      last_message_id varchar(32),
      backfill_before_id varchar(32),
      backfill_complete boolean NOT NULL DEFAULT false,
      review_cursor_id varchar(32),
      last_counter_name text,
      last_renamed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  tablesEnsured = true;
}

export interface PayoutSyncState {
  lastMessageId: string | null;
  backfillBeforeId: string | null;
  backfillComplete: boolean;
  reviewCursorId: string | null;
  lastCounterName: string | null;
  lastRenamedAt: Date | null;
}

const EMPTY_STATE: PayoutSyncState = {
  lastMessageId: null,
  backfillBeforeId: null,
  backfillComplete: false,
  reviewCursorId: null,
  lastCounterName: null,
  lastRenamedAt: null,
};

export async function getSyncState(channelId: string): Promise<PayoutSyncState> {
  await ensurePayoutTables();
  const [row] = await db
    .select()
    .from(payoutSyncState)
    .where(eq(payoutSyncState.channelId, channelId))
    .limit(1);
  if (!row) return { ...EMPTY_STATE };
  return {
    lastMessageId: row.lastMessageId ?? null,
    backfillBeforeId: row.backfillBeforeId ?? null,
    backfillComplete: row.backfillComplete,
    reviewCursorId: row.reviewCursorId ?? null,
    lastCounterName: row.lastCounterName ?? null,
    lastRenamedAt: row.lastRenamedAt ?? null,
  };
}

/** Patch-style save: only the fields passed are written. */
export async function saveSyncState(
  channelId: string,
  patch: Partial<PayoutSyncState>
): Promise<void> {
  await ensurePayoutTables();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if ("lastMessageId" in patch) set.lastMessageId = patch.lastMessageId;
  if ("backfillBeforeId" in patch) set.backfillBeforeId = patch.backfillBeforeId;
  if ("backfillComplete" in patch) set.backfillComplete = patch.backfillComplete;
  if ("reviewCursorId" in patch) set.reviewCursorId = patch.reviewCursorId;
  if ("lastCounterName" in patch) set.lastCounterName = patch.lastCounterName;
  if ("lastRenamedAt" in patch) set.lastRenamedAt = patch.lastRenamedAt;

  await db
    .insert(payoutSyncState)
    .values({ channelId, ...set })
    .onConflictDoUpdate({ target: payoutSyncState.channelId, set });
}

/**
 * Forgets where the scanner got to, so the next run re-reads the channel from
 * the beginning. Safe by construction: rows are keyed by message id, so a full
 * re-scan lands on the rows that already exist and re-inserts nothing. Decisions
 * already made survive it.
 */
export async function clearSyncState(channelId: string): Promise<void> {
  await ensurePayoutTables();
  await db.delete(payoutSyncState).where(eq(payoutSyncState.channelId, channelId));
}

export interface CandidateRow {
  messageId: string;
  channelId: string;
  authorDiscordId: string;
  authorName: string | null;
  amountCents: number | null;
  matched: string | null;
  reason: string;
  status: PayoutStatus;
  postedAt: Date | null;
}

/**
 * Records a scanned message.
 *
 * DO NOTHING on conflict, never DO UPDATE: once a row exists it may carry a
 * human's decision, and a re-scan re-deriving it from the parser would silently
 * undo that decision. The parser gets one say, at first sight, and never again.
 */
export async function recordCandidates(rows: CandidateRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await ensurePayoutTables();
  const inserted = await db
    .insert(studentPayouts)
    .values(rows)
    .onConflictDoNothing({ target: studentPayouts.messageId })
    .returning({ messageId: studentPayouts.messageId });
  return inserted.length;
}

/** Pending rows the bot has not yet posted to the review channel. */
export function listUnpostedPending(limit: number): Promise<StudentPayoutRow[]> {
  return ensurePayoutTables().then(() =>
    db
      .select()
      .from(studentPayouts)
      .where(and(eq(studentPayouts.status, "pending"), isNull(studentPayouts.reviewMessageId)))
      // Oldest first: the queue drains in the order it filled, so nothing
      // sits at the bottom forever.
      .orderBy(asc(studentPayouts.messageId))
      .limit(limit)
  );
}

/** Pending rows already posted — the ones whose reactions we poll. */
export function listAwaitingReview(limit: number): Promise<StudentPayoutRow[]> {
  return ensurePayoutTables().then(() =>
    db
      .select()
      .from(studentPayouts)
      .where(
        and(eq(studentPayouts.status, "pending"), isNotNull(studentPayouts.reviewMessageId))
      )
      .orderBy(asc(studentPayouts.messageId))
      .limit(limit)
  );
}

export async function markReviewPosted(
  messageId: string,
  reviewMessageId: string
): Promise<void> {
  await ensurePayoutTables();
  await db
    .update(studentPayouts)
    .set({ reviewMessageId })
    .where(eq(studentPayouts.messageId, messageId));
}

/**
 * Applies a human decision. Scoped to rows still `pending`, so two reviewers
 * acting at once (or a reply and a reaction arriving in the same tick) settle
 * on whichever landed first instead of fighting.
 */
export async function resolvePayout(opts: {
  messageId: string;
  status: PayoutStatus;
  amountCents: number | null;
  decidedBy: string;
}): Promise<boolean> {
  await ensurePayoutTables();
  const updated = await db
    .update(studentPayouts)
    .set({
      status: opts.status,
      amountCents: opts.amountCents,
      decidedBy: opts.decidedBy,
      decidedAt: new Date(),
    })
    .where(and(eq(studentPayouts.messageId, opts.messageId), eq(studentPayouts.status, "pending")))
    .returning({ messageId: studentPayouts.messageId });
  return updated.length > 0;
}

export async function findByReviewMessageId(
  reviewMessageId: string
): Promise<StudentPayoutRow | null> {
  await ensurePayoutTables();
  const [row] = await db
    .select()
    .from(studentPayouts)
    .where(eq(studentPayouts.reviewMessageId, reviewMessageId))
    .limit(1);
  return row ?? null;
}

/** The public number. Approved rows only; a null amount contributes nothing. */
export async function totalApprovedCents(): Promise<number> {
  await ensurePayoutTables();
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${studentPayouts.amountCents}), 0)` })
    .from(studentPayouts)
    .where(eq(studentPayouts.status, "approved"));
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

export async function payoutCounts(): Promise<Record<string, number>> {
  await ensurePayoutTables();
  const rows = await db
    .select({ status: studentPayouts.status, n: sql<string>`count(*)` })
    .from(studentPayouts)
    .groupBy(studentPayouts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
